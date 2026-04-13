/**
 * 动态技能运行时
 *
 * 从数据库加载技能定义，编译 prompt 模板，通过 Agent Core 执行，
 * 记录执行轨迹到 SkillExecution。
 */

import { db } from "@/lib/db";
import { runAgent } from "../engine";
import type { ToolDomain } from "../types";
import type { DynamicSkillDef, SkillRunInput, SkillRunOutput } from "./types";

function compileTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

function loadRequiredTools(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function toSkillDef(row: {
  id: string;
  slug: string;
  name: string;
  description: string;
  domain: string;
  tier: string;
  systemPrompt: string;
  userPromptTemplate: string;
  outputFormat: string;
  temperature: number;
  maxTokens: number;
  inputSchema: unknown;
  outputSchema: unknown;
  requiredTools: string | null;
  version: number;
  isBuiltin: boolean;
}): DynamicSkillDef {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    domain: row.domain,
    tier: row.tier,
    systemPrompt: row.systemPrompt,
    userPromptTemplate: row.userPromptTemplate,
    outputFormat: row.outputFormat as DynamicSkillDef["outputFormat"],
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    inputSchema: (row.inputSchema as Record<string, unknown>) ?? null,
    outputSchema: (row.outputSchema as Record<string, unknown>) ?? null,
    requiredTools: loadRequiredTools(row.requiredTools),
    version: row.version,
    isBuiltin: row.isBuiltin,
  };
}

async function loadSkill(input: SkillRunInput): Promise<DynamicSkillDef> {
  const where = input.skillId
    ? { id: input.skillId }
    : input.slug
      ? { orgId_slug: { orgId: input.orgId, slug: input.slug } }
      : null;

  if (!where) throw new Error("必须提供 skillId 或 slug");

  const row = await db.agentSkill.findUniqueOrThrow({ where });
  return toSkillDef(row);
}

export async function runSkill(input: SkillRunInput): Promise<SkillRunOutput> {
  const start = Date.now();
  const skill = await loadSkill(input);

  const userPrompt = compileTemplate(skill.userPromptTemplate, input.variables);

  let systemPrompt = skill.systemPrompt;
  if (skill.outputFormat === "json") {
    systemPrompt += "\n\n请严格以 JSON 格式输出，不要添加任何额外文字。";
  }

  const domains = new Set<ToolDomain>();
  for (const toolName of skill.requiredTools) {
    const [domain] = toolName.split(".");
    if (domain) domains.add(domain as ToolDomain);
  }

  const result = await runAgent({
    systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    tools: skill.requiredTools.length > 0 ? skill.requiredTools : undefined,
    domains: domains.size > 0 ? Array.from(domains) : undefined,
    mode: "chat",
    temperature: skill.temperature,
    userId: input.userId,
    orgId: input.orgId,
    maxToolRounds: 3,
  });

  const durationMs = Date.now() - start;

  let parsed: unknown = undefined;
  if (skill.outputFormat === "json") {
    try {
      const cleaned = result.content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      /* output not parseable, keep raw */
    }
  }

  const execution = await db.skillExecution.create({
    data: {
      skillId: skill.id,
      userId: input.userId,
      inputJson: JSON.stringify(input.variables),
      outputJson: result.content,
      toolCalls: JSON.parse(JSON.stringify(
        result.toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
      )),
      success: true,
      durationMs,
      promptSnapshot: `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}`,
    },
  });

  return {
    success: true,
    content: result.content,
    parsed,
    toolCalls: result.toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
    durationMs,
    executionId: execution.id,
  };
}

export async function recordFeedback(
  executionId: string,
  feedback: { rating?: number; feedback?: string; wasEdited?: boolean },
): Promise<void> {
  await db.skillExecution.update({
    where: { id: executionId },
    data: {
      userRating: feedback.rating,
      userFeedback: feedback.feedback,
      wasEdited: feedback.wasEdited,
    },
  });
}

export async function listOrgSkills(
  orgId: string,
  filters?: { domain?: string; activeOnly?: boolean },
): Promise<DynamicSkillDef[]> {
  const rows = await db.agentSkill.findMany({
    where: {
      orgId,
      ...(filters?.domain ? { domain: filters.domain } : {}),
      ...(filters?.activeOnly !== false ? { isActive: true } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  return rows.map(toSkillDef);
}
