/**
 * 中间件（Next 16 起为 src/proxy.ts）对营销工作区的处理（VIS-1a 起）：
 * - 营销页面（/marketing/**、/operations/growth/**）由路由门按「品牌增长」入口判定，不放行 302 到落地页；
 * - 营销接口（/api/marketing/**）的旧模式拦截保留：JWT 平台角色 sales → 403。
 * 路由门的判定输入用注入的假加载器（不连库）；完整矩阵见 src/lib/navigation/__tests__/route-gate.test.ts。
 * 运行：npx tsx src/lib/marketing/__tests__/marketing-middleware-access.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { handleRequest } from "../../../proxy";
import type { RouteGateContext, RouteGateLoader } from "../../navigation/route-gate";
import { WINDOW_COVERING_INDUSTRY_PACK, mergedProfileBindings } from "../../authorization/role-defaults";
import { DEFAULT_SUNNY_MODULES } from "../../tenancy/modules";

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "marketing-middleware-test-secret";

async function token(role: string) {
  return new SignJWT({ sub: `user-${role}`, email: `${role}@example.test`, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
}

async function request(pathname: string, role: string) {
  return new NextRequest(`https://qingyan.test${pathname}`, {
    headers: { cookie: `qy_session=${await token(role)}` },
  });
}

const keysOf = (position: string) => [
  ...new Set(
    mergedProfileBindings(WINDOW_COVERING_INDUSTRY_PACK, position)
      .filter((b) => (b.effect ?? "ALLOW") === "ALLOW")
      .map((b) => b.permissionKey),
  ),
];

/** 假加载器：按岗位给出岗位模式（Sunny）的判定输入；loadUser 记录调用次数 */
function loaderFor(position: string, extra: Partial<RouteGateContext> = {}) {
  const calls = { user: 0 };
  const loader: RouteGateLoader = {
    async loadUser(userId) {
      calls.user++;
      return { id: userId, role: "user", status: "active", activeOrgId: "org-sunny" };
    },
    async loadContext() {
      return {
        platformRole: "user",
        orgRole: "org_member",
        hasMembership: true,
        workspaceIds: [],
        modules: { enabled: [...DEFAULT_SUNNY_MODULES] },
        isPlatformAdmin: false,
        permissionKeys: keysOf(position),
        positionMode: true,
        hasBidCapability: false,
        autopilotAllowed: false,
        wechatEntryEnabled: false,
        ...extra,
      };
    },
  };
  return { loader, calls };
}

test("销售访问营销页面：路由门 302 到销售落地页", async () => {
  const { loader } = loaderFor("sales_rep");
  const response = await handleRequest(await request("/operations/growth/metrics", "user"), loader);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://qingyan.test/sales/home");
  const legacy = loaderFor("sales_rep", { positionMode: false, platformRole: "sales" });
  const legacyResponse = await handleRequest(await request("/marketing/employee", "sales"), legacy.loader);
  assert.equal(legacyResponse.status, 302);
  assert.equal(legacyResponse.headers.get("location"), "https://qingyan.test/sales/home");
});

test("销售直接调用营销 API 得到 403（旧模式接口分支保留，不经路由门）", async () => {
  const { loader, calls } = loaderFor("sales_rep");
  const response = await handleRequest(await request("/api/marketing/dashboard", "sales"), loader);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "销售账号无权访问营销工作区" });
  assert.equal(calls.user, 0);
});

test("运营可继续访问营销页面，销售业务页面不受影响", async () => {
  const ops = loaderFor("ops_staff");
  const operationsResponse = await handleRequest(await request("/operations/growth", "user"), ops.loader);
  assert.equal(operationsResponse.headers.get("x-middleware-next"), "1");
  const sales = loaderFor("sales_rep");
  const salesResponse = await handleRequest(await request("/sales/quote-sheet", "user"), sales.loader);
  assert.equal(salesResponse.headers.get("x-middleware-next"), "1");
});

test("安装工访问营销页面：302 到安装落地页", async () => {
  const { loader } = loaderFor("installer");
  const response = await handleRequest(await request("/marketing/employee", "user"), loader);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://qingyan.test/install");
});

test.after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
