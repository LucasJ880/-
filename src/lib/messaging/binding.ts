/**
 * 微信绑定管理
 *
 * 管理微信用户 ID ↔ 青砚用户的映射关系。
 */

import { resolveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { db } from "@/lib/db";
import { isPrismaUniqueViolation } from "@/lib/bid-workflow/prisma-errors";
import type { ChannelType, BindingInfo, FilterMode } from "./types";
import { ROLE_DEFAULT_DOMAINS } from "./types";
import { bindCodeKeyFromEnv, decideBindingClaim, verifyBindCode } from "./binding-proof";

export type CreateBindingResult =
  | { ok: true; binding: BindingInfo; outcome: "created" | "refreshed" | "reclaimed" }
  | {
      ok: false;
      /**
       * code_unavailable：服务端没有派生验证码的密钥（fail-closed）
       * invalid_code：验证码缺失 / 错误 / 过期
       * owned_by_other_user：该外部账号仍绑定在其他青砚用户名下（绝不迁移）
       */
      reason: "code_unavailable" | "invalid_code" | "owned_by_other_user";
    };

function roleDefaults(role: string | null | undefined) {
  const r = role ?? "user";
  const isSalesRole = r === "sales" || r === "admin" || r === "super_admin";
  const isTradeRole = r === "trade" || r === "admin" || r === "super_admin";
  return {
    pushDomains: ROLE_DEFAULT_DOMAINS[r] ?? "project",
    pushBriefing: isTradeRole,
    pushFollowup: isTradeRole,
    pushReport: isTradeRole,
    pushSales: isSalesRole,
  };
}

/**
 * 用户自助绑定微信 / 企微账号。
 *
 * 必须带机器人下发给该外部账号的验证码（见 binding-proof.ts）；验证码通过后：
 * - 没有这条绑定 → 新建；
 * - 本人的绑定 → 重新激活 / 更新昵称（不改归属）；
 * - 别人仍在用（active）→ 拒绝，绝不迁移；
 * - 别人已解绑 → 交给当前用户，orgId / 推送偏好 / 过滤 / 静默时段全部按新用户重置
 *   （条件写，谓词带读到的 userId + status，并发下不会抢走刚被重新激活的绑定）。
 */
export async function createBinding(params: {
  userId: string;
  orgId?: string;
  channel: ChannelType;
  externalId: string;
  /** 机器人通过该渠道发给这个外部账号的验证码 */
  bindCode: unknown;
  displayName?: string;
  avatarUrl?: string;
  now?: Date;
  /** 测试注入；默认由 JWT_SECRET 派生 */
  bindCodeKey?: Buffer | null;
}): Promise<CreateBindingResult> {
  const now = params.now ?? new Date();
  const key = params.bindCodeKey !== undefined ? params.bindCodeKey : bindCodeKeyFromEnv();
  if (!key) return { ok: false, reason: "code_unavailable" };
  // 先验证码、后查归属：没有验证码的人无法借此探测某个外部账号是否已被绑定
  if (!verifyBindCode(key, params.channel, params.externalId, params.bindCode, now)) {
    return { ok: false, reason: "invalid_code" };
  }

  // 查询用户角色，自动设置推送域
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { role: true },
  });
  // PERM-4c5：岗位模式企业按岗位派生平台角色决定默认推送（压扁后销售仍默认推销售消息）
  const defaults = roleDefaults(
    await resolveEffectivePlatformRole({ userId: params.userId, orgId: params.orgId, platformRole: user?.role }),
  );

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db.weChatBinding.findUnique({
      where: { channel_externalId: { channel: params.channel, externalId: params.externalId } },
      select: { id: true, userId: true, status: true },
    });
    const decision = decideBindingClaim(existing, params.userId);

    if (decision === "conflict") return { ok: false, reason: "owned_by_other_user" };

    if (decision === "create") {
      try {
        const created = await db.weChatBinding.create({
          data: {
            userId: params.userId,
            orgId: params.orgId,
            channel: params.channel,
            externalId: params.externalId,
            displayName: params.displayName,
            avatarUrl: params.avatarUrl,
            status: "active",
            lastActiveAt: now,
            ...defaults,
          },
        });
        return { ok: true, binding: toBindingInfo(created), outcome: "created" };
      } catch (e) {
        // 并发：同一 (channel, externalId) 刚被别处建好 → 重新判定一次
        if (isPrismaUniqueViolation(e)) continue;
        throw e;
      }
    }

    if (decision === "refresh_own" && existing) {
      const r = await db.weChatBinding.updateMany({
        where: { id: existing.id, userId: params.userId },
        data: {
          displayName: params.displayName,
          avatarUrl: params.avatarUrl,
          status: "active",
          lastActiveAt: now,
        },
      });
      if (r.count !== 1) continue;
    }

    if (decision === "reclaim_released" && existing) {
      const r = await db.weChatBinding.updateMany({
        where: { id: existing.id, userId: existing.userId, status: existing.status },
        data: {
          userId: params.userId,
          orgId: params.orgId ?? null,
          displayName: params.displayName ?? null,
          avatarUrl: params.avatarUrl ?? null,
          status: "active",
          lastActiveAt: now,
          ...defaults,
          silentStart: null,
          silentEnd: null,
          filterMode: "all",
          filterKeyword: null,
        },
      });
      if (r.count !== 1) continue;
    }

    const row = await db.weChatBinding.findUnique({ where: { id: existing!.id } });
    if (!row || row.userId !== params.userId) continue;
    return {
      ok: true,
      binding: toBindingInfo(row),
      outcome: decision === "reclaim_released" ? "reclaimed" : "refreshed",
    };
  }
  // 两次都在并发里落败：按「已被占用」处理，不做任何修改
  return { ok: false, reason: "owned_by_other_user" };
}

