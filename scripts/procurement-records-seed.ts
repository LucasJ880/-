#!/usr/bin/env tsx
/**
 * PROC-1 种子导入（默认 dry-run；--write 才写入）
 *
 *   npx tsx scripts/procurement-records-seed.ts --org <orgId> --user <userId> [--with-history-case] [--write]
 *
 * - 三条联邦研究种子合同（CW2379109 / CW2450151 / CW2370017）与联邦 / 省级 ATI 规则（全部未核实）；
 * - --with-history-case：导入 A-2026-00183 为「带来源说明的待核实历史记录」（无附件、无回执、user_reported）；
 * - 幂等：重复执行更新而非新增；
 * - 需要 PROCUREMENT_RECORDS_SCHEMA_READY=1（迁移已在该库执行）；只打印库 host，不打印连接串。
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (name: string) => process.argv.includes(name);

async function main() {
  const orgId = arg("--org");
  const userId = arg("--user");
  const write = has("--write");
  const withHistory = has("--with-history-case");
  if (!orgId || !userId) {
    console.error("用法：npx tsx scripts/procurement-records-seed.ts --org <orgId> --user <userId> [--with-history-case] [--write]");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("缺少 DATABASE_URL");
    process.exit(2);
  }
  let host = "?";
  try {
    host = new URL(process.env.DATABASE_URL).hostname;
  } catch {
    /* ignore */
  }
  const { isProcurementSchemaReady } = await import("@/lib/procurement-records/flags");
  if (!isProcurementSchemaReady()) {
    console.error("PROCUREMENT_RECORDS_SCHEMA_READY 未开启：迁移 20261105120000_add_procurement_records_foundation 未确认已在目标库执行，拒绝运行");
    process.exit(2);
  }
  const { db } = await import("@/lib/db");
  const { RESEARCH_SEEDS, HISTORICAL_CASE_ITEM, seedResearchInstruments, seedHistoricalCase } = await import("@/lib/procurement-records/seed");
  const [org, user] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } }),
    db.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);
  if (!org || !user) {
    console.error("组织或用户不存在");
    process.exit(2);
  }
  const membership = await db.organizationMember.findFirst({ where: { orgId, userId, status: "active" }, select: { role: true } });
  if (!membership) {
    console.error("该用户不是该组织的 active 成员，拒绝以其名义导入");
    process.exit(2);
  }
  console.log(`目标库 host=${host}；组织「${org.name}」；模式=${write ? "写入" : "dry-run"}`);
  for (const s of RESEARCH_SEEDS) {
    const existing = await db.procurementInstrument.findFirst({ where: { orgId, normalizedNumber: s.contractNumber.toUpperCase() }, select: { id: true } });
    console.log(`  ${s.key} ${s.contractNumber} ${s.title} → ${existing ? "已存在（更新）" : "新建"}`);
  }
  if (withHistory) console.log(`  历史案件：${HISTORICAL_CASE_ITEM.caseNumber}（待核实历史记录，user_reported）`);
  if (!write) {
    console.log("dry-run 结束（加 --write 写入）");
    await db.$disconnect();
    return;
  }
  const res = await seedResearchInstruments({ orgId, userId });
  console.log("研究种子：", JSON.stringify(res));
  if (withHistory) {
    const h = await seedHistoricalCase({ orgId, userId });
    console.log("历史案件：", JSON.stringify(h));
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
