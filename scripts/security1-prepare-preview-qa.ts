/**
 * Security-1 Preview UI 验收账号与 QA 数据准备
 *
 * - 不搬迁 archived「Sunny Shutter --Bid Lead」历史数据
 * - 仅在 active「Sunny Home & Deco」新增 membership / QA 记录
 * - MULTI_ORG 使用专用非平台 admin 账号（nav-qa 为平台 admin，不用作普通切换验收）
 *
 * 运行：npx tsx scripts/security1-prepare-preview-qa.ts
 */

import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { seedOrgAuthorizationProfiles } from "../src/lib/authorization/seed-org-profiles";

const PASSWORD = process.env.SECURITY1_QA_PASSWORD;
if (!PASSWORD) {
  throw new Error("SECURITY1_QA_PASSWORD is required");
}
const SUNNY_CODE = "sunny-home-deco";
const MENGXIN_CODE = "mengxin-home-textile";

type AccountSpec = {
  email: string;
  name: string;
  platformRole: string;
  orgAccessMode: "FIXED" | "MULTI_ORG" | "PLATFORM_SUPPORT";
  canSelfSwitchOrg: boolean;
  activeOrgCode: string;
  memberships: Array<{
    orgCode: string;
    orgRole: string;
    profileKey: string | null;
  }>;
};

const ACCOUNTS: AccountSpec[] = [
  {
    email: "security1-owner@test.qingyan.ai",
    name: "Sec1 企业负责人",
    platformRole: "user",
    orgAccessMode: "FIXED",
    canSelfSwitchOrg: false,
    activeOrgCode: SUNNY_CODE,
    memberships: [
      { orgCode: SUNNY_CODE, orgRole: "org_owner", profileKey: "org_owner" },
    ],
  },
  {
    email: "security1-admin@test.qingyan.ai",
    name: "Sec1 企业管理员",
    platformRole: "user",
    orgAccessMode: "FIXED",
    canSelfSwitchOrg: false,
    activeOrgCode: SUNNY_CODE,
    memberships: [
      { orgCode: SUNNY_CODE, orgRole: "org_admin", profileKey: "org_admin" },
    ],
  },
  {
    email: "security1-sales-b@test.qingyan.ai",
    name: "Sec1 销售B",
    platformRole: "sales",
    orgAccessMode: "FIXED",
    canSelfSwitchOrg: false,
    activeOrgCode: SUNNY_CODE,
    memberships: [
      { orgCode: SUNNY_CODE, orgRole: "org_member", profileKey: "sales_rep" },
    ],
  },
  {
    email: "security1-trade@test.qingyan.ai",
    name: "Sec1 梦馨外贸",
    platformRole: "trade",
    orgAccessMode: "FIXED",
    canSelfSwitchOrg: false,
    activeOrgCode: MENGXIN_CODE,
    memberships: [
      { orgCode: MENGXIN_CODE, orgRole: "org_member", profileKey: null },
    ],
  },
  {
    email: "security1-multi@test.qingyan.ai",
    name: "Sec1 双租户切换 QA",
    platformRole: "user",
    orgAccessMode: "MULTI_ORG",
    canSelfSwitchOrg: true,
    activeOrgCode: SUNNY_CODE,
    memberships: [
      { orgCode: SUNNY_CODE, orgRole: "org_member", profileKey: "sales_rep" },
      { orgCode: MENGXIN_CODE, orgRole: "org_member", profileKey: "ops_staff" },
    ],
  },
];

async function ensureOrg(code: string) {
  const org = await db.organization.findFirst({ where: { code } });
  if (!org) throw new Error(`missing org ${code}`);
  if (org.status !== "active") {
    throw new Error(`org ${code} status=${org.status}, need active`);
  }
  return org;
}

async function ensureProfileBinding(
  orgId: string,
  userId: string,
  profileKey: string,
) {
  const profile = await db.roleProfile.findUnique({
    where: { orgId_key: { orgId, key: profileKey } },
  });
  if (!profile) throw new Error(`missing RoleProfile ${profileKey} in ${orgId}`);

  const existing = await db.principalRoleBinding.findFirst({
    where: {
      orgId,
      principalType: "HUMAN",
      principalId: userId,
      roleProfileId: profile.id,
      status: "active",
    },
  });
  if (!existing) {
    await db.principalRoleBinding.create({
      data: {
        orgId,
        principalType: "HUMAN",
        principalId: userId,
        roleProfileId: profile.id,
        status: "active",
      },
    });
  }

  // 清理 trade 误绑 sales_rep
  if (profileKey !== "sales_rep") {
    const mistaken = await db.principalRoleBinding.findMany({
      where: {
        orgId,
        principalId: userId,
        status: "active",
        roleProfile: { key: "sales_rep" },
      },
    });
    for (const m of mistaken) {
      // 仅当目标不是 sales_rep 且用户也不该有销售岗时才清理；multi 在 Sunny 有 sales_rep 保留
      if (profileKey === "ops_staff" || profileKey === "org_admin") {
        await db.principalRoleBinding.update({
          where: { id: m.id },
          data: { status: "inactive" },
        });
      }
    }
  }
}

