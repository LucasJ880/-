/**
 * 模型输出 Markdown 的地址判定（纯函数，无浏览器 / 无 DB）
 * （openspec change ai-markdown-image-allowlist，spec agents/ai-output-rendering）
 * 运行：npx tsx src/lib/ai-markdown/__tests__/url-policy.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AI_IMAGE_ALLOWED_PREFIX,
  blockedImageLabel,
  classifyAiImageSrc,
  classifyAiLinkHref,
  linkHostSuffix,
} from "../url-policy";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("图片：允许清单之外一律不放行");
const BLOCKED: Array<[label: string, src: unknown, host: string | null]> = [
  ["https 外部地址", "https://attacker.example/p.png?d=SECRET", "attacker.example"],
  ["http 外部地址", "http://attacker.example/p.png", "attacker.example"],
  ["协议相对地址", "//attacker.example/a.png", "attacker.example"],
  ["反斜杠变形", "/\\attacker.example/a.png", "attacker.example"],
  ["双反斜杠变形", "\\\\attacker.example/a.png", "attacker.example"],
  ["夹制表符的变形", "/\t/attacker.example/a.png", "attacker.example"],
  ["夹换行的变形", "/\n/attacker.example/a.png", "attacker.example"],
  ["协议相对且路径像站内文件", "//attacker.example/api/files/a.png", "attacker.example"],
  ["带用户名的外部地址", "https://qingyan.example@attacker.example/api/files/a.png", "attacker.example"],
  ["data 地址", "data:image/png;base64,AAAA", null],
  ["javascript 地址", "javascript:alert(1)", null],
  ["blob 地址", "blob:https://attacker.example/uuid", null],
  ["路径穿越", "/api/files/../auth/logout", null],
  ["编码的路径穿越", "/api/files/%2e%2e/auth/logout", null],
  ["大写编码的路径穿越", "/api/files/x/%2E%2E/%2E%2E/auth/logout", null],
  ["站内其它接口", "/api/auth/logout", null],
  ["站内页面", "/dashboard", null],
  ["只有前缀没有文件", "/api/files/", null],
  ["前缀相似的别的路径", "/api/filesystem/a.png", null],
  ["不以斜杠开头的相对路径", "api/files/a.png", null],
  ["点开头的相对路径", "./api/files/a.png", null],
  ["指向自己域名的绝对地址", "https://qingyan.example/api/files/a.png", "qingyan.example"],
  ["占位主机名之一（绝对）", "https://qingyan-a.invalid/api/files/a.png", "qingyan-a.invalid"],
  ["占位主机名之一（协议相对）", "//qingyan-a.invalid/api/files/a.png", "qingyan-a.invalid"],
  ["占位主机名之二（协议相对）", "//qingyan-b.invalid/api/files/a.png", "qingyan-b.invalid"],
  ["空串", "", null],
  ["不是字符串", undefined, null],
];
for (const [label, src, host] of BLOCKED) {
  const d = classifyAiImageSrc(src);
  ok(`不放行：${label}`, d.allowed === false && d.host === host, { src, got: d, wantHost: host });
}

console.log("图片：站内文件代理之下放行，地址取规范化后的站内路径");
const ALLOWED: Array<[label: string, src: string, want: string]> = [
  ["普通站内文件", "/api/files/ai-chat/org1/a.png", "/api/files/ai-chat/org1/a.png"],
  ["带查询串", "/api/files/visual-builder/org1/a.png?v=2", "/api/files/visual-builder/org1/a.png?v=2"],
  ["带片段（片段丢弃）", "/api/files/projects/p1/a.png#top", "/api/files/projects/p1/a.png"],
  ["带空格（转义）", "/api/files/projects/p1/效果 图.png", "/api/files/projects/p1/%E6%95%88%E6%9E%9C%20%E5%9B%BE.png"],
  ["内部多余的点段被折叠但仍在代理之下", "/api/files/a/../b/c.png", "/api/files/b/c.png"],
];
for (const [label, src, want] of ALLOWED) {
  const d = classifyAiImageSrc(src);
  ok(`放行：${label}`, d.allowed === true && d.src === want, { src, got: d, want });
}
ok("放行的地址都以代理前缀开头", ALLOWED.every(([, src]) => { const d = classifyAiImageSrc(src); return d.allowed && d.src.startsWith(AI_IMAGE_ALLOWED_PREFIX); }));
ok("代理前缀就是 /api/files/", AI_IMAGE_ALLOWED_PREFIX === "/api/files/");

console.log("被拦图片的提示文字");
ok("有替代文字、有主机名", blockedImageLabel("报价", "attacker.example") === "〔图片未加载：报价 · attacker.example〕");
ok("没有替代文字、有主机名", blockedImageLabel("", "attacker.example") === "〔图片未加载 · attacker.example〕");
ok("有替代文字、没有主机名", blockedImageLabel("报价", null) === "〔图片未加载：报价〕");
ok("都没有", blockedImageLabel(undefined, null) === "〔图片未加载〕");
ok("替代文字里的换行与多空格压成一个空格", blockedImageLabel("  第一行\n\n第二行  ", null) === "〔图片未加载：第一行 第二行〕");
ok("替代文字过长截断", blockedImageLabel("字".repeat(200), null).length < 100 && blockedImageLabel("字".repeat(200), null).includes("…"));
{
  const d = classifyAiImageSrc(`https://${"a".repeat(50)}.${"b".repeat(50)}.attacker.example/p.png`);
  ok("主机名过长时保留结尾", d.allowed === false && d.host !== null && d.host.length <= 60 && d.host.startsWith("…") && d.host.endsWith(".attacker.example"), d);
}
ok("提示文字不含地址的路径与查询串", !blockedImageLabel("x", (classifyAiImageSrc("https://attacker.example/p.png?d=SECRET") as { host: string | null }).host).includes("SECRET"));

console.log("链接：是否外部与主机名");
const EXTERNAL: Array<[string, string, string]> = [
  ["https 外部链接", "https://attacker.example/c?d=1", "attacker.example"],
  ["http 外部链接", "http://docs.example.org/guide", "docs.example.org"],
  ["协议相对链接", "//attacker.example/c", "attacker.example"],
  ["反斜杠变形", "/\\attacker.example/c", "attacker.example"],
  ["大写主机名统一成小写", "https://Attacker.EXAMPLE/c", "attacker.example"],
  ["占位主机名（协议相对）也算外部", "//qingyan-a.invalid/x", "qingyan-a.invalid"],
  ["占位主机名（绝对）也算外部", "https://qingyan-b.invalid/x", "qingyan-b.invalid"],
];
for (const [label, href, host] of EXTERNAL) {
  const d = classifyAiLinkHref(href);
  ok(`外部：${label}`, d.external === true && d.host === host, { href, got: d });
}
for (const [label, href] of [
  ["站内路径", "/projects/abc"],
  ["站内相对路径", "projects/abc"],
  ["锚点", "#section"],
  ["查询串", "?tab=2"],
  ["mailto", "mailto:someone@example.com"],
  ["tel", "tel:+14165550100"],
  ["空串", ""],
] as Array<[string, string]>) {
  ok(`非外部：${label}`, classifyAiLinkHref(href).external === false, { href, got: classifyAiLinkHref(href) });
}
ok("非外部：不是字符串", classifyAiLinkHref(undefined).external === false);

console.log("链接：主机名什么时候追加");
ok("文字与去向不一致时追加", linkHostSuffix("查看报价详情", "attacker.example") === "attacker.example");
ok("文字本身就是地址时不追加", linkHostSuffix("https://docs.example.org/guide", "docs.example.org") === null);
ok("文字里含主机名（大小写不同）时不追加", linkHostSuffix("见 Docs.Example.org 的说明", "docs.example.org") === null);
ok("文字里是别的主机名时追加", linkHostSuffix("sunnyshutter.ca 报价单", "attacker.example") === "attacker.example");
ok("空文字时追加", linkHostSuffix("", "attacker.example") === "attacker.example");

console.log("确定性：判定模块不读环境、不发请求");
{
  const src = readFileSync(join(process.cwd(), "src/lib/ai-markdown/url-policy.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("源码里没有 process.env", !/process\.env/.test(code));
  ok("源码里没有 window", !/\bwindow\b/.test(code));
  ok("源码里没有 fetch", !/\bfetch\b/.test(code));
  ok("源码不引入 React 或其它模块", !/^\s*import\s/m.test(code));
  const a = JSON.stringify(BLOCKED.map(([, s]) => classifyAiImageSrc(s)));
  const b = JSON.stringify(BLOCKED.map(([, s]) => classifyAiImageSrc(s)));
  ok("同一输入两次判定结果相同", a === b);
}

console.log(`\nai-markdown url-policy: ${passed} passed, 0 failed`);
