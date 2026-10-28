/**
 * 一次性：对梦馨跑 seedOrgAuthorizationProfiles，并列出全部 active 岗位绑定（PERM-6b 上线顺序第 1 步）。
 * 只做 upsert，可重复跑。用完可删除本文件（不要提交）。
 */
import { db } from "../src/lib/db";
import { seedOrgAuthorizationProfiles } from "../src/lib/authorization/seed-org-profiles";

const CODE = process.argv[2] ?? "mengxin-home-textile";

async function main() {
  const org = await db.organization.findUnique({ where: { code: CODE }, select: { id: true, name: true } });
  if (!org) {
    console.error(`找不到企业 code=${CODE}`);
    process.exit(2);
  }
  console.log(org.name, await seedOrgAuthorizationProfiles(org.id));
  const rows = await db.principalRoleBinding.findMany({
    where: { orgId: org.id, status: "active" },
    select: { principalId: true, roleProfile: { select: { key: true } } },
  });
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.principalId) } }, select: { id: true, email: true } });
  for (const r of rows) console.log(users.find((u) => u.id === r.principalId)?.email ?? r.principalId, "→", r.roleProfile.key);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
