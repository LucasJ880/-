/**
 * VIS-1e 以岗位预览 — 真实 DB 端到端（隔离库，虚构企业；spec authorization/position-preview，design D8 / 验证方式）
 *
 *   开启：非平台 super_admin 被拒；开启成功；不满足条件（404 / 旧模式 / 非成员 / 空 / 11 个 / 停用岗位）。
 *   预览身份：平台角色 user、所选岗位的键、成员角色 org_member、当前企业为预览企业、别的企业非成员；平台特权不可用。
 *   会计 / 老板看到的：与持同样岗位的真实成员逐项相同（判定输入、路由门、审批中心、待我确认、AI 工具、首页岗位总览）。
 *   只读：GET 不写当前企业、不生成简报通知；代理拒写的 409 不含 cookie 值。
 *   退出与失效：停用岗位 / 移出企业 / 企业改旧模式 / 撤平台角色 → invalid、读取恢复本人；退出清 cookie。
 *   审计、cookie 不出现在响应、不带 cookie 的请求照旧。
 *
 * 路由处理函数在 `withPreviewToken` 中调用：库函数在测试进程里读不到 next/headers 的请求 cookie，
 * 注入等价于生产里 Next 的请求存储。不执行任何审批或出站。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/preview/__tests__/preview-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构企业名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 VIS-1e 以岗位预览隔离 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "VIS-1e position preview DB test" });
process.env.JWT_SECRET = process.env.JWT_SECRET || "vis1e-isolated-test-secret-0123456789abcdef";

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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Json = Record<string, unknown>;
type Handler = (req: unknown, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const id = (p: string) => `fx_vis1e_${p}_${stamp}`;
const SA = id("sa");
const PADMIN = id("padmin");
const OWNERU = id("owneru");
const ACCT = id("acct");
const OWNER2 = id("owner2");
const REP = id("rep");
const BIDS = id("bids");
const USERS = [SA, PADMIN, OWNERU, ACCT, OWNER2, REP, BIDS];
const WC = id("orgwc");
const HT = id("orght");
const LG = id("orglg");
const NM = id("orgnm");
const ORGS = [WC, HT, LG, NM];
const P1 = id("p1");
const P2 = id("p2");

process.env.AUTOPILOT_ENABLED = "1";
process.env.AUTOPILOT_OWNER_USER_IDS = SA;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { getCurrentUser, getOrgMembership } = await import("@/lib/auth");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { resolveEffectiveBindings } = await import("@/lib/authorization/resolve-effective-permissions");
  const { authorize } = await import("@/lib/authorization/authorize");
  const { withPreviewToken, __resetPreviewCacheForTests, getRequestPreview, effectivePlatformRole } = await import("@/lib/preview/server");
  const { getVisibleProjectIds } = await import("@/lib/projects/visibility");
  const { generateReminderLayers } = await import("@/lib/reminders/generator");
  const { ROUTE_GATE_LOADER } = await import("@/lib/navigation/context-server");
  const { applyRouteGate } = await import("@/lib/navigation/route-gate");
  const { resolveCockpitViewer } = await import("@/lib/cockpit/posts-read-model");
  const { handleRequest } = await import("@/proxy");
  const previewRoute = await import("@/app/api/admin/preview/route");
  const meRoute = await import("@/app/api/auth/me/route");
  const activeOrgRoute = await import("@/app/api/auth/active-org/route");
  const approvalsRoute = await import("@/app/api/capabilities/approvals/route");
  const pendingRoute = await import("@/app/api/ai/pending-actions/route");
  const toolsRoute = await import("@/app/api/agent-core/tools/route");
  const briefingRoute = await import("@/app/api/sales/daily-briefing/route");
  const positionsRoute = await import("@/app/api/organizations/[orgId]/positions/route");
  const logoutRoute = await import("@/app/api/auth/logout/route");
  const searchRoute = await import("@/app/api/search/route");
  const orgsRoute = await import("@/app/api/organizations/route");
  const notificationsRoute = await import("@/app/api/notifications/route");
  const unreadRoute = await import("@/app/api/notifications/unread-count/route");
  const prefRoute = await import("@/app/api/notifications/preferences/me/route");
  const { DEFAULT_SUNNY_MODULES } = await import("@/lib/tenancy");

  const cardIds: string[] = [];

  try {
    // ── 种子 ──
    for (const [uid, role] of [
      [SA, "super_admin"],
      [PADMIN, "admin"],
      [OWNERU, "user"],
      [ACCT, "user"],
      [OWNER2, "user"],
      [REP, "user"],
      [BIDS, "user"],
    ] as const) {
      await db.user.create({ data: { id: uid, email: `${uid}@fixture.test`, name: `Example ${uid.slice(9, 16)}`, role } });
    }
    await db.organization.create({ data: { id: WC, name: `Example Blinds ${stamp}`, code: `fx-vis1e-wc-${stamp}`, ownerId: OWNERU, industryPackId: "window_covering_services_v1", modulesJson: { enabled: [...DEFAULT_SUNNY_MODULES] } } });
    await db.organization.create({ data: { id: HT, name: `Example Textiles ${stamp}`, code: `fx-vis1e-ht-${stamp}`, ownerId: SA, industryPackId: "home_textile_trade_v1", modulesJson: { enabled: ["trade"] } } });
    await db.organization.create({ data: { id: LG, name: `Example Legacy ${stamp}`, code: `fx-vis1e-lg-${stamp}`, ownerId: SA } });
    await db.organization.create({ data: { id: NM, name: `Example Elsewhere ${stamp}`, code: `fx-vis1e-nm-${stamp}`, ownerId: REP, industryPackId: "window_covering_services_v1" } });
    const member = (orgId: string, userId: string, role = "org_member") => ({ orgId, userId, role, status: "active" });
    await db.organizationMember.createMany({
      data: [
        member(WC, SA, "org_admin"),
        member(HT, SA, "org_admin"),
        member(LG, SA, "org_admin"),
        member(WC, PADMIN),
        member(WC, OWNERU, "org_admin"),
        member(WC, ACCT),
        member(WC, OWNER2),
        member(WC, REP),
        member(WC, BIDS),
        member(NM, REP),
      ],
    });
    await db.user.update({ where: { id: SA }, data: { activeOrgId: HT } });
    await seedOrgAuthorizationProfiles(WC);
    await seedOrgAuthorizationProfiles(HT);
    const bind = async (orgId: string, userId: string, key: string) => {
      const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId, key } } });
      if (!profile) throw new Error(`岗位 ${key} 不存在于 ${orgId}`);
      await db.principalRoleBinding.create({ data: { orgId, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
    };
    await bind(WC, OWNERU, "owner");
    await bind(WC, ACCT, "accounting");
    await bind(WC, OWNER2, "owner");
    await bind(WC, OWNER2, "bids");
    await bind(WC, REP, "sales_rep");
    await bind(WC, BIDS, "bids");
    await db.project.create({ data: { id: P1, name: "Example Tender", ownerId: BIDS, orgId: WC, status: "active" } });
    // 本人另一企业（家纺，本人是 org_admin）的项目与任务：预览中不应出现
    await db.project.create({ data: { id: P2, name: "Example Textile Order", ownerId: OWNERU, orgId: HT, status: "active" } });
    const dueToday = new Date();
    const T1 = (await db.task.create({ data: { title: `Example scope ${stamp} WC`, projectId: P1, creatorId: BIDS, dueDate: dueToday }, select: { id: true } })).id;
    const T2 = (await db.task.create({ data: { title: `Example scope ${stamp} HT`, projectId: P2, creatorId: OWNERU, dueDate: dueToday }, select: { id: true } })).id;
    const card = async (type: string, createdById: string, extra: Json = {}) => {
      const row = await db.pendingAction.create({
        data: { type, title: `Example ${type}`, preview: "fixture", payload: {}, createdById, orgId: WC, status: "pending", expiresAt: new Date(Date.now() + 72 * 3600_000), ...extra },
        select: { id: true },
      });
      cardIds.push(row.id);
      return `PENDING_ACTION:${row.id}`;
    };
    const PROMO = await card("sales.approve_quote_promotion", REP, { approverUserId: OWNERU });
    const RFQ = await card("tender.send_rfq", BIDS, { projectId: P1 });
    const WARRANTY = await card("install.send_warranty_email", OWNERU);

    // ── 请求工具 ──
    const sessions = new Map<string, string>();
    for (const [uid, role] of [[SA, "super_admin"], [PADMIN, "admin"], [OWNERU, "user"], [ACCT, "user"], [OWNER2, "user"]] as const) {
      sessions.set(uid, await createSession({ sub: uid, email: `${uid}@fixture.test`, role }));
    }
    const cookieOf = (uid: string, preview?: string | null) => `qy_session=${sessions.get(uid)}${preview ? `; qy_preview=${preview}` : ""}`;
    const mkReq = (uid: string, url: string, preview?: string | null, init: { method?: string; body?: unknown } = {}) =>
      new NextRequest(`http://localhost${url}`, {
        method: init.method ?? "GET",
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        headers: { cookie: cookieOf(uid, preview), "content-type": "application/json", "x-forwarded-for": "10.34.0.11" },
      });
    const call = async (handler: unknown, uid: string, url: string, preview?: string | null, init: { method?: string; body?: unknown; params?: Json } = {}) => {
      const req = mkReq(uid, url, preview, init);
      const res = await withPreviewToken(preview ?? null, () => (handler as Handler)(req, { params: Promise.resolve((init.params ?? {}) as Record<string, string>) }));
      const text = await res.text();
      let body: Json | null = null;
      try {
        body = JSON.parse(text) as Json;
      } catch {
        body = null;
      }
      return { status: res.status, body, text, setCookie: res.headers.get("set-cookie") ?? "" };
    };
    const tokenFrom = (setCookie: string) => /qy_preview=([^;]+)/.exec(setCookie)?.[1] ?? "";
    const start = async (uid: string, orgId: string, positionKeys: unknown) => {
      const r = await call(previewRoute.POST, uid, "/api/admin/preview", null, { method: "POST", body: { orgId, positionKeys } });
      return { ...r, token: tokenFrom(r.setCookie) };
    };
    const inPreview = <T,>(token: string | null, fn: () => Promise<T>) => withPreviewToken(token, fn);

    // ── 开启 ──
    console.log("\n开启与开启条件");
    const padmin = await start(PADMIN, WC, ["accounting"]);
    const ownerU = await start(OWNERU, WC, ["accounting"]);
    ok(padmin.status === 403 && padmin.body?.code === "PLATFORM_ADMIN_REQUIRED" && !padmin.token && ownerU.status === 403 && ownerU.body?.code === "PLATFORM_ADMIN_REQUIRED" && !ownerU.token, "平台 admin、持 owner 岗位的 user：403 PLATFORM_ADMIN_REQUIRED，不写 cookie", { padmin: padmin.body, ownerU: ownerU.body });
    const cond = [
      await start(SA, id("missing"), ["accounting"]),
      await start(SA, LG, ["accounting"]),
      await start(SA, NM, ["accounting"]),
      await start(SA, WC, []),
      await start(SA, WC, Array.from({ length: 11 }, (_, i) => `p${i}`)),
    ];
    await db.roleProfile.update({ where: { orgId_key: { orgId: WC, key: "installer" } }, data: { status: "inactive" } });
    cond.push(await start(SA, WC, ["accounting", "installer"]));
    await db.roleProfile.update({ where: { orgId_key: { orgId: WC, key: "installer" } }, data: { status: "active" } });
    const expected: Array<[number, string | undefined]> = [
      [404, undefined],
      [400, "PREVIEW_ORG_NOT_POSITION_MODE"],
      [400, "PREVIEW_NOT_MEMBER"],
      [400, "PREVIEW_POSITION_INVALID"],
      [400, "PREVIEW_POSITION_INVALID"],
      [400, "PREVIEW_POSITION_INVALID"],
    ];
    ok(cond.every((r, i) => r.status === expected[i][0] && (expected[i][1] === undefined || r.body?.code === expected[i][1]) && !r.token), "不满足条件：404、旧模式、非成员、空列表、11 个、含停用岗位依次被拒，都不写 cookie", cond.map((r) => [r.status, r.body?.code]));
    const acct = await start(SA, WC, ["accounting"]);
    ok(acct.status === 200 && acct.body?.orgId === WC && typeof acct.body?.expiresAt === "string" && same((acct.body?.positions as Json[])?.map((p) => p.key), ["accounting"]) && /HttpOnly/i.test(acct.setCookie) && !!acct.token, "开启成功：企业、岗位、到期，Set-Cookie 带 HttpOnly", { body: acct.body, setCookie: acct.setCookie.slice(0, 80) });
    const T = acct.token;

    // ── 预览身份 ──
    console.log("\n预览身份");
    const me = await call(meRoute.GET, SA, "/api/auth/me", T);
    const meUser = me.body?.user as Json | undefined;
    const mePreview = me.body?.preview as Json | undefined;
    ok(meUser?.role === "user" && meUser?.activeOrgId === WC && meUser?.autopilotAllowed === false && mePreview?.state === "active" && mePreview?.orgId === WC, "当前用户接口：平台角色 user、当前企业为预览企业、无 Autopilot、带预览信息", me.body);
    const authUser = await inPreview(T, () => getCurrentUser(mkReq(SA, "/api/x", T)));
    ok(authUser?.role === "user", "鉴权：平台角色 user");
    const keys = new Set((await inPreview(T, () => resolveEffectiveBindings({ type: "HUMAN", id: SA, orgId: WC }))).filter((b) => b.effect === "ALLOW").map((b) => b.permissionKey));
    const acctKeys = new Set((await resolveEffectiveBindings({ type: "HUMAN", id: ACCT, orgId: WC })).filter((b) => b.effect === "ALLOW").map((b) => b.permissionKey));
    ok(same([...keys].sort(), [...acctKeys].sort()) && keys.has("install.balance.confirm") && !keys.has("sales.quote.discount.over_limit.approve"), "权限：与持 accounting 的成员逐个相同，不持报价让利审批键", { preview: [...keys].length, real: [...acctKeys].length });
    const mWC = await inPreview(T, () => getOrgMembership(SA, WC));
    const mHT = await inPreview(T, () => getOrgMembership(SA, HT));
    ok(mWC?.role === "org_member" && mWC.status === "active" && mHT === null, "成员解析：预览企业 org_member，另一企业非成员", { mWC: mWC?.role, mHT });
    const htBind = await inPreview(T, () => resolveEffectiveBindings({ type: "HUMAN", id: SA, orgId: HT }));
    ok(htBind.length === 0, "另一企业：无权限");

    // MODIFIED platform-admin-authority：预览期间只取所选岗位
    const az = (perm: string, orgId = WC, token: string | null = T) => inPreview(token, () => authorize({ principal: { type: "HUMAN", id: SA, orgId }, orgId, permission: perm }));
    ok(!(await az("sales.quote.discount.over_limit.approve")).allowed && (await az("install.balance.confirm")).allowed && !(await az("sales.quote.read", HT)).allowed && (await az("sales.quote.discount.over_limit.approve", WC, null)).allowed, "权限判定：预览中只取所选岗位、另一企业拒绝；不带预览 cookie 照旧全权");

    // ── 平台特权不可用 ──
    console.log("\n平台特权");
    const gateUser = await inPreview(T, () => ROUTE_GATE_LOADER.loadUser(SA));
    ok(gateUser?.role === "user" && gateUser.activeOrgId === WC && !!gateUser.previewFingerprint, "路由门加载器：平台角色 user、当前企业为预览企业");
    const gate = (path: string, token: string | null = T) => inPreview(token, () => applyRouteGate(new NextRequest(`http://localhost${path}`), SA, ROUTE_GATE_LOADER));
    ok((await gate("/admin/users"))?.status === 302, "平台管理员页：预览中被拒");
    const gateCtx = await inPreview(T, () => ROUTE_GATE_LOADER.loadContext(gateUser!));
    const normalCtx = await ROUTE_GATE_LOADER.loadContextForOrg((await ROUTE_GATE_LOADER.loadUser(SA))!, WC);
    ok(gateCtx.autopilotAllowed === false && normalCtx.autopilotAllowed === true, "Autopilot：预览中关闭（不带预览照旧开）");
    const positions = await call(positionsRoute.GET, SA, `/api/organizations/${WC}/positions`, T, { params: { orgId: WC } });
    ok(positions.status === 403, "平台管理员接口（岗位绑定）：预览中 403", positions.status);
    const crossOrg = await call(approvalsRoute.GET, SA, `/api/capabilities/approvals?tab=all&orgId=${HT}`, T);
    ok(crossOrg.status === 403 || crossOrg.status === 400, "另一企业的资源：预览中被拒", crossOrg.status);

    // ── 会计看到的（与真实会计逐项相同） ──
    console.log("\n会计看到的");
    ok((await gate("/bids"))?.status === 302 && (await gate("/accounting")) === null, "路由门：/bids 302、/accounting 放行");
    const aoPreview = await call(activeOrgRoute.GET, SA, "/api/auth/active-org", T);
    const aoReal = await call(activeOrgRoute.GET, ACCT, "/api/auth/active-org", null);
    const navFields = (b: Json | null) => ({ orgRole: b?.orgRole, hasMembership: b?.hasMembership, positionMode: b?.positionMode, keys: [...((b?.permissionKeys as string[]) ?? [])].sort(), modules: b?.modules });
    ok(aoPreview.body?.activeOrgId === WC && same(navFields(aoPreview.body), navFields(aoReal.body)), "侧栏判定输入：与真实会计相同（成员角色、岗位模式、键、模块）", { preview: navFields(aoPreview.body), real: navFields(aoReal.body) });
    const ids = (b: Json | null) => ((b?.items as Json[]) ?? []).map((i) => i.id as string).sort();
    const apPreview = await call(approvalsRoute.GET, SA, "/api/capabilities/approvals?tab=all&pageSize=100", T);
    const apReal = await call(approvalsRoute.GET, ACCT, "/api/capabilities/approvals?tab=all&pageSize=100", null);
    ok(apPreview.status === 200 && same(ids(apPreview.body), ids(apReal.body)) && ids(apPreview.body).includes(WARRANTY) && !ids(apPreview.body).includes(PROMO) && !ids(apPreview.body).includes(RFQ), "审批中心：与真实会计相同——看得到质保邮件卡，看不到他人的让利审批与询价卡", { preview: ids(apPreview.body), real: ids(apReal.body) });
    const pendIds = (b: Json | null) => ((b?.actions as Json[]) ?? []).map((a) => a.id as string).sort();
    const pdPreview = await call(pendingRoute.GET, SA, "/api/ai/pending-actions", T);
    const pdReal = await call(pendingRoute.GET, ACCT, "/api/ai/pending-actions", null);
    ok(pdPreview.status === 200 && same(pendIds(pdPreview.body), pendIds(pdReal.body)) && !pendIds(pdPreview.body).some((x) => [PROMO, RFQ].some((c) => c.endsWith(x))), "「待我确认」：与真实会计相同，不含让利审批与询价卡", { preview: pendIds(pdPreview.body), real: pendIds(pdReal.body) });
    const toolNames = (b: Json | null) => ((b?.tools as Json[]) ?? []).map((t) => t.name as string).sort();
    const tlPreview = await call(toolsRoute.GET, SA, "/api/agent-core/tools", T);
    const tlReal = await call(toolsRoute.GET, ACCT, "/api/agent-core/tools", null);
    ok(tlPreview.status === 200 && same(toolNames(tlPreview.body), toolNames(tlReal.body)), "AI 工具列表：与真实会计相同", { preview: toolNames(tlPreview.body).length, real: toolNames(tlReal.body).length });
    const cockpitPreview = await inPreview(T, async () => resolveCockpitViewer((await getCurrentUser(mkReq(SA, "/api/x", T)))!));
    const cockpitReal = await resolveCockpitViewer((await getCurrentUser(mkReq(ACCT, "/api/x", null)))!);
    ok(cockpitPreview.ok === cockpitReal.ok, "首页岗位总览：与真实会计相同（是否管理层）", { preview: cockpitPreview.ok, real: cockpitReal.ok });

    // ── 老板看到的（与真实 owner + bids 成员相同） ──
    console.log("\n老板看到的");
    const boss = await start(SA, WC, ["owner", "bids"]);
    const B = boss.token;
    ok((await gate("/bids", B)) === null, "路由门：/bids 放行");
    const minePreview = await call(approvalsRoute.GET, SA, "/api/capabilities/approvals?tab=pending_mine&pageSize=100", B);
    const mineReal = await call(approvalsRoute.GET, OWNER2, "/api/capabilities/approvals?tab=pending_mine&pageSize=100", null);
    ok(minePreview.status === 200 && same(ids(minePreview.body), ids(mineReal.body)), "「待我审批」：与持 owner + bids 的成员相同", { preview: ids(minePreview.body), real: ids(mineReal.body) });
    const allBoss = await call(approvalsRoute.GET, SA, "/api/capabilities/approvals?tab=all&pageSize=100", B);
    ok(ids(allBoss.body).includes(RFQ) && ids(allBoss.body).includes(PROMO), "审批中心：老板岗位看得到询价与让利审批");
    const bossCockpit = await inPreview(B, async () => resolveCockpitViewer((await getCurrentUser(mkReq(SA, "/api/x", B)))!));
    ok(bossCockpit.ok === true, "首页岗位总览：老板岗位是管理层");

    // ── GET 不写业务数据 ──
    console.log("\nGET 不写业务数据");
    const briefBefore = await db.notification.count({ where: { userId: SA, type: "sales_daily_briefing" } });
    const brief = await call(briefingRoute.GET, SA, "/api/sales/daily-briefing", B);
    const briefAfter = await db.notification.count({ where: { userId: SA, type: "sales_daily_briefing" } });
    ok(brief.status === 200 && brief.body?.previewReadonly === true && brief.body?.briefing === null && brief.body?.cached === false && briefAfter === briefBefore, "每日简报：预览中不生成、不建通知（没有当日缓存时返回空并标只读）", { status: brief.status, body: brief.body });
    const dbActive = (await db.user.findUnique({ where: { id: SA }, select: { activeOrgId: true } }))?.activeOrgId;
    ok(dbActive === HT, "库里的当前企业仍是家纺企业（预览中的 GET 都没有改写）", dbActive);

    // ── 审查补充：其他读成员企业与平台角色的地方（与真实会计逐项相同） ──
    console.log("\n其他读取点（与真实会计相同）");
    const visPreview = [...((await inPreview(T, () => getVisibleProjectIds(SA, "user"))) ?? [])].sort();
    const visReal = [...((await getVisibleProjectIds(ACCT, "user")) ?? [])].sort();
    ok(same(visPreview, visReal) && visPreview.includes(P1) && !visPreview.includes(P2), "项目可见范围：与真实会计相同，不含本人另一企业的项目", { preview: visPreview.length, real: visReal.length });
    const searchIds = (b: Json | null) => ({ tasks: ((b?.tasks as Json[]) ?? []).map((t) => t.id as string).sort(), projects: ((b?.projects as Json[]) ?? []).map((x) => x.id as string).sort() });
    const sPreview = await call(searchRoute.GET, SA, `/api/search?q=${stamp}`, T);
    const sReal = await call(searchRoute.GET, ACCT, `/api/search?q=${stamp}`, null);
    const sSelf = await call(searchRoute.GET, SA, `/api/search?q=${stamp}`, null);
    ok(sPreview.status === 200 && same(searchIds(sPreview.body), searchIds(sReal.body)) && searchIds(sPreview.body).tasks.includes(T1) && !searchIds(sPreview.body).tasks.includes(T2) && searchIds(sSelf.body).tasks.includes(T2), "全局搜索：与真实会计相同，搜不到本人另一企业的任务（不带预览照旧搜得到）", { preview: searchIds(sPreview.body), real: searchIds(sReal.body), self: searchIds(sSelf.body) });
    const taskIdsIn = (v: unknown, out = new Set<string>()): Set<string> => {
      if (Array.isArray(v)) v.forEach((x) => taskIdsIn(x, out));
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        for (const k of ["id", "taskId"]) if (o[k] === T1 || o[k] === T2) out.add(o[k] as string);
        Object.values(o).forEach((x) => taskIdsIn(x, out));
      }
      return out;
    };
    const remPreview = [...taskIdsIn(await inPreview(T, () => generateReminderLayers(SA)))].sort();
    const remReal = [...taskIdsIn(await generateReminderLayers(ACCT))].sort();
    const remSelf = [...taskIdsIn(await inPreview(null, () => generateReminderLayers(SA)))].sort();
    ok((await inPreview(T, () => effectivePlatformRole(SA, "super_admin"))) === "user" && same(remPreview, remReal) && remPreview.includes(T1) && !remPreview.includes(T2) && remSelf.includes(T2), "首页提醒：平台角色按 user、与真实会计相同，不含本人另一企业的任务（不带预览照旧含）", { preview: remPreview, real: remReal, self: remSelf });
    const orgRows = (b: Json | null) => ((b?.organizations as Json[]) ?? []).filter((o) => ORGS.includes(o.id as string)).map((o) => `${o.id}:${o.myRole}`).sort();
    const olPreview = await call(orgsRoute.GET, SA, "/api/organizations", T);
    const olReal = await call(orgsRoute.GET, ACCT, "/api/organizations", null);
    ok(olPreview.status === 200 && same(orgRows(olPreview.body), [`${WC}:org_member`]) && same(orgRows(olPreview.body), orgRows(olReal.body)), "企业列表：只有预览企业、成员角色 org_member，与真实会计相同", { preview: orgRows(olPreview.body), real: orgRows(olReal.body) });
    const prefCount = () => db.userNotificationPreference.count({ where: { userId: SA } });
    const prefBefore = await prefCount();
    const nl = await call(notificationsRoute.GET, SA, "/api/notifications", T);
    const uc = await call(unreadRoute.GET, SA, "/api/notifications/unread-count", T);
    const pm = await call(prefRoute.GET, SA, "/api/notifications/preferences/me", T);
    const prefInPreview = await prefCount();
    await call(notificationsRoute.GET, SA, "/api/notifications", null);
    const prefPlain = await prefCount();
    ok(nl.status === 200 && uc.status === 200 && pm.status === 200 && prefBefore === 0 && prefInPreview === 0 && prefPlain === 1, "通知列表、未读数、通知偏好：预览中不同步、不建偏好行（不带预览照旧建）", { status: [nl.status, uc.status, pm.status], prefBefore, prefInPreview, prefPlain });
    const reqPreview = await getRequestPreview(mkReq(SA, "/api/x", T), SA);
    const reqForeign = await getRequestPreview(mkReq(ACCT, "/api/x", T), SA);
    ok(reqPreview?.state === "active" && reqForeign === null, "预览只认当前会话：别人的会话带着本人的预览 cookie 不生效", { own: reqPreview?.state, foreign: reqForeign });

    // 已失效的预览中，本人失效的当前企业偏好也不清空（不带预览照旧清空）
    await db.organization.update({ where: { id: NM }, data: { status: "archived" } });
    await db.user.update({ where: { id: SA }, data: { activeOrgId: NM } });
    await db.roleProfile.update({ where: { orgId_key: { orgId: WC, key: "accounting" } }, data: { status: "inactive" } });
    __resetPreviewCacheForTests();
    const staleAo = await call(activeOrgRoute.GET, SA, "/api/auth/active-org", T);
    const staleKept = (await db.user.findUnique({ where: { id: SA }, select: { activeOrgId: true } }))?.activeOrgId;
    await db.roleProfile.update({ where: { orgId_key: { orgId: WC, key: "accounting" } }, data: { status: "active" } });
    await call(activeOrgRoute.GET, SA, "/api/auth/active-org", null);
    const staleCleared = (await db.user.findUnique({ where: { id: SA }, select: { activeOrgId: true } }))?.activeOrgId;
    await db.organization.update({ where: { id: NM }, data: { status: "active" } });
    await db.user.update({ where: { id: SA }, data: { activeOrgId: HT } });
    __resetPreviewCacheForTests();
    ok(staleAo.status === 200 && staleKept === NM && staleCleared === null, "已失效的预览：失效的当前企业偏好不清空（不带预览照旧清空）", { status: staleAo.status, staleKept, staleCleared });

    // ── 只读：代理拒写不带 cookie 值 ──
    console.log("\n只读");
    const refused = await handleRequest(new NextRequest("http://localhost/api/sales/customers", { method: "POST", headers: { cookie: cookieOf(SA, T) } }), ROUTE_GATE_LOADER);
    const refusedText = await refused.text();
    ok(refused.status === 409 && !refusedText.includes(T) && /PREVIEW_READONLY/.test(refusedText), "代理拒写：409，不含 cookie 值");
    ok(!me.text.includes(T) && !aoPreview.text.includes(T), "当前用户、当前企业接口的响应体不含 cookie 值");

    // ── 失效 ──
    console.log("\n失效与退出");
    const state = async () => {
      __resetPreviewCacheForTests();
      const r = await call(meRoute.GET, SA, "/api/auth/me", T);
      const gu = await inPreview(T, () => ROUTE_GATE_LOADER.loadUser(SA));
      return { state: (r.body?.preview as Json | null)?.state, role: (r.body?.user as Json | undefined)?.role, gateRole: gu?.role };
    };
    const invalid = (s: Awaited<ReturnType<typeof state>>) => s.state === "invalid" && s.role === "super_admin" && s.gateRole === "super_admin";
    await db.roleProfile.update({ where: { orgId_key: { orgId: WC, key: "accounting" } }, data: { status: "inactive" } });
    const s1 = await state();
    await db.roleProfile.update({ where: { orgId_key: { orgId: WC, key: "accounting" } }, data: { status: "active" } });
    await db.organizationMember.update({ where: { orgId_userId: { orgId: WC, userId: SA } }, data: { status: "inactive" } });
    const s2 = await state();
    await db.organizationMember.update({ where: { orgId_userId: { orgId: WC, userId: SA } }, data: { status: "active" } });
    await db.organization.update({ where: { id: WC }, data: { industryPackId: null } });
    const s3 = await state();
    await db.organization.update({ where: { id: WC }, data: { industryPackId: "window_covering_services_v1" } });
    await db.user.update({ where: { id: SA }, data: { role: "admin" } });
    const s4 = await state();
    await db.user.update({ where: { id: SA }, data: { role: "super_admin" } });
    ok(invalid(s1) && invalid(s2) && invalid(s3), "停用岗位 / 移出企业 / 企业改旧模式：state invalid，判定恢复本人身份", { s1, s2, s3 });
    ok(s4.state === "invalid" && s4.role === "admin" && s4.gateRole === "admin", "撤掉平台 super_admin：state invalid，按本人当前平台角色判定", s4);
    const s5 = await state();
    ok(s5.state === "active" && s5.role === "user", "条件恢复后：预览重新生效", s5);
    const exit = await call(previewRoute.DELETE, SA, "/api/admin/preview", T, { method: "DELETE" });
    ok(exit.status === 200 && exit.body?.ok === true && /qy_preview=;/.test(exit.setCookie) && /Max-Age=0/i.test(exit.setCookie), "退出：清 cookie，返回 ok", exit.setCookie);
    const after = await call(meRoute.GET, SA, "/api/auth/me", null);
    ok(after.body?.preview === null && (after.body?.user as Json)?.role === "super_admin" && (await gate("/bids", null)) === null, "退出后：不带预览，平台角色恢复，路由门放行");

    // ── 登出 ──
    const out = await call(logoutRoute.POST, SA, "/api/auth/logout", B, { method: "POST" });
    ok(out.status === 200 && /qy_preview=;/.test(out.setCookie) && /qy_session=;/.test(out.setCookie), "登出：同时清掉会话与预览 cookie", out.setCookie.slice(0, 200));

    // ── 审计 ──
    console.log("\n审计");
    const audits = await db.auditLog.findMany({ where: { userId: SA, action: { in: ["PREVIEW_STARTED", "PREVIEW_ENDED"] } }, orderBy: { createdAt: "asc" }, select: { action: true, targetId: true, afterData: true, orgId: true } });
    const started = audits.filter((a) => a.action === "PREVIEW_STARTED");
    const ended = audits.filter((a) => a.action === "PREVIEW_ENDED");
    const raw = JSON.stringify(audits);
    ok(started.length === 2 && ended.length === 2 && audits.every((a) => a.targetId === WC && a.orgId === null) && !raw.includes(T) && !raw.includes(B) && raw.includes("accounting"), "开启两次、退出一次 + 带预览登出一次：各有审计，带企业与岗位，不含 cookie 值、不进企业时间线", audits.map((a) => [a.action, a.orgId]));

    // ── 不带 cookie 的请求照旧 ──
    console.log("\n不带 cookie");
    const plainUser = await getCurrentUser(mkReq(SA, "/api/x", null));
    const plainBind = await resolveEffectiveBindings({ type: "HUMAN", id: SA, orgId: WC });
    ok(plainUser?.role === "super_admin" && plainBind.some((b) => b.permissionKey === "sales.quote.discount.over_limit.approve") && (await gate("/admin/users", null)) === null, "同一用户不带预览 cookie：平台角色 super_admin、全权、平台管理员页放行");
  } finally {
    __resetPreviewCacheForTests();
    await db.pendingAction.deleteMany({ where: { OR: [{ id: { in: cardIds } }, { createdById: { in: USERS } }] } }).catch(() => undefined);
    await db.notification.deleteMany({ where: { userId: { in: USERS } } }).catch(() => undefined);
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: USERS } }, { orgId: { in: ORGS } }] } }).catch(() => undefined);
    await db.aiThread.deleteMany({ where: { userId: { in: USERS } } }).catch(() => undefined);
    await db.task.deleteMany({ where: { projectId: { in: [P1, P2] } } }).catch(() => undefined);
    await db.userNotificationPreference.deleteMany({ where: { userId: { in: USERS } } }).catch(() => undefined);
    await db.project.deleteMany({ where: { id: { in: [P1, P2] } } }).catch((e) => console.warn("project cleanup:", e instanceof Error ? e.message : e));
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: ORGS } } }).catch(() => undefined);
    await db.roleProfile.deleteMany({ where: { orgId: { in: ORGS } } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: { in: ORGS } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: ORGS } } }).catch(() => undefined);
    await db.user.updateMany({ where: { id: { in: USERS } }, data: { activeOrgId: null } }).catch(() => undefined);
    await db.organization.deleteMany({ where: { id: { in: ORGS } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: USERS } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nVIS-1e 以岗位预览 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
