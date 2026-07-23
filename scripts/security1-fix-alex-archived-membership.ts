/**
 * 将 Alex 在 archived「Sunny Shutter --Bid Lead」上的 membership 设为 inactive。
 * 不删除、不搬迁任何历史业务数据；仅避免 FIXED 用户被误判为多组织。
 */
import { db } from "../src/lib/db";

async function main() {
  const alex = await db.user.findUnique({
    where: { email: "alex@sunnyshutter.ca" },
  });
  if (!alex) throw new Error("alex missing");
  const archived = await db.organization.findFirst({
    where: { code: "sunny-shutter-bid-lead" },
  });
  if (!archived) throw new Error("archived org missing");

  const updated = await db.organizationMember.updateMany({
    where: {
      userId: alex.id,
      orgId: archived.id,
      status: "active",
    },
    data: { status: "inactive" },
  });
  console.log(
    JSON.stringify({
      alexId: alex.id,
      archivedOrgId: archived.id,
      membershipsDeactivated: updated.count,
      note: "historical sales data untouched",
    }),
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
