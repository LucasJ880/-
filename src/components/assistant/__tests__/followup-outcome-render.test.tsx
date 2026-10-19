/**
 * QINGYAN_ASSISTANT_DURABLE_FOLLOWUP_M1 — 任务卡渲染（服务端静态渲染，无浏览器 / 无 DB）
 * 运行：npx tsx src/components/assistant/__tests__/followup-outcome-render.test.tsx
 *
 * 断言界面只渲染服务端投影：部分完成不显示"已完成"、逐项状态与回执可见、
 * 取消按钮只在服务端判定可取消时出现、旧 Run（无 followup）渲染不变。
 */

import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { projectFollowupOutcome } from "@/lib/assistant/followup-outcome";
import {
  FOLLOWUP_META,
  FOLLOWUP_STEP,
  FOLLOWUP_TASK_CONTRACT,
  FOLLOWUP_TOOL,
} from "@/lib/assistant/followup-contract";
import type { AssistantRunStatusDto } from "@/lib/assistant/run-status-types";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (!cond) console.error(`  ✗ ${name}`, detail ?? "");
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-10-16T14:00:00.000Z");
const meta = {
  [FOLLOWUP_META.contract]: FOLLOWUP_TASK_CONTRACT,
  [FOLLOWUP_META.topN]: 3,
  [FOLLOWUP_META.deliverables]: "analysis,email_drafts,reminders",
  [FOLLOWUP_META.reminderAt]: "2026-10-20T19:00:00.000Z",
  [FOLLOWUP_META.reminderTimezone]: "America/Toronto",
  [FOLLOWUP_META.unsupported]: "send_email",
  [FOLLOWUP_META.emailSendRequested]: true,
};

const steps = [
  { stepKey: FOLLOWUP_STEP.opportunities, preferredTool: FOLLOWUP_TOOL.opportunities, status: "completed", outputJson: { opportunities: [{}, {}, {}] }, errorMessage: null },
  { stepKey: FOLLOWUP_STEP.followupAnalysis, preferredTool: FOLLOWUP_TOOL.followupAnalysis, status: "completed", outputJson: { evidenceQuality: "FULL" }, errorMessage: null },
  { stepKey: FOLLOWUP_STEP.quoteRisk, preferredTool: FOLLOWUP_TOOL.quoteRisk, status: "completed", outputJson: { evidenceQuality: "FULL", result: { summary: "2 份报价超过 7 天未回复", issues: [{ title: "报价未回复", severity: "HIGH" }] } }, errorMessage: null },
  { stepKey: FOLLOWUP_STEP.prioritize, preferredTool: FOLLOWUP_TOOL.prioritize, status: "completed", outputJson: { prioritized: [{ customerId: "c1", customerName: "Alpha Homes", score: 61, reasons: ["跟进逾期 5 天(+22)"], evidenceRefs: ["s2:o1"], email: "a@x.test" }] }, errorMessage: null },
  { stepKey: FOLLOWUP_STEP.prepareActions, preferredTool: FOLLOWUP_TOOL.prepareActions, status: "failed", outputJson: { items: [
    { kind: "email_draft", customerId: "c1", customerName: "Alpha Homes", pendingActionId: "pa_e" },
    { kind: "reminder", customerId: "c1", customerName: "Alpha Homes", pendingActionId: "pa_r" },
  ] }, errorMessage: null },
];

function dto(over: Partial<AssistantRunStatusDto>): AssistantRunStatusDto {
  return {
    runId: "run_1",
    conversationId: "t1",
    organizationId: "o1",
    initiatedByPrincipalId: "u1",
    userMessageId: null,
    assistantMessageId: "m1",
    pendingActionIds: [],
    status: "completed",
    intent: "workforce_job",
    currentStep: null,
    errorCode: null,
    resultSummary: null,
    startedAt: null,
    updatedAt: NOW.toISOString(),
    completedAt: null,
    runtimeVersion: "v2",
    ...over,
  };
}

async function main() {
  // tsx 以经典 JSX 运行时编译测试与组件：先挂全局 React，再动态加载组件
  (globalThis as unknown as { React: typeof React }).React = React;
  const { RuntimeV2Workbench } = await import("@/components/assistant/runtime-v2-workbench");
  console.log("followup-outcome-render");

  const partial = projectFollowupOutcome({
    run: { id: "run_1", status: "needs_human", errorCode: null, errorMessage: null, metadata: meta },
    steps,
    pendingActions: [
      { id: "pa_e", type: "grader.email_draft", status: "failed", resultRef: null, failureReason: "Gmail 未连接", expiresAt: null },
      { id: "pa_r", type: "calendar.create_event", status: "executed", resultRef: "evt_123", failureReason: null, expiresAt: null },
    ],
    now: NOW,
  })!;
  const html = renderToStaticMarkup(
    <RuntimeV2Workbench
      run={dto({ status: "completed", partialCompletion: true, followup: partial, cancellable: false })}
      onCancel={() => undefined}
    />,
  );
  ok("部分完成：标题显示「部分完成」而不是「已完成」", html.includes(">部分完成<") && !html.includes(">已完成<"));
  ok("逐项状态：已建立提醒 + 回执 / 执行失败 + 原因", html.includes("已建立提醒") && html.includes("回执：evt_123") && html.includes("执行失败") && html.includes("Gmail 未连接"));
  ok("报价风险汇总可见", html.includes("2 份报价超过 7 天未回复") && html.includes("报价未回复"));
  ok("越界请求显式列出（不会发送）", html.includes("超出本轮边界，未执行") && html.includes("直接发送邮件"));
  ok("提醒时间按业务时区展示", html.includes("America/Toronto"));
  ok("不可取消时不显示取消按钮", !html.includes('data-testid="runtime-v2-cancel"'));

  const waiting = projectFollowupOutcome({
    run: { id: "run_1", status: "awaiting_approval", errorCode: null, errorMessage: null, metadata: meta },
    steps: steps.map((s) => (s.stepKey === FOLLOWUP_STEP.prepareActions ? { ...s, status: "awaiting_approval" } : s)),
    pendingActions: [
      { id: "pa_e", type: "grader.email_draft", status: "pending", resultRef: null, failureReason: null, expiresAt: "2026-10-20T00:00:00Z" },
      { id: "pa_r", type: "calendar.create_event", status: "approved", resultRef: null, failureReason: null, expiresAt: "2026-10-20T00:00:00Z" },
    ],
    now: NOW,
  })!;
  const html2 = renderToStaticMarkup(
    <RuntimeV2Workbench
      run={dto({ status: "waiting_for_confirmation", followup: waiting, cancellable: true })}
      onCancel={() => undefined}
    />,
  );
  ok("等待确认：预览待确认 / 已批准尚未执行 两态分开展示", html2.includes("已准备预览，等待你确认") && html2.includes("已批准，尚未执行完成"));
  ok("可取消时显示取消按钮", html2.includes('data-testid="runtime-v2-cancel"') && html2.includes("取消任务"));

  const legacy = renderToStaticMarkup(
    <RuntimeV2Workbench
      run={dto({ status: "completed", prioritizedCustomers: [{ customerName: "Legacy Co", score: 40, reasons: ["r1"], evidenceRefs: [] }] })}
    />,
  );
  ok("旧 Run（无 followup）渲染不变：沿用原标题与分析区", legacy.includes(">已完成<") && legacy.includes("Legacy Co") && !legacy.includes('data-testid="followup-outcome"'));

  console.log(`\n✅ followup-outcome-render: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
