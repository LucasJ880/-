import { db } from "@/lib/db";
import { OPERATIONS_SKILLS } from "@/lib/agent-core/skills/operations-seed";

export const MARKETING_SKILL_SLUG = "qingyan-marketing-analysis";

export async function ensureMarketingSkill(orgId: string) {
  const existing = await db.agentSkill.findUnique({
    where: { orgId_slug: { orgId, slug: MARKETING_SKILL_SLUG } },
  });
  const seed = OPERATIONS_SKILLS.find((item) => item.slug === MARKETING_SKILL_SLUG);
  if (!seed) throw new Error("市场情报技能定义不存在");

  // 内置技能的历史记录仍可能保留早期的 4.5K 限额。只向上同步，避免覆盖
  // 管理员主动设置的更高预算或其他可编辑字段。
  if (existing) {
    if (existing.isBuiltin && existing.maxTokens < seed.maxTokens) {
      return db.agentSkill.update({
        where: { id: existing.id },
        data: { maxTokens: seed.maxTokens },
      });
    }
    return existing;
  }

  return db.agentSkill.create({
    data: {
      orgId,
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      domain: "operations",
      tier: seed.tier,
      systemPrompt: seed.systemPrompt,
      userPromptTemplate: seed.userPromptTemplate,
      outputFormat: seed.outputFormat,
      temperature: seed.temperature,
      maxTokens: seed.maxTokens,
      inputSchema: seed.inputSchema
        ? JSON.parse(JSON.stringify(seed.inputSchema))
        : undefined,
      isBuiltin: true,
      isActive: true,
    },
  });
}
