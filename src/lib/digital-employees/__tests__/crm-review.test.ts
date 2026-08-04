import assert from "node:assert/strict";
import test from "node:test";
import {
  findPotentialDuplicateCustomerIds,
  reviewCrmRecord,
} from "../crm-review";

const NOW = new Date("2026-08-04T16:00:00.000Z").getTime();

test("逾期跟进优先于普通商机建议", () => {
  const review = reviewCrmRecord({
    phone: "4165550100",
    stage: "negotiation",
    nextFollowupAt: "2026-08-03T16:00:00.000Z",
    updatedAt: "2026-08-04T12:00:00.000Z",
  }, NOW);
  assert.equal(review.urgency, "critical");
  assert.equal(review.label, "跟进逾期");
  assert.equal(review.action, "record_followup");
});

test("已查看未签报价识别为成交窗口", () => {
  const review = reviewCrmRecord({
    email: "customer@example.com",
    stage: "quoted",
    quoteStatus: "sent",
    quoteViewed: true,
    updatedAt: "2026-08-04T12:00:00.000Z",
  }, NOW);
  assert.equal(review.label, "成交窗口");
  assert.equal(review.action, "contact");
});

test("没有电话和邮箱时阻止自动跟进", () => {
  const review = reviewCrmRecord({ stage: "new_lead" }, NOW);
  assert.equal(review.label, "资料阻塞");
  assert.equal(review.action, "complete_profile");
});

test("标记当前结果中相同电话或邮箱的疑似重复客户", () => {
  const duplicateIds = findPotentialDuplicateCustomerIds([
    { id: "a", phone: "+1 (416) 555-0100" },
    { id: "b", phone: "4165550100" },
    { id: "c", email: "Sales@Example.com" },
    { id: "d", email: "sales@example.com" },
    { id: "e", phone: "123" },
  ]);
  assert.deepEqual([...duplicateIds].sort(), ["a", "b", "c", "d"]);
});
