/**
 * P1-4 回信解析 — 证据闸测试（注入假 complete，验证编造字段会被作废）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/inbound-parse.test.ts
 */
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  INBOUND_CONTRACT_VERSION,
  formatRfqContactNotes,
  parseRfqThreadId,
  rfqContextFromBody,
  verifyEvidence,
  type InboundQuote,
} from "../inbound-contract";
import {
  InboundParseError,
  datesIn,
  deriveDeliveryDays,
  parseInboundQuote,
  stripQuotedReply,
  type ParseCompleteFn,
} from "../inbound-parse";
import { pickPriceTier, planInquiryItemUpdate } from "../inbound-apply";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

const EMAIL_DATE = new Date("2026-10-25T09:00:00Z");

function llm(partial: Partial<InboundQuote>): ParseCompleteFn {
  return async () => JSON.stringify({
    contractVersion: INBOUND_CONTRACT_VERSION, isQuote: false, declined: false, currency: null, prices: [],
    deliveryDays: null, deliveryEvidence: null, validUntil: null, validUntilEvidence: null, moq: null,
    incoterm: null, incotermEvidence: null, mandatoryAnswers: [], missingFields: [], attachmentsSeen: [], ...partial,
  });
}

const parse = (bodyText: string, complete: ParseCompleteFn, extra: { attachments?: Parameters<typeof parseInboundQuote>[0]["attachments"]; mandatoryCodes?: string[] } = {}) =>
  parseInboundQuote({ bodyText, attachments: extra.attachments ?? [], emailDate: EMAIL_DATE, mandatoryCodes: extra.mandatoryCodes ?? [] }, { complete });

