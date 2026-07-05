/**
 * blob-access 纯函数测试（B1）
 *
 * 只测 URL/pathname 转换逻辑，不触网络、不触 Blob、不触 DB。
 * 运行：npx tsx src/lib/files/__tests__/blob-access.test.ts
 */

import {
  blobPathnameFromUrl,
  toProxyUrl,
  isProxyUrl,
  FILE_PROXY_PREFIX,
} from "../blob-access";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// 1. 完整 Blob URL → pathname
{
  const url =
    "https://abc123.public.blob.vercel-storage.com/visual-builder/org1/2026/07/exec_1/source-0.jpg";
  ok(
    blobPathnameFromUrl(url) === "visual-builder/org1/2026/07/exec_1/source-0.jpg",
    "url→pathname: 去掉 host",
  );
}

// 2. 带查询串的 URL
{
  const url =
    "https://abc.blob.vercel-storage.com/projects/p1/16_a.pdf?download=1";
  ok(blobPathnameFromUrl(url) === "projects/p1/16_a.pdf", "url→pathname: 去掉查询串");
}

// 3. 已是 pathname 时原样返回（去除前导 /）
{
  ok(blobPathnameFromUrl("/visualizer/sessions/s1/images/a.png") === "visualizer/sessions/s1/images/a.png", "pathname: 去前导斜杠");
  ok(blobPathnameFromUrl("temp/brochures/1_a.pdf") === "temp/brochures/1_a.pdf", "pathname: 原样");
}

// 4. URL 编码路径段解码
{
  const url = "https://abc.blob.vercel-storage.com/projects/p1/16_%E6%96%87%E6%A1%A3.pdf";
  ok(blobPathnameFromUrl(url) === "projects/p1/16_文档.pdf", "url→pathname: 解码中文");
}

// 5. toProxyUrl 基本形态
{
  const proxy = toProxyUrl(
    "https://abc.blob.vercel-storage.com/trade-service/org1/req1/deliverables/1.png",
  );
  ok(
    proxy === `${FILE_PROXY_PREFIX}trade-service/org1/req1/deliverables/1.png`,
    "toProxyUrl: 前缀 + pathname",
  );
  ok(isProxyUrl(proxy), "isProxyUrl: 识别代理 URL");
}

// 6. toProxyUrl 对特殊字符逐段编码
{
  const proxy = toProxyUrl("projects/p1/16_文档 v2.pdf");
  ok(proxy === `${FILE_PROXY_PREFIX}projects/p1/${encodeURIComponent("16_文档 v2.pdf")}`, "toProxyUrl: 逐段编码");
  ok(!proxy.includes(" "), "toProxyUrl: 无裸空格");
}

// 7. isProxyUrl 对外部 URL 返回 false
{
  ok(!isProxyUrl("https://abc.blob.vercel-storage.com/x.png"), "isProxyUrl: blob URL → false");
  ok(!isProxyUrl("/api/other/x.png"), "isProxyUrl: 其他 API → false");
}

console.log(`blob-access: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
