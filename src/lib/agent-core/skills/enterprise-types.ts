/**
 * 企业数字员工技能 — 种子定义类型
 */

export type EnterpriseSkillTier = "foundation" | "analysis" | "execution";

export interface EnterpriseSkillSeed {
  slug: string;
  name: string;
  description: string;
  domain: "sales" | "marketing" | "project" | "analytics";
  tier: EnterpriseSkillTier;
  systemPrompt: string;
  userPromptTemplate: string;
  outputFormat: "json" | "markdown" | "text";
  temperature: number;
  maxTokens: number;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  /** 逗号分隔，使用 agent-core 真实工具名（下划线） */
  requiredTools?: string | null;
  /** 是否可能产出 PendingAction 建议（仅草稿/提案，不直接执行） */
  mayProposePendingAction?: boolean;
}

export const ENTERPRISE_SKILL_SAFETY = `安全与证据红线（违反即返工）：
1. 严格区分三类信息：已观察事实、基于事实的推断、待执行建议。不得把推断写成事实。
2. 只使用用户输入、工具返回或知识库检索结果；缺少证据时标记为 missing/unknown/待验证，禁止编造。
3. 不得直接发送邮件、修改广告预算、发布内容、批量联系客户、修改销售阶段、创建正式日历、修改企业事实、提交投标。
4. 需要副作用时，仅输出草稿或 pendingActionProposal（type 必须属于青砚已支持的 PendingAction），等待人工确认。
5. 所有数值建议必须说明依据；所有风险结论必须可追溯到输入或检索来源。
6. 组织隔离：只使用当前组织数据，不得假设跨组织信息。`;
