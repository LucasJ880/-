import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("5A效果接口保持企业隔离并展示响应、完成与辅助签约", () => {
  const route = source("src/app/api/sales/actions/effectiveness/route.ts");
  const card = source("src/app/(main)/sales/cockpit/sales-action-effectiveness-card.tsx");
  assert.match(route, /resolveSalesOrgIdForRequest/);
  assert.match(route, /orgId: orgRes\.orgId/);
  assert.match(route, /scope\.ownOnly/);
  assert.match(card, /数字员工行动效果/);
  assert.match(card, /中位响应时间/);
  assert.match(card, /辅助签约/);
});

test("5B用统一审批中心处理超额让利并在所有交付通道拦截", () => {
  const request = source("src/app/api/sales/quotes/[quoteId]/request-promotion-approval/route.ts");
  const executor = source("src/lib/pending-actions/executor.ts");
  const types = source("src/lib/pending-actions/types.ts");
  const email = source("src/app/api/sales/quotes/[quoteId]/send-email/route.ts");
  const pdf = source("src/app/api/sales/quotes/[quoteId]/pdf/route.ts");
  const markSent = source("src/app/api/sales/quotes/[quoteId]/mark-sent/route.ts");
  const markSigned = source("src/app/api/sales/quotes/[quoteId]/mark-signed/route.ts");
  const publicSign = source("src/app/api/sales/quotes/share/[token]/sign/route.ts");
  assert.match(request, /sales\.approve_quote_promotion/);
  assert.match(request, /computePayloadHash/);
  assert.match(request, /promotionApprovalStatus: "pending"/);
  assert.match(types, /SalesApproveQuotePromotionPayload/);
  assert.match(executor, /execSalesApproveQuotePromotion/);
  assert.match(executor, /promotionApprovalStatus: "approved"/);
  assert.match(executor, /promotionApprovalStatus: "rejected"/);
  for (const delivery of [email, pdf, markSent, markSigned, publicSign]) {
    assert.match(delivery, /evaluatePromotionApproval/);
    assert.match(delivery, /PROMOTION_APPROVAL_REQUIRED/);
  }
});

test("审批驳回要求填写原因，报价变化会让旧审批失效", () => {
  const detail = source("src/app/(main)/capabilities/approvals/[approvalId]/page.tsx");
  const quoteUpdate = source("src/app/api/sales/quotes/[quoteId]/route.ts");
  assert.match(detail, /驳回原因/);
  assert.match(detail, /!decisionNote\.trim\(\)/);
  assert.match(quoteUpdate, /报价让利内容已变化，请重新提交审批/);
  assert.match(quoteUpdate, /promotionApprovalActionId: null/);
});
