/**
 * T-1 询价进展通知 — 纯逻辑测试（spec tender/rfq-notifications）
 * - 文案表每行一例；文字规则（项目名截断、名单、字段顺序）
 * - 按段脱敏：标题摘要不命中敏感判定，含金额的名字整段替换
 * - 四类去重键；同一批卡顺序不同键相同
 * - 催单待批：多张卡的文案与优先级（「一轮只调一次」由 tracking-notify.test.ts 执行验证）
 * - 收件人组合
 * - 缺字段标签与 Muse hooks 的表逐字相同（防漂移）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSensitiveText, REDACTED_TEXT } from "@/lib/notifications/collab/redact";
import { INBOUND_MISSING_LABEL } from "../inbound-contract";
import {
  RFQ_CHASE_READY,
  RFQ_NO_RESPONSE,
  RFQ_QUOTE_RECEIVED,
  RFQ_REPLY_RECEIVED,
  chaseReadyNotice,
  chaseReadySourceKey,
  missingFieldList,
  nameList,
  noResponseNotice,
  projectLabel,
  quoteReceivedNotice,
  replyReceivedNotice,
  roundObjectLabel,
  trackingRecipients,
  type DraftedCard,
  type RoundRef,
  type TrackingNotice,
} from "../tracking-notify-pure";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function eq<T>(name: string, actual: T, expected: T) {
  assert.deepEqual(actual, expected, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const ROUND: RoundRef = { inquiryId: "inq-2", projectId: "proj-1", projectName: "Alberta 露营装备", roundNumber: 2 };
const P = "Alberta 露营装备";
const chase = (name: string, id: string): DraftedCard => ({ actionId: id, supplierName: name, kind: "no_reply", missingFields: [] });
const ask = (name: string, id: string, fields: DraftedCard["missingFields"]): DraftedCard => ({ actionId: id, supplierName: name, kind: "missing_fields", missingFields: fields });

const all: TrackingNotice[] = [];
const keep = (n: TrackingNotice | null) => {
  if (n) all.push(n);
  return n;
};

console.log("报价与回信通知的文案");
{
  const full = keep(quoteReceivedNotice({ round: ROUND, itemId: "it-a", messageId: "m-1", supplierName: "甲厂", missingFields: [] }))!;
  eq("报价字段齐：标题", full.title, `甲厂报价了 · ${P}`);
  eq("报价字段齐：摘要", full.summary, "第 2 轮询价：报价已自动进表，可以去比价了。");
  eq("报价：类型与优先级", [full.type, full.priority], [RFQ_QUOTE_RECEIVED, "medium"]);

  const partial = keep(quoteReceivedNotice({ round: ROUND, itemId: "it-a", messageId: "m-2", supplierName: "甲厂", missingFields: ["validUntil", "currency"] }))!;
  eq("报价缺字段：标题", partial.title, `甲厂报价了 · ${P}`);
  eq("报价缺字段：摘要按固定顺序（币种在有效期前）", partial.summary, "第 2 轮询价：报价已自动进表；还缺：币种、有效期。");

  const reply = keep(replyReceivedNotice({ round: ROUND, itemId: "it-b", messageId: "m-3", supplierName: "乙厂" }))!;
  eq("回信无报价：标题", reply.title, `乙厂回信了，没有报价 · ${P}`);
  eq("回信无报价：摘要", reply.summary, "第 2 轮询价：需要你看一眼原文。");
  eq("回信：类型与优先级", [reply.type, reply.priority], [RFQ_REPLY_RECEIVED, "medium"]);
  ok("回信通知不声称已起草追问", !/追问/.test(reply.title + reply.summary));
}

console.log("催单待批（只有催单）");
{
  const one = keep(chaseReadyNotice({ round: ROUND, days: 3, cards: [chase("丙厂", "a1")] }))!;
  eq("1 封：标题", one.title, `丙厂该催了，催单已起草，等你批准 · ${P}`);
  eq("1 封：摘要", one.summary, "第 2 轮：超过 3 天没回。48 小时内不批会过期。");
  eq("1 封：类型与优先级", [one.type, one.priority], [RFQ_CHASE_READY, "high"]);

  const two = keep(chaseReadyNotice({ round: ROUND, days: 3, cards: [chase("丙厂", "a1"), chase("丁厂", "a2")] }))!;
  eq("多封：标题", two.title, `2 家供应商该催了，催单已起草，等你批准 · ${P}`);
  eq("多封：摘要", two.summary, "第 2 轮：丙厂、丁厂超过 3 天没回。48 小时内不批会过期。");

  const five = keep(chaseReadyNotice({ round: ROUND, days: 3, cards: ["甲厂", "乙厂", "丙厂", "丁厂", "戊厂"].map((n, i) => chase(n, `c${i}`)) }))!;
  eq("名单超过 3 家：标题", five.title, `5 家供应商该催了，催单已起草，等你批准 · ${P}`);
  eq("名单超过 3 家：摘要", five.summary, "第 2 轮：甲厂、乙厂、丙厂等 5 家超过 3 天没回。48 小时内不批会过期。");
  eq("催单天数随轮次", chaseReadyNotice({ round: ROUND, days: 5, cards: [chase("丙厂", "a1")] })!.summary, "第 2 轮：超过 5 天没回。48 小时内不批会过期。");
}

console.log("催单待批（只有追问）");
{
  const one = keep(chaseReadyNotice({ round: ROUND, days: 3, cards: [ask("甲厂", "q1", ["validUntil"])] }))!;
  eq("1 封：标题", one.title, `甲厂的报价缺有效期，追问已起草 · ${P}`);
  eq("1 封：摘要", one.summary, "第 2 轮：批准后在原邮件线程里追问。48 小时内不批会过期。");
  eq("1 封：优先级 medium", one.priority, "medium");
  eq("1 封缺多个字段：按固定顺序", chaseReadyNotice({ round: ROUND, days: 3, cards: [ask("甲厂", "q1", ["incoterm", "deliveryDays"])] })!.title, `甲厂的报价缺交期、贸易条款，追问已起草 · ${P}`);

  const many = keep(chaseReadyNotice({ round: ROUND, days: 3, cards: [ask("甲厂", "q1", ["validUntil"]), ask("乙厂", "q2", ["moq"])] }))!;
  eq("多封：标题", many.title, `2 家报价缺信息，追问已起草 · ${P}`);
  eq("多封：摘要", many.summary, "第 2 轮：批准后在原邮件线程里追问。48 小时内不批会过期。");
  eq("多封：优先级 medium", many.priority, "medium");
}

console.log("催单待批（催单与追问）");
{
  const mixed = keep(chaseReadyNotice({ round: ROUND, days: 3, cards: [chase("丙厂", "a1"), chase("丁厂", "a2"), ask("甲厂", "q1", ["validUntil"])] }))!;
  eq("两封催单一封追问：标题", mixed.title, `3 封催单 / 追问已起草，等你批准 · ${P}`);
  eq("两封催单一封追问：摘要", mixed.summary, "第 2 轮：丙厂、丁厂超过 3 天没回；甲厂报价缺有效期。48 小时内不批会过期。");
  eq("催单 + 追问：优先级 high", mixed.priority, "high");

  const multiAsk = keep(chaseReadyNotice({ round: ROUND, days: 3, cards: [chase("丙厂", "a1"), ask("甲厂", "q1", ["validUntil"]), ask("乙厂", "q2", ["moq"])] }))!;
  eq("多家追问：标题", multiAsk.title, `3 封催单 / 追问已起草，等你批准 · ${P}`);
  eq("多家追问：摘要", multiAsk.summary, "第 2 轮：丙厂超过 3 天没回；甲厂、乙厂报价缺信息。48 小时内不批会过期。");

  ok("本轮没有新卡 → 不发", chaseReadyNotice({ round: ROUND, days: 3, cards: [] }) === null);
}

console.log("未响应通知的文案");
{
  const two = keep(noResponseNotice({ round: ROUND, itemId: "it-e", supplierName: "戊厂", reason: "two_chases" }))!;
  eq("催满两次：标题", two.title, `戊厂没有回复，已标未响应 · ${P}`);
  eq("催满两次：摘要", two.summary, "第 2 轮：催了两次仍未回复。可以换一家供应商再问。");
  eq("未响应：类型与优先级", [two.type, two.priority], [RFQ_NO_RESPONSE, "medium"]);
  const late = keep(noResponseNotice({ round: ROUND, itemId: "it-f", supplierName: "己厂", reason: "deadline" }))!;
  eq("截止已过：标题", late.title, `己厂没有回复，已标未响应 · ${P}`);
  eq("截止已过：摘要", late.summary, "第 2 轮：回复截止已过仍未回复。可以换一家供应商再问。");
}

console.log("文字规则");
{
  const name30 = "一二三四五六七八九十".repeat(3);
  eq("项目名 30 字 → 前 24 字加「…」", projectLabel(name30), `${name30.slice(0, 24)}…`);
  eq("项目名正好 24 字不截断", projectLabel(name30.slice(0, 24)), name30.slice(0, 24));
  eq("项目名按字截断（不切坏 emoji）", projectLabel(`${"😀".repeat(25)}`), `${"😀".repeat(24)}…`);
  ok("标题里用截断后的项目名", quoteReceivedNotice({ round: { ...ROUND, projectName: name30 }, itemId: "i", messageId: "m", supplierName: "甲厂", missingFields: [] }).title.endsWith(`${name30.slice(0, 24)}…`));
  eq("空项目名回落", projectLabel("  "), "未命名项目");
  eq("名单 3 家不加「等」", nameList(["甲厂", "乙厂", "丙厂"]), "甲厂、乙厂、丙厂");
  eq("名单 4 家", nameList(["甲厂", "乙厂", "丙厂", "丁厂"]), "甲厂、乙厂、丙厂等 4 家");
  eq("字段顺序：价格、币种、交期、有效期、起订量、贸易条款", missingFieldList(["incoterm", "moq", "validUntil", "deliveryDays", "currency", "price"]), "价格、币种、交期、有效期、起订量、贸易条款");
  eq("字段去重", missingFieldList(["moq", "moq"]), "起订量");
  eq("邮件对象名", roundObjectLabel(ROUND), `项目「${P}」第 2 轮询价`);
}

console.log("对象与跳转");
for (const n of all) {
  ok(`${n.type}「${n.title.slice(0, 12)}…」对象为询价轮次`, n.entityType === "tender_rfq_round" && n.entityId === "inq-2" && n.projectId === "proj-1");
  ok(`${n.type}「${n.title.slice(0, 12)}…」metadata 只有 objectLabel`, Object.keys(n.metadata).join(",") === "objectLabel" && n.metadata.objectLabel === `项目「${P}」第 2 轮询价`);
}

console.log("不输出敏感内容");
for (const n of all) {
  ok(`${n.type}「${n.title.slice(0, 12)}…」标题不命中敏感判定`, !isSensitiveText(n.title));
  ok(`${n.type}「${n.title.slice(0, 12)}…」摘要不命中敏感判定`, !isSensitiveText(n.summary));
  ok(`${n.type}「${n.title.slice(0, 12)}…」不含价格数字或币种`, !/\d+\.\d|USD|CAD|RMB|\$|¥/.test(JSON.stringify(n)));
}
{
  const moneyProject = quoteReceivedNotice({ round: { ...ROUND, projectName: "预算 $120,000 的营地" }, itemId: "i", messageId: "m", supplierName: "甲厂", missingFields: [] });
  eq("含金额的项目名整段替换，标题其余照常", moneyProject.title, `甲厂报价了 · ${REDACTED_TEXT}`);
  ok("对象名同样替换", moneyProject.metadata.objectLabel === `项目「${REDACTED_TEXT}」第 2 轮询价`);
  const phoneSupplier = noResponseNotice({ round: ROUND, itemId: "i", supplierName: "丙厂 416-555-0199", reason: "deadline" });
  eq("含电话的供应商名整段替换", phoneSupplier.title, `${REDACTED_TEXT}没有回复，已标未响应 · ${P}`);
  const inNames = chaseReadyNotice({ round: ROUND, days: 3, cards: [chase("丙厂", "a1"), chase("报价 USD 89.50 的厂", "a2")] })!;
  ok("名单里含金额的名字整段替换", inNames.summary.includes(REDACTED_TEXT) && !/89\.50|USD/.test(inNames.summary));
}

console.log("去重键");
{
  eq("报价", quoteReceivedNotice({ round: ROUND, itemId: "it-a", messageId: "m-1", supplierName: "甲厂", missingFields: [] }).sourceKeyPrefix, "rfq_quote_received:it-a:m-1");
  eq("回信", replyReceivedNotice({ round: ROUND, itemId: "it-b", messageId: "m-3", supplierName: "乙厂" }).sourceKeyPrefix, "rfq_reply_received:it-b:m-3");
  eq("未响应", noResponseNotice({ round: ROUND, itemId: "it-e", supplierName: "戊厂", reason: "two_chases" }).sourceKeyPrefix, "rfq_no_response:it-e");
  const k1 = chaseReadySourceKey("inq-2", ["a2", "a1", "q1"]);
  ok("催单待批：格式 rfq_chase_ready:<轮次>:<16 位 hex>", /^rfq_chase_ready:inq-2:[0-9a-f]{16}$/.test(k1));
  eq("同一批卡顺序不同键相同", chaseReadySourceKey("inq-2", ["q1", "a1", "a2"]), k1);
  ok("新多一张卡 → 键不同", chaseReadySourceKey("inq-2", ["a1", "a2", "q1", "q2"]) !== k1);
  ok("不同轮次 → 键不同", chaseReadySourceKey("inq-3", ["a1", "a2", "q1"]) !== k1);
  eq("通知用的就是这个键", chaseReadyNotice({ round: ROUND, days: 3, cards: [chase("丙厂", "a1"), chase("丁厂", "a2"), ask("甲厂", "q1", ["validUntil"])] })!.sourceKeyPrefix, k1);
  ok("同一封回信再处理一次 → 同一个键", quoteReceivedNotice({ round: ROUND, itemId: "it-a", messageId: "m-1", supplierName: "甲厂", missingFields: ["moq"] }).sourceKeyPrefix === "rfq_quote_received:it-a:m-1");
}

console.log("收件人");
{
  eq("报价：负责人 ∪ 发起人", trackingRecipients(RFQ_QUOTE_RECEIVED, { ownerId: "A", roundCreatorId: "B" }), ["A", "B"]);
  eq("回信：负责人 ∪ 发起人", trackingRecipients(RFQ_REPLY_RECEIVED, { ownerId: "A", roundCreatorId: "B" }), ["A", "B"]);
  eq("未响应：负责人 ∪ 发起人", trackingRecipients(RFQ_NO_RESPONSE, { ownerId: "A", roundCreatorId: "B" }), ["A", "B"]);
  eq("负责人就是发起人 → 一个", trackingRecipients(RFQ_QUOTE_RECEIVED, { ownerId: "A", roundCreatorId: "A" }), ["A"]);
  eq("催单待批只给负责人", trackingRecipients(RFQ_CHASE_READY, { ownerId: "A", roundCreatorId: "B" }), ["A"]);
  eq("缺负责人时只剩发起人", trackingRecipients(RFQ_NO_RESPONSE, { ownerId: null, roundCreatorId: "B" }), ["B"]);
}

console.log("缺字段标签与 Muse hooks 一致");
{
  const hooks = readFileSync(join(process.cwd(), "src/lib/muse-bridge/hooks.ts"), "utf8");
  const block = hooks.slice(hooks.indexOf("const MISSING_FIELD_LABELS"), hooks.indexOf("};", hooks.indexOf("const MISSING_FIELD_LABELS")));
  const fromHooks = Object.fromEntries([...block.matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
  eq("两张表逐字相同", fromHooks, { ...INBOUND_MISSING_LABEL });
}

console.log("纯模块不连库、不调 LLM");
{
  const src = readFileSync(join(process.cwd(), "src/lib/tender-rfq/tracking-notify-pure.ts"), "utf8");
  ok("不导入 db", !/from "@\/lib\/db"/.test(src));
  ok("不导入 LLM 客户端", !/ai\/client|openai|anthropic|createCompletion/i.test(src));
}

console.log(`\nT-1 tracking-notify-pure: ${passed} passed`);
