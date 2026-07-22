import { db } from "../src/lib/db";

async function main() {
  const orgs = await db.organization.findMany({
    select: { id: true, name: true, code: true, status: true, ownerId: true },
    orderBy: { name: "asc" },
  });
  console.log("ORGS:");
  for (const o of orgs) console.log(JSON.stringify(o));

  for (const o of orgs) {
    if (!/sunny|梦馨|mengxin/i.test(`${o.name} ${o.code ?? ""}`)) continue;
    const members = await db.organizationMember.findMany({
      where: { orgId: o.id, status: "active" },
      select: {
        role: true,
        user: {
          select: {
            email: true,
            role: true,
            orgAccessMode: true,
            canSelfSwitchOrg: true,
          },
        },
      },
    });
    console.log("\nMEMBERS", o.name, "status=", o.status);
    for (const m of members) {
      console.log(
        m.role,
        m.user.email,
        "platform=",
        m.user.role,
        m.user.orgAccessMode,
        "switch=",
        m.user.canSelfSwitchOrg,
      );
    }
  }

  const trade = await db.user.findMany({
    where: { role: "trade" },
    select: {
      email: true,
      orgAccessMode: true,
      orgMemberships: {
        where: { status: "active" },
        select: { role: true, org: { select: { name: true } } },
      },
    },
  });
  console.log("\nTRADE USERS", JSON.stringify(trade, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
