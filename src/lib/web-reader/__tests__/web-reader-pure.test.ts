/**
 * TREE-1 读公开网页：纯函数（开关、地址、网址、站点名单、robots、登录页 / 验证码识别、Retry-After）
 *
 * 运行：npx tsx src/lib/web-reader/__tests__/web-reader-pure.test.ts
 */
import { isResearchTreeEnabledForOrgWithEnv } from "@/lib/tender-research-tree/flags";
import {
  PRESET_SITE_POLICY,
  checkPublicUrl,
  classifySite,
  detectAccessWall,
  isAllowedByRobots,
  isBlockedAddress,
  isLoginUrl,
  mergeSitePolicy,
  normalizePageUrl,
  parseRetryAfterSeconds,
  parseRobots,
  readOrgSiteOverride,
  reasonMessageZh,
  robotsPatternMatches,
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
  ok("病态通配不爆炸（< 1 秒）", Date.now() - start < 1000);
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
  ok("到上限的文案", reasonMessageZh("budget_exhausted") === "到上限，未查完");
  ok("读到时", reasonMessageZh(null) === "已读取");
}

console.log(`\nweb-reader-pure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
