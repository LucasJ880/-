/**
 * Trade AI Agents — 外贸获客 AI 引擎
 *
 * 借鉴:
 * - sales-outreach-automation-langgraph: 分层报告 + 资格打分
 * - OpenOutreach: ICP → 搜索关键词生成
 * - autonomous-sdr-agent: 意图分类
 * - SalesGPT: 阶段感知 + 知识库
 */

import { createCompletion } from "@/lib/ai/client";
import { searchKnowledge } from "@/lib/trade/knowledge-service";
import type {
  ResearchReport,
  ResearchSource,
  ScoringProfileV1,
} from "@/lib/trade/research-bundle";
import { RESEARCH_REPORT_KEYS } from "@/lib/trade/research-bundle";
import { buildScoreReasonSkeleton, computeScoringProfile } from "@/lib/trade/scoring-rules";

export type { ResearchReport, ResearchSource, ResearchBundleV1 } from "@/lib/trade/research-bundle";

// ── Search Keyword Agent ────────────────────────────────────

export async function generateSearchKeywords(
  productDesc: string,
  targetMarket: string,
): Promise<string[]> {
  const raw = await createCompletion({
    systemPrompt: `你是 B2B 外贸获客专家。根据用户描述的产品和目标市场，生成用于 Google 搜索海外买家的英文关键词。
要求：
1. 生成 10-15 组搜索关键词
2. 每组关键词应是精准的英文搜索词组，适合在 Google 中直接搜索
3. 覆盖不同搜索意图：找买家公司、找进口商、找分销商、找行业展会参展商
4. 包含产品关键词 + 买家身份词 + 地区限定词的组合
5. 用 JSON 数组格式返回，每个元素是一个搜索词字符串`,
    userPrompt: `产品描述：${productDesc}\n\n目标市场：${targetMarket}`,
    mode: "fast",
    temperature: 0.3,
  });

  try {
    const jsonMatch = raw.match(/\[[\s\S]*?\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(raw);
  } catch {
    return raw
      .split("\n")
      .map((l) => l.replace(/^[\d.\-*]+\s*/, "").trim())
      .filter((l) => l.length > 3);
  }
}

// ── Research Agent（带 sources，输出 report + fieldSourceIds）────────

export interface ResearchLlmResult {
  report: ResearchReport;
  fieldSourceIds?: Partial<Record<keyof ResearchReport, string[]>>;
}

function emptyReport(fallbackOverview: string): ResearchReport {
  return {
    companyOverview: fallbackOverview,
    products: "",
    marketPosition: "",
    importHistory: "",
    contactInfo: "",
    matchAnalysis: "",
    recommendations: "",
  };
}

/**
 * 根据已结构化的 sources + 原始摘录生成研究报告。
 * 必须输出合法 source id（仅允许来自 sources 列表）；否则 fieldSourceIds 会被调用方校验剔除。
 */
export async function generateResearchReport(
  companyInfo: { name: string; website?: string | null; country?: string | null; rawData?: string },
  productDesc: string,
  targetMarket: string,
  sources: ResearchSource[],
): Promise<ResearchLlmResult> {
  const sourcesJson = JSON.stringify(sources, null, 2);
  const keysList = RESEARCH_REPORT_KEYS.join(", ");

  const raw = await createCompletion({
    systemPrompt: `你是外贸客户研究分析师。根据提供的公司信息与「已验证来源列表」生成客户研究报告。

硬性规则：
1. 只输出一个 JSON 对象，不要 markdown 代码围栏。
2. 顶层结构必须为：
   { "report": { ...七字段... }, "fieldSourceIds": { ...可选... } }
3. report 内字段与含义：
   - companyOverview: 公司概况（100-200字）
   - products: 主营产品和业务范围
   - marketPosition: 市场地位和规模评估
   - importHistory: 进口历史和采购特征（无依据可写「公开信息不足」）
   - contactInfo: 已知联系方式汇总
   - matchAnalysis: 与我方产品的匹配度分析
   - recommendations: 接触策略建议
4. fieldSourceIds：每个键对应 report 中的同名字段，值为来源 id 数组。id **必须**来自下方 sources 列表中的 id，不得编造。
5. 若某段内容无法由给定来源支持，该段 fieldSourceIds 可省略或为空数组；不得虚构事实。
6. 若 sources 为空，fieldSourceIds 应为 {} 或省略。`,
    userPrompt: `目标公司：${companyInfo.name}
官网：${companyInfo.website || "未知"}
国家：${companyInfo.country || "未知"}

【已验证来源列表 sources】（id 必须原样引用）：
${sourcesJson}

【采集摘录（供理解上下文，引用仍须用 sources 中的 id）】
${companyInfo.rawData || "仅有公司名"}

我方产品：${productDesc}
目标市场：${targetMarket}

请输出 JSON：{ "report": { ${keysList} }, "fieldSourceIds": { 可选，键名仅限上述七字段 } }`,
    mode: "normal",
    temperature: 0.2,
  });

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Record<string, unknown>;
    const reportObj = parsed.report;
    const report =
      reportObj && typeof reportObj === "object"
        ? coerceResearchReport(reportObj as Record<string, unknown>)
        : emptyReport(raw);

    const fieldRaw = parsed.fieldSourceIds;
    let fieldSourceIds: Partial<Record<keyof ResearchReport, string[]>> | undefined;
    if (fieldRaw && typeof fieldRaw === "object" && !Array.isArray(fieldRaw)) {
      fieldSourceIds = fieldRaw as Partial<Record<keyof ResearchReport, string[]>>;
    }

    return { report, fieldSourceIds };
  } catch {
    return { report: emptyReport(raw) };
  }
}

function coerceResearchReport(obj: Record<string, unknown>): ResearchReport {
  return {
    companyOverview: String(obj.companyOverview ?? ""),
    products: String(obj.products ?? ""),
    marketPosition: String(obj.marketPosition ?? ""),
    importHistory: String(obj.importHistory ?? ""),
    contactInfo: String(obj.contactInfo ?? ""),
    matchAnalysis: String(obj.matchAnalysis ?? ""),
    recommendations: String(obj.recommendations ?? ""),
  };
}

// ── Score Agent ─────────────────────────────────────────────

export interface ScoreResult {
  score: number;
  reason: string;
}

function extractCitationIds(text: string): string[] {
  return [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
}

/** P2-beta：营销/绝对化套话 → 退回骨架 */
const REASON_MARKETING_BLOCK =
  /首选合作伙伴|行业领先|必然成交|独家保证|保证成交|100%|百分百|不二之选|遥遥领先|最专业|最强/i;

async function refineScoreReasonWithLLM(
  skeleton: string,
  sources: ResearchSource[],
): Promise<string> {
  const allowed = new Set(sources.map((s) => s.id));
  const skeletonCitationIds = [
    ...new Set(extractCitationIds(skeleton).filter((id) => allowed.has(id))),
  ];
  const skeletonSet = new Set(skeletonCitationIds);
  const allowedList = sources
    .map((s) => `${s.id}: ${String(s.title).slice(0, 80)}`)
    .join("\n");

  const raw = await createCompletion({
    systemPrompt: `你是外贸 CRM 评分说明助手。根据给定的「规则层骨架」写一条简短中文评分理由（陈述事实，语气克制）。
硬性规则：
1. 只输出一个 JSON 对象：{"reason":"..."}，不要 markdown。
2. 若骨架中已出现方括号来源 id（如 [s1]），你的 reason 中引用的 id **必须完全来自骨架里已出现的 id**，不得新增其它 id。
3. 若骨架中没有任何 [sid]，则 reason 中也不要出现方括号来源。
4. 所有出现的 [sid] 必须同时属于用户给出的「允许来源 id」列表。
5. 禁止使用「已确认」「必然」「即将签单」「预测」「首选」「行业领先」等绝对化或营销套话。
6. 若无法同时满足以上约束，reason 请直接复制骨架全文（系统会再截断）。
7. reason 正文建议不超过 100 个汉字等效长度。`,
    userPrompt: `规则层骨架：\n${skeleton}\n\n骨架中已出现的引用 id（须为子集）：${skeletonCitationIds.join(", ") || "(无)"}\n\n允许的来源 id：\n${allowedList || "(无来源)"}`,
    mode: "fast",
    temperature: 0.08,
  });

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as { reason?: string };
    const reason = String(parsed.reason ?? "").trim();
    if (reason.length < 12) return skeleton;
    if (REASON_MARKETING_BLOCK.test(reason)) return skeleton;

    const cites = extractCitationIds(reason);
    if (cites.some((c) => !allowed.has(c))) return skeleton;
    if (skeletonSet.size > 0) {
      if (cites.length === 0) return skeleton;
      if (cites.some((c) => !skeletonSet.has(c))) return skeleton;
    }

    const maxLen = skeletonSet.size > 0 ? 140 : 110;
    return reason.length > maxLen ? reason.slice(0, maxLen) : reason;
  } catch {
    return skeleton;
  }
}

/**
 * P2-alpha：总分由 sources 上规则维度分换算；LLM 仅润色 scoreReason，不得单独改分。
 */
export async function scoreProspect(
  sources: ResearchSource[],
  _report: ResearchReport,
  productDesc: string,
  targetMarket: string,
  opts?: { includeDebug?: boolean },
): Promise<ScoreResult & { scoring: ScoringProfileV1 }> {
  const scoring = computeScoringProfile(sources, productDesc, targetMarket, opts);
  const skeleton = buildScoreReasonSkeleton(scoring);
  const reason =
    sources.length > 0 ? await refineScoreReasonWithLLM(skeleton, sources) : skeleton;
  return {
    score: Math.min(10, Math.max(0, scoring.totalFromDimensions)),
    reason: reason || skeleton,
    scoring,
  };
}

// ── Outreach Agent ──────────────────────────────────────────

export interface OutreachDraft {
  subject: string;
  body: string;
  subjectZh: string;
  bodyZh: string;
}

const COUNTRY_LANG_MAP: Record<string, string> = {
  // Spanish-speaking
  spain: "Spanish", mexico: "Spanish", colombia: "Spanish", argentina: "Spanish",
  chile: "Spanish", peru: "Spanish", venezuela: "Spanish", ecuador: "Spanish",
  guatemala: "Spanish", cuba: "Spanish", "dominican republic": "Spanish",
  // French-speaking
  france: "French", belgium: "French", canada: "French", switzerland: "French",
  morocco: "French", tunisia: "French", senegal: "French",
  // German-speaking
  germany: "German", austria: "German",
  // Portuguese-speaking
  brazil: "Portuguese", portugal: "Portuguese",
  // Russian-speaking
  russia: "Russian", kazakhstan: "Russian", belarus: "Russian",
  // Arabic-speaking
  "saudi arabia": "Arabic", uae: "Arabic", egypt: "Arabic", qatar: "Arabic",
  // Japanese / Korean
  japan: "Japanese", "south korea": "Korean", korea: "Korean",
  // Turkish
  turkey: "Turkish", türkiye: "Turkish",
};

function detectLanguage(country?: string | null): string {
  if (!country) return "English";
  const normalized = country.toLowerCase().trim();
  return COUNTRY_LANG_MAP[normalized] ?? "English";
}

export async function generateOutreachEmail(
  prospect: { companyName: string; contactName?: string | null; contactTitle?: string | null; country?: string | null },
  report: ResearchReport,
  productDesc: string,
  senderInfo: { companyName: string; senderName: string },
  opts?: { language?: string; orgId?: string },
): Promise<OutreachDraft> {
  const targetLang = opts?.language ?? detectLanguage(prospect.country);
  const langInstruction = targetLang === "English"
    ? "正文用英文撰写"
    : `正文用${targetLang}撰写（因为客户位于${prospect.country}）`;

  let knowledgeContext = "";
  if (opts?.orgId) {
    try {
      knowledgeContext = await searchKnowledge(opts.orgId, productDesc, { limit: 3 });
    } catch { /* knowledge not available yet */ }
  }

  const raw = await createCompletion({
    systemPrompt: `你是专业外贸开发信写手。根据客户研究报告生成个性化的首封开发邮件。

要求：
1. ${langInstruction}，同时附上中文翻译版（供老板审阅理解）
2. 主题行简洁有力，提及对方公司或行业
3. 正文 150-250 词，包含：简要自我介绍、为什么联系对方（基于研究）、产品价值主张、明确的行动号召（CTA）
4. 语气专业但友好，不要过于推销
5. 不要虚构任何事实

用 JSON 格式返回：
{"subject": "外语主题", "body": "外语正文", "subjectZh": "中文主题", "bodyZh": "中文正文"}`,
    userPrompt: `目标客户：${prospect.companyName}
联系人：${prospect.contactName || "未知"} ${prospect.contactTitle || ""}
国家：${prospect.country || "未知"}
目标语言：${targetLang}
客户研究：${JSON.stringify(report)}

我方公司：${senderInfo.companyName}
发件人：${senderInfo.senderName}
产品：${productDesc}${knowledgeContext ? `\n\n产品知识库参考资料：\n${knowledgeContext}` : ""}`,
    mode: "normal",
    temperature: 0.4,
  });

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    return { subject: "", body: raw, subjectZh: "", bodyZh: "" };
  }
}

