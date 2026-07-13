/**
 * Sunny 公司（联合品牌）初始化脚本
 *
 * 1. upsert Company "Sunny"（logo: /brands/sunny.png）
 * 2. 回填现有 sales / manager 角色的活跃用户为 Sunny 员工
 *    （仅回填尚未归属任何公司的用户，不覆盖已有归属）
 *
 * 运行：npx tsx scripts/seed-company-sunny.ts
 */
import { db } from "@/lib/db";

async function main() {
  const company = await db.company.upsert({
    where: { slug: "sunny" },
    update: { name: "Sunny", logoUrl: "/brands/sunny.png", isActive: true },
    create: { name: "Sunny", slug: "sunny", logoUrl: "/brands/sunny.png" },
  });
  console.log(`✅ 公司就绪: ${company.name} (${company.id})`);

  const users = await db.user.findMany({
    where: {
      role: { in: ["sales", "manager"] },
      status: "active",
      companyIdsJson: null,
    },
    select: { id: true, email: true, name: true, role: true },
  });

  for (const u of users) {
    await db.user.update({
      where: { id: u.id },
      data: { companyIdsJson: JSON.stringify([company.id]) },
    });
    console.log(`  → 已归属 Sunny: ${u.name} <${u.email}> (${u.role})`);
  }

  console.log(`✅ 回填完成，共 ${users.length} 人`);
  console.log("提示：运营/其他角色员工可在「用户管理 → 用户详情 → 公司归属」手动分配。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
