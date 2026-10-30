/**
 * PERM-4a：已签约报价改总价审批判定（不连库）
 * 运行：npx tsx src/lib/sales/__tests__/signed-quote-amount.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SIGNED_QUOTE_ACTION_TYPE,
  decideSignedAmountChange,
  describeSignedQuoteChange,
  signedQuoteIdempotencyKey,
  signedTotalChanged,
} from "../signed-quote-amount";
import { checkApproverEligibility, pickApprovalRecipients } from "../approvers";

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

console.log("PERM-4a 签约单改总价：是否需审批");
ok(!signedTotalChanged(1000, 1000.004) && signedTotalChanged(1000, 1000.006), "阈值 0.005：1000.004 不算改价，1000.006 算");
ok(decideSignedAmountChange({ status: "signed", currentTotal: 1000, nextTotal: 1080, isPlatformSuperAdmin: false }) === "approval_required", "signed + 总价 1000→1080 → 需审批");
ok(decideSignedAmountChange({ status: "accepted", currentTotal: 1000, nextTotal: 900, isPlatformSuperAdmin: false }) === "approval_required", "accepted（历史）+ 改价 → 需审批");
ok(decideSignedAmountChange({ status: "signed", currentTotal: 1000, nextTotal: 1000, isPlatformSuperAdmin: false }) === "total_unchanged", "signed + 总价不变（只改备注）→ 直接生效");
ok(decideSignedAmountChange({ status: "sent", currentTotal: 1000, nextTotal: 1080, isPlatformSuperAdmin: false }) === "not_signed", "未签约报价改价 → 不走本审批");
ok(decideSignedAmountChange({ status: "signed", currentTotal: 1000, nextTotal: 1080, isPlatformSuperAdmin: true }) === "platform_direct", "平台 super_admin 改签约单总价 → 直接生效");

console.log("PERM-4a 收件人与批准人");
ok(pickApprovalRecipients({ holders: ["bossA", "bossB"], fallback: ["orgOwner"], requesterId: "bossA" }).join() === "bossB", "持审批键者优先，排除提交人");
ok(pickApprovalRecipients({ holders: ["bossA"], fallback: ["orgOwner", "bossA"], requesterId: "bossA" }).join() === "orgOwner", "唯一持键者是提交人 → 兜底收件人（同样排除提交人）");
ok(pickApprovalRecipients({ holders: ["bossA"], fallback: ["bossA"], requesterId: "bossA" }).length === 0, "唯一老板且无其他兜底 → 空（路由返回 409 NO_APPROVER）");
{
  const self = checkApproverEligibility({ approverId: "bossA", requesterId: "bossA", isPlatformSuperAdmin: false, hasPermission: true, enforcement: true });
  ok(!self.ok, "提交人自批 → 拒绝");
  const other = checkApproverEligibility({ approverId: "bossB", requesterId: "bossA", isPlatformSuperAdmin: false, hasPermission: true, enforcement: true });
  ok(other.ok && !other.selfApproved, "另一位持键老板批准 → 允许");
  const sa = checkApproverEligibility({ approverId: "lucas", requesterId: "lucas", isPlatformSuperAdmin: true, hasPermission: true, enforcement: true });
  ok(sa.ok && sa.selfApproved, "平台 super_admin 自己提交自己批 → 允许并记自批");
}

console.log("PERM-4a 审批文案不含成本");
{
  const d = describeSignedQuoteChange({ quoteNumber: "G1027-01", customerName: "Example Homeowner", beforeTotal: 1000, afterTotal: 1080, requesterName: "Alex" });
  const text = `${d.title}\n${d.preview}`;
  ok(text.includes("G1027-01") && text.includes("$1000.00") && text.includes("$1080.00") && text.includes("Alex"), "含报价号、改前改后总价、提交人");
  ok(!/成本|毛利|cost|margin/i.test(text), "不含成本 / 毛利字样");
  const empty = describeSignedQuoteChange({ quoteNumber: null, customerName: null, beforeTotal: 0, afterTotal: 1, requesterName: "x" });
  ok(empty.title.includes("（无单号）"), "无单号时有占位");
}
ok(signedQuoteIdempotencyKey("q1", "2026-10-28T00:00:00.000Z", 0) === "signed-quote-amount:q1:2026-10-28T00:00:00.000Z:0", "幂等键 = 报价 + 提交时版本 + 第几次提交");
ok(signedQuoteIdempotencyKey("q1", "t", 0) !== signedQuoteIdempotencyKey("q1", "t", 1), "被拒 / 失败后再提交同一内容 → 新键（不复用已终结的审批）");

console.log("PERM-4a 接线");
{
  const root = join(__dirname, "..", "..", "..", "..");
  const src = (p: string) => readFileSync(join(root, p), "utf-8");
  const put = src("src/app/api/sales/quotes/[quoteId]/route.ts");
  const submit = src("src/lib/sales/signed-quote-approval.ts");
  const types = src("src/lib/pending-actions/types.ts");
  const executor = src("src/lib/pending-actions/executor.ts");
  ok(/decideSignedAmountChange/.test(put) && /submitSignedQuoteAmountApproval/.test(put), "PUT 先判定再决定提交审批 / 落库");
  ok(/SIGNED_QUOTE_APPROVAL_PENDING/.test(submit) && /NO_APPROVER/.test(submit) && /status: 202/.test(submit) && /requestApproval/.test(submit), "提交：查重 409 / 无审批人 409 / 202 / 走 requestApproval");
  ok(!/costPrice|costRate/.test(submit), "提交模块不读成本字段");
  ok(types.includes(`"${SIGNED_QUOTE_ACTION_TYPE}"`) && /SalesUpdateSignedQuotePayload/.test(types), "PendingActionType 与载荷已登记");
  ok(executor.includes(`case "${SIGNED_QUOTE_ACTION_TYPE}"`), "executor 有分发 case");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
