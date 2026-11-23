/**
 * TREE-1 读公开网页：纯函数（开关、地址、网址、站点名单、robots、登录页 / 验证码识别、Retry-After）
 *
 * 运行：npx tsx src/lib/web-reader/__tests__/web-reader-pure.test.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { isResearchTreeEnabledForOrgWithEnv } from "@/lib/tender-research-tree/flags";
import {
  OUTCOME_ZH,
  PRESET_SITE_POLICY,
  checkPublicUrl,
  classifySite,
  detectAccessWall,
  embeddedHostsOf,
  isAllowedByRobots,
  isBlockedAddress,
  isLoginUrl,
  mergeSitePolicy,
  metaRefreshTarget,
  normalizePageUrl,
  parseRetryAfterSeconds,
  parseRobots,
  parseRobotsLimited,
  readOrgSiteOverride,
  reasonMessageZh,
  robotsPatternMatches,
  siteKeyOfHost,
} from "../pure";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : "");
  }
}

console.log("开关真值表");
{
  const cases: Array<[Record<string, string | undefined>, string | null, boolean]> = [
    [{}, "org1", false],
    [{ TENDER_RESEARCH_TREE_ENABLED: "0" }, "org1", false],
    [{ TENDER_RESEARCH_TREE_ENABLED: "1" }, "org1", true],
    [{ TENDER_RESEARCH_TREE_ENABLED: " TRUE " }, "org1", true],
    [{ TENDER_RESEARCH_TREE_ENABLED: "on" }, "org1", true],
    [{ TENDER_RESEARCH_TREE_ENABLED: "yes" }, "org1", true],
    [{ TENDER_RESEARCH_TREE_ENABLED: "1" }, null, false],
    [{ TENDER_RESEARCH_TREE_ENABLED: "1" }, "", false],
    [{ TENDER_RESEARCH_TREE_ENABLED: "1", TENDER_RESEARCH_TREE_ORG_ALLOWLIST: "" }, "org1", true],
    [{ TENDER_RESEARCH_TREE_ENABLED: "1", TENDER_RESEARCH_TREE_ORG_ALLOWLIST: "org2, org1" }, "org1", true],
    [{ TENDER_RESEARCH_TREE_ENABLED: "1", TENDER_RESEARCH_TREE_ORG_ALLOWLIST: "org2" }, "org1", false],
    [{ TENDER_RESEARCH_TREE_ENABLED: "0", TENDER_RESEARCH_TREE_ORG_ALLOWLIST: "org1" }, "org1", false],
  ];
  for (const [env, org, want] of cases) {
    ok(`开关 ${JSON.stringify(env)} 组织 ${org} → ${want}`, isResearchTreeEnabledForOrgWithEnv(org, env) === want);
  }
}

console.log("内网地址判断");
{
  const blocked = [
    "10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.1",
    "::1", "::", "fd00::1", "fc00::1", "fe80::1", "fe80::1%eth0", "ff02::1",
    "::ffff:192.168.1.1", "::ffff:127.0.0.1", "64:ff9b::10.0.0.1", "2002:0a00:0001::1", "2001:db8::1", "::127.0.0.1",
    "not-an-ip", "",
  ];
  for (const ip of blocked) ok(`拦 ${ip || "（空）"}`, isBlockedAddress(ip) === true);
  const open = ["8.8.8.8", "142.250.72.14", "172.32.0.1", "100.128.0.1", "2607:f8b0:4005:80b::200e", "::ffff:8.8.8.8", "64:ff9b::8.8.8.8"];
  for (const ip of open) ok(`放 ${ip}`, isBlockedAddress(ip) === false);
}

console.log("网址校验与归一");
{
  ok("http / https 收", checkPublicUrl("https://example.gov/a").ok && checkPublicUrl("http://example.gov/a").ok);
  const ftp = checkPublicUrl("ftp://example.gov/a");
  ok("ftp 拒（invalid_url）", !ftp.ok && ftp.reason === "invalid_url");
  const cred = checkPublicUrl("https://user:pass@example.gov/page");
  ok("带凭证拒", !cred.ok && cred.reason === "credentials_in_url");
  const port = checkPublicUrl("https://example.gov:8443/a");
  ok("非默认端口拒", !port.ok && port.reason === "non_default_port");
  ok("写明默认端口照收", checkPublicUrl("https://example.gov:443/a").ok && checkPublicUrl("http://example.gov:80/a").ok);
  const a = checkPublicUrl("https://Example.gov:443/a#x");
  const b = checkPublicUrl("https://example.gov/a");
  ok("归一：去片段、主机名小写、去默认端口", a.ok && b.ok && normalizePageUrl(a.url) === normalizePageUrl(b.url) && normalizePageUrl(b.url) === "https://example.gov/a");
  ok("超长网址拒", !checkPublicUrl(`https://example.gov/${"a".repeat(3000)}`).ok);
}

console.log("站点名单");
{
  ok("1688 详情页不碰", classifySite("detail.1688.com", PRESET_SITE_POLICY) === "deny");
  ok("MERX 不碰（含 www）", classifySite("www.merx.com", PRESET_SITE_POLICY) === "deny");
  ok("ImportYeti 按人发起处理", classifySite("www.importyeti.com", PRESET_SITE_POLICY) === "human_initiated");
  ok("canada.ca 可以读", classifySite("www.canada.ca", PRESET_SITE_POLICY) === "allow");
  ok("其它默认", classifySite("example.gov", PRESET_SITE_POLICY) === "default");
  ok("后缀匹配不误伤（notmerx.com）", classifySite("notmerx.com", PRESET_SITE_POLICY) === "default");
  const override = readOrgSiteOverride({
    researchTree: { sites: { deny: ["Bad.Example.com", "*.worse.org", 3, "not a domain"], allow: ["merx.com", "good.gov"], humanInitiated: ["evil.com"] } },
  });
  ok("组织覆盖只收 deny / allow，清洗格式", JSON.stringify(override) === JSON.stringify({ deny: ["bad.example.com", "worse.org"], allow: ["merx.com", "good.gov"] }), override);
  const merged = mergeSitePolicy(PRESET_SITE_POLICY, override);
  ok("组织加进「不碰」生效", classifySite("bad.example.com", merged) === "deny" && classifySite("a.worse.org", merged) === "deny");
  ok("组织不能把预置「不碰」放出来", classifySite("merx.com", merged) === "deny");
  ok("组织不能新增「按人发起处理」", classifySite("evil.com", merged) === "default");
  ok("组织加进「可以读」", classifySite("good.gov", merged) === "allow");
  ok("组织设置缺省 / 坏数据不报错", JSON.stringify(readOrgSiteOverride(null)) === JSON.stringify({ deny: [], allow: [] }) && JSON.stringify(readOrgSiteOverride({ researchTree: "x" })) === JSON.stringify({ deny: [], allow: [] }));
}

console.log("robots");
{
  const g = parseRobots(["User-agent: *", "Disallow: /private", "Allow: /private/ok", "", "User-agent: OtherBot", "Disallow: /"].join("\n"));
  ok("* 组：/private/a 不许", isAllowedByRobots(g, "/private/a") === false);
  ok("* 组：/public/b 许", isAllowedByRobots(g, "/public/b") === true);
  ok("最长匹配：/private/ok/x 许", isAllowedByRobots(g, "/private/ok/x") === true);
  const own = parseRobots(["User-agent: *", "Disallow: /", "", "User-agent: qingyanresearchbot", "Disallow: /tmp"].join("\n"));
  ok("有本机器人自己的组时只按它（不分大小写）", isAllowedByRobots(own, "/a") === true && isAllowedByRobots(own, "/tmp/x") === false);
  const multi = parseRobots(["User-agent: a", "User-agent: *", "Disallow: /x"].join("\n"));
  ok("连续多个 user-agent 共用一组", isAllowedByRobots(multi, "/x/1") === false);
  ok("空 Disallow = 不限制", isAllowedByRobots(parseRobots("User-agent: *\nDisallow:\n"), "/a") === true);
  ok("没有任何组 = 全部允许", isAllowedByRobots(parseRobots("# nothing\nSitemap: https://x/s.xml"), "/a") === true);
  ok("/robots.txt 永远允许", isAllowedByRobots(parseRobots("User-agent: *\nDisallow: /"), "/robots.txt") === true);
  ok("通配 *", robotsPatternMatches("/*.pdf", "/docs/a.pdf") && !robotsPatternMatches("/*.pdf$", "/docs/a.pdf?x=1"));
  ok("锚定 $", robotsPatternMatches("/a$", "/a") && !robotsPatternMatches("/a$", "/ab"));
  ok("同长 Allow 优先", isAllowedByRobots(parseRobots("User-agent: *\nDisallow: /p\nAllow: /p"), "/p") === true);
  const start = Date.now();
  robotsPatternMatches("/*a*a*a*a*a*a*a*a*a*a*a*a*b", `/${"a".repeat(2000)}`);
  ok("病态通配不爆炸（< 2 秒）", Date.now() - start < 2000);
  ok("查询串参与匹配", isAllowedByRobots(parseRobots("User-agent: *\nDisallow: /*?session="), "/a?session=1") === false);
}

console.log("登录地址 / 登录页 / 人机验证");
{
  ok("登录地址：/user/login", isLoginUrl(new URL("https://x.gov/user/login")));
  ok("登录地址：/signin.aspx", isLoginUrl(new URL("https://x.gov/signin.aspx?r=1")));
  ok("登录地址：login. 开头的主机", isLoginUrl(new URL("https://login.microsoftonline.com/abc")));
  ok("登录地址：/session/new", isLoginUrl(new URL("https://x.com/session/new")));
  ok("不是登录地址：/author/john、/sign-in-help", !isLoginUrl(new URL("https://x.gov/author/john")) && !isLoginUrl(new URL("https://x.gov/help/sign-in-help")));
  ok("强标记：Cloudflare 等待页", detectAccessWall({ html: "<html><head><title>Just a moment...</title></head></html>", textChars: 10 }) === "captcha");
  ok("弱标记 + 正文少：验证码", detectAccessWall({ html: '<div class="g-recaptcha"></div>', textChars: 50 }) === "captcha");
  ok("弱标记 + 正文多：不算（页尾表单验证码）", detectAccessWall({ html: '<div class="g-recaptcha"></div>', textChars: 5000 }) === null);
  ok("密码框 + 正文少：登录页", detectAccessWall({ html: '<form><input type="password" name="p"></form>', textChars: 80 }) === "login_page");
  ok("密码框 + 正文多：不算（页眉登录框）", detectAccessWall({ html: "<input type='password'>", textChars: 9000 }) === null);
  ok("普通页面：null", detectAccessWall({ html: "<p>Award notice</p>", textChars: 20 }) === null);
}

console.log("Retry-After");
{
  const now = Date.parse("2026-11-23T00:00:00Z");
  ok("秒数", parseRetryAfterSeconds("10", now) === 10);
  ok("HTTP 日期", parseRetryAfterSeconds("Mon, 23 Nov 2026 00:00:20 GMT", now) === 20);
  ok("过去的日期 → 0", parseRetryAfterSeconds("Mon, 23 Nov 2026 00:00:00 GMT", now + 5000) === 0);
  ok("没有 / 认不出 → null", parseRetryAfterSeconds(undefined, now) === null && parseRetryAfterSeconds("soon", now) === null && parseRetryAfterSeconds("", now) === null);
}

console.log("文案");
{
  ok("类别中文名", JSON.stringify(OUTCOME_ZH) === JSON.stringify({ ok: "读到", blocked: "被挡", unreachable: "打不开", refused: "不读", limit: "到上限" }));
  ok("读页到上限的文案（整支级的「到上限，未查完」由 TREE-2 写）", reasonMessageZh("budget_exhausted") === "读页次数到上限，未读");
  ok("读到时用类别名", reasonMessageZh(null) === "读到");
  ok("403 是「对方禁止访问」", reasonMessageZh("http_403") === "对方禁止访问（403），未读取");
  const blockedReasons = ["http_401", "http_403", "http_407", "login_redirect", "login_page", "captcha", "robots_disallow", "robots_unavailable", "rate_limited", "site_blocked_in_branch"] as const;
  ok("被挡句都以「未读取」结尾", blockedReasons.every((r) => reasonMessageZh(r).endsWith("未读取")));
  const refusedReasons = ["invalid_url", "credentials_in_url", "non_default_port", "private_address", "site_denied", "login_url", "url_not_allowed", "unsupported_type"] as const;
  ok("不读句都以「不读」结尾", refusedReasons.every((r) => reasonMessageZh(r).endsWith("不读")));
  ok("原因句里不出现 robots 这个词", [...blockedReasons, ...refusedReasons].every((r) => !/robots/i.test(reasonMessageZh(r))));
}

console.log("补充：保留段、名单优先级、阈值边界（变异审查 E1–E4）");
{
  for (const ip of ["192.0.0.1", "192.88.99.1", "198.51.100.1", "203.0.113.1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "fec0::1", "100::1",
    "64:ff9b:1::a00:1", "::ffff:0:7f00:1", "::ffff:0:10.0.0.1", "2001:2::1", "2001:10::1", "3fff::1", "5f00::1"]) {
    ok(`拦 ${ip}`, isBlockedAddress(ip) === true);
  }
  ok("放 ::ffff:0:8.8.8.8", isBlockedAddress("::ffff:0:8.8.8.8") === false);
  ok("组织把 ImportYeti 加进「不碰」→ 不读", classifySite("www.importyeti.com", mergeSitePolicy(PRESET_SITE_POLICY, { deny: ["importyeti.com"], allow: [] })) === "deny");
  const pw = '<form><input type="password"></form>';
  ok("正文 1999 字 + 密码框 → 登录页；2000 字 → 不算", detectAccessWall({ html: pw, textChars: 1999 }) === "login_page" && detectAccessWall({ html: pw, textChars: 2000 }) === null);
  ok("强标记 + 正文很多 → 仍是人机验证", detectAccessWall({ html: "<title>Just a moment...</title>", textChars: 9000 }) === "captcha");
  ok("正文里出现「cf-chl-」字样不算人机验证", detectAccessWall({ html: "<p>see cf-chl- docs</p>", textChars: 9000 }) === null);
}

console.log("补充：robots 归一、版本号、上限与步数预算");
{
  ok("非 ASCII 规则与百分号编码的网址对得上", isAllowedByRobots(parseRobots("User-agent: *\nDisallow: /路径"), "/%E8%B7%AF%E5%BE%84/a") === false);
  ok("小写 %xx 规则与大写网址对得上", isAllowedByRobots(parseRobots("User-agent: *\nDisallow: /%e8%b7%af"), "/%E8%B7%AF") === false);
  ok("User-agent 带版本号也认作本机器人", isAllowedByRobots(parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: QingyanResearchBot/1.0\nAllow: /"), "/x") === true);
  const many = `User-agent: *\n${Array.from({ length: 5001 }, (_, i) => `Disallow: /p${i}`).join("\n")}`;
  ok("规则超过 5000 条 → 按读取失败（null）", parseRobotsLimited(many) === null);
  ok("单条模式超过 512 字 → 按读取失败（null）", parseRobotsLimited(`User-agent: *\nDisallow: /${"a".repeat(600)}`) === null);
  ok("正常规则表照常解析", parseRobotsLimited("User-agent: *\nDisallow: /x")?.length === 1);
  const heavy = parseRobots(`User-agent: *\n${Array.from({ length: 4000 }, () => `Disallow: /*${"a".repeat(300)}b`).join("\n")}`);
  const t0 = Date.now();
  const verdict = isAllowedByRobots(heavy, `/${"a".repeat(2000)}`);
  ok("病态规则表：步数预算用完按不许读、且很快返回（< 2 秒）", verdict === false && Date.now() - t0 < 2000, Date.now() - t0);
}

console.log("补充：登录地址、meta refresh、Retry-After");
{
  for (const u of ["https://x.gov/login;jsessionid=1", "https://x.gc.ca/fr/connexion", "https://x.gov/signon", "https://x.gov/sign-on", "https://x.gov/authentication", "https://x.com/index.php?route=account/login"]) {
    ok(`登录地址：${u}`, isLoginUrl(new URL(u)));
  }
  ok("不是登录地址：/news/cas", !isLoginUrl(new URL("https://x.gov/news/cas")));
  const base = new URL("https://x.gov/page");
  ok("meta refresh 目标按页面网址解析", metaRefreshTarget('<meta http-equiv="refresh" content="0; url=/user/login">', base)?.toString() === "https://x.gov/user/login");
  ok("没有 meta refresh → null", metaRefreshTarget("<p>x</p>", base) === null);
  const now = Date.parse("2026-11-23T00:00:00Z");
  ok("Retry-After 认不出：1.5 / -1 / 10, 20 / 非 GMT 日期", ["1.5", "-1", "10, 20", "2026-11-23T00:00:20Z"].every((v) => parseRetryAfterSeconds(v, now) === null));
}


console.log("第三轮挑错后补：robots 产品名、重复斜杠、meta refresh 引号、嵌入主机名、新原因文案");
{
  const g1 = parseRobots("User-agent: QingyanResearchBot 1.0\nDisallow: /\n\nUser-agent: *\nAllow: /");
  ok("「User-agent: QingyanResearchBot 1.0」也是本机器人的组", !isAllowedByRobots(g1, "/any"));
  const g2 = parseRobots("User-agent: qingyanresearchbot/2\nDisallow: /x");
  ok("产品名不分大小写、带版本号", !isAllowedByRobots(g2, "/x/1"));
  const g3 = parseRobots("User-agent: *\nDisallow: /private");
  ok("「//private/a」不能绕过 Disallow: /private", !isAllowedByRobots(g3, "//private/a") && !isAllowedByRobots(g3, "/private/a") && isAllowedByRobots(g3, "/public//x"));
  ok("重复斜杠在查询里不改", isAllowedByRobots(g3, "/public?u=//private"));
  const base = new URL("https://x.gov/page");
  ok("meta refresh 目标带单引号也认得", metaRefreshTarget(`<meta http-equiv="refresh" content="0; URL='/account/login'">`, base)?.toString() === "https://x.gov/account/login");
  ok("meta refresh 目标带双引号也认得", metaRefreshTarget(`<meta http-equiv='refresh' content='0; url="/user/login"'>`, base)?.pathname === "/user/login");
  ok("嵌入主机名：路径里的完整网址", JSON.stringify(embeddedHostsOf(new URL("https://r.jina.ai/https://www.gov.example/a"))) === '["gov.example"]');
  ok("嵌入主机名：查询里编码过的网址（两层编码）", embeddedHostsOf(new URL("https://p.example/x?u=https%253A%252F%252Fgov.example%252Fa")).includes("gov.example"));
  ok("嵌入主机名：不含网址自己的主机", embeddedHostsOf(new URL("https://www.gov.example/gov.example/a")).length === 0);
  ok("嵌入主机名：数字不当主机名", embeddedHostsOf(new URL("https://p.example/v1.2/3.4")).length === 0);
  const t0 = Date.now();
  embeddedHostsOf(new URL("https://p.example/" + "a.".repeat(2000) + "?q=" + "1.".repeat(2000)));
  ok("嵌入主机名：超长网址也很快（< 200 ms）", Date.now() - t0 < 200, Date.now() - t0);
  ok("站点键：去大小写、末尾点、www.、空白", siteKeyOfHost(" WWW.Gov.Example. ") === "gov.example");
  for (const h of ["r.jina.ai", "gov-example.translate.goog", "webcache.googleusercontent.com", "web.archive.org", "archive.ph", "12ft.io"]) {
    ok(`预置不碰：${h}`, classifySite(h, PRESET_SITE_POLICY) === "deny");
  }
  ok("取 robots 次数到上限的文案说的是读取规则、以「未读」结尾", reasonMessageZh("robots_limit").includes("读取规则") && reasonMessageZh("robots_limit").endsWith("未读"));
  ok("被挡站到上限的文案以「未读」结尾", reasonMessageZh("blocked_sites_limit").endsWith("未读"));
  ok("不支持的类型文案不再提纯文本与 PDF", !/纯文本|PDF/.test(reasonMessageZh("unsupported_type")));
}

console.log("守卫：读网页的唯一入口");
{
  const root = process.cwd();
  const offenders: string[] = [];
  // 把 import / require / import() 里出现的模块路径取出来规范化（去掉 ./、多余的 /）再比，
  // 含 web-reader 的只许恰好是 "@/lib/web-reader"
  const SPEC_RE = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["'`]([^"'`]+)["'`]/g;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === "node_modules" || name === ".next") continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name)) continue;
      const rel = relative(root, full).split(sep).join("/");
      // 只有 web-reader 自己的目录（含它的测试）可以直接用内部模块；别处的测试也不例外
      if (rel.startsWith("src/lib/web-reader/")) continue;
      const src = readFileSync(full, "utf8");
      let bad = /createResearchReadSessionWithDeps|createNodeNet\b|writeWebReadAudit|loadResearchJobRow|loadTreeHistory/.test(src);
      // 审计动作字面量只许出现在 web-reader 目录（别处不能伪造读页审计）
      if (src.includes("research.web_read")) bad = true;
      for (const m of src.matchAll(SPEC_RE)) {
        const spec = posix.normalize(m[1].replace(/\/{2,}/g, "/"));
        if (/web-reader/.test(spec) && spec !== "@/lib/web-reader" && spec !== "@/lib/web-reader/index") bad = true;
      }
      if (bad) offenders.push(rel);
    }
  };
  walk(join(root, "src"));
  walk(join(root, "scripts"));
  const probe = (code: string) => [...code.matchAll(SPEC_RE)].some((m) => {
    const spec = posix.normalize(m[1].replace(/\/{2,}/g, "/"));
    return /web-reader/.test(spec) && spec !== "@/lib/web-reader";
  });
  ok("守卫认得出路径花招（./、//、动态 import、require）", probe('import * as rp from "@/lib/web-reader/./read-page"') && probe('import x from "@/lib/web-reader//transport"') && probe('await import("@/lib/web-reader/db-deps")') && probe('require("../web-reader/pure")') && !probe('import { readPublicPage } from "@/lib/web-reader"'));
  ok("web-reader 目录与测试之外只经 @/lib/web-reader 入口（不直接 import read-page / transport / pdf / pure，不用测试接缝）", offenders.length === 0, offenders);
  const index = readFileSync(join(root, "src/lib/web-reader/index.ts"), "utf8");
  ok("生产入口不把测试接缝、读库与写审计的函数导出去", !/export\s*\{[^}]*(createResearchReadSessionWithDeps|createNodeNet|writeWebReadAudit|loadResearchJobRow|loadOrgSettingsJson)/.test(index) && !/export (async )?function (writeWebReadAudit|loadResearchJobRow|loadOrgSettingsJson)/.test(index));
  ok("生产入口不接受 env 覆盖", !/env\s*:/.test(index.slice(index.indexOf("export async function createResearchReadSession"))));
}

console.log(`\nweb-reader-pure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
