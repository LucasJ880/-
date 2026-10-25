/**
 * Muse Bridge — 创建 Bridge 专用 ApiToken（P0-10）
 *
 * 运行（在仓库根目录，.env 已配置 DATABASE_URL）：
 *   npx tsx scripts/muse-bridge/seed-token.ts            # 不存在则创建，存在则提示
 *   npx tsx scripts/muse-bridge/seed-token.ts --rotate   # 吊销旧的并签发新的
 *
 * token 只打印一次，复制到 Muse--Bridge-bot 的 QINGYAN_API_TOKEN；青砚库里只存 token 本身（无 hash，与现有 ApiToken 表一致）。
 */

import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const NAME = "Muse Bridge";
const SYSTEM = "muse-bridge";
const PERMISSIONS = "muse:bridge";

async function main() {
  const rotate = process.argv.includes("--rotate");
  const existing = await db.apiToken.findFirst({ where: { system: SYSTEM, isActive: true }, orderBy: { createdAt: "desc" } });

  if (existing && !rotate) {
    console.log(`已有有效的 Muse Bridge token（id=${existing.id}，创建于 ${existing.createdAt.toISOString()}）。`);
    console.log("token 不会二次显示；需要换一个请加 --rotate。");
    return;
  }
  if (existing && rotate) {
    await db.apiToken.update({ where: { id: existing.id }, data: { isActive: false } });
    console.log(`已吊销旧 token id=${existing.id}`);
  }

  const token = `qy_${crypto.randomBytes(32).toString("hex")}`;
  const rec = await db.apiToken.create({
    data: { name: NAME, token, system: SYSTEM, permissions: PERMISSIONS, expiresAt: null },
  });
  console.log("\n✓ Muse Bridge ApiToken 已创建（只显示这一次，请立即保存）\n");
  console.log(`  id          ${rec.id}`);
  console.log(`  system      ${rec.system}`);
  console.log(`  permissions ${rec.permissions}`);
  console.log(`  token       ${token}\n`);
  console.log("写到 Muse--Bridge-bot 的环境变量：QINGYAN_API_TOKEN=" + token);
}

main()
  .catch((e) => {
    console.error("失败：", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
