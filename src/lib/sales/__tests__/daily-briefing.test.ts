import assert from "node:assert/strict";
import test from "node:test";
import { parseCachedSalesBriefing } from "../daily-briefing";

test("parses Notification metadata JSON before returning a cached briefing", () => {
  const briefing = parseCachedSalesBriefing(JSON.stringify({
    date: "2026-08-05",
    stats: { activeOpportunities: 12, signedThisMonth: 3, invalid: "4" },
    urgentItems: [{ title: "跟进报价", description: "今天到期", severity: "urgent", category: "quote" }],
    aiSummary: "今日简报",
    generatedAt: "2026-08-05T12:00:00.000Z",
  }));

  assert.equal(briefing?.stats.activeOpportunities, 12);
  assert.equal(briefing?.stats.signedThisMonth, 3);
  assert.equal(briefing?.stats.invalid, undefined);
  assert.equal(briefing?.urgentItems.length, 1);
});

test("rejects malformed or legacy cached metadata", () => {
  assert.equal(parseCachedSalesBriefing("not-json"), null);
  assert.equal(parseCachedSalesBriefing(JSON.stringify({ urgentItems: [] })), null);
  assert.equal(parseCachedSalesBriefing(null), null);
});
