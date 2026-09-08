/**
 * 公司 → 组织层级回填：按行业包把组织归属到公司。
 *
 * 映射规则（确定性、可重复执行）：
 *   window_covering_services_v1 → 公司 slug "sunny"
 *   home_textile_trade_v1       → 公司 slug "mengxin"
 * 其余（无行业包的个人工作区/测试组织）保持独立，不动。
 *
 * 默认 dry-run 只打印：
 *   npx tsx scripts/link-orgs-to-companies.ts
 * 确认后写库：
 *   npx tsx scripts/link-orgs-to-companies.ts --write
 */

import { PrismaClient } from "@prisma/client";

const PACK_TO_COMPANY_SLUG: Record<string, string> = {
  window_covering_services_v1: "sunny",
  home_textile_trade_v1: "mengxin",
};

const WRITE = process.argv.includes("--write");
const db = new PrismaClient();

async function main() {
  const companies = await db.company.findMany({
    select: { id: true, name: true, slug: true },
  });
  const bySlug = new Map(companies.map((c) => [c.slug, c]));

  const orgs = await db.organization.findMany({
    select: { id: true, name: true, industryPackId: true, companyId: true },
    orderBy: { createdAt: "asc" },
  });

  let toPatch = 0;
  for (const org of orgs) {
    const slug = org.industryPackId
      ? PACK_TO_COMPANY_SLUG[org.industryPackId]
      : undefined;
    const tag = `${org.name} (${org.id}) pack=${org.industryPackId ?? "无"}`;

    if (!slug) {
      console.log(`— 保持独立: ${tag}`);
      continue;
    }
    const company = bySlug.get(slug);
    if (!company) {
      console.log(`⚠ 公司 slug=${slug} 不存在，跳过: ${tag}`);
      continue;
    }
    if (org.companyId === company.id) {
      console.log(`✓ 已归属 ${company.name}: ${tag}`);
      continue;
    }
    if (org.companyId && org.companyId !== company.id) {
      console.log(`⚠ 已归属其他公司(${org.companyId})，不覆盖，请人工确认: ${tag}`);
      continue;
    }

    toPatch += 1;
    if (WRITE) {
      await db.organization.update({
        where: { id: org.id },
        data: { companyId: company.id },
      });
      console.log(`✏ 已归属 ${company.name}: ${tag}`);
    } else {
      console.log(`→ 将归属 ${company.name}: ${tag}`);
    }
  }

  console.log(
    WRITE
      ? `\n完成：写入 ${toPatch} 个组织归属。`
      : `\ndry-run：${toPatch} 个组织待归属。确认无误后加 --write 执行。`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
