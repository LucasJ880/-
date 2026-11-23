/**
 * Tender/Project Security P0 — AgentTask DTO 安全投影单测（纯函数，无 DB）。
 * 运行：npx tsx src/lib/agent-tasks/__tests__/dto.test.ts
 *
 * 覆盖 S10：普通业务用户响应不得含 raw internal step JSON /
 * 原始 error / ApprovalRequest 内部字段。
 */

import {
  toBusinessAgentTaskDetail,
  toDiagnosticAgentTaskDetail,
  toBusinessAgentTaskStep,
  sanitizeListStepInternals,
  parseListLimit,
  RECENT_TASKS_LIMIT,
  PROJECT_TASKS_LIMIT,
  SAFE_STEP_ERROR_MESSAGE,
  AGENT_STEP_INTERNAL_FIELDS,
  APPROVAL_INTERNAL_FIELDS,
} from "../dto";

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

console.log("security-p0 agent-task dto");

const SECRET_INPUT = "SECRET_INPUT_9a1f";
const SECRET_OUTPUT = "SECRET_OUTPUT_b2c3";
const SECRET_CHECK = "SECRET_CHECK_d4e5";
const SECRET_ERROR = "RAW_STACK_TRACE_f6a7 at internal/module.js:42";
const SECRET_PREVIEW = "SECRET_PREVIEW_c8d9";
const SECRET_RISK_REASON = "SECRET_RISK_REASON_e0f1";

const rawTask = {
  id: "task_1",
  projectId: "proj_1",
  project: { id: "proj_1", name: "标书项目" },
  taskType: "custom",
  triggerType: "manual",
  intent: "生成投标方案",
  riskLevel: "medium",
  status: "failed",
  currentStepIndex: 1,
  totalSteps: 2,
  priority: "normal",
  requiresApproval: true,
  createdById: "user_owner",
  createdAt: new Date("2026-08-10T00:00:00Z"),
  updatedAt: new Date("2026-08-10T01:00:00Z"),
  steps: [
    {
      id: "step_1",
      stepIndex: 0,
      skillId: "intelligence_report",
      agentName: "情报分析员",
      title: "情报分析",
      status: "error",
      riskLevel: "low",
      requiresApproval: false,
      inputJson: JSON.stringify({ secret: SECRET_INPUT }),
      outputJson: JSON.stringify({ secret: SECRET_OUTPUT }),
      outputSummary: "已完成情报分析",
      checkReportJson: JSON.stringify({ secret: SECRET_CHECK }),
      confidence: 0.9,
      error: SECRET_ERROR,
      startedAt: new Date("2026-08-10T00:10:00Z"),
      completedAt: new Date("2026-08-10T00:20:00Z"),
      createdAt: new Date("2026-08-10T00:05:00Z"),
      approvalRequests: [
        {
          id: "appr_1",
          actionType: "email_draft",
          riskLevel: "medium",
          riskReason: SECRET_RISK_REASON,
          previewJson: JSON.stringify({ secret: SECRET_PREVIEW }),
          status: "pending",
          deadlineAt: new Date("2026-08-11T00:00:00Z"),
          decidedAt: null,
          decidedBy: null,
          decisionNote: "内部决策备注",
          acceptedWithRisk: false,
          createdAt: new Date("2026-08-10T00:06:00Z"),
        },
      ],
    },
  ],
  approvalRequests: [
    {
      id: "appr_1",
      actionType: "email_draft",
      riskLevel: "medium",
      riskReason: SECRET_RISK_REASON,
      previewJson: JSON.stringify({ secret: SECRET_PREVIEW }),
      status: "pending",
      deadlineAt: new Date("2026-08-11T00:00:00Z"),
      acceptedWithRisk: false,
      createdAt: new Date("2026-08-10T00:06:00Z"),
    },
  ],
};

// —— 业务投影：整体序列化不得出现任何内部秘密 ——
const business = toBusinessAgentTaskDetail(rawTask);
const businessBlob = JSON.stringify(business);

for (const [label, secret] of [
  ["inputJson", SECRET_INPUT],
  ["outputJson", SECRET_OUTPUT],
  ["checkReportJson", SECRET_CHECK],
  ["raw error/stack", SECRET_ERROR],
  ["approval previewJson", SECRET_PREVIEW],
  ["approval riskReason", SECRET_RISK_REASON],
] as const) {
  ok(!businessBlob.includes(secret), `业务投影不含 ${label}`);
}

// —— 业务投影：内部字段键位为 null ——
const bStep = business.steps[0];
ok(bStep.inputJson === null, "业务 step.inputJson=null");
ok(bStep.outputJson === null, "业务 step.outputJson=null");
ok(bStep.checkReportJson === null, "业务 step.checkReportJson=null");
ok(bStep.error === SAFE_STEP_ERROR_MESSAGE, "业务 step.error 为脱敏文案");
ok(bStep.hasError === true, "业务 step.hasError 标记保留");
ok(bStep.outputSummary === "已完成情报分析", "业务 step 保留安全摘要");
ok(bStep.title === "情报分析" && bStep.status === "error", "业务 step 保留标题/状态");

