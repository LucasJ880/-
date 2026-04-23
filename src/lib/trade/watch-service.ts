/**
 * P1-alpha / P1-beta：Watch target CRUD + baseline + 检查 + 冷却去重 + re-baseline
 * 不写入 researchReport，不与 P0 bundle 耦合。
 */

import { db } from "@/lib/db";
import { fetchPageContent } from "@/lib/trade/tools";
import { hashPageText, normalizePageText } from "@/lib/trade/watch-text";
import {
  isWatchPageType,
  signalDescriptionForPageType,
  signalTitleForPageType,
} from "@/lib/trade/signal-copy";
import { logActivity } from "@/lib/trade/activity-log";

const MAX_TARGETS_PER_ORG = 10;
export const WATCH_CRON_BATCH_SIZE = 50;

/** P1-beta：同 watchTarget + signalType 在 24h 内不重复创建 TradeSignal（单一规则） */
const SIGNAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function validateHttpUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function listWatchTargets(orgId: string, prospectId: string) {
  return db.tradeWatchTarget.findMany({
    where: { orgId, prospectId },
    orderBy: { createdAt: "desc" },
  });
}

/** 线索下最近 signals（兼容 P1-alpha 调用） */
export async function listSignals(orgId: string, prospectId: string, limit = 20) {
  return listSignalsForOrg(orgId, { prospectId, limit });
}

export type ListSignalsForOrgOpts = {
  prospectId?: string;
  pageType?: string;
  limit?: number;
};

/**
 * org 级列表：可选按 prospect、pageType（关联 watchTarget）过滤。
 */
