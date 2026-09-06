/**
 * 询盘收件箱聚合纯函数测试
 * 运行：npx tsx src/lib/trade/__tests__/inbox-service.test.ts
 */

import assert from "node:assert/strict";
import { buildInquiryThreads, excerpt } from "../inbox-service";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("inbox-service");

const NOW = new Date("2026-09-05T12:00:00Z");
const t = (iso: string) => new Date(iso);
const prospect = (id: string, stage = "new") => ({
  id,
  companyName: `Co ${id}`,
  contactName: null,
  contactEmail: `${id}@x.com`,
  country: "US",
  stage,
  source: "website",
  score: null,
  nextFollowUpAt: null,
  lastContactAt: null,
});
const msg = (id: string, prospectId: string, direction: string, iso: string, channel = "website", content = "hi") => ({
  id, prospectId, direction, channel, subject: null, content, createdAt: t(iso),
});

ok("未回复线程：最后进线之后无出站 → replied=false，等待分钟数正确", () => {
  const threads = buildInquiryThreads(
    [msg("m1", "p1", "inbound", "2026-09-05T11:30:00Z")],
    [prospect("p1")],
    NOW,
  );
  assert.equal(threads.length, 1);
  assert.equal(threads[0].replied, false);
  assert.equal(threads[0].waitingMinutes, 30);
});

ok("已回复线程：进线后有出站 → replied=true，waiting 为 null", () => {
  const threads = buildInquiryThreads(
    [
      msg("m1", "p1", "inbound", "2026-09-05T10:00:00Z"),
      msg("m2", "p1", "outbound", "2026-09-05T10:05:00Z"),
    ],
    [prospect("p1")],
    NOW,
  );
  assert.equal(threads[0].replied, true);
  assert.equal(threads[0].waitingMinutes, null);
});

ok("回复后买家再次进线 → 重新变为待回复", () => {
  const threads = buildInquiryThreads(
    [
      msg("m1", "p1", "inbound", "2026-09-05T10:00:00Z"),
      msg("m2", "p1", "outbound", "2026-09-05T10:05:00Z"),
      msg("m3", "p1", "inbound", "2026-09-05T11:50:00Z", "whatsapp", "any update?"),
    ],
    [prospect("p1")],
    NOW,
  );
  assert.equal(threads[0].replied, false);
  assert.equal(threads[0].channel, "whatsapp");
  assert.equal(threads[0].inboundCount, 2);
  assert.equal(threads[0].lastInboundExcerpt, "any update?");
});

ok("终态线索（成交/流失/归档）不算待回复", () => {
  const threads = buildInquiryThreads(
    [msg("m1", "p1", "inbound", "2026-09-05T11:00:00Z")],
    [prospect("p1", "lost")],
    NOW,
  );
  assert.equal(threads[0].replied, true);
});

ok("只有出站消息的线索不出现在收件箱", () => {
  const threads = buildInquiryThreads(
    [msg("m1", "p1", "outbound", "2026-09-05T11:00:00Z")],
    [prospect("p1")],
    NOW,
  );
  assert.equal(threads.length, 0);
});

ok("排序：待回复优先且等得久的在前，已回复按最后进线倒序", () => {
  const threads = buildInquiryThreads(
    [
      msg("a1", "a", "inbound", "2026-09-05T11:00:00Z"),
      msg("b1", "b", "inbound", "2026-09-05T09:00:00Z"),
      msg("c1", "c", "inbound", "2026-09-05T08:00:00Z"),
      msg("c2", "c", "outbound", "2026-09-05T08:10:00Z"),
      msg("d1", "d", "inbound", "2026-09-05T07:00:00Z"),
      msg("d2", "d", "outbound", "2026-09-05T07:10:00Z"),
    ],
    [prospect("a"), prospect("b"), prospect("c"), prospect("d")],
    NOW,
  );
  assert.deepEqual(threads.map((x) => x.prospectId), ["b", "a", "c", "d"]);
});

ok("摘要压缩空白并截断", () => {
  assert.equal(excerpt("  a  b\n\nc "), "a b c");
  assert.equal(excerpt("x".repeat(200), 20).length, 20);
});

console.log(`\ninbox-service: ${pass} 通过`);
