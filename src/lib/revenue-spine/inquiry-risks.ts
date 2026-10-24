/**
 * Revenue Spine — 来信风险提醒（给审核人看的中文提示，不进邮件）
 *
 * 买家压价、要折扣、要独家、催交期、要证书、提付款条件、要免费样品、冒称已谈好、索赔、
 * 要求低报发票、侵权图案、试图操控 AI……这些都不能在草稿里答应。
 * 检测到就：审批标题加 ⚠、审批预览最上面列出提醒；草稿不复述含这些内容的买家原话。
 */

export type InquiryRiskCode =
  | "competitor_price"
  | "discount_request"
  | "rush_deadline"
  | "certification_claim"
  | "payment_terms"
  | "free_sample"
  | "exclusivity"
  | "ip_license"
  | "prompt_injection"
  | "claimed_agreement"
  | "compensation_claim"
  | "under_invoicing"
  | "ddp_terms";

export interface InquiryRisk {
  code: InquiryRiskCode;
  /** 给审核人的中文提醒 */
  note: string;
}

const BRANDS =
  /\b(disney|frozen|pok[eé]mon|pikachu|marvel|avengers|spider-?man|hello kitty|sanrio|harry potter|barbie|paw patrol|peppa pig|star wars|minions|nike|adidas|gucci|chanel|louis vuitton|hermes|burberry|hilton|marriott|hyatt|sheraton|four seasons|ritz[- ]carlton|ikea|nba|nfl)\b/i;

/** 交期是否紧：≤ 30 天 */
function rushDays(text: string): number | null {
  const res = [
    /\b(?:within|in|en|dentro de)\s+(\d{1,3})\s*(?:working\s+|business\s+)?(?:days?|d[ií]as)\b/gi,
    /(\d{1,3})\s*(?:个)?(?:天|日)(?:之内|以内|内)?(?:交货|到货|出货|发货|交)/g,
  ];
  let min: number | null = null;
  for (const re of res) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (n > 0 && n <= 30 && (min === null || n < min)) min = n;
    }
  }
  return min;
}

