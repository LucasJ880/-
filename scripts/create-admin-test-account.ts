/**
 * 创建/重置青砚平台管理员测试账号（role=admin，可登录后台）。
 *
 * 运行（本地库或已标记 isolated 的测试库）：
 *   npx tsx scripts/create-admin-test-account.ts
 *
 * 可用环境变量覆盖默认值：
 *   ADMIN_TEST_EMAIL     默认 admin@qingyan.ca
 *   ADMIN_TEST_PASSWORD  默认 qingyan123
 *   ADMIN_TEST_NAME      默认 青砚管理员（测试）
 *
 * 账号已存在时：重置密码、置为 active、角色升为 admin（不降级 super_admin）。
 * 对生产库 fail-closed（assertSafeTestDatabase），不要拿它在生产开号。
 */
import bcrypt from "bcryptjs";

import { db } from "../src/lib/db";
import { assertSafeTestDatabase } from "../src/lib/testing/assert-safe-test-database";
import { PASSWORD_MIN_LENGTH } from "../src/lib/users/password-constants";

assertSafeTestDatabase({ scriptName: "scripts/create-admin-test-account.ts" });

const EMAIL = (process.env.ADMIN_TEST_EMAIL ?? "admin@qingyan.ca").trim().toLowerCase();
const PASSWORD = process.env.ADMIN_TEST_PASSWORD ?? "qingyan123";
const NAME = process.env.ADMIN_TEST_NAME ?? "青砚管理员（测试）";
const BCRYPT_ROUNDS = 12;

async function main() {
  if (PASSWORD.trim().length < PASSWORD_MIN_LENGTH) {
    throw new Error(`密码至少 ${PASSWORD_MIN_LENGTH} 位`);
  }

  const passwordHash = await bcrypt.hash(PASSWORD.trim(), BCRYPT_ROUNDS);
  const existing = await db.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, role: true },
  });

  const role = existing?.role === "super_admin" ? "super_admin" : "admin";
  const user = await db.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, role, status: "active", authProvider: "email" },
    create: {
      email: EMAIL,
      name: NAME,
      passwordHash,
      role,
      status: "active",
      authProvider: "email",
    },
    select: { id: true, email: true, role: true, status: true },
  });

  console.log(
    JSON.stringify(
      { action: existing ? "updated" : "created", ...user, password: PASSWORD },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
