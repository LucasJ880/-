/**
 * PERM-2：折扣三档决策表（spec sales/discount-tiering §折扣三档判定）
 * 运行：npx tsx src/lib/sales/__tests__/discount-tier.test.ts
 */
import { decideDiscountTier, promotionApprovalDataForTier } from "../discount-tier";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); }
}

console.log("PERM-2 折扣三档");
const P = { promoMaxPct: 0.25, leadMaxPct: 0.35 };
const sales = { isPlatformSuperAdmin: false, canSubmitOverLimit: false };
const lead = { isPlatformSuperAdmin: false, canSubmitOverLimit: true };
const platform = { isPlatformSuperAdmin: true, canSubmitOverLimit: false };

const r1 = decideDiscountTier({ ...P, ratio: 0.2, actor: sales });
ok(r1.tier === "within_limit" && r1.approved && !r1.requiresApproval, "销售 20% → within_limit");
ok(promotionApprovalDataForTier({ decision: r1, ratio: 0.2, amount: 100, promoMaxPct: 0.25, userId: "u" }).promotionApprovalStatus === "not_required", "within_limit → not_required");

const r2 = decideDiscountTier({ ...P, ratio: 0.3, actor: sales });
ok(r2.tier === "approval_required" && !r2.approved && r2.requiresApproval, "销售 30% → approval_required");
ok(promotionApprovalDataForTier({ decision: r2, ratio: 0.3, amount: 100, promoMaxPct: 0.25, userId: "u" }).promotionApprovalStatus === "required", "approval_required → required");

const r3 = decideDiscountTier({ ...P, ratio: 0.3, actor: lead });
ok(r3.tier === "lead_direct" && r3.approved && r3.auditVia === "pricing_lead" && !r3.selfApproved, "合价人 30% → lead_direct, via pricing_lead");
const d3 = promotionApprovalDataForTier({ decision: r3, ratio: 0.3, amount: 120, promoMaxPct: 0.25, userId: "miki", now: new Date(0) });
ok(d3.promotionApprovalStatus === "approved" && d3.promotionApprovedById === "miki" && d3.promotionApprovalRatio === 0.3 && d3.promotionApprovalMaxPct === 0.25, "lead_direct → approved 快照");

const r4 = decideDiscountTier({ ...P, ratio: 0.4, actor: lead });
ok(r4.tier === "approval_required", "合价人 40% → approval_required");

const r5 = decideDiscountTier({ ...P, ratio: 0.4, actor: platform });
ok(r5.tier === "platform_self_approved" && r5.approved && r5.selfApproved && r5.auditVia === "platform_admin_self_approval", "平台管理员 40% → platform_self_approved");

const r6 = decideDiscountTier({ ...P, ratio: 0.3, actor: { isPlatformSuperAdmin: false, canSubmitOverLimit: false } });
ok(r6.tier === "approval_required", "平台 admin（无能力位）30% → approval_required");

const r7 = decideDiscountTier({ ...P, ratio: 0.35, actor: lead });
ok(r7.tier === "lead_direct", "合价人恰好 35% → lead_direct（含边界）");

const r8 = decideDiscountTier({ ...P, ratio: 0.25, actor: sales });
ok(r8.tier === "within_limit", "销售恰好 25% → within_limit（含边界）");

const r9 = decideDiscountTier({ promoMaxPct: 0.25, leadMaxPct: 0.2, ratio: 0.3, actor: lead });
ok(r9.tier === "approval_required", "合价上限低于销售上限时取销售上限 → 30% 需审批");

const r10 = decideDiscountTier({ ...P, ratio: null, actor: sales });
ok(r10.tier === "within_limit", "无折扣 → within_limit");

const r11 = decideDiscountTier({ ...P, ratio: 0.3, actor: { isPlatformSuperAdmin: true, canSubmitOverLimit: true } });
ok(r11.tier === "lead_direct", "平台管理员同时持超限提交权、在合价上限内 → lead_direct（不标自批）");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
