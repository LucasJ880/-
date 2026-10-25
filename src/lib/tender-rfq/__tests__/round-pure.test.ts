/**
 * P1-2/P1-3 轮次决策 — 纯逻辑测试
 * 运行：npx tsx src/lib/tender-rfq/__tests__/round-pure.test.ts
 */
import assert from "node:assert/strict";
import {
  decideRoundLock, hashRfqPayloadItems, partitionSuppliers, previewRfqPayload,
  readCriticalFactSlot, readTenderRfqSettings, resolveSender, type ExistingRound,
} from "../round-pure";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const now = new Date("2026-10-22T12:00:00Z");
const round = (o: Partial<ExistingRound>): ExistingRound => ({ inquiryId: "inq", roundNumber: 1, status: "in_progress", createdAt: new Date("2026-10-21T09:00:00Z"), createdByName: "Evan", sentCount: 3, hasPendingSend: false, ...o });

console.log("tender-rfq settings");
{
  const s = readTenderRfqSettings(null, {});
  ok("默认抬头 Qyan-Sunny Purchasing", s.fromName === "Qyan-Sunny Purchasing");
  ok("默认发件 project@sunnyshutter.ca", s.fromEmail === "project@sunnyshutter.ca");
  ok("默认回复提前 7 天、轮次锁 3 天", s.replyLeadDays === 7 && s.roundLockDays === 3);
  const s2 = readTenderRfqSettings({ tenderRfq: { fromName: " 采购部 ", fromEmail: "Buy@Example.com", roundLockDays: 1 } }, { TENDER_RFQ_FROM_NAME: "env-name" });
  ok("org settings 优先于 env，邮箱小写、抬头去空格", s2.fromName === "采购部" && s2.fromEmail === "buy@example.com" && s2.roundLockDays === 1);
  const s3 = readTenderRfqSettings({}, { TENDER_RFQ_FROM_NAME: "env-name" });
  ok("org 未配置时取 env", s3.fromName === "env-name");
  ok("邮箱拆分：设置缺省时 mailboxEmail === fromEmail", s.mailboxEmail === s.fromEmail && s2.mailboxEmail === "buy@example.com");
  const s4 = readTenderRfqSettings({ tenderRfq: { fromEmail: "project@sunnyshutter.ca", mailboxEmail: " Lucas@SunnyShutter.ca " } }, { TENDER_RFQ_MAILBOX_EMAIL: "env@x.com" });
  ok("邮箱拆分：org 的 mailboxEmail 优先、小写去空格；fromEmail 不受影响", s4.mailboxEmail === "lucas@sunnyshutter.ca" && s4.fromEmail === "project@sunnyshutter.ca");
  const s5 = readTenderRfqSettings({ tenderRfq: { fromEmail: "project@sunnyshutter.ca" } }, { TENDER_RFQ_MAILBOX_EMAIL: "Lucas@SunnyShutter.ca" });
  ok("邮箱拆分：org 未配 mailboxEmail 时取 env TENDER_RFQ_MAILBOX_EMAIL", s5.mailboxEmail === "lucas@sunnyshutter.ca");
}

console.log("tender-rfq round lock");
{
  ok("无轮次 → 不锁", !decideRoundLock([], now, 3).locked);
  const v1 = decideRoundLock([round({ hasPendingSend: true })], now, 3);
  ok("已有待批发送 → 锁 pending_approval，文案含创建人", v1.locked && v1.reason === "pending_approval" && v1.message.includes("Evan"));
  const v2 = decideRoundLock([round({})], now, 3);
  ok("1 天前发过 3 家 → 锁 recently_sent，文案含家数", v2.locked && v2.reason === "recently_sent" && v2.message.includes("3 家"));
  ok("超过锁定期 → 不锁", !decideRoundLock([round({ createdAt: new Date("2026-10-15T09:00:00Z") })], now, 3).locked);
  ok("已完成的轮次不锁", !decideRoundLock([round({ status: "completed" })], now, 3).locked);
  ok("建了但一家都没发 → 不锁", !decideRoundLock([round({ sentCount: 0 })], now, 3).locked);
}

console.log("tender-rfq suppliers");
{
  const { ready, blocked } = partitionSuppliers([
    { id: "a", name: "A厂", contactEmail: "a@x.com", status: "active" },
    { id: "b", name: "B厂", contactEmail: null, status: "active" },
    { id: "c", name: "C厂", contactEmail: "bad-email", status: "active" },
    { id: "d", name: "D厂", contactEmail: "d@x.com", status: "inactive" },
  ]);
  ok("只有有合法邮箱且 active 的进 ready", ready.map((s) => s.id).join() === "a");
  ok("无邮箱/坏邮箱/停用分别标记", blocked.map((b) => `${b.id}:${b.reason}`).join() === "b:no_email,c:no_email,d:inactive");
}

