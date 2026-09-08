/**
 * 询盘分析 — 规则层（纯函数，无 I/O）
 *
 * 1. normalizeExtraction：把 LLM 返回的 JSON 收敛成稳定结构
 * 2. complianceHints：按目的国 × 产品 × 是否儿童款 给出合规提示（对应知识包条目）
 * 3. redFlags：外贸常见骗局/低质询盘红旗
 */

export type InquiryIntent = "rfq" | "sample" | "info" | "partnership" | "spam" | "unclear";
export type BuyerType = "importer" | "brand" | "hotel" | "retailer" | "agent" | "individual" | "unknown";

export interface ExtractedInquiry {
  products: string[];
  quantity: string | null;
  specs: { material?: string; gsm?: string; size?: string; color?: string; packaging?: string };
  targetPrice: string | null;
  incotermHint: string | null;
  leadTimeAsk: string | null;
  certificationsAsked: string[];
  destinationCountry: string | null;
  isChildren: boolean;
  language: string | null;
  buyerType: BuyerType;
  intent: InquiryIntent;
  missingInfo: string[];
  summary: string;
}

const INTENTS = new Set<InquiryIntent>(["rfq", "sample", "info", "partnership", "spam", "unclear"]);
const BUYER_TYPES = new Set<BuyerType>(["importer", "brand", "hotel", "retailer", "agent", "individual", "unknown"]);

function str(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}
function strList(v: unknown, max = 12): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x, 80)).filter((x): x is string => Boolean(x)).slice(0, max);
}

export function normalizeExtraction(raw: unknown): ExtractedInquiry {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const specsRaw = (r.specs && typeof r.specs === "object" ? r.specs : {}) as Record<string, unknown>;
  const intentRaw = str(r.intent, 30)?.toLowerCase() as InquiryIntent | undefined;
  const buyerRaw = str(r.buyerType, 30)?.toLowerCase() as BuyerType | undefined;
  return {
    products: strList(r.products),
    quantity: str(r.quantity, 80),
    specs: {
      material: str(specsRaw.material, 120) ?? undefined,
      gsm: str(specsRaw.gsm, 40) ?? undefined,
      size: str(specsRaw.size, 120) ?? undefined,
      color: str(specsRaw.color, 80) ?? undefined,
      packaging: str(specsRaw.packaging, 120) ?? undefined,
    },
    targetPrice: str(r.targetPrice, 80),
    incotermHint: str(r.incotermHint, 20),
    leadTimeAsk: str(r.leadTimeAsk, 80),
    certificationsAsked: strList(r.certificationsAsked),
    destinationCountry: str(r.destinationCountry, 60),
    isChildren: r.isChildren === true,
    language: str(r.language, 20),
    buyerType: buyerRaw && BUYER_TYPES.has(buyerRaw) ? buyerRaw : "unknown",
    intent: intentRaw && INTENTS.has(intentRaw) ? intentRaw : "unclear",
    missingInfo: strList(r.missingInfo, 8),
    summary: str(r.summary, 400) ?? "",
  };
}

// ── 合规提示 ────────────────────────────────────────────────

export type Severity = "info" | "warn" | "critical";
export interface ComplianceHint {
  code: string;
  title: string;
  severity: Severity;
  detail: string;
  /** 知识库对应条目标题（点开可看全文与来源） */
  knowledgeTitle: string;
}

const US = /\b(us|usa|u\.s\.|united states|america|american)\b|美国/i;
const CA = /\b(canada|canadian)\b|加拿大/i;
const CALIFORNIA = /\b(california|ca\b|los angeles|san francisco)\b|加州/i;

const BATHROBE = /bathrobe|robe|浴袍|睡袍/i;
const BLANKET = /blanket|throw|毯/i;
const TOWEL = /towel|毛巾/i;
const BEDDING_FILLED = /comforter|duvet|quilt|pillow|被|枕/i;
const CHILDREN = /\b(kids?|children|child|baby|infant|toddler|youth)\b|儿童|婴|童/i;

