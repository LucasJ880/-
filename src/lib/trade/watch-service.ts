/**
 * P1-alpha：Watch target CRUD + baseline + 定时/手动检查
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

const MAX_TARGETS_PER_ORG = 10;
export const WATCH_CRON_BATCH_SIZE = 50;

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

export async function listSignals(orgId: string, prospectId: string, limit = 20) {
  return db.tradeSignal.findMany({
    where: { orgId, prospectId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });
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

export type WatchCheckResult =
  | { kind: "fetch_error"; message: string }
  | { kind: "baseline_set" }
  | { kind: "no_change" }
  | { kind: "changed"; signalId: string };

/**
 * 手动检查或 cron：若已有 hash 且变化则写 TradeSignal（strength 恒 low）。
 * 若尚无 hash（异常），按 baseline 处理且不写 signal。
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
  fetchErrors: number;
}

export async function runWatchTargetsCron(): Promise<WatchCronSummary> {
  const summary: WatchCronSummary = {
    checked: 0,
    signalsCreated: 0,
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
    if (r.kind === "fetch_error") summary.fetchErrors++;
  }

  return summary;
}
