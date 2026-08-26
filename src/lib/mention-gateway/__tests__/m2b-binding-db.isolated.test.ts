/**
 * Mention Gateway M2-B — ChannelContextBinding DB 集成测试（隔离库专用）
 * 运行：DATABASE_URL=<隔离库> DIRECT_URL=<同> NODE_ENV=test npx tsx src/lib/mention-gateway/__tests__/m2b-binding-db.isolated.test.ts
 *
 * guard-first：顶层不 import "@/lib/db"；未配置 DATABASE_URL → skip（exit 0）。
 *
 * 覆盖：CHECK 约束（sentinel/XOR/contextRole）/ 唯一键（§40）/ 创建语义（NO BLIND UPSERT）/
 * ownership fail-closed / project 权限决策表（§16）/ personal project 硬拒（§38）/
 * customer canonical 权限（§18，真实 RoleProfile+PrincipalRoleBinding）/ 生命周期 + REVOKED 终态 /
 * CAS（§25）/ rebind 矩阵（§42）/ 管理可见性（§24）/ 跨租户并存（§39）/ 审计原子 + hash 隐私。
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 Mention M2-B DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "mention-gateway m2b binding db test" });
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 Mention M2-B DB 测试（需 NODE_ENV=test）");
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

async function main() {
  requireIsolatedTestDb();
  const { db } = await import("@/lib/db");
  const svc = await import("../binding-service");
  const { lookupPersistentChannelBinding } = await import("../binding-lookup");
  const { AUDIT_ACTIONS } = await import("@/lib/audit/logger");
  const { seedOrgAuthorizationProfiles } = await import(
    "@/lib/authorization/seed-org-profiles"
  );

  const tag = `m2b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mkUser = (label: string, role = "sales") =>
    db.user.create({
      data: { email: `${label}_${tag}@test.qingyan.local`, name: label, role, status: "active" },
    });

  const [padmin, ownerA, orgAdminA, projAdminA, viewerA, salesRepA, salesRepA2, adminB] =
    await Promise.all([
      mkUser("m2b_padmin", "admin"),
      mkUser("m2b_owner_a"),
      mkUser("m2b_orgadmin_a"),
      mkUser("m2b_projadmin_a"),
      mkUser("m2b_viewer_a"),
      mkUser("m2b_salesrep_a"),
      mkUser("m2b_salesrep_a2"),
      mkUser("m2b_admin_b"),
    ]);
  const orgA = await db.organization.create({
    data: { name: `M2B Org A ${tag}`, code: `m2b_a_${tag}`, ownerId: orgAdminA.id, status: "active" },
  });
  const orgB = await db.organization.create({
    data: { name: `M2B Org B ${tag}`, code: `m2b_b_${tag}`, ownerId: adminB.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: ownerA.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: orgAdminA.id, role: "org_admin", status: "active" },
      { orgId: orgA.id, userId: projAdminA.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: viewerA.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: salesRepA.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: salesRepA2.id, role: "org_member", status: "active" },
      { orgId: orgB.id, userId: adminB.id, role: "org_admin", status: "active" },
    ],
  });
  // canonical sales 授权面：系统 RoleProfile + sales_rep 绑定（authorize 的真实事实源）
  await seedOrgAuthorizationProfiles(orgA.id);
  const salesRepProfile = await db.roleProfile.findUnique({
    where: { orgId_key: { orgId: orgA.id, key: "sales_rep" } },
    select: { id: true },
  });
  ok(!!salesRepProfile, "前置：sales_rep RoleProfile 已 seed");
  await db.principalRoleBinding.createMany({
    data: [salesRepA, salesRepA2].map((u) => ({
      orgId: orgA.id,
      principalType: "HUMAN",
      principalId: u.id,
      roleProfileId: salesRepProfile!.id,
    })),
  });

  const projA = await db.project.create({
    data: { orgId: orgA.id, ownerId: ownerA.id, name: `M2B Proj A ${tag}`, status: "active" },
  });
  const projA2 = await db.project.create({
    data: { orgId: orgA.id, ownerId: orgAdminA.id, name: `M2B Proj A2 ${tag}`, status: "active" },
  });
  const projB = await db.project.create({
    data: { orgId: orgB.id, ownerId: adminB.id, name: `M2B Proj B ${tag}`, status: "active" },
  });
  const personalP = await db.project.create({
    data: { orgId: null, ownerId: ownerA.id, name: `M2B Personal ${tag}`, status: "active" },
  });
  await db.projectMember.createMany({
    data: [
      { projectId: projA.id, userId: projAdminA.id, role: "project_admin", status: "active" },
      { projectId: projA.id, userId: viewerA.id, role: "operator", status: "active" },
    ],
  });
  const customerA = await db.salesCustomer.create({
    data: { orgId: orgA.id, name: `M2B Cust A ${tag}`, createdById: salesRepA.id },
  });
  const gwA = await db.weChatGateway.create({
    data: { orgId: orgA.id, channel: "personal_wechat", status: "active" },
  });
  const gwB = await db.weChatGateway.create({
    data: { orgId: orgB.id, channel: "personal_wechat", status: "active" },
  });

  const caller = (u: { id: string; role: string }) => ({ userId: u.id, role: u.role });
  const bindingCount = () => db.channelContextBinding.count();
  const auditCount = (action: string, targetId: string) =>
    db.auditLog.count({ where: { action, targetId } });

  console.log("DB-1 CHECK 约束：sentinel / XOR / contextRole / 键非空白");
  {
    const raw = (
      id: string,
      cols: {
        level?: string;
        thread?: string;
        projectId?: string | null;
        customerId?: string | null;
        role?: string | null;
        status?: string;
        provider?: string;
      },
    ) =>
      db.$executeRawUnsafe(
        `INSERT INTO "ChannelContextBinding" ("id","provider","providerTenantId","providerChannelId","bindingLevel","providerThreadId","orgId","projectId","customerId","contextRole","status","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
        id,
        cols.provider ?? "personal_wechat",
        gwA.id,
        `chk_${id}`,
        cols.level ?? "CHANNEL",
        cols.thread ?? "",
        orgA.id,
        cols.projectId === undefined ? projA.id : cols.projectId,
        cols.customerId === undefined ? null : cols.customerId,
        cols.role === undefined ? null : cols.role,
        cols.status ?? "ACTIVE",
      );
    const expectCheck = async (name: string, id: string, cols: Parameters<typeof raw>[1], constraint: string) => {
      let hit = false;
      try {
        await raw(id, cols);
      } catch (e) {
        hit = String(e).includes(constraint);
      }
      ok(hit, name);
    };
    await expectCheck("status='HACKED' 拒绝", `s_${tag}`, { status: "HACKED" }, "ChannelContextBinding_status_check");
    await expectCheck("CHANNEL + 非空 thread 拒绝（哨兵约束）", `lt1_${tag}`, { level: "CHANNEL", thread: "t1" }, "ChannelContextBinding_level_thread_check");
    await expectCheck("THREAD + 空 thread 拒绝", `lt2_${tag}`, { level: "THREAD", thread: "" }, "ChannelContextBinding_level_thread_check");
    await expectCheck("THREAD + 空白 thread 拒绝", `lt3_${tag}`, { level: "THREAD", thread: "   " }, "ChannelContextBinding_level_thread_check");
    await expectCheck("XOR：双空拒绝", `x1_${tag}`, { projectId: null, customerId: null }, "ChannelContextBinding_target_xor_check");
    await expectCheck("XOR：双有拒绝", `x2_${tag}`, { projectId: projA.id, customerId: customerA.id }, "ChannelContextBinding_target_xor_check");
    await expectCheck("contextRole='sales' 拒绝（词表）", `r1_${tag}`, { role: "sales" }, "ChannelContextBinding_context_role_check");
    await expectCheck("tender + customer 拒绝（tender 必绑 Project）", `r2_${tag}`, { projectId: null, customerId: customerA.id, role: "tender" }, "ChannelContextBinding_tender_requires_project_check");
    await expectCheck("空白 provider 拒绝", `k1_${tag}`, { provider: "  " }, "ChannelContextBinding_key_nonblank_check");
    ok((await raw(`ok_${tag}`, { level: "THREAD", thread: "T1", role: "tender" })) === 1, "合法 THREAD+tender 行原样接受");
    await db.channelContextBinding.deleteMany({ where: { id: `ok_${tag}` } });
  }

  console.log("DB-2 创建 + §40 唯一键：channel 级仅 1 行；channel 与 thread 并存；跨租户并存（§39）");
  const mk = (over: Record<string, unknown> = {}) => ({
    caller: caller(orgAdminA),
    managementOrgId: orgA.id,
    provider: "personal_wechat",
    providerTenantId: gwA.id,
    providerChannelId: `C1_${tag}`,
    targetType: "project" as const,
    targetId: projA.id,
    ...over,
  });
  let channelBindingId = "";
  {
    const r = await svc.createChannelBinding(mk());
    ok(r.ok && r.outcome === "CREATE" && r.binding.status === "ACTIVE", "channel 级 CREATE → ACTIVE", r);
    if (r.ok) {
      channelBindingId = r.binding.id;
      ok(r.binding.bindingLevel === "CHANNEL" && r.binding.providerThreadId === "", "bindingLevel=CHANNEL + '' 哨兵（服务端推导）");
      const audits = await db.auditLog.findMany({
        where: { action: AUDIT_ACTIONS.CHANNEL_CONTEXT_BINDING_CREATE, targetId: r.binding.id },
      });
      ok(audits.length === 1, "创建审计 ×1（同事务）");
      ok(!(audits[0].afterData ?? "").includes(`C1_${tag}`), "审计不含 raw providerChannelId（hash 化）");
    }
    const idem = await svc.createChannelBinding(mk());
    ok(idem.ok && idem.outcome === "IDEMPOTENT", "同 key 同 target 同 role → IDEMPOTENT 零写");
    ok((await auditCount(AUDIT_ACTIONS.CHANNEL_CONTEXT_BINDING_CREATE, channelBindingId)) === 1, "幂等未新增审计");
    const conflict = await svc.createChannelBinding(mk({ targetId: projA2.id }));
    ok(!conflict.ok && conflict.code === "BINDING_ALREADY_EXISTS", "同 key 不同 target → ALREADY_EXISTS（NO BLIND UPSERT）");
    const row = await db.channelContextBinding.findUnique({ where: { id: channelBindingId } });
    ok(row?.projectId === projA.id, "原 target 未被改写");
    let p2002 = false;
    try {
      await db.channelContextBinding.create({
        data: { provider: "personal_wechat", providerTenantId: gwA.id, providerChannelId: `C1_${tag}`, providerThreadId: "", bindingLevel: "CHANNEL", orgId: orgA.id, projectId: projA2.id },
      });
    } catch (e) {
      p2002 = (e as { code?: string })?.code === "P2002";
    }
    ok(p2002, "channel 级同 key 直插 → P2002（'' 哨兵使唯一键真正生效）");

    const t1 = await svc.createChannelBinding(mk({ providerThreadId: `T1_${tag}`, targetId: projA2.id }));
    ok(t1.ok && t1.binding.bindingLevel === "THREAD", "channel 级 + thread T1 并存（THREAD 级）");
    const t2 = await svc.createChannelBinding(mk({ providerThreadId: `T2_${tag}` }));
    ok(t2.ok, "thread T1 + thread T2 并存");
    // §39 跨租户：tenant B 相同 channel/thread 独立存在
    const crossTenant = await svc.createChannelBinding({
      caller: caller(adminB),
      managementOrgId: orgB.id,
      provider: "personal_wechat",
      providerTenantId: gwB.id,
      providerChannelId: `C1_${tag}`,
      providerThreadId: `T1_${tag}`,
      targetType: "project",
      targetId: projB.id,
    });
    ok(crossTenant.ok, "Provider tenant B + 相同 C1/T1 → 独立并存");
    const lookupA = await lookupPersistentChannelBinding({
      provider: "personal_wechat",
      providerTenantId: gwA.id,
      providerChannelId: `C1_${tag}`,
      providerThreadId: `T1_${tag}`,
      expectedOrgId: orgA.id,
    });
    const lookupB = await lookupPersistentChannelBinding({
      provider: "personal_wechat",
      providerTenantId: gwB.id,
      providerChannelId: `C1_${tag}`,
      providerThreadId: `T1_${tag}`,
      expectedOrgId: orgB.id,
    });
    ok(lookupA.status === "found" && lookupA.binding.contextId === projA2.id, "lookup tenant A → A 的 thread 绑定");
    ok(lookupB.status === "found" && lookupB.binding.contextId === projB.id, "lookup tenant B → B（绝不命中 A）");
  }

  console.log("DB-3 ownership fail-closed：非 OWNED 一律零行");
  {
    const before = await bindingCount();
    const wrongOrgGw = await svc.createChannelBinding(mk({ providerTenantId: gwB.id, providerChannelId: `CX_${tag}` }));
    ok(!wrongOrgGw.ok && wrongOrgGw.code === "PROVIDER_TENANT_UNVERIFIED", "org B 网关（MISMATCH）→ 拒");
    await db.weChatGateway.update({ where: { id: gwA.id }, data: { status: "inactive" } });
    const inactiveGw = await svc.createChannelBinding(mk({ providerChannelId: `CY_${tag}` }));
    ok(!inactiveGw.ok && inactiveGw.code === "PROVIDER_TENANT_UNVERIFIED", "INACTIVE 网关 → 拒（create 需 OWNED）");
    await db.weChatGateway.update({ where: { id: gwA.id }, data: { status: "active" } });
    const slack = await svc.createChannelBinding(mk({ provider: "slack", providerTenantId: "T123", providerChannelId: `CZ_${tag}` }));
    ok(!slack.ok && slack.code === "PROVIDER_TENANT_UNVERIFIED", "slack（UNSUPPORTED）→ 拒");
    const unproven = await svc.createChannelBinding(mk({ providerTenantId: "gw_missing", providerChannelId: `CW_${tag}` }));
    ok(!unproven.ok && unproven.code === "PROVIDER_TENANT_UNVERIFIED", "未知网关（UNPROVEN）→ 拒");
    ok((await bindingCount()) === before, "四次拒绝均零行");
  }

  console.log("DB-4 §16 project 权限决策表 + §38 personal project 硬拒 + §15 跨 org");
  {
    const before = await bindingCount();
    const byOwner = await svc.createChannelBinding(mk({ caller: caller(ownerA), providerChannelId: `P1_${tag}` }));
    ok(byOwner.ok, "project owner → 允许");
    const byProjAdmin = await svc.createChannelBinding(mk({ caller: caller(projAdminA), providerChannelId: `P2_${tag}` }));
    ok(byProjAdmin.ok, "project_admin 成员 → 允许");
    const bySuper = await svc.createChannelBinding(mk({ caller: caller(padmin), providerChannelId: `P3_${tag}` }));
    ok(bySuper.ok, "平台 super_admin → 允许");
    const byViewer = await svc.createChannelBinding(mk({ caller: caller(viewerA), providerChannelId: `P4_${tag}` }));
    ok(!byViewer.ok && byViewer.code === "CALLER_FORBIDDEN", "普通只读成员（operator）→ CALLER_FORBIDDEN");
    const personal = await svc.createChannelBinding(mk({ caller: caller(ownerA), providerChannelId: `P5_${tag}`, targetId: personalP.id }));
    ok(!personal.ok && personal.code === "TARGET_PERSONAL_PROJECT", "personal project（orgId=null，canonical 判别）→ 拒");
    const crossOrg = await svc.createChannelBinding(mk({ providerChannelId: `P6_${tag}`, targetId: projB.id }));
    ok(!crossOrg.ok && crossOrg.code === "TARGET_NOT_FOUND", "org A 管理租户绑定 org B 项目 → TARGET_NOT_FOUND（不泄露）");
    const ghost = await svc.createChannelBinding(mk({ providerChannelId: `P7_${tag}`, targetId: `nope_${tag}` }));
    ok(!ghost.ok && ghost.code === "TARGET_NOT_FOUND", "不存在项目 → 同 code（无存在性 oracle）");
    ok((await bindingCount()) === before + 3, "仅 3 个授权创建落行（personal/cross-org/ghost/viewer 全零行）");
  }

  console.log("DB-5 §18 customer canonical 权限（真实 RoleProfile 授权链）");
  let customerBindingId = "";
  {
    const mkC = (over: Record<string, unknown> = {}) => ({
      caller: caller(salesRepA),
      managementOrgId: orgA.id,
      provider: "personal_wechat",
      providerTenantId: gwA.id,
      providerChannelId: `CC1_${tag}`,
      targetType: "customer" as const,
      targetId: customerA.id,
      ...over,
    });
    const byCreator = await svc.createChannelBinding(mkC());
    ok(byCreator.ok && byCreator.binding.customerId === customerA.id, "sales_rep（PRINCIPAL scope，客户创建者）→ 允许", byCreator);
    if (byCreator.ok) customerBindingId = byCreator.binding.id;
    const byOtherRep = await svc.createChannelBinding(mkC({ caller: caller(salesRepA2), providerChannelId: `CC2_${tag}` }));
    ok(!byOtherRep.ok && byOtherRep.code === "CALLER_FORBIDDEN", "非创建者 sales_rep → CALLER_FORBIDDEN（authorize PRINCIPAL scope）");
    const byNoProfile = await svc.createChannelBinding(mkC({ caller: caller(viewerA), providerChannelId: `CC3_${tag}` }));
    ok(!byNoProfile.ok && byNoProfile.code === "CALLER_FORBIDDEN", "无授权 profile 成员 → CALLER_FORBIDDEN");
    const byPlatformAdmin = await svc.createChannelBinding(mkC({ caller: caller(padmin), providerChannelId: `CC4_${tag}` }));
    ok(byPlatformAdmin.ok, "平台 admin（canonical isAdmin 旁路）→ 允许");
    const tenderOnCustomer = await svc.createChannelBinding(mkC({ providerChannelId: `CC5_${tag}`, contextRole: "tender" }));
    ok(!tenderOnCustomer.ok && tenderOnCustomer.code === "CONTEXT_ROLE_INVALID", "customer + contextRole=tender → 拒（tender 只能绑 Project）");
  }

  console.log("DB-6 生命周期 + REVOKED 终态 + CAS");
  {
    const create = await svc.createChannelBinding(mk({ providerChannelId: `LC_${tag}` }));
    ok(create.ok, "前置：ACTIVE 绑定就绪");
    const id = create.ok ? create.binding.id : "";
    const d = await svc.disableChannelBinding({ caller: caller(orgAdminA), managementOrgId: orgA.id, bindingId: id });
    ok(d.ok && d.binding.status === "DISABLED" && d.binding.disabledById === orgAdminA.id, "ACTIVE → DISABLED");
    await db.weChatGateway.update({ where: { id: gwA.id }, data: { status: "inactive" } });
    const eBlocked = await svc.enableChannelBinding({ caller: caller(orgAdminA), managementOrgId: orgA.id, bindingId: id });
    ok(!eBlocked.ok && eBlocked.code === "PROVIDER_TENANT_UNVERIFIED", "网关失活 → enable 拒（重验 ownership OWNED）");
    // INACTIVE 归属下仍可 disable/revoke（§23/§24）——此处直接 revoke
    await db.weChatGateway.update({ where: { id: gwA.id }, data: { status: "active" } });
    const e = await svc.enableChannelBinding({ caller: caller(orgAdminA), managementOrgId: orgA.id, bindingId: id });
    ok(e.ok && e.binding.status === "ACTIVE" && e.binding.disabledAt === null, "DISABLED → ACTIVE（disabled 字段清空）");
    ok((await auditCount(AUDIT_ACTIONS.CHANNEL_CONTEXT_BINDING_STATUS_CHANGE, id)) === 2, "status_change 审计 ×2");

    // CAS：stale disable 快照 vs 并发 revoke → STATE_CHANGED，REVOKED 不被覆盖，零审计
    const stale = (await db.channelContextBinding.findUnique({ where: { id } }))!;
    const rv = await svc.revokeChannelBinding({ caller: caller(orgAdminA), managementOrgId: orgA.id, bindingId: id, reason: "test revoke" });
    ok(rv.ok && rv.binding.status === "REVOKED", "revoke → REVOKED");
    const audBefore = await db.auditLog.count({ where: { targetType: "channel_context_binding" } });
    const staleDisable = await svc.commitBindingTransition({
      before: stale as never,
      data: { status: "DISABLED" },
      outcome: "DISABLED",
      audit: { callerUserId: orgAdminA.id, orgId: orgA.id, action: AUDIT_ACTIONS.CHANNEL_CONTEXT_BINDING_STATUS_CHANGE },
    });
    const final = await db.channelContextBinding.findUnique({ where: { id } });
    ok(!staleDisable.ok && staleDisable.code === "BINDING_STATE_CHANGED", "stale disable → BINDING_STATE_CHANGED");
    ok(final?.status === "REVOKED", "REVOKED 终态未被 stale 写覆盖");
    ok((await db.auditLog.count({ where: { targetType: "channel_context_binding" } })) === audBefore, "CAS FAIL 零审计");

    // REVOKED 终态：enable / rebind / recreate 全拒
    const enableRevoked = await svc.enableChannelBinding({ caller: caller(orgAdminA), managementOrgId: orgA.id, bindingId: id });
    ok(!enableRevoked.ok && enableRevoked.code === "INVALID_STATE", "REVOKED 不可 enable");
    const rebindRevoked = await svc.rebindChannelBinding({ caller: caller(orgAdminA), managementOrgId: orgA.id, bindingId: id, targetType: "project", targetId: projA2.id });
    ok(!rebindRevoked.ok && rebindRevoked.code === "BINDING_REVOKED_TERMINAL", "REVOKED 不可 rebind");
    const before = await bindingCount();
    const recreate = await svc.createChannelBinding(mk({ providerChannelId: `LC_${tag}` }));
    ok(!recreate.ok && recreate.code === "BINDING_REVOKED_TERMINAL", "同 exact key recreate → REVOKED_TERMINAL");
    ok((await bindingCount()) === before, "recreate 零行（不偷偷复活）");
  }

  console.log("DB-7 §42 rebind 矩阵 + 并发 revoke beats rebind");
  {
    const create = await svc.createChannelBinding(mk({ providerChannelId: `RB_${tag}` }));
    const id = create.ok ? create.binding.id : "";
    // OLD+NEW（orgAdminA 可管理 projA 与 projA2）→ 成功 + 审计 before/after
    const r1 = await svc.rebindChannelBinding({ caller: caller(orgAdminA), managementOrgId: orgA.id, bindingId: id, targetType: "project", targetId: projA2.id, reason: "move" });
    ok(r1.ok && r1.binding.projectId === projA2.id, "OLD∧NEW 权限 → rebind 成功（Project A → Project A2）");
    const rebindAudit = await db.auditLog.findFirst({ where: { action: AUDIT_ACTIONS.CHANNEL_CONTEXT_BINDING_REBIND, targetId: id } });
    ok(!!rebindAudit && (rebindAudit.beforeData ?? "").includes(projA.id) && (rebindAudit.afterData ?? "").includes(projA2.id), "审计记录 before/after target");
    // caller can OLD only（orgAdminA 无 customer 权限）→ NEW 权限 deny
    const oldOnly = await svc.rebindChannelBinding({ caller: caller(orgAdminA), managementOrgId: orgA.id, bindingId: id, targetType: "customer", targetId: customerA.id });
    ok(!oldOnly.ok && oldOnly.code === "CALLER_FORBIDDEN", "caller 仅有 OLD 权限（无 NEW customer 权限）→ deny");
    // caller can NEW only（salesRepA 可管 customerA 但不可管 projA2 的绑定）→ OLD 侧 404
    const newOnly = await svc.rebindChannelBinding({ caller: caller(salesRepA), managementOrgId: orgA.id, bindingId: id, targetType: "customer", targetId: customerA.id });
    ok(!newOnly.ok && newOnly.code === "BINDING_NOT_FOUND", "caller 仅有 NEW 权限（OLD 不可管理）→ 404");
    // neither
    const neither = await svc.rebindChannelBinding({ caller: caller(salesRepA2), managementOrgId: orgA.id, bindingId: id, targetType: "project", targetId: projA.id });
    ok(!neither.ok && neither.code === "BINDING_NOT_FOUND", "两侧都无权限 → 404");
    // cross-org new target（padmin 全能，但 org 边界仍禁）
    const crossOrg = await svc.rebindChannelBinding({ caller: caller(padmin), managementOrgId: orgA.id, bindingId: id, targetType: "project", targetId: projB.id });
    ok(!crossOrg.ok && crossOrg.code === "TARGET_NOT_FOUND", "CROSS_ORG_REBIND：Org A binding → Org B project 拒（platform admin 也不例外）");
    // provider tenant wrong org：orgB admin 视角该绑定不存在
    const wrongTenantAdmin = await svc.rebindChannelBinding({ caller: caller(adminB), managementOrgId: orgB.id, bindingId: id, targetType: "project", targetId: projB.id });
    ok(!wrongTenantAdmin.ok && wrongTenantAdmin.code === "BINDING_NOT_FOUND", "org B 管理租户 → org A 绑定 404");
    // 同 org project → customer（padmin：双侧 canonical 权限都过）
    const crossType = await svc.rebindChannelBinding({ caller: caller(padmin), managementOrgId: orgA.id, bindingId: id, targetType: "customer", targetId: customerA.id, reason: "type switch" });
    ok(crossType.ok && crossType.binding.customerId === customerA.id && crossType.binding.projectId === null, "同 org Project → Customer 换类型成功（XOR 保持）");

    // 并发：revoke 先提交 → stale rebind CAS FAIL（ownershipDeps 交错注入真实全 API 路径）
    const create2 = await svc.createChannelBinding(mk({ providerChannelId: `RB2_${tag}` }));
    const id2 = create2.ok ? create2.binding.id : "";
    let interleaved = false;
    const interleaveDeps = {
      env: process.env,
      async findGatewayById(gid: string) {
        if (!interleaved) {
          interleaved = true;
          // 第一次 ownership 解析（loadManageableBinding 内）后不打断，等 rebind 内第二次 ownership
        } else {
          await svc.revokeChannelBinding({ caller: caller(orgAdminA), managementOrgId: orgA.id, bindingId: id2, reason: "concurrent" });
        }
        return db.weChatGateway.findUnique({ where: { id: gid }, select: { id: true, orgId: true, channel: true, corpId: true, status: true } });
      },
      async findWecomGatewaysByCorpId() {
        return [];
      },
    };
    const staleRebind = await svc.rebindChannelBinding({
      caller: caller(orgAdminA),
      managementOrgId: orgA.id,
      bindingId: id2,
      targetType: "project",
      targetId: projA2.id,
      ownershipDeps: interleaveDeps,
    });
    const final2 = await db.channelContextBinding.findUnique({ where: { id: id2 } });
    ok(!staleRebind.ok && staleRebind.code === "BINDING_STATE_CHANGED", "并发 revoke 赢 → stale rebind CAS FAIL", staleRebind);
    ok(final2?.status === "REVOKED" && final2?.projectId === projA.id, "终态 REVOKED、target 未被改写");
  }

  console.log("DB-8 §24 管理可见性：target 权限 + 租户归属逐条过滤");
  {
    const listAdmin = await svc.listChannelBindingsForAdmin({ caller: caller(orgAdminA), managementOrgId: orgA.id });
    ok(listAdmin.bindings.every((b) => b.customerId === null), "org_admin（无 customer 权限）列表不含 customer 绑定");
    ok(listAdmin.bindings.length > 0, "org_admin 可见 project 绑定");
    const listSales = await svc.listChannelBindingsForAdmin({ caller: caller(salesRepA), managementOrgId: orgA.id });
    ok(listSales.bindings.every((b) => b.customerId === customerA.id), "sales_rep 只见自己客户的绑定（project 绑定被过滤）");
    // 模拟损坏行：orgA 行但 tenant 是 org B 网关 → MISMATCH → 不可见 + 不可管
    const corrupted = await db.channelContextBinding.create({
      data: { provider: "personal_wechat", providerTenantId: gwB.id, providerChannelId: `BAD_${tag}`, providerThreadId: "", bindingLevel: "CHANNEL", orgId: orgA.id, projectId: projA.id },
    });
    const listAfter = await svc.listChannelBindingsForAdmin({ caller: caller(orgAdminA), managementOrgId: orgA.id });
    ok(!listAfter.bindings.some((b) => b.id === corrupted.id), "MISMATCH 租户行对管理员不可见");
    const disableCorrupted = await svc.disableChannelBinding({ caller: caller(orgAdminA), managementOrgId: orgA.id, bindingId: corrupted.id });
    ok(!disableCorrupted.ok && disableCorrupted.code === "BINDING_NOT_FOUND", "MISMATCH 租户行不可管（404，不泄露存在性）");
    ok(customerBindingId !== "", "前置：customer 绑定存在");
  }

  console.log(`\nM2-B Binding DB 结果: ${pass} 通过, ${fail} 失败`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
