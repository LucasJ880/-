/**
 * 创建/更新导航视觉验收账号（双租户 org_admin），密码固定便于本地登录点验。
 * 运行：npx tsx scripts/nav-qa-prepare-user.ts
 */
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";

const EMAIL = "nav-qa@test.qingyan.ai";
const PASSWORD = "Qingyan@NavQA2026";
const NAME = "导航验收账号";

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 12);
  const user = await db.user.upsert({
    where: { email: EMAIL },
    update: {
      passwordHash: hash,
      status: "active",
      role: "admin",
      name: NAME,
    },
    create: {
      email: EMAIL,
      name: NAME,
      passwordHash: hash,
      role: "admin",
      status: "active",
      authProvider: "email",
    },
  });

  for (const code of ["sunny-home-deco", "mengxin-home-textile"]) {
    const org = await db.organization.findFirst({ where: { code } });
    if (!org) {
      console.warn(`skip missing org ${code}`);
      continue;
    }
    await db.organizationMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      update: { role: "org_admin", status: "active" },
      create: {
        orgId: org.id,
        userId: user.id,
        role: "org_admin",
        status: "active",
      },
    });
    console.log(`membership ok: ${code}`);
  }

  console.log(
    JSON.stringify(
      { email: EMAIL, password: PASSWORD, userId: user.id },
      null,
      2,
    ),
  );
  await db.$disconnect();
}

main();
