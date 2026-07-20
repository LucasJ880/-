/**
 * 企业数字员工技能包种子导入（Phase 1 · 销售/营销/招投标/MMM）
 *
 * 技能定义见：
 *   src/lib/agent-core/skills/sales-seed.ts
 *   src/lib/agent-core/skills/marketing-growth-seed.ts
 *   src/lib/agent-core/skills/tender-seed.ts
 *
 * 幂等：按 (orgId, slug) 跳过已存在技能，不覆盖人工改过的 prompt。
 * 不修改现有 23 条运营技能（domain=operations）。
 *
 * 用法：
 *   npm run seed:enterprise-skills -- --org sunny-shutter-bid-lead
 *   npm run seed:enterprise-skills:write -- --org sunny-shutter-bid-lead
 */

import { db } from "@/lib/db";
import { ENTERPRISE_SKILLS } from "@/lib/agent-core/skills/enterprise-index";

const WRITE = process.argv.includes("--write");
const ALLOW_INACTIVE = process.argv.includes("--allow-inactive");
const orgArgIdx = process.argv.indexOf("--org");
const ORG_CODE =
  orgArgIdx > -1 ? process.argv[orgArgIdx + 1] : "sunny-shutter-bid-lead";

async function main() {
  const org = await db.organization.findUnique({
    where: { code: ORG_CODE },
    select: { id: true, name: true, status: true },
  });
  if (!org) throw new Error(`组织不存在: code=${ORG_CODE}`);
  if (org.status !== "active" && !ALLOW_INACTIVE) {
    throw new Error(
      `组织 ${ORG_CODE} 非 active（status=${org.status}）。若确认导入请加 --allow-inactive`,
    );
  }

  console.log(`目标组织: ${org.name} (${ORG_CODE}) status=${org.status}`);
  console.log(`模式: ${WRITE ? "WRITE 写入" : "DRY-RUN 只读"}`);
  if (org.status !== "active") {
    console.log("注意: 使用 --allow-inactive，组织非 active");
  }
  console.log(`定义条数: ${ENTERPRISE_SKILLS.length}\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const seed of ENTERPRISE_SKILLS) {
    try {
      const existing = await db.agentSkill.findUnique({
        where: { orgId_slug: { orgId: org.id, slug: seed.slug } },
        select: { id: true, isBuiltin: true },
      });
      if (existing) {
        console.log(`  跳过（已存在）: ${seed.slug} ${seed.name}`);
        skipped += 1;
        continue;
      }

      console.log(
        `  ${WRITE ? "创建" : "将创建"}: ${seed.slug} ${seed.name} [${seed.domain}/${seed.tier}]`,
      );
      if (WRITE) {
        await db.agentSkill.create({
          data: {
            orgId: org.id,
            slug: seed.slug,
            name: seed.name,
            description: seed.description,
            domain: seed.domain,
            tier: seed.tier,
            systemPrompt: seed.systemPrompt,
            userPromptTemplate: seed.userPromptTemplate,
            outputFormat: seed.outputFormat,
            temperature: seed.temperature,
            maxTokens: seed.maxTokens,
            inputSchema: seed.inputSchema
              ? JSON.parse(JSON.stringify(seed.inputSchema))
              : undefined,
            outputSchema: seed.outputSchema
              ? JSON.parse(JSON.stringify(seed.outputSchema))
              : undefined,
            requiredTools: seed.requiredTools ?? null,
            isBuiltin: true,
            isActive: true,
          },
        });
      }
      created += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `  失败: ${seed.slug}`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `\n完成: ${WRITE ? "创建" : "待创建"} ${created}，跳过 ${skipped}，失败 ${failed}，定义 ${ENTERPRISE_SKILLS.length}`,
  );
  if (!WRITE && created > 0) {
    console.log(
      "确认无误后执行: npm run seed:enterprise-skills:write -- --org " +
        ORG_CODE,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
