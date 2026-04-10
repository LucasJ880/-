/**
 * 销售知识提取 — 从对话记录中提炼话术模板 + FAQ
 *
 * 用 LLM 分析 CustomerInteraction 中的对话，自动生成：
 * 1. SalesPlaybook：按场景 + 渠道组织的话术模板
 * 2. SalesFAQ：客户常见问题 + 最佳回答
 */

import { createCompletion } from "./client";
import { db } from "@/lib/db";
import type { RawMessage } from "./sales-conversation";

// ─── 类型 ──────────────────────────────────────────────────────

export interface ExtractedPlaybook {
  channel: string;
  language: string;
  scene: string;
  sceneLabel: string;
  content: string;
  example: string;
  tags: string[];
}

export interface ExtractedFAQ {
  question: string;
  answer: string;
  language: string;
  category: string;
  categoryLabel: string;
  productTags: string[];
}

export interface ExtractionResult {
  playbooks: ExtractedPlaybook[];
  faqs: ExtractedFAQ[];
}

// ─── 场景 / 分类常量 ──────────────────────────────────────────

export const PLAYBOOK_SCENES = [
  { key: "first_contact", label: "首次接触" },
  { key: "follow_up", label: "跟进回访" },
  { key: "price_objection", label: "价格异议" },
  { key: "product_intro", label: "产品介绍" },
  { key: "closing", label: "促单成交" },
  { key: "after_sale", label: "售后关怀" },
  { key: "upsell", label: "追加推荐" },
  { key: "measurement", label: "预约测量" },
  { key: "installation", label: "安装安排" },
  { key: "other", label: "其他" },
] as const;

export const FAQ_CATEGORIES = [
  { key: "product", label: "产品相关" },
  { key: "pricing", label: "价格相关" },
  { key: "installation", label: "安装相关" },
  { key: "warranty", label: "保修售后" },
  { key: "delivery", label: "交付物流" },
  { key: "process", label: "流程说明" },
  { key: "measurement", label: "测量相关" },
  { key: "other", label: "其他" },
] as const;

// ─── 提取 prompt ──────────────────────────────────────────────

function buildExtractionPrompt(
  messages: RawMessage[],
  channel: string,
  language: string
): string {
  const conversationText = messages
    .map((m) => `[${m.role === "staff" ? "员工" : "客户"}] ${m.content}`)
    .join("\n");

  return `你是 Sunny Shutter 的销售培训专家。请分析以下真实销售对话，提取可复用的话术模板和常见问题。

## 对话渠道：${channel}
## 对话语言：${language}

## 对话内容：
${conversationText}

请用 JSON 格式返回提取结果，严格遵循以下结构：

\`\`\`json
{
  "playbooks": [
    {
      "scene": "场景key (first_contact/follow_up/price_objection/product_intro/closing/after_sale/upsell/measurement/installation/other)",
      "sceneLabel": "场景中文名",
      "content": "提炼的话术模板（保留原始语言，可用 [客户名] [产品名] [价格] 等占位符）",
      "example": "从对话中摘取的实际使用范例",
      "tags": ["相关标签"]
    }
  ],
  "faqs": [
    {
      "question": "客户问的问题（提炼为通用版本）",
      "answer": "最佳回答模板",
      "category": "分类key (product/pricing/installation/warranty/delivery/process/measurement/other)",
      "categoryLabel": "分类中文名",
      "productTags": ["涉及的产品，如 zebra, roller"]
    }
  ]
}
\`\`\`

## 提取规则：
1. 只提取**有参考价值**的话术，日常寒暄不提取
2. 话术模板要保留原始语言（中文对话出中文模板，英文出英文）
3. FAQ 中的问题要泛化（去掉具体客户信息），回答要专业完整
4. 如果对话中没有可提取的话术或FAQ，对应数组返回空 []
5. 产品术语保持英文原文（Zebra, Roller, Cellular 等）
6. 每个场景最多提取 2 条话术，每个对话最多提取 5 条 FAQ`;
}

// ─── 解析 LLM 返回 ──────────────────────────────────────────

function parseExtractionResponse(
  raw: string,
  channel: string,
  language: string
): ExtractionResult {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

  try {
    const parsed = JSON.parse(jsonStr);

    const playbooks: ExtractedPlaybook[] = (parsed.playbooks || []).map(
      (p: Record<string, unknown>) => ({
        channel,
        language,
        scene: String(p.scene || "other"),
        sceneLabel: String(p.sceneLabel || "其他"),
        content: String(p.content || ""),
        example: String(p.example || ""),
        tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
      })
    );

    const faqs: ExtractedFAQ[] = (parsed.faqs || []).map(
      (f: Record<string, unknown>) => ({
        question: String(f.question || ""),
        answer: String(f.answer || ""),
        language,
        category: String(f.category || "other"),
        categoryLabel: String(f.categoryLabel || "其他"),
        productTags: Array.isArray(f.productTags)
          ? f.productTags.map(String)
          : [],
      })
    );

    return {
      playbooks: playbooks.filter((p) => p.content.length > 10),
      faqs: faqs.filter((f) => f.question.length > 5 && f.answer.length > 10),
    };
  } catch {
    return { playbooks: [], faqs: [] };
  }
}

