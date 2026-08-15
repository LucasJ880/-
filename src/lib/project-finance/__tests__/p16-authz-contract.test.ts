/**
 * T2-P1.6 授权契约（纯静态源码断言；无 DB / 无网络；进 test-all + CI 子集）
 *
 * 结构性证明 P1.6 新增路由的服务端闸不会被误删/削弱：
 * - 全部新路由先过 requireCostAccess（per-project）或 resolveRequestOrgIdForUser（org 级）+ flag 门。
 * - 付款 / FX 结算强制 PROJECT_PAYMENT_RECORD（审批 ≠ 付款，RULE 6）。
 * - 放款人 / 确认人 / 垫资人一律取服务端 access.user.id，绝不取请求体（禁伪造）。
 * - 落标复盘 route 只暴露 confirm（人工确认），不存在写最终原因的 AI 路径。
 * - 无审核权者的应付列表被服务端强制过滤为「只看应付给自己的」。
 *
 * 参照既有约定 p15-authz-contract.test.ts（readFileSync 静态契约）。
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

/** 静态纪律断言辅助：剥离注释，只对真实代码做禁用模式检查。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const P16_PROJECT_ROUTES = [
  "payables/route.ts",
  "payables/[payableId]/payments/route.ts",
  "payments/[paymentId]/route.ts",
  "expenses/[expenseId]/fx-settlement/route.ts",
  "revenue/route.ts",
  "revenue/[entryId]/route.ts",
  "loss-review/route.ts",
  "tender-summary/route.ts",
];

test("P1.6 每条项目级路由都先过 requireCostAccess 并在失败时短路", () => {
  for (const rel of P16_PROJECT_ROUTES) {
    const src = read(rel);
    assert.ok(src.includes("requireCostAccess("), `${rel} 必须调用 requireCostAccess`);
    assert.ok(
      src.includes("access instanceof NextResponse"),
      `${rel} 必须在授权失败时短路返回`,
    );
  }
});

test("付款 / 付款冲销 / FX 结算强制 PROJECT_PAYMENT_RECORD（不复用 COST_REVIEW）", () => {
  for (const rel of [
    "payables/[payableId]/payments/route.ts",
    "payments/[paymentId]/route.ts",
    "expenses/[expenseId]/fx-settlement/route.ts",
  ]) {
    const src = read(rel);
    assert.ok(
      src.includes("PERMISSIONS.PROJECT_PAYMENT_RECORD"),
      `${rel} 必须要求 PROJECT_PAYMENT_RECORD`,
    );
    assert.ok(
      !src.includes("PERMISSIONS.PROJECT_COST_REVIEW"),
      `${rel} 不得以审批权代替付款权（审批 ≠ 付款）`,
    );
  }
});

test("放款人 / FX 结算人 / 落标确认人恒取服务端已认证用户，绝不取请求体", () => {
  const pay = read("payables/[payableId]/payments/route.ts");
  assert.ok(/paidById:\s*access\.user\.id/.test(pay), "放款人必须是 access.user.id");
  assert.ok(!/paidById:\s*(String\()?body\./.test(pay), "禁止从请求体取放款人");

  const fx = read("expenses/[expenseId]/fx-settlement/route.ts");
  assert.ok(/settledById:\s*access\.user\.id/.test(fx));
  assert.ok(!/settledById:\s*(String\()?body\./.test(fx));

  const loss = read("loss-review/route.ts");
  assert.ok(/confirmedByUserId:\s*access\.user\.id/.test(loss));
  assert.ok(!/confirmedByUserId:\s*(String\()?body\./.test(loss));

  const paymentVoid = read("payments/[paymentId]/route.ts");
  assert.ok(/voidedById:\s*access\.user\.id/.test(paymentVoid));
});

test("EMPLOYEE_PERSONAL 垫资人由服务端赋值，不接受客户端指定他人（EXP-MOBILE-02）", () => {
  const create = read("expenses/route.ts");
  assert.ok(
    /paidByUserId:\s*body\.fundingSource === "EMPLOYEE_PERSONAL" \? access\.user\.id : null/.test(create),
    "创建费用时垫资人必须来自 access.user.id",
  );
  assert.ok(
    /submittedById:\s*access\.user\.id/.test(create),
    "提交人必须来自 access.user.id",
  );

  const patch = read("expenses/[expenseId]/route.ts");
  assert.ok(
    /paidByUserId:\s*body\.fundingSource === "EMPLOYEE_PERSONAL" \? uid : null/.test(patch),
    "更新费用时垫资人必须来自服务端 uid",
  );

  // service 层二次强制：个人垫付人 ≠ 提交人 → 403
  const svc = readFileSync(join(LIB, "expense-service.ts"), "utf8");
  assert.ok(/不得代他人申报个人垫付/.test(svc));
  assert.ok(/function resolvePaidByUserId/.test(svc));
});

test("落标复盘 route 只暴露 confirm（人工），不存在写最终原因的 AI 路径（LOSS-02/03）", () => {
  const src = stripComments(read("loss-review/route.ts"));
  assert.ok(/!== "confirm"/.test(src), "非 confirm 动作必须被拒");
  assert.ok(!/aiSuggested/.test(src), "route 层不得暴露 AI 建议写入");
  assert.ok(!/suggestLossReasons/.test(src), "route 层不得调用 AI 建议函数");
});

test("无审核权者的应付列表被服务端强制过滤为「应付给自己」", () => {
  const src = read("payables/route.ts");
  assert.ok(
    /payeeUserId:\s*canReview \? null : access\.user\.id/.test(src),
    "服务端必须按 canReview 强制过滤 payeeUserId",
  );
  assert.ok(/PERMISSIONS\.PROJECT_COST_REVIEW/.test(src), "canReview 必须由服务端权限判定");
});

test("org 级 portfolio 路由过 org 解析 + 财务 flag 门", () => {
  const src = readFileSync(
    join(ROOT, "src/app/api/org/tender-portfolio/route.ts"),
    "utf8",
  );
  assert.ok(/resolveRequestOrgIdForUser/.test(src), "必须复用既有 org 解析（管理员须显式 orgId）");
  assert.ok(/financeDisabledResponse\(\)/.test(src), "必须过财务功能面 flag 门");
  assert.ok(/orgRes\.ok/.test(src), "org 解析失败必须短路");
  assert.ok(/getTenderPortfolioSummary\(orgRes\.orgId/.test(src), "聚合必须限定在解析出的 org");
});

test("付款幂等键由服务端拼装（客户端只给片段，无法覆盖他人键）", () => {
  const svc = readFileSync(join(LIB, "settlement-service.ts"), "utf8");
  assert.ok(/function buildPaymentIdempotencyKey/.test(svc));
  assert.ok(/`payment:\$\{payableId\}:\$\{k\}`/.test(svc), "幂等键必须含服务端 payableId 前缀");
  const route = read("payables/[payableId]/payments/route.ts");
  assert.ok(/clientKey:\s*String\(body\.clientKey/.test(route), "route 只传 clientKey 片段");
  assert.ok(!/idempotencyKey:\s*(String\()?body\./.test(route), "禁止客户端直接给整键");
});

test("超付 / 重复付款的服务端防线存在（行锁 + 剩余额校验 + unique 幂等键）", () => {
  const svc = readFileSync(join(LIB, "settlement-service.ts"), "utf8");
  assert.ok(/FOR UPDATE/.test(svc), "付款必须对 payable 行取 FOR UPDATE 行锁");
  assert.ok(/禁止超付/.test(svc), "必须有剩余额校验");
  assert.ok(/findUnique\(\{ where: \{ idempotencyKey \} \}\)/.test(svc), "必须有幂等快路");
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
  assert.ok(
    /idempotencyKey\s+String\s+@unique/.test(schema),
    "ProjectExpensePayment.idempotencyKey 必须 unique",
  );
  assert.ok(
    /expenseSubmissionId\s+String\s+@unique/.test(schema),
    "payable / fx settlement 必须以 expenseSubmissionId unique 作幂等锚",
  );
});

test("P1.6 读模型在 flag OFF 时 fail-closed 返回 available=false，绝不因缺表抛错", () => {
  for (const f of ["settlement-service.ts", "revenue-service.ts", "loss-review-service.ts"]) {
    const src = readFileSync(join(LIB, f), "utf8");
    assert.ok(
      /isProfitabilitySchemaReady\(\)/.test(src),
      `${f} 必须以 isProfitabilitySchemaReady 作 fail-closed 闸`,
    );
    assert.ok(/available: false/.test(src), `${f} 读侧必须有 available=false 空结果分支`);
  }
});

test("审批路径仍以 isLedgerProducerActive 作产成本闸，且 payable 创建在同一事务内", () => {
  const svc = readFileSync(join(LIB, "expense-service.ts"), "utf8");
  assert.ok(/isLedgerProducerActive\(\)/.test(svc), "产 ProjectCost 仍须 ledger producer 有效");
  assert.ok(
    /createPayableForApprovedExpense\(\{\s*\n?\s*tx,/.test(svc.replace(/\r/g, "")),
    "payable 必须在审批事务内创建（同一 tx）",
  );
  assert.ok(/currency: BASE_CURRENCY/.test(svc), "权威成本必须以 CAD 记账");
});
