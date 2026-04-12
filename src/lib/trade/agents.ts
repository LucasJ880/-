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
    mode: "structured",
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

// ── Research Agent ──────────────────────────────────────────

export interface ResearchReport {
  companyOverview: string;
  products: string;
  marketPosition: string;
  importHistory: string;
  contactInfo: string;
  matchAnalysis: string;
  recommendations: string;
}

export async function generateResearchReport(
  companyInfo: { name: string; website?: string | null; country?: string | null; rawData?: string },
  productDesc: string,
  targetMarket: string,
): Promise<ResearchReport> {
  const raw = await createCompletion({
    systemPrompt: `你是外贸客户研究分析师。根据提供的公司信息，生成详细的客户研究报告。
用 JSON 格式输出，包含以下字段：
- companyOverview: 公司概况（100-200字）
- products: 主营产品和业务范围
- marketPosition: 市场地位和规模评估
- importHistory: 进口历史和采购特征（如有信息）
- contactInfo: 已知联系方式汇总
- matchAnalysis: 与我方产品的匹配度分析
- recommendations: 接触策略建议`,
    userPrompt: `目标公司：${companyInfo.name}
官网：${companyInfo.website || "未知"}
国家：${companyInfo.country || "未知"}
采集到的信息：${companyInfo.rawData || "仅有公司名"}

我方产品：${productDesc}
目标市场：${targetMarket}`,
    mode: "structured",
    temperature: 0.2,
  });

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(raw);
  } catch {
    return {
      companyOverview: raw,
      products: "",
      marketPosition: "",
      importHistory: "",
      contactInfo: "",
      matchAnalysis: "",
      recommendations: "",
    };
  }
}

// ── Score Agent ─────────────────────────────────────────────

export interface ScoreResult {
  score: number;
  reason: string;
}

export async function scoreProspect(
  report: ResearchReport,
  productDesc: string,
  targetMarket: string,
): Promise<ScoreResult> {
  const raw = await createCompletion({
    systemPrompt: `你是外贸客户资格评估专家。根据客户研究报告，对该客户的合作潜力打分。

评分维度（每项 0-2 分，总分 0-10）：
1. 产品匹配度：客户需求与我方产品的契合程度
2. 采购规模：预估采购量和金额
3. 市场匹配：客户所在市场与我方目标市场的一致性
4. 可触达性：是否有有效联系方式，能否建立联系
5. 合作意愿信号：是否有近期采购需求、展会参与等积极信号

用 JSON 格式返回：{"score": 数字(0-10), "reason": "评分理由（100字内）"}`,
    userPrompt: `客户研究报告：${JSON.stringify(report)}

我方产品：${productDesc}
目标市场：${targetMarket}`,
    mode: "structured",
    temperature: 0.1,
  });

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    return {
      score: Math.min(10, Math.max(0, Number(parsed.score) || 0)),
      reason: String(parsed.reason || ""),
    };
  } catch {
    return { score: 0, reason: "评分解析失败" };
  }
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
  opts?: { language?: string },
): Promise<OutreachDraft> {
  const targetLang = opts?.language ?? detectLanguage(prospect.country);
  const langInstruction = targetLang === "English"
    ? "正文用英文撰写"
    : `正文用${targetLang}撰写（因为客户位于${prospect.country}）`;

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
产品：${productDesc}`,
    mode: "structured",
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
): Promise<ClassifyResult> {
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
    userPrompt: `客户回复：\n${replyContent}\n\n历史对话：\n${conversationHistory}`,
    mode: "structured",
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
