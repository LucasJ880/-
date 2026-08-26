/**
 * Mention Gateway M2-B — 持久化频道绑定 runtime 解析（DB 源；只读热路径）
 *
 * §32 优先级（B4）：
 *   ACTIVE exact thread binding > ACTIVE channel binding > 无绑定
 *   - thread 行 DISABLED / REVOKED → 视为不存在 → 可以 fallback channel
 *   - thread 行 ACTIVE 但校验失败（org / XOR / ownership）→ **FAIL CLOSED，绝不 fallback channel**
 *     （否则损坏/恶意的 thread override 会被 channel 绑定绕过）
 *
 * §33 ACTIVE 行校验：org == expectedOrgId、target XOR、ownership == OWNED
 * （INACTIVE/MISMATCH/UNPROVEN/AMBIGUOUS/UNSUPPORTED 的 ACTIVE 行不得用于 runtime）。
 *
 * §34 绑定只是业务对象 selector，不是授权：命中后仍必须走 resolveAgentScope。
 * 本模块零写（不更新 lastSeen / 不建行）；DB 异常向上抛，由 deps 层 fail-closed
 * 为 CONTEXT_UNRESOLVED（绝不 fallback fixture）。
 */

import {
  createDefaultOwnershipDeps,
  resolveProviderTenantOwnership,
  type OwnershipDeps,
} from "./provider-tenant-ownership";
import { bindingRowToContextType } from "./binding-service";
import type { ChannelContextBinding, MentionProvider } from "./types";

export type PersistentBindingLookupResult =
  | { status: "found"; binding: ChannelContextBinding }
  | { status: "none" }
  | {
      status: "fail_closed";
      /** 仅内部日志；对外统一 CONTEXT_UNRESOLVED */
      reason:
        | "binding_org_mismatch"
        | "binding_target_invalid"
        | "binding_ownership_invalid";
    };

interface PersistentBindingRow {
  provider: string;
  providerTenantId: string;
  providerChannelId: string;
  providerThreadId: string;
  orgId: string;
  projectId: string | null;
  customerId: string | null;
  contextRole: string | null;
  status: string;
}

const ROW_SELECT = {
  provider: true,
  providerTenantId: true,
  providerChannelId: true,
  providerThreadId: true,
  orgId: true,
  projectId: true,
  customerId: true,
  contextRole: true,
  status: true,
} as const;

async function validateActiveRow(
  row: PersistentBindingRow,
  input: { expectedOrgId: string; ownershipDeps?: OwnershipDeps },
): Promise<PersistentBindingLookupResult> {
  if (row.orgId !== input.expectedOrgId) {
    return { status: "fail_closed", reason: "binding_org_mismatch" };
  }
  const contextType = bindingRowToContextType(row);
  const contextId = row.customerId ?? row.projectId;
  if (!contextType || !contextId) {
    return { status: "fail_closed", reason: "binding_target_invalid" };
  }
  const ownership = await resolveProviderTenantOwnership(
    {
      provider: row.provider,
      providerTenantId: row.providerTenantId,
      targetOrgId: row.orgId,
    },
    input.ownershipDeps ?? createDefaultOwnershipDeps(),
  );
  if (ownership !== "OWNED") {
    return { status: "fail_closed", reason: "binding_ownership_invalid" };
  }
  return {
    status: "found",
    binding: {
      provider: row.provider as MentionProvider,
      channelId: row.providerChannelId,
      threadId: row.providerThreadId || undefined,
      organizationId: row.orgId,
      contextType,
      contextId,
    },
  };
}

export async function lookupPersistentChannelBinding(input: {
  provider: string;
  providerTenantId: string;
  providerChannelId: string;
  providerThreadId?: string;
  expectedOrgId: string;
  ownershipDeps?: OwnershipDeps;
}): Promise<PersistentBindingLookupResult> {
  const { db } = await import("@/lib/db");
  const threadId = (input.providerThreadId ?? "").trim();

  if (threadId) {
    const threadRow = await db.channelContextBinding.findUnique({
      where: {
        provider_providerTenantId_providerChannelId_providerThreadId: {
          provider: input.provider,
          providerTenantId: input.providerTenantId,
          providerChannelId: input.providerChannelId,
          providerThreadId: threadId,
        },
      },
      select: ROW_SELECT,
    });
    if (threadRow) {
      if (threadRow.status === "ACTIVE") {
        // ACTIVE thread override：校验失败 = fail closed，绝不 fallback channel
        return validateActiveRow(threadRow, input);
      }
      // DISABLED / REVOKED thread 行视为不存在 → fallback channel
    }
  }

  const channelRow = await db.channelContextBinding.findUnique({
    where: {
      provider_providerTenantId_providerChannelId_providerThreadId: {
        provider: input.provider,
        providerTenantId: input.providerTenantId,
        providerChannelId: input.providerChannelId,
        providerThreadId: "",
      },
    },
    select: ROW_SELECT,
  });
  if (channelRow && channelRow.status === "ACTIVE") {
    return validateActiveRow(channelRow, input);
  }
  return { status: "none" };
}
