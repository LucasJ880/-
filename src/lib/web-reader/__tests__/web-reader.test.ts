/**
 * TREE-1 读公开网页：入口行为（全部用注入的假网络与假时钟，不连外网）
 *
 * 运行：npx tsx src/lib/web-reader/__tests__/web-reader.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NetError,
  WEB_READER_LIMITS,
  WebReaderContextError,
  createResearchReadSessionWithDeps,
  readPublicPage,
  type NetRequest,
  type NetResponse,
  type ReadBudget,
  type ResearchJobRow,
  type ResearchReadContext,
  type WebReadAuditEntry,
} from "../read-page";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : "");
  }
}

/* ───────────────────────────── 假网络与假时钟 ───────────────────────────── */

type Handler = (attempt: number, req: NetRequest) => NetResponse | Error;
type Logged = { url: string; at: number; headers: Record<string, string> };

const enc = new TextEncoder();
function html(body: string, status = 200, extra: Record<string, string> = {}): NetResponse {
  return { status, headers: { "content-type": "text/html; charset=utf-8", ...extra }, body: enc.encode(body), truncated: false };
}
function status(code: number, extra: Record<string, string> = {}): NetResponse {
  return { status: code, headers: { "content-type": "text/html", ...extra }, body: enc.encode(""), truncated: false };
}
function redirect(to: string, code = 302): NetResponse {
  return { status: code, headers: { location: to }, body: new Uint8Array(), truncated: false };
}
const LONG_TEXT = "Award notice. ".repeat(300); // 正文足够长，页眉登录框 / 弱标记不算墙

function makeWorld(opts: { addresses?: Record<string, string[]> } = {}) {
  let time = Date.parse("2026-11-23T00:00:00Z");
  const handlers = new Map<string, Handler>();
  const counts = new Map<string, number>();
  const log: Logged[] = [];
  const audits: WebReadAuditEntry[] = [];
  const sleeps: number[] = [];
  const addresses = opts.addresses ?? {};
  const net = {
    async resolve(host: string) {
      const list = addresses[host] ?? ["93.184.216.34"];
      if (list.length === 1 && list[0] === "NXDOMAIN") throw new NetError("dns", "nx");
      return list.map((address) => ({ address, family: (address.includes(":") ? 6 : 4) as 4 | 6 }));
    },
    async request(req: NetRequest): Promise<NetResponse> {
      const url = req.url.toString();
      log.push({ url, at: time, headers: { ...req.headers } });
      const n = (counts.get(url) ?? 0) + 1;
      counts.set(url, n);
      const h = handlers.get(url);
      if (!h) {
        if (url.endsWith("/robots.txt")) return status(404);
        return status(404);
      }
      const out = h(n, req);
      if (out instanceof Error) throw out;
      if (out.body.length > req.maxBytes) return { ...out, body: out.body.subarray(0, req.maxBytes), truncated: true };
      return out;
    },
  };
  // 虚拟时间：sleep 登记一个到期时间，等所有微任务都跑完（setImmediate）才把时间拨到最早的到期点，
  // 这样并发的等待与请求的先后与真实时钟一致
  const timers: Array<{ at: number; resolve: () => void }> = [];
  let pumping = false;
  const pump = () => {
    if (pumping) return;
    pumping = true;
    const step = () => {
      if (timers.length === 0) {
        pumping = false;
        return;
      }
      timers.sort((a, b) => a.at - b.at);
      const t = timers.shift()!;
      time = Math.max(time, t.at);
      t.resolve();
      setImmediate(step);
    };
    setImmediate(step);
  };
  const clock = {
    now: () => time,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        sleeps.push(ms);
        timers.push({ at: time + ms, resolve });
        pump();
      }),
  };
  return {
    net,
    clock,
    handlers,
    log,
    audits,
    sleeps,
    pageRequests: () => log.filter((l) => !l.url.endsWith("/robots.txt")),
    robotsRequests: () => log.filter((l) => l.url.endsWith("/robots.txt")),
    advance: (ms: number) => void (time += ms),
    now: () => time,
  };
}

