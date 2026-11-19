/**
 * CHAIN-0c — 招投标 Job 停下时的原因与收尾接线（纯函数 + 源码断言）
 * 运行：npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { tenderJobStopMessageZh, tenderJobStopReason, type TenderStopStep } from "../job-failure-surfacing";
import { tenderFailureSummary } from "@/lib/tender-auto-analysis/alerts";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

const s = (title: string, status: string, errorCode: string | null = null, errorMessage: string | null = null): TenderStopStep => ({ title, status, errorCode, errorMessage });
const base = [s("校验输入", "completed"), s("解析投标文件", "completed")];

console.log("job-failure-surfacing");

// ── 原因 ──
{
  const empty = tenderJobStopMessageZh({
    steps: [...base, s("Canonical V2 包级分析", "failed", "tool_failed", "ANALYSIS_EMPTY: 本次分析零成功模型调用且零抽取产出（12/12 次调用失败），拒绝写入空结果")],
    jobStatus: "failed", jobErrorCode: "model_failed", jobErrorMessage: null,
  });
  ok(empty === "卡在第 3 步〈Canonical V2 包级分析〉：模型调用全部失败，未产出有效分析", "已知标记 ANALYSIS_EMPTY → 固定中文", empty);
  ok(!empty.includes("ANALYSIS_EMPTY") && !empty.includes("12/12"), "不复述原始错误文本");

  const limited = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "tool_failed", "OpenAI error status 429: Rate limit reached")], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: null });
  ok(limited.endsWith("：模型调用被限流"), "429 / rate limit → 模型调用被限流", limited);
  const timeout = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "tool_failed", "request timed out after 180000ms")], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: null });
  ok(timeout.endsWith("：单次调用超时"), "timed out → 单次调用超时", timeout);

  const page429 = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "tool_failed", "第 429 页解析失败；Transaction already closed: timeout expired")], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: null });
  ok(page429.endsWith("：工具执行失败"), "「第 429 页」「Transaction … timeout」不误认为限流 / 超时", page429);
  const jobLevel = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "tool_failed", "boom")], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: "ANALYSIS_EMPTY: 来自 Job 层" });
  ok(jobLevel.endsWith("：工具执行失败"), "只认停住那一步自己的错误文本，不认 Job 层的", jobLevel);
  const allDone = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "completed")], jobStatus: "needs_human", jobErrorCode: "verification_failed", jobErrorMessage: null });
  ok(allDone === "卡在第 3 步〈Canonical V2 包级分析〉：结果没有通过校验", "每一步都完成（验证器最后判 needs_human）→ 算在最后一步、原因取 Job 错误码", allDone);
  const stack = "TypeError: Cannot read properties of undefined (reading 'x')\n    at analyze (/var/task/.next/server/chunks/123.js:1:2)";
  const unknown = tenderJobStopMessageZh({ steps: [s("校验输入", "completed"), s("解析投标文件", "failed", "weird_code", stack)], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: stack });
  ok(unknown === "卡在第 2 步〈解析投标文件〉：执行出错", "不认识的错误 → 执行出错", unknown);
  ok(!unknown.includes("TypeError") && !unknown.includes("/var/task"), "不含堆栈里的任何一行");

  ok(tenderJobStopMessageZh({ steps: [], jobStatus: "failed", jobErrorCode: "db_error", jobErrorMessage: "workforce_job 缺少 goal，无法规划" }) === "系统未记录原因", "没有步骤（规划阶段就失败）→ 系统未记录原因");

  const parked = tenderJobStopReason({ steps: [...base, s("Canonical V2 包级分析", "running")], jobStatus: "needs_human", jobErrorCode: null, jobErrorMessage: null });
  ok(parked?.stepIndex === 3 && parked.reasonZh === "需要人工处理", "停在需要人工处理、没有失败步骤 → 第一个没完成的那步 + 需要人工处理", parked);

  const exhausted = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "step_attempts_exhausted", "boom")], jobStatus: "failed", jobErrorCode: "model_failed", jobErrorMessage: null });
  ok(exhausted.endsWith("：重试次数用尽"), "按错误码查表", exhausted);
}

// ── 失败通知摘要 ──
{
  const withStop = tenderFailureSummary({ projectName: "12-01 21C31-254242", errorCode: "tool_failed", attemptCount: 0, stopReason: "卡在第 3 步〈Canonical V2 包级分析〉：模型调用全部失败，未产出有效分析" });
  ok(withStop === "「12-01 21C31-254242」的 AI 分析已停止：卡在第 3 步〈Canonical V2 包级分析〉：模型调用全部失败，未产出有效分析。可在项目里重新发起分析。", "摘要写明卡在哪一步与重新发起", withStop);
  const legacy = tenderFailureSummary({ projectName: "P", errorCode: "empty_analysis", attemptCount: 2, stopReason: "Some legacy message" });
  ok(legacy === "「P」的 AI 分析已停止：模型调用全部失败，未产出有效分析（已尝试 2 次）。可在项目里重新发起分析。", "不是「卡在第」开头的（legacy）摘要照旧", legacy);
  ok(tenderFailureSummary({ projectName: "P", errorCode: "needs_human", attemptCount: 0 }).includes("分析卡住，需要处理"), "Job 错误码有白话原因");
}

// ── 源码断言 ──
{
  const root = process.cwd();
  const read = (f: string) => readFileSync(path.join(root, f), "utf8");
  const proc = read("src/lib/workforce-runtime/processor.ts");
  ok(/result = await runClaimedSlice\(\);\s*\} finally \{\s*heartbeat\.stop\(\);\s*\}[\s\S]{0,300}await onWorkforceJobStopped\(\{ runId \}\);\s*return result;/.test(proc), "处理器：认领处理完（心跳停止之后）都交给钩子判断，返回值不变");
  ok(/status: true, metadata: true[\s\S]{0,200}run\.status !== "failed" && run\.status !== "needs_human"/.test(read("src/lib/workforce-runtime/domain-hooks.ts")), "钩子按库里的 Job 状态判断（不信内存里的 result）");
  ok(/eventType: "job\.failed",\s*title: "Workforce Job 失败（超时且重试耗尽）"[\s\S]{0,200}await onWorkforceJobStopped\(\{ runId: r\.id \}\);/.test(proc), "处理器：清扫写成 failed 后也调用钩子");
  const hook = read("src/lib/workforce-runtime/domain-hooks.ts");
  ok(/try \{[\s\S]*\} catch \(err\) \{[\s\S]*console\.warn/.test(hook) && !/throw /.test(hook), "钩子整体 try/catch，只记日志不抛");
  ok(/meta\.workDomain === "tender"/.test(hook) && /await import\("@\/lib\/tender-workforce\/job-failure-surfacing"\)/.test(hook), "钩子只对招投标 Job 动态加载收尾模块");
  const mod = read("src/lib/tender-workforce/job-failure-surfacing.ts");
  for (const [f, src] of [["domain-hooks.ts", hook], ["job-failure-surfacing.ts", mod]] as const) {
    ok(!/process\.env/.test(src), `${f} 不读任何开关 / 环境变量`);
  }
  ok(/failWorkforceTenderAnalysisRun\(/.test(mod) && /if \(!updated\) return/.test(mod), "收尾走既有 failWorkforceTenderAnalysisRun，只有改到了才写审计");
  const card = read("src/components/tender-analysis/agent-card.tsx");
  ok(/run\?\.status === "AGENT_FAILED" && run\.failureReason/.test(card), "项目卡片：分析未完成且有原因时显示原因（取消的不显示）");
  ok(/job\.needsYou\?\.detail && !run\?\.failureReason/.test(card), "项目卡片：有原因时不再另外显示需要你处理的说明（只一句）");
  ok(/重新分析/.test(card), "项目卡片：按钮仍是「重新分析」");
  const svc = read("src/lib/tender-workforce/trigger-service.ts");
  ok(/latestRun\.errorCode !== "cancelled"/.test(svc), "项目卡片接口：用户主动取消的不给原因");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