// ─── 核心：从单条互动提取知识 ─────────────────────────────────

export async function extractKnowledgeFromInteraction(
  interactionId: string,
  userId: string
): Promise<ExtractionResult> {
  const interaction = await db.customerInteraction.findUnique({
    where: { id: interactionId },
  });

  if (!interaction || !interaction.rawMessages) {
    return { playbooks: [], faqs: [] };
  }

  let messages: RawMessage[];
  try {
    messages = JSON.parse(interaction.rawMessages);
  } catch {
    return { playbooks: [], faqs: [] };
  }

  if (messages.length < 2) {
    return { playbooks: [], faqs: [] };
  }

  const channel = interaction.channel || "other";
  const language = interaction.language || "zh";

  const prompt = buildExtractionPrompt(messages, channel, language);

  const raw = await createCompletion({
    systemPrompt:
      "你是销售话术分析专家，擅长从真实对话中提炼可复用的话术模板和FAQ。" +
      "请严格按要求的 JSON 格式输出，不要添加额外说明。",
    userPrompt: prompt,
    mode: "structured",
    temperature: 0.3,
  });

  const result = parseExtractionResponse(raw, channel, language);

  const playbookRecords = result.playbooks.map((p) => ({
    userId,
    channel: p.channel,
    language: p.language,
    scene: p.scene,
    sceneLabel: p.sceneLabel,
    content: p.content,
    example: p.example,
    tags: p.tags.join(",") || null,
    sourceInteractionId: interactionId,
    effectiveness: 0,
    status: "active",
    usageCount: 0,
  }));

  const faqRecords = result.faqs.map((f) => ({
    userId,
    question: f.question,
    answer: f.answer,
    language: f.language,
    category: f.category,
    categoryLabel: f.categoryLabel,
    productTags: f.productTags.join(",") || null,
    sourceInteractionId: interactionId,
    frequency: 1,
    status: "active",
  }));

  if (playbookRecords.length > 0) {
    await db.salesPlaybook.createMany({ data: playbookRecords });
  }
  if (faqRecords.length > 0) {
    await db.salesFAQ.createMany({ data: faqRecords });
  }

  return result;
}

// ─── 批量提取（从客户的所有互动中提取） ───────────────────────

export async function extractKnowledgeFromCustomer(
  customerId: string,
  userId: string
): Promise<{ totalPlaybooks: number; totalFaqs: number }> {
  const interactions = await db.customerInteraction.findMany({
    where: { customerId, rawMessages: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  let totalPlaybooks = 0;
  let totalFaqs = 0;

  for (const interaction of interactions) {
    const alreadyExtracted =
      (await db.salesPlaybook.count({
        where: { sourceInteractionId: interaction.id, userId },
      })) +
      (await db.salesFAQ.count({
        where: { sourceInteractionId: interaction.id, userId },
      }));

    if (alreadyExtracted > 0) continue;

    const result = await extractKnowledgeFromInteraction(
      interaction.id,
      userId
    );
    totalPlaybooks += result.playbooks.length;
    totalFaqs += result.faqs.length;
  }

  return { totalPlaybooks, totalFaqs };
}

// ─── 话术库查询 ──────────────────────────────────────────────

export async function getPlaybooks(
  userId: string,
  opts: {
    channel?: string;
    scene?: string;
    status?: string;
    limit?: number;
  } = {}
) {
  return db.salesPlaybook.findMany({
    where: {
      userId,
      ...(opts.channel ? { channel: opts.channel } : {}),
      ...(opts.scene ? { scene: opts.scene } : {}),
      status: opts.status || "active",
    },
    orderBy: [{ effectiveness: "desc" }, { usageCount: "desc" }],
    take: opts.limit || 50,
  });
}

export async function getFAQs(
  userId: string,
  opts: {
    category?: string;
    language?: string;
    status?: string;
    limit?: number;
  } = {}
) {
  return db.salesFAQ.findMany({
    where: {
      userId,
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.language ? { language: opts.language } : {}),
      status: opts.status || "active",
    },
    orderBy: [{ frequency: "desc" }],
    take: opts.limit || 50,
  });
}
