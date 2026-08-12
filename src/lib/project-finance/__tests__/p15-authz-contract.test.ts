/**
 * T2-P1.5 授权契约（纯静态源码断言；无 DB / 无网络；进 test-all + CI 子集）
 *
 * 目的：结构性证明每条财务路由的服务端授权闸不会被误删/削弱（回归护栏），且：
 * - 审核动作（approve/reject/request_info）强制 PROJECT_COST_REVIEW（accounting/admin）。
 * - 费用提交/重提/票据上传走 PROJECT_EXPENSE_SUBMIT —— 所有 active 项目成员可提交本人费用。
 * - 预算编辑走 PROJECT_COST_WRITE；只读走 PROJECT_COST_READ。
 * - actor 一律 serverActor(access.user.id)，绝不取自请求体（禁客户端伪造 actor/reviewer/org）。
 * - service 层硬拒自审批（submittedById === reviewerUserId），并用条件 updateMany 作并发闸。
 *
 * 参照既有约定 src/app/api/agent/tasks/__tests__/authz-contract.test.ts（readFileSync 静态契约）。
 */
import assert from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FIN = join(ROOT, "src/app/api/projects/[id]/finance");
const LIB = join(ROOT, "src/lib/project-finance");

function read(rel: string, base = FIN): string {
  return readFileSync(join(base, rel), "utf8");
}

test("每条财务路由都先过 requireCostAccess（服务端授权，非仅 UI）", () => {
  for (const rel of [
    "summary/route.ts",
    "budget/route.ts",
    "expenses/route.ts",
    "expenses/[expenseId]/route.ts",
    "expenses/[expenseId]/receipt/route.ts",
  ]) {
    const src = read(rel);
    assert.ok(
      src.includes("requireCostAccess("),
      `${rel} 必须调用 requireCostAccess 做服务端授权`,
    );
    assert.ok(
      src.includes("access instanceof NextResponse"),
      `${rel} 必须在授权失败时短路返回（instanceof NextResponse）`,
    );
  }
});

test("审核动作强制 PROJECT_COST_REVIEW（server-enforced）", () => {
  const src = read("expenses/[expenseId]/route.ts");
  // 审核集合 + 对审核动作映射到 REVIEW 权限
  assert.ok(src.includes('reviewActions') && src.includes('"approve"') && src.includes('"reject"') && src.includes('"request_info"'));
  assert.ok(
    src.includes("PERMISSIONS.PROJECT_COST_REVIEW"),
    "审核路由必须引用 PROJECT_COST_REVIEW",
  );
  // 非审核（提交/重提）走 EXPENSE_SUBMIT，不再是 COST_WRITE
  assert.ok(
    src.includes("PERMISSIONS.PROJECT_EXPENSE_SUBMIT"),
    "提交/重提动作应走 PROJECT_EXPENSE_SUBMIT",
  );
  assert.ok(
    !src.includes("PROJECT_COST_WRITE"),
    "expense 详情路由不应再用 COST_WRITE 门控提交（已与预算编辑解耦）",
  );
});

test("费用创建 + 票据上传走 EXPENSE_SUBMIT（所有成员可提交本人费用）", () => {
  const create = read("expenses/route.ts");
  // POST 创建费用用 EXPENSE_SUBMIT
  assert.ok(create.includes("PROJECT_EXPENSE_SUBMIT"), "expenses POST 应用 EXPENSE_SUBMIT");
  // GET 列表用 READ
  assert.ok(create.includes("PROJECT_COST_READ"), "expenses GET 应用 READ");

  const receipt = read("expenses/[expenseId]/receipt/route.ts");
  assert.ok(receipt.includes("PROJECT_EXPENSE_SUBMIT"), "票据上传应用 EXPENSE_SUBMIT");
  assert.ok(receipt.includes("submittedById"), "票据上传须校验本人归属（submittedById）");
});

test("预算编辑走 COST_WRITE；只读走 COST_READ", () => {
  const budget = read("budget/route.ts");
  assert.ok(budget.includes("PROJECT_COST_WRITE"), "预算 POST 应用 COST_WRITE");
  assert.ok(budget.includes("PROJECT_COST_READ"), "预算 GET 应用 COST_READ");
  const summary = read("summary/route.ts");
  assert.ok(summary.includes("PROJECT_COST_READ"), "summary 应用 COST_READ");
});

test("actor 一律 serverActor(access.user.id)，绝不取自请求体（禁伪造 actor/reviewer/org）", () => {
  for (const rel of ["expenses/route.ts", "expenses/[expenseId]/route.ts", "budget/route.ts"]) {
    const src = read(rel);
    assert.ok(src.includes("serverActor(access.user.id)"), `${rel} 必须用 serverActor(access.user.id)`);
    // 反例护栏：不得从 body 取 actorId / reviewerUserId / orgId
    assert.ok(!/body\.(actorId|reviewerUserId|orgId|submittedById)\b/.test(src), `${rel} 不得从请求体取 actor/reviewer/org/submitter`);
  }
  // reviewer 身份来自会话 access.user.id，而非 body
  const detail = read("expenses/[expenseId]/route.ts");
  assert.ok(detail.includes("reviewerUserId: uid") && detail.includes("const uid = access.user.id"),
    "审核人身份必须取自会话（access.user.id），非请求体");
});

test("提交人动作要求本人（防越权替他人提交/重提）", () => {
  const detail = read("expenses/[expenseId]/route.ts");
  assert.ok(detail.includes('action === "submit"') && detail.includes('action === "resubmit"'));
  assert.ok(detail.includes("只能提交本人的费用") || detail.includes("submittedById !== uid"),
    "submit/resubmit 须校验本人归属");
});

test("service 层硬拒自审批 + 并发闸（不依赖路由）", () => {
  const svc = read("expense-service.ts", LIB);
  assert.ok(svc.includes("SelfApprovalError"), "approve/reject 须抛 SelfApprovalError");
  assert.ok(
    svc.includes("submittedById === input.reviewerUserId"),
    "自审批判据必须是 submittedById === reviewerUserId",
  );
  // 并发/双击闸：条件 updateMany(status=PENDING_REVIEW) 只放行一个胜者
  assert.ok(
    svc.includes("updateMany(") && svc.includes('status: "PENDING_REVIEW"'),
    "审批须用条件 updateMany(status=PENDING_REVIEW) 作并发闸",
  );
});

test("requireCostAccess 叠加细粒度权限并在缺权时 403（feature dark → 404）", () => {
  const access = read("access.ts", LIB);
  assert.ok(access.includes("hasProjectPermission(access.projectRole, permission)"),
    "requireCostAccess 须校验 hasProjectPermission");
  assert.ok(access.includes("status: 403"), "缺权应 403");
  assert.ok(access.includes("financeDisabledResponse") && access.includes("status: 404"),
    "feature dark 须 404");
});
