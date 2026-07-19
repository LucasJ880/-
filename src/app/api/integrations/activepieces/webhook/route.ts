import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { runMarketingHealthGrader } from "@/lib/ai-grader/graders/marketing-health-grader";
import { verifyActivepiecesSignature } from "@/lib/marketing/activepieces";
import { pushMarketingDailyBrief } from "@/lib/marketing/daily-brief-push";
import { completeMeridianRun } from "@/lib/marketing/mmm";
import { writeMarketingMetricSnapshot } from "@/lib/marketing/metrics";
import { reviewMarketingExperiments } from "@/lib/marketing/experiment-review";
import {
  buildGa4IngestionKey,
  mapGa4RowToMetricValues,
  type Ga4RawMetricRow,
} from "@/lib/marketing/providers/ga4-mapper";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const verified = verifyActivepiecesSignature({
    rawBody,
    timestamp: request.headers.get("x-qingyan-timestamp"),
    signature: request.headers.get("x-qingyan-signature"),
  });
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 401 });

  let payload: Record<string, unknown>;
  try {
    payload = record(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "JSON 无效" }, { status: 400 });
  }
  const eventId = text(payload.eventId);
  const eventType = text(payload.eventType);
  const orgId = text(payload.orgId);
  const workflowRunId = text(payload.workflowRunId);
  const data = record(payload.data);
  if (!eventId || !eventType || !orgId || !workflowRunId) {
    return NextResponse.json({ error: "eventId、eventType、orgId、workflowRunId 为必填项" }, { status: 400 });
  }

  const workflow = await db.marketingWorkflowRun.findFirst({
    where: { id: workflowRunId, orgId, provider: "activepieces" },
  });
  if (!workflow) return NextResponse.json({ error: "工作流不存在或跨组织" }, { status: 404 });
  const previousOutput = record(workflow.outputJson);
  if (!eventType.startsWith("workflow.") && text(previousOutput.eventId) === eventId) {
    return NextResponse.json({ ok: true, duplicate: true, eventId });
  }
  const organization = await db.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } });
  if (!organization) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  const actorId = workflow.triggeredById || organization.ownerId;

  try {
    let result: unknown;
    if (eventType === "workflow.started") {
      result = await db.marketingWorkflowRun.update({
        where: { id: workflow.id },
        data: {
          status: "running",
          externalRunId: text(data.externalRunId) || workflow.externalRunId,
          startedAt: workflow.startedAt || new Date(),
        },
      });
    } else if (eventType === "workflow.completed") {
      result = await db.marketingWorkflowRun.update({
        where: { id: workflow.id },
        data: {
          status: "completed",
          outputJson: jsonValue({
            ...data,
            ...(text(previousOutput.eventId) ? { eventId: text(previousOutput.eventId) } : {}),
          }),
          completedAt: new Date(),
          error: null,
        },
      });
    } else if (eventType === "workflow.failed") {
      result = await db.marketingWorkflowRun.update({
        where: { id: workflow.id },
        data: {
          status: "failed",
          outputJson: jsonValue({
            ...data,
            ...(text(previousOutput.eventId) ? { eventId: text(previousOutput.eventId) } : {}),
          }),
          error: text(data.error).slice(0, 4000) || "Activepieces 流程失败",
          completedAt: new Date(),
        },
      });
    } else if (eventType === "marketing.metrics.upsert") {
      const items = Array.isArray(data.snapshots) ? data.snapshots.slice(0, 1000) : [data.snapshot];
      const snapshots = [];
      for (let index = 0; index < items.length; index++) {
        const raw = record(items[index]);
        if (Object.keys(raw).length === 0) continue;
        const sourceHint = text(raw.source) || text(data.provider) || "activepieces";
        const isGa4 =
          sourceHint === "ga4" ||
          sourceHint === "ga4_raw" ||
          Boolean(raw.propertyId || raw.screenPageViews || raw.sessions);
        const values = isGa4
          ? mapGa4RowToMetricValues(raw as Ga4RawMetricRow)
          : raw;
        const itemKey =
          text(raw.ingestionKey) ||
          (isGa4 ? buildGa4IngestionKey(raw as Ga4RawMetricRow) : `${eventId}:${index}`);
        snapshots.push(await writeMarketingMetricSnapshot({
          orgId,
          userId: actorId,
          source: isGa4 ? "ga4" : sourceHint || "activepieces",
          ingestionKey: itemKey,
          externalEventId: eventId,
          values,
        }));
      }
      const accountIds = [...new Set(snapshots.map((row) => row.channelAccountId).filter((id): id is string => Boolean(id)))];
      if (accountIds.length) {
        await db.marketingChannelAccount.updateMany({
          where: { orgId, id: { in: accountIds } },
          data: { status: "connected", lastSyncedAt: new Date(), lastError: null },
        });
      }
      result = { upserted: snapshots.length };
    } else if (eventType === "marketing.health.requested") {
      result = await runMarketingHealthGrader({ orgId, userId: actorId });
    } else if (eventType === "marketing.daily_brief.requested") {
      result = await pushMarketingDailyBrief(orgId);
    } else if (eventType === "marketing.experiment.review.requested") {
      result = await reviewMarketingExperiments({
        orgId,
        experimentId: text(data.experimentId) || null,
      });
    } else if (eventType === "marketing.mmm.completed") {
      result = await completeMeridianRun({
        orgId,
        modelRunId: text(data.modelRunId),
        externalRunId: text(data.externalRunId) || null,
        modelVersion: text(data.modelVersion) || null,
        diagnostics: data.diagnostics,
        summary: data.summary,
        contributions: Array.isArray(data.contributions) ? data.contributions.map(record) : [],
        scenarios: Array.isArray(data.scenarios) ? data.scenarios.map(record) : [],
      });
    } else if (eventType === "marketing.mmm.failed") {
      const modelRunId = text(data.modelRunId);
      const modelRun = await db.mmmModelRun.findFirst({ where: { id: modelRunId, orgId } });
      if (!modelRun) throw new Error("MMM 模型运行不存在或跨组织");
      result = await db.mmmModelRun.update({
        where: { id: modelRun.id },
        data: { status: "failed", error: text(data.error).slice(0, 4000) || "Meridian 运行失败", completedAt: new Date() },
      });
    } else {
      return NextResponse.json({ error: `不支持的事件类型: ${eventType}` }, { status: 400 });
    }

    if (!eventType.startsWith("workflow.")) {
      await db.marketingWorkflowRun.update({
        where: { id: workflow.id },
        data: { status: "completed", outputJson: jsonValue({ eventId, eventType, result }), completedAt: new Date(), error: null },
      });
    }
    await logAudit({
      userId: actorId,
      orgId,
      action: "marketing_activepieces_event",
      targetType: "marketing_workflow_run",
      targetId: workflow.id,
      afterData: { eventId, eventType },
      request,
    });
    return NextResponse.json({ ok: true, eventId, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.marketingWorkflowRun.update({
      where: { id: workflow.id },
      data: { status: "failed", error: message.slice(0, 4000), completedAt: new Date() },
    }).catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
