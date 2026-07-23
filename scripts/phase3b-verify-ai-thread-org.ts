/**
 * Phase 3B-A：迁移后验收计数
 *   npx tsx scripts/phase3b-verify-ai-thread-org.ts
 */

import { db } from "../src/lib/db";

async function main() {
  const total = await db.aiThread.count();
  const withOrg = await db.aiThread.count({ where: { orgId: { not: null } } });
  const nullArchived = await db.aiThread.count({
    where: { orgId: null, archived: true },
  });
  const nullOpen = await db.aiThread.count({
    where: { orgId: null, archived: false },
  });

  // 跨 org 异常：线程 org ≠ 关联项目 org
  const mismatchedProject = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "AiThread" t
    JOIN "Project" p ON p.id = t."projectId"
    WHERE t."orgId" IS NOT NULL
      AND p."orgId" IS NOT NULL
      AND t."orgId" <> p."orgId"
  `;

  const summary = {
    generatedAt: new Date().toISOString(),
    totalThreads: total,
    orgIdNonNull: withOrg,
    orgIdNullArchived: nullArchived,
    orgIdNullNotArchived: nullOpen,
    crossOrgProjectMismatch: Number(mismatchedProject[0]?.count ?? 0),
    acceptance: {
      newThreadsMustHaveOrgId: "enforced_in_app",
      orgIdNullNotArchivedMustBeZero: nullOpen === 0,
      crossOrgApiMustReject: "covered_by_unit_and_route_guards",
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (nullOpen !== 0) {
    console.error("ACCEPTANCE_FAIL: orgId=null AND archived=false > 0");
    process.exit(2);
  }
  console.log("ACCEPTANCE_OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
