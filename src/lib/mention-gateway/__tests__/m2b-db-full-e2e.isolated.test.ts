/**
 * Mention Gateway M2-B — DB 身份 + DB 绑定 全链路 E2E（隔离库专用；§45 HARD GATE）
 * 运行：DATABASE_URL=<隔离库> DIRECT_URL=<同> NODE_ENV=test npx tsx src/lib/mention-gateway/__tests__/m2b-db-full-e2e.isolated.test.ts
 *
 * 链路（真实默认 deps 装配，仅 runtime/dedupe 为 fake，无 LLM）：
 *   Mock adapter(providerTenantId="mock") → ExternalIdentity(DB) → User/OrganizationMember
 *   → ChannelContextBinding(DB，经真实 binding-service 创建) → Project/SalesCustomer
 *   → resolveAgentTenant → resolveAgentScope → M2-C 上下文工具面 → AgentRun → mock delivery
 *
 * 覆盖：§41 thread precedence 矩阵（DISABLED/REVOKED fallback；ACTIVE-invalid FAIL CLOSED 不 fallback）
 * / §46 负向 / B5 dedupe（binding/scope/DB 失败零污染）/ B2 事件序 / M2-C project 8 + customer 3。
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 Mention M2-B 全链路 E2E（未提供 DATABASE_URL）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "mention-gateway m2b db full e2e" });
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 Mention M2-B 全链路 E2E（需 NODE_ENV=test）");
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
  const identitySvc = await import("../identity-service");
  const bindingSvc = await import("../binding-service");
  const { lookupPersistentChannelBinding } = await import("../binding-lookup");
  const { createDefaultMentionGatewayDeps, handleMentionEvent, DuplicateEventGuard } =
    await import("../handle");
  const { PROJECT_CONTEXT_TOOLS, CUSTOMER_CONTEXT_TOOLS, ORG_WIDE_SALES_TOOLS } =
    await import("../policy");
  const { makeFakeDeps, baseRaw, TEST_ENV, isCode } = await import("./helpers");

  const tag = `m2be_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const CH_PROJ = `e2e-proj-chan-${tag}`;
  const CH_CUST = `e2e-cust-chan-${tag}`;
  const CH_DENY = `e2e-deny-chan-${tag}`;
  const T1 = `e2e-thread1-${tag}`;
  const T3 = `e2e-thread3-${tag}`;
  const EXT = `ext_${tag}`;

  const mkUser = (label: string, role = "sales") =>
    db.user.create({
      data: { email: `${label}_${tag}@test.qingyan.local`, name: label, role, status: "active" },
    });
  const [padmin, admin, member, otherSales] = await Promise.all([
    mkUser("m2be_padmin", "admin"),
    mkUser("m2be_admin"),
    mkUser("m2be_member"),
    mkUser("m2be_other"),
  ]);
  const org = await db.organization.create({
    data: { name: `M2BE Org ${tag}`, code: `m2be_${tag}`, ownerId: admin.id, status: "active" },
  });
  const orgOther = await db.organization.create({
    data: { name: `M2BE Other ${tag}`, code: `m2beo_${tag}`, ownerId: padmin.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: org.id, userId: admin.id, role: "org_admin", status: "active" },
      { orgId: org.id, userId: member.id, role: "org_member", status: "active" },
      { orgId: org.id, userId: otherSales.id, role: "org_member", status: "active" },
      { orgId: orgOther.id, userId: padmin.id, role: "org_admin", status: "active" },
    ],
  });
  const projA = await db.project.create({
    data: { orgId: org.id, ownerId: admin.id, name: `M2BE PA ${tag}`, status: "active" },
  });
  const projB = await db.project.create({
    data: { orgId: org.id, ownerId: admin.id, name: `M2BE PB ${tag}`, status: "active" },
  });
  await db.projectMember.createMany({
    data: [projA, projB].map((p) => ({
      projectId: p.id,
      userId: member.id,
      role: "manager",
      status: "active",
    })),
  });
  const customer = await db.salesCustomer.create({
    data: { orgId: org.id, name: `M2BE Cust ${tag}`, createdById: member.id },
  });
  const customerOfOther = await db.salesCustomer.create({
    data: { orgId: org.id, name: `M2BE CustX ${tag}`, createdById: otherSales.id },
  });

  // DB 身份（M2-A 真实服务）
  const provisioned = await identitySvc.adminProvisionIdentity({
    caller: { userId: admin.id, role: admin.role },
    managementOrgId: org.id,
    provider: "mock",
    providerTenantId: "mock",
    providerUserId: EXT,
    targetUserId: member.id,
  });
  ok(provisioned.ok, "前置：ExternalIdentity ACTIVE/ADMIN_PROVISIONED", provisioned);

  // DB 绑定（M2-B 真实服务；mock/mock 在 test 运行时 OWNED）
  const padminCaller = { userId: padmin.id, role: padmin.role };
  const mkBinding = (over: Record<string, unknown>) =>
    bindingSvc.createChannelBinding({
      caller: padminCaller,
      managementOrgId: org.id,
      provider: "mock",
      providerTenantId: "mock",
      targetType: "project",
      targetId: projA.id,
      providerChannelId: CH_PROJ,
      ...over,
    } as never);
  const bChan = await mkBinding({});
  const bThread = await mkBinding({ providerThreadId: T1, targetId: projB.id });
  const bCust = await mkBinding({ providerChannelId: CH_CUST, targetType: "customer", targetId: customer.id });
  const bDeny = await mkBinding({ providerChannelId: CH_DENY, targetType: "customer", targetId: customerOfOther.id });
  ok(bChan.ok && bThread.ok && bCust.ok && bDeny.ok, "前置：channel→PA / thread T1→PB / customer / deny-customer 绑定就绪");

  const ENV = {
    ...TEST_ENV,
    MENTION_GATEWAY_IDENTITY_SOURCE: "db",
    MENTION_GATEWAY_BINDING_SOURCE: "db",
  };

  // 真实默认 deps（identity/db + binding/db + 真实 scope/contextBlock），仅 runtime + dedupe 用 fake
  function makeE2eDeps() {
    const fake = makeFakeDeps();
    const defaults = createDefaultMentionGatewayDeps(ENV);
    const deps = {
      identity: defaults.identity,
      context: defaults.context,
      runtime: fake.deps.runtime,
      duplicateGuard: new DuplicateEventGuard(),
      now: () => new Date(),
    };
    return { ...fake, deps };
  }
  const raw = (over: Record<string, unknown> = {}) =>
    baseRaw({ externalUserId: EXT, channelId: CH_PROJ, ...over });

  let fullE2e = false;
  let threadPrecedence = true;
  let invalidActiveNoFallback = false;
  let projectPolicy = false;
  let customerPolicy = false;
  let bindingPoison = true;
  let scopePoison = true;

  console.log("E2E-1 Happy Path：DB 身份 + DB channel 绑定 → PA + M2-C project 工具面 + B2 事件序");
  {
    const { deps, adapter, runOptions, events } = makeE2eDeps();
    const r = await handleMentionEvent({ raw: raw({ eventId: `e1-${tag}` }), adapter, deps, env: ENV });
    ok(r.ok === true && r.status === "completed", "completed", r);
    fullE2e = r.ok === true;
    if (r.ok) ok(r.context.type === "project" && r.context.id === projA.id, "context = channel 绑定的真实 Project A");
    const opts = runOptions[0];
    ok(opts !== undefined && sameSet(opts.tools ?? [], PROJECT_CONTEXT_TOOLS), "tools === PROJECT_CONTEXT_TOOLS（恰 8）");
    projectPolicy = opts !== undefined && sameSet(opts.tools ?? [], PROJECT_CONTEXT_TOOLS);
    ok(!(opts?.tools ?? []).some((t) => (ORG_WIDE_SALES_TOOLS as readonly string[]).includes(t)), "org-wide sales 工具未开放");
    ok(opts?.maxRisk === "l0_read" && opts?.scopeGuard?.projectId === projA.id && opts?.orgId === org.id, "l0_read + scopeGuard 真实对象");
    ok(adapter.outbox.length === 1 && adapter.outbox[0].target.externalUserId === EXT, "DM 只回 initiating user");
    const types = events.map((e) => e.eventType);
    ok(types.indexOf("response.completed") !== -1 && types.indexOf("response.completed") < types.indexOf("run.completed"), "B2：response.completed < run.completed（不变）");
  }

  console.log("E2E-2 §41 thread precedence：T1→PB；未知线程→channel PA；DISABLED/REVOKED thread → PA");
  {
    const { deps, adapter, runOptions } = makeE2eDeps();
    const run = (eventId: string, threadId?: string) =>
      handleMentionEvent({
        // messageId 跟随 eventId：fake runtime 按 userMessageId 幂等（org 作用域），共享频道需区分
        raw: raw({ eventId, messageId: `m-${eventId}`, ...(threadId ? { threadId, channelType: "thread" } : {}) }),
        adapter,
        deps,
        env: ENV,
      });
    const rT1 = await run(`e2a-${tag}`, T1);
    ok(rT1.ok === true && rT1.ok && rT1.context.id === projB.id, "event T1 → thread 绑定 PB（thread > channel）");
    if (!(rT1.ok && rT1.context.id === projB.id)) threadPrecedence = false;
    const rT2 = await run(`e2b-${tag}`, `unknown-thread-${tag}`);
    ok(rT2.ok === true && rT2.ok && rT2.context.id === projA.id, "未知线程 T2 → fallback channel PA");
    if (!(rT2.ok && rT2.context.id === projA.id)) threadPrecedence = false;

    const threadBindingId = bThread.ok ? bThread.binding.id : "";
    const d = await bindingSvc.disableChannelBinding({ caller: padminCaller, managementOrgId: org.id, bindingId: threadBindingId });
    ok(d.ok, "thread 绑定 DISABLED");
    const rDisabled = await run(`e2c-${tag}`, T1);
    ok(rDisabled.ok === true && rDisabled.ok && rDisabled.context.id === projA.id, "DISABLED thread → 视为不存在 → fallback PA");
    if (!(rDisabled.ok && rDisabled.context.id === projA.id)) threadPrecedence = false;

    const e = await bindingSvc.enableChannelBinding({ caller: padminCaller, managementOrgId: org.id, bindingId: threadBindingId });
    ok(e.ok, "thread 绑定恢复 ACTIVE");
    const rBack = await run(`e2d-${tag}`, T1);
    ok(rBack.ok === true && rBack.ok && rBack.context.id === projB.id, "恢复后 T1 → PB");

    const rv = await bindingSvc.revokeChannelBinding({ caller: padminCaller, managementOrgId: org.id, bindingId: threadBindingId, reason: "test" });
    ok(rv.ok, "thread 绑定 REVOKED（终态）");
    const rRevoked = await run(`e2e-${tag}`, T1);
    ok(rRevoked.ok === true && rRevoked.ok && rRevoked.context.id === projA.id, "REVOKED thread → fallback PA");
    if (!(rRevoked.ok && rRevoked.context.id === projA.id)) threadPrecedence = false;
    ok(runOptions.length >= 5, "以上均真实走 runtime");
  }

  console.log("E2E-3 §41 硬安全：ACTIVE thread 绑定但 org invalid → FAIL CLOSED，绝不 fallback channel");
  {
    // 直插损坏行：ACTIVE thread T3 → orgOther（与身份 org 不符）
    await db.channelContextBinding.create({
      data: { provider: "mock", providerTenantId: "mock", providerChannelId: CH_PROJ, providerThreadId: T3, bindingLevel: "THREAD", orgId: orgOther.id, projectId: projB.id, status: "ACTIVE" },
    });
    const { deps, adapter } = makeE2eDeps();
    const r = await handleMentionEvent({
      raw: raw({ eventId: `e3-${tag}`, threadId: T3, channelType: "thread" }),
      adapter,
      deps,
      env: ENV,
    });
    ok(isCode(r, "CONTEXT_UNRESOLVED"), "org-invalid ACTIVE thread → CONTEXT_UNRESOLVED（fail closed）", r);
    invalidActiveNoFallback = isCode(r, "CONTEXT_UNRESOLVED");
    ok(adapter.outbox.length === 0, "未外发（未落到 channel 绑定 PA）");
    ok(deps.duplicateGuard.size() === 0, "fail-closed 未消耗 dedupe key");
    if (deps.duplicateGuard.size() !== 0) bindingPoison = false;
    // ownership-invalid 直接在 resolver 层面证明（personal_wechat 租户不属本 org）
    const gwOther = await db.weChatGateway.create({ data: { orgId: orgOther.id, channel: "personal_wechat", status: "active" } });
    await db.channelContextBinding.create({
      data: { provider: "personal_wechat", providerTenantId: gwOther.id, providerChannelId: `own-${tag}`, providerThreadId: "", bindingLevel: "CHANNEL", orgId: org.id, projectId: projA.id, status: "ACTIVE" },
    });
    const own = await lookupPersistentChannelBinding({
      provider: "personal_wechat",
      providerTenantId: gwOther.id,
      providerChannelId: `own-${tag}`,
      expectedOrgId: org.id,
    });
    ok(own.status === "fail_closed" && own.reason === "binding_ownership_invalid", "ACTIVE 行 ownership 非 OWNED → fail_closed（binding_ownership_invalid）");
  }

  console.log("E2E-4 customer 绑定：sales 上下文 + M2-C customer 工具面（恰 3）");
  {
    const { deps, adapter, runOptions } = makeE2eDeps();
    const r = await handleMentionEvent({
      raw: raw({ eventId: `e4-${tag}`, channelId: CH_CUST }),
      adapter,
      deps,
      env: ENV,
    });
    ok(r.ok === true && r.ok && r.context.type === "sales" && r.context.id === customer.id, "customer 绑定 → sales 上下文", r);
    const opts = runOptions[0];
    customerPolicy = opts !== undefined && sameSet(opts.tools ?? [], CUSTOMER_CONTEXT_TOOLS);
    ok(customerPolicy, "tools === CUSTOMER_CONTEXT_TOOLS（恰 3：get_customer/quotes/interactions）");
    ok(opts?.scopeGuard?.customerId === customer.id, "scopeGuard.customerId = 绑定客户（M2-C C1）");
    ok(adapter.outbox.length === 1, "正常回复");
  }

  console.log("E2E-5 §46 负向：no binding / scope denied / 身份态 / membership 撤销 / DB fail-closed；B5 dedupe 全程零污染");
  {
    const { deps, adapter } = makeE2eDeps();
    const noBinding = await handleMentionEvent({
      raw: raw({ eventId: `e5a-${tag}`, channelId: `unbound-${tag}` }),
      adapter,
      deps,
      env: ENV,
    });
    ok(isCode(noBinding, "CONTEXT_UNRESOLVED"), "无绑定 → CONTEXT_UNRESOLVED");
    ok(deps.duplicateGuard.size() === 0, "binding 失败零 dedupe");
    if (deps.duplicateGuard.size() !== 0) bindingPoison = false;

    const scopeDenied = await handleMentionEvent({
      raw: raw({ eventId: `e5b-${tag}`, channelId: CH_DENY }),
      adapter,
      deps,
      env: ENV,
    });
    ok(isCode(scopeDenied, "SCOPE_DENIED"), "他人客户（sales own-scope）→ SCOPE_DENIED（binding 只是 selector，不是授权）");
    ok(deps.duplicateGuard.size() === 0, "scope 失败零 dedupe");
    if (deps.duplicateGuard.size() !== 0) scopePoison = false;

    // 修复语义：同 eventId 在 scope 修复后可正常执行（改绑到 member 自己的客户）
    const denyId = bDeny.ok ? bDeny.binding.id : "";
    const fix = await bindingSvc.rebindChannelBinding({ caller: padminCaller, managementOrgId: org.id, bindingId: denyId, targetType: "customer", targetId: customer.id });
    ok(fix.ok, "管理员显式 rebind → member 自己的客户");
    const retry = await handleMentionEvent({
      raw: raw({ eventId: `e5b-${tag}`, channelId: CH_DENY }),
      adapter,
      deps,
      env: ENV,
    });
    ok(retry.ok === true, "修复后同 eventId → 正常执行（此前失败未预占键）");

    // binding DB fail-closed（模拟 DB 异常路径的 deps 契约）：不 fallback fixture、零 dedupe
    const failingDeps = {
      ...deps,
      context: {
        ...deps.context,
        async lookupChannelBinding() {
          return { status: "fail_closed" as const, reason: "binding_lookup_error" };
        },
      },
      duplicateGuard: new DuplicateEventGuard(),
    };
    const dbDown = await handleMentionEvent({
      raw: raw({ eventId: `e5c-${tag}` }),
      adapter,
      deps: failingDeps,
      env: ENV,
    });
    ok(isCode(dbDown, "CONTEXT_UNRESOLVED"), "binding DB 不可用 → CONTEXT_UNRESOLVED（不 fallback fixture）");
    ok(failingDeps.duplicateGuard.size() === 0, "DB 失败零 dedupe");
    if (failingDeps.duplicateGuard.size() !== 0) bindingPoison = false;

    // 身份态负向（M2-A 回归）：PENDING / membership 撤销
    const pendingUser = await mkUser("m2be_pending");
    await db.organizationMember.create({ data: { orgId: org.id, userId: pendingUser.id, role: "org_member", status: "active" } });
    await db.externalIdentity.create({
      data: { provider: "mock", providerTenantId: "mock", providerUserId: `pend_${tag}`, userId: pendingUser.id, status: "PENDING", verificationMethod: "LEGACY_SELF_ASSERTED" },
    });
    const pending = await handleMentionEvent({
      raw: raw({ eventId: `e5d-${tag}`, externalUserId: `pend_${tag}` }),
      adapter,
      deps,
      env: ENV,
    });
    ok(isCode(pending, "IDENTITY_OR_MEMBERSHIP_DENIED"), "PENDING 身份 → 在 binding 之前拒");

    await db.organizationMember.update({
      where: { orgId_userId: { orgId: org.id, userId: member.id } },
      data: { status: "inactive" },
    });
    const removed = await handleMentionEvent({
      raw: raw({ eventId: `e5e-${tag}` }),
      adapter,
      deps,
      env: ENV,
    });
    ok(isCode(removed, "IDENTITY_OR_MEMBERSHIP_DENIED"), "membership 撤销 → 拒（binding 不授予 org 访问）");
    await db.organizationMember.update({
      where: { orgId_userId: { orgId: org.id, userId: member.id } },
      data: { status: "active" },
    });
    ok(deps.duplicateGuard.size() === 1, "所有负向路径零 dedupe 消耗（仅成功 retry 的 1 个键在）");
  }

  console.log(`\nM2-B DB 全链路 E2E 结果: ${pass} 通过, ${fail} 失败`);
  console.log(`DB_IDENTITY_AND_BINDING_E2E = ${fullE2e ? "PASS" : "FAIL"}`);
  console.log(`THREAD_PRECEDENCE_E2E = ${threadPrecedence ? "PASS" : "FAIL"}`);
  console.log(`INVALID_ACTIVE_THREAD_NO_FALLBACK = ${invalidActiveNoFallback ? "PASS" : "FAIL"}`);
  console.log(`PROJECT_BINDING_E2E = ${projectPolicy ? "PASS" : "FAIL"}`);
  console.log(`CUSTOMER_BINDING_E2E = ${customerPolicy ? "PASS" : "FAIL"}`);
  console.log(`FAILED_BINDING_CANNOT_POISON_DEDUPE = ${bindingPoison ? "PASS" : "FAIL"}`);
  console.log(`FAILED_SCOPE_CANNOT_POISON_DEDUPE = ${scopePoison ? "PASS" : "FAIL"}`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
