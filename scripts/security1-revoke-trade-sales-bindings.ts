/**
 * 撤销 trade 用户误绑的 sales_rep PrincipalRoleBinding
 * 用法：npx tsx scripts/security1-revoke-trade-sales-bindings.ts
 */

import { db } from "../src/lib/db";

async function main() {
  const tradeUsers = await db.user.findMany({
    where: { role: "trade" },
    select: { id: true, email: true },
  });
  if (tradeUsers.length === 0) {
    console.log("no trade users");
    return;
  }
  const ids = tradeUsers.map((u) => u.id);
  const bindings = await db.principalRoleBinding.findMany({
    where: {
      principalType: "HUMAN",
      principalId: { in: ids },
      status: "active",
      roleProfile: { key: "sales_rep" },
    },
    select: { id: true, principalId: true, orgId: true },
  });

  let n = 0;
  for (const b of bindings) {
    await db.principalRoleBinding.update({
      where: { id: b.id },
      data: { status: "inactive" },
    });
    n += 1;
    console.log(`revoked sales_rep binding ${b.id} user=${b.principalId} org=${b.orgId}`);
  }
  console.log(`done: revoked ${n}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
