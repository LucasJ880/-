/**
 * 排查企微入站：网关 / 绑定 / 近期消息
 * 运行：npx tsx scripts/debug-wecom-inbound.ts
 */
import { db } from "@/lib/db";
import { PLATFORM_WECOM_ORG_ID } from "@/lib/messaging/platform-wecom";

async function main() {
  const gw = await db.weChatGateway.findMany({
    where: { channel: "wecom" },
    select: {
      orgId: true,
      status: true,
      mode: true,
      corpId: true,
      agentId: true,
      callbackToken: true,
      encodingKey: true,
      secret: true,
      lastHeartbeat: true,
      errorMessage: true,
      updatedAt: true,
    },
  });
  console.log("=== gateways ===");
  for (const g of gw) {
    console.log({
      orgId: g.orgId,
      isPlatform: g.orgId === PLATFORM_WECOM_ORG_ID,
      status: g.status,
      mode: g.mode,
      corpId: g.corpId,
      agentId: g.agentId,
      hasToken: Boolean(g.callbackToken),
      hasAes: Boolean(g.encodingKey),
      hasSecret: Boolean(g.secret),
      lastHeartbeat: g.lastHeartbeat,
      errorMessage: g.errorMessage,
    });
  }

  const bindings = await db.weChatBinding.findMany({
    where: { channel: "wecom" },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      userId: true,
      orgId: true,
      externalId: true,
      displayName: true,
      status: true,
      lastActiveAt: true,
      updatedAt: true,
    },
  });
  console.log("=== wecom bindings ===", bindings.length);
  console.log(bindings);

  const msgs = await db.weChatMessage.findMany({
    where: { channel: "wecom" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      direction: true,
      content: true,
      externalUserId: true,
      orgId: true,
      userId: true,
      createdAt: true,
      agentProcessed: true,
    },
  });
  console.log("=== recent wecom messages ===", msgs.length);
  console.log(msgs);

  const users = await db.user.findMany({
    where: {
      OR: [
        { email: { contains: "lucas", mode: "insensitive" } },
        { name: { contains: "Lucas", mode: "insensitive" } },
        { name: { contains: "李倩", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      activeOrgId: true,
      companyIdsJson: true,
    },
    take: 10,
  });
  console.log("=== candidate users ===");
  console.log(users);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
