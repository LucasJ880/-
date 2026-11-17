/**
 * 导入留痕 → 审计内容（QUOTE-1b，openspec change quote-import-studio-file，design D10）——纯逻辑，无 DB
 * 运行：npx tsx src/lib/sales/quote-import/__tests__/audit.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QUOTE_IMPORTED_AUDIT_ACTION, importAuditPayload, readImportSource } from "@/lib/sales/quote-import/audit";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };

const source = (o: Record<string, unknown> = {}) => ({
  tool: "sunny-quote-studio", fileVersion: 1, quoteId: "q1", quoteNumber: "SQ-TEST", plan: "A",
  exportedAt: "2026-11-14T15:00:00.000Z", pricelistVersion: "2026.11-local.1", fileGrandTotal: 8224.5,
  importedAt: "2026-11-15T10:00:00.000Z", pricelistMatch: true, rowCount: 16, ...o,
});
const form = (importSource?: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ customerName: "Example Homeowner", customerPhone: "416-555-0100", customerEmail: "homeowner@fixture.test", customerAddress: "1 Example St", ...extra, ...(importSource === undefined ? {} : { importSource }) });

console.log("导入留痕 → 审计内容");

ok(QUOTE_IMPORTED_AUDIT_ACTION === "quote_imported", "AUD-01: 审计动作名 quote_imported");

{
  const s = readImportSource(form(source()));
  ok(!!s && s.quoteId === "q1" && s.quoteNumber === "SQ-TEST" && s.exportedAt === "2026-11-14T15:00:00.000Z" && s.fileGrandTotal === 8224.5 && s.rowCount === 16 && s.pricelistMatch === true, "AUD-02: 读出留痕的白名单字段", s);
  const text = JSON.stringify(s);
  ok(!/416-555-0100|homeowner@fixture\.test|1 Example St|Example Homeowner/.test(text), "AUD-03: 审计内容不含客户姓名、电话、邮箱、地址", text);
  const extra = readImportSource(form(source({ customerPhone: "416-555-0100", windowPhotos: ["data:image/png;base64,AAAA"], note: "x".repeat(5000) })));
  ok(!!extra && !("customerPhone" in extra) && !("windowPhotos" in extra) && !("note" in extra), "AUD-04: 留痕里多出来的键不进审计（只取白名单）", extra);
  const long = readImportSource(form(source({ quoteNumber: "N".repeat(1000) })));
  ok(!!long && long.quoteNumber.length === 200, "AUD-05: 文本字段截到 200 字");
}

ok(readImportSource(null) === null && readImportSource("") === null && readImportSource("not json") === null && readImportSource("[]") === null && readImportSource(form()) === null, "AUD-06: 没有表单数据 / 不是 JSON / 没有留痕 → null，不抛错");
ok(readImportSource(form(source({ tool: "other-tool" }))) === null && readImportSource(form("string")) === null && readImportSource(form([1])) === null, "AUD-07: 工具标识不对或形状不对 → null");
ok(readImportSource(form(source({ quoteId: "" }))) === null && readImportSource(form(source({ exportedAt: 123 }))) === null && readImportSource(form(source({ importedAt: undefined }))) === null, "AUD-08: 缺报价 id / 导出时间 / 导入时间 → null（无法判断是否同一次导入）");
{
  const s = readImportSource(form(source({ fileGrandTotal: "8224.5", fileVersion: NaN, pricelistMatch: "yes", rowCount: Infinity })));
  ok(!!s && s.fileGrandTotal === null && s.fileVersion === null && s.pricelistMatch === null && s.rowCount === null, "AUD-09: 数字 / 布尔字段类型不对 → null，不拒绝整条留痕", s);
}

// 同一次导入只写一次
ok(!!importAuditPayload(form(source()), null), "AUD-10: 新建（之前没有表单数据）→ 写");
ok(!!importAuditPayload(form(source()), form()), "AUD-11: 修改一张原本没有留痕的报价 → 写");
ok(importAuditPayload(form(source()), form(source())) === null, "AUD-12: 同一次导入再保存 → 不写");
ok(importAuditPayload(form(source(), { partBNotes: "改了备注" }), form(source())) === null, "AUD-13: 留痕没变、只改了别的内容 → 不写");
ok(!!importAuditPayload(form(source({ importedAt: "2026-11-16T09:00:00.000Z" })), form(source())), "AUD-14: 同一份文件又导入了一次（导入时间不同）→ 写");
ok(!!importAuditPayload(form(source({ quoteId: "q2" })), form(source())), "AUD-15: 换了一份文件 → 写");
ok(importAuditPayload(form(), form(source())) === null && importAuditPayload(undefined, form(source())) === null, "AUD-16: 新的表单数据不带留痕 → 不写");
ok(!!importAuditPayload(form(source()), "not json"), "AUD-17: 之前的表单数据解析失败 → 按没有留痕处理");

// 两条保存路径都接上了
{
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  const create = read("src/app/api/sales/quotes/route.ts");
  const update = read("src/lib/sales/quote-update.ts");
  ok(create.includes("importAuditPayload(formDataJson, null)") && create.includes("QUOTE_IMPORTED_AUDIT_ACTION"), "AUD-18: 新建路径写 quote_imported");
  ok(update.includes("importAuditPayload(") && update.includes("QUOTE_IMPORTED_AUDIT_ACTION") && update.includes("select: { formDataJson: true }"), "AUD-19: 修改路径先读保存前的表单数据再决定是否写");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
