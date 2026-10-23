/**
 * P1-5 quoteNotes 回读 — 与 inbound-apply 的 notesAppend 做往返测试（写 → 读 → 相等）。§4-9 在此。
 * 运行：npx tsx src/lib/tender-rfq/__tests__/notes-parse.test.ts
 */
import assert from "node:assert/strict";
import { appendQuoteNotes, planInquiryItemUpdate, type ExistingInquiryItem } from "../inbound-apply";
import { INBOUND_CONTRACT_VERSION } from "../inbound-contract";
import type { ParsedQuote } from "../inbound-parse";
import { parseAutoNotes } from "../notes-parse";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, `${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const EMAIL_DATE = new Date("2026-10-25T09:00:00Z");
const sentItem: ExistingInquiryItem = { status: "sent", unitPrice: null, totalPrice: null, currency: "CAD", deliveryDays: null, validUntil: null, quoteNotes: null };

function quote(o: Partial<ParsedQuote>): ParsedQuote {
  return {
    contractVersion: INBOUND_CONTRACT_VERSION, isQuote: true, declined: false, currency: "CAD", prices: [],
    deliveryDays: null, deliveryEvidence: null, validUntil: null, validUntilEvidence: null, moq: null,
    incoterm: null, incotermEvidence: null, mandatoryAnswers: [], missingFields: [], attachmentsSeen: [],
    validUntilInferred: false, rejected: [], ...o,
  };
}

console.log("tender-rfq notes-parse");

/* §4-9 */
{
  // 证据里故意带"；"和"，"——它们也是 notes 的分隔符
  const parsed = quote({
    prices: [
      { quantity: 1500, unitPrice: 42.5, totalPrice: 63750, evidence: "1,500 个：单价 CAD 42.50，总价 63,750；含包装" },
      { quantity: 3000, unitPrice: 40, totalPrice: null, evidence: "3,000 个以上单价 CAD 40.00" },
    ],
    moq: 500,
    incoterm: "DDP",
    incotermEvidence: "报价为 DDP Ottawa，含关税",
    deliveryDays: 35,
    deliveryEvidence: "交期 35 天",
    mandatoryAnswers: [
      { requirementCode: "R-01", answer: "满足", evidence: "R-01：满足，面料 1000D Cordura；已附检测报告" },
      { requirementCode: "R-05", answer: "未答", evidence: null },
    ],
  });
  const plan = planInquiryItemUpdate(sentItem, parsed, 1500, EMAIL_DATE, { messageId: "msg-9", now: new Date("2026-10-25T10:00:00Z") });
  const notes = appendQuoteNotes("人工备注：电话里说可以再谈 5%；起订量=99999；贸易条款=EXW", plan.notesAppend);
  const back = parseAutoNotes(notes);

  ok("§4-9 往返：起订量 500", back.moq === 500, back);
  ok("§4-9 往返：贸易条款 DDP", back.incoterm === "DDP");
  ok("§4-9 往返：两档价完全相等", JSON.stringify(back.tiers) === JSON.stringify([
    { quantity: 1500, unitPrice: 42.5, totalPrice: 63750 },
    { quantity: 3000, unitPrice: 40, totalPrice: null },
  ]), back.tiers);
  ok("§4-9 往返：强制项 R-01 满足（证据原样）/ R-05 未答", JSON.stringify(back.mandatoryAnswers) === JSON.stringify([
    { requirementCode: "R-01", answer: "满足", evidence: "R-01：满足，面料 1000D Cordura；已附检测报告" },
    { requirementCode: "R-05", answer: "未答", evidence: null },
  ]), back.mandatoryAnswers);
  ok("§4-9 人工在前面手写的一行（含「起订量=99999」等同形文字）不影响解析", back.moq === 500 && back.incoterm === "DDP");
  ok("§4-9 lastAutoAt = 段时间戳", back.lastAutoAt === "2026-10-25T10:00:00.000Z");
}

/* 多段：每个字段取最新一段里出现的值 */
{
  const first = planInquiryItemUpdate(sentItem, quote({ moq: 500, incoterm: "FOB", incotermEvidence: "FOB Ningbo", prices: [{ quantity: null, unitPrice: 41, totalPrice: null, evidence: "单价 41" }] }), 1500, EMAIL_DATE, { messageId: "m1", now: new Date("2026-10-25T10:00:00Z") });
  const second = planInquiryItemUpdate({ ...sentItem, status: "quoted", unitPrice: 41 }, quote({ incoterm: "DDP", incotermEvidence: "改报 DDP", mandatoryAnswers: [{ requirementCode: "R-01", answer: "不满足", evidence: "R-01 做不到" }] }), 1500, EMAIL_DATE, { messageId: "m2", now: new Date("2026-10-27T10:00:00Z") });
  // 故意先写后到的段，验证按时间而非行序取"最新"
  const notes = [second.notesAppend, first.notesAppend].join("\n");
  const back = parseAutoNotes(notes);
  ok("多段：贸易条款取最新段（DDP）", back.incoterm === "DDP");
  ok("多段：最新段没提起订量 → 沿用更早段（500）", back.moq === 500);
  ok("多段：最新段没报价 → 档位沿用更早段", back.tiers.length === 1 && back.tiers[0].unitPrice === 41, back.tiers);
  ok("多段：强制项按编号取最新", back.mandatoryAnswers.length === 1 && back.mandatoryAnswers[0].answer === "不满足");
  ok("多段：lastAutoAt 取时间最晚的段", back.lastAutoAt === "2026-10-27T10:00:00.000Z");
}

/* 只认 [auto …] 段 */
{
  ok("空 / 纯人工备注 → 全空", JSON.stringify(parseAutoNotes("报价含运费；起订量=300；贸易条款=FOB")) === JSON.stringify({ lastMissingFields: [], moq: null, incoterm: null, tiers: [], mandatoryAnswers: [], lastAutoAt: null }));
  ok("null → 全空", parseAutoNotes(null).lastAutoAt === null);
  const only = planInquiryItemUpdate(sentItem, quote({ isQuote: false, currency: null }), 1500, EMAIL_DATE, { messageId: "m3", now: new Date("2026-10-25T10:00:00Z") });
  const back = parseAutoNotes(only.notesAppend);
  ok("无报价内容的回信段：只更新 lastAutoAt", back.lastAutoAt !== null && back.tiers.length === 0 && back.moq === null);
}

/* 多档对不上第一档时，planner 不入表、全部写「其它档」——回读仍能拿到全部档位 */
{
  const plan = planInquiryItemUpdate(sentItem, quote({ prices: [
    { quantity: 1000, unitPrice: 45, totalPrice: null, evidence: "1000 个 45" },
    { quantity: 5000, unitPrice: 38, totalPrice: null, evidence: "5000 个 38" },
  ] }), 1500, EMAIL_DATE, { messageId: "m4", now: new Date("2026-10-25T10:00:00Z") });
  const back = parseAutoNotes(plan.notesAppend);
  ok("对不上第一档：回读到两档「其它档」", back.tiers.length === 2 && back.tiers[0].quantity === 1000 && back.tiers[1].unitPrice === 38, back.tiers);
}

/* P1-7：「缺：…」往返（写 → 读），只看最新一段 */
{
  const plan = planInquiryItemUpdate(sentItem, quote({ currency: null, validUntil: null, missingFields: ["currency", "validUntil"] }), 1500, EMAIL_DATE, { messageId: "m5", now: new Date("2026-10-25T10:00:00Z") });
  const back = parseAutoNotes(plan.notesAppend);
  ok("P1-7 往返：「缺：」回读成字段 key（与 planner 的 missingFields 一致）", JSON.stringify(back.lastMissingFields) === JSON.stringify(plan.missingFields) && plan.missingFields.length > 0, { back: back.lastMissingFields, plan: plan.missingFields });
  const later = `${plan.notesAppend}\n[auto 2026-10-26T10:00:00.000Z msg=m6] 币种=USD`;
  ok("P1-7：最新一段没有「缺：」→ 不再缺", parseAutoNotes(later).lastMissingFields.length === 0);
}

console.log(`\ntender-rfq notes-parse: ${passed} passed`);
