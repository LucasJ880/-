/**
 * 询盘 SLA 提醒决策纯函数测试
 * 运行：npx tsx src/lib/trade/__tests__/inquiry-sla.test.ts
 */

import assert from "node:assert/strict";
import { decideInquiryReminders, formatWaiting } from "../inquiry-sla";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("inquiry-sla");

const at = new Date("2026-09-05T10:00:00Z");
const thread = (id: string, waitingMinutes: number | null, replied = false) => ({
  prospectId: id,
  companyName: `Co ${id}`,
  channel: "website",
  replied,
  waitingMinutes,
  lastInboundAt: at,
});

ok("3 分钟未回复：不提醒", () => {
  assert.deepEqual(decideInquiryReminders([thread("a", 3)]), []);
});

ok("12 分钟未回复：只发首响提醒，幂等键含进线时间戳", () => {
  const r = decideInquiryReminders([thread("a", 12)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].level, "first_response");
  assert.equal(r[0].sourceKey, `inquiry-sla:5m:a:${at.getTime()}`);
});

ok("25 小时未回复：首响 + 升级两档都出", () => {
  const r = decideInquiryReminders([thread("a", 25 * 60)]);
  assert.deepEqual(r.map((x) => x.level).sort(), ["escalation", "first_response"]);
  assert.ok(r.some((x) => x.sourceKey.startsWith("inquiry-sla:24h:a:")));
});

ok("已回复或无等待时长的线程不提醒", () => {
  assert.deepEqual(decideInquiryReminders([thread("a", 30, true), thread("b", null)]), []);
});

ok("等待时长格式化", () => {
  assert.equal(formatWaiting(7), "7 分钟");
  assert.equal(formatWaiting(180), "3 小时");
  assert.equal(formatWaiting(3000), "2 天");
});

console.log(`\ninquiry-sla: ${pass} 通过`);
