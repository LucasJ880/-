/**
 * PROC-1 扫描执行器（design D2）：挂在既有 tender-watch cron；手动「立即扫描」在响应后执行，cron 兜底。
 *
 * 单轮：认领 → 读配置与已有状态 → 刷新已关注合同 → 获取新候选 → 标准化去重 → 保存证据与变化
 *       → 排序与草拟 → 持久化 → 通知。
 *
 * 认领：同一监控同一槽位只有一个运行行（@@unique([watchId, slotKey])）；条件更新拿 runnerToken；
 * 每个来源完成后刷新心跳与进度（条件更新失败 = 已被接管，立即停止写入）；心跳超过 10 分钟可被接管，
 * 已完成来源跳过；墙钟预算耗尽 → 回到 QUEUED（待续）。所有写入落在唯一键上，重跑 / 并发不产生重复。
 */

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/create";
import { isProcurementSchemaReady } from "./flags";
import { normalizeInstrumentNumber } from "./identity";
import {
  isUniqueViolation,
  loadKnownInstruments,
  recomputePriority,
  recordAtiSummary,
  recordPageSnapshot,
  upsertInstrumentFromRecord,
} from "./instruments";
import { computePriority } from "./priority";
import { dueSlot, latestDueSlot, nextSlot } from "./schedule";
import { ADAPTERS, externalFetchAllowed, gateClosedOutput, type AdapterContext } from "./source-fetch";
import { aggregateRunStatus, emptySourceResult, stableHash, type SourceResult } from "./sources-pure";
import { matchKeywords, readWatchConfig, SOURCE_KEYS, type SourceKey } from "./watch-config";

export const HEARTBEAT_STALE_MS = 10 * 60_000;
export const MANUAL_PICKUP_DELAY_MS = 2 * 60_000;
export const DEFAULT_STEP_BUDGET_MS = 150_000;

/** 刷新路径在前（已关注合同），发现路径在后 */
export const SOURCE_ORDER: SourceKey[] = [
  "CANADABUYS_CONTRACT_HISTORY_PAGE",
  "OPEN_CANADA_CONTRACTS",
  "OPEN_CANADA_ATI_SUMMARIES",
  "CANADABUYS_TENDER_NOTICES",
];

export type AutoDraftFn = (input: { orgId: string; instrumentId: string; actorUserId: string; runId: string }) => Promise<{ created: boolean; requestId: string | null }>;

export interface ScanDeps {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  deadline?: Date;
  createAutoDraft?: AutoDraftFn;
  /** 测试用：在某来源完成后注入动作（如模拟进程中断） */
  afterSource?: (source: SourceKey) => Promise<void> | void;
}

interface RunCounters {
  newCandidates: number;
  deferredCandidates: number;
  historyRecords: number;
  changedEvidence: number;
  newEvidence: number;
  flaggedForReview: number;
  newDrafts: number;
  aiCalls: 0;
  newInstrumentIds: string[];
  changedInstrumentIds: string[];
  newDraftIds: string[];
}

interface RunProgress {
  completedSources: SourceKey[];
  step: string;
}

function emptyCounters(): RunCounters {
  return {
    newCandidates: 0,
    deferredCandidates: 0,
    historyRecords: 0,
    changedEvidence: 0,
    newEvidence: 0,
    flaggedForReview: 0,
    newDrafts: 0,
    aiCalls: 0,
    newInstrumentIds: [],
    changedInstrumentIds: [],
    newDraftIds: [],
  };
}

function readCounters(v: unknown): RunCounters {
  const base = emptyCounters();
  if (!v || typeof v !== "object") return base;
  const o = v as Partial<RunCounters>;
  return {
    ...base,
    ...o,
    aiCalls: 0,
    newInstrumentIds: Array.isArray(o.newInstrumentIds) ? o.newInstrumentIds : [],
    changedInstrumentIds: Array.isArray(o.changedInstrumentIds) ? o.changedInstrumentIds : [],
    newDraftIds: Array.isArray(o.newDraftIds) ? o.newDraftIds : [],
  };
}

