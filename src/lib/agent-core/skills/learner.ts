/**
 * 技能学习器 — 自我改进引擎
 *
 * 分析技能的历史执行轨迹（成功率、用户评分、编辑记录、反馈文本），
 * 利用 AI 自动优化 systemPrompt 和 userPromptTemplate。
 *
 * 优化策略：
 * 1. 收集最近 N 次执行记录
 * 2. 统计成功率、平均评分、编辑率
 * 3. 提取低分/失败/被编辑的 case 作为负面样本
 * 4. 提取高分 case 作为正面样本
 * 5. 构造 meta-prompt 让 AI 分析问题并输出改进后的 prompt
 * 6. 验证输出格式后写入 DB，version +1
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import type { SkillOptimizationResult } from "./types";

const MIN_EXECUTIONS_FOR_OPTIMIZATION = 5;
const SAMPLE_WINDOW = 50;

interface ExecutionStats {
  total: number;
  successRate: number;
  avgRating: number | null;
  editRate: number;
  negativeSamples: NegativeSample[];
  positiveSamples: PositiveSample[];
}

interface NegativeSample {
  input: string;
  output: string;
  rating: number | null;
  feedback: string | null;
  wasEdited: boolean;
}

interface PositiveSample {
  input: string;
  output: string;
  rating: number;
}

async function gatherStats(skillId: string): Promise<ExecutionStats> {
  const executions = await db.skillExecution.findMany({
    where: { skillId },
    orderBy: { createdAt: "desc" },
    take: SAMPLE_WINDOW,
    select: {
      success: true,
      userRating: true,
      userFeedback: true,
      wasEdited: true,
      inputJson: true,
      outputJson: true,
    },
  });

  if (executions.length === 0) {
    return {
      total: 0,
      successRate: 0,
      avgRating: null,
      editRate: 0,
      negativeSamples: [],
      positiveSamples: [],
    };
  }

  const total = executions.length;
  const successes = executions.filter((e) => e.success).length;
  const rated = executions.filter((e) => e.userRating !== null);
  const edited = executions.filter((e) => e.wasEdited).length;

  const avgRating =
    rated.length > 0
      ? rated.reduce((sum, e) => sum + (e.userRating ?? 0), 0) / rated.length
      : null;

  const negativeSamples = executions
    .filter(
      (e) =>
        !e.success ||
        (e.userRating !== null && e.userRating <= 2) ||
        e.wasEdited ||
        (e.userFeedback && e.userFeedback.length > 0),
    )
    .slice(0, 5)
    .map((e) => ({
      input: truncate(e.inputJson, 500),
      output: truncate(e.outputJson ?? "", 500),
      rating: e.userRating,
      feedback: e.userFeedback,
      wasEdited: e.wasEdited,
    }));

  const positiveSamples = executions
    .filter((e) => e.success && e.userRating !== null && e.userRating >= 4)
    .slice(0, 3)
    .map((e) => ({
      input: truncate(e.inputJson, 500),
      output: truncate(e.outputJson ?? "", 500),
      rating: e.userRating!,
    }));

  return {
    total,
    successRate: successes / total,
    avgRating,
    editRate: edited / total,
    negativeSamples,
    positiveSamples,
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function buildMetaPrompt(
  skill: { name: string; description: string; systemPrompt: string; userPromptTemplate: string },
  stats: ExecutionStats,
): string {
  const negativeBlock =
    stats.negativeSamples.length > 0
      ? stats.negativeSamples
          .map(
            (s, i) =>
              `--- 负面案例 ${i + 1} ---\n输入: ${s.input}\n输出: ${s.output}\n评分: ${s.rating ?? "未评"}\n反馈: ${s.feedback ?? "无"}\n被编辑: ${s.wasEdited ? "是" : "否"}`,
          )
          .join("\n\n")
      : "暂无负面案例。";

  const positiveBlock =
    stats.positiveSamples.length > 0
      ? stats.positiveSamples
          .map(
            (s, i) =>
              `--- 正面案例 ${i + 1} ---\n输入: ${s.input}\n输出: ${s.output}\n评分: ${s.rating}`,
          )
          .join("\n\n")
      : "暂无高分案例。";

  return `你是一个 AI Prompt 优化专家。你的任务是分析一个 AI 技能的执行历史，找出问题并改进 prompt。

## 技能信息
- 名称: ${skill.name}
- 描述: ${skill.description}

## 当前 Prompt
### System Prompt:
${skill.systemPrompt}

### User Prompt Template:
${skill.userPromptTemplate}

## 执行统计
- 总执行次数: ${stats.total}
- 成功率: ${(stats.successRate * 100).toFixed(1)}%
- 平均评分: ${stats.avgRating?.toFixed(1) ?? "暂无"}
- 编辑率: ${(stats.editRate * 100).toFixed(1)}%

## 负面案例（低分/失败/被编辑）
${negativeBlock}

## 正面案例（高分）
${positiveBlock}

## 任务
请分析以上数据，输出改进后的 prompt。要求：
1. 分析负面案例的共性问题
2. 借鉴正面案例的优点
3. 输出改进后的 systemPrompt 和 userPromptTemplate
4. 列出具体改动说明

请严格按以下 JSON 格式输出：
\`\`\`json
{
  "analysis": "问题分析（1-3句话）",
  "changes": ["改动1说明", "改动2说明"],
  "systemPrompt": "改进后的完整 system prompt",
  "userPromptTemplate": "改进后的完整 user prompt template（保留 {{变量}} 占位符）"
}
\`\`\``;
}

interface OptimizationOutput {
  analysis: string;
  changes: string[];
  systemPrompt: string;
  userPromptTemplate: string;
}

function parseOptimizationOutput(raw: string): OptimizationOutput | null {
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (
      parsed.systemPrompt &&
      parsed.userPromptTemplate &&
      Array.isArray(parsed.changes)
    ) {
      return parsed as OptimizationOutput;
    }
  } catch {
    /* parse failed */
  }
  return null;
}