export function complianceHints(x: ExtractedInquiry, freeText = ""): ComplianceHint[] {
  const text = `${x.products.join(" ")} ${freeText}`;
  const dest = `${x.destinationCountry ?? ""} ${freeText}`;
  const isUS = US.test(dest);
  const isCA = CA.test(dest);
  const isChild = x.isChildren || CHILDREN.test(text);
  const hints: ComplianceHint[] = [];

  if (BATHROBE.test(text)) {
    if (isUS || !isCA) {
      hints.push({
        code: "us_1610",
        title: "美国：浴袍属服装，须过 16 CFR 1610 可燃性",
        severity: "warn",
        detail: "报价前确认面料克重/成分能过 Class 1；毛圈布是高风险品类。",
        knowledgeTitle: "美国-浴袍与服装类强制法规",
      });
    }
    if (isChild) {
      hints.push({
        code: "child_sleepwear",
        title: "儿童浴袍 = 睡衣阻燃标准（美 16 CFR 1615/1616 · 加 SOR/2016-169）",
        severity: "critical",
        detail: "棉毛巾布基本过不了；接单前确认阻燃处理或改面料，否则不要报价。",
        knowledgeTitle: isCA ? "加拿大-标签与可燃性" : "美国-浴袍与服装类强制法规",
      });
    }
  }
  if (BLANKET.test(text)) {
    if (isCA) {
      hints.push({
        code: "ca_blanket_bedding",
        title: "加拿大：毯子按寝具管，火焰蔓延 >7 秒的强制指标",
        severity: "warn",
        detail: "SOR/2016-194 纺织品可燃性条例；报价含测试费/时间。",
        knowledgeTitle: "加拿大-标签与可燃性",
      });
    } else {
      hints.push({
        code: "us_blanket_d4151",
        title: "美国：毯子无联邦阻燃强制，买家常要 ASTM D4151（自愿）",
        severity: "info",
        detail: "问清是否要求 D4151 报告；Law Label 只针对填充类。",
        knowledgeTitle: "美国-毯子与填充寝具",
      });
    }
  }
  if (BEDDING_FILLED.test(text) && (isUS || !isCA)) {
    hints.push({
      code: "us_law_label",
      title: "美国填充寝具：多州要求 Law Label / URN 登记号",
      severity: "warn",
      detail: "用进口商的登记号；工厂自己办不下来。",
      knowledgeTitle: "美国-毯子与填充寝具",
    });
  }
  if (isCA) {
    hints.push({
      code: "ca_bilingual_label",
      title: "加拿大：标签须英法双语 + CA 号（进口商的）",
      severity: "warn",
      detail: "Textile Labelling Act；CA 号只发给加拿大企业。",
      knowledgeTitle: "加拿大-标签与可燃性",
    });
  }
  if (isUS) {
    hints.push({
      code: "us_labels",
      title: "美国：纤维成分标签（16 CFR 303）+ 洗护标签（16 CFR 423）+ 原产国",
      severity: "info",
      detail: "RN 号用进口商的；儿童产品另加 CPSIA 追溯标签与 CPC。",
      knowledgeTitle: "美国-浴袍与服装类强制法规",
    });
    if (CALIFORNIA.test(dest)) {
      hints.push({
        code: "prop65",
        title: "加州：Prop 65 化学物警示（2028 前旧短式可用）",
        severity: "info",
        detail: "确认面料/辅料化学物清单，必要时贴警示。",
        knowledgeTitle: "美国-毯子与填充寝具",
      });
    }
  }
  if (isChild && !hints.some((h) => h.code === "child_sleepwear")) {
    hints.push({
      code: "cpsia",
      title: "儿童产品：CPSIA（铅/邻苯/追溯标签/CPC）",
      severity: "warn",
      detail: "需 CPSC 认可实验室测试与儿童产品证书。",
      knowledgeTitle: "美国-浴袍与服装类强制法规",
    });
  }
  if (x.certificationsAsked.length > 0 || (isUS || isCA)) {
    hints.push({
      code: "oeko_tex",
      title: "买家大概率要 OEKO-TEX Standard 100（北美家纺入场券）",
      severity: "info",
      detail: x.certificationsAsked.length
        ? `买家明确提到：${x.certificationsAsked.join("、")}`
        : "未提到也建议主动说明持证情况。",
      knowledgeTitle: "自愿认证与验厂",
    });
  }
  // TOWEL 无专门法规，仅通用标签
  if (TOWEL.test(text) && !isUS && !isCA && hints.length === 0) {
    hints.push({
      code: "labels_generic",
      title: "毛巾：目的国未明，先问清市场再核对标签/认证要求",
      severity: "info",
      detail: "美国看 303/423 标签，加拿大看双语标签。",
      knowledgeTitle: "北美家纺合规知识包总览与更新机制",
    });
  }
  return hints;
}

