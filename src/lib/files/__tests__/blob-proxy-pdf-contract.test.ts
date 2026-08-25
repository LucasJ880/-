/**
 * 生产回归契约（2026-08-25 Lucas 实测两案）：
 *  ① 下载 0 字节：/api/files 代理把 @vercel/blob get() 的 size（上游 content-length，缺失时 0、压缩传输时为压缩长度）
 *     手设为 Content-Length → 客户端按声明截断。流式转发一律不得手设 Content-Length。
 *  ② PDF 回落 HTML：@sparticuz/chromium 的浏览器二进制（bin/*.br）由 executablePath() 运行时扫目录加载，
 *     Next 静态追踪看不见 → 必须在 outputFileTracingIncludes 显式声明进两个 PDF 路由的函数包
 *     （生产日志实证：The input directory "/var/task/node_modules/@sparticuz/chromium/bin" does not exist）。
 * 运行：npx tsx src/lib/files/__tests__/blob-proxy-pdf-contract.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const code = (rel: string) => readFileSync(join(root, rel), "utf-8");
let pass = 0, fail = 0;
const ok = (c: boolean, n: string) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } };

const proxy = code("src/app/api/files/[...path]/route.ts");
ok(!/headers\.set\(\s*"Content-Length"/.test(proxy) && proxy.includes("不手设 Content-Length"), "BP-1: /api/files 代理不手设 Content-Length（SDK size=0/压缩长度会截断下载为 0 字节）");
const viz = code("src/app/api/visualizer/share/[token]/assets/[kind]/[id]/route.ts");
ok(!/headers\.set\(\s*"Content-Length"/.test(viz), "BP-2: visualizer 分享资产代理同样不手设 Content-Length");
ok(proxy.includes("new NextResponse(blob.stream"), "BP-3: 代理仍是流式转发（不整块 buffer）");

const cfg = code("next.config.ts");
const seg = (route: string) => { const i = cfg.indexOf(route); return i >= 0 ? cfg.slice(i, i + 800) : ""; };
ok(seg("/api/projects/\\[id\\]/generate-pdf").includes("@sparticuz/chromium/bin/**"), "BP-4: generate-pdf 路由函数包显式带 Chromium 二进制（一键生成出真 PDF 的前提）");
ok(seg("/api/projects/\\[id\\]/quote-engine/\\[quoteId\\]/pdf").includes("@sparticuz/chromium/bin/**"), "BP-5: 客户报价 PDF 路由同样带 Chromium 二进制（该路由 fail-closed，缺二进制在生产直接不可用）");
ok(/serverExternalPackages[^\n]*@sparticuz\/chromium/.test(cfg), "BP-6: @sparticuz/chromium 保持 serverExternalPackages（不被打包器改写路径）");

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
