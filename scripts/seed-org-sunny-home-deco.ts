/**
 * 创建测试组织「Sunny Home & Deco」并初始化营销测试基线（幂等）
 *
 * - Organization: sunny-home-deco
 * - 所有者 / org_admin: lucas@sunnyshutter.ca（若存在）
 * - 可选 MarketingBrandProfile 草稿，便于 PMC 聚合
 * - 可将 Lucas 的 activeOrgId 切到本组织（--switch-active）
 *
 * 用法：
 *   npx tsx scripts/seed-org-sunny-home-deco.ts
 *   npx tsx scripts/seed-org-sunny-home-deco.ts --switch-active
 */

import { db } from "@/lib/db";

const ORG = {
  code: "sunny-home-deco",
  name: "Sunny Home & Deco",
} as const;

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
      },
      select: { id: true, name: true, code: true, status: true, ownerId: true },
    });
    console.log(`创建组织: ${org.name} (${org.code}) id=${org.id}`);
  } else {
    org = await db.organization.update({
      where: { id: org.id },
      data: { name: ORG.name, status: "active" },
      select: { id: true, name: true, code: true, status: true, ownerId: true },
    });
    console.log(`组织已存在，已激活: ${org.name} (${org.code}) id=${org.id}`);
  }

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

  // 可选：平台管理员也加入，便于后台查看
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

  const existingBrand = await db.marketingBrandProfile.findUnique({
    where: { orgId: org.id },
    select: { id: true },
  });
  if (!existingBrand) {
    await db.marketingBrandProfile.create({
      data: {
        orgId: org.id,
        legalName: "Sunny Home & Deco Inc.",
        brandName: "Sunny Home & Deco",
        website: "https://sunnyshutter.ca",
        city: "Toronto",
        region: "ON",
        country: "CA",
        timezone: "America/Toronto",
        industry: "window coverings / home decor",
        productsJson: [
          "Custom blinds",
          "Shutters",
          "Motorized shades",
          "Commercial window coverings",
        ],
        serviceAreasJson: ["GTA", "Toronto", "Mississauga", "Markham"],
        targetAudiencesJson: [
          "Homeowners",
          "Commercial property managers",
          "Interior designers",
        ],
        competitorsJson: ["Select Blinds", "Blinds.ca"],
        forbiddenContextsJson: ["guaranteed cheapest", "#1 in Canada"],
        validationStatus: "draft",
        validationScore: 40,
        updatedById: owner.id,
      },
    });
    console.log("已创建 MarketingBrandProfile 草稿（便于 PMC 聚合）");
  } else {
    console.log("MarketingBrandProfile 已存在，跳过");
  }

  const brandProfile = await db.brandProfile.findUnique({
    where: { orgId: org.id },
    select: { id: true },
  });
  if (!brandProfile) {
    await db.brandProfile.create({
      data: {
        orgId: org.id,
        brandName: "Sunny Home & Deco",
        tagline: "Custom window coverings for homes and commercial spaces",
        positioning:
          "Local install expertise for residential and light-commercial window coverings in the GTA",
        sellingPoints:
          "Local measure & install\nMotorized options\nCommercial capability",
        targetAudience: "GTA homeowners and commercial property managers",
        toneOfVoice: "Professional, clear, bilingual-ready (EN/ZH)",
        serviceScope: "GTA / Greater Toronto Area",
        forbiddenClaims: "#1 in Canada\nguaranteed cheapest\nnever fail",
      },
    });
    console.log("已创建 BrandProfile 草稿");
  } else {
    console.log("BrandProfile 已存在，跳过");
  }

  if (SWITCH_ACTIVE) {
    await db.user.update({
      where: { id: owner.id },
      data: { activeOrgId: org.id },
    });
    console.log(`已切换 ${owner.email} 的 activeOrgId → ${org.code}`);
  } else {
    console.log(
      "未切换 activeOrgId。需要时加 --switch-active，或在应用内切换组织。",
    );
  }

  console.log("\n下一步：");
  console.log(
    `  npm run seed:marketing-phase2:write -- --org ${ORG.code}`,
  );
  console.log(`  然后在应用内切换到「${ORG.name}」，打开 /marketing/employee`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