export async function listSignalsForOrg(orgId: string, opts: ListSignalsForOrgOpts = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const signals = await db.tradeSignal.findMany({
    where: {
      orgId,
      ...(opts.prospectId ? { prospectId: opts.prospectId } : {}),
      ...(opts.pageType
        ? { watchTarget: { pageType: opts.pageType } }
        : {}),
    },
    include: {
      watchTarget: { select: { url: true, pageType: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const prospectIds = [
    ...new Set(signals.map((s) => s.prospectId).filter((x): x is string => Boolean(x))),
  ];
  if (prospectIds.length === 0) {
    return signals.map((s) => ({ ...s, prospectCompanyName: null as string | null }));
  }
  const prospects = await db.tradeProspect.findMany({
    where: { id: { in: prospectIds } },
    select: { id: true, companyName: true },
  });
  const nameById = Object.fromEntries(prospects.map((p) => [p.id, p.companyName]));
  return signals.map((s) => ({
    ...s,
    prospectCompanyName: s.prospectId ? (nameById[s.prospectId] ?? null) : null,
  }));
}

export async function createWatchTarget(input: {
  orgId: string;
  prospectId: string;
  url: string;
  pageType: string;
  createdById?: string | null;
}) {
  const { orgId, prospectId, url, pageType, createdById } = input;
  const trimmed = url.trim();
  if (!validateHttpUrl(trimmed)) {
    throw new Error("url 须为 http(s) 合法地址");
  }
  if (!isWatchPageType(pageType)) {
    throw new Error(`pageType 须为: ${["products", "collections", "news", "blog", "about", "careers", "custom"].join(", ")}`);
  }

  const prospect = await db.tradeProspect.findFirst({
    where: { id: prospectId, orgId },
    select: { id: true },
  });
  if (!prospect) {
    throw new Error("线索不存在或不属于该 org");
  }

  const count = await db.tradeWatchTarget.count({ where: { orgId } });
  if (count >= MAX_TARGETS_PER_ORG) {
    throw new Error(`每个组织最多 ${MAX_TARGETS_PER_ORG} 条监控 URL`);
  }

  const row = await db.tradeWatchTarget.create({
    data: {
      orgId,
      prospectId,
      url: trimmed,
      pageType,
      createdById: createdById ?? null,
    },
  });

  await runBaselineForTarget(row.id);
  return db.tradeWatchTarget.findUnique({ where: { id: row.id } });
}

/**
 * 创建后首次：写入 lastContentHash + lastCheckedAt，不产生 TradeSignal。
 */
export async function runBaselineForTarget(targetId: string): Promise<void> {
  const target = await db.tradeWatchTarget.findUnique({ where: { id: targetId } });
  if (!target) return;

  const page = await fetchPageContent(target.url);
  const now = new Date();

  if (!page.ok || !page.text) {
    await db.tradeWatchTarget.update({
      where: { id: targetId },
      data: {
        lastCheckedAt: now,
        lastFetchError: "抓取失败或空内容",
      },
    });
    return;
  }

  const normalized = normalizePageText(page.text);
  const hash = hashPageText(normalized);

  await db.tradeWatchTarget.update({
    where: { id: targetId },
    data: {
      lastContentHash: hash,
      lastCheckedAt: now,
      lastFetchError: null,
    },
  });
}

/**
 * P1-beta：手动重建基线。只更新 hash / lastCheckedAt / 清错，**不改 lastChangedAt**，不产生 signal。
 */
export async function runRebaselineForTarget(targetId: string): Promise<{ ok: boolean; message?: string }> {
  const target = await db.tradeWatchTarget.findUnique({ where: { id: targetId } });
  if (!target) return { ok: false, message: "目标不存在" };

  const page = await fetchPageContent(target.url);
  const now = new Date();

  if (!page.ok || !page.text) {
    await db.tradeWatchTarget.update({
      where: { id: targetId },
      data: {
        lastCheckedAt: now,
        lastFetchError: "抓取失败或空内容",
      },
    });
    return { ok: false, message: "抓取失败或空内容" };
  }

  const hash = hashPageText(normalizePageText(page.text));
  await db.tradeWatchTarget.update({
    where: { id: targetId },
    data: {
      lastContentHash: hash,
      lastCheckedAt: now,
      lastFetchError: null,
    },
  });

  if (target.prospectId) {
    const p = await db.tradeProspect.findUnique({
      where: { id: target.prospectId },
      select: { campaignId: true },
    });
    await logActivity({
      orgId: target.orgId,
      campaignId: p?.campaignId ?? undefined,
      prospectId: target.prospectId,
      action: "watch_rebaseline",
      detail: "页面监控：已重置基线（当前页面为新的对比快照）",
      meta: { watchTargetId: target.id, url: target.url },
    });
  }

  return { ok: true };
}

export type WatchCheckResult =
  | { kind: "fetch_error"; message: string }
  | { kind: "baseline_set" }
  | { kind: "no_change" }
  | { kind: "changed"; signalId: string }
  | { kind: "changed_suppressed" };

/**
 * 手动检查或 cron：若已有 hash 且变化则写 TradeSignal（strength 恒 low），24h 内同 target 同 type 冷却去重。
 */
export async function runCheckForTarget(targetId: string): Promise<WatchCheckResult> {
  const target = await db.tradeWatchTarget.findUnique({ where: { id: targetId } });
  if (!target) {
    return { kind: "fetch_error", message: "目标不存在" };
  }
  if (!target.isActive) {
    return { kind: "no_change" };
  }

  const page = await fetchPageContent(target.url);
  const now = new Date();

  if (!page.ok || !page.text) {
    await db.tradeWatchTarget.update({
      where: { id: targetId },
      data: {
        lastCheckedAt: now,
        lastFetchError: "抓取失败或空内容",
      },
    });
    return { kind: "fetch_error", message: "抓取失败或空内容" };
  }

  const normalized = normalizePageText(page.text);
  const newHash = hashPageText(normalized);
  const prevHash = target.lastContentHash;

  if (prevHash === null || prevHash === undefined) {
    await db.tradeWatchTarget.update({
      where: { id: targetId },
      data: {
        lastContentHash: newHash,
        lastCheckedAt: now,
        lastFetchError: null,
      },
    });
    return { kind: "baseline_set" };
  }

  if (newHash === prevHash) {
    await db.tradeWatchTarget.update({
      where: { id: targetId },
      data: {
        lastCheckedAt: now,
        lastFetchError: null,
      },
    });
    return { kind: "no_change" };
  }

  const cooldownSince = new Date(now.getTime() - SIGNAL_COOLDOWN_MS);
  const recentSignal = await db.tradeSignal.findFirst({
    where: {
      watchTargetId: target.id,
      signalType: "page_text_changed",
      createdAt: { gte: cooldownSince },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentSignal) {
    await db.tradeWatchTarget.update({
      where: { id: targetId },
      data: {
        lastContentHash: newHash,
        lastCheckedAt: now,
        lastChangedAt: now,
        lastFetchError: null,
      },
    });
    return { kind: "changed_suppressed" };
  }

  const title = signalTitleForPageType(target.pageType);
  const description = signalDescriptionForPageType(target.pageType);
  const evidenceJson = {
    url: target.url,
    pageType: target.pageType,
    prevHash,
    newHash,
    checkedAt: now.toISOString(),
  };

  const signal = await db.tradeSignal.create({
    data: {
      orgId: target.orgId,
      watchTargetId: target.id,
      prospectId: target.prospectId,
      signalType: "page_text_changed",
      strength: "low",
      title,
      description,
      evidenceJson,
    },
  });

  await db.tradeWatchTarget.update({
    where: { id: targetId },
    data: {
      lastContentHash: newHash,
      lastCheckedAt: now,
      lastChangedAt: now,
      lastFetchError: null,
    },
  });

  if (target.prospectId) {
    const p = await db.tradeProspect.findUnique({
      where: { id: target.prospectId },
      select: { campaignId: true },
    });
    await logActivity({
      orgId: target.orgId,
      campaignId: p?.campaignId ?? undefined,
      prospectId: target.prospectId,
      action: "watch_change",
      detail: `页面监控：${target.pageType} · 文本已变化（弱信号）`,
      meta: {
        signalId: signal.id,
        watchTargetId: target.id,
        url: target.url,
        pageType: target.pageType,
      },
    });
  }

  return { kind: "changed", signalId: signal.id };
}

export async function setWatchTargetActive(
  orgId: string,
  targetId: string,
  isActive: boolean,
) {
  const t = await db.tradeWatchTarget.findFirst({
    where: { id: targetId, orgId },
  });
  if (!t) throw new Error("监控目标不存在");
  return db.tradeWatchTarget.update({
    where: { id: targetId },
    data: { isActive },
  });
}

export async function deleteWatchTarget(orgId: string, targetId: string) {
  const t = await db.tradeWatchTarget.findFirst({
    where: { id: targetId, orgId },
  });
  if (!t) throw new Error("监控目标不存在");
  await db.tradeWatchTarget.delete({ where: { id: targetId } });
}

export interface WatchCronSummary {
  checked: number;
  signalsCreated: number;
  signalsSuppressed: number;
  fetchErrors: number;
}

export async function runWatchTargetsCron(): Promise<WatchCronSummary> {
  const summary: WatchCronSummary = {
    checked: 0,
    signalsCreated: 0,
    signalsSuppressed: 0,
    fetchErrors: 0,
  };

  const targets = await db.tradeWatchTarget.findMany({
    where: { isActive: true },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: WATCH_CRON_BATCH_SIZE,
    select: { id: true },
  });

  for (const { id } of targets) {
    const r = await runCheckForTarget(id);
    summary.checked++;
    if (r.kind === "changed") summary.signalsCreated++;
    if (r.kind === "changed_suppressed") summary.signalsSuppressed++;
    if (r.kind === "fetch_error") summary.fetchErrors++;
  }

  return summary;
}
