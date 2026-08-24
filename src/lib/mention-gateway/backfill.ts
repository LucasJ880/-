/**
 * Mention Gateway M2-A — Legacy WeChatBinding → ExternalIdentity 回填的纯决策函数
 *
 * 冻结语义（NO BLIND UPSERT）：
 * - canonical providerTenantId 解析不出来 → 不写任何行（不用 "unknown"/"legacy"/orgId 顶替），只进 UNRESOLVED 报告
 * - 唯一键已被**其它用户**占用 → CONFLICT，不做任何修改（verified mapping 不可被 legacy 覆盖）
 * - 已存在同用户且方法更强（非 LEGACY_SELF_ASSERTED）→ 完整保留，绝不降级
 * - 已存在同用户 LEGACY → no-op 或仅安全单调状态收敛（ACTIVE/PENDING → REVOKED/DISABLED；绝不复活）
 *
 * 本文件不访问 DB；脚本 scripts/backfill-external-identity-from-wechat-binding.ts 负责 IO。
 */

import { PLATFORM_WECOM_ORG_ID } from "@/lib/messaging/platform-wecom";
import type { ProviderGatewayRecord } from "./provider-tenant-ownership";

export interface LegacyBindingSnapshot {
  id: string;
  channel: string;
  externalId: string;
  userId: string;
  orgId: string | null;
  status: string;
  createdAt: Date;
  lastActiveAt: Date | null;
}

export function gatewayMapKey(orgId: string, channel: string): string {
  return `${orgId}:${channel}`;
}

export type LegacyTenantResolution =
  | { ok: true; providerTenantId: string; gatewayStatus: string }
  | {
      ok: false;
      reason:
        | "no_org"
        | "no_gateway"
        | "no_corp_id"
        | "wecom_no_org_gateway"
        | "wecom_corp_ambiguous"
        | "unsupported_channel";
    };

/**
 * 预计算 CorpID → 拥有它的真实 org 集合（排除平台共享网关）。
 * B3：同一 CorpID 出现在 >1 个真实 org → canonical 归属不可判定，
 * 回填不得依据单条 binding.orgId 绕过歧义规则。
 */
export function buildCorpOrgIndex(
  gateways: readonly ProviderGatewayRecord[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const g of gateways) {
    if (g.channel !== "wecom" || g.orgId === PLATFORM_WECOM_ORG_ID) continue;
    const corpId = (g.corpId ?? "").trim();
    if (!corpId) continue;
    const set = index.get(corpId) ?? new Set<string>();
    set.add(g.orgId);
    index.set(corpId, set);
  }
  return index;
}

/**
 * canonical providerTenantId：
 * - personal_wechat：binding.orgId 的 personal_wechat 网关 → gateway.id
 * - wecom：binding.orgId 的 org 级 wecom 网关 → corpId；只有平台共享网关时无可信映射 → UNRESOLVED；
 *   CorpID 同时属于多个真实 org → UNRESOLVED(wecom_corp_ambiguous)，绝不写行
 */
export function resolveLegacyProviderTenant(
  binding: Pick<LegacyBindingSnapshot, "channel" | "orgId">,
  gatewayByOrgChannel: ReadonlyMap<string, ProviderGatewayRecord>,
  corpOrgIndex?: ReadonlyMap<string, ReadonlySet<string>>,
): LegacyTenantResolution {
  const orgId = (binding.orgId ?? "").trim();
  if (!orgId || orgId === PLATFORM_WECOM_ORG_ID) return { ok: false, reason: "no_org" };

  if (binding.channel === "personal_wechat") {
    const gateway = gatewayByOrgChannel.get(gatewayMapKey(orgId, "personal_wechat"));
    if (!gateway) return { ok: false, reason: "no_gateway" };
    return { ok: true, providerTenantId: gateway.id, gatewayStatus: gateway.status };
  }
  if (binding.channel === "wecom") {
    const gateway = gatewayByOrgChannel.get(gatewayMapKey(orgId, "wecom"));
    if (!gateway) return { ok: false, reason: "wecom_no_org_gateway" };
    const corpId = (gateway.corpId ?? "").trim();
    if (!corpId) return { ok: false, reason: "no_corp_id" };
    const owners = corpOrgIndex?.get(corpId);
    if (owners && owners.size > 1) {
      return { ok: false, reason: "wecom_corp_ambiguous" };
    }
    return { ok: true, providerTenantId: corpId, gatewayStatus: gateway.status };
  }
  return { ok: false, reason: "unsupported_channel" };
}

export type LegacyIdentityStatus = "ACTIVE" | "PENDING" | "REVOKED" | "DISABLED";

/**
 * §29 状态映射：
 * - User inactive → DISABLED
 * - binding disconnected / expired（及其它非 active）→ REVOKED
 * - binding active：gateway active（ownership proven）→ ACTIVE；否则 PENDING(gateway_inactive)
 */
export function mapLegacyIdentityStatus(input: {
  bindingStatus: string;
  userStatus: string;
  gatewayStatus: string;
}): { status: LegacyIdentityStatus; reason?: string } {
  if (input.userStatus !== "active") {
    return { status: "DISABLED", reason: "user_inactive" };
  }
  if (input.bindingStatus !== "active") {
    return { status: "REVOKED", reason: `legacy_binding_${input.bindingStatus}` };
  }
  if (input.gatewayStatus !== "active") {
    return { status: "PENDING", reason: "gateway_inactive" };
  }
  return { status: "ACTIVE" };
}

export type BackfillAction =
  | "CREATE"
  | "EXISTING_SAME"
  | "RECONCILE_STATUS"
  | "STRONGER_PRESERVED"
  | "CONFLICT";

export function decideBackfillAction(
  existing: {
    userId: string;
    status: string;
    verificationMethod: string | null;
  } | null,
  candidate: { userId: string; status: LegacyIdentityStatus },
): { action: BackfillAction; nextStatus?: LegacyIdentityStatus } {
  if (!existing) return { action: "CREATE" };
  if (existing.userId !== candidate.userId) return { action: "CONFLICT" };
  if (existing.verificationMethod !== "LEGACY_SELF_ASSERTED") {
    // 同用户但更强（或未知来源）方法 → 完整保留，绝不降级为 LEGACY
    return { action: "STRONGER_PRESERVED" };
  }
  if (existing.status === candidate.status) return { action: "EXISTING_SAME" };
  // 仅安全单调收敛：ACTIVE/PENDING → REVOKED/DISABLED；绝不把 REVOKED/DISABLED 复活
  const canReconcile =
    (existing.status === "ACTIVE" || existing.status === "PENDING") &&
    (candidate.status === "REVOKED" || candidate.status === "DISABLED");
  if (canReconcile) {
    return { action: "RECONCILE_STATUS", nextStatus: candidate.status };
  }
  return { action: "EXISTING_SAME" };
}
