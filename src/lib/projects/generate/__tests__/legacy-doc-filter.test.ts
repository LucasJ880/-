/**
 * 乱码时代文档过滤（LDF-01..04）。运行：npx tsx src/lib/projects/generate/__tests__/legacy-doc-filter.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isLegacyGarbledGeneratedDoc } from "@/lib/projects/generate/legacy-doc-filter";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } };

ok(isLegacyGarbledGeneratedDoc({ metaJson: "{}", blobUrl: "x/y/doc.pdf" }), "LDF-01: 无 renderMode 的 .pdf = jsPDF 乱码时代 → 隐藏");
ok(isLegacyGarbledGeneratedDoc({ metaJson: JSON.stringify({ renderMode: "html_fallback:The input directory ..." }), blobUrl: "x/y/doc.html" }), "LDF-02: html_fallback 回落件 → 隐藏");
ok(!isLegacyGarbledGeneratedDoc({ metaJson: JSON.stringify({ renderMode: "chromium_pdf" }), blobUrl: "x/y/doc.pdf" }), "LDF-03: chromium_pdf 正常件 → 保留");
ok(!isLegacyGarbledGeneratedDoc({ metaJson: null, blobUrl: "x/y/doc.html" }) && !isLegacyGarbledGeneratedDoc({ metaJson: "not-json", blobUrl: "x/y/a.html" }), "LDF-04: 早期合法 HTML 与坏 metaJson 不误杀（fail-open 到保留）");

const root = join(__dirname, "../../../../..");
const route = readFileSync(join(root, "src/app/api/projects/[id]/generate-pdf/route.ts"), "utf-8");
ok(route.includes("isLegacyGarbledGeneratedDoc") && route.includes("filter((d) => !isLegacyGarbledGeneratedDoc(d))"), "LDF-05: 列表路由已挂过滤（不删数据）");

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
