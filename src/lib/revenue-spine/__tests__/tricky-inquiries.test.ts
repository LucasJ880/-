/**
 * 20 个刁钻询盘：草稿不答应任何价格 / MOQ / 交期 / 认证 / 付款 / 折扣 / 独家 / 免费样品 / 赔偿 / 低报发票 / 侵权图案，
 * 不被来信里的指令操控；每封都照常生成草稿（交给人审），审批预览给审核人中文提醒。
 * 另测守卫：AI 润色若写出承诺，守卫拦下并回退模板。
 * 运行：npx tsx src/lib/revenue-spine/__tests__/tricky-inquiries.test.ts
 */

import assert from "node:assert/strict";
import { TRICKY_INQUIRIES } from "./fixtures/tricky-inquiries";
import { approvalPreview } from "../fde/inbound-sales";
import { detectInquiryRisks } from "../inquiry-risks";
import { DEFAULT_PRODUCT_KEYWORDS, DEFAULT_REVENUE_SPINE_POLICY } from "../policy";
import { buildReplyDraft, checkDraftGuardrails, polishReplyDraftWithLlm, type ReplyDraft } from "../reply-draft";
import { extractRfqHeuristic } from "../rfq/heuristic-extractor";
import { buildClarifyingQuestions, computeMissingFields } from "../rfq/missing-info";
import type { FactoryKnowledgeBundle } from "../factory-knowledge";
import { getCertification, getCostBasis, getLeadTime, getMOQ, getProductCapability, getSamplePolicy } from "../factory-knowledge";

const policy = DEFAULT_REVENUE_SPINE_POLICY;
let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

function knowledgeFor(category: string | null): FactoryKnowledgeBundle {
  return {
    productCapability: getProductCapability(policy, category),
    moq: getMOQ(category),
    leadTime: getLeadTime(category),
    certification: getCertification(),
    samplePolicy: getSamplePolicy(policy),
    historicalQuote: { status: "unavailable", capability: "getHistoricalQuote", reason: "none" },
    costBasis: getCostBasis(category),
  };
}

