/**
 * FIX-10 调查室 summaryJson 写入：纯函数与接线（无 DB，CI 里跑）
 *   npx tsx src/lib/tender-room/__tests__/summary-json.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyRoomSummaryPatch, asJsonRec } from "../summary-json";
import { projectionPatch, PROJECTED_KEYS_KEY } from "@/lib/tender-auto-analysis/project-room";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : ""); }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

console.log("FIX-10 room summaryJson — pure + wiring");

/* ---------- applyRoomSummaryPatch ---------- */
const latest = { pricingInputs: { ourPriceCad: 1 }, bidWorkspace: { v: 1 }, a: 1, b: 2 };
const n1 = applyRoomSummaryPatch(latest, { set: { a: 10, c: 3 } });
ok(n1.a === 10 && n1.c === 3 && n1.b === 2 && JSON.stringify(n1.pricingInputs) === JSON.stringify({ ourPriceCad: 1 }) && JSON.stringify(n1.bidWorkspace) === JSON.stringify({ v: 1 }), "set：只覆盖给出的键，其余原样保留", n1);
const n2 = applyRoomSummaryPatch(latest, { unset: ["b", "missing"], set: { d: undefined } });
ok(!("b" in n2) && !("d" in n2) && n2.a === 1 && "pricingInputs" in n2, "unset 与值为 undefined 的 set：去掉这些键；不存在的键不报错", n2);
const n3 = applyRoomSummaryPatch(latest, { unset: ["a"], set: { a: 5 } });
ok(n3.a === 5, "同一个键既去掉又设：以设为准（先去掉、再设）", n3);
ok(JSON.stringify(latest) === JSON.stringify({ pricingInputs: { ourPriceCad: 1 }, bidWorkspace: { v: 1 }, a: 1, b: 2 }), "不改入参");
ok(JSON.stringify(applyRoomSummaryPatch(latest, {})) === JSON.stringify(latest), "空 patch：与原值相同");
ok(JSON.stringify(asJsonRec(null)) === "{}" && JSON.stringify(asJsonRec([1])) === "{}" && JSON.stringify(asJsonRec("x")) === "{}", "asJsonRec：不是对象时当空对象");

/* ---------- projectionPatch ---------- */
const room0 = { pricingInputs: { ourPriceCad: 9 }, tenderWatch: { on: true } };
const p1 = projectionPatch(room0, { projectName: "A", oldKey: 1 }, "run1");
const r1 = applyRoomSummaryPatch(room0, p1);
ok(r1.projectName === "A" && r1.oldKey === 1 && r1.projectedFromRunId === "run1" && JSON.stringify(r1[PROJECTED_KEYS_KEY]) === JSON.stringify(["projectName", "oldKey"]), "第一次投影：设分析的键、来源、记下写了哪些键", r1);
ok("pricingInputs" in r1 && "tenderWatch" in r1 && (p1.unset ?? []).length === 0, "第一次投影：别的功能的键不碰，不去掉任何键", p1);
const p2 = projectionPatch(r1, { projectName: "B" }, "run2");
const r2 = applyRoomSummaryPatch(r1, p2);
ok(r2.projectName === "B" && !("oldKey" in r2) && r2.projectedFromRunId === "run2" && JSON.stringify(r2[PROJECTED_KEYS_KEY]) === JSON.stringify(["projectName"]), "再投影：上一次投影写过、这一次没有的键去掉", r2);
ok(JSON.stringify(r2.pricingInputs) === JSON.stringify({ ourPriceCad: 9 }) && JSON.stringify(r2.tenderWatch) === JSON.stringify({ on: true }), "再投影：别的功能的键原样保留", r2);
const legacy = { projectName: "Old", projectedFromRunId: "run0", bidWorkspace: { v: 1 } };
const r3 = applyRoomSummaryPatch(legacy, projectionPatch(legacy, { projectName: "New" }, "run3"));
ok(r3.projectName === "New" && "bidWorkspace" in r3 && r3.projectedFromRunId === "run3", "改动前投影过的房间（没有记录写过哪些键）：只覆盖、不去掉任何键", r3);
const p4 = projectionPatch({ [PROJECTED_KEYS_KEY]: ["projectedFromRunId", "x"] }, { projectedFromRunId: "fake", [PROJECTED_KEYS_KEY]: ["y"], x: 1 }, "run4");
ok(p4.set?.projectedFromRunId === "run4" && JSON.stringify(p4.set?.[PROJECTED_KEYS_KEY]) === JSON.stringify(["x"]) && (p4.unset ?? []).length === 0, "分析摘要里带了投影自己的元数据键：以投影为准，不被摘要盖掉", p4);
const p5 = projectionPatch({ [PROJECTED_KEYS_KEY]: "not-an-array" }, { a: 1 }, "run5");
ok((p5.unset ?? []).length === 0, "记录损坏（不是数组）：当作没有记录", p5);

/* ---------- 接线 ---------- */
const projectRoom = read("src/lib/tender-auto-analysis/project-room.ts");
ok(projectRoom.includes("await patchRoomSummary({") && !/bidIntelligenceRoom\.update\(\{[\s\S]{0,200}summaryJson/.test(projectRoom), "分析投影经 patchRoomSummary 写，不再直接整块写 summaryJson");
const start = read("src/lib/bid-workflow/start-intelligence.ts");
const updateBlocks = start.match(/bidIntelligenceRoom\.update\(\{[\s\S]{0,300}?\}\);/g) ?? [];
ok(start.includes("await patchRoomSummaryTx(tx, {") && updateBlocks.every((b) => !b.includes("summaryJson")), "开始调查：已有房间时经 patchRoomSummaryTx 写，不再整块换掉", updateBlocks);
const helper = read("src/lib/tender-room/summary-json.ts");
ok(/await lockProject\(tx, input\.projectId\);[\s\S]*findUnique/.test(helper), "写入入口：先锁项目行，再读房间");

console.log(`\nFIX-10 room summaryJson pure: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