function readProgress(v: unknown): RunProgress {
  const o = (v && typeof v === "object" ? v : {}) as Partial<RunProgress>;
  return {
    completedSources: Array.isArray(o.completedSources) ? (o.completedSources.filter((s) => (SOURCE_KEYS as readonly string[]).includes(s)) as SourceKey[]) : [],
    step: typeof o.step === "string" ? o.step : "claimed",
  };
}

function readResults(v: unknown): SourceResult[] {
  return Array.isArray(v) ? (v as SourceResult[]) : [];
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** 是否有未失联的排队 / 运行中运行 */
async function findActiveRun(watchId: string, now: Date) {
  return db.procurementScanRun.findFirst({
    where: {
      watchId,
      OR: [{ status: "QUEUED" }, { status: "RUNNING", heartbeatAt: { gte: new Date(now.getTime() - HEARTBEAT_STALE_MS) } }],
    },
    orderBy: { queuedAt: "desc" },
    select: { id: true, status: true },
  });
}

/** 手动「立即扫描」：只建 QUEUED 运行；已有活动运行则复用 */
export async function enqueueManualRun(input: { orgId: string; watchId: string; userId: string; now?: Date }): Promise<{ runId: string; reused: boolean }> {
  const now = input.now ?? new Date();
  const active = await findActiveRun(input.watchId, now);
  if (active) return { runId: active.id, reused: true };
  const run = await db.procurementScanRun.create({
    data: { orgId: input.orgId, watchId: input.watchId, slotKey: `manual:${randomUUID()}`, trigger: "MANUAL", status: "QUEUED", requestedById: input.userId, queuedAt: now },
    select: { id: true },
  });
  return { runId: run.id, reused: false };
}

/** 为已启用监控创建到期的定时运行（槽位唯一；重启 / 重复 tick 不重复） */
export async function ensureScheduledRuns(now: Date): Promise<{ created: number; checked: number }> {
  const watches = await db.procurementWatch.findMany({ where: { enabled: true }, take: 100 });
  let created = 0;
  for (const w of watches) {
    const cfg = readWatchConfig(w);
    const latest = latestDueSlot(now, cfg.schedule, cfg.timezone);
    const existing = latest
      ? await db.procurementScanRun.findMany({ where: { watchId: w.id, slotKey: latest.slotKey }, select: { slotKey: true } })
      : [];
    const due = dueSlot({ now, schedule: cfg.schedule, timeZone: cfg.timezone, enabledAt: w.enabledAt, existingSlotKeys: new Set(existing.map((e) => e.slotKey)) });
    if (due) {
      try {
        await db.procurementScanRun.create({
          data: { orgId: w.orgId, watchId: w.id, slotKey: due.slotKey, trigger: "SCHEDULED", status: "QUEUED", queuedAt: now },
        });
        created++;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    const next = nextSlot(now, cfg.schedule, cfg.timezone)?.slotAt ?? null;
    if ((w.nextRunAt?.getTime() ?? null) !== (next?.getTime() ?? null)) {
      await db.procurementWatch.update({ where: { id: w.id }, data: { nextRunAt: next } });
    }
  }
  return { created, checked: watches.length };
}

/** 认领：QUEUED 或心跳过期的 RUNNING → RUNNING + 新 runnerToken（条件更新，只有一个成功） */
export async function claimRun(runId: string, now: Date): Promise<string | null> {
  const token = randomUUID();
  const res = await db.procurementScanRun.updateMany({
    where: {
      id: runId,
      OR: [{ status: "QUEUED" }, { status: "RUNNING", heartbeatAt: { lt: new Date(now.getTime() - HEARTBEAT_STALE_MS) } }],
    },
    data: { status: "RUNNING", runnerToken: token, heartbeatAt: now, attempt: { increment: 1 } },
  });
  if (res.count !== 1) return null;
  await db.procurementScanRun.updateMany({ where: { id: runId, runnerToken: token, startedAt: null }, data: { startedAt: now } });
  return token;
}

export type RunOutcome =
  | { status: "not_claimed" }
  | { status: "cancelled" }
  | { status: "lease_lost"; at: SourceKey | "finalize" }
  | { status: "yielded"; completedSources: SourceKey[] }
  | { status: "finished"; runStatus: "SUCCEEDED" | "PARTIAL" | "FAILED"; counters: RunCounters; results: SourceResult[] };

/** 执行单轮（已被调用方选中的运行） */
export async function executeScanRun(runId: string, deps: ScanDeps = {}): Promise<RunOutcome> {
  const nowFn = deps.now ?? (() => new Date());
  const start = nowFn();
  const env = deps.env ?? process.env;
  const token = await claimRun(runId, start);
  if (!token) return { status: "not_claimed" };

  const run = await db.procurementScanRun.findUnique({ where: { id: runId } });
  const watch = run ? await db.procurementWatch.findUnique({ where: { id: run.watchId } }) : null;
  if (!run || !watch) return { status: "not_claimed" };

  if (!watch.enabled && run.trigger === "SCHEDULED") {
    await db.procurementScanRun.updateMany({ where: { id: runId, runnerToken: token }, data: { status: "CANCELLED", finishedAt: nowFn(), runnerToken: null, error: "监控已停用" } });
    return { status: "cancelled" };
  }

  const config = readWatchConfig(watch);
  const deadline = deps.deadline ?? new Date(start.getTime() + Math.min(config.limits.maxRuntimeMs, DEFAULT_STEP_BUDGET_MS));
  const progress = readProgress(run.progressJson);
  const results = readResults(run.sourceResultsJson);
  const counters = readCounters(run.countersJson);
  const known = await loadKnownInstruments(watch.orgId);
  const knownNumbers = new Set(known.map((k) => k.normalizedNumber));
  const touched = new Set<string>();
  const fetchAllowed = externalFetchAllowed(env);

  const persist = async (data: Prisma.ProcurementScanRunUncheckedUpdateManyInput) => {
    const r = await db.procurementScanRun.updateMany({ where: { id: runId, runnerToken: token }, data: { ...data, heartbeatAt: nowFn() } });
    return r.count === 1;
  };

  try {
    for (const source of SOURCE_ORDER) {
      if (progress.completedSources.includes(source)) continue;
      // 停用后：定时运行在下一个来源前收尾为 CANCELLED（已写入的证据与候选保留）
      if (run.trigger === "SCHEDULED") {
        const live = await db.procurementWatch.findUnique({ where: { id: watch.id }, select: { enabled: true } });
        if (!live?.enabled) {
          await db.procurementScanRun.updateMany({
            where: { id: runId, runnerToken: token },
            data: { status: "CANCELLED", finishedAt: nowFn(), runnerToken: null, error: "监控已停用（运行中收尾）", progressJson: json(progress), sourceResultsJson: json(results), countersJson: json(counters) },
          });
          return { status: "cancelled" };
        }
      }
      if (!config.sources[source]) {
        progress.completedSources.push(source);
        results.push({ ...emptySourceResult(source, nowFn()), status: "SKIPPED", note: "该来源在监控配置中已关闭" });
        if (!(await persist({ progressJson: json(progress), sourceResultsJson: json(results) }))) return { status: "lease_lost", at: source };
        continue;
      }
      if (nowFn().getTime() >= deadline.getTime()) {
        await db.procurementScanRun.updateMany({
          where: { id: runId, runnerToken: token },
          data: { status: "QUEUED", runnerToken: null, heartbeatAt: null, progressJson: json({ ...progress, step: "yielded" }), sourceResultsJson: json(results), countersJson: json(counters), truncated: true },
        });
        return { status: "yielded", completedSources: progress.completedSources };
      }

      const ctx: AdapterContext = { config, known, now: nowFn(), deadline, env, fetchImpl: deps.fetchImpl ?? fetch };
      let out;
      try {
        out = fetchAllowed ? await ADAPTERS[source](ctx) : gateClosedOutput(source, nowFn());
      } catch (e) {
        out = gateClosedOutput(source, nowFn());
        out.result.note = `来源适配器异常：${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`;
      }
      const result = out.result;

      // —— 写采购工具：先只更新既有，再按优先级在预算内新建 ——
      const deferred: typeof out.records = [];
      for (const rec of out.records) {
        const isHistoryCallUp = rec.instrumentClass === "CALL_UP" && !!rec.parentNumber && knownNumbers.has(normalizeInstrumentNumber(rec.parentNumber).normalized);
        const o = await upsertInstrumentFromRecord({
          orgId: watch.orgId,
          record: rec,
          match: out.matches.get(rec.sourceKey),
          runId,
          now: nowFn(),
          allowCreate: isHistoryCallUp,
          initialTriage: isHistoryCallUp ? "HISTORY" : undefined,
        });
        if (o.deferred) {
          deferred.push(rec);
          continue;
        }
        if (!o.instrumentId) continue;
        touched.add(o.instrumentId);
        if (o.created && isHistoryCallUp) counters.historyRecords++;
        if (o.evidenceCreated) counters.newEvidence++;
        if (o.evidenceChanged) {
          counters.changedEvidence++;
          result.updatedEvidence++;
          if (!counters.changedInstrumentIds.includes(o.instrumentId)) counters.changedInstrumentIds.push(o.instrumentId);
        }
      }
      const ranked = deferred
        .map((rec) => {
          const m = out.matches.get(rec.sourceKey) ?? matchKeywords({ texts: [rec.title] }, config.filters);
          const p = computePriority(
            { productHits: m.productHits, serviceHits: m.serviceHits, categoryHits: m.categoryHits, callUpCount: 0, hasPredecessor: false, atiSummaryCount: 0, confirmedLineItemCount: 0, currentExpiryAt: null, closingAt: rec.closingAt, recordsHolderKnown: false },
            ctx.now,
          );
          return { rec, score: p.score };
        })
        .sort((a, b) => b.score - a.score || (b.rec.publishedAt ?? "").localeCompare(a.rec.publishedAt ?? ""));
      for (const { rec } of ranked) {
        if (counters.newCandidates >= config.limits.maxNewCandidates) {
          counters.deferredCandidates++;
          result.truncated = true;
          continue;
        }
        const o = await upsertInstrumentFromRecord({ orgId: watch.orgId, record: rec, match: out.matches.get(rec.sourceKey), runId, now: nowFn(), allowCreate: true });
        if (!o.instrumentId) continue;
        touched.add(o.instrumentId);
        if (o.created) {
          counters.newCandidates++;
          result.newCandidates++;
          counters.newInstrumentIds.push(o.instrumentId);
        }
        if (o.flaggedForReview) counters.flaggedForReview++;
        if (o.evidenceCreated) counters.newEvidence++;
      }
      if (counters.deferredCandidates > 0) {
        result.note = [result.note, `新候选超过每轮上限 ${config.limits.maxNewCandidates}，${counters.deferredCandidates} 个待下轮继续`].filter(Boolean).join("；");
      }

      // —— 既有披露摘要 ——
      for (const s of out.atiSummaries) {
        const linked = known.some((k) => (s.summaryEn.toUpperCase().replace(/[\s\-_./#]+/g, "").includes(k.normalizedNumber) && k.normalizedNumber.length >= 6));
        const relevant = linked || matchKeywords({ texts: [s.summaryEn] }, config.filters).matched;
        if (!relevant) continue;
        const ev = await recordAtiSummary({ orgId: watch.orgId, summary: s, known, runId, now: nowFn() });
        if (ev.created) {
          counters.newEvidence++;
          result.updatedEvidence++;
        }
      }

      // —— 合同历史页快照 ——
      for (const snap of out.pageSnapshots) {
        const ev = await recordPageSnapshot({ orgId: watch.orgId, snapshot: snap, runId, now: nowFn() });
        if (!ev) continue;
        touched.add(snap.instrumentId);
        if (ev.created) counters.newEvidence++;
        if (ev.changed) {
          counters.changedEvidence++;
          result.updatedEvidence++;
          if (!counters.changedInstrumentIds.includes(snap.instrumentId)) counters.changedInstrumentIds.push(snap.instrumentId);
        }
      }

      result.finishedAt = nowFn().toISOString();
      results.push(result);
      progress.completedSources.push(source);
      progress.step = `source:${source}`;
      if (!(await persist({ progressJson: json(progress), sourceResultsJson: json(results), countersJson: json(counters), truncated: results.some((r) => r.truncated) }))) {
        return { status: "lease_lost", at: source };
      }
      if (deps.afterSource) await deps.afterSource(source);
    }

    // —— 排序 ——
    for (const id of [...touched].slice(0, 300)) await recomputePriority(id, nowFn());

    // —— 自动草拟申请卡（已关注、尚无自动卡的合同；每轮上限） ——
    const createAutoDraft = deps.createAutoDraft ?? (await import("./requests")).createAutoDraftForInstrument;
    const actor = watch.enabledById ?? run.requestedById ?? watch.createdById;
    if (config.limits.maxNewDraftCards > counters.newDrafts) {
      const existingKeys = new Set(
        (await db.recordsRequest.findMany({ where: { orgId: watch.orgId, autoDraftKey: { not: null } }, select: { autoDraftKey: true } })).map((r) => r.autoDraftKey),
      );
      const targets = await db.procurementInstrument.findMany({
        where: { orgId: watch.orgId, triageStatus: "WATCHING", instrumentClass: "AWARD_INSTRUMENT" },
        orderBy: [{ currentExpiryAt: "asc" }, { createdAt: "asc" }],
        select: { id: true },
        take: 50,
      });
      for (const t of targets) {
        if (counters.newDrafts >= config.limits.maxNewDraftCards) break;
        if (existingKeys.has(`auto:${t.id}`)) continue;
        const d = await createAutoDraft({ orgId: watch.orgId, instrumentId: t.id, actorUserId: actor, runId });
        if (d.created && d.requestId) {
          counters.newDrafts++;
          counters.newDraftIds.push(d.requestId);
        }
      }
    }

    // —— 收尾 ——
    const runStatus = aggregateRunStatus(results);
    const finishedAt = nowFn();
    const ok = await db.procurementScanRun.updateMany({
      where: { id: runId, runnerToken: token },
      data: {
        status: runStatus,
        finishedAt,
        runnerToken: null,
        heartbeatAt: finishedAt,
        progressJson: json({ ...progress, step: "finished" }),
        sourceResultsJson: json(results),
        countersJson: json(counters),
        truncated: results.some((r) => r.truncated) || counters.deferredCandidates > 0,
      },
    });
    if (ok.count !== 1) return { status: "lease_lost", at: "finalize" };
    await db.procurementWatch.update({
      where: { id: watch.id },
      data: {
        lastRunAt: finishedAt,
        lastRunStatus: runStatus,
        ...(runStatus === "SUCCEEDED" ? { lastSuccessAt: finishedAt } : {}),
        nextRunAt: watch.enabled ? (nextSlot(finishedAt, config.schedule, config.timezone)?.slotAt ?? null) : null,
      },
    });
    await notifyRunChanges({ watch, runId, counters, results });
    return { status: "finished", runStatus, counters, results };
  } catch (e) {
    await db.procurementScanRun.updateMany({
      where: { id: runId, runnerToken: token },
      data: { status: "FAILED", finishedAt: nowFn(), runnerToken: null, error: e instanceof Error ? e.message.slice(0, 300) : "unknown", sourceResultsJson: json(results), countersJson: json(counters) },
    });
    await db.procurementWatch.update({ where: { id: watch.id }, data: { lastRunAt: nowFn(), lastRunStatus: "FAILED" } }).catch(() => undefined);
    throw e;
  }
}

/** 实质变化才通知；sourceKey 由变化集合哈希决定（同样的变化不重复通知） */
async function notifyRunChanges(input: {
  watch: { id: string; orgId: string; name: string; enabledById: string | null; createdById: string };
  runId: string;
  counters: RunCounters;
  results: SourceResult[];
}) {
  const c = input.counters;
  const changeSet = {
    newInstruments: [...c.newInstrumentIds].sort(),
    changedInstruments: [...c.changedInstrumentIds].sort(),
    newDrafts: [...c.newDraftIds].sort(),
  };
  if (!changeSet.newInstruments.length && !changeSet.changedInstruments.length && !changeSet.newDrafts.length) return;
  const digest = stableHash(changeSet).slice(0, 16);
  const ok = input.results.filter((r) => r.status === "SUCCESS").length;
  const bad = input.results.filter((r) => r.status === "UNAVAILABLE" || r.status === "PARSE_FAILED").length;
  const recipients = [...new Set([input.watch.enabledById, input.watch.createdById].filter((x): x is string => !!x))];
  for (const userId of recipients) {
    await createNotification({
      userId,
      orgId: input.watch.orgId,
      type: "project_update",
      category: "procurement_watch",
      priority: changeSet.newDrafts.length || changeSet.newInstruments.length ? "high" : "medium",
      title: "采购监控有新变化",
      summary: `「${input.watch.name.slice(0, 30)}」新候选 ${changeSet.newInstruments.length} 个、证据变化 ${changeSet.changedInstruments.length} 处、新申请卡草稿 ${changeSet.newDrafts.length} 张；来源成功 ${ok} 个${bad ? `、失败 ${bad} 个（部分覆盖）` : ""}。`,
      entityType: "procurement_scan_run",
      entityId: input.runId,
      sourceKey: `procurement-scan:${input.watch.id}:${userId}:${digest}`,
      metadata: { watchId: input.watch.id, runId: input.runId },
    });
  }
}

/** cron 步骤：建到期运行 → 处理排队 / 失联运行（按截止时间） */
export async function processProcurementScans(deps: ScanDeps = {}): Promise<{
  skipped?: "SCHEMA_NOT_READY";
  scheduledCreated: number;
  processed: number;
  finished: number;
  yielded: number;
  failed: number;
}> {
  if (!isProcurementSchemaReady()) return { skipped: "SCHEMA_NOT_READY", scheduledCreated: 0, processed: 0, finished: 0, yielded: 0, failed: 0 };
  const now = (deps.now ?? (() => new Date()))();
  const deadline = deps.deadline ?? new Date(now.getTime() + DEFAULT_STEP_BUDGET_MS);
  const { created } = await ensureScheduledRuns(now);
  const candidates = await db.procurementScanRun.findMany({
    where: {
      OR: [
        { status: "QUEUED", trigger: "SCHEDULED" },
        { status: "QUEUED", trigger: "MANUAL", queuedAt: { lt: new Date(now.getTime() - MANUAL_PICKUP_DELAY_MS) } },
        { status: "RUNNING", heartbeatAt: { lt: new Date(now.getTime() - HEARTBEAT_STALE_MS) } },
      ],
    },
    orderBy: { queuedAt: "asc" },
    select: { id: true },
    take: 10,
  });
  let finished = 0;
  let yielded = 0;
  let failed = 0;
  let processed = 0;
  for (const c of candidates) {
    if (Date.now() > deadline.getTime() - 5_000) break;
    processed++;
    try {
      const out = await executeScanRun(c.id, { ...deps, deadline });
      if (out.status === "finished") finished++;
      else if (out.status === "yielded") yielded++;
    } catch (e) {
      failed++;
      console.error("[procurement-watch] run failed", c.id, e instanceof Error ? e.message : e);
    }
  }
  return { scheduledCreated: created, processed, finished, yielded, failed };
}
