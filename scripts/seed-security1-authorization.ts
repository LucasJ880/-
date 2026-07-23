/**
 * Security-1：为全部活跃企业 seed RoleProfile / PositionTemplate / 默认绑定
 *
 * 用法：npx tsx scripts/seed-security1-authorization.ts
 */

import { seedAllOrgAuthorizationProfiles } from "../src/lib/authorization/seed-org-profiles";

async function main() {
  const n = await seedAllOrgAuthorizationProfiles();
  console.log(`[security1] seeded authorization profiles for ${n} orgs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
