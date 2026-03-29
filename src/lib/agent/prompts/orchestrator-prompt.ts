/**
 * Orchestrator 规划 Prompt
 *
 * 给定用户意图 + 项目上下文 + 可用技能清单，
 * 要求 LLM 输出结构化的执行步骤数组。
 */

interface SkillSummary {
  id: string;
  name: string;
  domain: string;
  description: string;
  riskLevel: string;
  requiresApproval: boolean;
}

interface OrchestratorPromptInput {
  intent: string;
  projectName: string;
  projectContext: string;
  availableSkills: SkillSummary[];
}

export function getOrchestratorSystemPrompt(): string {
  return `你是青砚 AI 编排器。你的任务是将用户的业务意图分解为一系列可执行步骤。

## 规则
1. 每个步骤必须使用可用技能列表中的 skillId，不得发明新的 skillId
2. 步骤按执行顺序排列，第一步通常是 "project_understanding"（加载上下文）
3. 涉及数据修改的步骤，riskLevel 至少为 "medium"，requiresApproval 为 true
4. 涉及对外发送（邮件等）的步骤，riskLevel 必须为 "high"，requiresApproval 为 true
5. 只读/分析类步骤，riskLevel 为 "low"，requiresApproval 为 false
6. 如果涉及报价，必须在生成草稿后安排审查步骤
7. 步骤数量 2-8 步，不要过于细碎也不要遗漏关键环节
8. 输出纯 JSON 数组，不要输出其他内容

## 输出格式
\`\`\`json
[
  {
    "skillId": "project_understanding",
    "title": "加载项目上下文",
    "description": "获取项目详情、任务统计、供应商记录和 AI 历史",
    "riskLevel": "low",
    "requiresApproval": false
  }
]
\`\`\``;
}

export function getOrchestratorUserPrompt(input: OrchestratorPromptInput): string {
  const skillList = input.availableSkills
    .map(
      (s) =>
        `- ${s.id}（${s.name}）: ${s.description} [风险: ${s.riskLevel}, 需审批: ${s.requiresApproval ? "是" : "否"}]`
    )
    .join("\n");

  return `## 用户意图
${input.intent}

## 项目
${input.projectName}

## 项目上下文摘要
${input.projectContext.slice(0, 2000)}

## 可用技能
${skillList}

请根据以上信息，输出执行步骤 JSON 数组。`;
}
