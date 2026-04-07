/**
 * Orchestrator 规划 Prompt
 *
 * 给定用户意图 + 项目上下文 + 可用技能清单（含 v2 字段），
 * 要求 LLM 输出结构化的执行步骤数组。
 */

interface SkillSummary {
  id: string;
  name: string;
  domain: string;
  tier: string | undefined;
  description: string;
  actions: string[];
  riskLevel: string;
  requiresApproval: boolean;
  inputSchema: Record<string, string>;
  dependsOn: string[];
  expertRoleId: string | undefined;
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
2. 如果技能有 actions 列表，步骤中必须通过 inputMapping 指定 action
3. 步骤按执行顺序排列，第一步通常是 "project_understanding"（加载上下文）
4. 尊重技能的 dependsOn：如果技能 A 依赖技能 B，B 必须排在 A 之前
5. 涉及数据修改的步骤，riskLevel 至少为 "medium"，requiresApproval 为 true
6. 涉及对外发送（邮件等）的步骤，riskLevel 必须为 "high"，requiresApproval 为 true
7. 只读/分析类步骤，riskLevel 为 "low"，requiresApproval 为 false
8. 如果涉及报价，必须在生成草稿后安排审查步骤
9. 步骤数量 2-8 步，不要过于细碎也不要遗漏关键环节
10. 输出纯 JSON 数组，不要输出其他内容

## 技能层级说明
- foundation: 基础数据加载，通常排在最前
- analysis: 分析类技能，基于基础数据产出判断
- execution: 执行类技能，产出实际交付物（报价、邮件等）

## 输出格式
\`\`\`json
[
  {
    "skillId": "project_understanding",
    "title": "加载项目上下文",
    "description": "获取项目详情、任务统计、供应商记录和 AI 历史",
    "riskLevel": "low",
    "requiresApproval": false,
    "inputMapping": {}
  }
]
\`\`\``;
}

export function getOrchestratorUserPrompt(input: OrchestratorPromptInput): string {
  const skillList = input.availableSkills
    .map((s) => {
      const parts = [`- **${s.id}**（${s.name}）`];
      if (s.tier) parts.push(`[层级: ${s.tier}]`);
      parts.push(`[风险: ${s.riskLevel}]`);
      if (s.requiresApproval) parts.push("[需审批]");
      if (s.actions.length > 0) parts.push(`[动作: ${s.actions.join(", ")}]`);
      if (s.dependsOn.length > 0) parts.push(`[依赖: ${s.dependsOn.join(", ")}]`);
      if (s.expertRoleId) parts.push(`[专家: ${s.expertRoleId}]`);
      parts.push(`\n  ${s.description}`);
      if (Object.keys(s.inputSchema).length > 0) {
        parts.push(`\n  输入: ${JSON.stringify(s.inputSchema)}`);
      }
      return parts.join(" ");
    })
    .join("\n");

  return `## 用户意图
${input.intent}

## 项目
${input.projectName}

## 项目上下文摘要
${input.projectContext.slice(0, 2000)}

## 可用技能（共 ${input.availableSkills.length} 个）
${skillList}

请根据以上信息，输出执行步骤 JSON 数组。`;
}