async function upsertAccount(spec: AccountSpec, orgByCode: Map<string, { id: string }>) {
  const hash = await bcrypt.hash(PASSWORD, 12);
  const activeOrg = orgByCode.get(spec.activeOrgCode)!;
  const user = await db.user.upsert({
    where: { email: spec.email },
    update: {
      name: spec.name,
      passwordHash: hash,
      status: "active",
      role: spec.platformRole,
      orgAccessMode: spec.orgAccessMode,
      canSelfSwitchOrg: spec.canSelfSwitchOrg,
      activeOrgId: activeOrg.id,
      authProvider: "email",
    },
    create: {
      email: spec.email,
      name: spec.name,
      passwordHash: hash,
      status: "active",
      role: spec.platformRole,
      orgAccessMode: spec.orgAccessMode,
      canSelfSwitchOrg: spec.canSelfSwitchOrg,
      activeOrgId: activeOrg.id,
      authProvider: "email",
    },
  });

  for (const m of spec.memberships) {
    const org = orgByCode.get(m.orgCode)!;
    await db.organizationMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      update: { role: m.orgRole, status: "active" },
      create: {
        orgId: org.id,
        userId: user.id,
        role: m.orgRole,
        status: "active",
      },
    });
    if (m.profileKey) {
      await ensureProfileBinding(org.id, user.id, m.profileKey);
    } else {
      // 确保 trade 无 sales_rep
      const salesBindings = await db.principalRoleBinding.findMany({
        where: {
          orgId: org.id,
          principalId: user.id,
          status: "active",
          roleProfile: { key: "sales_rep" },
        },
      });
      for (const b of salesBindings) {
        await db.principalRoleBinding.update({
          where: { id: b.id },
          data: { status: "inactive" },
        });
      }
    }
  }

  return user;
}

async function ensureAlexOnSunny(sunnyId: string) {
  const alex = await db.user.findUnique({
    where: { email: "alex@sunnyshutter.ca" },
  });
  if (!alex) {
    console.warn("alex@sunnyshutter.ca not found — skip");
    return null;
  }
  const hash = await bcrypt.hash(PASSWORD, 12);
  await db.user.update({
    where: { id: alex.id },
    data: {
      role: "sales",
      orgAccessMode: "FIXED",
      canSelfSwitchOrg: false,
      activeOrgId: sunnyId,
      status: "active",
      passwordHash: hash,
      authProvider: "email",
    },
  });
  await db.organizationMember.upsert({
    where: { orgId_userId: { orgId: sunnyId, userId: alex.id } },
    update: { role: "org_member", status: "active" },
    create: {
      orgId: sunnyId,
      userId: alex.id,
      role: "org_member",
      status: "active",
    },
  });
  await ensureProfileBinding(sunnyId, alex.id, "sales_rep");
  console.log("Alex: added active membership on Sunny Home & Deco (archived Bid Lead untouched)");
  return alex;
}

