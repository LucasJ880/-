/**
 * QUOTE-1b 本机走查用的种子（openspec change quote-import-studio-file，tasks 4.1）
 *
 * 在本机隔离库里建一家虚构企业、一个负责人账号、一个销售账号、三位虚构客户，并把企业运费设为 50
 * （工具默认 50；代码缺省 75）。不连任何外部服务，不写真实客户数据。
 *
 * 运行（只允许隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   QUOTE1B_FIXTURE_OUT=<仓库外的文件> npx tsx scripts/quote-1b-local-acceptance-seed.ts
 *
 * QUOTE1B_FIXTURE_OUT：把企业 / 用户 / 客户 id 与两个账号的会话令牌写到该文件（走查脚本用；不要提交）。
 *
 * 只改企业运费（走查第 ③ 项；设置接口要求另一位老板审批，夹具里只有一位，所以直接写）：
 *   …同上环境变量… QUOTE1B_SET_DELIVERY_FEE=75 QUOTE1B_ORG=<企业 id> QUOTE1B_USER=<负责人 id> npx tsx scripts/quote-1b-local-acceptance-seed.ts
 */
import { writeFileSync } from "node:fs";

function refuse(reason: string): never {
  console.error(`拒绝运行：${reason}`);
  process.exit(1);
}
if (!process.env.DATABASE_URL?.trim()) refuse("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") refuse("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") refuse("需 DATABASE_ENVIRONMENT=isolated");
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL!)) refuse("DATABASE_URL 不是本机地址");
if (!process.env.JWT_SECRET?.trim()) refuse("需 JWT_SECRET（与本地服务用同一个，令牌才认）");

async function main() {
  const { db } = await import("../src/lib/db");
  const { createSession } = await import("../src/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("../src/lib/authorization/seed-org-profiles");
  const { DEFAULT_SUNNY_MODULES } = await import("../src/lib/tenancy");
  const { saveDiscountsForOrg, loadDiscountsDto } = await import("../src/lib/blinds/discount-settings");

  if (process.env.QUOTE1B_SET_DELIVERY_FEE) {
    const fee = Number(process.env.QUOTE1B_SET_DELIVERY_FEE);
    const orgId = process.env.QUOTE1B_ORG ?? "";
    const userId = process.env.QUOTE1B_USER ?? "";
    if (!Number.isFinite(fee) || fee < 0 || !orgId || !userId) throw new Error("需要 QUOTE1B_SET_DELIVERY_FEE（非负数）、QUOTE1B_ORG、QUOTE1B_USER");
    await saveDiscountsForOrg({ orgId, userId, patch: { deliveryFee: fee } });
    console.log(`企业 ${orgId} 的运费已设为 ${(await loadDiscountsDto(orgId)).deliveryFee}`);
    await db.$disconnect();
    return;
  }

  const stamp = Date.now().toString(36);
  const OWNER = `q1bowner_${stamp}`;
  const REP = `q1brep_${stamp}`;
  const ORG = `q1borg_${stamp}`;

  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Example Owner", role: "user" } });
  await db.user.create({ data: { id: REP, email: `${REP}@fixture.test`, name: "Example Rep", role: "user" } });
  await db.organization.create({
    data: { id: ORG, name: "Fixture Blinds Co.", code: `q1b-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1", modulesJson: { enabled: [...DEFAULT_SUNNY_MODULES] } },
  });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: REP, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    if (!profile) throw new Error(`企业没有岗位档案 ${key}`);
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
  };
  // 负责人同时挂定价与销售岗位（新建报价要有销售数据的权限）；销售只有销售岗位
  for (const key of ["owner", "pricing_lead", "sales_rep"]) await bind(OWNER, key);
  await bind(REP, "sales_rep");

  // 三位虚构客户：第一位的电话 / 邮箱与 toolcode 夹具里的客户相同（走查「自动选中」）
  const customers = {
    match: `q1bc1_${stamp}`,
    other: `q1bc2_${stamp}`,
    repOwned: `q1bc3_${stamp}`,
  };
  await db.salesCustomer.create({ data: { id: customers.match, orgId: ORG, name: "Test Customer", phone: "(416) 555-0100", email: "test@example.com", address: "1 Test St, Toronto", createdById: OWNER } });
  await db.salesCustomer.create({ data: { id: customers.other, orgId: ORG, name: "Example Homeowner", phone: "647-555-0142", email: "homeowner@fixture.test", address: "2 Example Ave, Toronto", createdById: OWNER } });
  await db.salesCustomer.create({ data: { id: customers.repOwned, orgId: ORG, name: "Rep Walk-in", phone: "905-555-0177", email: "walkin@fixture.test", address: "3 Sample Rd, Mississauga", createdById: REP } });

  await saveDiscountsForOrg({ orgId: ORG, userId: OWNER, patch: { deliveryFee: 50 } });
  const dto = await loadDiscountsDto(ORG);

  const tokens = {
    owner: await createSession({ sub: OWNER, email: `${OWNER}@fixture.test`, role: "user" }),
    rep: await createSession({ sub: REP, email: `${REP}@fixture.test`, role: "user" }),
  };
  console.log(`企业 ${ORG}（Fixture Blinds Co.）已建：负责人 ${OWNER}、销售 ${REP}、客户 3 位；企业运费 ${dto.deliveryFee}，最低安装费 ${dto.minInstallFee}，让利上限 ${dto.promoMaxPct}`);
  if (process.env.QUOTE1B_FIXTURE_OUT) {
    writeFileSync(process.env.QUOTE1B_FIXTURE_OUT, JSON.stringify({ orgId: ORG, users: { owner: OWNER, rep: REP }, customers, tokens }, null, 2));
    console.log(`夹具信息已写到 ${process.env.QUOTE1B_FIXTURE_OUT}`);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