const ENV_ON = { TENDER_RESEARCH_TREE_ENABLED: "1", TENDER_RESEARCH_TREE_ORG_ALLOWLIST: "org1" };
const RESEARCH_JOB: ResearchJobRow = {
  id: "job1",
  orgId: "org1",
  metadata: { workDomain: "tender", researchTree: { version: 1, initiatedByUserId: "u1", trigger: "human_start" } },
};

async function session(
  world: ReturnType<typeof makeWorld>,
  over: { job?: ResearchJobRow | null; env?: Record<string, string>; scheduled?: boolean; settings?: unknown; jobId?: string | null; orgId?: string } = {},
) {
  return createResearchReadSessionWithDeps(
    { orgId: over.orgId ?? "org1", jobId: over.jobId === undefined ? "job1" : over.jobId, scheduled: over.scheduled },
    {
      loadJob: async () => (over.job === undefined ? RESEARCH_JOB : over.job),
      loadOrgSettings: async () => over.settings ?? null,
      env: over.env ?? ENV_ON,
      reader: {
        net: world.net,
        clock: world.clock,
        audit: async (e) => void world.audits.push(e),
        extractPdf: async (bytes) => [new TextDecoder().decode(bytes)],
      },
    },
  );
}

function budget(n = 12): ReadBudget {
  return { remaining: n, used: 0 };
}

async function expectContextError(name: string, p: Promise<unknown>, code: string) {
  try {
    await p;
    ok(name, false, "没有抛错");
  } catch (e) {
    ok(name, e instanceof WebReaderContextError && e.code === code, e instanceof Error ? e.message : e);
  }
}

