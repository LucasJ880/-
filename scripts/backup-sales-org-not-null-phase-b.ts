/**
 * Phase B 迁移前 —— 只读 JSON 逻辑备份 + 最后一刻只读核查
 *
 *   pnpm exec tsx scripts/backup-sales-org-not-null-phase-b.ts
 *
 * 只读：仅 findMany / count，绝不写库。导出 7 张表全量字段为 JSON，
 * 并内置 Sales 四表 orgId NOT NULL 前的最后一刻核查（null / invalid org / 关系一致性）。
 *
 * 需 DATABASE_URL。
 */

import { db } from "@/lib/db";
import { mkdirSync, existsSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

function safeDbId(url: string | undefined): string {
  if (!url) return "<DATABASE_URL 未设置>";
  try {
    const u = new URL(url);
    const name = u.pathname.replace(/^\//, "");
    return `${u.hostname}${u.port ? ":" + u.port : ""}/${name}`;
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

  // ---- A. null orgId ----
  const nullOrgIdCounts = {
    SalesCustomer: salesCustomer.filter((r) => r.orgId == null).length,
    SalesOpportunity: salesOpportunity.filter((r) => r.orgId == null).length,
    SalesQuote: salesQuote.filter((r) => r.orgId == null).length,
    CustomerInteraction: customerInteraction.filter((r) => r.orgId == null).length,
  };

  // ---- B. invalid orgId（不存在 / 非 active）----
  const activeSet = new Set(
    organization.filter((o) => o.status === "active").map((o) => o.id),
  );
  const countInvalid = (rows: { orgId: string | null }[]) =>
    rows.filter((r) => r.orgId != null && !activeSet.has(r.orgId)).length;
  const invalidOrgIdCounts = {
    SalesCustomer: countInvalid(salesCustomer),
    SalesOpportunity: countInvalid(salesOpportunity),
    SalesQuote: countInvalid(salesQuote),
    CustomerInteraction: countInvalid(customerInteraction),
  };

  // ---- C. 关系一致性 ----
  const custOrg = new Map(salesCustomer.map((c) => [c.id, c.orgId]));
  const oppOrg = new Map(salesOpportunity.map((o) => [o.id, o.orgId]));

  let oppCustMismatch = 0;
  for (const o of salesOpportunity) {
    if (o.customerId && custOrg.get(o.customerId) !== o.orgId) oppCustMismatch++;
  }
  let quoteCustMismatch = 0;
  let quoteOppMismatch = 0;
  for (const q of salesQuote) {
    if (q.customerId && custOrg.get(q.customerId) !== q.orgId) quoteCustMismatch++;
    if (q.opportunityId && oppOrg.get(q.opportunityId) !== q.orgId) quoteOppMismatch++;
  }
  let interCustMismatch = 0;
  let interOppMismatch = 0;
  for (const i of customerInteraction) {
    if (i.customerId && custOrg.get(i.customerId) !== i.orgId) interCustMismatch++;
    if (i.opportunityId && oppOrg.get(i.opportunityId) !== i.orgId) interOppMismatch++;
  }
  const relationMismatchCounts = {
    "opportunity.orgId==customer.orgId": oppCustMismatch,
    "quote.orgId==customer.orgId": quoteCustMismatch,
    "quote.orgId==opportunity.orgId": quoteOppMismatch,
    "interaction.orgId==customer.orgId": interCustMismatch,
    "interaction.orgId==opportunity.orgId": interOppMismatch,
  };

  // ---- 组装并写文件 ----
  const payload = {
    meta: {
      createdAt: exportedAt,
      database: dbSafe,
      purpose: "phase-b-sales-orgid-not-null-pre-migration",
    },
    counts,
    nullOrgIdCounts,
    invalidOrgIdCounts,
    relationMismatchCounts,
    tables,
    rollbackNotes: [
      "本次备份用于 schema NOT NULL 前留档。",
      "Phase B 不改变数据值，只加 NOT NULL 约束。",
      "若 migration 后出问题，首选回滚 schema：ALTER COLUMN \"orgId\" DROP NOT NULL。",
      "数据回滚一般不需要，但本备份可用于核对迁移前状态。",
    ],
  };

  const dir = join(process.cwd(), "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = `sales_org_not_null_phase_b_backup_${ts()}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf-8");

  // ---- 写后校验 ----
  const exists = existsSync(filepath);
  const size = exists ? statSync(filepath).size : 0;
  let parseOk = false;
  let parsedCountsMatch = false;
  try {
    const parsed = JSON.parse(readFileSync(filepath, "utf-8"));
    parseOk = true;
    parsedCountsMatch = JSON.stringify(parsed.counts) === JSON.stringify(counts);
  } catch {
    parseOk = false;
  }

  const aPass = Object.values(nullOrgIdCounts).every((n) => n === 0);
  const bPass = Object.values(invalidOrgIdCounts).every((n) => n === 0);
  const cPass = Object.values(relationMismatchCounts).every((n) => n === 0);

  console.log("=".repeat(60));
  console.log("Phase B 迁移前 JSON 备份 + 最后一刻只读核查");
  console.log("=".repeat(60));
  console.log(`path:        ${filepath}`);
  console.log(`exists:      ${exists}`);
  console.log(`size:        ${size} bytes (${(size / 1024).toFixed(1)} KB)`);
  console.log(`parseOk:     ${parseOk}`);
  console.log(`countsMatch: ${parsedCountsMatch}`);
  console.log(`createdAt:   ${exportedAt}`);
  console.log(`database:    ${dbSafe}`);
  console.log("\n--- counts ---");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  console.log("\n--- A. nullOrgIdCounts ---");
  for (const [k, v] of Object.entries(nullOrgIdCounts)) console.log(`  ${k}: ${v}`);
  console.log("\n--- B. invalidOrgIdCounts ---");
  for (const [k, v] of Object.entries(invalidOrgIdCounts)) console.log(`  ${k}: ${v}`);
  console.log("\n--- C. relationMismatchCounts ---");
  for (const [k, v] of Object.entries(relationMismatchCounts)) console.log(`  ${k}: ${v}`);
  console.log("\n=== 结论 ===");
  console.log(`A (null orgId) PASS:      ${aPass}`);
  console.log(`B (active org) PASS:      ${bPass}`);
  console.log(`C (relation) PASS:        ${cPass}`);
  console.log(`backup file healthy:      ${exists && size > 0 && parseOk && parsedCountsMatch}`);
  console.log(
    aPass && bPass && cPass
      ? "\n>>> 核查通过：可进入 Phase B 第 2 步（修改 schema + 生成 migration，仍需人工确认）"
      : "\n>>> 存在异常，中止，不修改 schema / 不生成 migration",
  );

  console.log("\n[只读] 未对数据库做任何写操作。");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
