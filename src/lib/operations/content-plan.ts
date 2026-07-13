/**
 * 内容日历 — AI 选题生成
 *
 * 按品牌记忆 + 账号组 persona 批量生成未来 N 天的选题，
 * 带近期已有选题做去重，产出 status=proposed 的日历条目等人工审。
 * 数据隔离：所有读写按 orgId 收口。
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import { getBrandContext } from "./brand-context";

const SYSTEM_PROMPT = `你是社媒矩阵的内容策划。基于品牌档案和账号组定位，为未来若干天生成发布选题。

要求：
- 每条选题包含：具体的选题标题、切入角度（拍什么/说什么）、一段可直接使用的母版文案草稿
- 选题贴合账号组的 persona 与语言（英文组出英文文案，中文组出中文文案）
- 选题之间明显不同，且避开「近期已有选题」列表中的方向
- 文案草稿遵守品牌档案的语气与内容禁忌，禁止编造档案外的能力、价格或承诺
- 不写具体价格和折扣（价格类内容由人工另行发起）
- 选题类型多样化：产品展示 / 使用场景 / 客户故事 / 知识科普 / 幕后花絮交替出现
- 标注 isPremium=true 的账号组是深度经营的精品号：选题要更深一层——
  优先系列化选题（可连载的主题线）、有独特视角的深挖内容、能建立专业信任的深度科普，
  避免与矩阵组同质化的泛泛展示

输出严格 JSON 数组，每项：
{"dayOffset": 0, "groupName": "...", "topic": "...", "angle": "...", "suggestedCaption": "...", "hashtags": "#..."}
dayOffset 为距开始日的天数（0 到 days-1），每天的条目分布均匀。不要输出其他内容。`;

export interface GeneratePlanInput {
  orgId: string;
  userId: string;
  /** 生成未来几天（含今天），1-30 */
  days: number;
  /** 每天每组几条，1-5 */
  perDayPerGroup: number;
  /** 只为指定账号组生成；缺省为所有活跃组 */
  groupName?: string;
  /** 计划开始日（缺省今天） */
  startDate?: Date;
}

export interface GeneratePlanResult {
  created: number;
  groups: string[];
}

interface RawPlanItem {
  dayOffset: number;
  groupName: string;
  topic: string;
  angle?: string;
  suggestedCaption?: string;
  hashtags?: string;
}

function parsePlanItems(raw: string): RawPlanItem[] {
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(jsonText) as unknown;
  if (!Array.isArray(parsed)) throw new Error("选题输出不是数组");
  return parsed
    .filter(
      (it): it is Record<string, unknown> =>
        typeof it === "object" &&
        it !== null &&
        typeof (it as Record<string, unknown>).topic === "string" &&
        typeof (it as Record<string, unknown>).groupName === "string",
    )
    .map((it) => ({
      dayOffset: Number.isInteger(it.dayOffset) ? (it.dayOffset as number) : 0,
      groupName: String(it.groupName),
      topic: String(it.topic).trim(),
      angle: typeof it.angle === "string" ? it.angle.trim() : undefined,
      suggestedCaption:
        typeof it.suggestedCaption === "string" ? it.suggestedCaption.trim() : undefined,
      hashtags: typeof it.hashtags === "string" ? it.hashtags.trim() : undefined,
    }))
    .filter((it) => it.topic.length > 0);
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function generateContentPlan(
  input: GeneratePlanInput,
): Promise<GeneratePlanResult> {
  if (!isAIConfigured()) throw new Error("AI 未配置，无法生成选题");

  const days = Math.min(Math.max(input.days, 1), 30);
  const perDayPerGroup = Math.min(Math.max(input.perDayPerGroup, 1), 5);
  const startDate = startOfDayUTC(input.startDate ?? new Date());

  // 目标账号组（组织隔离）：取活跃账号的组名与 persona 概要
  const accounts = await db.matrixAccount.findMany({
    where: {
      orgId: input.orgId,
      status: "active",
      ...(input.groupName ? { groupName: input.groupName } : {}),
    },
    select: { groupName: true, platform: true, personaNotes: true, tier: true },
  });
  if (accounts.length === 0) throw new Error("没有可用的活跃账号组，请先登记矩阵账号");

  const groupMap = new Map<
    string,
    { platforms: Set<string>; persona: string | null; hasPremium: boolean }
  >();
  for (const a of accounts) {
    const g =
      groupMap.get(a.groupName) ?? { platforms: new Set(), persona: null, hasPremium: false };
    g.platforms.add(a.platform);
    if (!g.persona && a.personaNotes) g.persona = a.personaNotes;
    if (a.tier === "premium") g.hasPremium = true;
    groupMap.set(a.groupName, g);
  }
  const groups = [...groupMap.entries()].map(([name, g]) => ({
    groupName: name,
    platforms: [...g.platforms],
    persona: g.persona,
    isPremium: g.hasPremium,
  }));

  // 近期已有选题（过去 14 天 + 未来），用于去重
  const recentSince = new Date(startDate.getTime() - 14 * 24 * 3600 * 1000);
  const existing = await db.contentPlanItem.findMany({
    where: {
      orgId: input.orgId,
      plannedDate: { gte: recentSince },
      status: { not: "skipped" },
    },
    select: { topic: true },
    orderBy: { plannedDate: "desc" },
    take: 100,
  });

  const brandContext = await getBrandContext(input.orgId);

  const userPrompt = JSON.stringify(
    {
      days,
      perDayPerGroup,
      groups,
      recentTopics: existing.map((e) => e.topic),
    },
    null,
    2,
  );

  const content = await createCompletion({
    systemPrompt: brandContext
      ? `${SYSTEM_PROMPT}\n\n【品牌档案】\n${brandContext}`
      : `${SYSTEM_PROMPT}\n\n【品牌档案】\n（未配置，基于账号组 persona 创作，不要编造品牌信息）`,
    userPrompt,
    mode: "normal",
    maxTokens: 16384,
    timeoutMs: 120_000,
  });

  const items = parsePlanItems(content);
  const validGroups = new Set(groups.map((g) => g.groupName));

  let created = 0;
  for (const item of items) {
    if (!validGroups.has(item.groupName)) continue;
    const offset = Math.min(Math.max(item.dayOffset, 0), days - 1);
    await db.contentPlanItem.create({
      data: {
        orgId: input.orgId,
        plannedDate: new Date(startDate.getTime() + offset * 24 * 3600 * 1000),
        groupName: item.groupName,
        topic: item.topic,
        angle: item.angle || null,
        suggestedCaption: item.suggestedCaption || null,
        hashtags: item.hashtags || null,
        status: "proposed",
        source: "ai",
        createdByUserId: input.userId,
      },
    });
    created += 1;
  }

  return { created, groups: groups.map((g) => g.groupName) };
}
