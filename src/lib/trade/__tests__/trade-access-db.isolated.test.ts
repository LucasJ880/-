/**
 * PERM-6a：外贸按岗位权限键——真实 DB（隔离库）+ 真实路由
 *
 *   旧模式企业（无行业包，未 seed）：平台 trade 成员经兼容回退读写 200；老板（平台 admin、org_owner）200；
 *   平台 sales 403；平台 admin 不再隐含外贸，也不能显式访问非成员企业；跨企业 orgId 被拒；
 *   消息通道：企业管理员（只持设置键）新建通道 201，外贸业务员 403 CHANNEL_MANAGE_FORBIDDEN；
 *   岗位模式企业：trade_rep 200、sales_rep 403、owner 200；平台 super_admin 显式企业 200；
 *   seed 把平台 trade 成员自动绑到 trade_rep。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/trade/__tests__/trade-access-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-6a 外贸权限 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-6a trade access DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-6a-isolated-test-secret-0123456789abcdef";

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
  const dashboardRoute = await import("@/app/api/trade/dashboard/route");
  const knowledgeRoute = await import("@/app/api/trade/knowledge/route");
  const channelsRoute = await import("@/app/api/trade/channels/route");

  const stamp = Date.now().toString(36);
  const BOSS = `taboss_${stamp}`;
  const REP = `tarep_${stamp}`;
  const SALES = `tasal_${stamp}`;
  const ORG_ADMIN = `taoa_${stamp}`;
  const ADMIN = `taadm_${stamp}`;
  const SUPER = `tasup_${stamp}`;
  const WC_OWNER = `tawo_${stamp}`;
  const WC_TRADE = `tawt_${stamp}`;
  const WC_SALES = `taws_${stamp}`;
  const WC_PT = `tawp_${stamp}`;
  const LEG = `taleg_${stamp}`;
  const OTHER = `taoth_${stamp}`;
  const WC = `tawc_${stamp}`;
  const role: Record<string, string> = {
    [BOSS]: "admin",
    [REP]: "trade",
    [SALES]: "sales",
    [ORG_ADMIN]: "user",
    [ADMIN]: "admin",
    [SUPER]: "super_admin",
    [WC_OWNER]: "user",
    [WC_TRADE]: "user",
    [WC_SALES]: "user",
    [WC_PT]: "trade",
  };
  const users = Object.keys(role);
  const orgs = [LEG, OTHER, WC];
  for (const id of users) await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: role[id] } });
  // 旧模式（梦馨形态）：无行业包；不 seed，先走兼容回退
  await db.organization.create({ data: { id: LEG, name: "Example Legacy", code: `ta-leg-${stamp}`, ownerId: BOSS } });
  await db.organization.create({ data: { id: OTHER, name: "Example Other", code: `ta-oth-${stamp}`, ownerId: ADMIN } });
  await db.organization.create({ data: { id: WC, name: "Example WC", code: `ta-wc-${stamp}`, ownerId: WC_OWNER, industryPackId: "window_covering_services_v1", modulesJson: { enabled: ["sales", "operations", "window_covering", "trade"] } } });
  const member = async (orgId: string, userId: string, orgRole: string) => {
    await db.organizationMember.create({ data: { orgId, userId, role: orgRole, status: "active" } });
    await db.user.update({ where: { id: userId }, data: { activeOrgId: orgId } });
  };
  await member(LEG, BOSS, "org_owner");
  await member(LEG, REP, "org_member");
  await member(LEG, SALES, "org_member");
  await member(LEG, ORG_ADMIN, "org_admin");
  await member(OTHER, ADMIN, "org_member");
  for (const id of [WC_OWNER, WC_TRADE, WC_SALES, WC_PT]) await member(WC, id, "org_member");
  await seedOrgAuthorizationProfiles(WC);
  const bind = async (orgId: string, userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId, key } } });
    await db.principalRoleBinding.create({ data: { orgId, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(WC, WC_OWNER, "owner");
  await bind(WC, WC_TRADE, "trade_rep");
  await bind(WC, WC_SALES, "sales_rep");

  const req = async (uid: string, url: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: role[uid] })}`,
        "x-forwarded-for": "10.46.0.8",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const call = async (handler: unknown, uid: string, url: string, body?: unknown) =>
    (handler as Handler)(await req(uid, url, body), { params: Promise.resolve({}) });
  const codeOf = async (res: Response) => ((await res.clone().json().catch(() => ({}))) as { code?: string }).code;
  const knowledge = (title: string) => ({ title, content: "Example content", category: "faq" });

  try {
    // ── 旧模式：兼容回退 ──
    ok((await call(dashboardRoute.GET, REP, "/api/trade/dashboard")).status === 200, "旧模式 平台 trade + org_member：读 200（兼容回退 trade_rep）");
    ok((await call(knowledgeRoute.POST, REP, "/api/trade/knowledge", knowledge("rep"))).status === 201, "旧模式 平台 trade + org_member：写 201");
    ok((await call(dashboardRoute.GET, BOSS, "/api/trade/dashboard")).status === 200, "旧模式老板（平台 admin、org_owner）：读 200（org_owner 模板）");
    ok((await call(knowledgeRoute.POST, BOSS, "/api/trade/knowledge", knowledge("boss"))).status === 201, "旧模式老板：写 201");
    const sales = await call(dashboardRoute.GET, SALES, "/api/trade/dashboard");
    ok(sales.status === 403 && (await codeOf(sales)) === "TRADE_PERMISSION_REQUIRED", "平台 sales（sales_rep）：外贸 403", sales.status);
    const orgAdminRead = await call(dashboardRoute.GET, ORG_ADMIN, "/api/trade/dashboard");
    ok(orgAdminRead.status === 403, "企业管理员（只持设置键）：外贸业务数据 403", orgAdminRead.status);

    // ── 平台 admin 不再隐含 ──
    const adminOwn = await call(dashboardRoute.GET, ADMIN, "/api/trade/dashboard");
    ok(adminOwn.status === 403 && (await codeOf(adminOwn)) === "TRADE_PERMISSION_REQUIRED", "平台 admin + org_member：本企业外贸 403（不再隐含）", adminOwn.status);
    const adminCross = await call(dashboardRoute.GET, ADMIN, `/api/trade/dashboard?orgId=${LEG}`);
    ok(adminCross.status === 403 && (await codeOf(adminCross)) === "ORG_CONTEXT_MISMATCH", "平台 admin 显式 orgId 访问非成员企业：403 ORG_CONTEXT_MISMATCH", adminCross.status);

    // ── 跨企业 ──
    const repCross = await call(dashboardRoute.GET, REP, `/api/trade/dashboard?orgId=${OTHER}`);
    ok(repCross.status === 403 && (await codeOf(repCross)) === "ORG_CONTEXT_MISMATCH", "外贸业务员 orgId 与当前企业不一致：403", repCross.status);
    const repBodyCross = await call(knowledgeRoute.POST, REP, "/api/trade/knowledge", { ...knowledge("x"), orgId: OTHER });
    ok(repBodyCross.status === 403, "外贸业务员 body orgId 指向其他企业：写被拒", repBodyCross.status);

    // ── 消息通道 ──
    const site = { channel: "website", name: "Example Site", config: {} };
    const oaWrite = await call(channelsRoute.POST, ORG_ADMIN, "/api/trade/channels", site);
    ok(oaWrite.status === 201, "企业管理员：新建消息通道 201（设置键）", oaWrite.status);
    const oaList = await call(channelsRoute.GET, ORG_ADMIN, "/api/trade/channels");
    ok(oaList.status === 200 && oaList.headers.get("x-qingyan-can-manage-channels") === "1", "企业管理员：通道列表 200、可管理", oaList.status);
    const repWrite = await call(channelsRoute.POST, REP, "/api/trade/channels", site);
    ok(repWrite.status === 403 && (await codeOf(repWrite)) === "CHANNEL_MANAGE_FORBIDDEN", "外贸业务员：改通道 403 CHANNEL_MANAGE_FORBIDDEN", repWrite.status);
    const repList = await call(channelsRoute.GET, REP, "/api/trade/channels");
    ok(repList.status === 200 && repList.headers.get("x-qingyan-can-manage-channels") === "0", "外贸业务员：通道列表 200、不可管理", repList.status);
    const salesList = await call(channelsRoute.GET, SALES, "/api/trade/channels");
    ok(salesList.status === 403, "平台 sales：通道列表 403", salesList.status);

    // ── 岗位模式 ──
    ok((await call(dashboardRoute.GET, WC_TRADE, "/api/trade/dashboard")).status === 200, "岗位模式 user + trade_rep：读 200");
    ok((await call(knowledgeRoute.POST, WC_TRADE, "/api/trade/knowledge", knowledge("wc"))).status === 201, "岗位模式 trade_rep：写 201");
    ok((await call(dashboardRoute.GET, WC_SALES, "/api/trade/dashboard")).status === 403, "岗位模式 sales_rep：外贸 403");
    ok((await call(dashboardRoute.GET, WC_OWNER, "/api/trade/dashboard")).status === 200, "岗位模式 owner：外贸 200");
    const ptBinding = await db.principalRoleBinding.findFirst({ where: { orgId: WC, principalId: WC_PT, status: "active", roleProfile: { key: "trade_rep" } } });
    ok(!!ptBinding, "seed：岗位模式企业的平台 trade 成员自动绑 trade_rep");
    ok((await call(dashboardRoute.GET, WC_PT, "/api/trade/dashboard")).status === 200, "平台 trade 成员（seed 自动绑）：200");

    // ── 平台 super_admin ──
    ok((await call(dashboardRoute.GET, SUPER, `/api/trade/dashboard?orgId=${WC}`)).status === 200, "平台 super_admin 显式企业：200");
    ok((await call(dashboardRoute.GET, SUPER, "/api/trade/dashboard")).status === 400, "平台 super_admin 未指定企业：400");

    // ── 旧模式 seed 后（生产上线步骤）：平台 trade 成员绑 trade_rep，行为不变 ──
    await seedOrgAuthorizationProfiles(LEG);
    const repBinding = await db.principalRoleBinding.findFirst({ where: { orgId: LEG, principalId: REP, status: "active", roleProfile: { key: "trade_rep" } } });
    ok(!!repBinding, "旧模式 seed：平台 trade 成员自动绑 trade_rep");
    ok((await call(dashboardRoute.GET, REP, "/api/trade/dashboard")).status === 200, "旧模式 seed 后：外贸业务员仍 200");
    ok((await call(dashboardRoute.GET, BOSS, "/api/trade/dashboard")).status === 200, "旧模式 seed 后：老板仍 200");
    ok((await call(dashboardRoute.GET, SALES, "/api/trade/dashboard")).status === 403, "旧模式 seed 后：平台 sales 仍 403");
  } finally {
    await db.tradeKnowledge.deleteMany({ where: { orgId: { in: orgs } } });
    await db.tradeChannel.deleteMany({ where: { orgId: { in: orgs } } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: orgs } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: orgs } } });
    await db.roleProfile.deleteMany({ where: { orgId: { in: orgs } } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: { in: orgs } } }).catch(() => undefined);
    await db.user.updateMany({ where: { id: { in: users } }, data: { activeOrgId: null } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgs } } });
    await db.organization.deleteMany({ where: { id: { in: orgs } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-6a 外贸权限 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
