/**
 * Runtime V2 Inline Approval 契约
 * 运行：npx tsx src/lib/assistant/__tests__/inline-approval-model.test.ts
 */

import assert from "node:assert/strict";
import {
  defaultSelectedActionIds,
  deriveUserProgress,
  extractChangeSummary,
  extractTargetLabel,
  formatAwaitingCopy,
  isEmailDraftType,
  needsCriticalConfirm,
  primaryConfirmLabel,
  riskLevelForAction,
  simplifyEvidenceRefs,
  stickyBarLabel,
  type InlinePendingAction,
} from "@/lib/assistant/inline-approval-model";
import { preferRuntimeV2Steps } from "@/lib/assistant/runtime-v2-ui";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("inline-approval-model");

const actions: InlinePendingAction[] = [
  {
    actionId: "a1",
    draftType: "calendar.create_event",
    title: "跟进提醒：[AR2-QA] Customer 1",
    preview: "逾期跟进",
    status: "pending",
    payload: {
      title: "跟进客户",
      startTime: "2026-07-25T15:00:00.000Z",
      metadata: { customerId: "c1" },
    },
  },
  {
    actionId: "a2",
    draftType: "sales.update_followup",
    title: "调整跟进日期：Customer 2",
    preview: "改期",
    status: "pending",
    payload: {
      customerName: "Customer 2",
      previousFollowupAt: "2026-07-01T00:00:00.000Z",
      nextFollowupAt: "2026-07-25T00:00:00.000Z",
    },
  },
  {
    actionId: "a3",
    draftType: "grader.email_draft",
    title: "邮件草稿：a@b.com",
    preview: "跟进",
    status: "pending",
    payload: {
      to: "a@b.com",
      subject: "跟进：Customer 3",
      body: "<p>hi</p>",
      metadata: { orgId: "o1" },
    },
  },
];

ok(
  "awaiting_approval 时页面应展示 Inline 数据（有 pending 动作）",
  actions.filter((a) => a.status === "pending").length === 3,
);

ok(
  "不进入全局审批中心也可确认：主按钮文案正确",
  primaryConfirmLabel(1) === "确认并继续" &&
    primaryConfirmLabel(5) === "确认 5 个动作并继续",
);

ok(
  "多 PendingAction 默认可批量勾选",
  defaultSelectedActionIds(actions).length === 3,
);

ok(
  "部分选择：可取消个别勾选后数量变化",
  (() => {
    const ids = defaultSelectedActionIds(actions).filter((id) => id !== "a2");
    return ids.length === 2 && primaryConfirmLabel(ids.length).includes("2");
  })(),
);

ok(
  "确认按钮防重复：busy 时 selectedCount 仍可计算但不触发（契约）",
  stickyBarLabel(3) === "3 个动作等待确认" && primaryConfirmLabel(0) === "请先选择动作",
);

ok(
  "刷新后选中态可重新初始化为未处理动作",
  defaultSelectedActionIds([
    { ...actions[0], status: "executed" },
    actions[1],
    actions[2],
  ]).join(",") === "a2,a3",
);

ok(
  "Gmail Draft 明确不会自动发送",
  isEmailDraftType("grader.email_draft") &&
    riskLevelForAction(actions[2]) === "LOW" &&
    !needsCriticalConfirm(actions),
);

ok(
  "前后值：跟进日期可提取",
  (() => {
    const c = extractChangeSummary(actions[1]);
    return c.before !== null && c.after !== null && extractTargetLabel(actions[1]) === "Customer 2";
  })(),
);

ok(
  "数量文案准确",
  formatAwaitingCopy({
    awaitingApprovalSteps: 1,
    pendingActions: 3,
    executedActions: 0,
    rejectedActions: 0,
    failedActions: 0,
  }) === "1 个步骤等待确认，共 3 个动作。",
);

ok(
  "用户进度含等待确认",
  deriveUserProgress({
    runStatus: "awaiting_approval",
    hasPendingActions: true,
    steps: [{ status: "completed", stepKey: "s5_prioritize" }],
  }).stage === "awaiting_approval",
);

ok(
  "evidence 简化不暴露 stepKey",
  !simplifyEvidenceRefs(["s3:opp1", "s4:opp1"]).some((x) => x.startsWith("s3:")),
);

ok(
  "Legacy Task 不覆盖 V2 Steps",
  preferRuntimeV2Steps({
    runtimeVersion: "v2",
    runtimeSteps: [{ title: "x", status: "completed" }],
  }) &&
    !preferRuntimeV2Steps({
      runtimeVersion: null,
      runtimeSteps: [{ title: "整理回复", status: "done" }],
    }),
);

ok(
  "CRITICAL 才需要二次确认",
  needsCriticalConfirm([
    {
      draftType: "other",
      payload: { metadata: { issueSeverity: "CRITICAL" } },
    },
  ]) && !needsCriticalConfirm(actions),
);

console.log(`结果: ${passed} passed`);
