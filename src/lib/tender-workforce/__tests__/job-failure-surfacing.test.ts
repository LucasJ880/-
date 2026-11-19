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

  const limited = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "tool_failed", "OpenAI error 429: Rate limit reached")], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: null });
  ok(limited.endsWith("：模型调用被限流"), "429 / rate limit → 模型调用被限流", limited);
  const timeout = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "tool_failed", "request timed out after 180000ms")], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: null });
  ok(timeout.endsWith("：单次调用超时"), "timed out → 单次调用超时", timeout);

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
  ok(/const result = await runClaimedSlice\(\);[\s\S]{0,400}result\.claimed && !result\.lostLease && \(result\.status === "failed" \|\| result\.status === "needs_human"\)[\s\S]{0,120}await onWorkforceJobStopped\(\{ runId \}\);[\s\S]{0,20}return result;/.test(proc), "处理器：只在确实停在 failed / needs_human 且未丢租约时调用钩子，返回值不变");
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
  ok(/run\?\.status === "AGENT_FAILED"/.test(card) && /run\.failureReason \?\? "系统未记录原因"/.test(card), "项目卡片：分析未完成时显示原因，没有就写「系统未记录原因」");
  ok(/重新分析/.test(card), "项目卡片：按钮仍是「重新分析」");
  const svc = read("src/lib/tender-workforce/trigger-service.ts");
  ok(/latestRun\.errorCode !== "cancelled"/.test(svc), "项目卡片接口：用户主动取消的不给原因");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
