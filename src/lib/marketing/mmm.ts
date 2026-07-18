import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dispatchMarketingWorkflow } from "./workflows";

export type MmmTargetKpi = "qualifiedLeads" | "wins" | "revenue";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function startOfUtcWeek(value: Date): Date {
  const result = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() - (day === 0 ? 6 : day - 1));
  return result;
}

function finite(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function channelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^activepieces:/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

export async function createWeeklyMmmDataset(input: {
  orgId: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  targetKpi: MmmTargetKpi;
  currency?: string;
}) {
  if (input.periodEnd < input.periodStart) throw new Error("MMM 数据结束日期不能早于开始日期");
  const snapshots = await db.marketingMetricSnapshot.findMany({
    where: {
      orgId: input.orgId,
      capturedAt: { gte: input.periodStart, lte: input.periodEnd },
      dataQualityStatus: { not: "invalid" },
    },
    orderBy: { capturedAt: "asc" },
  });
  const accountIds = [...new Set(snapshots.map((row) => row.channelAccountId).filter((id): id is string => Boolean(id)))];
  const publicationIds = [...new Set(snapshots.map((row) => row.publicationId).filter((id): id is string => Boolean(id)))];
  const [accounts, publications] = await Promise.all([
    accountIds.length
      ? db.marketingChannelAccount.findMany({ where: { orgId: input.orgId, id: { in: accountIds } }, select: { id: true, provider: true } })
      : [],
    publicationIds.length
      ? db.marketingPublication.findMany({ where: { orgId: input.orgId, id: { in: publicationIds } }, select: { id: true, channel: true } })
      : [],
  ]);
  const accountChannels = new Map(accounts.map((row) => [row.id, row.provider]));
  const publicationChannels = new Map(publications.map((row) => [row.id, row.channel]));

  type WeekRow = {
    date_week: string;
    qualified_leads: number;
    wins: number;
    revenue: number;
    media_spend: Record<string, number>;
    media_impressions: Record<string, number>;
  };
  const weekly = new Map<string, WeekRow>();
  const channels = new Set<string>();
  let totalSpend = 0;
  let warningSnapshots = 0;

  for (const snapshot of snapshots) {
    const week = startOfUtcWeek(snapshot.periodStart ?? snapshot.capturedAt).toISOString().slice(0, 10);
    const channel = channelKey(
      (snapshot.channelAccountId && accountChannels.get(snapshot.channelAccountId)) ||
      (snapshot.publicationId && publicationChannels.get(snapshot.publicationId)) ||
      snapshot.source,
    );
    channels.add(channel);
    const current = weekly.get(week) ?? {
      date_week: week,
      qualified_leads: 0,
      wins: 0,
      revenue: 0,
      media_spend: {},
      media_impressions: {},
    };
    current.qualified_leads += snapshot.qualifiedLeads;
    current.wins += snapshot.wins;
    current.revenue += snapshot.revenue;
    current.media_spend[channel] = finite(current.media_spend[channel]) + snapshot.spend;
    current.media_impressions[channel] = finite(current.media_impressions[channel]) + snapshot.impressions;
    totalSpend += snapshot.spend;
    if (snapshot.dataQualityStatus === "warning" || snapshot.dataQualityStatus === "unverified") warningSnapshots++;
    weekly.set(week, current);
  }

  const channelList = [...channels].sort();
  const rows = [...weekly.values()]
    .sort((a, b) => a.date_week.localeCompare(b.date_week))
    .map((row) => ({
      ...row,
      kpi: input.targetKpi === "qualifiedLeads"
        ? row.qualified_leads
        : input.targetKpi === "wins"
          ? row.wins
          : row.revenue,
      media_spend: Object.fromEntries(channelList.map((channel) => [channel, finite(row.media_spend[channel])])),
      media_impressions: Object.fromEntries(channelList.map((channel) => [channel, finite(row.media_impressions[channel])])),
    }));

  const qualityIssues: string[] = [];
  if (rows.length < 52) qualityIssues.push(`仅有 ${rows.length} 个周数据，正式 MMM 建议至少准备 52 个周数据`);
  if (channelList.length < 2) qualityIssues.push("可识别营销渠道少于 2 个");
  if (totalSpend <= 0) qualityIssues.push("数据集中没有可用媒体花费");
  if (warningSnapshots > 0) qualityIssues.push(`${warningSnapshots} 条快照尚未完全验证`);
  if (rows.every((row) => finite(row.kpi) === 0)) qualityIssues.push(`目标指标 ${input.targetKpi} 全部为 0`);
  const ready = rows.length >= 52 && channelList.length >= 2 && totalSpend > 0 && rows.some((row) => finite(row.kpi) > 0);
  const datasetPayload = {
    schemaVersion: "qingyan-meridian-weekly-v1",
    targetKpi: input.targetKpi,
    currency: (input.currency || "CAD").slice(0, 3).toUpperCase(),
    channels: channelList,
    rows,
  };
  const checksum = crypto.createHash("sha256").update(JSON.stringify(datasetPayload)).digest("hex");

  return db.mmmDatasetVersion.upsert({
    where: { orgId_checksum: { orgId: input.orgId, checksum } },
    create: {
      orgId: input.orgId,
      name: `${input.targetKpi} · ${input.periodStart.toISOString().slice(0, 10)} – ${input.periodEnd.toISOString().slice(0, 10)}`,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      targetKpi: input.targetKpi,
      currency: datasetPayload.currency,
      rowCount: rows.length,
      weekCount: rows.length,
      status: ready ? "ready" : "insufficient_data",
      checksum,
      schemaJson: jsonValue({
        schemaVersion: datasetPayload.schemaVersion,
        dateColumn: "date_week",
        kpiColumn: "kpi",
        mediaSpendColumn: "media_spend",
        mediaImpressionsColumn: "media_impressions",
        channels: channelList,
      }),
      dataJson: jsonValue(datasetPayload),
      qualityIssues: jsonValue(qualityIssues),
      createdById: input.userId,
    },
    update: {},
  });
}

export async function requestMeridianRun(input: {
  orgId: string;
  userId: string;
  datasetVersionId: string;
  exploratory?: boolean;
  config?: Record<string, unknown>;
}) {
  const dataset = await db.mmmDatasetVersion.findFirst({
    where: { id: input.datasetVersionId, orgId: input.orgId },
  });
  if (!dataset) throw new Error("MMM 数据集不存在或跨组织");
  if (dataset.status !== "ready" && !input.exploratory) {
    throw new Error("MMM 数据量尚不足；如仅验证技术管道，请明确选择探索性运行");
  }
  const modelRun = await db.mmmModelRun.create({
    data: {
      orgId: input.orgId,
      datasetVersionId: dataset.id,
      status: "queued",
      requestedById: input.userId,
      configJson: jsonValue({ exploratory: Boolean(input.exploratory), ...(input.config ?? {}) }),
    },
  });
  const workflow = await dispatchMarketingWorkflow({
    orgId: input.orgId,
    userId: input.userId,
    flowKey: "mmm-run",
    data: {
      modelRunId: modelRun.id,
      provider: "meridian",
      exploratory: Boolean(input.exploratory),
      dataset: dataset.dataJson,
      schema: dataset.schemaJson,
      config: input.config ?? {},
    },
  });
  const status = workflow.status === "dispatched" ? "running" : "failed";
  const updated = await db.mmmModelRun.update({
    where: { id: modelRun.id },
    data: {
      status,
      startedAt: status === "running" ? new Date() : null,
      error: status === "failed" ? workflow.error || "Meridian 执行流未配置" : null,
    },
  });
  return { modelRun: updated, workflow };
}

export async function completeMeridianRun(input: {
  orgId: string;
  modelRunId: string;
  externalRunId?: string | null;
  modelVersion?: string | null;
  diagnostics?: unknown;
  summary?: unknown;
  contributions?: Array<Record<string, unknown>>;
  scenarios?: Array<Record<string, unknown>>;
}) {
  const existing = await db.mmmModelRun.findFirst({ where: { id: input.modelRunId, orgId: input.orgId } });
  if (!existing) throw new Error("MMM 模型运行不存在或跨组织");
  const contributions = (input.contributions ?? []).filter((row) => typeof row.channel === "string");
  const scenarios = (input.scenarios ?? []).filter((row) => typeof row.name === "string");

  return db.$transaction(async (tx) => {
    await tx.mmmChannelContribution.deleteMany({ where: { modelRunId: existing.id } });
    if (contributions.length) {
      await tx.mmmChannelContribution.createMany({
        data: contributions.map((row) => ({
          orgId: input.orgId,
          modelRunId: existing.id,
          channel: String(row.channel).slice(0, 100),
          spend: finite(row.spend),
          contribution: finite(row.contribution),
          contributionShare: finite(row.contributionShare),
          roi: row.roi == null ? null : finite(row.roi),
          marginalRoi: row.marginalRoi == null ? null : finite(row.marginalRoi),
          confidenceLow: row.confidenceLow == null ? null : finite(row.confidenceLow),
          confidenceHigh: row.confidenceHigh == null ? null : finite(row.confidenceHigh),
        })),
      });
    }
    if (scenarios.length) {
      await tx.mmmBudgetScenario.createMany({
        data: scenarios.map((row) => ({
          orgId: input.orgId,
          modelRunId: existing.id,
          name: String(row.name).slice(0, 200),
          totalBudget: finite(row.totalBudget),
          currency: String(row.currency || "CAD").slice(0, 3).toUpperCase(),
          allocationsJson: jsonValue(row.allocations ?? {}),
          expectedKpi: row.expectedKpi == null ? null : finite(row.expectedKpi),
          confidenceLow: row.confidenceLow == null ? null : finite(row.confidenceLow),
          confidenceHigh: row.confidenceHigh == null ? null : finite(row.confidenceHigh),
          createdById: existing.requestedById,
        })),
      });
    }
    return tx.mmmModelRun.update({
      where: { id: existing.id },
      data: {
        status: "completed",
        externalRunId: input.externalRunId || existing.externalRunId,
        modelVersion: input.modelVersion || existing.modelVersion,
        diagnosticsJson: jsonValue(input.diagnostics ?? {}),
        summaryJson: jsonValue(input.summary ?? {}),
        completedAt: new Date(),
        error: null,
      },
      include: { contributions: true, scenarios: true, datasetVersion: true },
    });
  });
}
