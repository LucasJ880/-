/**
 * 市场情报 → 内容运营桥接
 *
 * 信号确认（reviewed）后生成 ContentPlanItem（status=proposed），
 * 不自动批准、不配视频、不发帖。同一 sourceSignalId 幂等。
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import { getBrandContext } from "./brand-context";

export interface CreateContentPlanFromSignalInput {
  orgId: string;
  signalId: string;
  userId: string;
}

export interface CreateContentPlanFromSignalResult {
  item: {
    id: string;
    topic: string;
    status: string;
    source: string;
    sourceSignalId: string | null;
    plannedDate: Date;
    groupName: string;
  };
  created: boolean;
}

interface DraftFields {
  topic: string;
  angle: string;
  suggestedCaption: string;
  hashtags: string;
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 默认计划日：今天起 T+2（UTC 日界） */
function defaultPlannedDate(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  return startOfDayUTC(d);
}

function fallbackDraft(input: {
  competitorName: string;
  title: string;
  summary: string;
}): DraftFields {
  const topic = `竞品动态启发：${input.title}`.slice(0, 80);
  const angle = [
    `观察对象：${input.competitorName}`,
    "仅借题发挥我们自己的产品/服务优势，禁止照搬对方文案、价格或促销承诺。",
    input.summary.slice(0, 400),
  ].join("\n");
  const suggestedCaption = [
    `最近行业里出现了值得关注的动向（参考：${input.competitorName}）。`,
    "我们更想帮客户把需求说清楚、把方案做扎实——量房、材质、安装与售后一条龙。",
    "如果你正在对比方案，欢迎私信告诉我们你的房间场景，我们按场景给建议。",
  ].join("\n\n");
  return {
    topic,
    angle,
    suggestedCaption,
    hashtags: "#SmartHome #WindowTreatments #HomeDecor",
  };
}

async function draftWithAI(input: {
  competitorName: string;
  title: string;
  summary: string;
  analysisMarkdown: string | null;
  brandContext: string | null;
  groupName: string;
}): Promise<DraftFields | null> {
  if (!isAIConfigured()) return null;

  const system = `你是社媒内容策划。根据「市场情报」信号，写一条可进内容日历的选题草案。

硬性规则：
1. 只借话题/角度，禁止照抄竞品原文、原价、原促销、原承诺
2. 遵守品牌档案的语气与内容禁忌；档案没有的能力/价格不要编造
3. 输出严格 JSON 对象（不要 markdown 围栏）：
{"topic":"...","angle":"...","suggestedCaption":"...","hashtags":"#a #b"}
4. topic ≤ 40 字；suggestedCaption 适合短视频/图文母版，中英文按品牌与账号组习惯自选`;

  const user = [
    input.brandContext ? `## 品牌档案\n${input.brandContext}` : "## 品牌档案\n（未配置，用通用专业语气）",
    `## 目标账号组\n${input.groupName}`,
    `## 竞品\n${input.competitorName}`,
    `## 信号标题\n${input.title}`,
    `## 信号摘要\n${input.summary}`,
    input.analysisMarkdown
      ? `## AI 分析摘录\n${input.analysisMarkdown.slice(0, 2500)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const raw = await createCompletion({
      systemPrompt: system,
      userPrompt: user,
      mode: "chat",
      maxTokens: 1200,
    });
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const topic = typeof parsed.topic === "string" ? parsed.topic.trim() : "";
    if (!topic) return null;
    return {
      topic: topic.slice(0, 120),
      angle: typeof parsed.angle === "string" ? parsed.angle.trim() : "",
      suggestedCaption:
        typeof parsed.suggestedCaption === "string" ? parsed.suggestedCaption.trim() : "",
      hashtags: typeof parsed.hashtags === "string" ? parsed.hashtags.trim() : "",
    };
  } catch {
    return null;
  }
}

/**
 * 将已确认（或正在确认）的市场信号转为内容日历选题。
 * 要求调用方保证业务上已/将标记 reviewed；本函数不做 status 校验以外的权限检查。
 */
export async function createContentPlanFromSignal(
  input: CreateContentPlanFromSignalInput,
): Promise<CreateContentPlanFromSignalResult> {
  const existing = await db.contentPlanItem.findFirst({
    where: { orgId: input.orgId, sourceSignalId: input.signalId },
    select: {
      id: true,
      topic: true,
      status: true,
      source: true,
      sourceSignalId: true,
      plannedDate: true,
      groupName: true,
    },
  });
  if (existing) {
    return { item: existing, created: false };
  }

  const signal = await db.marketSignal.findFirst({
    where: { id: input.signalId, orgId: input.orgId },
    include: {
      analysisRuns: {
        where: { status: "completed" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { outputMarkdown: true },
      },
    },
  });
  if (!signal) throw new Error("市场信号不存在");

  const competitor = await db.marketCompetitor.findFirst({
    where: { id: signal.competitorId, orgId: input.orgId },
    select: { name: true },
  });
  const competitorName = competitor?.name ?? "竞品";

  const account = await db.matrixAccount.findFirst({
    where: { orgId: input.orgId, status: "active" },
    select: { groupName: true },
    orderBy: { updatedAt: "desc" },
  });
  const groupName = account?.groupName?.trim() || "默认组";

  const brandContext = await getBrandContext(input.orgId);
  const aiDraft = await draftWithAI({
    competitorName,
    title: signal.title,
    summary: signal.summary,
    analysisMarkdown: signal.analysisRuns[0]?.outputMarkdown ?? null,
    brandContext,
    groupName,
  });
  const draft =
    aiDraft ??
    fallbackDraft({
      competitorName,
      title: signal.title,
      summary: signal.summary,
    });

  const item = await db.contentPlanItem.create({
    data: {
      orgId: input.orgId,
      plannedDate: defaultPlannedDate(),
      groupName,
      topic: draft.topic,
      angle: draft.angle || null,
      suggestedCaption: draft.suggestedCaption || null,
      hashtags: draft.hashtags || null,
      status: "proposed",
      source: "intelligence",
      sourceSignalId: signal.id,
      createdByUserId: input.userId,
    },
    select: {
      id: true,
      topic: true,
      status: true,
      source: true,
      sourceSignalId: true,
      plannedDate: true,
      groupName: true,
    },
  });

  return { item, created: true };
}
