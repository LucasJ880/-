/**
 * TI-1 价格表行项契约 — 结构校验与数量汇总（纯逻辑）
 * 运行：npx tsx src/lib/tender-price-schedule/__tests__/schedule-contract.test.ts
 * 覆盖任务书验收项 A1（行项不缺不重不乱序）、A2（五组合计）。
 */
import assert from "node:assert/strict";
import { lineRange, sumQuantity, validatePriceSchedule, type PriceScheduleLine } from "../contract";
import { OTTAWA_18026, OTTAWA_18026_LINES } from "./fixtures/ottawa-18026";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const clone = (): PriceScheduleLine[] => OTTAWA_18026_LINES.map((l) => ({ ...l }));
const codes = (lines: PriceScheduleLine[]) => validatePriceSchedule(lines).issues.map((i) => i.code);

console.log("tender-price-schedule contract");

{
  const v = validatePriceSchedule(OTTAWA_18026_LINES);
  ok("渥太华 18 行结构有效，问题清单为空", v.valid && v.issues.length === 0 && OTTAWA_18026_LINES.length === OTTAWA_18026.expected.count);
  ok("行号恰为 1..18 且顺序不变", OTTAWA_18026_LINES.every((l, i) => l.lineNo === i + 1));
}
{
  const dup = clone(); dup[4].lineNo = 4;
  const c = codes(dup);
  ok("第 5 行行号改成 4 → 重复且不连续", c.includes("LINE_NO_DUPLICATE") && c.includes("LINE_NO_NOT_CONSECUTIVE") && !validatePriceSchedule(dup).valid);
  const gap = clone(); gap.splice(6, 1);
  const g = validatePriceSchedule(gap);
  ok("删掉第 7 行 → 不连续，指出断点行号 8", !g.valid && g.issues.some((i) => i.code === "LINE_NO_NOT_CONSECUTIVE" && i.lineNo === 8));
  const reordered = clone(); [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  ok("调换前两行 → 不连续（顺序是招标事实，不重排）", !validatePriceSchedule(reordered).valid);
}
{
  const bad = clone(); bad[9].uom = "unknown";
  const v = validatePriceSchedule(bad);
  ok("单位 unknown → 无效并指出第 10 行", !v.valid && v.issues.some((i) => i.code === "UOM_UNKNOWN" && i.lineNo === 10));
  const zero = clone(); zero[0].quantity = 0;
  ok("数量为 0 → 无效", codes(zero).includes("QUANTITY_INVALID"));
  const nan = clone(); nan[0].quantity = "abc";
  ok("数量无法解析 → 无效", codes(nan).includes("QUANTITY_INVALID"));
  const noDesc = clone(); noDesc[2].description = "  ";
  ok("说明为空 → 无效", codes(noDesc).includes("DESCRIPTION_MISSING"));
  const pack = clone(); pack[9].packCount = 0;
  ok("包装数为 0 → 无效", codes(pack).includes("PACK_COUNT_INVALID"));
  ok("空价格表 → 无效", codes([]).includes("EMPTY_SCHEDULE"));
  const before = JSON.stringify(bad);
  validatePriceSchedule(bad);
  ok("校验不修正输入", JSON.stringify(bad) === before);
}
{
  const sum = (from: number, to: number) => { const r = sumQuantity(OTTAWA_18026_LINES, lineRange(from, to)); return r.ok ? r.total.toNumber() : NaN; };
  ok("第 1–9 行合计 6,119", sum(1, 9) === OTTAWA_18026.expected.mattressAndBoxEach);
  ok("第 10–11 行合计 2,903 包", sum(10, 11) === OTTAWA_18026.expected.pillowPacks);
  ok("第 12 行 436 盒", sum(12, 12) === OTTAWA_18026.expected.interceptorBoxes);
  ok("第 13–15 行合计 54 台", sum(13, 15) === OTTAWA_18026.expected.thermalEach);
  ok("第 16–18 行合计 1,140 卷", sum(16, 18) === OTTAWA_18026.expected.laundryRolls);
  const mixed = sumQuantity(OTTAWA_18026_LINES, [9, 10]);
  ok("Each 与 Pack 不相加", !mixed.ok && mixed.code === "MIXED_UOM");
  const missing = sumQuantity(OTTAWA_18026_LINES, [19]);
  ok("不存在的行号 → 拒绝", !missing.ok && missing.code === "LINE_NOT_FOUND");
  ok("带强制认证闸的恰为第 13–15 行",
    JSON.stringify(OTTAWA_18026_LINES.filter((l) => l.certificationGate).map((l) => l.lineNo)) === JSON.stringify(OTTAWA_18026.expected.electricalCertItems));
}

console.log(`\ntender-price-schedule contract: ${passed} passed`);
