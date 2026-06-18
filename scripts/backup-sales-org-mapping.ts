/**
 * Sales orgId 归一化 —— 只读 JSON 逻辑备份
 *
 *   pnpm exec tsx scripts/backup-sales-org-mapping.ts
 *
 * 只读：仅 findMany / count，绝不写库。把 7 张表全量导出为 JSON，
 * 并记录本次 write 将影响的记录 id 及其 previousOrgId，作为回滚依据。
 *
 * 需 DATABASE_URL。
 */

import { db } from "@/lib/db";
import { mkdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TARGET_ORG = "cmmzrxh7w0001l704fs5ktwt3"; // Sunny Shutter --Bid Lead
const SOURCE_ORG = "cmngj3hdq0001l404ucrjgu19"; // Lucas Bid

const U_LUCAS = "cmmy6zimk0000ju04hrln3yqv";
const U_ALEX = "cmo76z97o0001jv04boxep9n5";
const U_MAGGIE = "cmmz6nbwd0000lb04c32mvu8r";
const NULL_BACKFILL_USERS = [U_LUCAS, U_ALEX, U_MAGGIE];

function safeDbId(url: string | undefined): string {
  if (!url) return "<DATABASE_URL 未设置>";
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, "");
    return `${u.hostname}${u.port ? ":" + u.port : ""}/${db}`;
  } catch {
    return "<无法解析 DATABASE_URL>";
  }
}

