/**
 * B2 — 审批 CAS 结构级静态断言 + 纯函数矩阵（不触 DB）。
 * 运行：npx tsx src/lib/pending-actions/__tests__/b2-approval-cas-static.test.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { duplicateExecuteResult, B2_DUPLICATE_ERROR_CODES } from "../executor";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const root = process.cwd();
const executor = readFileSync(join(root, "src/lib/pending-actions/executor.ts"), "utf8");
const port = readFileSync(join(root, "src/lib/approval/port.ts"), "utf8");
const pendingLink = readFileSync(join(root, "src/lib/agent-runtime/pending-link.ts"), "utf8");

// ── 执行器：CAS 结构 ────────────────────────────────────────────
ok(!/status !== "pending" && action.status !== "approved"/.test(executor), "approved 不再是可执行输入（崩溃窗口重放通道已关闭）");
ok(/updateMany\(\{\s*\n?\s*where: \{ id: actionId, status: "pending", expiresAt: \{ gt: new Date\(\) \} \}/.test(executor), "执行 claim 是带 status+expiresAt 谓词的原子 updateMany CAS");
ok(/claimed\.count !== 1/.test(executor), "CAS count!==1 → 失败方分支存在");
ok(/where: \{ id: actionId, status: "approved" \}/.test(executor), "终态写（executed/failed）带 approved 谓词（只有 claim 赢家可终态化）");
ok((executor.match(/where: \{ id: actionId, status: "pending" \}/g) ?? []).length >= 3, "过期/拒绝路径同为条件写（pending 谓词）");
ok(!/db\.pendingAction\.update\(\s*\{\s*where: \{ id: actionId \}/.test(executor), "executor 不再有无谓词的 pendingAction.update({where:{id}})（read-then-write 消除）");

// ── 拒绝路径 CAS ────────────────────────────────────────────────
ok(/\$transaction\(async \(tx\) => \{/.test(executor), "quote-promotion 拒绝走交互事务（CAS 失败回滚镜像写）");
ok(/正在执行中，不能取消/.test(executor), "approved（执行中）不可取消（副作用不可撤回）");

// ── pending-link（run 取消批量拒绝）───────────────────────────────
ok(/updateMany\(\{\s*\n?\s*where: \{ id: a\.id, status: "pending" \}/.test(pendingLink), "run 取消批量拒绝为条件写——不得把执行中/终态行改写为 rejected");
ok(/res\.count === 1/.test(pendingLink), "批量拒绝按实际赢得的行计数");

// ── Port：失败方确定性响应，不 resume ─────────────────────────────
ok((port.match(/B2_DUPLICATE_ERROR_CODES\.inProgress/g) ?? []).length >= 2, "port approve+reject 均处理 EXECUTION_IN_PROGRESS（返回 duplicate，不 resume）");
ok((port.match(/duplicate: true/g) ?? []).length >= 6, "port 竞态分支返回 duplicate:true 确定性响应");
{
  const approveIdx = port.indexOf("const result = await executePendingAction");
  const supervisorIdx = port.indexOf("loadSupervisorState", approveIdx);
  const dupIdx = port.indexOf("B2_DUPLICATE_ERROR_CODES.inProgress", approveIdx);
  ok(dupIdx > approveIdx && dupIdx < supervisorIdx, "approve 竞态分支位于 resume（Supervisor/V2）之前——失败方绝不触发 resume");
}

// ── 调用面未扩大 ─────────────────────────────────────────────────
{
  const files = ["src/lib/approval/port.ts"]; // 唯一真实调用方
  ok(files.every((f) => readFileSync(join(root, f), "utf8").includes("executePendingAction")), "port 仍是 executePendingAction 的调用方");
}

// ── duplicateExecuteResult 纯函数矩阵（终态语义 15-18）────────────
{
  const executed = duplicateExecuteResult({ status: "executed", resultRef: "ref-1" });
  ok(executed.ok === true && executed.resultRef === "ref-1" && executed.errorCode === B2_DUPLICATE_ERROR_CODES.alreadyExecuted, "矩阵15/Case A：executed → 返回既有结果（resultRef），绝不再执行");
  const inProgress = duplicateExecuteResult({ status: "approved" });
  ok(inProgress.ok === false && inProgress.errorCode === B2_DUPLICATE_ERROR_CODES.inProgress, "Case B：approved（执行中）→ 稳定 IN_PROGRESS，不执行");
  const rejected = duplicateExecuteResult({ status: "rejected" });
  ok(rejected.ok === false && rejected.errorCode === B2_DUPLICATE_ERROR_CODES.alreadyRejected, "矩阵16/Case D：rejected → 永不执行");
  const failed = duplicateExecuteResult({ status: "failed", failureReason: "已过期" });
  ok(failed.ok === false && failed.errorCode === B2_DUPLICATE_ERROR_CODES.alreadyFailed && (failed.error ?? "").includes("已过期"), "矩阵17/18/Case C：failed → 不自动重试，保留原因（expired 以 failed+已过期承载）");
}

console.log("");
console.log(`B2 审批 CAS 静态断言 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
