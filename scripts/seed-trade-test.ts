/**
 * 外贸个人微信端到端测试数据 seed（幂等）
 *
 * 创建：
 * - 客户组织「外贸测试客户(窗帘)」+ 客户账号（org_admin）
 * - 处理方组织「加拿大履约测试团队」+ 处理方账号（org_admin）
 * - 客户组织的 personal_wechat 网关，预置 mode=trade_intake + 自动桥接到处理方组织
 *
 * 运行（需 .env.local 中的 DATABASE_URL/DIRECT_URL）：
 *   set -a; . ./.env.local; set +a; npx tsx scripts/seed-trade-test.ts
 *
 * 不会改动任何已有 org/user 数据；可重复执行。
 */

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const PASSWORD = process.env.SEED_TEST_PASSWORD || "Qingyan@2026";

const CLIENT = {
  email: "trade-client@test.qingyan.ai",
  name: "外贸测试客户",
  orgName: "外贸测试客户(窗帘)",
  orgCode: "trade-test-client",
};
const FULFILLMENT = {
  email: "canada-team@test.qingyan.ai",
  name: "加拿大履约测试",
  orgName: "加拿大履约测试团队",
  orgCode: "trade-test-fulfillment",
};

async function upsertUser(email: string, name: string) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  return db.user.upsert({
    where: { email },
    update: { passwordHash, status: "active", role: "trade", authProvider: "email" },
    create: { email, name, passwordHash, role: "trade", status: "active", authProvider: "email" },
  });
}

async function upsertOrg(code: string, name: string, ownerId: string) {
  const existing = await db.organization.findUnique({ where: { code } });
  if (existing) {
    return db.organization.update({
      where: { code },
      data: { name, status: "active" },
    });
  }
  return db.organization.create({
    data: { name, code, ownerId, status: "active", planType: "free" },
  });
}

async function upsertMembership(orgId: string, userId: string) {
  return db.organizationMember.upsert({
    where: { orgId_userId: { orgId, userId } },
    update: { role: "org_admin", status: "active" },
    create: { orgId, userId, role: "org_admin", status: "active" },
  });
}

async function main() {
  console.log("=== seed 外贸个人微信测试数据 ===\n");

  const clientUser = await upsertUser(CLIENT.email, CLIENT.name);
  const fulfillUser = await upsertUser(FULFILLMENT.email, FULFILLMENT.name);

  const clientOrg = await upsertOrg(CLIENT.orgCode, CLIENT.orgName, clientUser.id);
  const fulfillOrg = await upsertOrg(FULFILLMENT.orgCode, FULFILLMENT.orgName, fulfillUser.id);

  await upsertMembership(clientOrg.id, clientUser.id);
  await upsertMembership(fulfillOrg.id, fulfillUser.id);

  // 客户组织的个人微信网关，预置为外贸受理模式 + 自动桥接到处理方组织
  await db.weChatGateway.upsert({
    where: { orgId_channel: { orgId: clientOrg.id, channel: "personal_wechat" } },
    update: { mode: "trade_intake", fulfillmentOrgId: fulfillOrg.id },
    create: {
      orgId: clientOrg.id,
      channel: "personal_wechat",
      status: "inactive",
      loginStatus: "disconnected",
      mode: "trade_intake",
      fulfillmentOrgId: fulfillOrg.id,
    },
  });

  // 客户组织的企业微信网关，预置为外贸受理模式 + 自动桥接（凭证留空，用户在 UI 填 corpId/secret/token/AESKey）
  await db.weChatGateway.upsert({
    where: { orgId_channel: { orgId: clientOrg.id, channel: "wecom" } },
    update: { mode: "trade_intake", fulfillmentOrgId: fulfillOrg.id },
    create: {
      orgId: clientOrg.id,
      channel: "wecom",
      status: "inactive",
      loginStatus: "disconnected",
      mode: "trade_intake",
      fulfillmentOrgId: fulfillOrg.id,
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://<你的域名>";

  console.log("已创建/更新：");
  console.table([
    { 角色: "客户(扫码方)", 邮箱: CLIENT.email, 组织: clientOrg.name, orgId: clientOrg.id },
    { 角色: "加拿大(履约方)", 邮箱: FULFILLMENT.email, 组织: fulfillOrg.name, orgId: fulfillOrg.id },
  ]);
  console.log(`\n登录密码（两账号相同）：${PASSWORD}`);
  console.log(`\n客户网关已预置：mode=trade_intake, fulfillmentOrgId=${fulfillOrg.id}`);
  console.log("个人微信：客户账号登录后到 设置/微信集成 直接「扫码登录」（需 ClawBot 灰度账号）。");
  console.log("企业微信：客户账号登录后到 设置/微信集成 → 配置企业微信，填入自建应用凭证；");
  console.log(`  回调 URL：${appUrl}/api/messaging/wecom/callback?org=${clientOrg.id}`);

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("seed failed:", e);
  await db.$disconnect();
  process.exit(1);
});
