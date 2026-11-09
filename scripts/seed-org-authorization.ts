/**
 * 对单个企业重跑岗位模板落地（VIS-2）
 *
 * 只 upsert 岗位 / 权限绑定，并按既有规则补自动绑定（org_owner / org_admin 系统模板；没有任何绑定的平台 sales → sales_rep、
 * trade → trade_rep）；不删除、不改动任何已有绑定。与 scripts/seed-security1-authorization.ts 相同的逻辑，但只动一个企业。
 *
 * 用法：npx tsx scripts/seed-org-authorization.ts --org <企业 code>
 * 生产执行走 Owner Gate。
 */

import { db } from "../src/lib/db";
import { seedOrgAuthorizationProfiles } from "../src/lib/authorization/seed-org-profiles";

async function main() {
  const i = process.argv.indexOf("--org");
  const code = i >= 0 ? process.argv[i + 1]?.trim() : "";
  if (!code) {
    console.error("用法：npx tsx scripts/seed-org-authorization.ts --org <企业 code>");
    process.exit(2);
  }
  const org = await db.organization.findUnique({ where: { code }, select: { id: true, name: true, status: true, industryPackId: true } });
  if (!org) {
    console.error(`[seed-org-authorization] 找不到企业 code=${code}`);
    process.exit(2);
  }
  if (org.status === "archived") {
    console.error(`[seed-org-authorization] 企业 ${org.name} 已归档，不处理`);
    process.exit(2);
  }
  const r = await seedOrgAuthorizationProfiles(org.id);
  console.log(
    `[seed-org-authorization] ${org.name}（${code}，行业包 ${org.industryPackId ?? "无"}）：岗位 ${r.profiles}、权限绑定 ${r.bindings}、岗位模板 ${r.positions}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
