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

// ── FIX-20：原因顺序 具体码 → 已知标记（余额不足排第一）→ 笼统码 → 执行出错 ──
{
  const QUOTA_ZH = "AI 账户余额不足，请联系平台管理员充值";
  const six = [...base, s("Canonical V2 包级分析", "completed"), s("证据与合规覆盖", "completed"), s("风险分析", "completed"), s("澄清问题草稿", "completed"), s("Grounded 交付物物化", "completed")];
  const t8quota = tenderJobStopMessageZh({
    steps: [...six, s("Workforce 执行汇总", "failed", "model_quota_exhausted", "SYNTHESIS_MODEL_FAILED: 429 You exceeded your current quota"), s("Canonical V2 状态终态化", "pending")],
    jobStatus: "needs_human", jobErrorCode: "blocked_graph", jobErrorMessage: "步骤依赖无法推进",
  });
  ok(t8quota === `卡在第 8 步〈Workforce 执行汇总〉：${QUOTA_ZH}`, "第 8 步余额不足（步骤码 model_quota_exhausted、Job 码 blocked_graph）→ 余额不足", t8quota);
  ok(!t8quota.includes("前置步骤没有完成") && !t8quota.includes("quota"), "不写「前置步骤没有完成」，不含 quota");
  const text429 = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "tool_failed", "HTTP 429 insufficient_quota")], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: null });
  ok(text429.endsWith(`：${QUOTA_ZH}`), "笼统码 tool_failed、文本「HTTP 429 insufficient_quota」→ 余额不足（排在限流之前）", text429);
  const sdk = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "tool_failed", "TOOL_FAILED: 429 You exceeded your current quota, please check your plan and billing details")], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: null });
  ok(sdk.endsWith(`：${QUOTA_ZH}`), "SDK 拼出的「429 You exceeded your current quota…」也认得（旧数据没有新码时）", sdk);
  const specificFirst = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "stale_running_exhausted", "request timed out after 180000ms")], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: null });
  ok(specificFirst.endsWith("：长时间没有进展"), "具体原因码优先于已知标记（不写「单次调用超时」）", specificFirst);
  const budget = tenderJobStopMessageZh({ steps: [...base, s("Canonical V2 包级分析", "failed", "org_ai_budget_exhausted", "配额限制：月 AI 费用已达 hard limit")], jobStatus: "failed", jobErrorCode: null, jobErrorMessage: null });
  ok(budget.endsWith("：本组织本月 AI 费用已达上限，请组织管理员调高月度上限"), "具体原因码 org_ai_budget_exhausted", budget);
  const generic = tenderJobStopMessageZh({ steps: [...six, s("Workforce 执行汇总", "failed", "synthesis_failed", "SYNTHESIS_INVALID_OUTPUT: 模型未返回 JSON 结构化综合结果")], jobStatus: "needs_human", jobErrorCode: "blocked_graph", jobErrorMessage: null });
  ok(generic === "卡在第 8 步〈Workforce 执行汇总〉：综合汇总生成失败", "笼统码 synthesis_failed 不回落 Job 的 blocked_graph", generic);
  const leftover = tenderJobStopMessageZh({ steps: [...six, s("Workforce 执行汇总", "completed"), s("Canonical V2 状态终态化", "completed", "model_quota_exhausted", "429 You exceeded your current quota")], jobStatus: "needs_human", jobErrorCode: "verification_failed", jobErrorMessage: null });
  ok(leftover === "卡在第 9 步〈Canonical V2 状态终态化〉：结果没有通过校验", "已完成步骤上的旧错误码与旧原文不算数 → 结果没有通过校验", leftover);
  const contract = tenderJobStopMessageZh({ steps: [...six, s("Workforce 执行汇总", "failed", "HANDOFF_VERSION_UNSUPPORTED", "t5_risk_analysis: 不支持的 handoff contractVersion: x")], jobStatus: "needs_human", jobErrorCode: "HANDOFF_VERSION_UNSUPPORTED", jobErrorMessage: null });
  ok(contract === "卡在第 8 步〈Workforce 执行汇总〉：执行出错", "契约损坏（码不在表里）→ 执行出错（不再是「需要人工处理」）", contract);
  const recovered = tenderJobStopReason({ steps: [...base, s("Canonical V2 包级分析", "ready", "stale_running_recovered", null)], jobStatus: "needs_human", jobErrorCode: "INITIATOR_MISSING", jobErrorMessage: null });
  ok(recovered?.stepIndex === 3 && recovered.reasonZh === "需要人工处理", "停在待开始的步骤（留着回收码）→ 只按 Job 的码，不写「上一次执行时间过长被中断」", recovered);
  const mod = readFileSync(path.join(process.cwd(), "src/lib/tender-workforce/job-failure-surfacing.ts"), "utf8");
  ok(/import \{ isModelQuotaExhaustedText[^}]*\} from "@\/lib\/workforce-runtime\/constants"/.test(mod), "余额不足的识别从 workforce-runtime/constants 取同一份规则");
  ok(/const failedStepCode = steps\.find\(\(s\) => s\.status === "failed"\)\?\.errorCode;\s*const errorCode = failedStepCode \|\| job\.errorCode \|\|/.test(mod), "写进分析记录的错误码取第一个失败步骤的，没有才取 Job 的");
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
