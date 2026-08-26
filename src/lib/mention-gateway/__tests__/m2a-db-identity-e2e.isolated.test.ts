/**
 * Mention Gateway M2-A — DB 身份源端到端（隔离库专用）
 * 运行：DATABASE_URL=<隔离库> DIRECT_URL=<同> NODE_ENV=test npx tsx src/lib/mention-gateway/__tests__/m2a-db-identity-e2e.isolated.test.ts
 *
 * 链路：真实 ExternalIdentity（DB 源）→ 真实 User/OrganizationMember/resolveAgentTenant
 * → fixture 频道绑定 → 真实 resolveAgentScope（真实 Project/ProjectMember）
 * → fake runtime（无 LLM）。验证 M2-C 工具策略、B2 事件序、身份状态门在 DB 源下全部保持。
 *
 * guard-first：顶层不 import "@/lib/db"；未配置 DATABASE_URL → skip（exit 0）。
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 Mention M2-A DB E2E（未提供 DATABASE_URL）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "mention-gateway m2a db identity e2e" });
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 Mention M2-A DB E2E（需 NODE_ENV=test）");
    process.exit(0);
  }
}

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

async function main() {
  requireIsolatedTestDb();
  const { db } = await import("@/lib/db");
  const svc = await import("../identity-service");
  const { createDefaultIdentityDeps } = await import("../identity");
  const { handleMentionEvent, createDefaultMentionGatewayDeps, DuplicateEventGuard } =
    await import("../handle");
  const { PROJECT_CONTEXT_TOOLS } = await import("../policy");
  const { resolveAgentScope } = await import("@/lib/agent-scope/resolve");
  const { makeFakeDeps, baseRaw, TEST_ENV, isCode } = await import("./helpers");

  const tag = `m2ae_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const CHAN = `db-chan-${tag}`;
  const EXT_MAIN = `ext_main_${tag}`;
  const EXT_PENDING = `ext_pending_${tag}`;
  const EXT_LEGACY = `ext_legacy_${tag}`;
  const EXT_REMOVED = `ext_removed_${tag}`;
  const EXT_OTHER_TENANT = `ext_other_tenant_${tag}`;

  const mkUser = (label: string, role = "sales") =>
    db.user.create({
      data: { email: `${label}_${tag}@test.qingyan.local`, name: label, role, status: "active" },
    });
  const [admin, mainUser, pendingUser, legacyUser, removedUser, tenantUser] =
    await Promise.all([
      mkUser("e2e_admin"),
      mkUser("e2e_main"),
      mkUser("e2e_pending"),
      mkUser("e2e_legacy"),
      mkUser("e2e_removed"),
      mkUser("e2e_tenant"),
    ]);
  const org = await db.organization.create({
    data: { name: `M2A E2E Org ${tag}`, code: `m2ae_${tag}`, ownerId: admin.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: org.id, userId: admin.id, role: "org_admin", status: "active" },
      { orgId: org.id, userId: mainUser.id, role: "org_member", status: "active" },
      { orgId: org.id, userId: pendingUser.id, role: "org_member", status: "active" },
      { orgId: org.id, userId: legacyUser.id, role: "org_member", status: "active" },
      { orgId: org.id, userId: removedUser.id, role: "org_member", status: "inactive" },
      { orgId: org.id, userId: tenantUser.id, role: "org_member", status: "active" },
    ],
  });
  const project = await db.project.create({
    data: { orgId: org.id, ownerId: admin.id, name: `M2A E2E Project ${tag}`, status: "active" },
  });
  await db.projectMember.createMany({
    data: [mainUser, pendingUser, legacyUser, removedUser, tenantUser].map((u) => ({
      projectId: project.id,
      userId: u.id,
      role: "manager",
      status: "active",
    })),
  });

  // 身份：主链路走 adminProvisionIdentity（mock/mock 在 test 运行时 OWNED）；其余状态直接种行
  const provisioned = await svc.adminProvisionIdentity({
    caller: { userId: admin.id, role: admin.role },
    managementOrgId: org.id,
    provider: "mock",
    providerTenantId: "mock",
    providerUserId: EXT_MAIN,
    targetUserId: mainUser.id,
  });
  ok(provisioned.ok, "前置：adminProvisionIdentity(mock/mock) → ACTIVE", provisioned);
  const pendingIdentity = await db.externalIdentity.create({
    data: { provider: "mock", providerTenantId: "mock", providerUserId: EXT_PENDING, userId: pendingUser.id, status: "PENDING", verificationMethod: "LEGACY_SELF_ASSERTED" },
  });
  await db.externalIdentity.create({
    data: { provider: "mock", providerTenantId: "mock", providerUserId: EXT_LEGACY, userId: legacyUser.id, status: "ACTIVE", verificationMethod: "LEGACY_SELF_ASSERTED" },
  });
  await db.externalIdentity.create({
    data: { provider: "mock", providerTenantId: "mock", providerUserId: EXT_REMOVED, userId: removedUser.id, status: "ACTIVE", verificationMethod: "ADMIN_PROVISIONED" },
  });
  await db.externalIdentity.create({
    data: { provider: "mock", providerTenantId: "corp_elsewhere", providerUserId: EXT_OTHER_TENANT, userId: tenantUser.id, status: "ACTIVE", verificationMethod: "ADMIN_PROVISIONED" },
  });

  const ENV_DB = { ...TEST_ENV, MENTION_GATEWAY_IDENTITY_SOURCE: "db" };

  function makeDbDeps() {
    const fake = makeFakeDeps();
    const deps = {
      ...fake.deps,
      identity: createDefaultIdentityDeps({
        lookupExternalIdentity: (provider, providerTenantId, externalUserId) =>
          svc.lookupExternalIdentityRecord(provider, providerTenantId, externalUserId),
      }),
      context: {
        async lookupChannelBinding(provider: "mock", _tenant: string, channelId: string) {
          if (channelId !== CHAN) return { status: "none" as const };
          return {
            status: "found" as const,
            binding: {
              provider,
              channelId,
              organizationId: org.id,
              contextType: "project" as const,
              contextId: project.id,
            },
          };
        },
        resolveAgentScope,
        async buildContextBlock() {
          return "";
        },
      },
      duplicateGuard: new DuplicateEventGuard(),
    };
    return { ...fake, deps };
  }

  let dbIdentityE2ePass = false;
  let pendingDenied = false;
  let unverifiedDenied = false;
  let membershipRevocationEnforced = false;
  let tenantBoundaryEnforced = false;
  let sourceFailClosed = false;

  console.log("E2E-1 Happy Path：DB ExternalIdentity → 真实 membership/scope → M2-C project 工具面");
  {
    const { deps, adapter, runOptions, events } = makeDbDeps();
    const r = await handleMentionEvent({
      raw: baseRaw({ externalUserId: EXT_MAIN, channelId: CHAN }),
      adapter,
      deps,
      env: ENV_DB,
    });
    ok(r.ok && r.status === "completed", "completed", r);
    dbIdentityE2ePass = r.ok;
    if (r.ok) {
      ok(r.context.type === "project" && r.context.id === project.id, "context = 真实 Project");
      ok(r.delivered && r.audience === "initiating_user_only", "只回 initiating user");
    }
    const opts = runOptions[0];
    ok(opts !== undefined && sameSet(opts.tools ?? [], PROJECT_CONTEXT_TOOLS), "tools === PROJECT_CONTEXT_TOOLS（M2-C 8 工具面不因 DB 源改变）");
    ok(opts?.maxRisk === "l0_read", "maxRisk = l0_read");
    ok(opts?.orgId === org.id && opts?.userId === mainUser.id, "orgId/userId 来自真实 DB 链路");
    ok(opts?.hasMembership === true && opts?.scopeGuard?.projectId === project.id, "hasMembership + scopeGuard.projectId 真实");
    ok(adapter.outbox.length === 1 && adapter.outbox[0].target.externalUserId === EXT_MAIN, "DM 回到外部身份本人");
    const types = events.map((e) => e.eventType);
    ok(types.indexOf("response.completed") !== -1 && types.indexOf("response.completed") < types.indexOf("run.completed"), "B2：response.completed 先于 run.completed（DB 源不变）");
  }

  console.log("E2E-2 身份源开关：db 源查 DB，fixture 源查 fixture（互不串）");
  {
    const dbDeps = createDefaultMentionGatewayDeps(ENV_DB);
    const viaDb = await dbDeps.identity.lookupExternalIdentity("mock", "mock", EXT_MAIN);
    ok(viaDb?.userId === mainUser.id && viaDb?.status === "ACTIVE" && viaDb?.verificationMethod === "ADMIN_PROVISIONED", "db 源命中真实 ExternalIdentity（真实 status/method）");
    const fixtureDeps = createDefaultMentionGatewayDeps(TEST_ENV);
    ok((await fixtureDeps.identity.lookupExternalIdentity("mock", "mock", EXT_MAIN)) === null, "fixture 源查不到 DB 身份（默认语义 = M1 不变）");
    ok((await dbDeps.identity.lookupExternalIdentity("mock", "mock", "mock-user-a")) === null, "db 源查不到 fixture 身份（不 fallback）");
  }

  console.log("E2E-3 PENDING 身份 → DENY；失败不污染 dedupe；verify 后同 eventId 放行");
  {
    const { deps, adapter } = makeDbDeps();
    const evt = { externalUserId: EXT_PENDING, channelId: CHAN, eventId: `evt-pending-${tag}` };
    const denied = await handleMentionEvent({ raw: baseRaw(evt), adapter, deps, env: ENV_DB });
    ok(isCode(denied, "IDENTITY_OR_MEMBERSHIP_DENIED") && denied.ok === false && denied.stage === "identity", "PENDING → IDENTITY_OR_MEMBERSHIP_DENIED（stage=identity）");
    pendingDenied = isCode(denied, "IDENTITY_OR_MEMBERSHIP_DENIED");
    ok(deps.duplicateGuard.size() === 0 && adapter.outbox.length === 0, "被拒事件未写 dedupe、未外发");
    const verified = await svc.verifyIdentity({
      caller: { userId: admin.id, role: admin.role },
      managementOrgId: org.id,
      identityId: pendingIdentity.id,
    });
    ok(verified.ok, "管理员 verify → ACTIVE/ADMIN_PROVISIONED", verified);
    const after = await handleMentionEvent({ raw: baseRaw(evt), adapter, deps, env: ENV_DB });
    ok(after.ok === true, "verify 后同 eventId → 正常执行（此前失败未预占键）");
  }

  console.log("E2E-4 LEGACY_SELF_ASSERTED ACTIVE：缺省拒；显式关闭 REQUIRE_VERIFIED 才放行");
  {
    const { deps, adapter } = makeDbDeps();
    const evt = { externalUserId: EXT_LEGACY, channelId: CHAN, eventId: `evt-legacy-${tag}` };
    const denied = await handleMentionEvent({ raw: baseRaw(evt), adapter, deps, env: ENV_DB });
    ok(isCode(denied, "IDENTITY_OR_MEMBERSHIP_DENIED"), "缺省 REQUIRE_VERIFIED=true → 拒（回填身份不能直接用）");
    unverifiedDenied = isCode(denied, "IDENTITY_OR_MEMBERSHIP_DENIED");
    const allowed = await handleMentionEvent({
      raw: baseRaw({ ...evt, eventId: `evt-legacy2-${tag}` }),
      adapter,
      deps,
      env: { ...ENV_DB, MENTION_GATEWAY_REQUIRE_VERIFIED_IDENTITY: "0" },
    });
    ok(allowed.ok === true, "显式 MENTION_GATEWAY_REQUIRE_VERIFIED_IDENTITY=0 → 放行（运维显式选择）");
  }

  console.log("E2E-5 membership 撤销即失效：身份 ACTIVE 但 OrganizationMember inactive → 拒");
  {
    const { deps, adapter, calls } = makeDbDeps();
    const denied = await handleMentionEvent({
      raw: baseRaw({ externalUserId: EXT_REMOVED, channelId: CHAN, eventId: `evt-removed-${tag}` }),
      adapter,
      deps,
      env: ENV_DB,
    });
    ok(isCode(denied, "IDENTITY_OR_MEMBERSHIP_DENIED"), "EXTERNAL_IDENTITY_DOES_NOT_GRANT_ORG_ACCESS：无在职 membership → 拒");
    membershipRevocationEnforced = isCode(denied, "IDENTITY_OR_MEMBERSHIP_DENIED");
    ok(calls.filter((c) => c.name === "createRun").length === 0 && adapter.outbox.length === 0, "未建 Run / 未外发");
  }

  console.log("E2E-6 租户边界：身份存于其它 providerTenantId → mock 事件（tenant=mock）查不到 → 拒");
  {
    const { deps, adapter } = makeDbDeps();
    const denied = await handleMentionEvent({
      raw: baseRaw({ externalUserId: EXT_OTHER_TENANT, channelId: CHAN, eventId: `evt-tenant-${tag}` }),
      adapter,
      deps,
      env: ENV_DB,
    });
    ok(isCode(denied, "IDENTITY_OR_MEMBERSHIP_DENIED"), "跨租户身份不可见（unknown_external_user）");
    tenantBoundaryEnforced = isCode(denied, "IDENTITY_OR_MEMBERSHIP_DENIED");
    ok(adapter.outbox.length === 0, "未外发");
  }

  console.log("E2E-7 身份源配置非法 → GATEWAY_DISABLED（fail closed，不 fallback fixture）");
  {
    const { deps, adapter, calls } = makeDbDeps();
    const r = await handleMentionEvent({
      raw: baseRaw({ externalUserId: EXT_MAIN, channelId: CHAN, eventId: `evt-bad-src-${tag}` }),
      adapter,
      deps,
      env: { ...TEST_ENV, MENTION_GATEWAY_IDENTITY_SOURCE: "database" },
    });
    ok(isCode(r, "GATEWAY_DISABLED"), "非法 MENTION_GATEWAY_IDENTITY_SOURCE → GATEWAY_DISABLED");
    sourceFailClosed = isCode(r, "GATEWAY_DISABLED");
    ok(calls.length === 0 && adapter.outbox.length === 0, "未触达任何依赖 / 未外发");
  }

  console.log(`\nM2-A DB Identity E2E 结果: ${pass} 通过, ${fail} 失败`);
  console.log(`DB_IDENTITY_E2E = ${dbIdentityE2ePass ? "PASS" : "FAIL"}`);
  console.log(`PENDING_IDENTITY_DENIED = ${pendingDenied ? "PASS" : "FAIL"}`);
  console.log(`UNVERIFIED_IDENTITY_DENIED_E2E = ${unverifiedDenied ? "PASS" : "FAIL"}`);
  console.log(`MEMBERSHIP_REVOCATION_ENFORCED = ${membershipRevocationEnforced ? "PASS" : "FAIL"}`);
  console.log(`TENANT_BOUNDARY_ENFORCED = ${tenantBoundaryEnforced ? "PASS" : "FAIL"}`);
  console.log(`IDENTITY_SOURCE_FAIL_CLOSED = ${sourceFailClosed ? "PASS" : "FAIL"}`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
