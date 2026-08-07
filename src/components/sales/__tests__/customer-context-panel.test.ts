import assert from "node:assert/strict";
import test from "node:test";

import { deriveCustomerCommandState } from "../customer-context-panel";
import type { CustomerDetail, Opportunity, Quote } from "@/app/(main)/sales/customers/[id]/types";

const NOW = Date.parse("2026-08-07T12:00:00.000Z");

function opportunity(patch: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    title: "客厅窗帘",
    stage: "negotiation",
    estimatedValue: 5000,
    priority: "high",
    productTypes: "Shades",
    nextFollowupAt: "2026-08-08T15:00:00.000Z",
    updatedAt: "2026-08-07T10:00:00.000Z",
    _count: { quotes: 1, blindsOrders: 0 },
    ...patch,
  };
}

function quote(patch: Partial<Quote> = {}): Quote {
  return {
    id: "quote-1",
    version: 1,
    status: "sent",
    viewedAt: null,
    grandTotal: 5000,
    createdAt: "2026-08-06T10:00:00.000Z",
    items: [],
    finalDiscountPct: null,
    specialPromotion: null,
    totalMsrp: null,
    depositAmount: null,
    depositMethod: null,
    depositCollectedAt: null,
    depositNote: null,
    agreedDepositAmount: null,
    agreedBalanceAmount: null,
    ...patch,
  };
}

function customer(patch: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: "customer-1",
    name: "测试客户",
    phone: "4165550100",
    email: "customer@example.com",
    address: "Toronto",
    source: "referral",
    wechatNote: null,
    status: "active",
    tags: null,
    notes: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    opportunities: [opportunity()],
    interactions: [
      {
        id: "interaction-1",
        type: "phone_call",
        direction: "outbound",
        summary: "确认安装时间",
        content: null,
        createdAt: "2026-08-07T10:00:00.000Z",
        createdBy: { name: "Alex" },
      },
    ],
    quotes: [quote()],
    blindsOrders: [],
    ...patch,
  };
}

test("缺少联系方式时优先完善客户资料", () => {
  const state = deriveCustomerCommandState({
    customer: customer({ phone: null, email: null }),
    emailReady: true,
    activeActionCount: 0,
    nowMs: NOW,
  });
  assert.equal(state.nextAction.target, "profile");
  assert.equal(state.nextAction.label, "完善联系方式");
  assert.ok(state.missingItems.includes("补充电话或邮箱"));
});

test("签约后未登记定金时优先进入报价记录", () => {
  const state = deriveCustomerCommandState({
    customer: customer({ quotes: [quote({ status: "signed" })] }),
    emailReady: true,
    activeActionCount: 0,
    nowMs: NOW,
  });
  assert.equal(state.nextAction.target, "quotes");
  assert.equal(state.nextAction.label, "登记定金收款");
  assert.ok(state.risks.some((risk) => risk.label.includes("尚未登记定金")));
});

test("有报价但销售邮箱未绑定时给出明确阻塞", () => {
  const state = deriveCustomerCommandState({
    customer: customer(),
    emailReady: false,
    activeActionCount: 0,
    nowMs: NOW,
  });
  assert.equal(state.nextAction.target, "email");
  assert.ok(state.risks.some((risk) => risk.label.includes("邮箱尚未绑定")));
});

test("健康客户显示商机阶段并按计划继续跟进", () => {
  const state = deriveCustomerCommandState({
    customer: customer(),
    emailReady: true,
    activeActionCount: 0,
    nowMs: NOW,
  });
  assert.equal(state.stageLabel, "洽谈中");
  assert.equal(state.nextAction.target, "timeline");
  assert.equal(state.nextAction.label, "按计划继续跟进");
});
