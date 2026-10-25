/**
 * Muse Bridge — 把一个 Muse 用户 id 绑定到青砚用户（P0-3 的 CLI 版，等价于 POST /api/organizations/{orgId}/muse-bindings）
 *
 * 运行：
 *   npx tsx scripts/muse-bridge/bind.ts --org <orgId> --muse <museUserId> --email <青砚登录邮箱>
 *   npx tsx scripts/muse-bridge/bind.ts --org <orgId> --list
 *   npx tsx scripts/muse-bridge/bind.ts --org <orgId> --muse <museUserId> --unbind
 *
 * 校验与 API 一致：目标用户必须是该 org 的 active 成员。
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import { readMuseBindings, withMuseBinding } from "../../src/lib/muse-bridge/binding-pure";

const db = new PrismaClient();

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const orgId = arg("org");
  if (!orgId) throw new Error("缺 --org <orgId>（在青砚 组织设置 页面地址栏里能看到）");

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, settingsJson: true } });
  if (!org) throw new Error(`组织不存在：${orgId}`);

  if (has("list")) {
    const b = readMuseBindings(org.settingsJson);
    console.log(`组织「${org.name}」当前绑定 ${Object.keys(b).length} 条：`);
    for (const [ref, r] of Object.entries(b)) console.log(`  ${ref} → userId=${r.userId}  (${r.boundAt} by ${r.boundBy})`);
    return;
  }

  const museUserId = arg("muse");
  if (!museUserId) throw new Error("缺 --muse <museUserId>");

  if (has("unbind")) {
    await db.organization.update({ where: { id: orgId }, data: { settingsJson: withMuseBinding(org.settingsJson, museUserId, null) as Prisma.InputJsonValue } });
    console.log(`✓ 已解绑 ${museUserId}`);
    return;
  }

  const email = arg("email");
  if (!email) throw new Error("缺 --email <青砚登录邮箱>");
  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, status: true } });
  if (!user) throw new Error(`青砚里没有这个邮箱的用户：${email}`);
  if (user.status !== "active") throw new Error(`用户状态为 ${user.status}，不是 active`);

  const member = await db.organizationMember.findFirst({ where: { orgId, userId: user.id, status: "active" }, select: { role: true } });
  if (!member) throw new Error(`${email} 不是组织「${org.name}」的有效成员，先在青砚里加入组织`);

  const next = withMuseBinding(org.settingsJson, museUserId, {
    userId: user.id,
    boundAt: new Date().toISOString(),
    boundBy: "scripts/muse-bridge/bind.ts",
  });
  await db.organization.update({ where: { id: orgId }, data: { settingsJson: next as Prisma.InputJsonValue } });
  console.log(`✓ 已绑定  Muse ${museUserId}  →  ${user.name ?? email} (userId=${user.id}, orgRole=${member.role})  @ 组织「${org.name}」`);
}

main()
  .catch((e) => {
    console.error("失败：", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
