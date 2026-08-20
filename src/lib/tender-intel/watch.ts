/**
 * 公告盯梢（Halifax 时效需求 2026-08-20）：对进行中标的公开机会页做定时
 * 变更检测（Addenda/Q&A 更新 → 站内通知）。
 *
 * 设计：room.summaryJson.tenderWatch = { url, lastHash, lastCheckedAt,
 * lastChangedAt, notifiedHashes? }——零 schema。检测=抓公开页 → 归一
 * （去 script/style/空白坍缩）→ sha256 对比。诚实语义：变化≠一定是 Addenda，
 * 通知文案说「关注页面有更新」并附链接由人核。
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";

export type TenderWatchState = {
  url: string;
  lastHash?: string | null;
  lastCheckedAt?: string | null;
  lastChangedAt?: string | null;
};

/** 归一 + 摘要（纯函数；剥脚本/样式/标签间空白，降动态噪声） */
export function computeWatchDigest(html: string): string {
  const normalized = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function isValidWatchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * 检查单个项目的盯梢（cron 与手动共用）。变化 → 更新 hash + 通知项目负责人
 * （sourceKey 按新 hash 幂等，重复 tick 不重复打扰）。任何失败绝不上抛。
 */
export async function checkTenderWatch(
  projectId: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<{ status: "no_watch" | "unchanged" | "changed" | "error"; note?: string }> {
  try {
    const room = await db.bidIntelligenceRoom.findUnique({
      where: { projectId },
      select: { id: true, summaryJson: true },
    });
    const sj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<
      string,
      unknown
    >;
    const watch = sj.tenderWatch as TenderWatchState | undefined;
    if (!room || !watch?.url || !isValidWatchUrl(watch.url)) {
      return { status: "no_watch" };
    }
    const doFetch = opts?.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let html: string;
    try {
      const res = await doFetch(watch.url, {
        signal: controller.signal,
        headers: { "user-agent": "qingyan-tender-watch/1.0" },
      });
      if (!res.ok) return { status: "error", note: `HTTP ${res.status}` };
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const digest = computeWatchDigest(html);
    const now = new Date().toISOString();
    const changed = Boolean(watch.lastHash && watch.lastHash !== digest);
    const next: TenderWatchState = {
      ...watch,
      lastHash: digest,
      lastCheckedAt: now,
      ...(changed ? { lastChangedAt: now } : {}),
    };
    await db.bidIntelligenceRoom.update({
      where: { id: room.id },
      data: {
        summaryJson: JSON.parse(JSON.stringify({ ...sj, tenderWatch: next })),
      },
    });
    if (changed) {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { name: true, orgId: true, ownerId: true },
      });
      if (project?.ownerId) {
        const { createNotification } = await import("@/lib/notifications/create");
        await createNotification({
          userId: project.ownerId,
          orgId: project.orgId ?? null,
          projectId,
          type: "project_update",
          category: "tender_watch",
          priority: "high",
          title: "关注的招标公告页面有更新",
          summary: `「${project.name.slice(0, 40)}」盯梢页面内容发生变化（可能是 Addenda 或 Q&A 回复）——请打开核对：${watch.url}`,
          entityType: "tender_watch",
          entityId: projectId,
          sourceKey: `tender-watch:${projectId}:${digest.slice(0, 16)}`,
          metadata: { url: watch.url },
        });
      }
      return { status: "changed" };
    }
    return { status: "unchanged" };
  } catch (e) {
    return {
      status: "error",
      note: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    };
  }
}

/** cron 扫描：所有配置了盯梢的房间（量级=活跃标数，个位数；JS 过滤足够） */
export async function sweepTenderWatches(): Promise<{
  checked: number;
  changed: number;
}> {
  const rooms = await db.bidIntelligenceRoom.findMany({
    where: { summaryJson: { not: undefined } },
    select: { projectId: true, summaryJson: true },
    take: 200,
  });
  let checked = 0;
  let changed = 0;
  for (const r of rooms) {
    const watch = ((r.summaryJson as Record<string, unknown>) ?? {})
      .tenderWatch as TenderWatchState | undefined;
    if (!watch?.url) continue;
    checked += 1;
    const out = await checkTenderWatch(r.projectId);
    if (out.status === "changed") changed += 1;
  }
  if (checked > 0) {
    console.log(`[tender-watch] checked=${checked} changed=${changed}`);
  }
  return { checked, changed };
}
