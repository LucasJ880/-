/**
 * 运营技能包种子导入 — 23 条 AgentSkill（domain=operations）
 *
 * 技能定义见 src/lib/agent-core/skills/operations-seed.ts
 * （方法论借鉴 xiaohongshu-ops-skill 的 SOP 与 adclaw 的技能分类法）
 *
 * 幂等：按 (orgId, slug) 跳过已存在的技能，不覆盖人工改过的 prompt。
 *
 * 用法：
 *   npm run seed:ops-skills -- --org sunny-shutter-bid-lead          # dry-run（默认）
 *   npm run seed:ops-skills:write -- --org sunny-shutter-bid-lead    # 真实写入
 */

import { db } from "@/lib/db";
import { OPERATIONS_SKILLS } from "@/lib/agent-core/skills/operations-seed";

const WRITE = process.argv.includes("--write");
const orgArgIdx = process.argv.indexOf("--org");
const ORG_CODE = orgArgIdx > -1 ? process.argv[orgArgIdx + 1] : "sunny-shutter-bid-lead";

async function main() {
  const org = await db.organization.findUnique({
    where: { code: ORG_CODE },
    select: { id: true, name: true, status: true },
  });
  if (!org) throw new Error(`组织不存在: code=${ORG_CODE}`);
  if (org.status !== "active") throw new Error(`组织 ${ORG_CODE} 非 active 状态`);

  console.log(`目标组织: ${org.name} (${ORG_CODE})`);
  console.log(`模式: ${WRITE ? "WRITE 写入" : "DRY-RUN 只读"}\n`);

  let created = 0;
  let skipped = 0;

  for (const seed of OPERATIONS_SKILLS) {
    const existing = await db.agentSkill.findUnique({
      where: { orgId_slug: { orgId: org.id, slug: seed.slug } },
      select: { id: true },
    });
    if (existing) {
      console.log(`  跳过（已存在）: ${seed.slug} ${seed.name}`);
      skipped += 1;
      continue;
    }

    console.log(`  ${WRITE ? "创建" : "将创建"}: ${seed.slug} ${seed.name} [${seed.tier}]`);
    if (WRITE) {
      await db.agentSkill.create({
        data: {
          orgId: org.id,
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
    created += 1;
  }

  console.log(`\n完成: ${WRITE ? "创建" : "待创建"} ${created} 条，跳过 ${skipped} 条，共 ${OPERATIONS_SKILLS.length} 条定义`);
  if (!WRITE && created > 0) {
    console.log("确认无误后执行: npm run seed:ops-skills:write");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