// ── 红旗 ────────────────────────────────────────────────────

export interface RedFlag {
  code: string;
  title: string;
  severity: Severity;
  detail: string;
}

const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|live|icloud|aol|proton(mail)?|qq|163|126|yandex|gmx)\./i;
const FEE_SCAM = /\b(registration fee|notary|notarization|escrow fee|processing fee|clearance fee|customs fee upfront|tax fee)\b|登记费|公证费|手续费/i;
const URGENCY = /\b(urgent(ly)?|asap|immediately|within 24 hours|right now)\b|加急|马上/i;
const BIG_QTY = /(\d{2,3}[,，]?\d{3}|\d+\s*(k|thousand|万))\s*(pcs|pieces|units|sets|件|套)?/i;
const SAMPLE = /sample|样品|打样/i;

export function redFlags(
  x: ExtractedInquiry,
  meta: { email?: string | null; companyName?: string | null; freeText: string; phone?: string | null },
): RedFlag[] {
  const flags: RedFlag[] = [];
  const text = meta.freeText;
  const email = meta.email ?? "";
  const company = (meta.companyName ?? "").trim();

  if (email && FREE_MAIL.test(email) && company && !/^(WhatsApp|微信|企业微信|官网)\s/.test(company) && company !== email) {
    flags.push({
      code: "free_mail_company",
      title: "自称公司却用免费邮箱",
      severity: "warn",
      detail: `${email} 与公司名「${company}」不匹配；核对官网与领英。`,
    });
  }
  if (FEE_SCAM.test(text)) {
    flags.push({
      code: "fee_scam",
      title: "提到登记费/公证费/手续费等前置费用",
      severity: "critical",
      detail: "典型骗局话术：不付任何前置费用，只按正常 T/T 流程。",
    });
  }
  if (BIG_QTY.test(text) && !SAMPLE.test(text) && x.intent === "rfq") {
    flags.push({
      code: "big_order_no_sample",
      title: "首单巨大却不提样品",
      severity: "warn",
      detail: "正常买家会先要样；先报小批量试单价，谨慎寄样与放账。",
    });
  }
  if (URGENCY.test(text) && x.intent !== "spam") {
    flags.push({
      code: "urgency_pressure",
      title: "施压式紧迫（urgent / ASAP）",
      severity: "info",
      detail: "配合骗局常见；按标准流程走，不因催促跳步。",
    });
  }
  if (x.intent === "spam") {
    flags.push({ code: "spam", title: "疑似垃圾/推广信息", severity: "critical", detail: "建议标记垃圾，不跟进。" });
  }
  if (x.products.length === 0 && text.replace(/\s+/g, "").length < 25 && x.intent !== "spam") {
    flags.push({
      code: "too_thin",
      title: "信息太少（无产品、无数量）",
      severity: "info",
      detail: "先回一封追问信（产品/数量/目的国），不急着报价。",
    });
  }
  return flags;
}

/** 红旗对建议评分的影响（供展示：不直接改研究评分） */
export function riskLevel(flags: RedFlag[]): "low" | "medium" | "high" {
  if (flags.some((f) => f.severity === "critical")) return "high";
  if (flags.some((f) => f.severity === "warn")) return "medium";
  return "low";
}