console.log("tender-rfq sender");
{
  const scope = (s: string | null) => !!s && s.includes("gmail.compose");
  const r1 = resolveSender([{ userId: "u9", accountEmail: "Project@SunnyShutter.ca", grantedScopes: "openid gmail.compose" }], "project@sunnyshutter.ca", scope);
  ok("按邮箱（不区分大小写）找到发件账号", r1.ok && r1.userId === "u9");
  const r2 = resolveSender([{ userId: "u1", accountEmail: "evan@x.com", grantedScopes: "gmail.compose" }], "project@sunnyshutter.ca", scope);
  ok("审批人自己的邮箱不算 → SENDER_NOT_CONNECTED", !r2.ok && r2.errorCode === "SENDER_NOT_CONNECTED");
  const r3 = resolveSender([{ userId: "u9", accountEmail: "project@sunnyshutter.ca", grantedScopes: "openid" }], "project@sunnyshutter.ca", scope);
  ok("缺 compose scope → SENDER_NO_COMPOSE_SCOPE", !r3.ok && r3.errorCode === "SENDER_NO_COMPOSE_SCOPE");
  // 邮箱拆分：按授权账号（mailboxEmail = lucas@）查，From 显示 project@
  const lucas = [{ userId: "u-lucas", accountEmail: "lucas@sunnyshutter.ca", grantedScopes: "gmail.compose gmail.readonly" }];
  const r4 = resolveSender(lucas, "lucas@sunnyshutter.ca", scope);
  ok("邮箱拆分：resolveSender 用 mailboxEmail 命中 lucas@ 的授权", r4.ok && r4.userId === "u-lucas");
  const r5 = resolveSender(lucas, "project@sunnyshutter.ca", scope);
  ok("邮箱拆分：拿显示地址 project@ 去查不会误命中", !r5.ok && r5.errorCode === "SENDER_NOT_CONNECTED");
  const r6 = resolveSender([], "lucas@sunnyshutter.ca", scope);
  ok("邮箱拆分：未连接文案写明授权邮箱", !r6.ok && r6.message.startsWith("授权邮箱 lucas@sunnyshutter.ca 未连接"));
}

console.log("tender-rfq critical facts");
{
  ok("factId 形状", JSON.stringify(readCriticalFactSlot({ criticalFacts: { quantity: { status: "KNOWN", factId: "f1" } } }, "quantity")) === '{"factId":"f1"}');
  ok("text 形状", JSON.stringify(readCriticalFactSlot({ criticalFacts: { delivery: { status: "KNOWN", text: "60 天" } } }, "delivery")) === '{"text":"60 天"}');
  ok("字符串形状", JSON.stringify(readCriticalFactSlot({ criticalFacts: { location: "Ottawa" } }, "location")) === '{"text":"Ottawa"}');
  ok("UNKNOWN → null", readCriticalFactSlot({ criticalFacts: { quantity: { status: "UNKNOWN" } } }, "quantity") === null);
  ok("N/A → null", readCriticalFactSlot({ criticalFacts: { quantity: { status: "KNOWN", text: "N/A" } } }, "quantity") === null);
  ok("脏值不抛", readCriticalFactSlot("garbage", "quantity") === null && readCriticalFactSlot(null, "x") === null);
}

console.log("tender-rfq payload");
{
  const items = [{ inquiryItemId: "i1", supplierId: "s1", supplierName: "A厂", to: "a@x.com", subject: "询价：P", body: "hello" }];
  const h = hashRfqPayloadItems(items);
  ok("hash 稳定且 16 位", h.length === 16 && h === hashRfqPayloadItems(items));
  ok("正文改一字 hash 变", hashRfqPayloadItems([{ ...items[0], body: "hello!" }]) !== h);
  const pv = previewRfqPayload({ projectId: "p", inquiryId: "i", roundNumber: 2, fromName: "Qyan-Sunny Purchasing", fromEmail: "project@sunnyshutter.ca", items, rfqDocHash: h });
  ok("预览含轮次/家数/发件人/收件人，不含正文", pv.includes("第 2 轮") && pv.includes("1 封") && pv.includes("project@sunnyshutter.ca") && pv.includes("a@x.com") && !pv.includes("hello"));
}
console.log(`\ntender-rfq round-pure: ${passed} passed`);
