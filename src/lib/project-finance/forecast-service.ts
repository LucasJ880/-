/**
 * 人工成本完工预测（Forecast at Completion · Method A）。
 * 存 ACTIVE ProjectBudgetVersion.metadata.costForecast（零 schema；预算行不动，历史 append）；
 * ledger producers 开启时同事务追加 ProjectEvent `budget.forecast_updated:{versionId}:t{seq}`；AuditLog 必记。
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { appendProjectEvent } from "@/lib/project-ledger/event-service";
import { isLedgerProducerActive } from "@/lib/project-ledger/flags";

export const FORECAST_AUDIT_ACTION = "financial_forecast_updated";

export class ForecastError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export async function setManualCostForecast(input: { orgId: string; projectId: string; userId: string; expectedRemainingCostCad: number; note?: string | null }): Promise<{ versionId: string; seq: number }> {
  const v = input.expectedRemainingCostCad;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new ForecastError("FORECAST_INVALID", "预计剩余成本必须是 ≥ 0 的有限数");
  const project = await db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { id: true } });
  if (!project) throw new ForecastError("FINANCE_TENANT_MISMATCH", "项目不存在", 404);
  const budget = await db.projectBudget.findUnique({ where: { orgId_projectId: { orgId: input.orgId, projectId: input.projectId } }, select: { id: true } });
  const active = budget ? await db.projectBudgetVersion.findFirst({ where: { budgetId: budget.id, status: "ACTIVE" }, select: { id: true } }) : null;
  if (!active) throw new ForecastError("NO_ACTIVE_BUDGET", "尚无生效预算版本，无法记录完工预测（请先激活预算）", 409);
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ProjectBudgetVersion" WHERE "id" = ${active.id} FOR UPDATE`;
    const row = await tx.projectBudgetVersion.findUnique({ where: { id: active.id }, select: { metadata: true } });
    const meta = row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
    const prev = meta.costForecast && typeof meta.costForecast === "object" ? (meta.costForecast as Record<string, unknown>) : null;
    const history = Array.isArray(prev?.history) ? (prev!.history as unknown[]).slice(-19) : [];
    if (prev) history.push({ expectedRemainingCostCad: prev.expectedRemainingCostCad ?? null, note: prev.note ?? null, updatedAt: prev.updatedAt ?? null, updatedById: prev.updatedById ?? null, seq: prev.seq ?? null });
    const seq = (typeof prev?.seq === "number" ? prev.seq : 0) + 1;
    const costForecast = { method: "MANUAL", expectedRemainingCostCad: Math.round(v * 100) / 100, note: input.note?.trim().slice(0, 500) || null, updatedAt: now.toISOString(), updatedById: input.userId, seq, history };
    await tx.projectBudgetVersion.update({ where: { id: active.id }, data: { metadata: { ...meta, costForecast } as Prisma.InputJsonValue } });
    if (isLedgerProducerActive()) {
      await appendProjectEvent({ tx, orgId: input.orgId, projectId: input.projectId, eventType: "budget.forecast_updated", eventKey: `budget.forecast_updated:${active.id}:t${seq}`, occurredAt: now, actor: { actorType: "user", actorId: input.userId }, title: "更新成本完工预测（人工）", payload: { versionId: active.id, expectedRemainingCostCad: costForecast.expectedRemainingCostCad, seq } });
    }
    return { versionId: active.id, seq };
  });
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: FORECAST_AUDIT_ACTION, targetType: "project_budget_version", targetId: result.versionId, afterData: { expectedRemainingCostCad: Math.round(v * 100) / 100, note: input.note ?? null, seq: result.seq } }).catch(() => undefined);
  return result;
}