async function ensureQaSalesData(opts: {
  sunnyId: string;
  salesAId: string;
  salesBId: string;
}) {
  const tag = "[Sec1-QA]";

  async function ensureCustomer(createdById: string, name: string) {
    const existing = await db.salesCustomer.findFirst({
      where: {
        orgId: opts.sunnyId,
        createdById,
        name,
        archivedAt: null,
      },
    });
    if (existing) return existing;
    return db.salesCustomer.create({
      data: {
        orgId: opts.sunnyId,
        name,
        phone: null,
        email: null,
        source: "other",
        notes: `${tag} preview acceptance only`,
        createdById,
      },
    });
  }

  const custA = await ensureCustomer(
    opts.salesAId,
    `${tag} SalesA Customer`,
  );
  const custB = await ensureCustomer(
    opts.salesBId,
    `${tag} SalesB Customer`,
  );

  async function ensureOpp(
    createdById: string,
    customerId: string,
    title: string,
    assignedToId?: string | null,
  ) {
    const existing = await db.salesOpportunity.findFirst({
      where: { orgId: opts.sunnyId, createdById, title },
    });
    if (existing) {
      if (assignedToId && existing.assignedToId !== assignedToId) {
        return db.salesOpportunity.update({
          where: { id: existing.id },
          data: { assignedToId },
        });
      }
      return existing;
    }
    return db.salesOpportunity.create({
      data: {
        orgId: opts.sunnyId,
        customerId,
        title,
        stage: "new_lead",
        priority: "warm",
        createdById,
        assignedToId: assignedToId ?? null,
      },
    });
  }

  const oppA = await ensureOpp(
    opts.salesAId,
    custA.id,
    `${tag} SalesA Own Opp`,
  );
  const oppB = await ensureOpp(
    opts.salesBId,
    custB.id,
    `${tag} SalesB Own Opp`,
  );
  // 由 B 创建、分配给 A
  const oppAssigned = await ensureOpp(
    opts.salesBId,
    custB.id,
    `${tag} Assigned to SalesA`,
    opts.salesAId,
  );

  async function ensureDraftQuote(
    createdById: string,
    customerId: string,
    opportunityId: string,
  ) {
    const existing = await db.salesQuote.findFirst({
      where: {
        orgId: opts.sunnyId,
        createdById,
        customerId,
        status: "draft",
        notes: { contains: tag },
      },
    });
    if (existing) return existing;
    return db.salesQuote.create({
      data: {
        orgId: opts.sunnyId,
        customerId,
        opportunityId,
        createdById,
        status: "draft",
        notes: `${tag} draft quote for preview`,
        formDataJson: JSON.stringify({
          qa: true,
          tag,
          draftKeyHint: `qingyan:quote-sheet-draft:v1:${opts.sunnyId}:${createdById}`,
        }),
        grandTotal: 0,
      },
    });
  }

  const quoteA = await ensureDraftQuote(opts.salesAId, custA.id, oppA.id);
  const quoteB = await ensureDraftQuote(opts.salesBId, custB.id, oppB.id);

  return { custA, custB, oppA, oppB, oppAssigned, quoteA, quoteB };
}

async function main() {
  const sunny = await ensureOrg(SUNNY_CODE);
  const mengxin = await ensureOrg(MENGXIN_CODE);
  await seedOrgAuthorizationProfiles(sunny.id);
  await seedOrgAuthorizationProfiles(mengxin.id);

  const orgByCode = new Map([
    [SUNNY_CODE, sunny],
    [MENGXIN_CODE, mengxin],
  ]);

  const created: Record<string, string> = {};
  for (const spec of ACCOUNTS) {
    const u = await upsertAccount(spec, orgByCode);
    created[spec.email] = u.id;
    console.log(`account ok: ${spec.email} mode=${spec.orgAccessMode} switch=${spec.canSelfSwitchOrg}`);
  }

  const alex = await ensureAlexOnSunny(sunny.id);
  if (!alex) throw new Error("Alex required for Sales A");

  const salesBId = created["security1-sales-b@test.qingyan.ai"]!;
  const data = await ensureQaSalesData({
    sunnyId: sunny.id,
    salesAId: alex.id,
    salesBId,
  });

  // 梦馨：给 trade 建一条无关外贸侧无关的确认——无销售客户
  const tradeId = created["security1-trade@test.qingyan.ai"]!;
  const tradeSales = await db.salesCustomer.count({
    where: { orgId: mengxin.id, createdById: tradeId },
  });

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        orgs: {
          sunny: { id: sunny.id, code: sunny.code, name: sunny.name },
          mengxin: { id: mengxin.id, code: mengxin.code, name: mengxin.name },
        },
        accounts: {
          owner: "security1-owner@test.qingyan.ai",
          admin: "security1-admin@test.qingyan.ai",
          salesA: "alex@sunnyshutter.ca",
          salesB: "security1-sales-b@test.qingyan.ai",
          trade: "security1-trade@test.qingyan.ai",
          multiOrg: "security1-multi@test.qingyan.ai",
        },
        note:
          "nav-qa@test.qingyan.ai 为平台 admin，不用作普通 MULTI_ORG 切换验收；使用 security1-multi",
        qaData: {
          custA: data.custA.id,
          custB: data.custB.id,
          oppA: data.oppA.id,
          oppB: data.oppB.id,
          oppAssignedToA: data.oppAssigned.id,
          quoteA: data.quoteA.id,
          quoteB: data.quoteB.id,
          tradeSalesCustomersOnMengxin: tradeSales,
        },
        draftKeyExamples: {
          salesA: `qingyan:quote-sheet-draft:v1:${sunny.id}:${alex.id}`,
          salesB: `qingyan:quote-sheet-draft:v1:${sunny.id}:${salesBId}`,
          tradeMengxin: `qingyan:quote-sheet-draft:v1:${mengxin.id}:${tradeId}`,
        },
      },
      null,
      2,
    ),
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