async function main() {
  console.log("tender-rfq inbound-parse");

  // ── 证据闸：编造的字段作废 ──
  {
    const r = await parse("单价 CAD 42.50。", llm({
      isQuote: true, currency: "CAD",
      prices: [{ quantity: null, unitPrice: 39.9, totalPrice: null, evidence: "单价 CAD 42.50" }], // 值不在证据里
    }));
    ok("价格值不在证据片段里 → 作废", r.prices.length === 0 && r.rejected.some((x) => x.reason === "VALUE_NOT_IN_EVIDENCE"));
  }
  {
    const r = await parse("单价 CAD 42.50。", llm({
      isQuote: true, prices: [{ quantity: null, unitPrice: 42.5, totalPrice: null, evidence: "单价 CAD 42.50，含税" }], // 证据被改写
    }));
    ok("证据片段被改写（原文无「含税」）→ 作废", r.prices.length === 0 && r.rejected[0]?.reason === "EVIDENCE_NOT_IN_TEXT");
  }
  {
    const r = await parse("Unit  price:\n CAD 42.50", llm({ isQuote: true, prices: [{ quantity: null, unitPrice: 42.5, totalPrice: null, evidence: "Unit price: CAD 42.50" }] }));
    ok("空白/换行差异不影响逐字比较", r.prices.length === 1);
  }
  {
    const r = await parse("报价 FOB Ningbo，单价 USD 3.20。", llm({
      isQuote: true, currency: "USD", prices: [{ quantity: null, unitPrice: 3.2, totalPrice: null, evidence: "单价 USD 3.20" }],
      incoterm: "CIF", incotermEvidence: "报价 FOB Ningbo",
    }));
    ok("Incoterm 与证据不符（证据写 FOB，LLM 说 CIF）→ 作废", r.incoterm === null && r.currency === "USD");
  }
  {
    const r = await parse("MOQ 500 pcs. Unit price USD 3.20.", llm({ isQuote: true, moq: 800, prices: [{ quantity: null, unitPrice: 3.2, totalPrice: null, evidence: "Unit price USD 3.20" }] }));
    ok("起订量与原文不符 → 作废", r.moq === null);
    const r2 = await parse("MOQ 500 pcs. Unit price USD 3.20.", llm({ isQuote: true, moq: 500 }));
    ok("起订量与原文一致 → 保留", r2.moq === 500);
  }
  {
    const r = await parse("R-01 满足，面料为 1000D Cordura。", llm({
      mandatoryAnswers: [
        { requirementCode: "R-01", answer: "满足", evidence: "R-01 满足，面料为 1000D Cordura" },
        { requirementCode: "R-02", answer: "满足", evidence: "R-02 满足" }, // 编造：原文没有
        { requirementCode: "R-99", answer: "满足", evidence: "R-01 满足" }, // 不是本次 RFQ 的编号
      ],
    }), { mandatoryCodes: ["R-01", "R-02"] });
    const byCode = Object.fromEntries(r.mandatoryAnswers.map((a) => [a.requirementCode, a.answer]));
    ok("强制项：有证据的保留「满足」", byCode["R-01"] === "满足");
    ok("强制项：无证据的降级为「未答」", byCode["R-02"] === "未答");
    ok("强制项：未知编号丢弃", !("R-99" in byCode) && r.rejected.some((x) => x.reason === "UNKNOWN_CODE"));
  }

  // ── 引用的原询价不能当证据 ──
  {
    const body = [
      "您好，交期 45 天，单价 CAD 40.00。",
      "",
      "在 2026年10月22日 周四 10:00，Qyan-Sunny Purchasing <project@sunnyshutter.ca> 写道：",
      "> - 数量：1500 / 3000（请分档报价）",
      "> - 交付要求：下单后 60 天内交付",
    ].join("\n");
    ok("stripQuotedReply 去掉「写道」之后的引用", !stripQuotedReply(body).includes("60 天内交付"));
    const r = await parse(body, llm({ isQuote: true, deliveryDays: 60, deliveryEvidence: "下单后 60 天内交付" }));
    ok("LLM 引用我方询价原文当交期证据 → 作废", r.deliveryDays === null);
    const outlook = "Price CAD 40.\n\nFrom: Purchasing <project@sunnyshutter.ca>\nSent: Thursday, October 22, 2026\nSubject: RFQ\nQty 1500";
    ok("stripQuotedReply 识别 Outlook 原始邮件头", stripQuotedReply(outlook) === "Price CAD 40.");
  }

  // ── 契约 fail-closed ──
  {
    let err: unknown = null;
    try { await parse("x", async () => "不是 JSON"); } catch (e) { err = e; }
    ok("LLM 返回非 JSON → InboundParseError", err instanceof InboundParseError);
    err = null;
    try { await parse("x", async () => JSON.stringify({ contractVersion: "tender-rfq-inbound/v0" })); } catch (e) { err = e; }
    ok("版本字面量不符 → InboundParseError", err instanceof InboundParseError);
    const r = await parse("收到", async () => "```json\n" + (await llm({ isQuote: false })({} as never)) + "\n```");
    ok("```json 围栏可容忍", r.isQuote === false);
  }

  // ── 确定性推导 ──
  ok("交期：35 天", deriveDeliveryDays("交期 35 天") === 35);
  ok("交期：4-6 周 → 取上限 42 天", deriveDeliveryDays("lead time 4-6 weeks") === 42);
  ok("交期：2 个月 → 60 天", deriveDeliveryDays("生产周期 2 个月") === 60);
  ok("交期：10 个工作日 → 14 天", deriveDeliveryDays("10 个工作日发货") === 14);
  ok("交期：现货 → 0", deriveDeliveryDays("现货，可立即发") === 0);
  ok("交期：说不清 → null（不猜）", deriveDeliveryDays("尽快安排") === null);
  ok("日期：中文 / 斜杠 / ISO 等价", datesIn("有效期至2026年11月30日").includes("2026-11-30") && datesIn("valid until 2026/11/30").includes("2026-11-30"));
  {
    const r = await parse("本报价 30 天有效。单价 CAD 5.00", llm({ isQuote: true, validUntilEvidence: "本报价 30 天有效", validUntil: null }));
    ok("「30 天有效」→ 邮件日期 +30 天并标记推算", r.validUntil === "2026-11-24" && r.validUntilInferred === true);
    const p = planInquiryItemUpdate({ status: "sent", unitPrice: null, totalPrice: null, currency: "CAD", deliveryDays: null, validUntil: null, quoteNotes: null }, r, null, EMAIL_DATE, { messageId: "m", now: EMAIL_DATE });
    ok("推算的有效期在 notes 注明「由邮件日期推算」", p.notesAppend.includes("由邮件日期 2026-10-25 推算"));
  }
  {
    const r = await parse("Price: $42.50 each", llm({ isQuote: true, currency: "USD", prices: [{ quantity: null, unitPrice: 42.5, totalPrice: null, evidence: "Price: $42.50 each" }] }));
    ok("裸 $ 有歧义 → 不采信 USD", r.currency === null);
    const r2 = await parse("单价人民币 12 元", llm({ isQuote: true, currency: "CNY" }));
    ok("人民币 → CNY 采信", r2.currency === "CNY");
  }

  // ── 币种不覆盖人工值 ──
  {
    const r = await parse("单价 CAD 5.00", llm({ isQuote: true, currency: "CAD", prices: [{ quantity: null, unitPrice: 5, totalPrice: null, evidence: "单价 CAD 5.00" }] }));
    const manualUsd = { status: "sent", unitPrice: null, totalPrice: null, currency: "USD", deliveryDays: null, validUntil: null, quoteNotes: null };
    const p = planInquiryItemUpdate(manualUsd, r, null, EMAIL_DATE, { messageId: "m", now: EMAIL_DATE });
    ok("币种已被人工改成 USD → 回信 CAD 不覆盖，记不一致", p.data.currency === undefined && p.notesAppend.includes("回信币种 CAD 与已录 USD 不一致"));
    const r2 = await parse("单价 5.00", llm({ isQuote: true, prices: [{ quantity: null, unitPrice: 5, totalPrice: null, evidence: "单价 5.00" }] }));
    ok("人工已定 USD 且回信没写币种 → 不列缺 currency", !planInquiryItemUpdate(manualUsd, r2, null, EMAIL_DATE, { messageId: "m", now: EMAIL_DATE }).missingFields.includes("currency"));
  }

  // ── 多档价选档 ──
  {
    const tiers = [
      { quantity: 1500, unitPrice: 42.5, totalPrice: null, evidence: "a" },
      { quantity: 3000, unitPrice: 40, totalPrice: null, evidence: "b" },
    ];
    ok("多档：取询价第一档数量那档", pickPriceTier(tiers, 1500).chosen?.unitPrice === 42.5);
    ok("多档都对不上第一档 → 不选（不猜）", pickPriceTier(tiers, 1000).chosen === null);
    ok("只有一档 → 用它", pickPriceTier([tiers[1]], 1500).chosen?.unitPrice === 40);
  }

  // ── 附件文本化 ──
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Item", "Qty", "Unit price (CAD)"], ["Backpack", 1500, 41.25]]), "Quote");
    const xlsx = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const r = await parse("请见附件报价单。", llm({ isQuote: true, currency: "CAD", prices: [{ quantity: 1500, unitPrice: 41.25, totalPrice: null, evidence: "Backpack,1500,41.25" }] }), {
      attachments: [{ filename: "quote.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: xlsx }],
    });
    ok("XLSX 附件转 CSV 文本并可作证据", r.attachmentsSeen[0].parsed && r.prices[0]?.unitPrice === 41.25);
    const bad = await parse("见附件", llm({}), { attachments: [{ filename: "broken.pdf", mimeType: "application/pdf", data: Buffer.from("not a pdf") }] });
    ok("损坏的 PDF → parsed=false 并说明，不抛", bad.attachmentsSeen[0].parsed === false && bad.attachmentNotes[0].includes("无法解析"));
  }

  // ── threadId 记录 / 读取、RFQ 上下文 ──
  {
    const notes = formatRfqContactNotes("18f2a", "18f29_x-Z", new Date("2026-10-22T10:00:00Z"));
    ok("contactNotes 写入 threadId 并可解析", notes.startsWith("Gmail messageId=18f2a threadId=18f29_x-Z · ") && parseRfqThreadId(notes) === "18f29_x-Z");
    ok("P1-3 旧格式（无 threadId）→ null（不参与匹配）", parseRfqThreadId("Gmail messageId=18f2a · 2026-10-22T10:00:00Z") === null);
    const ctx = rfqContextFromBody("二、商务条件\n- 数量：1500 / 3000（请分档报价）\n1. 【强制】R-01 规格\n2. 【评分】R-02 x\n3. 【强制】R-05 样品");
    ok("RFQ 正文 → 第一档数量 1500 与强制编号", ctx.firstTierQty === 1500 && ctx.mandatoryCodes.join() === "R-01,R-05");
    ok("RFQ 未明确数量 → firstTierQty=null", rfqContextFromBody("- 数量：招标文件未明确数量，请按贵司常规阶梯（如 100 / 500 / 1000）分别报价。").firstTierQty === null);
    ok("verifyEvidence 空证据一律不算", !verifyEvidence("abc", "") && !verifyEvidence("abc", null));
  }

  console.log(`\ntender-rfq inbound-parse: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
