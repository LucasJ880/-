/**
 * 创建测试组织「梦馨家纺 / Mengxin Home Textile」并初始化模块与工作空间（幂等）
 *
 * 用法：
 *   npx tsx scripts/seed-org-mengxin-home-textile.ts
 *   npx tsx scripts/seed-org-mengxin-home-textile.ts --switch-active
 */

import { db } from "@/lib/db";
import { DEFAULT_MENGXIN_MODULES } from "../src/lib/tenancy/modules";

const ORG = {
  code: "mengxin-home-textile",
  name: "梦馨家纺",
} as const;

const WORKSPACES = [
  { slug: "international-trade", name: "International Trade", type: "department" },
  { slug: "product-development", name: "Product Development", type: "department" },
  { slug: "supply-chain", name: "Supply Chain", type: "department" },
  { slug: "sales", name: "Sales", type: "department" },
  { slug: "content-production", name: "Content Production", type: "department" },
  { slug: "marketing", name: "Marketing", type: "department" },
] as const;

const OWNER_EMAIL = "lucas@sunnyshutter.ca";
const SWITCH_ACTIVE = process.argv.includes("--switch-active");

async function main() {
  const owner =
    (await db.user.findUnique({
      where: { email: OWNER_EMAIL },
      select: { id: true, email: true, name: true },
    })) ||
    (await db.user.findFirst({
      where: { role: { in: ["admin", "super_admin"] }, status: "active" },
      select: { id: true, email: true, name: true },
      orderBy: { createdAt: "asc" },
    }));

  if (!owner) {
    throw new Error("找不到可用的组织所有者用户（admin）");
  }

  let org = await db.organization.findUnique({
    where: { code: ORG.code },
    select: { id: true, name: true, code: true, status: true, ownerId: true },
  });

  if (!org) {
    org = await db.organization.create({
      data: {
        name: ORG.name,
        code: ORG.code,
        ownerId: owner.id,
        status: "active",
        planType: "free",
        modulesJson: { enabled: [...DEFAULT_MENGXIN_MODULES] },
        industryPackId: "home_textile_trade_v1",
      },
      select: { id: true, name: true, code: true, status: true, ownerId: true },
    });
    console.log(`创建组织: ${org.name} (${org.code}) id=${org.id}`);
  } else {
    org = await db.organization.update({
      where: { id: org.id },
      data: {
        name: ORG.name,
        status: "active",
        modulesJson: { enabled: [...DEFAULT_MENGXIN_MODULES] },
        industryPackId: "home_textile_trade_v1",
      },
      select: { id: true, name: true, code: true, status: true, ownerId: true },
    });
    console.log(`组织已存在，已激活: ${org.name} (${org.code}) id=${org.id}`);
  }

  console.log(`modulesJson: ${DEFAULT_MENGXIN_MODULES.join(", ")}`);
  console.log("industryPackId: home_textile_trade_v1");

  // 梦馨独立折扣行；解锁码仅来自 MENGXIN_LINE_DISCOUNT_UNLOCK_CODE（无跨企业默认）
  const existingDiscount = await db.quoteDiscountSettings.findUnique({
    where: { orgId: org.id },
    select: { id: true },
  });
  if (!existingDiscount) {
    await db.quoteDiscountSettings.create({
      data: {
        orgId: org.id,
        version: 1,
        effectiveAt: new Date(),
        zebra: 0.3,
        roller: 0.3,
        updatedBy: owner.id,
      },
    });
    console.log("QuoteDiscountSettings 已创建（梦馨独立折扣，无解锁码明文）");
  } else {
    console.log("QuoteDiscountSettings 已存在，跳过覆盖");
  }

  const { ensureLineDiscountUnlockHash } = await import(
    "../src/lib/blinds/seed-unlock-code"
  );
  const unlockResult = await ensureLineDiscountUnlockHash({
    orgId: org.id,
    userId: owner.id,
    envPlain: process.env.MENGXIN_LINE_DISCOUNT_UNLOCK_CODE,
    // 梦馨禁止使用 Sunny 示例码；开发也须显式环境变量或管理员配置
    devExamplePlain: null,
    orgLabel: ORG.code,
  });
  console.log(`行折扣解锁码: ${unlockResult.status}`, unlockResult);

  const { ensureBaselineOrgRules } = await import("../src/lib/org-rules/service");
  const baselineRules = await ensureBaselineOrgRules({
    orgId: org.id,
    userId: owner.id,
  });
  console.log(
    "基线 OrgBusinessRule:",
    baselineRules.map((r) => `${r.ruleKey}:${r.status}`).join(", "),
  );

  await db.organizationMember.upsert({
    where: { orgId_userId: { orgId: org.id, userId: owner.id } },
    update: { role: "org_admin", status: "active" },
    create: {
      orgId: org.id,
      userId: owner.id,
      role: "org_admin",
      status: "active",
    },
  });
  console.log(`成员就绪: ${owner.name} <${owner.email}> → org_admin`);

  const platformAdmin = await db.user.findUnique({
    where: { email: "admin@qingyan.ai" },
    select: { id: true, email: true },
  });
  if (platformAdmin && platformAdmin.id !== owner.id) {
    await db.organizationMember.upsert({
      where: {
        orgId_userId: { orgId: org.id, userId: platformAdmin.id },
      },
      update: { role: "org_admin", status: "active" },
      create: {
        orgId: org.id,
        userId: platformAdmin.id,
        role: "org_admin",
        status: "active",
      },
    });
    console.log(`成员就绪: ${platformAdmin.email} → org_admin`);
  }

  for (const ws of WORKSPACES) {
    await db.workspace.upsert({
      where: { orgId_slug: { orgId: org.id, slug: ws.slug } },
      update: { name: ws.name, status: "active", type: ws.type },
      create: {
        orgId: org.id,
        slug: ws.slug,
        name: ws.name,
        type: ws.type,
        status: "active",
      },
    });
  }
  console.log(`Workspace 就绪: ${WORKSPACES.map((w) => w.slug).join(", ")}`);

  const brandProfile = await db.brandProfile.findUnique({
    where: { orgId: org.id },
    select: { id: true },
  });
  if (!brandProfile) {
    await db.brandProfile.create({
      data: {
        orgId: org.id,
        brandName: "梦馨家纺",
        tagline: "Home textile manufacturing for global buyers",
        positioning: "OEM/ODM home textile exporter",
        sellingPoints: "Bathrobe\nBedding\nCustom private label",
        targetAudience: "Overseas importers and Amazon sellers",
        toneOfVoice: "Professional, bilingual (EN/ZH)",
        serviceScope: "Export / OEM",
        forbiddenClaims: "guaranteed cheapest",
      },
    });
    console.log("已创建 BrandProfile 草稿");
  }

  if (SWITCH_ACTIVE) {
    await db.user.update({
      where: { id: owner.id },
      data: { activeOrgId: org.id },
    });
    console.log(`已切换 ${owner.email} 的 activeOrgId → ${org.code}`);
  }

  console.log("\n完成。在应用内切换到「梦馨家纺」验证模块导航。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
