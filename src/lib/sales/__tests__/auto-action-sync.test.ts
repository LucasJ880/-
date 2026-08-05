import assert from "node:assert/strict";
import test from "node:test";
import type { BriefingItem } from "@/lib/secretary/types";
import { buildSalesAutoActionCandidates } from "../auto-action-sync";

function item(category: string, opportunityId: string, severity: BriefingItem["severity"] = "warning"): BriefingItem {
  return {
    id: `${category}-${opportunityId}`,
    domain: "sales",
    severity,
    category,
    title: `${category} title`,
    description: `${category} description`,
    action: {
      type: "view_sales_customer",
      label: "查看",
      payload: { customerId: `customer-${opportunityId}`, opportunityId },
    },
    dedupeKey: `${category}:${opportunityId}`,
  };
}

test("只把安全销售提醒转成自动行动", () => {
  const candidates = buildSalesAutoActionCandidates([
    item("quote_pending", "opp-1"),
    item("appointment", "opp-2"),
    item("fabric_low_stock", "opp-3"),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.signalKey, "quote_pending");
  assert.equal(candidates[0]?.category, "record_followup");
});

test("同一商机只保留优先级最高的信号", () => {
  const candidates = buildSalesAutoActionCandidates([
    item("stale_opportunity", "opp-1"),
    item("viewed_not_signed", "opp-1", "urgent"),
    item("followup_due", "opp-1", "urgent"),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.signalKey, "overdue_followup");
  assert.equal(candidates[0]?.priority, "urgent");
});

test("缺少商机边界的数据不会进入自动行动", () => {
  const invalid = item("new_lead_stale", "opp-1");
  invalid.action = { type: "view_sales_customer", label: "查看", payload: { customerId: "customer-1" } };
  assert.deepEqual(buildSalesAutoActionCandidates([invalid]), []);
});
