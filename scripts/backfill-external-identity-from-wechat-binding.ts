/**
 * Mention Gateway M2-A — Legacy WeChatBinding → ExternalIdentity 回填
 *
 * 用法：
 *   DATABASE_URL=<隔离库> DIRECT_URL=<同> NODE_ENV=test npx tsx scripts/backfill-external-identity-from-wechat-binding.ts           # DRY RUN（默认）
 *   … npx tsx scripts/backfill-external-identity-from-wechat-binding.ts --write   # 实际写入
 *
 * 安全：
 * - assertSafeTestDatabase() fail-closed：生产库任何信号组合都 HARD BLOCK，本脚本**没有** production override（本 PR 不加入）。
 * - 幂等：按唯一键 find → decide（src/lib/mention-gateway/backfill.ts）→ create / 单调收敛 / 保留 / CONFLICT；绝不 upsert 改写 userId。
 * - 日志不输出 raw providerUserId（externalId），只输出 bindingId + reason + sha256 截断。
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";
import {
  buildCorpOrgIndex,
  decideBackfillAction,
  gatewayMapKey,
  mapLegacyIdentityStatus,
  resolveLegacyProviderTenant,
  type LegacyIdentityStatus,
} from "@/lib/mention-gateway/backfill";
import {
  commitIdentityTransition,
  hashProviderUserId,
} from "@/lib/mention-gateway/identity-service";

const WRITE = process.argv.includes("--write");

async function main() {
  assertSafeTestDatabase({
    scriptName: "backfill-external-identity-from-wechat-binding",
  });

  const { db } = await import("@/lib/db");
  const { AUDIT_ACTIONS, writeAuditLog } = await import("@/lib/audit/logger");

  const [bindings, gateways, users] = await Promise.all([
    db.weChatBinding.findMany({
      select: {
        id: true,
        channel: true,
        externalId: true,
        userId: true,
        orgId: true,
        status: true,
        createdAt: true,
        lastActiveAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.weChatGateway.findMany({
      select: { id: true, orgId: true, channel: true, corpId: true, status: true },
    }),
    db.user.findMany({ select: { id: true, status: true } }),
  ]);

  const gatewayMap = new Map(gateways.map((g) => [gatewayMapKey(g.orgId, g.channel), g]));
  // B3：CorpID → 真实 org 集合；>1 → 歧义，UNRESOLVED（不得按单条 binding.orgId 猜）
  const corpOrgIndex = buildCorpOrgIndex(gateways);
  const userStatus = new Map(users.map((u) => [u.id, u.status]));

  const counters: Record<string, number> = {
    SCANNED: 0,
    RESOLVABLE: 0,
    UNRESOLVED_TENANT: 0,
    WOULD_CREATE: 0,
    CREATED: 0,
    EXISTING_SAME: 0,
    RECONCILED: 0,
    CONFLICT: 0,
    STRONGER_IDENTITY_PRESERVED: 0,
    USER_MISSING: 0,
    ACTIVE: 0,
    PENDING: 0,
    REVOKED: 0,
    DISABLED: 0,
  };
  const bump = (k: string) => {
    counters[k] = (counters[k] ?? 0) + 1;
  };
  const itemLog: string[] = [];
  const note = (bindingId: string, action: string, reason?: string, hash?: string) => {
    itemLog.push(
      `  - binding=${bindingId} action=${action}${reason ? ` reason=${reason}` : ""}${hash ? ` providerUserIdHash=${hash}` : ""}`,
    );
  };

  for (const binding of bindings) {
    bump("SCANNED");
    const hash = hashProviderUserId(binding.externalId);

    const uStatus = userStatus.get(binding.userId);
    if (!uStatus) {
      bump("USER_MISSING");
      note(binding.id, "SKIP", "user_missing", hash);
      continue;
    }

    const tenant = resolveLegacyProviderTenant(binding, gatewayMap, corpOrgIndex);
    if (!tenant.ok) {
      bump("UNRESOLVED_TENANT");
      note(binding.id, "UNRESOLVED_TENANT", tenant.reason, hash);
      continue;
    }
    bump("RESOLVABLE");

    const mapped = mapLegacyIdentityStatus({
      bindingStatus: binding.status,
      userStatus: uStatus,
      gatewayStatus: tenant.gatewayStatus,
    });
    bump(mapped.status);

    const existing = await db.externalIdentity.findUnique({
      where: {
        provider_providerTenantId_providerUserId: {
          provider: binding.channel,
          providerTenantId: tenant.providerTenantId,
          providerUserId: binding.externalId,
        },
      },
    });

    const decision = decideBackfillAction(existing, {
      userId: binding.userId,
      status: mapped.status,
    });

    switch (decision.action) {
      case "CONFLICT":
        bump("CONFLICT");
        note(binding.id, "CONFLICT", "unique_key_claimed_by_other_user", hash);
        continue;
      case "STRONGER_PRESERVED":
        bump("STRONGER_IDENTITY_PRESERVED");
        note(binding.id, "STRONGER_PRESERVED", undefined, hash);
        continue;
      case "EXISTING_SAME":
        bump("EXISTING_SAME");
        continue;
      case "RECONCILE_STATUS": {
        if (!WRITE) {
          bump("RECONCILED");
          note(binding.id, "WOULD_RECONCILE", `to_${decision.nextStatus}`, hash);
          continue;
        }
        // B1 CAS：仅当行仍是 same user + LEGACY_SELF_ASSERTED + 期望 status/updatedAt
        // 才允许单调收敛；期间被 admin verify 升级 / relink / revoke → STATE_CHANGED，不改。
        const committed = await commitIdentityTransition({
          before: existing!,
          data: {
            status: decision.nextStatus!,
            ...(decision.nextStatus === "REVOKED"
              ? {
                  revokedAt: binding.lastActiveAt ?? new Date(),
                  revokeReason: mapped.reason ?? "legacy_backfill_reconcile",
                }
              : {}),
          },
          outcome: "RECONCILED",
          audit: {
            callerUserId: binding.userId,
            orgId: binding.orgId,
            action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_STATUS_CHANGE,
            afterExtra: {
              reason: mapped.reason ?? "legacy_backfill_reconcile",
              source: "legacy_backfill",
              bindingId: binding.id,
            },
          },
        });
        if (!committed.ok) {
          bump("STRONGER_IDENTITY_PRESERVED");
          note(binding.id, "STATE_CHANGED_PRESERVED", committed.code, hash);
          continue;
        }
        bump("RECONCILED");
        note(binding.id, "RECONCILED", `to_${decision.nextStatus}`, hash);
        continue;
      }
      case "CREATE": {
        if (!WRITE) {
          bump("WOULD_CREATE");
          continue;
        }
        try {
          await db.$transaction(async (tx) => {
            const row = await tx.externalIdentity.create({
              data: {
                provider: binding.channel,
                providerTenantId: tenant.providerTenantId,
                providerUserId: binding.externalId,
                userId: binding.userId,
                status: mapped.status as LegacyIdentityStatus,
                verificationMethod: "LEGACY_SELF_ASSERTED",
                linkedAt: binding.createdAt,
                linkedById: binding.userId,
                lastSeenAt: binding.lastActiveAt,
                ...(mapped.status === "REVOKED"
                  ? {
                      revokedAt: binding.lastActiveAt ?? new Date(),
                      revokeReason: mapped.reason ?? "legacy_binding_inactive",
                    }
                  : {}),
              },
            });
            await writeAuditLog(tx, {
              userId: binding.userId,
              orgId: binding.orgId,
              action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_BACKFILL,
              targetType: "external_identity",
              targetId: row.id,
              afterData: {
                provider: row.provider,
                providerTenantId: row.providerTenantId,
                providerUserIdHash: hash,
                userId: row.userId,
                status: row.status,
                verificationMethod: row.verificationMethod,
                reason: mapped.reason ?? null,
                source: "legacy_backfill",
                bindingId: binding.id,
              },
            });
          });
          bump("CREATED");
        } catch (e) {
          if ((e as { code?: string })?.code === "P2002") {
            // 并发/重复运行竞态 → 视作 CONFLICT/EXISTING，重跑会正确归类
            bump("CONFLICT");
            note(binding.id, "CONFLICT", "unique_race", hash);
          } else {
            throw e;
          }
        }
        continue;
      }
    }
  }

  console.log("");
  console.log(`Mention M2-A legacy backfill — ${WRITE ? "WRITE" : "DRY RUN"}`);
  for (const [k, v] of Object.entries(counters)) {
    console.log(`  ${k} = ${v}`);
  }
  if (itemLog.length) {
    console.log("");
    console.log("Item report（bindingId + reason；不含 raw externalId）:");
    for (const line of itemLog.slice(0, 200)) console.log(line);
    if (itemLog.length > 200) console.log(`  …(${itemLog.length - 200} more)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
