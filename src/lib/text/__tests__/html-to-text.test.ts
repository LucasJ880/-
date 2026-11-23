/**
 * TREE-1 HTML → 纯文本公共实现（从 trade/email-forward-parse.ts 挪来）
 *
 * 运行：npx tsx src/lib/text/__tests__/html-to-text.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeHtmlEntities, htmlToText, normalizePlainText } from "../html-to-text";
import { htmlToText as emailHtmlToText } from "@/lib/trade/email-forward-parse";

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

const M = { maxInputChars: 200_000 };
ok("块级标签换行（开、闭各一个换行，多余空行压成一个）", htmlToText("<p>a</p><p>b</p>", M) === "a\n\nb" && htmlToText("a<br>b", M) === "a\nb");
ok("表格单元格之间是制表符", htmlToText("<table><tr><td>Name</td><td>ACME</td></tr></table>", M) === "Name\tACME");
ok("去掉 script / style / head", htmlToText("<head><title>t</title></head><style>x{}</style><script>evil()</script><p>ok</p>", M) === "ok");
ok("实体还原", decodeHtmlEntities("&amp;&lt;&#x4e2d;&#20013;&nbsp;&bogus;") === "&<中中 &bogus;");
ok("「a < b」这类正文保留", htmlToText("<p>a < b</p>", M) === "a < b");
ok("未闭合注释不报错", htmlToText("x<!-- never", M) === "x");
ok("输入上限是参数", htmlToText(`<p>${"a".repeat(50)}</p>`, { maxInputChars: 10 }).length <= 10);
ok("纯文本归一：换行、零宽字符、空行", normalizePlainText("a\r\n​\n\n\nb c", 100) === "a\n\nb c");
const big = `<p>${"word ".repeat(100_000)}</p>`;
const t0 = Date.now();
ok("2 MB 级输入线性时间（< 3 秒）", htmlToText(big, { maxInputChars: 2 * 1024 * 1024 }).length > 400_000 && Date.now() - t0 < 3000);
ok("病态输入（大量未闭合的「<a」）不回溯", (() => { const s = "<a".repeat(100_000); const t = Date.now(); htmlToText(s, { maxInputChars: 2_000_000 }); return Date.now() - t < 2000; })());
// 期望值由挪动前的实现（451bb0d3 的 trade/email-forward-parse.ts）对同一批输入算出，写死在这里
const GOLDEN: Array<[string, string]> = [["<p>a</p><p>b</p>","a\n\nb"],["<table><tr><td>Name</td><td>ACME</td></tr><tr><td>Total</td><td>$230,000</td></tr></table>","Name\tACME\n\nTotal\t$230,000"],["<div>Line&nbsp;one<br>Line&amp;two</div><!-- c --><script>x()</script>","Line one\nLine&two"],["<h1>T&#x4e2d;&#20013;</h1>​<ul><li>i1</li><li>i2</li></ul>","T中中\n\ni1\n\ni2"],["a < b and c > d &bogus; &lt;tag&gt;","a < b and c > d &bogus; <tag>"],["<p>unclosed <b>bold","unclosed bold"],["<style>p{}</style>  \n\n\n\n  <p>  spaced   out  </p>","spaced out"],["<title>t</title><head><meta x></head><pre>a\tb</pre>","a\tb"],["x<!-- never closed","x"],["<img src=\"data:image/png;base64,AAAA\"><p>after image</p>","after image"]];
ok("与挪动前的实现逐条相同（固定期望值）", GOLDEN.every(([input, want]) => htmlToText(input, M) === want && emailHtmlToText(input) === want), GOLDEN.find(([i, w]) => htmlToText(i, M) !== w));
ok("邮件解析那一份仍是 200000 上限", emailHtmlToText(`<p>${"x".repeat(250_000)}</p>`).length <= 200_000 && emailHtmlToText(big).length <= 200_000);
ok("&#0; 不还原成 U+0000", !htmlToText("a&#0;b", M).includes("\u0000"));
ok("纯文本归一截到上限", normalizePlainText("a".repeat(300), 100).length === 100);
ok("2 MB 级未闭合 <script> 不变成平方级（< 3 秒）", (() => { const t = Date.now(); htmlToText("<script>".repeat(262_000), { maxInputChars: 2 * 1024 * 1024 }); return Date.now() - t < 3000; })());
const src = readFileSync(join(process.cwd(), "src/lib/trade/email-forward-parse.ts"), "utf8");
ok("邮件解析里不再有第二份实现", src.includes('from "@/lib/text/html-to-text"') && !src.includes("SKIP_CONTENT_TAGS") && !src.includes("NAMED_ENTITIES"));

console.log(`\nhtml-to-text: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
