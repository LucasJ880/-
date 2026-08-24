/**
 * Mention Gateway M2-A — Provider Tenant Ownership Gate（P0）
 *
 * ExternalIdentity 置 ACTIVE 之前，必须证明 providerTenantId 属于目标 org 的
 * 可信 installation / gateway（PROVIDER_TENANT_OWNERSHIP_GATE_REQUIRED，
 * M2 Architecture §24.1）。API body 的任何「归属声明」都不可信。
 *
 * 可信事实源（当前仓库）：
 * - personal_wechat：providerTenantId = WeChatGateway.id（要求 channel/orgId/status 全部匹配）
 * - wecom：providerTenantId = CorpID → 目标 org 的 org 级 WeChatGateway.corpId；
 *   平台共享网关（PLATFORM_WECOM_ORG_ID）**没有**可信的 platform-gateway → org 映射
 *   （运行期是 WeChatBinding → 用户 activeOrg 解析，属用户级不属租户级）→ UNPROVEN，不得猜
 * - mock：providerTenantId 恒 "mock"；生产运行时 NEVER OWNED（仅 test/dev/preview 非生产）
 * - slack：M2-A 无 ChannelProviderInstallation → UNSUPPORTED，不得 ACTIVE（M3 开放）
 */

import { PLATFORM_WECOM_ORG_ID } from "@/lib/messaging/platform-wecom";
import {
  isMentionMockRuntimeAllowedWithEnv,
  type MentionGatewayFlagEnv,
} from "./flags";
import type { ExternalIdentityProvider } from "./types";

export type ProviderTenantOwnership =
  | "OWNED"
  | "UNPROVEN"
  | "MISMATCH"
  | "INACTIVE"
  | "AMBIGUOUS"
  | "UNSUPPORTED";

export interface ProviderGatewayRecord {
  id: string;
  orgId: string;
  channel: string;
  corpId: string | null;
  status: string;
}

export interface OwnershipDeps {
  env: MentionGatewayFlagEnv;
  findGatewayById(id: string): Promise<ProviderGatewayRecord | null>;
  findWecomGatewaysByCorpId(corpId: string): Promise<ProviderGatewayRecord[]>;
}

export function createDefaultOwnershipDeps(
  env: MentionGatewayFlagEnv = process.env,
): OwnershipDeps {
  return {
    env,
    async findGatewayById(id) {
      const { db } = await import("@/lib/db");
      return db.weChatGateway.findUnique({
        where: { id },
        select: { id: true, orgId: true, channel: true, corpId: true, status: true },
      });
    },
    async findWecomGatewaysByCorpId(corpId) {
      const { db } = await import("@/lib/db");
      return db.weChatGateway.findMany({
        where: { channel: "wecom", corpId },
        select: { id: true, orgId: true, channel: true, corpId: true, status: true },
      });
    },
  };
}

export interface ResolveProviderTenantOwnershipInput {
  provider: ExternalIdentityProvider | string;
  providerTenantId: string;
  targetOrgId: string;
}

/**
 * 服务端 canonical 归属判定。任何 ACTIVE transition（provision / verify / relink / enable）
 * 前都必须重新调用；结果不缓存跨请求。
 */
export async function resolveProviderTenantOwnership(
  input: ResolveProviderTenantOwnershipInput,
  deps: OwnershipDeps = createDefaultOwnershipDeps(),
): Promise<ProviderTenantOwnership> {
  const provider = (input.provider ?? "").trim();
  const tenantId = (input.providerTenantId ?? "").trim();
  const targetOrgId = (input.targetOrgId ?? "").trim();
  if (!provider || !tenantId || !targetOrgId) return "UNPROVEN";

  switch (provider) {
    case "mock": {
      if (tenantId !== "mock") return "MISMATCH";
      // 生产运行时（含运行环境声明冲突）永不 OWNED —— mock 仅限非生产
      if (!isMentionMockRuntimeAllowedWithEnv(deps.env)) return "UNSUPPORTED";
      return "OWNED";
    }
    case "personal_wechat": {
      const gateway = await deps.findGatewayById(tenantId);
      if (!gateway) return "UNPROVEN";
      if (gateway.channel !== "personal_wechat") return "UNPROVEN";
      if (gateway.orgId !== targetOrgId) return "MISMATCH";
      if (gateway.status !== "active") return "INACTIVE";
      return "OWNED";
    }
    case "wecom": {
      const gateways = await deps.findWecomGatewaysByCorpId(tenantId);
      // 先算真实 org 集合（平台共享网关不是 real org，但也不能掩盖 real-org 歧义）
      const realOrgIds = [
        ...new Set(
          gateways
            .filter((g) => g.orgId !== PLATFORM_WECOM_ORG_ID)
            .map((g) => g.orgId),
        ),
      ];
      // 0 个真实 org（含仅平台共享网关命中）：无可信 platform-gateway → org 映射 → 不得猜
      if (realOrgIds.length === 0) return "UNPROVEN";
      // 同一 CorpID 出现在多个真实 org：归属不可判定，任何 org 都不得 OWNED
      if (realOrgIds.length > 1) return "AMBIGUOUS";
      if (realOrgIds[0] !== targetOrgId) return "MISMATCH";
      const targetOrgGateway = gateways.find((g) => g.orgId === targetOrgId);
      return targetOrgGateway?.status === "active" ? "OWNED" : "INACTIVE";
    }
    case "slack":
      // M2-A 无 ChannelProviderInstallation；M3 安装模型完成后开放
      return "UNSUPPORTED";
    default:
      return "UNSUPPORTED";
  }
}