// —— 业务审批投影：无内部字段 ——
const bAppr = business.approvalRequests[0] as Record<string, unknown>;
for (const f of APPROVAL_INTERNAL_FIELDS) {
  ok(!(f in bAppr), `业务审批不含 ${f}`);
}
ok(bAppr.status === "pending" && bAppr.riskLevel === "medium", "业务审批保留安全字段");

// —— 诊断投影：管理员保留完整原始字段 ——
const diag = toDiagnosticAgentTaskDetail(rawTask);
const diagBlob = JSON.stringify(diag);
ok(diagBlob.includes(SECRET_INPUT), "诊断投影含 inputJson");
ok(diagBlob.includes(SECRET_OUTPUT), "诊断投影含 outputJson");
ok(diagBlob.includes(SECRET_CHECK), "诊断投影含 checkReportJson");
ok(diag.steps[0].error === SECRET_ERROR, "诊断投影保留原始 error");

// —— 契约常量存在（供路由/审计引用）——
ok(AGENT_STEP_INTERNAL_FIELDS.length === 3, "内部字段常量清单完整");

// —— 成功步骤不误标错误 ——
const okStep = toBusinessAgentTaskStep({
  id: "s2",
  stepIndex: 1,
  skillId: "quote",
  agentName: "报价员",
  title: "报价",
  status: "completed",
  riskLevel: "low",
  requiresApproval: false,
  outputSummary: "报价完成",
});
ok(okStep.error === null && okStep.hasError === false, "completed 步骤无 error");

// —— FIX-23 列表步骤投影（GET /api/agent/tasks/recent）——
{
  const full = {
    id: "s9",
    title: "报价状态检查",
    status: "waiting_for_approval",
    outputSummary: "报价审查评分 60",
    inputJson: SECRET_INPUT,
    outputJson: SECRET_OUTPUT,
    checkReportJson: SECRET_CHECK,
  };
  const biz = sanitizeListStepInternals(full, false) as Record<string, unknown>;
  ok(
    biz.inputJson === null && biz.outputJson === null && biz.checkReportJson === null,
    "列表步骤投影：不是平台管理员时三种内部字段都置 null",
  );
  ok(
    JSON.stringify(Object.keys(biz)) === JSON.stringify(Object.keys(full)) &&
      biz.id === full.id && biz.title === full.title && biz.status === full.status && biz.outputSummary === full.outputSummary,
    "列表步骤投影：其余键不动、键顺序不变、不新增键",
  );
  ok(full.checkReportJson === SECRET_CHECK && full.inputJson === SECRET_INPUT, "列表步骤投影：不改传入的对象");
  const nulled = Object.keys(full).filter((k) => (full as Record<string, unknown>)[k] !== null && biz[k] === null);
  ok(
    JSON.stringify([...nulled].sort()) === JSON.stringify([...AGENT_STEP_INTERNAL_FIELDS].sort()),
    "列表步骤投影：置空的键与 AGENT_STEP_INTERNAL_FIELDS 逐项相同",
  );

  const onlyCheck = { id: "s10", title: "风险扫描", status: "completed", outputSummary: "发现 2 项", checkReportJson: SECRET_CHECK };
  const bizOnly = sanitizeListStepInternals(onlyCheck, false) as Record<string, unknown>;
  ok(
    bizOnly.checkReportJson === null &&
      JSON.stringify(Object.keys(bizOnly)) === JSON.stringify(Object.keys(onlyCheck)) &&
      !("inputJson" in bizOnly) && !("outputJson" in bizOnly),
    "列表步骤投影：只有 checkReportJson 时只置它，不补出 inputJson / outputJson",
  );
  ok(!JSON.stringify([biz, bizOnly]).includes(SECRET_CHECK), "列表步骤投影：业务结果里没有检查报告原文");

  const diagList = sanitizeListStepInternals(full, true);
  ok(diagList === full && diagList.checkReportJson === SECRET_CHECK, "列表步骤投影：平台管理员原样返回");
}

// —— FIX-23 列表条数：只认十进制正整数，否则按缺省，再封顶 ——
{
  const r = (raw: string | null) => parseListLimit(raw, RECENT_TASKS_LIMIT);
  const l = (raw: string | null) => parseListLimit(raw, PROJECT_TASKS_LIMIT);
  ok(RECENT_TASKS_LIMIT.fallback === 10 && RECENT_TASKS_LIMIT.max === 20 && PROJECT_TASKS_LIMIT.fallback === 20 && PROJECT_TASKS_LIMIT.max === 100, "列表条数：最近任务缺省 10 封顶 20，项目任务列表缺省 20 封顶 100");
  ok(r("5") === 5 && r(" 7 ") === 7 && r("20") === 20 && r("50") === 20 && l("50") === 50 && l("150") === 100, "列表条数：十进制正整数照用（去首尾空白），超过上限按上限");
  ok([null, "", "0", "-5", "-1000", "2.5", "5.0", "abc", "0x10", "1e1", "+3", "05"].every((raw) => r(raw) === 10 && l(raw) === 20), "列表条数：缺省、空串、0、负数、小数、非数字、0x10、1e1、+3、前导零都按缺省");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