const RULES: Array<{ code: InquiryRiskCode; test: (t: string) => string | null }> = [
  {
    code: "prompt_injection",
    test: (t) =>
      /\b(ignore|disregard|forget)\b[^.\n]{0,20}\b(previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(instructions?|prompts?|rules)\b|system prompt|\bas an ai\b|忽略(之前|以上|前面|上面)的?(所有)?(指令|提示|规则)/i.test(t)
        ? "来信里有试图操控 AI 的指令（如 “ignore previous instructions”）：草稿已忽略这些内容，请人工核对每一句"
        : null,
  },
  {
    code: "under_invoicing",
    test: (t) =>
      /\b(lower|reduce|less|under)[^.\n]{0,40}\b(value|price|amount)\b[^.\n]{0,40}\binvoice|\binvoice[^.\n]{0,40}\b(lower|less|reduced?|under)\b[^.\n]{0,20}\b(value|price|amount)|undervalu|低报|少报|做低.{0,4}(发票|货值|金额)/i.test(t)
        ? "买家要求在发票上低报货值（逃税）：不能答应"
        : null,
  },
  {
    code: "ip_license",
    test: (t) => {
      // 品牌名本身不算（Marriott 的采购来询盘很正常）；要把品牌印 / 绣到产品上，或明说没有授权，才提醒
      const brand = BRANDS.exec(t)?.[0];
      const onProduct = /\b(logo|print(?:ed|ing)?|embroider\w*|characters?|pattern|design|graphics?)\b|图案|印花|印|绣/i.test(t);
      const noLicense = /\b(without|no|don'?t have|do not have)\b[^.\n]{0,12}\blicen[cs]e|没有授权|无授权|未授权|仿牌|高仿/i.test(t);
      if (!(brand && onProduct) && !noLicense) return null;
      return `买家要用品牌 / 卡通图案${brand ? `（${brand}）` : ""}：没有授权就是侵权。先要授权书，没有授权不能做，邮件里也不要答应`;
    },
  },
  {
    code: "claimed_agreement",
    test: (t) =>
      /\b(as (?:we )?(?:agreed|discussed|confirmed|promised)|you (?:already |have )?(?:agreed|confirmed|promised|offered|quoted))\b[^\n]{0,80}\b(price|moq|usd|discount|lead time|delivery|terms|\$)|(已经|之前|上次)(谈好|说好|确认|答应)/i.test(t)
        ? "买家说价格 / MOQ / 条件“已经谈好”：先找对应业务员核实，邮件里不要确认"
        : null,
  },
  {
    code: "compensation_claim",
    test: (t) =>
      /\b(compensation|compensate|refund|chargeback|reimburse|claim for|complain(?:t|ts)?)\b|\b(last|previous|our)\s+(shipment|order|delivery)\b[^.\n]{0,60}\b(defects?|defective|damaged|broken|problems?|issues?)\b|赔偿|退款|索赔|质量问题|投诉/i.test(t)
        ? "质量投诉 / 索赔：转老板处理，邮件里不要认责，也不要答应赔偿或退款"
        : null,
  },
  {
    code: "competitor_price",
    test: (t) =>
      /\b(another|other|different)\s+(factory|supplier|vendor|manufacturer)[^.\n]{0,60}\b(quot|offer|price)|\bbeat (?:that|their|this|the) price|\bcheaper than\b|\bmatch (?:their|that|the|this) price|别家|其他(工厂|供应商).{0,10}(报价|价格)|比.{0,8}便宜/i.test(t)
        ? "买家拿别家报价压价：邮件里不要比价、不要给价格，报价走内部流程"
        : null,
  },
  {
    code: "discount_request",
    test: (t) => (/\bdiscount|\d+\s?%\s?off\b|折扣|打折|优惠|返点/i.test(t) ? "买家要折扣：需老板批准，邮件里不要答应" : null),
  },
  {
    code: "rush_deadline",
    test: (t) => {
      const d = rushDays(t);
      return d ? `买家要求 ${d} 天内交货 / 到货：先和生产确认能不能做到，邮件里不要答应日期` : null;
    },
  },
  {
    code: "certification_claim",
    test: (t) =>
      /\b(send|share|provide|attach)\b[^.\n]{0,40}\bcertificat|\bcertificat\w*\b[^.\n]{0,20}\bcop(?:y|ies)\b|\bdo you have\b[^.\n]{0,40}\b(bsci|sedex|smeta|oeko|gots|grs|iso\s?9001|wrap|amfori|certificat)|(提供|发|给).{0,6}(证书|认证)|有没有.{0,10}(证书|认证|验厂)/i.test(t)
        ? "买家要证书（BSCI / OEKO-TEX / GOTS 等）：只能提供梦馨真实持有的证书，没有的不要说有"
        : null,
  },
  {
    code: "payment_terms",
    test: (t) =>
      /\b(payment terms?|deposit|balance (?:after|before|against|upon)|o\/a|open account|net\s?\d{2}\b|l\/c|letter of credit|days? after (?:arrival|delivery|receipt))|账期|定金|尾款|付款方式|信用证/i.test(t)
        ? "买家提出付款条件（定金比例 / 账期 / 信用证）：需老板确认，邮件里不要答应"
        : null,
  },
  {
    code: "free_sample",
    test: (t) =>
      /\bfree samples?\b|\bsamples? (?:for|at|free of) (?:free|charge|no cost)|\b(you|your side)\b[^.\n]{0,20}\b(pay|cover|bear)\b[^.\n]{0,20}\b(courier|shipping|freight|express)|免费样品|样品免费|(运费|快递费).{0,8}(你们|贵司|你方)(出|承担|付)/i.test(t)
        ? "买家要免费样品 / 要我方付快递费：按样品政策确认后再回复"
        : null,
  },
  {
    code: "exclusivity",
    test: (t) => (/\bexclusiv|\bsole (?:agent|distributor|supplier)|独家|总代理/i.test(t) ? "买家要独家：需老板决定，邮件里不要答应" : null),
  },
  {
    code: "ddp_terms",
    test: (t) =>
      /\bddp\b|landed cost|duty[- ](?:paid|included)|including (?:duty|duties|customs)|包税|双清/i.test(t)
        ? "买家要 DDP / 包税到岸价：需要物流和报关先确认，报价不要漏掉关税和清关费用"
        : null,
  },
];

/** 检测来信（或一段文字）里需要审核人注意的要求；顺序固定，同一类只报一次 */
export function detectInquiryRisks(text: string): InquiryRisk[] {
  const t = text ?? "";
  if (!t.trim()) return [];
  const out: InquiryRisk[] = [];
  for (const r of RULES) {
    const note = r.test(t);
    if (note) out.push({ code: r.code, note });
  }
  return out;
}

/** 只是提醒、本身不是要我方让步的类别：草稿照常复述（DDP 贸易术语） */
const INFORMATIONAL: ReadonlySet<InquiryRiskCode> = new Set(["ddp_terms"]);

/** 这段买家原话能不能在草稿里复述（含折扣、定金、索赔、品牌图案、给 AI 的指令等就不复述） */
export function unsafeToRepeat(text: string): boolean {
  return detectInquiryRisks(text).some((r) => !INFORMATIONAL.has(r.code));
}

/** 审批预览最上面的提醒块（中文，不会发送）；reminders = 与来信无关的固定提醒（如跟进前确认买家没在别处回过） */
export function formatRiskNotes(risks: InquiryRisk[], reminders: string[] = []): string {
  const lines = [...risks.map((r) => r.note), ...reminders];
  if (!lines.length) return "";
  return ["⚠ 审核提醒（不会发送）：", ...lines.map((l) => `- ${l}`)].join("\n");
}
