/**
 * TI-1 尺寸对照（纯逻辑）
 * 运行：npx tsx src/lib/tender-price-schedule/__tests__/dimension-match.test.ts
 * 覆盖任务书验收项 A9（36×39 不得悄悄满足 36×38）。
 */
import assert from "node:assert/strict";
import { matchDimensions, parseDimensions } from "../dimension-match";
import { OTTAWA_18026_LINES } from "./fixtures/ottawa-18026";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

console.log("tender-price-schedule dimension-match");

{
  const r = matchDimensions({ required: OTTAWA_18026_LINES[17].dimensions, offered: "36 x 39" });
  ok("36×39 对 36×38 → 不符", r.verdict === "MISMATCH");
  ok("指出第 2 维 39 ≠ 38", r.reasonZh.includes("第 2 维") && r.reasonZh.includes("39") && r.reasonZh.includes("38"));
  ok("36×38 对 36×38 → 相符", matchDimensions({ required: "36 x 38", offered: "36 x 38" }).verdict === "MATCH");
  ok("长宽写反 38×36 → 不符（按位置比较，不换位）", matchDimensions({ required: "36 x 38", offered: "38 x 36" }).verdict === "MISMATCH");
}
{
  const req = OTTAWA_18026_LINES[0].dimensions;
  ok("区间内 39×77.5×12 → 相符", matchDimensions({ required: req, offered: "39 x 77.5 x 12" }).verdict === "MATCH");
  ok("区间端点 9 与 15 → 相符", matchDimensions({ required: req, offered: "39 x 77.5 x 9" }).verdict === "MATCH" && matchDimensions({ required: req, offered: "39 x 77.5 x 15" }).verdict === "MATCH");
  ok("超出区间 16 → 不符", matchDimensions({ required: req, offered: "39 x 77.5 x 16" }).verdict === "MISMATCH");
  ok("定值维差 0.5 → 不符（不设容差）", matchDimensions({ required: req, offered: "39 x 78 x 12" }).verdict === "MISMATCH");
}
{
  const min = OTTAWA_18026_LINES[12].minimumDimensions;
  ok("最小尺寸：38×23×24 → 相符", matchDimensions({ required: min, offered: "38 x 23 x 24", mode: "minimum" }).verdict === "MATCH");
  const small = matchDimensions({ required: min, offered: "37 x 23 x 24", mode: "minimum" });
  ok("最小尺寸：37×23×24 → 不符，指出第 1 维", small.verdict === "MISMATCH" && small.reasonZh.includes("第 1 维"));
}
{
  ok("产品尺寸为空 → 无法判断", matchDimensions({ required: "36 x 38", offered: "" }).verdict === "UNKNOWN");
  ok("产品尺寸 standard size → 无法判断", matchDimensions({ required: "36 x 38", offered: "standard size" }).verdict === "UNKNOWN");
  ok("招标尺寸缺失 → 无法判断", matchDimensions({ required: null, offered: "36 x 38" }).verdict === "UNKNOWN");
  ok("维数不同 → 无法判断", matchDimensions({ required: "39 x 77.5 x 9", offered: "39 x 77.5" }).verdict === "UNKNOWN");
  ok("产品给区间 → 无法判断", matchDimensions({ required: "36 x 38", offered: "36 x 37-39" }).verdict === "UNKNOWN");
  ok("无法判断不等于相符", matchDimensions({ required: "36 x 38", offered: "n/a" }).verdict !== "MATCH");
}
{
  const p = parseDimensions('39" × 77.5 in x 9-15');
  ok("解析：带英寸符号与 × 号", !!p && p.length === 3 && p[2].kind === "range");
  ok("解析：区间下限大于上限 → 失败", parseDimensions("15-9") === null);
  const withDims = OTTAWA_18026_LINES.filter((l) => l.dimensions || l.minimumDimensions);
  ok("渥太华 17 个带尺寸的行都能解析（第 12 行无尺寸）", withDims.length === 17 && withDims.every((l) => parseDimensions(l.dimensions ?? l.minimumDimensions) !== null));
}

console.log(`\ntender-price-schedule dimension-match: ${passed} passed`);
