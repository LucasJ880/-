/**
 * Mention Gateway M2-A — Persistent External Identity 纯逻辑测试（无 DB / 模型 / 网络）
 * 运行：npx tsx src/lib/mention-gateway/__tests__/m2a-identity-policy.test.ts
 *
 * 覆盖：身份来源 flags（fail-closed）/ 键归一化 / Provider Tenant Ownership 矩阵 /
 * decideProvisionOutcome（NO BLIND UPSERT / Attack B takeover）/ 回填纯函数（Attack C）/
 * 租户键隔离（session / userMessageId / dedupe；Attack E 适配器伪造租户）/
 * SELF_LINK 缺席（A1）/ resolveMentionIdentity 状态与验证门。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  isMentionIdentityAdminEnabledWithEnv,
  isMentionRequireVerifiedIdentityEnabledWithEnv,
  resolveMentionIdentitySourceWithEnv,
} from "../flags";
import {
  decideProvisionOutcome,
  hashProviderUserId,
  normalizeIdentityKey,
} from "../identity-service";
import {
  resolveProviderTenantOwnership,
  type OwnershipDeps,
  type ProviderGatewayRecord,
} from "../provider-tenant-ownership";
import {
  buildCorpOrgIndex,
  decideBackfillAction,
  gatewayMapKey,
  mapLegacyIdentityStatus,
  resolveLegacyProviderTenant,
} from "../backfill";
import { resolveMentionIdentity, type IdentityDeps } from "../identity";
import { buildMentionConversationKey, buildMentionUserMessageId } from "../session";
import { buildMentionDedupeKey } from "../handle";
import { normalizeMockMentionEvent } from "../adapters/mock";
import type { MentionEvent } from "../types";
import { ORG_A, TEST_ENV, baseRaw, finish, ok } from "./helpers";

const PLATFORM_ORG = "__qingyan_platform__";

function fakeOwnershipDeps(input: {
  env?: Record<string, string | undefined>;
  gatewaysById?: Record<string, ProviderGatewayRecord>;
  wecomByCorpId?: Record<string, ProviderGatewayRecord[]>;
}): OwnershipDeps {
  return {
    env: input.env ?? TEST_ENV,
    async findGatewayById(id) {
      return input.gatewaysById?.[id] ?? null;
    },
    async findWecomGatewaysByCorpId(corpId) {
      return input.wecomByCorpId?.[corpId] ?? [];
    },
  };
}

function eventWith(tenant: string, overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    provider: "mock",
    providerTenantId: tenant,
    eventId: "evt-1",
    channel: { id: "chan-1", type: "dm" },
    messageId: "msg-1",
    externalUserId: "ext-user",
    text: "hi",
    mentionedAgent: true,
    timestamp: "2026-08-24T00:00:00Z",
    ...overrides,
  };
}

async function main() {
  let takeoverBlocked = true;
  let backfillCannotOverwrite = true;
  let tenantForgeryBlocked = true;
  let tenantKeyIsolation = true;
  let selfLinkAbsent = true;
  let unverifiedDenied = true;
  let ownershipFailClosed = true;

  console.log("M2A-1 身份来源 flag：默认 fixture / db 显式 / 非法值 fail-closed（null，不 fallback）");
  {
    ok(resolveMentionIdentitySourceWithEnv({}) === "fixture", "缺省 → fixture");
    ok(resolveMentionIdentitySourceWithEnv({ MENTION_GATEWAY_IDENTITY_SOURCE: "" }) === "fixture", "空串 → fixture");
    ok(resolveMentionIdentitySourceWithEnv({ MENTION_GATEWAY_IDENTITY_SOURCE: "fixture" }) === "fixture", "fixture → fixture");
    ok(resolveMentionIdentitySourceWithEnv({ MENTION_GATEWAY_IDENTITY_SOURCE: "db" }) === "db", "db → db");
    ok(resolveMentionIdentitySourceWithEnv({ MENTION_GATEWAY_IDENTITY_SOURCE: "DB" }) === "db", "大小写归一 DB → db");
    for (const bad of ["database", "prisma", "fixture,db", "0", "yes"]) {
      ok(resolveMentionIdentitySourceWithEnv({ MENTION_GATEWAY_IDENTITY_SOURCE: bad }) === null, `非法值 ${JSON.stringify(bad)} → null（网关将 GATEWAY_DISABLED）`);
    }
  }

  console.log("M2A-2 REQUIRE_VERIFIED_IDENTITY 默认 true；IDENTITY_ADMIN 默认 false");
  {
    ok(isMentionRequireVerifiedIdentityEnabledWithEnv({}) === true, "缺省 → true（安全默认）");
    ok(isMentionRequireVerifiedIdentityEnabledWithEnv({ MENTION_GATEWAY_REQUIRE_VERIFIED_IDENTITY: "1" }) === true, "1 → true");
    for (const off of ["0", "false", "off", "no"]) {
      ok(isMentionRequireVerifiedIdentityEnabledWithEnv({ MENTION_GATEWAY_REQUIRE_VERIFIED_IDENTITY: off }) === false, `${off} → false（显式关闭）`);
    }
    ok(isMentionRequireVerifiedIdentityEnabledWithEnv({ MENTION_GATEWAY_REQUIRE_VERIFIED_IDENTITY: "garbage" }) === true, "非法值 → 保持 true（fail-closed）");
    ok(isMentionIdentityAdminEnabledWithEnv({}) === false, "IDENTITY_ADMIN 缺省 → false");
    ok(isMentionIdentityAdminEnabledWithEnv({ MENTION_GATEWAY_IDENTITY_ADMIN_ENABLED: "1" }) === true, "IDENTITY_ADMIN=1 → true");
  }

  console.log("M2A-3 normalizeIdentityKey：trim + provider 白名单 + 空键拒绝");
  {
    const good = normalizeIdentityKey({ provider: " wecom ", providerTenantId: " corp1 ", providerUserId: " u1 " });
    ok(good.ok && good.provider === "wecom" && good.providerTenantId === "corp1" && good.providerUserId === "u1", "trim 后接受");
    ok(!normalizeIdentityKey({ provider: "email", providerTenantId: "t", providerUserId: "u" }).ok, "未知 provider 拒绝");
    ok(!normalizeIdentityKey({ provider: "wecom", providerTenantId: "  ", providerUserId: "u" }).ok, "空 tenant 拒绝");
    ok(!normalizeIdentityKey({ provider: "wecom", providerTenantId: "t", providerUserId: "" }).ok, "空 providerUserId 拒绝");
  }

  console.log("M2A-4 hashProviderUserId：确定性 sha256 截断，日志不含 raw ID");
  {
    const h = hashProviderUserId("wxid_secret_raw");
    ok(/^[0-9a-f]{16}$/.test(h), "16 位 hex");
    ok(h === hashProviderUserId("wxid_secret_raw"), "确定性");
    ok(!h.includes("wxid"), "不含 raw 片段");
    ok(hashProviderUserId("a") !== hashProviderUserId("b"), "不同输入不同 hash");
  }

  console.log("M2A-5 Ownership 矩阵：mock");
  {
    const deps = fakeOwnershipDeps({});
    ok((await resolveProviderTenantOwnership({ provider: "mock", providerTenantId: "mock", targetOrgId: ORG_A }, deps)) === "OWNED", "mock/mock/非生产 → OWNED");
    ok((await resolveProviderTenantOwnership({ provider: "mock", providerTenantId: "other", targetOrgId: ORG_A }, deps)) === "MISMATCH", "mock tenant ≠ mock → MISMATCH");
    const prodDeps = fakeOwnershipDeps({ env: { ...TEST_ENV, VERCEL_ENV: "production" } });
    const prod = await resolveProviderTenantOwnership({ provider: "mock", providerTenantId: "mock", targetOrgId: ORG_A }, prodDeps);
    ok(prod === "UNSUPPORTED", "生产运行时 mock 永不 OWNED");
    if (prod === "OWNED") ownershipFailClosed = false;
    ok((await resolveProviderTenantOwnership({ provider: "mock", providerTenantId: "", targetOrgId: ORG_A }, deps)) === "UNPROVEN", "空 tenant → UNPROVEN");
  }

  console.log("M2A-6 Ownership 矩阵：personal_wechat（gateway.id 全匹配）");
  {
    const gw: ProviderGatewayRecord = { id: "gw-1", orgId: ORG_A, channel: "personal_wechat", corpId: null, status: "active" };
    const deps = fakeOwnershipDeps({ gatewaysById: { "gw-1": gw, "gw-wrongchan": { ...gw, id: "gw-wrongchan", channel: "wecom" }, "gw-otherorg": { ...gw, id: "gw-otherorg", orgId: "org_b" }, "gw-paused": { ...gw, id: "gw-paused", status: "paused" } } });
    const at = (t: string) => resolveProviderTenantOwnership({ provider: "personal_wechat", providerTenantId: t, targetOrgId: ORG_A }, deps);
    ok((await at("gw-1")) === "OWNED", "org 自己的 active 网关 → OWNED");
    ok((await at("gw-none")) === "UNPROVEN", "网关不存在 → UNPROVEN");
    ok((await at("gw-wrongchan")) === "UNPROVEN", "channel 不符 → UNPROVEN");
    const other = await at("gw-otherorg");
    ok(other === "MISMATCH", "其它 org 的网关 → MISMATCH");
    if (other === "OWNED") ownershipFailClosed = false;
    ok((await at("gw-paused")) === "INACTIVE", "网关未激活 → INACTIVE");
  }

  console.log("M2A-7 Ownership 矩阵：wecom（CorpID；平台共享网关无可信映射 → UNPROVEN，不得猜）");
  {
    const mk = (orgId: string, status = "active"): ProviderGatewayRecord => ({ id: `gw-${orgId}`, orgId, channel: "wecom", corpId: "corp1", status });
    const deps = fakeOwnershipDeps({
      wecomByCorpId: {
        corp_owned: [mk(ORG_A)],
        corp_inactive: [mk(ORG_A, "paused")],
        corp_platform_only: [mk(PLATFORM_ORG)],
        corp_other_org: [mk("org_b")],
        corp_platform_and_target: [mk(PLATFORM_ORG), mk(ORG_A)],
        corp_two_real_orgs: [mk(ORG_A), mk("org_b")],
        corp_platform_and_two: [mk(PLATFORM_ORG), mk(ORG_A), mk("org_b")],
      },
    });
    const at = (t: string, org = ORG_A) => resolveProviderTenantOwnership({ provider: "wecom", providerTenantId: t, targetOrgId: org }, deps);
    ok((await at("corp_owned")) === "OWNED", "目标 org 自有 corp 网关 → OWNED");
    ok((await at("corp_owned", "org_b")) === "MISMATCH", "同 corp 由其它 org 视角 → MISMATCH");
    ok((await at("corp_inactive")) === "INACTIVE", "目标 org 网关未激活 → INACTIVE");
    const platformOnly = await at("corp_platform_only");
    ok(platformOnly === "UNPROVEN", "仅平台共享网关命中 → UNPROVEN（无 platform→org 可信映射）");
    if (platformOnly === "OWNED") ownershipFailClosed = false;
    ok((await at("corp_other_org")) === "MISMATCH", "CorpID 属其它真实 org → MISMATCH");
    ok((await at("corp_none")) === "UNPROVEN", "无网关 → UNPROVEN");
    ok((await at("corp_platform_and_target")) === "OWNED", "平台网关 + 目标 org 网关并存 → 以目标 org 网关为准 OWNED");
    // B3：同一 CorpID 出现在多个真实 org → 任何一方都不得 OWNED
    const twoA = await at("corp_two_real_orgs");
    const twoB = await at("corp_two_real_orgs", "org_b");
    ok(twoA === "AMBIGUOUS" && twoB === "AMBIGUOUS", "CorpID 属两个真实 org → 双方均 AMBIGUOUS（NEVER OWNED）");
    if (twoA === "OWNED" || twoB === "OWNED") ownershipFailClosed = false;
    const three = await at("corp_platform_and_two");
    ok(three === "AMBIGUOUS", "平台 + 两个真实 org → 仍 AMBIGUOUS（平台不消除 real-org 歧义）");
    if (three === "OWNED") ownershipFailClosed = false;
  }

  console.log("M2A-8 Ownership 矩阵：slack / 未知 provider → UNSUPPORTED（M3 前不得 ACTIVE）");
  {
    const deps = fakeOwnershipDeps({});
    ok((await resolveProviderTenantOwnership({ provider: "slack", providerTenantId: "T123", targetOrgId: ORG_A }, deps)) === "UNSUPPORTED", "slack → UNSUPPORTED");
    ok((await resolveProviderTenantOwnership({ provider: "telegram", providerTenantId: "t", targetOrgId: ORG_A }, deps)) === "UNSUPPORTED", "未知 provider → UNSUPPORTED");
  }

  console.log("M2A-9 decideProvisionOutcome：NO BLIND UPSERT（Attack B takeover 被拒）");
  {
    ok(decideProvisionOutcome(null, "user_1") === "CREATE", "不存在 → CREATE");
    ok(decideProvisionOutcome({ userId: "user_1", status: "ACTIVE", verificationMethod: "ADMIN_PROVISIONED" }, "user_1") === "IDEMPOTENT", "同用户 ACTIVE/ADMIN → IDEMPOTENT（无写）");
    ok(decideProvisionOutcome({ userId: "user_1", status: "PENDING", verificationMethod: null }, "user_1") === "NEEDS_VERIFY", "同用户 PENDING → NEEDS_VERIFY");
    ok(decideProvisionOutcome({ userId: "user_1", status: "ACTIVE", verificationMethod: "LEGACY_SELF_ASSERTED" }, "user_1") === "NEEDS_VERIFY", "同用户 ACTIVE/LEGACY → 显式 verify 升级（不静默改方法）");
    ok(decideProvisionOutcome({ userId: "user_1", status: "DISABLED", verificationMethod: "ADMIN_PROVISIONED" }, "user_1") === "NEEDS_ENABLE", "同用户 DISABLED → NEEDS_ENABLE");
    ok(decideProvisionOutcome({ userId: "user_1", status: "REVOKED", verificationMethod: "ADMIN_PROVISIONED" }, "user_1") === "NEEDS_RELINK", "同用户 REVOKED → NEEDS_RELINK（终态不复活）");
    for (const status of ["ACTIVE", "PENDING", "DISABLED", "REVOKED"]) {
      const outcome = decideProvisionOutcome({ userId: "victim", status, verificationMethod: "PROVIDER_OAUTH" }, "attacker");
      ok(outcome === "CONFLICT", `他人占用（${status}）→ CONFLICT，绝不改写 userId`);
      if (outcome !== "CONFLICT") takeoverBlocked = false;
    }
  }

  console.log("M2A-10 回填：canonical providerTenantId 解析（解析不出 → 仅报告，不造值）");
  {
    const gwMap = new Map<string, ProviderGatewayRecord>([
      [gatewayMapKey(ORG_A, "personal_wechat"), { id: "gw-pw", orgId: ORG_A, channel: "personal_wechat", corpId: null, status: "active" }],
      [gatewayMapKey(ORG_A, "wecom"), { id: "gw-wc", orgId: ORG_A, channel: "wecom", corpId: "corp1", status: "active" }],
      [gatewayMapKey("org_c", "wecom"), { id: "gw-nocorp", orgId: "org_c", channel: "wecom", corpId: "  ", status: "active" }],
    ]);
    const pw = resolveLegacyProviderTenant({ channel: "personal_wechat", orgId: ORG_A }, gwMap);
    ok(pw.ok && pw.providerTenantId === "gw-pw", "personal_wechat → gateway.id");
    const wc = resolveLegacyProviderTenant({ channel: "wecom", orgId: ORG_A }, gwMap);
    ok(wc.ok && wc.providerTenantId === "corp1", "wecom → org 网关 corpId");
    ok(!resolveLegacyProviderTenant({ channel: "personal_wechat", orgId: null }, gwMap).ok, "orgId 缺失 → UNRESOLVED");
    ok(!resolveLegacyProviderTenant({ channel: "personal_wechat", orgId: PLATFORM_ORG }, gwMap).ok, "平台 org 占位 → UNRESOLVED（不当真实 org）");
    ok(!resolveLegacyProviderTenant({ channel: "wecom", orgId: "org_b" }, gwMap).ok, "org 无 wecom 网关 → UNRESOLVED（不用 orgId/\"legacy\" 顶替）");
    ok(!resolveLegacyProviderTenant({ channel: "wecom", orgId: "org_c" }, gwMap).ok, "corpId 为空 → UNRESOLVED");
    ok(!resolveLegacyProviderTenant({ channel: "sms", orgId: ORG_A }, gwMap).ok, "未知 channel → UNRESOLVED");
    // B3：CorpID 同属多个真实 org → 即使 binding.orgId 指向其中之一也 UNRESOLVED
    const dupGateways: ProviderGatewayRecord[] = [
      { id: "gw-wc-a", orgId: ORG_A, channel: "wecom", corpId: "corp_dup", status: "active" },
      { id: "gw-wc-b", orgId: "org_b", channel: "wecom", corpId: "corp_dup", status: "active" },
      { id: "gw-wc-p", orgId: PLATFORM_ORG, channel: "wecom", corpId: "corp_dup", status: "active" },
      { id: "gw-pw-x", orgId: ORG_A, channel: "personal_wechat", corpId: null, status: "active" },
    ];
    const corpIndex = buildCorpOrgIndex(dupGateways);
    ok(corpIndex.get("corp_dup")?.size === 2, "buildCorpOrgIndex：平台网关与非 wecom 网关不计入真实 org 集合");
    const dupMap = new Map([[gatewayMapKey(ORG_A, "wecom"), dupGateways[0]]]);
    const amb = resolveLegacyProviderTenant({ channel: "wecom", orgId: ORG_A }, dupMap, corpIndex);
    ok(!amb.ok && amb.reason === "wecom_corp_ambiguous", "corp 歧义 → UNRESOLVED(wecom_corp_ambiguous)，不得按 binding.orgId 绕过");
    const single = buildCorpOrgIndex(dupGateways.filter((g) => g.orgId !== "org_b"));
    ok(resolveLegacyProviderTenant({ channel: "wecom", orgId: ORG_A }, dupMap, single).ok, "唯一真实 org（平台不计）→ 正常解析");
  }

  console.log("M2A-11 回填：状态映射（LEGACY 永不直接 ACTIVE-verified；gateway 不活 → PENDING）");
  {
    ok(mapLegacyIdentityStatus({ bindingStatus: "active", userStatus: "active", gatewayStatus: "active" }).status === "ACTIVE", "全活 → ACTIVE（方法仍 LEGACY_SELF_ASSERTED）");
    ok(mapLegacyIdentityStatus({ bindingStatus: "active", userStatus: "disabled", gatewayStatus: "active" }).status === "DISABLED", "用户停用 → DISABLED");
    ok(mapLegacyIdentityStatus({ bindingStatus: "disconnected", userStatus: "active", gatewayStatus: "active" }).status === "REVOKED", "binding disconnected → REVOKED");
    ok(mapLegacyIdentityStatus({ bindingStatus: "expired", userStatus: "active", gatewayStatus: "active" }).status === "REVOKED", "binding expired → REVOKED");
    const pending = mapLegacyIdentityStatus({ bindingStatus: "active", userStatus: "active", gatewayStatus: "paused" });
    ok(pending.status === "PENDING" && pending.reason === "gateway_inactive", "gateway 不活 → PENDING(gateway_inactive)");
  }

  console.log("M2A-12 回填：决策（Attack C — legacy 绝不接管 / 降级更强身份）");
  {
    ok(decideBackfillAction(null, { userId: "u1", status: "ACTIVE" }).action === "CREATE", "不存在 → CREATE");
    const conflict = decideBackfillAction({ userId: "victim", status: "ACTIVE", verificationMethod: "ADMIN_PROVISIONED" }, { userId: "attacker", status: "ACTIVE" });
    ok(conflict.action === "CONFLICT", "键属其它用户 → CONFLICT（不 mutation）");
    if (conflict.action !== "CONFLICT") backfillCannotOverwrite = false;
    const stronger = decideBackfillAction({ userId: "u1", status: "ACTIVE", verificationMethod: "ADMIN_PROVISIONED" }, { userId: "u1", status: "REVOKED" });
    ok(stronger.action === "STRONGER_PRESERVED", "同用户但 ADMIN_PROVISIONED → 完整保留（不降级不改状态）");
    if (stronger.action !== "STRONGER_PRESERVED") backfillCannotOverwrite = false;
    ok(decideBackfillAction({ userId: "u1", status: "ACTIVE", verificationMethod: "LEGACY_SELF_ASSERTED" }, { userId: "u1", status: "ACTIVE" }).action === "EXISTING_SAME", "同用户同状态 LEGACY → no-op");
    const rec = decideBackfillAction({ userId: "u1", status: "ACTIVE", verificationMethod: "LEGACY_SELF_ASSERTED" }, { userId: "u1", status: "REVOKED" });
    ok(rec.action === "RECONCILE_STATUS" && rec.nextStatus === "REVOKED", "LEGACY ACTIVE → REVOKED 单调收敛允许");
    ok(decideBackfillAction({ userId: "u1", status: "REVOKED", verificationMethod: "LEGACY_SELF_ASSERTED" }, { userId: "u1", status: "ACTIVE" }).action === "EXISTING_SAME", "REVOKED → ACTIVE 复活被拒（no-op）");
    ok(decideBackfillAction({ userId: "u1", status: "DISABLED", verificationMethod: "LEGACY_SELF_ASSERTED" }, { userId: "u1", status: "ACTIVE" }).action === "EXISTING_SAME", "DISABLED → ACTIVE 复活被拒（no-op）");
  }

  console.log("M2A-13 租户键隔离：同 channel/eventId 不同 providerTenantId 绝不碰撞");
  {
    const a = eventWith("corpA");
    const b = eventWith("corpB");
    ok(buildMentionConversationKey(a) !== buildMentionConversationKey(b), "conversationKey 含 tenant");
    ok(buildMentionUserMessageId(a) !== buildMentionUserMessageId(b), "userMessageId 含 tenant");
    const principal = { orgId: ORG_A, userId: "user_1" };
    ok(buildMentionDedupeKey(a, principal) !== buildMentionDedupeKey(b, principal), "dedupeKey 含 tenant");
    if (buildMentionDedupeKey(a, principal) === buildMentionDedupeKey(b, principal)) tenantKeyIsolation = false;
    ok(buildMentionConversationKey(a) === `mock:corpA:chan-1:-`, "键格式 <provider>:<tenant>:<channel>:<thread>");
  }

  console.log("M2A-14 Attack E：mock 适配器忽略 body 声称的 providerTenantId，恒 server-side \"mock\"");
  {
    const forged = { ...(baseRaw() as Record<string, unknown>), providerTenantId: "corp_victim" };
    const r = normalizeMockMentionEvent(forged);
    ok(r.ok, "事件本身合法");
    if (r.ok) {
      ok(r.event.providerTenantId === "mock", "providerTenantId 被服务端固定为 mock（伪造被忽略）");
      if (r.event.providerTenantId !== "mock") tenantForgeryBlocked = false;
    } else {
      tenantForgeryBlocked = false;
    }
  }

  console.log("M2A-15 A1 SELF_LINK = DEFERRED：不存在自助 link 端点；写端点全部挂 admin 守卫");
  {
    const identitiesDir = join(process.cwd(), "src/app/api/mention-gateway/identities");
    const entries = readdirSync(identitiesDir);
    ok(!entries.includes("link"), "identities/ 下没有 link/ 路由");
    ok(!existsSync(join(identitiesDir, "link/route.ts")), "identities/link/route.ts 不存在");
    const writeRoutes = [
      "provision/route.ts",
      "[id]/verify/route.ts",
      "[id]/relink/route.ts",
      "[id]/disable/route.ts",
      "[id]/enable/route.ts",
    ];
    for (const rel of writeRoutes) {
      const src = readFileSync(join(identitiesDir, rel), "utf8");
      ok(src.includes("requireIdentityAdminContext"), `${rel} 挂 requireIdentityAdminContext`);
      if (!src.includes("requireIdentityAdminContext")) selfLinkAbsent = false;
    }
    const provision = readFileSync(join(identitiesDir, "provision/route.ts"), "utf8");
    ok(provision.includes(".strict()"), "provision body zod strict（orgId/status/verifiedAt 不可注入）");
    ok(!/orgId|verifiedAt|verifiedById|linkedById/.test(provision.match(/z\.object\(\{[\s\S]*?\}\)/)?.[0] ?? ""), "provision body schema 不含 orgId/verifiedAt/verifiedById/linkedById 字段");
  }

  console.log("M2A-16 resolveMentionIdentity：状态门 + 验证门（fixture 语义不变）");
  {
    const baseUser = { id: "user_1", role: "admin", name: "U", status: "active", activeOrgId: ORG_A };
    const mkDeps = (lookup: IdentityDeps["lookupExternalIdentity"]): IdentityDeps => ({
      lookupExternalIdentity: lookup,
      loadUser: async () => baseUser,
      listActiveMembershipOrgIds: async () => [ORG_A],
      resolveAgentTenant: async () => ({ orgId: ORG_A, role: "admin", orgRole: "org_member", hasMembership: true, isPlatformAdmin: false }),
    });
    const ev = eventWith("mock");
    const run = (lookup: IdentityDeps["lookupExternalIdentity"], opts?: { requireVerifiedIdentity?: boolean }) =>
      resolveMentionIdentity(ev, mkDeps(lookup), opts);

    const active = await run(async () => ({ userId: "user_1", status: "ACTIVE", verificationMethod: "ADMIN_PROVISIONED" }));
    ok(active.ok, "ACTIVE + ADMIN_PROVISIONED → 通过");
    for (const status of ["PENDING", "DISABLED", "REVOKED"]) {
      const r = await run(async () => ({ userId: "user_1", status, verificationMethod: "ADMIN_PROVISIONED" }));
      ok(!r.ok && !r.ok && r.reason === "identity_not_active", `${status} → identity_not_active DENY`);
      if (r.ok) unverifiedDenied = false;
    }
    // B4：VERIFIED_IDENTITY_METHODS 白名单（fail-closed，不再是「黑名单 LEGACY」）
    for (const method of ["ADMIN_PROVISIONED", "PROVIDER_CHALLENGE", "PROVIDER_OAUTH", "PROVIDER_SIGNED_EVENT"]) {
      const r = await run(async () => ({ userId: "user_1", status: "ACTIVE", verificationMethod: method }));
      ok(r.ok, `ACTIVE + ${method} → PASS`);
    }
    const nullMethod = await run(async () => ({ userId: "user_1", status: "ACTIVE", verificationMethod: null }));
    ok(!nullMethod.ok && nullMethod.reason === "identity_unverified", "B4：ACTIVE + verificationMethod=null → identity_unverified DENY（fail-closed）");
    if (nullMethod.ok) unverifiedDenied = false;
    const unknownMethod = await run(async () => ({ userId: "user_1", status: "ACTIVE", verificationMethod: "SELF_LINK" }));
    ok(!unknownMethod.ok && unknownMethod.reason === "identity_unverified", "B4：白名单外方法 → DENY");
    const legacy = await run(async () => ({ userId: "user_1", status: "ACTIVE", verificationMethod: "LEGACY_SELF_ASSERTED" }));
    ok(!legacy.ok && legacy.reason === "identity_unverified", "缺省 requireVerified：LEGACY ACTIVE → identity_unverified DENY");
    if (legacy.ok) unverifiedDenied = false;
    const legacyAllowed = await run(async () => ({ userId: "user_1", status: "ACTIVE", verificationMethod: "LEGACY_SELF_ASSERTED" }), { requireVerifiedIdentity: false });
    ok(legacyAllowed.ok, "显式 requireVerified=false → LEGACY ACTIVE 放行（运维显式选择）");
    const thrown = await run(async () => {
      throw new Error("db down");
    });
    ok(!thrown.ok && thrown.reason === "identity_lookup_error", "lookup 抛错 → identity_lookup_error（fail closed，不 fallback）");
    const legacyFixture = await run(async () => ({ userId: "user_1" }));
    ok(legacyFixture.ok, "无 status/method（M1 fixture 兼容形状）→ test-safe 通过");
  }

  finish("M2-A Identity Policy（纯逻辑）");
  console.log(`IDENTITY_TAKEOVER_BLOCKED = ${takeoverBlocked ? "PASS" : "FAIL"}`);
  console.log(`BACKFILL_CANNOT_OVERWRITE_VERIFIED = ${backfillCannotOverwrite ? "PASS" : "FAIL"}`);
  console.log(`TENANT_FORGERY_BLOCKED = ${tenantForgeryBlocked ? "PASS" : "FAIL"}`);
  console.log(`TENANT_KEY_ISOLATION = ${tenantKeyIsolation ? "PASS" : "FAIL"}`);
  console.log(`SELF_LINK_ABSENT = ${selfLinkAbsent ? "PASS" : "FAIL"}`);
  console.log(`UNVERIFIED_IDENTITY_DENIED = ${unverifiedDenied ? "PASS" : "FAIL"}`);
  console.log(`OWNERSHIP_GATE_FAIL_CLOSED = ${ownershipFailClosed ? "PASS" : "FAIL"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