export async function findBindingByExternal(
  channel: ChannelType,
  externalId: string,
): Promise<BindingInfo | null> {
  const binding = await db.weChatBinding.findUnique({
    where: { channel_externalId: { channel, externalId } },
  });
  return binding ? toBindingInfo(binding) : null;
}

export async function findBindingsByUser(userId: string): Promise<BindingInfo[]> {
  const bindings = await db.weChatBinding.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return bindings.map(toBindingInfo);
}

export interface BindingPreferences {
  pushBriefing?: boolean;
  pushFollowup?: boolean;
  pushReport?: boolean;
  pushSales?: boolean;
  pushDomains?: string;
  silentStart?: string | null;
  silentEnd?: string | null;
  filterMode?: FilterMode;
  filterKeyword?: string | null;
}

const BOOLEAN_PREFS = ["pushBriefing", "pushFollowup", "pushReport", "pushSales"] as const;
const PUSH_DOMAINS = ["trade", "sales", "project", "all"];
const FILTER_MODES: FilterMode[] = ["all", "keyword", "whitelist"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 纯函数：从请求体里只挑出允许用户自己改的偏好字段（白名单 + 类型校验）。
 * userId / orgId / status / externalId 等字段一律丢弃，防止借偏好接口改绑定归属。
 */
export function sanitizeBindingPreferences(raw: unknown): BindingPreferences {
  const out: BindingPreferences = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const key of BOOLEAN_PREFS) {
    if (typeof r[key] === "boolean") out[key] = r[key] as boolean;
  }
  if (typeof r.pushDomains === "string") {
    const domains = [...new Set(r.pushDomains.split(",").map((d) => d.trim()).filter((d) => PUSH_DOMAINS.includes(d)))];
    if (domains.length) out.pushDomains = domains.join(",");
  }
  for (const key of ["silentStart", "silentEnd"] as const) {
    const v = r[key];
    if (v === null || v === "") out[key] = null;
    else if (typeof v === "string" && HHMM.test(v.trim())) out[key] = v.trim();
  }
  if (typeof r.filterMode === "string" && (FILTER_MODES as string[]).includes(r.filterMode)) out.filterMode = r.filterMode as FilterMode;
  if (r.filterKeyword === null) out.filterKeyword = null;
  else if (typeof r.filterKeyword === "string") out.filterKeyword = r.filterKeyword.trim().slice(0, 200);
  return out;
}

/**
 * 只改本人的绑定：where 同时带 id 与 userId，不是本人的绑定一行都不会改（不先查后改，无竞态）。
 * @returns 是否命中本人的绑定
 */
export async function updateBindingPreferences(userId: string, bindingId: string, prefs: BindingPreferences): Promise<boolean> {
  const r = await db.weChatBinding.updateMany({
    where: { id: bindingId, userId },
    data: prefs,
  });
  return r.count > 0;
}

/** 只解绑本人的绑定（同上） */
export async function removeBinding(userId: string, bindingId: string): Promise<boolean> {
  const r = await db.weChatBinding.updateMany({
    where: { id: bindingId, userId },
    data: { status: "disconnected" },
  });
  return r.count > 0;
}

export async function touchBinding(channel: ChannelType, externalId: string): Promise<void> {
  await db.weChatBinding.updateMany({
    where: { channel, externalId },
    data: { lastActiveAt: new Date() },
  });
}

/**
 * 解析绑定对应的业务组织：绑定上的 orgId → 用户 activeOrg / 唯一所属组织。
 * 平台级企微进线时绑定可能未写 orgId，必须在此补齐。
 */
export async function resolveBindingOrgId(
  binding: Pick<BindingInfo, "id" | "userId" | "orgId">,
): Promise<string | null> {
  const { PLATFORM_WECOM_ORG_ID } = await import("./platform-wecom");
  if (binding.orgId && binding.orgId !== PLATFORM_WECOM_ORG_ID) {
    return binding.orgId;
  }

  const user = await db.user.findUnique({
    where: { id: binding.userId },
    select: { role: true },
  });
  const { resolvePreferredOrgId } = await import("@/lib/organizations/active-org");
  const { orgId } = await resolvePreferredOrgId(
    binding.userId,
    user?.role ?? "user",
  );
  if (!orgId) return null;

  if (orgId !== binding.orgId) {
    await db.weChatBinding
      .update({ where: { id: binding.id }, data: { orgId } })
      .catch(() => {});
  }
  return orgId;
}

function toBindingInfo(row: {
  id: string;
  userId: string;
  orgId: string | null;
  channel: string;
  externalId: string;
  displayName: string | null;
  status: string;
  pushBriefing: boolean;
  pushFollowup: boolean;
  pushReport: boolean;
  pushSales: boolean;
  pushDomains: string;
  filterMode: string;
  filterKeyword: string | null;
}): BindingInfo {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    channel: row.channel as ChannelType,
    externalId: row.externalId,
    displayName: row.displayName,
    status: row.status,
    pushBriefing: row.pushBriefing,
    pushFollowup: row.pushFollowup,
    pushReport: row.pushReport,
    pushSales: row.pushSales,
    pushDomains: row.pushDomains,
    filterMode: row.filterMode as FilterMode,
    filterKeyword: row.filterKeyword,
  };
}