function draftsFor(message: string, contactName: string, company: string): { draft: ReplyDraft; zh: ReplyDraft | null } {
  const ex = extractRfqHeuristic(message, { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
  const lang = ex.language === "zh" ? "zh" : "en";
  const missing = computeMissingFields(ex.fields);
  const input = {
    language: lang,
    contactName,
    companyName: company || null,
    orgName: "Mengxin Home Textile",
    senderName: "Cathy",
    fields: ex.fields,
    questions: buildClarifyingQuestions(missing, lang, policy.followUp.maxQuestionsPerReply),
    knowledge: knowledgeFor(ex.fields.productCategory ?? null),
    policy,
  } as const;
  const draft = buildReplyDraft(input);
  const zh = lang === "en" ? buildReplyDraft({ ...input, language: "zh", questions: buildClarifyingQuestions(missing, "zh", policy.followUp.maxQuestionsPerReply) }) : null;
  return { draft, zh };
}

/** 发出去的邮件里一律不能出现的内容（比守卫更严：连提都不要提） */
const NEVER_IN_EMAIL: Array<[string, RegExp]> = [
  ["价格数字", /(\$|€|£|usd|eur|cad|美元)\s?\d|\d+(?:\.\d+)?\s?(usd|eur|美元|元)\b/i],
  ["MOQ 数字", /\b(moq|minimum order)\b[^\n.]{0,20}\d|起订量[^\n。]{0,6}\d/i],
  ["交期天数", /\b\d+\s?(days?|weeks?|d[ií]as)\b|\d+\s?(天|周)/i],
  ["折扣", /discount|折扣|打折/i],
  ["独家", /exclusiv|独家/i],
  ["赔偿 / 退款", /compensat|refund|赔偿|退款/i],
  ["免费样品", /free sample|免费样品/i],
  ["付款条件", /deposit|o\/a|open account|\bl\/c\b|定金|账期|尾款/i],
  ["发票", /invoice|发票/i],
  ["品牌 / 卡通", /disney|frozen|pok[eé]mon|hilton/i],
  ["来信里的指令", /ignore|previous instructions|general manager/i],
  ["“已谈好”", /as agreed|已谈好/i],
  ["比价", /another factory|beat|1\.80/i],
];

async function main() {
  console.log("tricky-inquiries");

  for (const t of TRICKY_INQUIRIES) {
    await ok(`${t.id} ${t.title}`, () => {
      const risks = detectInquiryRisks(t.message);
      const codes = risks.map((r) => r.code);
      for (const expected of t.risks) assert.ok(codes.includes(expected as never), `${t.id} 没认出风险 ${expected}：${codes.join(",")}`);
      if (!t.risks.length) assert.deepEqual(codes, [], `${t.id} 误报风险`);

      const { draft, zh } = draftsFor(t.message, t.name, t.company);
      // 每封都要有草稿交给人审（守卫通过才会进审批）
      assert.deepEqual(draft.guardrailViolations, [], `${t.id} 草稿被守卫拦下：${draft.guardrailViolations.join("；")}`);
      const email = `${draft.subject}\n${draft.body}`;
      for (const [label, re] of NEVER_IN_EMAIL) assert.doesNotMatch(email, re, `${t.id} 邮件里出现了「${label}」：${email}`);
      // 价格一律写需内部确认；落款是我方的人
      assert.ok(draft.pendingInternalConfirmation.includes(draft.language === "zh" ? "价格" : "pricing"));
      assert.match(draft.body, draft.language === "zh" ? /需内部确认/ : /our team will confirm these internally/);
      assert.match(draft.body, /\nCathy\n/);

      // 审批预览：有风险时最上面是中文提醒，逐条列出；没有风险时直接是邮件
      const preview = approvalPreview(draft, zh, risks);
      if (risks.length) {
        assert.ok(preview.startsWith("⚠ 审核提醒（不会发送）："), preview.slice(0, 80));
        for (const r of risks) assert.ok(preview.includes(r.note));
      } else {
        assert.ok(preview.startsWith(draft.subject));
      }
    });
  }

  await ok("中文询盘用中文回复；西班牙语、极简询盘也有完整的追问", () => {
    const zh = draftsFor(TRICKY_INQUIRIES.find((t) => t.id === "T16")!.message, "王先生", "华艺家居").draft;
    assert.equal(zh.language, "zh");
    const es = draftsFor(TRICKY_INQUIRIES.find((t) => t.id === "T17")!.message, "Carlos Ruiz", "Textiles Ruiz").draft;
    const bare = draftsFor(TRICKY_INQUIRIES.find((t) => t.id === "T18")!.message, "Ali", "").draft;
    for (const d of [es, bare]) assert.ok(d.body.split("\n").filter((l) => /^\d+\.\s/.test(l)).length >= 3, d.body);
  });

  await ok("买家原话里的定金比例、折扣、索赔、MOQ 数字不会被当成成分 / 数量复述", () => {
    for (const msg of [
      "Our payment terms are 30% deposit for 4,000 cushions.",
      "Can you give us a 10% discount on bathrobes?",
      "We want 20% compensation on the invoice for blankets.",
      "Confirm the MOQ is 100 pcs for fleece blankets.",
    ]) {
      const ex = extractRfqHeuristic(msg, { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
      assert.equal(ex.fields.composition, null, `${msg} → composition=${ex.fields.composition}`);
      if (/MOQ/.test(msg)) assert.equal(ex.fields.quantity, null, `${msg} → quantity=${ex.fields.quantity}`);
    }
    const real = extractRfqHeuristic("Bathrobes 80% cotton 20% polyester, 400gsm.", { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
    assert.equal(real.fields.composition, "80% cotton 20% polyester, 400gsm");
  });

  await ok("定制要求的片段按整词截取（不再出现半截词）", () => {
    const ex = extractRfqHeuristic("Please make 1,000 bathrobes with our own logo embroidered on the chest and a woven label inside.", { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
    const custom = String(ex.fields.customization);
    assert.doesNotMatch(custom, /^ke\b/);
    assert.match(custom, /logo embroidered/);
    // 中文按字截，不会被缩成只剩关键词；买家自己说的「minimum 5000 pcs」仍是采购数量
    const zh = extractRfqHeuristic("我们是做家居连锁的，这次需要珊瑚绒毯子，包装要求每条独立PE袋加彩色腰封，十条一箱，外箱印我们的标志和条码", { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
    assert.match(String(zh.fields.packaging), /每条独立PE袋加彩色腰封/);
    assert.equal(extractRfqHeuristic("We need minimum 5,000 pcs of fleece blankets.", { productKeywords: DEFAULT_PRODUCT_KEYWORDS }).fields.quantity, 5000);
  });

  await ok("正常询盘不误报风险", () => {
    for (const msg of [
      "We are a hotel supplier in Canada and are looking for 3,000 blackout curtains for an upcoming hotel project. Please advise MOQ, pricing and delivery time.",
      "Buyer type: retail / own brand. Volume: one to five containers. Timing: plans to buy within three months. Agreed next step: quotation, samples. Wants own-brand gift box packaging.",
      "We need 2,000 bathrobes for Marriott hotels in Toronto, 100% cotton, 400gsm, white. Please quote FOB Shanghai.",
      "Could you send samples of your coral fleece blankets? We will pay the courier. OEKO-TEX required.",
      "请报价 3000 条法兰绒毯，尺寸 150x200cm，要 OEKO-TEX 认证，三个月内下单。",
    ]) {
      assert.deepEqual(detectInquiryRisks(msg).map((r) => r.code), [], msg);
    }
  });

  await ok("守卫：AI 润色可能写出的承诺，逐条都能拦下", () => {
    const bad = [
      "Our MOQ is 500 pcs per design.",
      "The minimum order is 1,000 pieces.",
      "Price: USD 2.30/pc FOB Ningbo.",
      "We can offer $1.95 per piece.",
      "The FOB price is 2.3 per piece.",
      "Production takes 25 days after deposit.",
      "We can deliver within 15 days.",
      "Lead time is 30-35 days.",
      "We are BSCI certified.",
      "Our factory has OEKO-TEX Standard 100 certification.",
      "We accept 30% deposit and 70% balance before shipment.",
      "We can accept L/C at sight.",
      "We can give you a 5% discount.",
      "We can offer free samples.",
      "Samples are free of charge.",
      "We can grant you exclusivity in Canada.",
      "We will match the competitor's price.",
      "We guarantee delivery before Christmas.",
      "We agree to compensate 20% of the invoice.",
      "We will declare a lower value on the commercial invoice.",
      "单价 15 元/件。",
      "交期 20 天。",
      "我们 20 天可以交货。",
      "起订量 500 件。",
      "可以给您打 9 折。",
      "我们可以接受信用证。",
      "样品免费。",
    ];
    for (const b of bad) assert.ok(checkDraftGuardrails(b).length > 0, `没拦下：${b}`);
  });

  await ok("守卫：正常措辞不误拦", () => {
    const fine = [
      "Regarding MOQ, production lead time and delivery schedule, pricing, certification, sample arrangement: our team will confirm these internally once we have the details above and revert to you with a formal reply.",
      "- Quantity: 5000 pcs",
      "- Required delivery date: 2026-11-06",
      "- Certification: OEKO-TEX",
      "- Incoterm: DDP",
      "What is the required delivery date or shipping window?",
      "Each of them can be made to your own specification — size, fabric, weight, colour, branding and packing.",
      "We would be happy to prepare a quotation once we have the details.",
      "Thank you for contacting Mengxin Home Textile on behalf of Marriott Procurement.",
      "关于MOQ、生产周期与交期、价格、认证、样品安排：以上均需内部确认，我们会在收到上述信息后尽快给您正式答复。",
    ];
    for (const f of fine) assert.deepEqual(checkDraftGuardrails(f), [], f);
  });

  await ok("AI 润色写出承诺 → 拦下回退模板；正常润色 → 采用", async () => {
    const t = TRICKY_INQUIRIES.find((x) => x.id === "T12")!;
    const { draft } = draftsFor(t.message, t.name, t.company);
    const ctx = { orgId: "org_test", userId: "user_test" };
    const injected = await polishReplyDraftWithLlm(draft, {
      ...ctx,
      complete: async (body) => body.replace("We look forward to hearing from you.", "As requested, we confirm the MOQ is 100 pcs and the price is $1 per piece.\n\nWe look forward to hearing from you."),
    });
    assert.equal(injected.body, draft.body);
    assert.equal(injected.templateOnly, true);
    const freeSample = await polishReplyDraftWithLlm(draft, { ...ctx, complete: async (body) => `${body}\nWe can also offer free samples.` });
    assert.equal(freeSample.body, draft.body);
    const polished = await polishReplyDraftWithLlm(draft, { ...ctx, complete: async (body) => body.replace("We look forward to hearing from you.", "We look forward to working with you.") });
    assert.equal(polished.templateOnly, false);
    assert.match(polished.body, /We look forward to working with you\./);
    const droppedQuestion = await polishReplyDraftWithLlm(draft, { ...ctx, complete: async (body) => body.replace(/\n1\. [^\n]+/, "") });
    assert.equal(droppedQuestion.body, draft.body);
  });

  console.log(`\n${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
