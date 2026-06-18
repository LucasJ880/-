/**
 * @deprecated Phase B 后已禁用。
 *
 * 销售核心表 orgId 回填（历史一次性脚本）。Phase B 已将四表 orgId 收紧为 NOT NULL，
 * 不可能再存在 orgId:null 的记录，本脚本的回填逻辑已完成历史使命，禁止再运行。
 * 保留文件仅作归档；main() 启动即抛错退出，不会执行任何查询或写入。
 *
 * 需 DATABASE_URL。
 */

import { db } from "@/lib/db";

const WRITE = process.argv.includes("--write");

type RowStats = {
  total: number;
  alreadyHasOrgId: number;
  missingOrgId: number;
  inferredSuccess: number;
  ambiguous: number;
  unresolved: number;
};

type AmbRow = { id: string; createdById: string; orgCandidates: string[] };
type UnresRow = { id: string; createdById: string };

function emptyStats(): RowStats {
  return {
    total: 0,
    alreadyHasOrgId: 0,
    missingOrgId: 0,
    inferredSuccess: 0,
    ambiguous: 0,
    unresolved: 0,
  };
}

async function inferOrgFromCreatedById(createdById: string): Promise<
  | { kind: "one"; orgId: string }
  | { kind: "none" }
  | { kind: "many"; orgIds: string[] }
> {
  const rows = await db.organizationMember.findMany({
    where: { userId: createdById, status: "active" },
    select: { orgId: true },
  });
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "one", orgId: rows[0].orgId };
  return { kind: "many", orgIds: rows.map((r) => r.orgId) };
}

async function backfillSalesCustomers(): Promise<{
  stats: RowStats;
  toWrite: { id: string; orgId: string }[];
  ambiguous: AmbRow[];
  unresolved: UnresRow[];
}> {
  const stats = emptyStats();
  const ambiguous: AmbRow[] = [];
  const unresolved: UnresRow[] = [];
  const toWrite: { id: string; orgId: string }[] = [];

  const rows = await db.salesCustomer.findMany({
    select: { id: true, orgId: true, createdById: true },
  });
  stats.total = rows.length;
  for (const r of rows) {
    if (r.orgId) {
      stats.alreadyHasOrgId++;
      continue;
    }
    stats.missingOrgId++;
    const inf = await inferOrgFromCreatedById(r.createdById);
    if (inf.kind === "one") {
      stats.inferredSuccess++;
      toWrite.push({ id: r.id, orgId: inf.orgId });
    } else if (inf.kind === "many") {
      stats.ambiguous++;
      ambiguous.push({ id: r.id, createdById: r.createdById, orgCandidates: inf.orgIds });
    } else {
      stats.unresolved++;
      unresolved.push({ id: r.id, createdById: r.createdById });
    }
  }
  return { stats, toWrite, ambiguous, unresolved };
}

async function backfillSalesOpportunities(): Promise<{
  stats: RowStats;
  toWrite: { id: string; orgId: string }[];
  ambiguous: AmbRow[];
  unresolved: UnresRow[];
}> {
  const stats = emptyStats();
  const ambiguous: AmbRow[] = [];
  const unresolved: UnresRow[] = [];
  const toWrite: { id: string; orgId: string }[] = [];

  const rows = await db.salesOpportunity.findMany({
    select: {
      id: true,
      orgId: true,
      createdById: true,
      customer: { select: { orgId: true } },
    },
  });
  stats.total = rows.length;
  for (const r of rows) {
    if (r.orgId) {
      stats.alreadyHasOrgId++;
      continue;
    }
    stats.missingOrgId++;
    const fromCustomer = r.customer.orgId;
    if (fromCustomer) {
      stats.inferredSuccess++;
      toWrite.push({ id: r.id, orgId: fromCustomer });
      continue;
    }
    const inf = await inferOrgFromCreatedById(r.createdById);
    if (inf.kind === "one") {
      stats.inferredSuccess++;
      toWrite.push({ id: r.id, orgId: inf.orgId });
    } else if (inf.kind === "many") {
      stats.ambiguous++;
      ambiguous.push({ id: r.id, createdById: r.createdById, orgCandidates: inf.orgIds });
    } else {
      stats.unresolved++;
      unresolved.push({ id: r.id, createdById: r.createdById });
    }
  }
  return { stats, toWrite, ambiguous, unresolved };
}

async function backfillSalesQuotes(): Promise<{
  stats: RowStats;
  toWrite: { id: string; orgId: string }[];
  ambiguous: AmbRow[];
  unresolved: UnresRow[];
}> {
  const stats = emptyStats();
  const ambiguous: AmbRow[] = [];
  const unresolved: UnresRow[] = [];
  const toWrite: { id: string; orgId: string }[] = [];

  const rows = await db.salesQuote.findMany({
    select: {
      id: true,
      orgId: true,
      createdById: true,
      customer: { select: { orgId: true } },
    },
  });
  stats.total = rows.length;
  for (const r of rows) {
    if (r.orgId) {
      stats.alreadyHasOrgId++;
      continue;
    }
    stats.missingOrgId++;
    const fromCustomer = r.customer.orgId;
    if (fromCustomer) {
      stats.inferredSuccess++;
      toWrite.push({ id: r.id, orgId: fromCustomer });
      continue;
    }
    const inf = await inferOrgFromCreatedById(r.createdById);
    if (inf.kind === "one") {
      stats.inferredSuccess++;
      toWrite.push({ id: r.id, orgId: inf.orgId });
    } else if (inf.kind === "many") {
      stats.ambiguous++;
      ambiguous.push({ id: r.id, createdById: r.createdById, orgCandidates: inf.orgIds });
    } else {
      stats.unresolved++;
      unresolved.push({ id: r.id, createdById: r.createdById });
    }
  }
  return { stats, toWrite, ambiguous, unresolved };
}