async function main() {
  console.log("规则 1：只在人发起的调研 Job 里读");
  {
    const w = makeWorld();
    await expectContextError("定时任务上下文被拒", session(w, { scheduled: true }), "SCHEDULED_CONTEXT");
    await expectContextError(
      "发起方式不是人（cron）被拒",
      session(w, { job: { ...RESEARCH_JOB, metadata: { researchTree: { version: 1, initiatedByUserId: "u1", trigger: "cron" } } } }),
      "NOT_HUMAN_INITIATED",
    );
    await expectContextError(
      "缺发起人被拒",
      session(w, { job: { ...RESEARCH_JOB, metadata: { researchTree: { version: 1, initiatedByUserId: " ", trigger: "human_start" } } } }),
      "NOT_HUMAN_INITIATED",
    );
    await expectContextError("没有 Job 被拒", session(w, { jobId: null }), "MISSING_JOB");
    await expectContextError("Job 不存在被拒", session(w, { job: null }), "JOB_NOT_FOUND");
    await expectContextError("一键分析 Job（没有调研标记）被拒", session(w, { job: { ...RESEARCH_JOB, metadata: { workDomain: "tender" } } }), "NOT_RESEARCH_JOB");
    await expectContextError("别的组织的 Job 被拒", session(w, { job: { ...RESEARCH_JOB, orgId: "org2" } }), "JOB_ORG_MISMATCH");
    await expectContextError("开关没开被拒", session(w, { env: {} }), "FEATURE_DISABLED");
    await expectContextError("组织不在名单被拒", session(w, { env: { TENDER_RESEARCH_TREE_ENABLED: "1", TENDER_RESEARCH_TREE_ORG_ALLOWLIST: "org9" } }), "FEATURE_DISABLED");
    const okSession = await session(w, { job: { ...RESEARCH_JOB, metadata: { researchTree: { version: 1, initiatedByUserId: "u1", trigger: "requirements_confirmed" } } } });
    ok("确认招标要求发起的调研 Job 可以建", okSession.trigger === "requirements_confirmed");
    try {
      await readPublicPage("https://example.gov/a", { session: okSession, branchKey: "x", budget: budget(), blockedSites: new Set(), deadlineAt: null } as unknown as ResearchReadContext);
      ok("手拼的上下文被拒", false);
    } catch (e) {
      ok("手拼的上下文被拒", e instanceof WebReaderContextError && e.code === "INVALID_CONTEXT");
    }
    ok("以上全程没有任何请求", w.log.length === 0, w.log);
  }

  console.log("规则 2、3：表明身份、不带凭证");
  {
    const w = makeWorld();
    w.handlers.set("https://example.gov/a", () => html(`<p>${LONG_TEXT}</p>`, 200, { "set-cookie": "sid=abc; Path=/" }));
    w.handlers.set("https://example.gov/b", () => html(`<p>${LONG_TEXT}</p>`));
    const s = await session(w);
    const ctx = s.forBranch({ branchKey: "b1", budget: budget() });
    await readPublicPage("https://example.gov/a", ctx);
    await readPublicPage("https://example.gov/b", ctx);
    const all = w.log;
    ok("用户代理写明青砚与联系网址", all.length >= 2 && all.every((l) => l.headers["user-agent"].includes("QingyanResearchBot") && l.headers["user-agent"].includes("https://qingyan.ca")), all.map((l) => l.headers));
    ok("不冒充浏览器", all.every((l) => !/Chrome|Safari|Firefox|Mozilla/.test(l.headers["user-agent"])));
    ok("没有 Cookie / Authorization 头（含 robots 请求）", all.every((l) => Object.keys(l.headers).every((k) => !["cookie", "authorization", "proxy-authorization"].includes(k.toLowerCase()))), all.map((l) => Object.keys(l.headers)));
    const cred = await readPublicPage("https://user:pass@example.gov/page", ctx);
    ok("网址带凭证：拒绝、没有请求", cred.outcome === "refused" && cred.reason === "credentials_in_url" && !w.log.some((l) => l.url.includes("page")));
    const transport = readFileSync(join(process.cwd(), "src/lib/web-reader/transport.ts"), "utf8");
    ok("传输层只发 GET、不复用连接、连接时校验地址", transport.includes('method: "GET"') && !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(transport) && transport.includes("agent: false") && transport.includes("lookup: guardedLookup"));
    ok("传输层不设 cookie", !/["']cookie["']\s*:/i.test(transport));
  }

  console.log("只读公开地址");
  {
    const w = makeWorld({
      addresses: {
        "ten.example": ["10.0.0.5"],
        "lo.example": ["127.0.0.1"],
        "meta.example": ["169.254.169.254"],
        "v6lo.example": ["::1"],
        "ula.example": ["fd00::1"],
        "mapped.example": ["::ffff:192.168.1.1"],
        "mixed.example": ["93.184.216.34", "10.1.1.1"],
        "internal.example": ["192.168.0.10"],
        "nx.example": ["NXDOMAIN"],
      },
    });
    const s = await session(w);
    const ctx = s.forBranch({ branchKey: "b1", budget: budget() });
    for (const host of ["ten", "lo", "meta", "v6lo", "ula", "mapped", "mixed"]) {
      const r = await readPublicPage(`https://${host}.example/x`, ctx);
      ok(`解析到内网（${host}）：拒绝`, r.outcome === "refused" && r.reason === "private_address", r);
    }
    const lit = await readPublicPage("http://127.0.0.1/x", ctx);
    const lit6 = await readPublicPage("http://[::1]/x", ctx);
    ok("IP 字面量的内网地址：拒绝", lit.reason === "private_address" && lit6.reason === "private_address");
    ok("内网地址上没有任何请求（含 robots）", w.log.length === 0, w.log);
    w.handlers.set("https://pub.example/start", () => redirect("http://internal.example/admin"));
    const red = await readPublicPage("https://pub.example/start", ctx);
    ok("跳转到内网：拒绝", red.outcome === "refused" && red.reason === "private_address", red);
    ok("没有请求跳转目标", !w.log.some((l) => l.url.includes("internal.example")));
    w.handlers.set("https://rebind.example/x", () => new NetError("private_address", "rebind"));
    const reb = await readPublicPage("https://rebind.example/x", ctx);
    ok("连接时发现是内网地址（DNS 重绑定）：拒绝、不重试", reb.outcome === "refused" && reb.reason === "private_address" && w.pageRequests().filter((l) => l.url.includes("rebind")).length === 1);
    const nx = await readPublicPage("https://nx.example/x", ctx);
    ok("域名解析失败：未接通", nx.outcome === "unreachable" && nx.reason === "dns_failed");
    const port = await readPublicPage("https://pub.example:8080/x", ctx);
    ok("非默认端口：拒绝", port.outcome === "refused" && port.reason === "non_default_port");
  }

  console.log("跳转次数");
  {
    const w = makeWorld();
    for (let i = 0; i < 6; i++) w.handlers.set(`https://hop.example/${i}`, () => redirect(`/${i + 1}`));
    const s = await session(w);
    const ctx = s.forBranch({ branchKey: "b1", budget: budget() });
    const r = await readPublicPage("https://hop.example/0", ctx);
    ok("连续跳转 4 次：发 4 个请求后停止、未接通", r.outcome === "unreachable" && r.reason === "too_many_redirects" && w.pageRequests().length === 4, { r, n: w.pageRequests().length });
    ok("跳转与重试只扣一次额度", ctx.budget.used === 1 && ctx.budget.remaining === 11);
    w.handlers.set("https://ok.example/0", () => redirect("https://ok.example/final", 301));
    w.handlers.set("https://ok.example/final", () => html(`<p>${LONG_TEXT}</p>`));
    const r2 = await readPublicPage("https://ok.example/0", ctx);
    ok("一次跳转后读到：finalUrl 是最后一跳", r2.outcome === "ok" && r2.finalUrl === "https://ok.example/final" && r2.url === "https://ok.example/0");
  }

  console.log("被挡即停");
  {
    const w = makeWorld();
    w.handlers.set("https://lp.example/p", () => html('<form><input type="password" name="p"></form>Sign in'));
    w.handlers.set("https://captcha.example/p", () => html("<html><head><title>Just a moment...</title></head><body>checking</body></html>"));
    w.handlers.set("https://forbid.example/p", () => status(403));
    w.handlers.set("https://unauth.example/p", () => status(401));
    w.handlers.set("https://proxyauth.example/p", () => status(407));
    w.handlers.set("https://wall.example/p", () => redirect("https://wall.example/user/login?next=/p"));
    const s = await session(w);
    const cases: Array<[string, string]> = [
      ["https://lp.example/p", "login_page"],
      ["https://captcha.example/p", "captcha"],
      ["https://forbid.example/p", "http_403"],
      ["https://unauth.example/p", "http_401"],
      ["https://proxyauth.example/p", "http_407"],
      ["https://wall.example/p", "login_redirect"],
    ];
    for (const [url, reason] of cases) {
      const ctx = s.forBranch({ branchKey: `b-${reason}`, budget: budget() });
      const r = await readPublicPage(url, ctx);
      const n = w.pageRequests().filter((l) => l.url === url).length;
      ok(`${reason}：被挡、写明原因、只请求一次`, r.outcome === "blocked" && r.blocked?.reason === reason && !!r.blocked?.messageZh && n === 1, { r, n });
    }
    ok("跳转到登录地址：没有请求登录地址", !w.log.some((l) => l.url.includes("/user/login")));
    ok("被挡没有任何等待（不重试）", w.sleeps.every((ms) => ms <= WEB_READER_LIMITS.SAME_SITE_INTERVAL_MS));
    const ctx = s.forBranch({ branchKey: "same", budget: budget() });
    w.handlers.set("https://forbid.example/q", () => html(`<p>${LONG_TEXT}</p>`));
    await readPublicPage("https://forbid.example/p", ctx); // 缓存命中：同样被挡，记入这一支
    const before = w.log.length;
    const again = await readPublicPage("https://forbid.example/q", ctx);
    ok("同一支里同站被挡过：直接被挡、不发请求、不扣额度", again.outcome === "blocked" && again.reason === "site_blocked_in_branch" && w.log.length === before && ctx.budget.used === 0, again);
    const other = s.forBranch({ branchKey: "other", budget: budget() });
    const fresh = await readPublicPage("https://forbid.example/q", other);
    ok("别的支不受影响", fresh.outcome === "ok");
    const direct = await readPublicPage("https://site.example/account/login", other);
    ok("直接给的登录地址：拒绝、不发请求、不记为该站被挡", direct.outcome === "refused" && direct.reason === "login_url" && !w.log.some((l) => l.url.includes("account/login")) && !other.blockedSites.has("site.example"));
  }

  console.log("临时故障有限重试");
  {
    const w = makeWorld();
    w.handlers.set("https://slow.example/p", () => new NetError("timeout", "t"));
    w.handlers.set("https://err.example/p", () => status(503));
    w.handlers.set("https://flaky.example/p", (n) => (n === 1 ? status(502) : html(`<p>${LONG_TEXT}</p>`)));
    w.handlers.set("https://reset.example/p", () => new NetError("network", "reset"));
    const s = await session(w);
    const ctx = s.forBranch({ branchKey: "b1", budget: budget() });
    const t = await readPublicPage("https://slow.example/p", ctx);
    const times = w.pageRequests().filter((l) => l.url === "https://slow.example/p").map((l) => l.at);
    ok("超时：共 3 个请求、未接通", t.outcome === "unreachable" && t.reason === "timeout" && times.length === 3 && t.attempts === 3, { t, times });
    ok("第二次等待长于第一次", times.length === 3 && times[2] - times[1] > times[1] - times[0], times);
    const e = await readPublicPage("https://err.example/p", ctx);
    ok("503：共 3 个请求、未接通", e.outcome === "unreachable" && e.reason === "http_5xx" && e.httpStatus === 503 && w.pageRequests().filter((l) => l.url === "https://err.example/p").length === 3);
    const f = await readPublicPage("https://flaky.example/p", ctx);
    ok("一次 502 后读到", f.outcome === "ok" && f.attempts === 2);
    const r = await readPublicPage("https://reset.example/p", ctx);
    ok("连接中断：重试 2 次后未接通", r.outcome === "unreachable" && r.reason === "network_error" && r.attempts === 3);
    ok("四次读页只扣 4 次额度", ctx.budget.used === 4);
  }

  console.log("429 的等待时间");
  {
    const w = makeWorld();
    w.handlers.set("https://rl.example/ok", (n) => (n === 1 ? status(429, { "retry-after": "10" }) : html(`<p>${LONG_TEXT}</p>`)));
    w.handlers.set("https://rl.example/none", () => status(429));
    w.handlers.set("https://rl.example/long", () => status(429, { "retry-after": "60" }));
    w.handlers.set("https://rl2.example/twice", () => status(429, { "retry-after": "5" }));
    const s = await session(w);
    const r1 = await readPublicPage("https://rl.example/ok", s.forBranch({ branchKey: "a", budget: budget() }));
    const at = w.pageRequests().filter((l) => l.url === "https://rl.example/ok").map((l) => l.at);
    ok("带 10 秒：等满 10 秒后再试一次并读到", r1.outcome === "ok" && at.length === 2 && at[1] - at[0] >= 10_000, { r1, at });
    const r2 = await readPublicPage("https://rl.example/none", s.forBranch({ branchKey: "b", budget: budget() }));
    ok("不带等待时间：只请求一次、被挡", r2.outcome === "blocked" && r2.reason === "rate_limited" && w.pageRequests().filter((l) => l.url.endsWith("/none")).length === 1);
    const r3 = await readPublicPage("https://rl.example/long", s.forBranch({ branchKey: "c", budget: budget() }));
    ok("超过 30 秒：只请求一次、被挡", r3.outcome === "blocked" && r3.reason === "rate_limited" && w.pageRequests().filter((l) => l.url.endsWith("/long")).length === 1);
    const r4 = await readPublicPage("https://rl2.example/twice", s.forBranch({ branchKey: "d", budget: budget() }));
    ok("再试仍为 429：被挡、共 2 个请求", r4.outcome === "blocked" && r4.reason === "rate_limited" && w.pageRequests().filter((l) => l.url.endsWith("/twice")).length === 2);
  }

  console.log("截止时间");
  {
    const w = makeWorld();
    w.handlers.set("https://dl.example/p", () => new NetError("timeout", "t"));
    const s = await session(w);
    // robots 请求在 T、页面请求在 T+2s（同站间隔）、超时后要等 1s 再排到 T+4s，那时离截止只剩 1s
    const ctx = s.forBranch({ branchKey: "b", budget: budget(), deadlineAt: w.now() + 6_000 });
    const r = await readPublicPage("https://dl.example/p", ctx);
    ok("截止时间不够重试：只请求一次、未接通（时间用完）", r.outcome === "unreachable" && r.reason === "deadline" && r.attempts === 1, r);
    const ctx2 = s.forBranch({ branchKey: "c", budget: budget(), deadlineAt: w.now() + 500 });
    const before = w.log.length;
    const r2 = await readPublicPage("https://dl2.example/p", ctx2);
    ok("已经到截止时间：不发请求", r2.reason === "deadline" && w.pageRequests().length === before - w.robotsRequests().length + 0 && r2.attempts === 0, r2);
  }

  console.log("限量与站点间隔");
  {
    const w = makeWorld();
    for (const p of ["a", "b", "c"]) w.handlers.set(`https://lim.example/${p}`, () => html(`<p>${LONG_TEXT}</p>`));
    const s = await session(w);
    const ctx = s.forBranch({ branchKey: "b", budget: budget(2) });
    const rs = [];
    for (const p of ["a", "b", "c"]) rs.push(await readPublicPage(`https://lim.example/${p}`, ctx));
    ok("额度 2：前两个读到、第三个到上限", rs[0].outcome === "ok" && rs[1].outcome === "ok" && rs[2].outcome === "limit" && rs[2].messageZh === "到上限，未查完");
    ok("第三个没有请求", !w.log.some((l) => l.url.endsWith("/c")) && ctx.budget.remaining === 0 && ctx.budget.used === 2);

    const w2 = makeWorld();
    w2.handlers.set("https://pace.example/1", () => html(`<p>${LONG_TEXT}</p>`));
    w2.handlers.set("https://www.pace.example/2", () => html(`<p>${LONG_TEXT}</p>`));
    w2.handlers.set("https://pace.example/3", () => html(`<p>${LONG_TEXT}</p>`));
    const s2 = await session(w2);
    const c1 = s2.forBranch({ branchKey: "p1", budget: budget() });
    const c2 = s2.forBranch({ branchKey: "p2", budget: budget() });
    await Promise.all([readPublicPage("https://pace.example/1", c1), readPublicPage("https://www.pace.example/2", c2), readPublicPage("https://pace.example/3", c1)]);
    const starts = w2.log.map((l) => l.at).sort((a, b) => a - b);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    ok("两支并行读同一站点：任意两次请求开始时间相差不少于 2 秒（含 robots）", starts.length >= 4 && gaps.every((g) => g >= 2_000), { starts, gaps });
  }

  console.log("同一棵树内同一网址只读一次");
  {
    const w = makeWorld();
    w.handlers.set("https://example.gov/a", () => html(`<p>${LONG_TEXT}</p>`));
    const s = await session(w);
    const b1 = s.forBranch({ branchKey: "b1", budget: budget() });
    const b2 = s.forBranch({ branchKey: "b2", budget: budget() });
    const first = await readPublicPage("https://Example.gov:443/a#x", b1);
    w.advance(60_000);
    const second = await readPublicPage("https://example.gov/a", b2);
    ok("只发一次页面请求", w.pageRequests().length === 1);
    ok("第二次返回相同正文与读取时间、标为缓存", second.fromCache && second.text === first.text && second.fetchedAt === first.fetchedAt && !first.fromCache);
    ok("第二支额度不变", b2.budget.used === 0 && b2.budget.remaining === 12);
    const w3 = makeWorld();
    w3.handlers.set("https://same.example/x", () => html(`<p>${LONG_TEXT}</p>`));
    const s3 = await session(w3);
    await Promise.all([
      readPublicPage("https://same.example/x", s3.forBranch({ branchKey: "c1", budget: budget() })),
      readPublicPage("https://same.example/x", s3.forBranch({ branchKey: "c2", budget: budget() })),
    ]);
    ok("并发读同一网址也只请求一次", w3.pageRequests().length === 1);
    const w4 = makeWorld();
    w4.handlers.set("https://lim2.example/x", () => html(`<p>${LONG_TEXT}</p>`));
    const s4 = await session(w4);
    const empty = s4.forBranch({ branchKey: "e", budget: budget(0) });
    const full = s4.forBranch({ branchKey: "f", budget: budget(1) });
    const limited = await readPublicPage("https://lim2.example/x", empty);
    const later = await readPublicPage("https://lim2.example/x", full);
    ok("「到上限」不记进缓存：另一支照常读到", limited.outcome === "limit" && later.outcome === "ok" && !later.fromCache);
  }

  console.log("站点名单与 robots");
  {
    const w = makeWorld();
    w.handlers.set("https://rob.example/robots.txt", () => ({ status: 200, headers: { "content-type": "text/plain" }, body: enc.encode("User-agent: *\nDisallow: /private\n"), truncated: false }));
    w.handlers.set("https://rob.example/public/b", () => html(`<p>${LONG_TEXT}</p>`));
    w.handlers.set("https://rob.example/private/a", () => html("<p>secret</p>"));
    w.handlers.set("https://down.example/robots.txt", () => status(503));
    w.handlers.set("https://down.example/p", () => html(`<p>${LONG_TEXT}</p>`));
    w.handlers.set("https://forb.example/robots.txt", () => status(403));
    w.handlers.set("https://forb.example/p", () => html(`<p>${LONG_TEXT}</p>`));
    w.handlers.set("https://www.importyeti.com/company/x", () => html(`<p>${LONG_TEXT}</p>`));
    w.handlers.set("https://bad.example.com/p", () => html(`<p>${LONG_TEXT}</p>`));
    const s = await session(w, { settings: { researchTree: { sites: { deny: ["bad.example.com"] } } } });
    const ctx = s.forBranch({ branchKey: "b", budget: budget() });
    for (const url of ["https://detail.1688.com/offer/1.html", "https://www.merx.com/x", "https://bad.example.com/p"]) {
      const r = await readPublicPage(url, ctx);
      ok(`不碰：${new URL(url).hostname} 拒绝`, r.outcome === "refused" && r.reason === "site_denied");
    }
    ok("不碰的站没有任何请求", !w.log.some((l) => /1688|merx|bad\.example/.test(l.url)));
    const priv = await readPublicPage("https://rob.example/private/a", ctx);
    ok("robots 不许：被挡、没有页面请求", priv.outcome === "blocked" && priv.reason === "robots_disallow" && !w.log.some((l) => l.url.endsWith("/private/a")));
    const ctx2 = s.forBranch({ branchKey: "b2", budget: budget() });
    const pub = await readPublicPage("https://rob.example/public/b", ctx2);
    ok("robots 允许的路径读到", pub.outcome === "ok");
    ok("同一站点的 robots 只取一次", w.robotsRequests().filter((l) => l.url.startsWith("https://rob.example")).length === 1);
    const down = await readPublicPage("https://down.example/p", ctx2);
    ok("robots 返回 503：被挡（robots 读取失败）、没有页面请求", down.outcome === "blocked" && down.reason === "robots_unavailable" && !w.log.some((l) => l.url === "https://down.example/p"), down);
    const forb = await readPublicPage("https://forb.example/p", ctx2);
    ok("robots 返回 403：视为没有限制", forb.outcome === "ok");
    const before = ctx2.budget.used;
    const iy = await readPublicPage("https://www.importyeti.com/company/x", ctx2);
    ok("ImportYeti：不请求 robots、直接读、照常扣额度", iy.outcome === "ok" && !w.log.some((l) => l.url.includes("importyeti.com/robots.txt")) && ctx2.budget.used === before + 1);
  }

  console.log("读到什么");
  {
    const w = makeWorld();
    w.handlers.set("https://doc.example/a.pdf", () => ({ status: 200, headers: { "content-type": "application/pdf" }, body: enc.encode("Contract\u0000value 230,000"), truncated: false }));
    w.handlers.set("https://doc.example/big", () => html(`<p>${"x".repeat(3 * 1024 * 1024)}</p>`));
    w.handlers.set("https://doc.example/img.png", () => ({ status: 200, headers: { "content-type": "image/png" }, body: new Uint8Array([1, 2, 3]), truncated: false }));
    w.handlers.set("https://doc.example/none", () => ({ status: 200, headers: {}, body: enc.encode("x"), truncated: false }));
    w.handlers.set("https://doc.example/t.txt", () => ({ status: 200, headers: { "content-type": "text/plain; charset=utf-8" }, body: enc.encode("Line 1\r\n\r\n\r\n\r\nLine 2\u0000"), truncated: false }));
    w.handlers.set("https://doc.example/h", () => html("<html><head><title>T</title><script>evil()</script></head><body><h1>Award</h1><table><tr><td>Vendor</td><td>ACME</td></tr></table></body></html>"));
    w.handlers.set("https://doc.example/latin", () => ({ status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, body: new Uint8Array([0x3c, 0x70, 0x3e, 0x43, 0x61, 0x66, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]), truncated: false }));
    const s = await session(w);
    const ctx = s.forBranch({ branchKey: "b", budget: budget() });
    const pdf = await readPublicPage("https://doc.example/a.pdf", ctx);
    ok("PDF：读到且不含 U+0000", pdf.outcome === "ok" && !pdf.text.includes("\u0000") && pdf.text.includes("230,000"), pdf);
    const big = await readPublicPage("https://doc.example/big", ctx);
    ok("3 MB 页面：读到、标「已截断」", big.outcome === "ok" && big.truncated === true && big.text.length <= WEB_READER_LIMITS.MAX_BODY_BYTES);
    const img = await readPublicPage("https://doc.example/img.png", ctx);
    const none = await readPublicPage("https://doc.example/none", ctx);
    ok("image/png 与没有类型：拒绝", img.outcome === "refused" && img.reason === "unsupported_type" && none.reason === "unsupported_type");
    const txt = await readPublicPage("https://doc.example/t.txt", ctx);
    ok("纯文本：读到、归一、清掉 U+0000", txt.outcome === "ok" && txt.text === "Line 1\n\nLine 2", txt.text);
    const h = await readPublicPage("https://doc.example/h", ctx);
    ok("HTML：去掉 head 与 script，表格用制表符", h.text.includes("Award") && h.text.includes("Vendor\tACME") && !h.text.includes("evil"), h.text);
    const latin = await readPublicPage("https://doc.example/latin", ctx);
    ok("按 charset 解码", latin.text === "Café", latin.text);
    ok("结果带 untrusted 与各字段", [pdf, big, h].every((r) => r.untrusted === true && typeof r.fetchedAt === "string" && r.finalUrl !== null && r.blocked === null));
  }

  console.log("审计不记正文");
  {
    const w = makeWorld();
    w.handlers.set("https://aud.example/p", () => html(`<p>SECRET-BODY-TEXT ${LONG_TEXT}</p>`));
    const logs: string[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    const s = await session(w);
    const ctx = s.forBranch({ branchKey: "b", budget: budget() });
    console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
    console.error = console.log;
    console.warn = console.log;
    const r = await readPublicPage("https://aud.example/p", ctx);
    await readPublicPage("https://aud.example/p", ctx); // 缓存命中不写审计
    await readPublicPage("https://www.merx.com/x", ctx); // 拒绝不写审计
    Object.assign(console, orig);
    ok("读到了正文", r.text.includes("SECRET-BODY-TEXT"));
    ok("只写一条审计（实际发请求的那次）", w.audits.length === 1, w.audits);
    const a = w.audits[0];
    ok("审计含网址、状态、字数、发起人与 Job", !!a && a.url === "https://aud.example/p" && a.httpStatus === 200 && a.chars === r.text.length && a.userId === "u1" && a.jobId === "job1" && a.outcome === "ok");
    ok("审计与日志里搜不到正文", !JSON.stringify(w.audits).includes("SECRET-BODY-TEXT") && !logs.join("\n").includes("SECRET-BODY-TEXT"));
    ok("审计字段固定（没有正文 / 头）", !!a && Object.keys(a).sort().join(",") === "attempts,branchKey,chars,finalUrl,httpStatus,jobId,orgId,outcome,reason,site,truncated,url,userId");
  }

  console.log(`\nweb-reader: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
