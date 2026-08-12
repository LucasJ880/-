/**
 * T2-P1.5 财务控制 — 纯逻辑不变量（无 DB / 无网络；进 test-all + CI 子集）
 *
 * 覆盖：类别 taxonomy 对齐（费用类别 ⊆ 冻结 ProjectCost 且无 AI/DATA_API）、
 * 费用状态机合法/非法转移、flag 默认 OFF/fail-closed、事件键确定性、
 * 百分比预算行必须留 basis 的静态契约、RBAC accounting review 授权。
 */
import assert from "node:assert";
import { test } from "node:test";

import { PROJECT_COST_CATEGORIES } from "@/lib/project-ledger/types";
import { hasProjectPermission } from "@/lib/rbac/permissions";
import { PROJECT_ROLES } from "@/lib/rbac/roles";
import {
  BUDGET_LINE_CATEGORIES,
  EXPENSE_COST_CATEGORIES,
  PERCENTAGE_BUDGET_CATEGORIES,
  canTransitionExpense,
  EXPENSE_TRANSITIONS,
} from "../types";
import { isFinancialControlEnabledWithEnv } from "../flags";
import {
  budgetBaselineFrozenEventKey,
  expenseApprovedEventKey,
  expenseInfoRequestedEventKey,
} from "../event-keys";

test("费用成本类别 ⊆ 冻结 ProjectCost 类别，且不含 AI/DATA_API（审批 1:1 映射不越界）", () => {
  const frozen = new Set(PROJECT_COST_CATEGORIES as readonly string[]);
  for (const c of EXPENSE_COST_CATEGORIES) {
    assert.ok(frozen.has(c), `${c} 不在冻结 ProjectCost 类别内`);
  }
  assert.ok(!(EXPENSE_COST_CATEGORIES as readonly string[]).includes("AI"));
  assert.ok(!(EXPENSE_COST_CATEGORIES as readonly string[]).includes("DATA_API"));
});

test("预算规划 taxonomy 含 PROFIT/CONTINGENCY/OVERHEAD 且百分比型三者已登记", () => {
  for (const c of ["PROFIT", "CONTINGENCY", "OVERHEAD"] as const) {
    assert.ok((BUDGET_LINE_CATEGORIES as readonly string[]).includes(c));
    assert.ok((PERCENTAGE_BUDGET_CATEGORIES as readonly string[]).includes(c));
  }
});

test("费用状态机：合法转移放行，非法转移拒绝，APPROVED/REJECTED 为终态", () => {
  assert.ok(canTransitionExpense("DRAFT", "SUBMITTED"));
  assert.ok(canTransitionExpense("SUBMITTED", "PENDING_REVIEW"));
  assert.ok(canTransitionExpense("PENDING_REVIEW", "APPROVED"));
  assert.ok(canTransitionExpense("PENDING_REVIEW", "REJECTED"));
  assert.ok(canTransitionExpense("PENDING_REVIEW", "NEEDS_INFO"));
  assert.ok(canTransitionExpense("NEEDS_INFO", "RESUBMITTED"));
  assert.ok(canTransitionExpense("RESUBMITTED", "PENDING_REVIEW"));
  // 非法
  assert.ok(!canTransitionExpense("APPROVED", "SUBMITTED"));
  assert.ok(!canTransitionExpense("APPROVED", "PENDING_REVIEW"));
  assert.ok(!canTransitionExpense("REJECTED", "APPROVED"));
  assert.ok(!canTransitionExpense("DRAFT", "APPROVED"));
  assert.ok(!canTransitionExpense("PENDING_REVIEW", "RESUBMITTED"));
  // 终态无出边
  assert.deepEqual(EXPENSE_TRANSITIONS.APPROVED, []);
  assert.deepEqual(EXPENSE_TRANSITIONS.REJECTED, []);
});

test("财务控制 flag 默认 OFF / fail-closed", () => {
  assert.equal(isFinancialControlEnabledWithEnv({}), false);
  assert.equal(isFinancialControlEnabledWithEnv({ TENDER_FINANCIAL_CONTROL_ENABLED: "" }), false);
  assert.equal(isFinancialControlEnabledWithEnv({ TENDER_FINANCIAL_CONTROL_ENABLED: "1" }), true);
  assert.equal(isFinancialControlEnabledWithEnv({ TENDER_FINANCIAL_CONTROL_ENABLED: "true" }), true);
  assert.equal(isFinancialControlEnabledWithEnv({ TENDER_FINANCIAL_CONTROL_ENABLED: "off" }), false);
});

test("事件键确定性：approve 仅认 expenseId（幂等基石）；info_requested 按 transitionSeq 版本化", () => {
  assert.equal(expenseApprovedEventKey("exp_1"), "expense.approved:exp_1");
  assert.equal(expenseApprovedEventKey("exp_1"), expenseApprovedEventKey("exp_1"));
  assert.notEqual(expenseApprovedEventKey("exp_1"), expenseApprovedEventKey("exp_2"));
  assert.equal(budgetBaselineFrozenEventKey("v1"), "budget.baseline_frozen:v1");
  assert.equal(expenseInfoRequestedEventKey("exp_1", 3), "expense.info_requested:exp_1:t3");
  assert.notEqual(
    expenseInfoRequestedEventKey("exp_1", 3),
    expenseInfoRequestedEventKey("exp_1", 4),
  );
});

test("RBAC：accounting 拥有 project:cost:review；operator 只能写不能审；viewer 只能读", () => {
  assert.ok((PROJECT_ROLES as readonly string[]).includes("accounting"));
  assert.equal(hasProjectPermission("accounting", "project:cost:review"), true);
  assert.equal(hasProjectPermission("accounting", "project:cost:write"), true);
  assert.equal(hasProjectPermission("project_admin", "project:cost:review"), true);
  assert.equal(hasProjectPermission("operator", "project:cost:write"), true);
  assert.equal(hasProjectPermission("operator", "project:cost:review"), false);
  assert.equal(hasProjectPermission("viewer", "project:cost:read"), true);
  assert.equal(hasProjectPermission("viewer", "project:cost:write"), false);
});
