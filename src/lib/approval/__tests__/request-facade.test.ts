/**
 * R1 §6 — canonical approval creation facade（纯映射测试，不触 DB）。
 * 运行：npx tsx src/lib/approval/__tests__/request-facade.test.ts
 */
import {
  buildPendingActionDraftInput,
  validateApprovalRequestInput,
  type CanonicalApprovalRequestInput,
} from "../request";

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

const base: CanonicalApprovalRequestInput = {
  orgId: "org-1",
  principal: { userId: "user-1", actorType: "agent" },
  actionType: "sales.update_followup",
  title: "更新跟进",
  preview: "跟进内容……",
  payload: { opportunityId: "opp-1", note: "hello" },
  risk: { vocabulary: "agent-core.tool-risk", value: "l2_soft" },
  source: {
    module: "agent-runtime-v2.executor",
    runId: "run-1",
    stepKey: "s3_draft",
    toolName: "sales_update_followup",
    threadId: "thread-1",
    messageId: "msg-1",
  },
  business: { projectId: "proj-1", workspaceId: "ws-1" },
  approver: { approverUserId: "leader-1", requiredRole: "org_admin" },
  ttlHours: 48,
  idempotencyKey: "r1:demo:run-1:s3_draft",
  policyVersion: "org-default-v1",
};

const { draft, normalizedRisk } = buildPendingActionDraftInput(base);

// Metadata completeness required by the task（orgId/principal/action/risk/source run+step/business/expiry）
ok(draft.orgId === "org-1" && draft.userId === "user-1", "orgId + principal 映射到列");
ok(draft.type === "sales.update_followup" && draft.title === "更新跟进", "actionType/title 映射");
ok(draft.agentRunId === "run-1" && draft.threadId === "thread-1" && draft.messageId === "msg-1", "source run/thread/message 映射到列");
ok(draft.projectId === "proj-1" && draft.workspaceId === "ws-1", "business context 映射到列");
ok(draft.approverUserId === "leader-1" && draft.requiredRole === "org_admin", "approver 路由映射");
ok(draft.ttlHours === 48 && draft.idempotencyKey === "r1:demo:run-1:s3_draft", "expiry + 幂等键映射");

const meta = (draft.payload as { metadata: Record<string, unknown> }).metadata;
ok(meta.requestedVia === "approval-port.requestApproval", "payload.metadata 标记 canonical 入口");
ok(meta.sourceModule === "agent-runtime-v2.executor" && meta.sourceStepKey === "s3_draft" && meta.sourceToolName === "sales_update_followup", "source step/tool 保留在 metadata（审计）");
ok(meta.canonicalRisk === "sensitive_write", "canonical 风险写入 metadata（l2_soft → sensitive_write）");
ok(JSON.stringify(meta.originalRisk).includes("l2_soft"), "原始风险词表逐字保留（审计）");
ok(meta.requiresApproval === true, "requiresApproval 恒为 true——本入口只产草稿，绝不直执（REQUIRES_APPROVAL_CONTRACT）");
ok(normalizedRisk.canonical === "sensitive_write" && !normalizedRisk.failClosed, "返回 normalizedRisk 供调用方审计");

// Payload passthrough intact（executor 依赖的业务参数不被破坏）
ok((draft.payload as Record<string, unknown>).opportunityId === "opp-1", "业务 payload 字段原样保留");

// Fail-closed risk still creates a draft-shaped input, never an execution
const failClosed = buildPendingActionDraftInput({ ...base, risk: { vocabulary: "??", value: "??" } });
ok(failClosed.normalizedRisk.canonical === "restricted" && failClosed.normalizedRisk.failClosed, "未知风险 → restricted fail-closed");

// Validation
ok(validateApprovalRequestInput(base) === null, "合法输入通过校验");
ok(validateApprovalRequestInput({ ...base, idempotencyKey: " " }) !== null, "缺 idempotencyKey 拒绝（新代码必须带稳定幂等键）");
ok(validateApprovalRequestInput({ ...base, orgId: "" }) !== null, "缺 orgId 拒绝（新审批必须租户内）");
ok(validateApprovalRequestInput({ ...base, source: { module: "" } }) !== null, "缺 source.module 拒绝");

console.log("");
console.log(`approval requestApproval facade 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
