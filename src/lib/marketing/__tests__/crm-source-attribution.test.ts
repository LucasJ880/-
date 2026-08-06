import assert from "node:assert/strict";
import test from "node:test";
import {
  isConfirmedMarketingWin,
  normalizeCrmMarketingSource,
} from "../crm-source-attribution";

test("CRM 来源别名统一映射到营销渠道", () => {
  assert.equal(normalizeCrmMarketingSource("google_ads"), "google_ads");
  assert.equal(normalizeCrmMarketingSource("Instagram"), "meta");
  assert.equal(normalizeCrmMarketingSource("Instagram Ads"), "meta");
  assert.equal(normalizeCrmMarketingSource("Google 广告"), "google_ads");
  assert.equal(normalizeCrmMarketingSource("", "Facebook"), "meta");
  assert.equal(normalizeCrmMarketingSource(null, "小红书"), "xiaohongshu");
  assert.equal(normalizeCrmMarketingSource("referral"), null);
});

test("商机来源优先于客户来源", () => {
  assert.equal(
    normalizeCrmMarketingSource("xiaohongshu", "google_ads"),
    "xiaohongshu",
  );
});

test("只有明确签约/履约阶段或 wonAt 才计为成交", () => {
  assert.equal(
    isConfirmedMarketingWin({ stage: "negotiation", wonAt: null }),
    false,
  );
  assert.equal(
    isConfirmedMarketingWin({ stage: "signed", wonAt: null }),
    true,
  );
  assert.equal(
    isConfirmedMarketingWin({
      stage: "quoted",
      wonAt: new Date("2026-08-01T00:00:00Z"),
    }),
    true,
  );
});
