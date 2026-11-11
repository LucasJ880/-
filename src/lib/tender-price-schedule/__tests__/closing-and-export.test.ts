/**
 * TI-1 截标时间与官方价格表导出（纯逻辑 + 源码断言）
 * 运行：npx tsx src/lib/tender-price-schedule/__tests__/closing-and-export.test.ts
 * 覆盖任务书验收项 A1（导出不缺不重不乱序）、A10（合计对到分）、A16（时区与过期）。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveTenderWindowState, parseClosingTime } from "../closing-time";
import { exportOfficialPriceSchedule, OFFICIAL_EXPORT_COLUMNS } from "../official-export";
import type { PriceScheduleLine } from "../contract";
import { OTTAWA_18026, OTTAWA_18026_LINES } from "./fixtures/ottawa-18026";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

console.log("tender-price-schedule closing-and-export");

{
  const naive = parseClosingTime("2026-11-10T15:00:00");
  ok("不带时区的截标时间 → 失败，说明缺时区", !naive.ok && naive.code === "NO_TIMEZONE" && naive.messageZh.includes("时区"));
  const dateOnly = parseClosingTime("2026-11-10");
  ok("只有日期 → 失败", !dateOnly.ok && dateOnly.code === "NO_TIMEZONE");
  ok("空值 → 失败", !parseClosingTime("").ok && !parseClosingTime(null).ok);
  ok("乱写 → 失败", (() => { const r = parseClosingTime("next Tuesday 3pm"); return !r.ok && r.code === "INVALID"; })());
  const good = parseClosingTime(OTTAWA_18026.opportunity.closingAt);
  ok("带 -05:00 的时间通过，等于 20:00Z", good.ok && good.closingAt.toISOString() === "2026-11-10T20:00:00.000Z");
  ok("Z 结尾也通过", parseClosingTime("2026-11-10T20:00:00Z").ok);

  assert.ok(good.ok);
  const closingAt = good.closingAt;
  const after = new Date("2026-11-11T12:00:00Z");
  ok("截标前 → 开放", deriveTenderWindowState({ closingAt, now: new Date("2026-11-10T19:59:59Z") }) === "OPEN");
  ok("已过截标且无提交记录 → 已过期", deriveTenderWindowState({ closingAt, now: after }) === "EXPIRED");
  ok("有平台回执 → 已提交", deriveTenderWindowState({ closingAt, now: after, submission: { submittedAt: "2026-11-10T19:00:00Z", receiptRef: "MERX-RCPT-0001" } }) === "SUBMITTED");
  ok("提交记录没有回执 → 仍为已过期", deriveTenderWindowState({ closingAt, now: after, submission: { submittedAt: "2026-11-10T19:00:00Z", receiptRef: "  " } }) === "EXPIRED");
}
{
  const prices: Record<number, string> = {};
  OTTAWA_18026_LINES.forEach((l) => { prices[l.lineNo] = (l.lineNo + 0.335).toFixed(3); });
  const e = exportOfficialPriceSchedule(OTTAWA_18026_LINES, prices);
  assert.ok(e.ok);
  ok("导出恰好 18 行，行号 1–18 且顺序不变", e.rows.length === 18 && e.rows.every((r, i) => r.lineNo === i + 1));
  ok("说明、单位、数量与输入完全一致", e.rows.every((r, i) => r.description === OTTAWA_18026_LINES[i].description && r.uom === OTTAWA_18026_LINES[i].uom && r.quantity === String(OTTAWA_18026_LINES[i].quantity)));
  ok("第 10、11 行 Pack，第 12 行 Box，第 16–18 行 Roll", e.rows[9].uom === "Pack" && e.rows[10].uom === "Pack" && e.rows[11].uom === "Box" && [15, 16, 17].every((i) => e.rows[i].uom === "Roll"));
  const sumCents = e.rows.reduce((acc, r) => acc + Math.round(Number(r.extended) * 100), 0);
  ok("总计等于各行合计之和（到分）", Math.round(Number(e.total) * 100) === sumCents);
  ok("单价已舍入到分：第 1 行 1.335 → 1.34", e.rows[0].unitPrice === "1.34" && e.rows[0].extended === (1.34 * 2367).toFixed(2));
  ok("标明不含 HST", e.taxNote === "不含 HST" && e.csv.includes("excluding HST"));
  ok("导出列只有六列", JSON.stringify(Object.keys(e.rows[0])) === JSON.stringify([...OFFICIAL_EXPORT_COLUMNS]) && OFFICIAL_EXPORT_COLUMNS.length === 6);
  ok("CSV 为表头 + 18 行 + 总计", e.csv.split("\n").length === 20 && e.csv.split("\n")[0] === "Line,Description,UOM,Quantity,Unit Price,Extended Price");
  ok("CSV 对含逗号的说明加引号", e.csv.includes('"Laundry Bags, Front Load"'));

  const missing = { ...prices }; delete missing[14];
  const m = exportOfficialPriceSchedule(OTTAWA_18026_LINES, missing);
  ok("第 14 行缺单价 → 拒绝导出并指出行号", !m.ok && m.code === "MISSING_UNIT_PRICE" && JSON.stringify(m.missingLineNos) === "[14]" && m.messageZh.includes("14"));

  const broken: PriceScheduleLine[] = OTTAWA_18026_LINES.map((l) => ({ ...l })); broken.splice(6, 1);
  const b = exportOfficialPriceSchedule(broken, prices);
  ok("行项结构有问题 → 拒绝导出", !b.ok && b.code === "SCHEDULE_INVALID");
}
{
  // 源码断言：本能力是纯函数，不碰数据库、网络、模型
  const dir = join(process.cwd(), "src/lib/tender-price-schedule");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }));
  ok("目录下有 5 个源码文件", sources.length === 5);
  const banned = /@\/lib\/db\b|@\/lib\/ai\b|\bfetch\s*\(|createCompletion|\bdb\.[a-zA-Z]+\.(find|create|update|delete|upsert)/;
  ok("没有数据库 / 网络 / 模型调用的引用", sources.every((s) => !banned.test(s.text)));
  ok("导出模块不出现成本、毛利、加成、供应商字段", (() => { const t = sources.find((s) => s.f === "official-export.ts")!.text; return !/\b(cost|margin|markup|supplier)[A-Za-z]*\s*[:=]/i.test(t); })());
}

console.log(`\ntender-price-schedule closing-and-export: ${passed} passed`);
