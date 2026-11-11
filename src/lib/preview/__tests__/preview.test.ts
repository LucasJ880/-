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

  console.log("\n开启与退出（源码）");
  {
    const route = code("src/app/api/admin/preview/route.ts");
    const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function DELETE"));
    const del = route.slice(route.indexOf("export async function DELETE"));
    ok(/requirePlatformSuperAdmin\(request\)/.test(post) && !/requirePlatformSuperAdmin/.test(del) && /requireAuth\(request\)/.test(del), "开启只认平台 super_admin；退出只需会话");
    const order = ["组织不存在", "PREVIEW_ORG_NOT_POSITION_MODE", "PREVIEW_NOT_MEMBER", "PREVIEW_POSITION_INVALID", "signPreviewToken("].map((k) => post.indexOf(k));
    ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), "开启条件按 spec 顺序：企业 → 岗位模式 → 成员 → 岗位 → 签发", order);
    ok(/status: "active", principalType: "HUMAN"/.test(post) && /profiles\.length !== keys\.length/.test(post), "岗位须是本企业 active 的人类岗位，缺一个即 400");
    ok(/orgId: org\.id, orgName: org\.name, positions, expiresAt/.test(post), "开启成功的响应体");
    ok(/NextResponse\.json\(\{ ok: true \}\)/.test(del) && /clearPreviewCookie\(response\)/.test(del), "退出：清 cookie，返回 ok");
    ok(!/export (async )?function (?!GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/.test(route), "路由文件只导出 HTTP 方法");
    const cookie = code("src/lib/preview/cookie.ts");
    ok(/httpOnly: true/.test(cookie) && /sameSite: "lax"/.test(cookie) && /path: "\/"/.test(cookie) && /maxAge: PREVIEW_TTL_SECONDS/.test(cookie) && /secure: process\.env\.NODE_ENV === "production"/.test(cookie), "cookie 属性：httpOnly、生产 secure、lax、path /、2 小时");
    const audit = code("src/lib/preview/audit.ts");
    ok(/PREVIEW_STARTED/.test(post) && /PREVIEW_ENDED/.test(audit) && !/token/.test(audit) && !/afterData: \{[^}]*token/.test(post), "审计：开启 / 结束各一条，不含 token");
    const logout = code("src/app/api/auth/logout/route.ts");
    ok(/clearPreviewCookie\(response\)/.test(logout) && /logPreviewEnded\(userId, preview, request, "logout"\)/.test(logout), "登出：清预览 cookie，带有效预览时记预览结束");
    const login = code("src/app/api/auth/login/route.ts");
    ok(/clearPreviewCookie\(response\)/.test(login) && /withoutPreview\(\(\) => resolvePreferredOrgId\(/.test(login), "登录：清预览 cookie，选企业不带预览身份");
    const wx = code("src/app/api/auth/wechat/callback/route.ts");
    ok(/setSessionCookie\(response, token\);\s*clearPreviewCookie\(response\)/.test(wx), "微信回调登录：清预览 cookie");
  }

  console.log("\n鉴权、权限、成员与导航判定输入（源码）");
  {
    const usesPreview = (f: string, call: RegExp) => {
      const src = code(f);
      return /from "@\/lib\/preview\/server"/.test(src) && call.test(src);
    };
    ok(usesPreview("src/lib/auth/index.ts", /getActiveRequestPreview\(request, user\.id\)/) && /role: preview \? PREVIEW_PLATFORM_ROLE : user\.role/.test(code("src/lib/auth/index.ts")), "getCurrentUser：预览中平台角色为 user");
    ok(/return row && previewMembershipFor\(preview, orgId\) \? \{ \.\.\.row, role: PREVIEW_ORG_ROLE \} : null/.test(code("src/lib/auth/index.ts")), "getOrgMembership：预览企业 org_member，其他企业非成员");
    const rep = code("src/lib/authorization/resolve-effective-permissions.ts");
    const fn = rep.slice(rep.indexOf("export async function resolveEffectiveBindings"));
    ok(fn.indexOf("getActivePreview(principal.id)") > 0 && fn.indexOf("getActivePreview(principal.id)") < fn.indexOf("db.user.findUnique"), "resolveEffectiveBindings：预览判断在读平台角色之前");
    ok(/principal\.orgId === preview\.orgId\s*\?\s*preview\.bindings/.test(fn), "resolveEffectiveBindings：预览企业取所选岗位的权限行，其他企业为空");
    const ao = code("src/lib/organizations/active-org.ts");
    const rpo = ao.slice(ao.indexOf("export async function resolvePreferredOrgId"));
    const branch = rpo.slice(0, rpo.indexOf("listActiveOrgOptions(userId, userRole)"));
    ok(/getActivePreview\(userId\)/.test(branch) && !/setUserActiveOrgId|db\.user\.update/.test(branch), "resolvePreferredOrgId：预览中返回预览企业，不写 activeOrgId");
    ok(/if \(await isPreviewReadonly\(userId\)\) return orgId;\s*await db\.user\.update/.test(ao), "setUserActiveOrgId：预览中（含已失效）不写");
    ok(/if \(preview\) return preview\.orgId;\s*const row = await db\.user\.findUnique/.test(ao), "getUserActiveOrgId：预览中为预览企业");
    ok(/if \(preview\) return orgId === preview\.orgId;/.test(ao) && /if \(preview\) return previewOrgOptions\(preview\.orgId\)/.test(ao), "canUserUseOrg / listActiveOrgOptions：只有预览企业");
    ok(/if \(preview\) return preview\.orgId;\s*const profile = await getOrgAccessProfile/.test(code("src/lib/organizations/org-access.ts")), "ensureFixedUserActiveOrg：预览中不写");
    const trade = code("src/lib/trade/access.ts");
    ok(trade.indexOf("getActivePreview(user.id)") > 0 && trade.indexOf("getActivePreview(user.id)") < trade.indexOf("if (isPlatformSuperAdmin(user.role))"), "resolveTradeOrgId：预览判断在平台管理员分支之前");
    const rro = code("src/lib/auth/resolve-request-org.ts");
    ok(rro.indexOf("getActivePreview(user.id)") > 0 && rro.indexOf("getActivePreview(user.id)") < rro.indexOf("if (isAdmin(user.role))"), "resolveRequestOrgIdForUser：预览判断在管理员分支之前");
    ok(/if \(preview\) return \[preview\.orgId\];/.test(code("src/lib/workforce-runtime/read-model/api-org.ts")), "resolveWorkforceApiOrgForUser：可用企业只有预览企业");
    const cs = code("src/lib/navigation/context-server.ts");
    ok(/orgId === preview\.orgId\s*\?\s*\{ \.\.\.inputs, positionMode: true, orgRole: PREVIEW_ORG_ROLE, hasMembership: true, permissionKeys: previewAllowKeys\(preview\) \}/.test(cs) && /orgRole: null, hasMembership: false/.test(cs), "导航判定输入：预览企业 org_member + 所选岗位的键，其他企业非成员");
    const team = code("src/lib/marketing/team.ts");
    const gta = team.slice(team.indexOf("export async function getTeamApprovalAccessIds"));
    ok(/orgIds: \[\] as string\[\]/.test(gta) && /orgId: preview\.orgId/.test(gta), "团队审批处理人范围：预览中无企业范围，项目只取预览企业的");
    const me = code("src/app/api/auth/me/route.ts");
    ok(/preview: previewState \? previewBannerInfo\(previewState\) : null/.test(me) && /const activeOrgId = preview \? preview\.orgId/.test(me) && /!preview &&\s*hasAutopilotCapability/.test(me), "/api/auth/me：返回横幅信息（不含 token），当前企业为预览企业，无 Autopilot");
  }

  console.log("\n代理拒写");
  {
    const { NextRequest } = await import("next/server");
    const { handleRequest } = await import("@/proxy");
    const loaderCalls = { n: 0 };
    const loader = {
      async loadUser() {
        loaderCalls.n++;
        return { id: "u1", role: "user", status: "active", activeOrgId: "o1" };
      },
      async loadContext() {
        throw new Error("not used");
      },
      async loadContextForOrg() {
        throw new Error("not used");
      },
    };
    const session = await createSession({ sub: "u1", email: "u1@fixture.test", role: "super_admin" });
    const { token: pv } = await token.signPreviewToken({ userId: "u1", orgId: "o1", keys: ["accounting"] });
    const { token: foreign } = await token.signPreviewToken({ userId: "u2", orgId: "o1", keys: ["accounting"] });
    const send = (method: string, path: string, cookie: string) =>
      handleRequest(new NextRequest(`http://localhost${path}`, { method, headers: { cookie } }), loader as never);
    const both = `qy_session=${session}; qy_preview=${pv}`;
    const refused = async (r: Response) => r.status === 409 && JSON.stringify(await r.json()) === JSON.stringify(identity.previewReadonlyBody());
    ok(await refused(await send("POST", "/api/sales/customers", both)), "业务 API 的 POST：409 PREVIEW_READONLY");
    ok((await send("PUT", "/api/sales/customers/c1", both)).status === 409 && (await send("PATCH", "/api/auth/active-org", both)).status === 409 && (await send("DELETE", "/api/sales/customers/c1", both)).status === 409, "PUT / PATCH / DELETE：409（含回写当前企业）");
    ok((await send("POST", "/api/sales/quotes/share/tok/sign", both)).status === 409, "公开分享链接的签字接口（公开路径）：也 409");
    ok((await send("POST", "/settings", both)).status === 409, "页面路径的写：409");
    const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";
    ok(passes(await send("DELETE", "/api/admin/preview", both)), "退出预览：放行");
    ok(passes(await send("POST", "/api/auth/logout", both)) && passes(await send("POST", "/api/auth/login", both)), "登出、登录：放行");
    ok(passes(await send("GET", "/api/sales/customers", both)), "GET：放行");
    ok(passes(await send("POST", "/api/sales/customers", `qy_session=${session}; qy_preview=${foreign}`)), "别人的预览 cookie：不拒写");
    ok(passes(await send("POST", "/api/sales/customers", `qy_session=${session}; qy_preview=${pv.slice(0, -2)}xx`)), "被篡改的预览 cookie：不拒写");
    ok((await send("POST", "/api/sales/customers", `qy_preview=${pv}`)).status === 401, "没有会话：照旧 401，不按预览拒写");
    ok(loaderCalls.n === 0, "拒写与 API 请求不调路由门加载器");
  }

  console.log("\nGET 写库登记（design D9）");
  {
    const { readdirSync, existsSync } = await import("node:fs");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(join(process.cwd(), d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (e.name === "route.ts") files.push(rel);
      }
    };
    walk("src/app/api");
    // 写库调用：Prisma 写方法与几个已知的写库辅助函数（.delete( 会撞上 Map.delete，预览模块自身排除；
    // 要求点号前是标识符，排除 createHash(...).update( 这类链式调用）
    const WRITE = /(?<=[\w\]]\s*)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\bcreateNotification\(|\bsetUserActiveOrgId\(|\bensureMarketingSkill\(|\blogAudit\(|\bwriteAuditLog\(|\bensureFixedUserActiveOrg\(|\bresolvePreferredOrgId\(/g;
    // 函数体：function 声明按参数括号配对后跳过返回类型（返回类型可以是对象字面量）；箭头函数取第一个 `=> {`
    const closeOf = (src: string, i: number) => {
      let d = 0;
      for (let j = i; j < src.length; j++) {
        if (src[j] === "(") d++;
        else if (src[j] === ")" && --d === 0) return j;
      }
      return -1;
    };
    const bodyStart = (src: string, start: number) => {
      const lead = src.slice(start).match(/^\s*/)?.[0].length ?? 0;
      if (/^[^\n(=]*\bfunction\b/.test(src.slice(start + lead, start + lead + 200))) {
        const pe = closeOf(src, src.indexOf("(", start + lead));
        if (pe < 0) return -1;
        let depth = 0;
        let prev = ")";
        for (let j = pe + 1; j < src.length; j++) {
          const c = src[j];
          if (/\s/.test(c)) continue;
          if (c === "{" && depth === 0 && !":|&,".includes(prev)) return j;
          if ("<({[".includes(c)) depth++;
          else if (")}]".includes(c) || (c === ">" && prev !== "=")) depth--;
          prev = c;
        }
        return -1;
      }
      // 箭头函数：同一条声明里的第一个 `=>`；表达式体（不跟 `{`）取到行尾
      const rest = src.slice(start + lead);
      const end = rest.slice(1).search(/\n(export |const |function |async function )/);
      const decl = end < 0 ? rest : rest.slice(0, end + 1);
      const arrow = decl.indexOf("=>");
      if (arrow < 0) return -1;
      const after = decl.slice(arrow + 2).match(/^\s*/)?.[0].length ?? 0;
      const at = start + lead + arrow + 2 + after;
      return src[at] === "{" ? at : -(at + 2);
    };
    const bodyFrom = (src: string, start: number) => {
      const i = bodyStart(src, start);
      if (i < -1) {
        const at = -i - 2;
        const eol = src.indexOf("\n", at);
        return src.slice(at, eol < 0 ? undefined : eol);
      }
      if (i < 0) return "";
      let depth = 0;
      for (let j = i; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
      }
      return src.slice(i);
    };
    // 同文件：从入口函数体出发，把被调用的本文件函数体并进来（到不再增加为止）
    const reachWithin = (src: string, seed: string) => {
      let reach = seed;
      const seen = new Set<string>();
      for (let k = 0; k < 6; k++) {
        let added = false;
        for (const c of new Set([...reach.matchAll(/\b([a-zA-Z_]\w*)\(/g)].map((x) => x[1]))) {
          if (seen.has(c)) continue;
          const def = src.match(new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${c}\\b|(?:^|\\n)(?:export\\s+)?const\\s+${c}\\s*=\\s*(?:async\\s*)?\\(`));
          if (def && def.index !== undefined) {
            seen.add(c);
            reach += bodyFrom(src, def.index);
            added = true;
          }
        }
        if (!added) break;
      }
      return reach;
    };
    const resolveLib = (spec: string) => {
      const base = `src/${spec.replace(/^@\//, "")}`;
      return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((c) => existsSync(join(process.cwd(), c))) ?? null;
    };
    const SKIP_LIBS = new Set(["src/lib/preview/server.ts", "src/lib/cron/auth.ts"]);
    const found: Record<string, string[]> = {};
    for (const f of files) {
      if (f.startsWith("src/app/api/cron/")) continue; // 定时任务：Bearer 密钥，不带浏览器 cookie
      const src = code(f);
      const m = src.match(/export\s+(const|async function|function)\s+GET\b/);
      if (!m || m.index === undefined) continue;
      const reach = reachWithin(src, bodyFrom(src, m.index));
      const hits = new Set([...reach.matchAll(WRITE)].map((x) => x[0]));
      const called = new Set([...reach.matchAll(/\b([a-zA-Z_]\w*)\(/g)].map((x) => x[1]));
      // 跟进一层 @/lib 导入：被 GET 调到的导出函数（含其同文件辅助函数）
      for (const im of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+"(@\/lib\/[^"]+)"/g)) {
        const lib = resolveLib(im[2]);
        if (!lib || SKIP_LIBS.has(lib)) continue;
        const lsrc = code(lib);
        for (const name of im[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop() ?? "").filter(Boolean)) {
          if (!called.has(name)) continue;
          const def = lsrc.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\s*=`));
          if (!def || def.index === undefined) continue;
          if (new RegExp(WRITE.source).test(reachWithin(lsrc, bodyFrom(lsrc, def.index)))) hits.add(`${name}()`);
        }
      }
      if (hits.size) found[f] = [...hits].sort();
    }
    // 每条写明预览下的行为
    const REGISTRY: Record<string, string> = {
      "src/app/api/accounting/sales-summary/route.ts": "审计照写",
      "src/app/api/agent-core/skills/route.ts": "预览中不建内置技能",
      "src/app/api/agent-core/tools/route.ts": "当前企业解析预览感知，不写",
      "src/app/api/auth/active-org/route.ts": "当前企业解析预览感知，不写",
      "src/app/api/auth/google/callback/route.ts": "预览中拒绝绑定",
      "src/app/api/auth/google-email/callback/route.ts": "预览中拒绝绑定",
      "src/app/api/auth/wechat/callback/route.ts": "公开登录回调，清预览 cookie",
      "src/app/api/bridge/muse/events/route.ts": "Muse API token，不带浏览器 cookie",
      "src/app/api/calendar/google/route.ts": "本人 Google token 刷新（与预览身份无关）",
      "src/app/api/calendar/google/calendars/route.ts": "本人 Google token 刷新（与预览身份无关）",
      "src/app/api/capabilities/approvals/[approvalId]/route.ts": "审计照写",
      "src/app/api/marketing/daily-brief/route.ts": "审计照写",
      "src/app/api/notifications/preferences/me/route.ts": "预览中不建偏好行",
      "src/app/api/notifications/route.ts": "预览中不同步通知",
      "src/app/api/notifications/unread-count/route.ts": "预览中不同步通知",
      "src/app/api/operations/market-intelligence/route.ts": "预览中只读已有技能",
      "src/app/api/ops/home/route.ts": "当前企业解析预览感知，不写",
      "src/app/api/ops/projects/[id]/route.ts": "当前企业解析预览感知，不写",
      "src/app/api/ops/projects/route.ts": "当前企业解析预览感知，不写",
      "src/app/api/ops/sales-summary/route.ts": "当前企业解析预览感知，不写",
      "src/app/api/procurement/rules/route.ts": "预览中不建默认规则",
      "src/app/api/projects/[id]/ai-summary/route.ts": "预览中不刷新摘要",
      "src/app/api/projects/[id]/discussion/messages/route.ts": "预览中不建讨论会话",
      "src/app/api/projects/[id]/discussion/route.ts": "预览中不建讨论会话",
      "src/app/api/projects/[id]/reviews/route.ts": "预览中不建复盘草稿",
      "src/app/api/sales/daily-briefing/route.ts": "预览中不生成、不建通知、不覆盖缓存",
      "src/app/api/sales/quotes/share/[token]/route.ts": "客户分享链接：不读会话，与是否预览无关",
      "src/app/api/tasks/route.ts": "当前企业解析预览感知，不写",
      "src/app/api/trade/cron/route.ts": "定时任务：CRON_SECRET，不带浏览器 cookie",
      "src/app/api/trade/templates/route.ts": "预览中不建默认模板",
    };
    const unregistered = Object.keys(found).filter((f) => !REGISTRY[f]);
    const stale = Object.keys(REGISTRY).filter((f) => !found[f]);
    ok(unregistered.length === 0, "所有会写库的 GET（含一层库函数）都已登记预览下的行为", unregistered.map((f) => `${f} :: ${found[f].join(" ")}`));
    ok(stale.length === 0, "登记表没有过期条目", stale);
    const guarded: Array<[string, RegExp, string]> = [
      ["src/app/api/sales/daily-briefing/route.ts", /if \(await isPreviewReadonly\(user\.id\)\) \{\s*return NextResponse\.json\(\{ briefing: null/, "每日简报"],
      ["src/app/api/operations/market-intelligence/route.ts", /readonly \? await findMarketingSkill\(orgRes\.orgId\) : await ensureMarketingSkill/, "市场情报"],
      ["src/app/api/notifications/route.ts", /if \(!\(await isPreviewReadonly\(auth\.user\.id\)\)\) await syncNotifications/, "通知列表"],
      ["src/app/api/notifications/unread-count/route.ts", /if \(!\(await isPreviewReadonly\(auth\.user\.id\)\)\) await syncNotifications/, "未读数"],
      ["src/lib/notifications/preferences.ts", /if \(await isPreviewReadonly\(userId\)\) \{[\s\S]*?findUnique/, "通知偏好"],
      ["src/app/api/procurement/rules/route.ts", /ensureDefaults: !\(await isPreviewReadonly\(user\.id\)\)/, "采购规则"],
      ["src/app/api/projects/[id]/ai-summary/route.ts", /intel && !\(await isPreviewReadonly\(user\.id\)\)\) \{\s*await refreshStructuredSummary/, "项目摘要"],
      ["src/app/api/projects/[id]/reviews/route.ts", /if \(!\(await isPreviewReadonly\(user\.id\)\)\) await maybeCreateReviewDraft/, "复盘草稿"],
      ["src/app/api/trade/templates/route.ts", /templates\.length === 0 && !\(await isPreviewReadonly\(auth\.user\.id\)\)/, "外贸模板"],
      ["src/app/api/agent-core/skills/route.ts", /existingCount === 0 && !\(await isPreviewReadonly\(user\.id\)\)/, "内置技能"],
      ["src/app/api/projects/[id]/discussion/route.ts", /create: !\(await isPreviewReadonly\(user\.id\)\)/, "项目讨论概览"],
      ["src/app/api/projects/[id]/discussion/messages/route.ts", /\{ create: !\(await isPreviewReadonly\(user\.id\)\) \}/, "项目讨论翻页"],
      ["src/app/api/auth/google/callback/route.ts", /if \(await getRequestPreview\(request, user\.id\)\) \{[\s\S]*?preview_readonly[\s\S]*?await handleCallback/, "Google 日历绑定"],
      ["src/app/api/auth/google-email/callback/route.ts", /if \(await getRequestPreview\(request, user\.id\)\) \{[\s\S]*?preview_readonly[\s\S]*?await handleEmailCallback/, "Gmail 绑定"],
    ];
    for (const [f, re, label] of guarded) ok(re.test(code(f)), `GET 写库守卫（预览中含已失效）：${label}`);
    const ao = code("src/lib/organizations/active-org.ts");
    ok(/if \(await isPreviewReadonly\(userId\)\) return orgId;/.test(ao) && /if \(preferred && !\(await isPreviewReadonly\(userId\)\)\)/.test(ao) && /profile\.activeOrgId !== only && !\(await isPreviewReadonly\(userId\)\)/.test(code("src/lib/organizations/org-access.ts")), "当前企业回写：预览中（含已失效）不写");
  }

  console.log("\n路由门、代理与页面门（源码）");
  {
    const proxySrc = code("src/proxy.ts");
    const refuse = proxySrc.indexOf("shouldRefusePreviewWrite(");
    ok(refuse > 0 && refuse < proxySrc.indexOf("if (isPublicPath(pathname))") && refuse < proxySrc.indexOf("if (isStaticImagePath(pathname))"), "代理：拒写在静态图片与公开路径放行之前");
    ok(/const role = signedPreview \? PREVIEW_PLATFORM_ROLE : session\.role/.test(proxySrc), "代理：营销 API 旧规则在预览中按 user 判");
    ok(/withPreviewToken\(signedPreview \? previewToken : null, \(\) => applyRouteGate\(request, sessionSub, loader\)\)/.test(proxySrc), "代理：路由门在显式注入的预览 token 下执行");
    const cs = code("src/lib/navigation/context-server.ts");
    ok(/const key = `\$\{user\.id\}:\$\{orgId \?\? "-"\}:\$\{user\.previewFingerprint \?\? "-"\}`/.test(cs), "路由门缓存键含预览指纹");
    ok(/role: PREVIEW_PLATFORM_ROLE, status: row\.status, activeOrgId: preview\.orgId, previewFingerprint: preview\.fingerprint/.test(cs) && /if \(preview\) return \[preview\.orgId\];/.test(cs), "路由门加载器：预览中平台角色 user、当前企业与可用企业为预览企业");
    ok(/autopilotAllowed: \(user\) => !user\.previewFingerprint && hasAutopilotCapability/.test(cs) && /autopilotAllowed: !preview && hasAutopilotCapability/.test(cs), "Autopilot：路由门与指定企业的判定输入在预览中为 false");
    ok(/if \(await getActivePreview\(user\.id\)\) redirect\(fallbackPath\)/.test(code("src/lib/auth/platform-admin-guard.ts")), "平台管理员页门：预览中拒绝");
    ok(/if \(await getActivePreview\(user\.id\)\) redirect\(fallbackPath\)/.test(code("src/lib/autopilot/page-guard.ts")), "Autopilot 页门：预览中拒绝");
  }

  console.log("\n其余可见层读取点与界面（源码）");
  {
    const aud = code("src/lib/approval/audience-server.ts");
    ok(/const previewing = Boolean\(user\.previewFingerprint\)/.test(aud) && /isOrgHandler: !previewing &&/.test(aud) && /isOrgAdminRole: !previewing &&/.test(aud) && /ROUTE_GATE_LOADER\.loadUser\(userId\)/.test(aud), "审批可见判定输入：预览中不是平台管理员、不是企业处理人");
    const posts = code("src/lib/cockpit/posts-read-model.ts");
    ok(/if \(preview\) return orgId === preview\.orgId \? "org_member" : null;/.test(posts), "首页岗位总览：成员角色按预览");
    ok(/const membership = await getOrgMembership\(user\.id, orgId\)/.test(code("src/lib/tenancy/context.ts")) && /orgRole: tenant\.orgRole/.test(code("src/lib/capabilities/access.ts")), "审批中心访问上下文：成员角色经 getOrgMembership（预览中 org_member）");
    const tools = code("src/app/api/agent-core/tools/route.ts");
    ok(/resolvePreferredOrgId\(user\.id, user\.role\)/.test(tools) && /loadToolEntryGate\(user, orgId\)/.test(tools) && /loadNavigationContextForOrg\(/.test(code("src/lib/agent-core/entry-gate-server.ts")), "AI 工具列表：当前企业、平台角色与入口门都经预览感知的落点");
    ok(/loadGateNavigationContextForUser\(/.test(code("src/app/api/search/route.ts")) && /ROUTE_GATE_LOADER\.loadUser\(userId\)/.test(code("src/lib/navigation/page-context-server.ts")), "全局搜索与页面判定输入：经路由门加载器（预览感知）");
    const hyd = code("src/components/active-org-hydrator.tsx");
    const guard = hyd.indexOf("if ((await fetchCurrentUser())?.preview) return;");
    ok(guard > 0 && guard < hyd.indexOf('method: "PATCH"'), "客户端：预览中不回写当前企业");
    const header = code("src/components/header.tsx");
    ok(/if \(previewReadonly\) return;\s*await apiFetch\(`\/api\/notifications\/\$\{id\}\/\$\{action\}`/.test(header) && /if \(previewReadonly\) return;\s*await apiFetch\("\/api\/notifications\/read-all"/.test(header), "客户端：预览中不标已读");
    for (const f of ["src/app/(main)/assistant/chat-panel.tsx", "src/app/(main)/inbox/page.tsx", "src/components/project-ai-chat/project-ai-chat.tsx"]) {
      const src = code(f);
      ok(/disabled=\{isLoading \|\| previewReadonly\}/.test(src) && /attachments\.isParsing \|\| previewReadonly\}/.test(src) && /previewReadonly\s*\?\s*PREVIEW_CHAT_DISABLED_HINT/.test(src), `AI 对话输入预览中禁用并说明：${f}`);
    }
    const banner = read("src/components/preview-banner.tsx");
    ok(/正在以〈\{label\}〉预览（只读）· 剩余 \{minutesLeft\(preview\.expiresAt, now\)\} 分钟/.test(banner) && /预览已失效/.test(banner) && /"退出预览" : "退出"/.test(banner) && /method: "DELETE"/.test(banner) && /window\.location\.assign\("\/"\)/.test(banner), "横幅：active / invalid 两种文案，退出后整页回到首页");
    ok(/<PreviewBanner \/>/.test(code("src/components/app-shell.tsx")), "横幅挂在应用外壳（所有已登录页面）");
    const ps = read("src/app/(main)/organizations/[orgId]/positions-section.tsx");
    ok(/以 TA 的岗位预览/.test(ps) && /按岗位组合预览/.test(ps) && /JSON\.stringify\(\{ orgId, positionKeys: keys \}\)/.test(ps) && /window\.location\.assign\("\/"\)/.test(ps), "企业详情页「岗位」一节：两个入口，开启后整页回到首页");
    ok(/cachedUser = d\?\.user \? \{ \.\.\.d\.user, preview: d\.preview \?\? null \} : null/.test(code("src/lib/hooks/use-current-user.ts")), "当前用户缓存带上预览信息");
  }

  console.log("\n审查后的补充落点（源码）");
  {
    const srv = code("src/lib/preview/server.ts");
    ok(/\(await sessionSubOf\(jar\.get\(SESSION_COOKIE\)\?\.value\)\) === userId \? token : null/.test(srv) && /\(await sessionSubOf\(request\.cookies\.get\(SESSION_COOKIE\)\?\.value\)\) === userId \? token : null/.test(srv), "预览只对当前会话用户生效（库函数与路由处理函数都核对会话）");
    ok(/listEffectiveMemberships\(user\.id\)/.test(code("src/app/api/search/route.ts")), "全局搜索：成员企业按预览");
    const vis = code("src/lib/projects/visibility.ts");
    ok((vis.match(/listEffectiveMemberships\((user\.id|userId)\)/g) ?? []).length === 2 && !/organizationMember\.findMany/.test(vis), "项目可见范围：成员企业按预览");
    ok(/await effectivePlatformRole\(userId, user\?\.role\)/.test(code("src/lib/reminders/generator.ts")), "首页提醒：平台角色按预览");
    ok(/if \(memberships\[i\]\.org\.id !== preview\.orgId\) memberships\.splice\(i, 1\)/.test(code("src/app/api/organizations/route.ts")), "企业列表：预览中只列预览企业");
    ok(/if \(action\.orgId && !previewing\)/.test(code("src/lib/marketing/team.ts")), "团队审批能批判定：预览中不是企业所有者、不是 org_admin");
    ok(/getActiveRequestPreview\(request, auth\.user\.id\)\) \{\s*return NextResponse\.json\(\{ error: "无权访问", code: "AUTOPILOT_FORBIDDEN" \}/.test(code("src/lib/autopilot/access.ts")), "Autopilot 接口：预览中 403");
    ok((code("src/app/api/auth/register/route.ts").match(/setSessionCookie\(response, token\);\s*clearPreviewCookie\(response\);/g) ?? []).length === 2, "注册：新会话清预览 cookie");
    ok(/clearStoredOrgId\(\);\s*window\.location\.assign\("\/"\)/.test(code("src/components/preview-banner.tsx")), "退出预览：清掉本地记住的当前企业");
    const trade = code("src/app/(main)/trade/chat/page.tsx");
    ok(/!previewReadonly && !sending/.test(trade) && /disabled=\{previewReadonly\}/.test(trade), "外贸 AI 对话输入：预览中禁用");
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