function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  const exportedAt = new Date().toISOString();
  const dbSafe = safeDbId(process.env.DATABASE_URL);

  // ---- 全量导出 7 张表（完整字段）----
  const [
    salesCustomer,
    salesOpportunity,
    salesQuote,
    customerInteraction,
    organizationMember,
    organization,
    user,
  ] = await Promise.all([
    db.salesCustomer.findMany(),
    db.salesOpportunity.findMany(),
    db.salesQuote.findMany(),
    db.customerInteraction.findMany(),
    db.organizationMember.findMany(),
    db.organization.findMany(),
    db.user.findMany(),
  ]);

  const tables = {
    SalesCustomer: salesCustomer,
    SalesOpportunity: salesOpportunity,
    SalesQuote: salesQuote,
    CustomerInteraction: customerInteraction,
    OrganizationMember: organizationMember,
    Organization: organization,
    User: user,
  };

  const counts = Object.fromEntries(
    Object.entries(tables).map(([k, v]) => [k, (v as unknown[]).length]),
  );

  // ---- 受 write 影响的记录（含 previousOrgId，供回滚）----
  type Impact = { table: string; id: string; previousOrgId: string | null; reason: "null-org-backfill" | "lucas-bid-migration" };
  const impacted: Impact[] = [];

  const pushNull = (table: string, rows: { id: string; orgId: string | null; createdById: string }[]) => {
    for (const r of rows) {
      if (r.orgId === null && NULL_BACKFILL_USERS.includes(r.createdById))
        impacted.push({ table, id: r.id, previousOrgId: null, reason: "null-org-backfill" });
    }
  };
  const pushMig = (table: string, rows: { id: string; orgId: string | null; createdById: string }[]) => {
    for (const r of rows) {
      if (r.orgId === SOURCE_ORG && r.createdById === U_LUCAS)
        impacted.push({ table, id: r.id, previousOrgId: r.orgId, reason: "lucas-bid-migration" });
    }
  };

  // A) null 回填（四表）
  pushNull("SalesCustomer", salesCustomer as never);
  pushNull("SalesOpportunity", salesOpportunity as never);
  pushNull("SalesQuote", salesQuote as never);
  pushNull("CustomerInteraction", customerInteraction as never);
  // B) Lucas Bid 迁移（三表）
  pushMig("SalesCustomer", salesCustomer as never);
  pushMig("SalesQuote", salesQuote as never);
  pushMig("CustomerInteraction", customerInteraction as never);

  const impactedNull = impacted.filter((i) => i.reason === "null-org-backfill");
  const impactedMig = impacted.filter((i) => i.reason === "lucas-bid-migration");

  // ---- membership 计划（仅记录现状，不写）----
  const membershipUsers = [
    { userId: U_ALEX, label: "Alex Ma / alex@sunnyshutter.ca", role: "org_member" },
    { userId: U_MAGGIE, label: "Maggie / service@sunnyshutter.ca", role: "org_member" },
  ];
  const membershipPlan = [];
  for (const m of membershipUsers) {
    const existing = organizationMember.find(
      (om) => om.orgId === TARGET_ORG && om.userId === m.userId,
    );
    membershipPlan.push({
      ...m,
      currentlyMember: !!existing,
      currentStatus: existing?.status ?? null,
      willCreate: !existing,
    });
  }

  // ---- 校验信息 ----
  const target = organization.find((o) => o.id === TARGET_ORG) ?? null;
  const source = organization.find((o) => o.id === SOURCE_ORG) ?? null;
  const userInfo = (uid: string) => {
    const u = user.find((x) => x.id === uid);
    const mem = organizationMember.find((om) => om.orgId === TARGET_ORG && om.userId === uid);
    return {
      userId: uid,
      exists: !!u,
      name: u?.name ?? null,
      email: u?.email ?? null,
      targetMembership: mem ? { status: mem.status, role: mem.role } : null,
    };
  };

  const validation = {
    targetOrg: target ? { id: target.id, name: target.name, code: target.code, status: target.status } : null,
    sourceOrg: source ? { id: source.id, name: source.name, code: source.code, status: source.status } : null,
    lucas: userInfo(U_LUCAS),
    alex: userInfo(U_ALEX),
    maggie: userInfo(U_MAGGIE),
  };

  // ---- 组装并写文件 ----
  const payload = {
    meta: {
      purpose: "Sales orgId 归一化 write 前逻辑备份（方案 A）",
      exportedAt,
      database: dbSafe,
      targetOrgId: TARGET_ORG,
      sourceOrgId: SOURCE_ORG,
      backfillUsers: NULL_BACKFILL_USERS,
    },
    counts,
    impactSummary: {
      nullBackfillCount: impactedNull.length,
      lucasBidMigrationCount: impactedMig.length,
      totalSalesAffected: impacted.length,
      membershipToCreate: membershipPlan.filter((m) => m.willCreate).map((m) => m.label),
    },
    impactedRecords: impacted, // 含 previousOrgId，回滚依据
    membershipPlan,
    validation,
    tables, // 7 张表完整记录
  };

  const dir = join(process.cwd(), "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = `sales_org_mapping_backup_${ts()}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf-8");

  // ---- 写后检查 ----
  const ok = existsSync(filepath);
  const size = ok ? statSync(filepath).size : 0;

  console.log("=".repeat(60));
  console.log("Sales orgId Mapping JSON 备份完成");
  console.log("=".repeat(60));
  console.log(`path:       ${filepath}`);
  console.log(`exists:     ${ok}`);
  console.log(`size:       ${size} bytes (${(size / 1024).toFixed(1)} KB)`);
  console.log(`exportedAt: ${exportedAt}`);
  console.log(`database:   ${dbSafe}`);
  console.log("\n--- 表 count ---");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  console.log("\n--- 影响快照 ---");
  console.log(`  null 回填: ${impactedNull.length}`);
  console.log(`  Lucas Bid 迁移: ${impactedMig.length}`);
  console.log(`  sales 影响合计: ${impacted.length}`);
  console.log(`  membership 待新增: ${payload.impactSummary.membershipToCreate.join(", ") || "无"}`);
  console.log("\n--- 校验 ---");
  console.log(`  目标组织: ${target ? `${target.name} status=${target.status}` : "不存在"}`);
  console.log(`  源组织:   ${source ? `${source.name} status=${source.status}` : "不存在"}`);
  console.log(`  Lucas:    存在=${validation.lucas.exists} membership=${JSON.stringify(validation.lucas.targetMembership)}`);
  console.log(`  Alex:     存在=${validation.alex.exists} membership=${JSON.stringify(validation.alex.targetMembership)}`);
  console.log(`  Maggie:   存在=${validation.maggie.exists} membership=${JSON.stringify(validation.maggie.targetMembership)}`);
  console.log("\n[只读] 未对数据库做任何写操作。");

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