async function backfillCustomerInteractions(): Promise<{
  stats: RowStats;
  toWrite: { id: string; orgId: string }[];
  ambiguous: AmbRow[];
  unresolved: UnresRow[];
}> {
  const stats = emptyStats();
  const ambiguous: AmbRow[] = [];
  const unresolved: UnresRow[] = [];
  const toWrite: { id: string; orgId: string }[] = [];

  const rows = await db.customerInteraction.findMany({
    select: {
      id: true,
      orgId: true,
      createdById: true,
      customer: { select: { orgId: true } },
    },
  });
  stats.total = rows.length;
  for (const r of rows) {
    if (r.orgId) {
      stats.alreadyHasOrgId++;
      continue;
    }
    stats.missingOrgId++;
    const fromCustomer = r.customer.orgId;
    if (fromCustomer) {
      stats.inferredSuccess++;
      toWrite.push({ id: r.id, orgId: fromCustomer });
      continue;
    }
    const inf = await inferOrgFromCreatedById(r.createdById);
    if (inf.kind === "one") {
      stats.inferredSuccess++;
      toWrite.push({ id: r.id, orgId: inf.orgId });
    } else if (inf.kind === "many") {
      stats.ambiguous++;
      ambiguous.push({ id: r.id, createdById: r.createdById, orgCandidates: inf.orgIds });
    } else {
      stats.unresolved++;
      unresolved.push({ id: r.id, createdById: r.createdById });
    }
  }
  return { stats, toWrite, ambiguous, unresolved };
}

function printStats(label: string, s: RowStats) {
  console.log(`\n--- ${label} ---`);
  console.log(`  total:            ${s.total}`);
  console.log(`  alreadyHasOrgId:  ${s.alreadyHasOrgId}`);
  console.log(`  missingOrgId:     ${s.missingOrgId}`);
  console.log(`  inferredSuccess:  ${s.inferredSuccess}`);
  console.log(`  ambiguous:        ${s.ambiguous}`);
  console.log(`  unresolved:       ${s.unresolved}`);
}

function printProblemRows(label: string, amb: AmbRow[], un: UnresRow[]) {
  if (amb.length > 0) {
    console.log(`\n[${label}] ambiguous（不自动写）:`);
    for (const a of amb.slice(0, 50)) {
      console.log(
        `  id=${a.id} createdById=${a.createdById} candidates=[${a.orgCandidates.join(", ")}]`,
      );
    }
    if (amb.length > 50) console.log(`  ... 另有 ${amb.length - 50} 条`);
  }
  if (un.length > 0) {
    console.log(`\n[${label}] unresolved（无 active org）:`);
    for (const u of un.slice(0, 50)) {
      console.log(`  id=${u.id} createdById=${u.createdById}`);
    }
    if (un.length > 50) console.log(`  ... 另有 ${un.length - 50} 条`);
  }
}

async function applyWrites(
  label: string,
  table: "salesCustomer" | "salesOpportunity" | "salesQuote" | "customerInteraction",
  rows: { id: string; orgId: string }[],
) {
  let n = 0;
  for (const { id, orgId } of rows) {
    // DEPRECATED 死代码：Phase B 后 orgId 为 NOT NULL，orgId:null 不再合法；
    // 用 orgId: undefined 仅为通过类型检查，本函数已不可达（main 启动即抛错）。
    const r =
      table === "salesCustomer"
        ? await db.salesCustomer.updateMany({ where: { id, orgId: undefined }, data: { orgId } })
        : table === "salesOpportunity"
          ? await db.salesOpportunity.updateMany({ where: { id, orgId: undefined }, data: { orgId } })
          : table === "salesQuote"
            ? await db.salesQuote.updateMany({ where: { id, orgId: undefined }, data: { orgId } })
            : await db.customerInteraction.updateMany({ where: { id, orgId: undefined }, data: { orgId } });
    n += r.count;
  }
  console.log(`[write] ${label}: 更新 ${n} 行（仅 orgId 原为空的行）`);
}

async function main() {
  throw new Error(
    "Deprecated: orgId is NOT NULL after Phase B; this backfill script must not run.",
  );

  console.log(
    WRITE ? "MODE: --write（将更新数据库）\n" : "MODE: dry-run（不写库；确认后加 --write）\n",
  );

  const order = [
    { name: "SalesCustomer", run: backfillSalesCustomers, table: "salesCustomer" as const },
    { name: "SalesOpportunity", run: backfillSalesOpportunities, table: "salesOpportunity" as const },
    { name: "SalesQuote", run: backfillSalesQuotes, table: "salesQuote" as const },
    {
      name: "CustomerInteraction",
      run: backfillCustomerInteractions,
      table: "customerInteraction" as const,
    },
  ];

  for (const { name, run, table } of order) {
    const { stats, toWrite, ambiguous, unresolved } = await run();
    printStats(name, stats);
    printProblemRows(name, ambiguous, unresolved);
    if (WRITE && toWrite.length > 0) {
      await applyWrites(name, table, toWrite);
    }
  }

  if (!WRITE) {
    console.log("\n未执行写入。确认统计后请加: --write");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
