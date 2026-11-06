/**
 * PROC-1 采购监控配置服务：读 / 存 / 启停 / 视图（spec procurement/watch-scan「监控配置与启停」）。
 * V1 每个组织一个监控（数据模型支持多个，按名称唯一）。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { describeSchedule, nextSlot } from "./schedule";
import {
  defaultWatchConfig,
  mergeWatchConfig,
  readWatchConfig,
  SOURCE_CAPABILITIES,
  watchConfigInputSchema,
  type WatchConfig,
} from "./watch-config";
import type { SourceResult } from "./sources-pure";

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export async function getWatchRow(orgId: string) {
  return db.procurementWatch.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" } });
}

function configColumns(c: WatchConfig) {
  return {
    name: c.name,
    timezone: c.timezone,
    scheduleJson: json(c.schedule),
    filtersJson: json(c.filters),
    limitsJson: json(c.limits),
    sourcesJson: json(c.sources),
  };
}

export type SaveWatchResult =
  | { ok: true; watchId: string; created: boolean }
  | { ok: false; status: 400; code: string; message: string };

/** 保存配置；首次保存即创建（enabled=false） */
export async function saveWatchConfig(input: { orgId: string; userId: string; body: unknown }): Promise<SaveWatchResult> {
  const parsed = watchConfigInputSchema.safeParse(input.body ?? {});
  if (!parsed.success) {
    return { ok: false, status: 400, code: "INVALID_SETTINGS", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("；") };
  }
  const row = await getWatchRow(input.orgId);
  const base = row ? readWatchConfig(row) : defaultWatchConfig();
  const merged = mergeWatchConfig(base, parsed.data);
  if (!merged.ok) return { ok: false, status: 400, code: merged.code, message: merged.message };
  const cfg = merged.config;
  if (!row) {
    const created = await db.procurementWatch.create({
      data: { orgId: input.orgId, ...configColumns(cfg), enabled: false, createdById: input.userId, updatedById: input.userId },
      select: { id: true },
    });
    await logAudit({ userId: input.userId, orgId: input.orgId, action: "procurement_watch.create", targetType: "procurement_watch", targetId: created.id, afterData: { enabled: false, name: cfg.name } });
    return { ok: true, watchId: created.id, created: true };
  }
  await db.procurementWatch.update({
    where: { id: row.id },
    data: {
      ...configColumns(cfg),
      updatedById: input.userId,
      nextRunAt: row.enabled ? (nextSlot(new Date(), cfg.schedule, cfg.timezone)?.slotAt ?? null) : null,
    },
  });
  await logAudit({ userId: input.userId, orgId: input.orgId, action: "procurement_watch.update", targetType: "procurement_watch", targetId: row.id, afterData: { name: cfg.name, schedule: cfg.schedule, limits: cfg.limits } });
  return { ok: true, watchId: row.id, created: false };
}

/** 启用 / 停用。停用：排队中的运行取消（运行中的在下一个来源前收尾），候选与案件全部保留 */
export async function setWatchEnabled(input: { orgId: string; userId: string; enabled: boolean; now?: Date }): Promise<{ ok: true } | { ok: false; status: 404; code: "WATCH_NOT_CONFIGURED" }> {
  const now = input.now ?? new Date();
  const row = await getWatchRow(input.orgId);
  if (!row) return { ok: false, status: 404, code: "WATCH_NOT_CONFIGURED" };
  const cfg = readWatchConfig(row);
  if (input.enabled) {
    await db.procurementWatch.update({
      where: { id: row.id },
      data: { enabled: true, enabledAt: now, enabledById: input.userId, disabledAt: null, disabledById: null, nextRunAt: nextSlot(now, cfg.schedule, cfg.timezone)?.slotAt ?? null },
    });
  } else {
    await db.procurementWatch.update({
      where: { id: row.id },
      data: { enabled: false, disabledAt: now, disabledById: input.userId, nextRunAt: null },
    });
    await db.procurementScanRun.updateMany({
      where: { watchId: row.id, status: "QUEUED", trigger: "SCHEDULED" },
      data: { status: "CANCELLED", finishedAt: now, error: "监控已停用" },
    });
  }
  await logAudit({ userId: input.userId, orgId: input.orgId, action: input.enabled ? "procurement_watch.enable" : "procurement_watch.disable", targetType: "procurement_watch", targetId: row.id, afterData: { enabled: input.enabled } });
  return { ok: true };
}

