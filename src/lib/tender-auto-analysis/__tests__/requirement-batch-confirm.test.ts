/**
 * RFQ-AUTO-4 招标要求审核的批量确认 — 纯逻辑测试 + 面板源码断言
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BATCH_CONFIRM_LIMIT, approveHintZh, batchConfirmResultZh, canBatchConfirm, chunkRequirementIds, countRequirementReview,
  pendingRequirementIds, pruneSelection, reviewCountsLineZh, toggleSelection,
} from "../requirement-batch-confirm";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

const reqs = [
  { id: "r1", reviewStatus: "AI_EXTRACTED" },
  { id: "r2", reviewStatus: "CONFIRMED" },
  { id: "r3", reviewStatus: "AI_EXTRACTED" },
  { id: "r4", reviewStatus: "REJECTED" },
  { id: "r5", reviewStatus: "AI_EXTRACTED" },
];

console.log("什么时候出现");
ok("只在分析等待审核时出现；已批准、失败、被取代、没有状态都不出现", canBatchConfirm("REVIEW_REQUIRED") && ["APPROVED", "FAILED", "SUPERSEDED", "PENDING", "ANALYZING", "", null, undefined].every((s) => !canBatchConfirm(s)));

console.log("计数");
{
  const c = countRequirementReview(reqs);
  ok("已确认 1、待确认 3、已驳回 1、共 5", c.confirmed === 1 && c.pending === 3 && c.rejected === 1 && c.total === 5);
  ok("计数行的文字", reviewCountsLineZh(c) === "已确认 1 条 · 待确认 3 条 · 已驳回 1 条");
  ok("没有要求时全是 0；不认识的状态只计入总数", countRequirementReview([]).total === 0 && JSON.stringify(countRequirementReview([{ reviewStatus: "SOMETHING_NEW" }])) === JSON.stringify({ confirmed: 0, pending: 0, rejected: 0, total: 1 }));
}

console.log("选择");
ok("全选待确认的：只有那 3 条待确认的，已确认与已驳回的不在其中", pendingRequirementIds(reqs).join() === "r1,r3,r5");
ok("勾选一条待确认的：加入；再点一次：去掉", toggleSelection([], "r3", reqs).join() === "r3" && toggleSelection(["r1", "r3"], "r3", reqs).join() === "r1");
ok("已确认、已驳回、不存在的要求选不上", toggleSelection([], "r2", reqs).length === 0 && toggleSelection([], "r4", reqs).length === 0 && toggleSelection(["r1"], "ghost", reqs).join() === "r1");
ok("不改传入的数组", (() => { const s = ["r1"]; toggleSelection(s, "r3", reqs); toggleSelection(s, "r1", reqs); return s.join() === "r1"; })());
ok("列表刷新后：选中的里面只留仍然待确认的（别人刚处理掉的自动去掉），并去重", pruneSelection(["r1", "r2", "r4", "r5", "r5", "ghost"], reqs).join() === "r1,r5");
ok("这个模块里没有「默认选中」之类的函数：初始选中由调用方给空数组", !/default.*select|preselect|selectAllByDefault/i.test(readFileSync(resolve(__dirname, "../requirement-batch-confirm.ts"), "utf8")));

console.log("分批");
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);
ok("接口上限是 200 条", BATCH_CONFIRM_LIMIT === 200);
ok("0 条 → 不提交", chunkRequirementIds([]).length === 0);
ok("1 条、200 条 → 一批", chunkRequirementIds(ids(1)).length === 1 && chunkRequirementIds(ids(200)).length === 1 && chunkRequirementIds(ids(200))[0].length === 200);
ok("201 条 → 200 + 1", chunkRequirementIds(ids(201)).map((c) => c.length).join() === "200,1");
ok("450 条 → 200 + 200 + 50，顺序不变、一条不丢", (() => { const c = chunkRequirementIds(ids(450)); return c.map((x) => x.length).join() === "200,200,50" && c.flat().join() === ids(450).join(); })());
ok("重复的与空的要求号先去掉再分批", chunkRequirementIds(["a", "a", "", "b"]).flat().join() === "a,b");
ok("批大小不合规时用接口上限", chunkRequirementIds(ids(450), 0).map((c) => c.length).join() === "200,200,50" && chunkRequirementIds(ids(450), 2.5).length === 3);

console.log("结果与提示");
ok("全部确认：只说确认了几条", batchConfirmResultZh({ selected: 3, confirmed: 3 }) === "已确认 3 条。");
ok("实际确认数少于选中数：如实说，并说明原因", (() => { const m = batchConfirmResultZh({ selected: 3, confirmed: 2 }); return m.startsWith("已确认 2 条") && m.includes("选了 3 条") && m.includes("其中 1 条") && !m.startsWith("已确认 3 条"); })());
ok("中途失败：说明出错，并说清此前已确认了几条", (() => { const m = batchConfirmResultZh({ selected: 450, confirmed: 200, error: "网络出错" }); return m.includes("网络出错") && m.includes("此前已确认 200 条") && m.includes("其余没有确认"); })());
ok("第一批就失败：没有「此前已确认」", batchConfirmResultZh({ selected: 5, confirmed: 0, error: "没有权限" }) === "没有确认成功：没有权限。");
ok("批准前的提示：还有待确认的才有，写明条数、批准后不能再确认、不会进询价单", approveHintZh(4) === "还有 4 条要求没有确认：批准后不能再确认，没确认的不会进询价单。");
ok("待确认为 0（或坏数据）时没有这句提示", approveHintZh(0) === null && approveHintZh(-1) === null && approveHintZh(Number.NaN) === null);

console.log("面板源码");
{
  const root = resolve(__dirname, "../../../..");
  const panel = readFileSync(resolve(root, "src/components/tender-analysis/analysis-panel.tsx"), "utf8");
  const code = panel.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const route = readFileSync(resolve(root, "src/app/api/projects/[id]/tender-analysis/runs/[runId]/requirements/batch-confirm/route.ts"), "utf8");
  ok("默认一条都不选", /const \[selectedReqIds, setSelectedReqIds\] = useState<string\[\]>\(\[\]\);/.test(code));
  ok("批量确认只调用既有的批量确认接口这一处", (code.match(/requirements\/batch-confirm/g) ?? []).length === 1 && /JSON\.stringify\(\{ requirementIds: chunk \}\)/.test(code));
  ok("按批依次提交，某一批失败就停", /for \(const chunk of chunkRequirementIds\(ids\)\) \{/.test(code) && /if \(!res\.ok\) \{\s*failure = [^;]+;\s*break;\s*\}/.test(code));
  ok("显示的是接口返回的实际确认数之和，不是选中数", /confirmed \+= typeof json\?\.confirmedCount === "number" \? json\.confirmedCount : 0;/.test(code) && /setBatchMessage\(batchConfirmResultZh\(\{ selected: ids\.length, confirmed, error: failure \}\)\);/.test(code));
  ok("提交完成后清空选中并刷新列表", /setBatchMessage\([^;]+;\s*setSelectedReqIds\(\[\]\);\s*await load\(\);/.test(code));
  ok("提交的只有仍然待确认的那些（提交前按当前列表再筛一遍），分析不是等待审核时直接不提交", /if \(!data \|\| !canBatchConfirm\(data\.run\.status\)\) return;\s*const ids = pruneSelection\(selectedReqIds, data\.requirements\);\s*if \(ids\.length === 0\) return;/.test(code));
  ok("全选、取消全选、确认选中三个按钮都只在「等待审核且还有待确认的」时渲染", /\{batchEnabled && reviewCounts\.pending > 0 \? \(/.test(code) && code.indexOf('data-testid="requirement-select-all"') > code.indexOf("{batchEnabled && reviewCounts.pending > 0 ? (") && /const batchEnabled = canBatchConfirm\(data\.run\.status\);/.test(code));
  ok("勾选框只给待确认的要求，且只在等待审核时渲染", /\{batchEnabled && r\.reviewStatus === "AI_EXTRACTED" \? \(\s*<input\s+type="checkbox"/.test(code));
  ok("没有选中时「确认选中」与「取消全选」不可用", (code.match(/disabled=\{busy \|\| selectedCount === 0\}/g) ?? []).length === 2);
  ok("「全选待确认的」选的是当前列表里待确认的那些", /onClick=\{\(\) => setSelectedReqIds\(pendingRequirementIds\(data\.requirements\)\)\}/.test(code));
  ok("没有「一键全部确认」：批准时仍然不顺手确认剩下的，面板里也没有不经勾选就确认全部的调用", /\{ confirmAllRequirements: false \}/.test(code) && !/confirmAllRequirements: true/.test(code));
  ok("没有批量驳回", !/batch-reject|批量驳回|rejectSelected/.test(code));
  ok("批准前的提示只在等待审核且还有待确认的要求时显示，并且不改变「批准分析」按钮的可用条件", /\{data\.run\.status === "REVIEW_REQUIRED" && approveHintZh\(reviewCounts\.pending\) \? \(/.test(code) && /disabled=\{busy\}\s*onClick=\{\(\) =>\s*void post\(\s*`\/api\/projects\/\$\{projectId\}\/tender-analysis\/runs\/\$\{data\.run\.id\}\/approve`/.test(code));
  ok("计数行总是显示（有要求时），用的是纯函数给的文字", /data-testid="requirement-review-counts">\{reviewCountsLineZh\(reviewCounts\)\}/.test(code));
  ok("接口：先鉴权、确认成功之后才写审计；审计用吞错的写法；响应结构没有多出字段", route.indexOf("requireTenderAnalysisWrite(") < route.indexOf("batchConfirmRequirements({") && route.indexOf("if (!result.ok)") < route.indexOf("await logAudit({") && !/writeAuditLog\(/.test(route) && /ok: true,\s*confirmedCount: result\.confirmedCount,\s*\.\.\.\(rfqAutoDraft \? \{ rfqAutoDraft \} : \{\}\),/.test(route));
}

console.log(`\n✓ requirement-batch-confirm: ${passed} 项断言全部通过`);
