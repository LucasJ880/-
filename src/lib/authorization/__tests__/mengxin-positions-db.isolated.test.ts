/**
 * PERM-6b：梦馨（家纺外贸）进入岗位模式——真实 DB（隔离库）+ 真实路由
 *
 *   按上线顺序：seed（Cathy 自动绑 trade_rep、Lucas 自动绑系统 org_owner）→ 岗位模式下 Cathy 外贸 / 营收照常；
 *   无绑定成员 403（兼容回退已关）；Lucas 绑 owner 后是管理层、收管理层提醒、可发布营收策略；
 *   active-org positionMode = true；压扁 dry-run：Cathy trade → user 进计划且无阻断。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/authorization/__tests__/mengxin-positions-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-6b 梦馨岗位 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-6b mengxin positions DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-6b-isolated-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : "");
  }
}

type Handler = (req: unknown, ctx: unknown) => Promise<Response>;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { runPlatformRoleCollapse } = await import("@/lib/authorization/platform-role-collapse-run");
  const { tradeManagementRecipients, tradeWorkRecipients, resolveDefaultInquiryOwner } = await import("@/lib/trade/recipients");
  const dashboardRoute = await import("@/app/api/trade/dashboard/route");
  const knowledgeRoute = await import("@/app/api/trade/knowledge/route");
  const cockpitRoute = await import("@/app/api/revenue/cockpit/route");
  const policyRoute = await import("@/app/api/revenue/policy/route");
  const activeOrgRoute = await import("@/app/api/auth/active-org/route");
  const meRoute = await import("@/app/api/auth/me/route");
  const positionsRoute = await import("@/app/api/organizations/[orgId]/positions/route");

  const stamp = Date.now().toString(36);
  const LUCAS = `mxl_${stamp}`;
  const CATHY = `mxc_${stamp}`;
  const NOBODY = `mxn_${stamp}`;
  const SA = `mxsa_${stamp}`;
  const NEWBOSS = `mxnb_${stamp}`;
  const NEW_CODE = `mxnew-${stamp}`;
  let newOrgId: string | null = null;
  const ORG = `mxorg_${stamp}`;
  const ORG_CODE = `mx-${stamp}`;
  const role: Record<string, string> = { [LUCAS]: "admin", [CATHY]: "trade", [NOBODY]: "user", [SA]: "super_admin", [NEWBOSS]: "trade" };
  const users = Object.keys(role);
  const email = (id: string) => `${id}@fixture.test`;
  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Example ${id}`, role: role[id] } });
  await db.organization.create({
    data: { id: ORG, name: "Example Home Textile", code: ORG_CODE, ownerId: LUCAS, industryPackId: "home_textile_trade_v1", modulesJson: { enabled: ["trade"] } },
  });
  for (const [id, orgRole, offset] of [[LUCAS, "org_owner", 0], [CATHY, "org_member", 1]] as const) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: orgRole, status: "active", createdAt: new Date(Date.now() + offset * 1000) } });
    await db.user.update({ where: { id }, data: { activeOrgId: ORG } });
  }
  // 上线顺序第 1 步：seed（Cathy 自动绑 trade_rep，Lucas 自动绑系统 org_owner）
  await seedOrgAuthorizationProfiles(ORG);
  // seed 之后才加入、没有任何绑定的人
  await db.organizationMember.create({ data: { orgId: ORG, userId: NOBODY, role: "org_member", status: "active", createdAt: new Date(Date.now() + 2000) } });
  await db.user.update({ where: { id: NOBODY }, data: { activeOrgId: ORG } });

  const req = async (uid: string, method: string, url: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: {
        cookie: `qy_session=${await createSession({ sub: uid, email: email(uid), role: role[uid] })}`,
        "x-forwarded-for": "10.49.0.8",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const call = async (handler: unknown, uid: string, method: string, url: string, body?: unknown, params: Record<string, string> = {}) =>
    (handler as Handler)(await req(uid, method, url, body), { params: Promise.resolve(params) });
  const json = async (r: Response) => (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const sorted = (a: string[]) => [...a].sort().join(",");

  try {
    // ── 模板落地 ──
    const profiles = (await db.roleProfile.findMany({ where: { orgId: ORG }, select: { key: true } })).map((p) => p.key);
    ok(profiles.includes("owner") && profiles.includes("trade_rep"), "seed 落地家纺 owner 与系统 trade_rep", profiles);
    ok(!profiles.some((k) => ["pricing_lead", "fulfillment_vinyl", "installer"].includes(k)), "不落窗饰岗位");
    const cathyBinding = await db.principalRoleBinding.findFirst({ where: { orgId: ORG, principalId: CATHY, status: "active", roleProfile: { key: "trade_rep" } } });
    ok(!!cathyBinding, "seed 已给 Cathy（平台 trade）自动绑 trade_rep");

    // ── 岗位模式 ──
    const ao = await json(await call(activeOrgRoute.GET, CATHY, "GET", "/api/auth/active-org"));
    ok(ao.positionMode === true, "active-org：positionMode = true", ao);
    const me = (await json(await call(meRoute.GET, CATHY, "GET", "/api/auth/me"))) as { user?: { effectiveRole?: string } };
    ok(me.user?.effectiveRole === "trade", "Cathy 派生角色 trade（侧栏外贸布局）", me.user);

    // ── Cathy 照常工作 ──
    ok((await call(dashboardRoute.GET, CATHY, "GET", "/api/trade/dashboard")).status === 200, "Cathy：外贸看板 200");
    ok((await call(knowledgeRoute.POST, CATHY, "POST", "/api/trade/knowledge", { title: "Example", content: "Example", category: "faq" })).status === 201, "Cathy：外贸写 201");
    ok((await call(cockpitRoute.GET, CATHY, "GET", "/api/revenue/cockpit")).status === 200, "Cathy：营收驾驶舱 200");
    ok((await call(policyRoute.PUT, CATHY, "PUT", "/api/revenue/policy", {})).status === 403, "Cathy：发布营收策略 403");
    ok((await resolveDefaultInquiryOwner(ORG)) === CATHY, "默认询盘负责人 = Cathy");

    // ── 兼容回退已关 ──
    const nobody = await call(dashboardRoute.GET, NOBODY, "GET", "/api/trade/dashboard");
    ok(nobody.status === 403, "无绑定成员：外贸 403（不再兼容回退）", nobody.status);

    // ── Lucas：绑 owner 前后（平台 admin，非 super_admin） ──
    ok((await call(dashboardRoute.GET, LUCAS, "GET", "/api/trade/dashboard")).status === 200, "Lucas（系统 org_owner 绑定）：外贸 200");
    ok(!(await tradeManagementRecipients(ORG)).includes(LUCAS), "Lucas 未绑 owner：还不是管理层收件人");
    const bindOwner = await call(positionsRoute.PUT, SA, "PUT", `/api/organizations/${ORG}/positions`, { principalType: "HUMAN", principalId: LUCAS, keys: ["org_owner", "owner"] }, { orgId: ORG });
    ok(bindOwner.status === 200, "super_admin 在界面接口给 Lucas 绑 owner", await json(bindOwner));
    ok(sorted(await tradeManagementRecipients(ORG)) === sorted([LUCAS]), "Lucas 绑 owner 后：管理层收件人 = Lucas");
    ok(sorted(await tradeWorkRecipients(ORG)) === sorted([LUCAS, CATHY]), "工作收件人 = Lucas + Cathy");
    ok((await call(policyRoute.PUT, LUCAS, "PUT", "/api/revenue/policy", {})).status === 200, "Lucas：发布营收策略 200");
    const meL = (await json(await call(meRoute.GET, LUCAS, "GET", "/api/auth/me"))) as { user?: { effectiveRole?: string } };
    ok(meL.user?.effectiveRole === "admin", "Lucas（平台 admin）派生角色原样 admin（保留角色，7b 另议）", meL.user);

    // ── 新工厂入驻（D5）：落岗位、指定老板绑 owner ──
    {
      const { provisionFactoryOrg } = await import("@/lib/organizations/onboarding");
      const prov = await provisionFactoryOrg({ name: "Example New Textiles", code: NEW_CODE, industryPackId: "home_textile_trade_v1", timezone: "Asia/Shanghai", actorUserId: SA, ownerUserId: NEWBOSS });
      newOrgId = prov.orgId;
      const ownerBinding = await db.principalRoleBinding.findFirst({ where: { orgId: newOrgId, principalId: NEWBOSS, status: "active", roleProfile: { key: "owner" } } });
      ok(!!ownerBinding, "入驻新家纺工厂：指定老板绑 owner");
      const audit = await db.auditLog.findFirst({ where: { orgId: newOrgId, action: "authorization.position.bind", targetId: NEWBOSS } });
      ok((audit?.afterData ? JSON.parse(audit.afterData) : {}).via === "onboarding", "绑定审计来源 onboarding");
      ok((await tradeManagementRecipients(newOrgId)).includes(NEWBOSS), "新工厂老板是外贸管理层收件人");
      const again = await provisionFactoryOrg({ name: "Example New Textiles", code: NEW_CODE, industryPackId: "home_textile_trade_v1", timezone: "Asia/Shanghai", actorUserId: SA, ownerUserId: NEWBOSS });
      const ownerRows = await db.principalRoleBinding.count({ where: { orgId: again.orgId, principalId: NEWBOSS, roleProfile: { key: "owner" } } });
      ok(ownerRows === 1, "重复入驻不重复绑定", ownerRows);
    }

    // ── 压扁 dry-run ──
    const plan = await runPlatformRoleCollapse({ orgCode: ORG_CODE, actorEmail: email(SA), dryRun: true, restore: false, ready: true });
    ok(plan.exitCode === 0 && plan.lines.some((l) => l === `压扁 ${email(CATHY)}：trade → user`), "压扁计划：Cathy trade → user，无阻断", plan.lines);
    ok(!plan.lines.some((l) => l.startsWith(`压扁 ${email(LUCAS)}`)), "Lucas（平台 admin）不在压扁范围");
    ok((await db.user.findUnique({ where: { id: CATHY }, select: { role: true } }))?.role === "trade", "dry-run 不写库");
  } finally {
    if (newOrgId) {
      await db.workspaceMember.deleteMany({ where: { workspace: { orgId: newOrgId } } }).catch(() => undefined);
      await db.workspace.deleteMany({ where: { orgId: newOrgId } }).catch(() => undefined);
      await db.orgBusinessRule.deleteMany({ where: { orgId: newOrgId } }).catch(() => undefined);
      await db.auditLog.deleteMany({ where: { orgId: newOrgId } });
      await db.principalRoleBinding.deleteMany({ where: { orgId: newOrgId } });
      await db.roleProfile.deleteMany({ where: { orgId: newOrgId } }).catch(() => undefined);
      await db.positionTemplate.deleteMany({ where: { orgId: newOrgId } }).catch(() => undefined);
      await db.organizationMember.deleteMany({ where: { orgId: newOrgId } });
    }
    await db.tradeKnowledge.deleteMany({ where: { orgId: ORG } });
    await db.orgBusinessRule.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.user.updateMany({ where: { id: { in: users } }, data: { activeOrgId: null } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { activeOrgId: null } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ...(newOrgId ? [newOrgId] : [])] } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-6b 梦馨岗位 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
