/**
 * Security-1：迁移 / seed 冒烟（对已部署库；不执行 migrate reset）
 * 用法：npx tsx scripts/security1-migrate-smoke.ts
 */

import { db } from "../src/lib/db";
import { seedOrgAuthorizationProfiles } from "../src/lib/authorization/seed-org-profiles";

async function main() {
  const uuid = await db.$queryRawUnsafe<Array<{ id: string }>>(
    "select gen_random_uuid()::text as id",
  );
  console.log("gen_random_uuid:", uuid[0]?.id ? "ok" : "fail");

  const mode = await db.$queryRawUnsafe<Array<{ t: string }>>(
    `select typname as t from pg_type where typname = 'OrgAccessMode'`,
  );
  console.log("OrgAccessMode enum:", mode.length ? "ok" : "fail");

  const owners = await db.organizationMember.count({
    where: { role: "org_owner", status: "active" },
  });
  console.log("active org_owner memberships:", owners);

  const org = await db.organization.findFirst({
    where: { status: "active" },
    select: { id: true, name: true },
  });
  if (!org) throw new Error("no active org");
  const a = await seedOrgAuthorizationProfiles(org.id);
  const b = await seedOrgAuthorizationProfiles(org.id);
  console.log("seed first:", a);
  console.log("seed second (idempotent):", b);
  console.log(
    "idempotent profiles:",
    a.profiles === b.profiles ? "ok" : "warn",
  );

  const switchers = await db.user.count({ where: { canSelfSwitchOrg: true } });
  console.log("canSelfSwitchOrg=true count:", switchers, switchers === 0 ? "ok" : "FAIL");
  if (switchers > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
