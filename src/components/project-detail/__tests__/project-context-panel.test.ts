/**
 * Phase 3 项目上下文决策与可见性契约（无 DOM）
 * 运行：npx tsx src/components/project-detail/__tests__/project-context-panel.test.ts
 */

import assert from "node:assert/strict";
import {
  deriveProjectCommandState,
  filterProjectContextActivities,
} from "../project-context-panel";
import type { FormattedActivity } from "@/lib/activity/formatter";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.equal(condition, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const baseline = {
  status: "active",
  stage: "interpretation",
  orgBound: true,
  documentCount: 2,
  closeDate: "2026-08-20T16:00:00.000Z",
  riskLevel: "none",
  riskLabel: null,
  isOverdue: false,
  completedTasks: 2,
  totalTasks: 5,
  pendingCount: 0,
  hasIntelligence: true,
};

console.log("project-context-panel");

const missingFiles = deriveProjectCommandState({
  ...baseline,
  documentCount: 0,
});
ok("缺少文件时优先引导到资料抽屉", missingFiles.nextAction.target === "files");
ok("缺失项明确显示上传项目文件", missingFiles.missingItems.includes("上传项目文件"));

const needsInterpretation = deriveProjectCommandState({
  ...baseline,
  hasIntelligence: false,
});
ok("未解读时引导到招标要求", needsInterpretation.nextAction.target === "requirements");

const pending = deriveProjectCommandState({
  ...baseline,
  pendingCount: 2,
});
ok("待确认动作引导到工作台 Needs You", pending.nextAction.target === "workbench");
ok("待确认动作被列为风险提示", pending.risks.some((item) => item.label.includes("2 项")));

const quoteStage = deriveProjectCommandState({
  ...baseline,
  stage: "supplier_quote",
});
ok("报价阶段引导到标书与报价", quoteStage.nextAction.target === "bid");

const overdue = deriveProjectCommandState({
  ...baseline,
  isOverdue: true,
  riskLevel: "high",
});
ok("逾期项目显示危险提示", overdue.risks.some((item) => item.tone === "danger"));

const activities: FormattedActivity[] = [
  {
    id: "business",
    timestamp: "2026-08-06T12:00:00.000Z",
    actor: { id: "u1", name: "Lucas", email: "" },
    actionKey: "status_change",
    actionLabel: "变更了状态",
    targetType: "project",
    targetTypeLabel: "项目",
    targetId: "p1",
    targetName: "项目 A",
    summary: "项目进入询价阶段",
    diff: null,
  },
  {
    id: "runtime",
    timestamp: "2026-08-06T12:01:00.000Z",
    actor: { id: "system", name: "系统", email: "" },
    actionKey: "runtime_tool",
    actionLabel: "调用了工具",
    targetType: "tool_trace",
    targetTypeLabel: "工具调用",
    targetId: null,
    targetName: null,
    summary: "调用了工具",
    diff: null,
  },
];

ok(
  "普通业务用户看不到 Runtime/Tool 活动",
  filterProjectContextActivities(activities, false).map((item) => item.id).join(",") === "business",
);
ok(
  "平台管理员仍可查看完整诊断活动",
  filterProjectContextActivities(activities, true).length === 2,
);

console.log(`结果: ${passed} passed`);