// ── Reply Classifier Agent ──────────────────────────────────

export type ReplyIntent =
  | "interested"
  | "question"
  | "objection"
  | "request_sample"
  | "not_interested"
  | "ooo"
  | "unclear";

export interface ClassifyResult {
  intent: ReplyIntent;
  confidence: number;
  suggestedAction: string;
  draftReply?: string;
}

export async function classifyReply(
  replyContent: string,
  conversationHistory: string,
  opts?: { orgId?: string; productDesc?: string },
): Promise<ClassifyResult> {
  let knowledgeContext = "";
  if (opts?.orgId) {
    try {
      const query = `${replyContent.slice(0, 200)} ${opts.productDesc ?? ""}`;
      knowledgeContext = await searchKnowledge(opts.orgId, query, { limit: 3 });
    } catch { /* ok */ }
  }
  const raw = await createCompletion({
    systemPrompt: `你是外贸邮件意图分析专家。分析客户回复的意图，分为以下类别：

- interested: 表示感兴趣，想了解更多或继续谈
- question: 询问具体细节（价格、规格、交期等）
- objection: 提出异议或还价
- request_sample: 要求寄样品
- not_interested: 明确拒绝或不感兴趣
- ooo: 不在办公室 / 自动回复
- unclear: 无法明确判断

用 JSON 返回：
{
  "intent": "类别",
  "confidence": 0.0-1.0,
  "suggestedAction": "建议的下一步动作（中文）",
  "draftReply": "如果需要回复，给出英文草稿（可选）"
}`,
    userPrompt: `客户回复：\n${replyContent}\n\n历史对话：\n${conversationHistory}${knowledgeContext ? `\n\n产品知识库参考：\n${knowledgeContext}` : ""}`,
    mode: "fast",
    temperature: 0.1,
  });

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    return {
      intent: parsed.intent || "unclear",
      confidence: Number(parsed.confidence) || 0.5,
      suggestedAction: parsed.suggestedAction || "",
      draftReply: parsed.draftReply,
    };
  } catch {
    return { intent: "unclear", confidence: 0, suggestedAction: "人工判断" };
  }
}
