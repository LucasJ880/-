/**
 * FIX-6 阶段已到、招投标状态落后时补状态 — 纯逻辑与接线测试
 * 运行：npx tsx src/lib/tender/__tests__/stage-status-catch-up.test.ts
 * 真实数据库里的行为另见 stage-status-catch-up-db.isolated.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

async function main() {
  const { tenderStatusLagsBehind } = await import("../stage-status-catch-up");
  const { tenderStatusStageOf } = await import("../stage");

  console.log("怎样算落后");
  {
    const lag = (s: string | null) => tenderStatusLagsBehind(s, "supplier_quote", "supplier_quote");
    ok("目标是供应商报价：为空、跟进中、供应商询价算落后", lag(null) && lag("") && lag("pursuing") && lag("supplier_inquiry") && lag("under_review") && lag("new"));
    ok("与目标相同、更靠后（投标准备、已提交）不算", !lag("supplier_quote") && !lag("bid_preparation") && !lag("bid_submitted"));
    ok("已是结果不算（已中标、未中标、不投标、已放弃投标、已取消，大小写不论）", ["won", "lost", "no_bid", "passed", "cancelled", "LOST", "archived"].every((s) => !lag(s)));
    ok("认不出的状态不算（不覆盖人填的值）", !lag("something_custom") && !lag("toString") && !lag("constructor"));
    ok("目标阶段没有对应状态：不算", !tenderStatusLagsBehind("new", "initiation", undefined));
    ok("目标是项目解读：为空、新建、审核中算落后；跟进中不算", tenderStatusLagsBehind(null, "interpretation", "pursuing") && tenderStatusLagsBehind("under_review", "interpretation", "pursuing") && !tenderStatusLagsBehind("pursuing", "interpretation", "pursuing") && !tenderStatusLagsBehind("supplier_inquiry", "interpretation", "pursuing"));
    ok("目标是项目提交：投标准备与已提交不算（同一段）", !tenderStatusLagsBehind("bid_preparation", "submission", "bid_submitted") && tenderStatusLagsBehind("supplier_quote", "submission", "bid_submitted"));
    ok("状态 → 阶段：为空是立项，认不出是没有", tenderStatusStageOf(null) === "initiation" && tenderStatusStageOf("supplier_quote") === "supplier_quote" && tenderStatusStageOf("nope") === null && tenderStatusStageOf("toString") === null);
  }

  console.log("接线");
  {
    const code = strip(readFileSync(join(process.cwd(), "src/lib/tender/stage-transition.ts"), "utf8"));
    const main = code.slice(code.indexOf("export async function advanceProjectStage("), code.indexOf("async function catchUpLaggingTenderStatus("));
    const fn = code.slice(code.indexOf("async function catchUpLaggingTenderStatus("));
    ok("两处「无需重复推进」之前都先试补状态，补成了就返回", (main.match(/const caught = await catchUpLaggingTenderStatus\(\{ project, targetStage, input \}\);\s*if \(caught\) return caught;/g) ?? []).length === 2);
    ok("第一处在「已在目标阶段」的分支里", /if \(validation\.decision === "no_op"\) \{\s*const caught = await catchUpLaggingTenderStatus/.test(main));
    ok("第二处在「这一段时间已有值」的分支里", /project\[timestampField as keyof typeof project\] != null\s*\) \{\s*const caught = await catchUpLaggingTenderStatus/.test(main));
    ok("只在人确认、项目是进行中、状态落后时补", fn.includes('if (humanConfirmed !== true || project.status !== "active") return null;') && fn.includes("if (!newTenderStatus || !tenderStatusLagsBehind(project.tenderStatus, targetStage, newTenderStatus)) return null;"));
    ok("条件写入：读到的状态与进行中；只改招投标状态；没写成就不补", /where: \{ id: projectId, status: "active", tenderStatus: project\.tenderStatus \},\s*data: \{ tenderStatus: newTenderStatus \},/.test(fn) && fn.includes("if (claimed.count === 0) return null;") && fn.includes("if (!updated) return null;"));
    ok("写讨论区的状态变化、审计（标明补状态与人确认），有来源系统才发回调", fn.includes("await emitProjectPatchEvents(") && fn.includes("statusCatchUp: true,") && fn.includes("humanConfirmed,") && /if \(project\.sourceSystem\) \{\s*notifyProjectStatusChange\(\{/.test(fn));
    ok("不写阶段时间、不碰任务、不发「已推进」的成员通知、不写「推进到某某」的讨论区消息", !/onStageAdvancedTasks|notifyProjectMembers|onStageAdvanced\(|timestampField|occurredAt/.test(fn) && (fn.match(/updateMany\(/g) ?? []).length === 1);
    ok("不调模型、不发别的请求", !/createCompletion|openai|anthropic|fetch\(/i.test(fn));
  }

  console.log(`\n✓ stage-status-catch-up: ${passed} 项断言全部通过`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