function runView(r: {
  id: string;
  trigger: string;
  status: string;
  slotKey: string;
  attempt: number;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  truncated: boolean;
  error: string | null;
  sourceResultsJson: unknown;
  countersJson: unknown;
  progressJson: unknown;
}) {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    slotKey: r.slotKey.startsWith("manual:") ? "manual" : r.slotKey,
    attempt: r.attempt,
    queuedAt: r.queuedAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    heartbeatAt: r.heartbeatAt?.toISOString() ?? null,
    truncated: r.truncated,
    error: r.error,
    sourceResults: (Array.isArray(r.sourceResultsJson) ? r.sourceResultsJson : []) as unknown as SourceResult[],
    counters: (r.countersJson ?? null) as Record<string, unknown> | null,
    progress: (r.progressJson ?? null) as Record<string, unknown> | null,
  };
}

export type ScanRunView = ReturnType<typeof runView>;

export async function getRunView(orgId: string, runId: string): Promise<ScanRunView | null> {
  const r = await db.procurementScanRun.findFirst({ where: { id: runId, orgId } });
  return r ? runView(r) : null;
}

/** 监控页视图：配置已启用 与 最近一次实际成功运行 分开给出 */
export async function getWatchView(orgId: string) {
  const row = await getWatchRow(orgId);
  const config = row ? readWatchConfig(row) : defaultWatchConfig();
  const runs = row
    ? await db.procurementScanRun.findMany({ where: { watchId: row.id }, orderBy: { queuedAt: "desc" }, take: 8 })
    : [];
  const lastFinished = runs.find((r) => r.finishedAt);
  const lastResults = (lastFinished && Array.isArray(lastFinished.sourceResultsJson) ? lastFinished.sourceResultsJson : []) as unknown as SourceResult[];
  const people = row
    ? await db.user.findMany({ where: { id: { in: [row.enabledById, row.createdById].filter((x): x is string => !!x) } }, select: { id: true, name: true } })
    : [];
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? "成员") : null);
  return {
    configured: Boolean(row),
    watchId: row?.id ?? null,
    config,
    scheduleText: describeSchedule(config.schedule, config.timezone),
    enabled: row?.enabled ?? false,
    enabledAt: row?.enabledAt?.toISOString() ?? null,
    enabledBy: nameOf(row?.enabledById ?? null),
    nextRunAt: row?.enabled ? (row.nextRunAt?.toISOString() ?? null) : null,
    lastRunAt: row?.lastRunAt?.toISOString() ?? null,
    lastRunStatus: row?.lastRunStatus ?? null,
    lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
    activeRun: runs.find((r) => r.status === "QUEUED" || r.status === "RUNNING") ? runView(runs.find((r) => r.status === "QUEUED" || r.status === "RUNNING")!) : null,
    recentRuns: runs.map(runView),
    sources: SOURCE_CAPABILITIES.map((cap) => ({
      ...cap,
      enabled: cap.key === "PROVINCIAL_MANUAL" ? null : config.sources[cap.key],
      lastResult: cap.key === "PROVINCIAL_MANUAL" ? null : (lastResults.find((r) => r.source === cap.key) ?? null),
    })),
    costControls: {
      aiCallsPerRun: 0,
      aiNote: "V1 全部确定性实现，零 LLM 调用",
      limits: config.limits,
    },
    mailIntake: { enabled: false, note: "尚未启用自动收信：来信请在申请详情上传或粘贴" },
  };
}