export async function optimizeSkill(
  skillId: string,
  options?: { force?: boolean },
): Promise<SkillOptimizationResult | null> {
  const skill = await db.agentSkill.findUniqueOrThrow({
    where: { id: skillId },
  });

  const stats = await gatherStats(skillId);

  if (!options?.force && stats.total < MIN_EXECUTIONS_FOR_OPTIMIZATION) {
    return null;
  }

  // 如果成功率 100% 且平均评分 >= 4.5，跳过优化
  if (
    !options?.force &&
    stats.successRate >= 1.0 &&
    stats.avgRating !== null &&
    stats.avgRating >= 4.5 &&
    stats.editRate === 0
  ) {
    return null;
  }

  const metaPrompt = buildMetaPrompt(
    {
      name: skill.name,
      description: skill.description,
      systemPrompt: skill.systemPrompt,
      userPromptTemplate: skill.userPromptTemplate,
    },
    stats,
  );

  const raw = await createCompletion({
    systemPrompt: "你是 AI Prompt 优化专家。请严格按照用户要求的 JSON 格式输出。",
    userPrompt: metaPrompt,
    mode: "deep",
    maxTokens: 4000,
  });

  const output = parseOptimizationOutput(raw);
  if (!output) {
    console.error("[SkillLearner] Failed to parse optimization output");
    return null;
  }

  // 验证优化输出不是空的或明显退化的
  if (output.systemPrompt.length < 20 || output.userPromptTemplate.length < 20) {
    console.error("[SkillLearner] Optimization output too short, rejecting");
    return null;
  }

  const oldPrompt = skill.systemPrompt;
  const newVersion = skill.version + 1;

  await db.agentSkill.update({
    where: { id: skillId },
    data: {
      systemPrompt: output.systemPrompt,
      userPromptTemplate: output.userPromptTemplate,
      version: newVersion,
      lastOptimizedAt: new Date(),
      optimizationCount: { increment: 1 },
    },
  });

  return {
    skillId,
    previousVersion: skill.version,
    newVersion,
    changes: output.changes,
    oldPrompt,
    newPrompt: output.systemPrompt,
  };
}

export async function getSkillStats(skillId: string): Promise<ExecutionStats> {
  return gatherStats(skillId);
}
