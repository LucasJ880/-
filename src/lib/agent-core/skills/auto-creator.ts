/**
 * 技能自动创建器
 *
 * 当 AI 在对话中反复执行类似的工具调用模式时，
 * 自动提炼为可复用的动态技能。
 *
 * 触发条件：
 * 1. 同一组织内，相似的工具调用序列出现 >= 3 次
 * 2. 用户在对话中描述了一个可重复的工作流
 * 3. 管理员手动触发（基于对话历史）
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";

interface ConversationPattern {
  userMessages: string[];
  toolSequence: string[];
  aiOutputSamples: string[];
}

interface SkillProposal {
  slug: string;
  name: string;
  description: string;
  domain: string;
  systemPrompt: string;
  userPromptTemplate: string;
  outputFormat: "text" | "json" | "markdown";
  requiredTools: string[];
  inputVariables: string[];
}

const EXTRACTION_PROMPT = `你是一个 AI 技能提取专家。分析用户的对话模式，将重复出现的工作流提炼为一个可复用的技能定义。

## 用户对话模式
{{patterns}}

## 任务
请将这些模式提炼为一个标准化技能。输出 JSON：
\`\`\`json
{
  "slug": "kebab-case-skill-name",
  "name": "中文技能名（简洁）",
  "description": "技能用途描述",
  "domain": "trade|sales|project|secretary",
  "systemPrompt": "执行此技能时的 AI 系统指令",
  "userPromptTemplate": "带 {{变量}} 占位符的用户 prompt 模板",
  "outputFormat": "text|json|markdown",
  "requiredTools": ["需要的工具列表"],
  "inputVariables": ["模板中的变量名列表"]
}
\`\`\`

注意：
- userPromptTemplate 中的变量用 {{variableName}} 格式
- systemPrompt 应包含输出格式要求和质量标准
- 保持技能专注，一个技能只做一件事`;

function parseProposal(raw: string): SkillProposal | null {
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.slug && parsed.name && parsed.systemPrompt && parsed.userPromptTemplate) {
      return parsed as SkillProposal;
    }
  } catch {
    /* parse failed */
  }
  return null;
}

export async function proposeSkillFromPatterns(
  orgId: string,
  patterns: ConversationPattern[],
): Promise<SkillProposal | null> {
  const patternText = patterns
    .map(
      (p, i) =>
        `### 模式 ${i + 1}\n用户输入: ${p.userMessages.join(" → ")}\n工具调用序列: ${p.toolSequence.join(" → ")}\nAI 输出样本: ${p.aiOutputSamples[0]?.slice(0, 300) ?? "无"}`,
    )
    .join("\n\n");

  const prompt = EXTRACTION_PROMPT.replace("{{patterns}}", patternText);

  const raw = await createCompletion({
    systemPrompt: "你是 AI 技能提取专家。请严格按照要求的 JSON 格式输出。",
    userPrompt: prompt,
    mode: "deep",
    maxTokens: 3000,
  });

  return parseProposal(raw);
}

export async function createSkillFromProposal(
  orgId: string,
  proposal: SkillProposal,
  createdById?: string,
): Promise<string> {
  const existing = await db.agentSkill.findUnique({
    where: { orgId_slug: { orgId, slug: proposal.slug } },
    select: { id: true },
  });

  if (existing) {
    throw new Error(`技能 "${proposal.slug}" 已存在`);
  }

  const inputSchema =
    proposal.inputVariables.length > 0
      ? {
          type: "object",
          properties: Object.fromEntries(
            proposal.inputVariables.map((v) => [
              v,
              { type: "string", description: v },
            ]),
          ),
          required: proposal.inputVariables,
        }
      : null;

  const skill = await db.agentSkill.create({
    data: {
      orgId,
      slug: proposal.slug,
      name: proposal.name,
      description: proposal.description,
      domain: proposal.domain,
      tier: "execution",
      systemPrompt: proposal.systemPrompt,
      userPromptTemplate: proposal.userPromptTemplate,
      outputFormat: proposal.outputFormat,
      temperature: 0.3,
      maxTokens: 2000,
      inputSchema: inputSchema ?? undefined,
      requiredTools:
        proposal.requiredTools.length > 0
          ? proposal.requiredTools.join(",")
          : null,
      isBuiltin: false,
      isActive: true,
      createdById,
    },
  });

  return skill.id;
}

export async function proposeSkillFromDescription(
  orgId: string,
  description: string,
): Promise<SkillProposal | null> {
  const prompt = `用户描述了一个想要自动化的工作流：

"${description}"

请将其提炼为一个标准化 AI 技能。输出 JSON：
\`\`\`json
{
  "slug": "kebab-case-skill-name",
  "name": "中文技能名",
  "description": "技能用途",
  "domain": "trade|sales|project|secretary",
  "systemPrompt": "完整的系统指令",
  "userPromptTemplate": "带 {{变量}} 的用户模板",
  "outputFormat": "text|json|markdown",
  "requiredTools": [],
  "inputVariables": ["变量名列表"]
}
\`\`\``;

  const raw = await createCompletion({
    systemPrompt: "你是 AI 技能设计专家。将用户描述转化为结构化技能定义，严格按 JSON 输出。",
    userPrompt: prompt,
    mode: "deep",
    maxTokens: 3000,
  });

  return parseProposal(raw);
}
