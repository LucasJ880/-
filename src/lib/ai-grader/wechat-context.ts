/**
 * 微信 Grader 短期上下文记忆（TTL 30 分钟）
 *
 * 让用户能在连续对话中用「这个客户 / 这个项目 / 这个报价 / 他 / 刚刚那个」
 * 指代最近一次 Grader 解析到的目标对象。
 *
 * 设计约束：
 * - 仅存 id/name/type，不存正文（隐私 + 体积）
 * - 严格按 orgId + userId + channel 隔离，过期不使用
 * - 仅用于「解析意图」，不直接授权；Grader / executor 仍二次校验权限
 * - 写失败不影响主流程（best-effort）
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { WechatGraderContextState } from "./wechat-intent-classifier";

const TTL_MS = 30 * 60 * 1000;

export interface GraderContextKey {
  orgId: string | null;
  userId: string;
  channel: string;
}

/** 读取未过期的上下文；过期 / 不存在返回 null */
export async function readGraderContext(
  key: GraderContextKey,
): Promise<WechatGraderContextState | null> {
  if (!key.orgId || !key.userId) return null;
  try {
    const row = await db.weChatGraderContext.findUnique({
      where: {
        orgId_userId_channel: { orgId: key.orgId, userId: key.userId, channel: key.channel },
      },
      select: { contextData: true, expiresAt: true },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return (row.contextData as WechatGraderContextState) ?? null;
  } catch (e) {
    console.error("[GraderContext] read failed:", e);
    return null;
  }
}

/**
 * 合并写入上下文（与未过期的现有上下文合并），刷新 TTL。
 * patch 中为 undefined 的字段会被忽略（不覆盖已有值）。
 */
export async function writeGraderContext(
  key: GraderContextKey & { externalUserId?: string },
  patch: Partial<WechatGraderContextState>,
): Promise<void> {
  if (!key.orgId || !key.userId) return;
  try {
    const existing = await readGraderContext(key);
    const merged: WechatGraderContextState = { ...(existing ?? {}), ...clean(patch) };
    const expiresAt = new Date(Date.now() + TTL_MS);
    await db.weChatGraderContext.upsert({
      where: {
        orgId_userId_channel: { orgId: key.orgId, userId: key.userId, channel: key.channel },
      },
      create: {
        orgId: key.orgId,
        userId: key.userId,
        channel: key.channel,
        externalUserId: key.externalUserId,
        contextData: merged as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
      update: {
        contextData: merged as unknown as Prisma.InputJsonValue,
        expiresAt,
        externalUserId: key.externalUserId,
      },
    });
  } catch (e) {
    console.error("[GraderContext] write failed:", e);
  }
}

function clean(patch: Partial<WechatGraderContextState>): Partial<WechatGraderContextState> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out as Partial<WechatGraderContextState>;
}
