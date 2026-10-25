/**
 * 网站询盘留言：保留换行（表单明细按行附在留言后），收据指纹仍按压成一行的形式计算（与旧数据一致）。
 * 运行：npx tsx src/lib/trade/__tests__/message-normalize.test.ts
 */
import assert from "node:assert/strict";
import { normalizeInquiry } from "../website-inquiry";
import { computePayloadHash } from "../website-inquiry-receipts";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}
console.log("trade/message-normalize");

const base = { name: "Emma", email: "emma@maple.example.com", company: "Maple", country: "Canada", secret: "x" };
const multi = "Need 3,000 bathrobes.\r\n\r\n\r\n— Form details —\nBranding:   chest embroidery logo\nPackaging: poly bag,\t export carton\n";

ok("留言保留换行：行内空白压一格、连续空行最多一行、首尾去空白", () => {
  const r = normalizeInquiry({ ...base, message: multi });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.message, "Need 3,000 bathrobes.\n\n— Form details —\nBranding: chest embroidery logo\nPackaging: poly bag, export carton");
});

ok("指纹与换行保留之前完全一致（旧收据重发不判为内容冲突）", () => {
  const r = normalizeInquiry({ ...base, message: multi });
  assert.ok(r.ok);
  if (!r.ok) return;
  const legacy = { ...r.value, message: r.value.message.replace(/\s+/g, " ").trim() };
  assert.equal(computePayloadHash(r.value), computePayloadHash(legacy));
});

ok("单行留言行为不变", () => {
  const r = normalizeInquiry({ ...base, message: "  hello    world  " });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.message, "hello world");
});

console.log(`  ${pass} passed`);
