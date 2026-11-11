/**
 * VIS-1e 以岗位预览（spec authorization/position-preview；change vis-1e-preview-as-position）
 * 运行：npx tsx src/lib/preview/__tests__/preview.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";

process.env.JWT_SECRET = process.env.JWT_SECRET || "vis1e-pure-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

async function main() {
  const token = await import("../token");
  const identity = await import("../identity");
  const server = await import("../server");
  const { verifySession, createSession } = await import("@/lib/auth/session");

  console.log("preview（以岗位预览）");

  console.log("\ncookie 编解码与无库校验");
  {
    const now = new Date("2026-11-11T10:00:00Z");
    const { token: t, expiresAt } = await token.signPreviewToken({ userId: "u1", orgId: "o1", keys: ["accounting", "owner", "accounting"] }, { now });
    ok(expiresAt.getTime() - now.getTime() === token.PREVIEW_TTL_SECONDS * 1000, "到期 = 签发后 2 小时");
    const claims = await token.verifyPreviewToken(t, "u1", { now });
    ok(!!claims && claims.orgId === "o1" && JSON.stringify(claims.keys) === JSON.stringify(["accounting", "owner"]), "校验通过：企业与岗位（去重保序）", claims);
    ok((await token.verifyPreviewToken(t, "u2", { now })) === null, "属于另一用户：当作不存在");
    ok((await token.verifyPreviewToken(t, "u1", { now: new Date(now.getTime() + 2 * 3600_000 + 1000) })) === null, "过期：当作不存在");
    const tampered = t.slice(0, t.lastIndexOf(".") + 1) + (t.endsWith("A") ? "B" : "A") + t.slice(t.lastIndexOf(".") + 2);
    ok((await token.verifyPreviewToken(tampered, "u1", { now })) === null, "签名被改：当作不存在");
    const [h, , sig] = t.split(".");
    const body = Buffer.from(JSON.stringify({ sub: "u1", orgId: "o-other", keys: ["owner"], aud: "qy-preview", exp: 9e9 })).toString("base64url");
    ok((await token.verifyPreviewToken(`${h}.${body}.${sig}`, "u1", { now })) === null, "改企业或岗位后签名不符：当作不存在");
    ok((await token.verifyPreviewToken(t, "u1", { now, secret: "another-secret-0123456789" })) === null, "换密钥：当作不存在");
    ok((await token.verifyPreviewToken(null, "u1")) === null && (await token.verifyPreviewToken(t, null, { now })) === null, "缺 token 或缺会话用户：当作不存在");

    const derivedWrongAud = await new SignJWT({ orgId: "o1", keys: ["owner"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setAudience("something-else")
      .setExpirationTime("1h")
      .sign(new Uint8Array((await import("node:crypto")).createHmac("sha256", process.env.JWT_SECRET!).update("qy-preview-v1").digest()));
    ok((await token.verifyPreviewToken(derivedWrongAud, "u1")) === null, "aud 不符：当作不存在");

    ok((await verifySession(t)) === null, "预览 cookie 当会话 token 校验：被拒（派生密钥）");
    const session = await createSession({ sub: "u1", email: "u1@fixture.test", role: "super_admin" });
    ok((await token.verifyPreviewToken(session, "u1")) === null, "会话 token 当预览校验：被拒");

    ok(token.normalizePositionKeys([]) === null && token.normalizePositionKeys(Array.from({ length: 11 }, (_, i) => `p${i}`)) === null, "岗位 0 个或 11 个：不合格");
    ok(token.normalizePositionKeys(["Owner"]) === null && token.normalizePositionKeys([1]) === null && token.normalizePositionKeys("owner") === null, "岗位 key 形状不对：不合格");
    ok(JSON.stringify(token.normalizePositionKeys([" bids ", "owner", "bids"])) === JSON.stringify(["bids", "owner"]), "岗位 key 去空白、去重保序");
  }

  console.log("\n预览身份");
  {
    const active = {
      state: "active" as const,
      userId: "u1",
      orgId: "o1",
      orgName: "Example Blinds",
      positions: [{ key: "accounting", name: "会计" }],
      expiresAt: new Date("2026-11-11T12:00:00Z"),
      bindings: [
        { permissionKey: "install.balance.confirm", dataScope: "ORG", effect: "ALLOW" as const, source: "preview:accounting:1" },
        { permissionKey: "install.balance.confirm", dataScope: "PRINCIPAL", effect: "ALLOW" as const, source: "preview:accounting:2" },
        { permissionKey: "sales.quote.read", dataScope: "ORG", effect: "DENY" as const, source: "preview:accounting:3" },
      ],
      fingerprint: "pv:o1:accounting:1",
    };
    ok(JSON.stringify(identity.previewAllowKeys(active)) === JSON.stringify(["install.balance.confirm"]), "有效权限键：只取 ALLOW、去重");
    ok(identity.activePreviewFor(active, "u1") === active && identity.activePreviewFor(active, "u2") === null, "只对本人生效");
    const invalid = { ...active, state: "invalid" as const, reason: "position_inactive" as const, bindings: undefined };
    ok(identity.activePreviewFor(invalid as never, "u1") === null, "失效状态：读取恢复本人身份");
    ok(JSON.stringify(identity.previewMembershipFor(active, "o1")) === JSON.stringify({ role: "org_member", status: "active" }) && identity.previewMembershipFor(active, "o2") === null, "成员关系：预览企业为 org_member，其他企业非成员");
    ok(identity.PREVIEW_PLATFORM_ROLE === "user" && identity.PREVIEW_ORG_ROLE === "org_member", "平台角色 user、成员角色 org_member");
    const banner = identity.previewBannerInfo(active);
    ok(banner.state === "active" && banner.orgName === "Example Blinds" && !("bindings" in banner) && !JSON.stringify(banner).includes("eyJ"), "横幅信息：企业、岗位、到期，不含权限行与 token", banner);
    ok(identity.previewFingerprint({ orgId: "o1", keys: ["b", "a"], exp: 5 }) === identity.previewFingerprint({ orgId: "o1", keys: ["a", "b"], exp: 5 }), "缓存指纹与岗位顺序无关");
  }

  console.log("\n拒写判定");
  {
    const r = (method: string, pathname: string, hasSignedPreview = true) => identity.shouldRefusePreviewWrite({ method, pathname, hasSignedPreview });
    ok(["POST", "PUT", "PATCH", "DELETE", "post"].every((m) => r(m, "/api/sales/customers")), "业务 API 的写方法：拒");
    ok(r("POST", "/api/sales/quotes/share/tok/sign") && r("POST", "/settings"), "公开签字接口与页面路径的写：拒");
    ok(["GET", "HEAD", "OPTIONS"].every((m) => !r(m, "/api/sales/customers")), "GET / HEAD / OPTIONS：放行");
    ok(!r("DELETE", "/api/admin/preview") && !r("POST", "/api/auth/logout") && !r("POST", "/api/auth/login") && !r("POST", "/api/auth/logout/"), "退出预览、登出、登录：豁免");
    ok(r("POST", "/api/admin/preview") && r("GET", "/api/admin/preview") === false && r("DELETE", "/api/auth/logout"), "豁免只认方法 + 路径（预览中开新预览也拒）");
    ok(!r("POST", "/api/sales/customers", false), "没有签名有效的预览：不拒");
    const body = identity.previewReadonlyBody();
    ok(body.code === "PREVIEW_READONLY" && body.error === "预览中为只读，不能修改数据。退出预览后再操作。", "409 响应体");
  }

  console.log("\n按请求取预览");
  {
    ok((await server.getAmbientPreview("u1")) === null, "请求之外（无 next/headers 请求存储）：按无预览");
    ok((await server.withoutPreview(() => server.getAmbientPreview("u1"))) === null, "withoutPreview：无预览");
    const { token: t } = await token.signPreviewToken({ userId: "u1", orgId: "o1", keys: ["owner"] });
    ok((await server.withPreviewToken(t, () => server.getAmbientPreview("u2"))) === null, "注入别人的 token：不生效（不读库）");
    ok((await server.getRequestPreview({ cookies: { get: () => undefined } } as never, "u1")) === null, "请求里没有预览 cookie：无预览");
  }

  console.log("\n纯模块");
  {
    for (const f of ["src/lib/preview/token.ts", "src/lib/preview/identity.ts"]) {
      const src = code(f);
      ok(!/@\/lib\/db|from "next\/|from "react"/.test(src), `${f} 不导入数据库、next 与 react`);
    }
    const srv = code("src/lib/preview/server.ts");
    ok(/unstable_rethrow\(err\)/.test(srv) && /scope\.getStore\(\)/.test(srv), "server.ts：先看显式注入，再读 cookies()，Next 内部错误照常抛出");
    ok(/CACHE_TTL_MS = 30_000/.test(srv) && /`\$\{userId\}\|\$\{token\}`/.test(srv), "server.ts：按 token + userId 缓存 30 秒");
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
