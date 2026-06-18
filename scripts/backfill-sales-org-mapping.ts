/**
 * @deprecated Phase B 后已禁用。
 *
 * Sales orgId 归一化（显式 mapping，历史一次性脚本）。该 mapping/回填已在 Phase A 完成，
 * Phase B 又将四表 orgId 收紧为 NOT NULL，本脚本不应再运行（含 --write）。
 * 保留文件仅作归档；main() 启动即抛错退出，不会执行任何查询或写入。
 *
 *   （历史用法，已禁用）
 *   pnpm exec tsx scripts/backfill-sales-org-mapping.ts            # dry-run（默认，只读）
 *   pnpm exec tsx scripts/backfill-sales-org-mapping.ts --dry-run  # 同上，显式
 *   pnpm exec tsx scripts/backfill-sales-org-mapping.ts --write    # 真正写库（事务）
 *
 * 目标：把 Sunny Shutter 的 Sales CRM 历史数据统一到唯一组织 Sunny Shutter --Bid Lead。
 *
 *   A) null 回填：  orgId:null   + createdById ∈ {Lucas, Alex, Maggie}  → TARGET_ORG
 *   B) 迁移：       orgId=LucasBid + createdById = Lucas                → TARGET_ORG
 *   C) membership： 若 Alex / Maggie 不是 TARGET_ORG 的 member，--write 时创建 active org_member
 *
 * 安全约束：
 *   - 默认 dry-run，--write 才写
 *   - 不删除任何数据
 *   - 仅更新符合 mapping 条件的记录，不触碰其他组织数据
 *   - write 前在事务内再次校验目标/源组织与三个用户
 *   - 已存在但非 active 的 membership 只报告，不擅自覆盖
 *
 * 需 DATABASE_URL。
 */

import { db } from "@/lib/db";

const WRITE = process.argv.includes("--write");

const TARGET_ORG = "cmmzrxh7w0001l704fs5ktwt3"; // Sunny Shutter --Bid Lead
const SOURCE_ORG = "cmngj3hdq0001l404ucrjgu19"; // Lucas Bid（迁移来源）

const U_LUCAS = "cmmy6zimk0000ju04hrln3yqv";
const U_ALEX = "cmo76z97o0001jv04boxep9n5";
const U_MAGGIE = "cmmz6nbwd0000lb04c32mvu8r";

const NULL_BACKFILL_USERS = [U_LUCAS, U_ALEX, U_MAGGIE];
const MEMBERSHIP_USERS: { userId: string; label: string; role: string }[] = [
  { userId: U_ALEX, label: "Alex Ma / alex@sunnyshutter.ca", role: "org_member" },
  { userId: U_MAGGIE, label: "Maggie / service@sunnyshutter.ca", role: "org_member" },
];

const USER_LABEL: Record<string, string> = {
  [U_LUCAS]: "LucasJ",
  [U_ALEX]: "Alex Ma",
  [U_MAGGIE]: "Maggie",
};

type Reason = "null-org-backfill" | "lucas-bid-migration";
type DetailRow = {
  table: string;
  id: string;
  label: string;
  currentOrgId: string | null;
  nextOrgId: string;
  createdById: string;
  createdBy: string;
  reason: Reason;
};

function log(s = "") {
  console.log(s);
}

async function fail(msg: string): Promise<never> {
  console.error(`\n[ABORT] ${msg}`);
  await db.$disconnect();
  process.exit(1);
}

/** 收集 A 类（null 回填）明细 —— 四张表 */
async function collectNullBackfill(): Promise<DetailRow[]> {
  const out: DetailRow[] = [];

  // DEPRECATED 死代码：Phase B 后 orgId NOT NULL，orgId:null 已不合法；
  // 用 orgId: undefined 仅为通过类型检查，本函数不可达（main 启动即抛错）。
  const customers = await db.salesCustomer.findMany({
    where: { orgId: undefined, createdById: { in: NULL_BACKFILL_USERS } },
    select: { id: true, name: true, orgId: true, createdById: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of customers)
    out.push({ table: "SalesCustomer", id: r.id, label: r.name, currentOrgId: r.orgId, nextOrgId: TARGET_ORG, createdById: r.createdById, createdBy: USER_LABEL[r.createdById] ?? r.createdById, reason: "null-org-backfill" });

  const opps = await db.salesOpportunity.findMany({
    where: { orgId: undefined, createdById: { in: NULL_BACKFILL_USERS } },
    select: { id: true, title: true, orgId: true, createdById: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of opps)
    out.push({ table: "SalesOpportunity", id: r.id, label: r.title, currentOrgId: r.orgId, nextOrgId: TARGET_ORG, createdById: r.createdById, createdBy: USER_LABEL[r.createdById] ?? r.createdById, reason: "null-org-backfill" });

  const quotes = await db.salesQuote.findMany({
    where: { orgId: undefined, createdById: { in: NULL_BACKFILL_USERS } },
    select: { id: true, orderNumber: true, version: true, orgId: true, createdById: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of quotes)
    out.push({ table: "SalesQuote", id: r.id, label: `${r.orderNumber ?? "(无单号)"} v${r.version}`, currentOrgId: r.orgId, nextOrgId: TARGET_ORG, createdById: r.createdById, createdBy: USER_LABEL[r.createdById] ?? r.createdById, reason: "null-org-backfill" });

  const inters = await db.customerInteraction.findMany({
    where: { orgId: undefined, createdById: { in: NULL_BACKFILL_USERS } },
    select: { id: true, type: true, summary: true, orgId: true, createdById: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of inters)
    out.push({ table: "CustomerInteraction", id: r.id, label: `${r.type}: ${(r.summary ?? "").slice(0, 50)}`, currentOrgId: r.orgId, nextOrgId: TARGET_ORG, createdById: r.createdById, createdBy: USER_LABEL[r.createdById] ?? r.createdById, reason: "null-org-backfill" });

  return out;
}

/** 收集 B 类（Lucas Bid 迁移）明细 —— 仅 SalesCustomer / SalesQuote / CustomerInteraction */
async function collectLucasBidMigration(): Promise<DetailRow[]> {
  const out: DetailRow[] = [];

  const customers = await db.salesCustomer.findMany({
    where: { orgId: SOURCE_ORG, createdById: U_LUCAS },
    select: { id: true, name: true, orgId: true, createdById: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of customers)
    out.push({ table: "SalesCustomer", id: r.id, label: r.name, currentOrgId: r.orgId, nextOrgId: TARGET_ORG, createdById: r.createdById, createdBy: USER_LABEL[r.createdById] ?? r.createdById, reason: "lucas-bid-migration" });

  const quotes = await db.salesQuote.findMany({
    where: { orgId: SOURCE_ORG, createdById: U_LUCAS },
    select: { id: true, orderNumber: true, version: true, orgId: true, createdById: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of quotes)
    out.push({ table: "SalesQuote", id: r.id, label: `${r.orderNumber ?? "(无单号)"} v${r.version}`, currentOrgId: r.orgId, nextOrgId: TARGET_ORG, createdById: r.createdById, createdBy: USER_LABEL[r.createdById] ?? r.createdById, reason: "lucas-bid-migration" });

  const inters = await db.customerInteraction.findMany({
    where: { orgId: SOURCE_ORG, createdById: U_LUCAS },
    select: { id: true, type: true, summary: true, orgId: true, createdById: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of inters)
    out.push({ table: "CustomerInteraction", id: r.id, label: `${r.type}: ${(r.summary ?? "").slice(0, 50)}`, currentOrgId: r.orgId, nextOrgId: TARGET_ORG, createdById: r.createdById, createdBy: USER_LABEL[r.createdById] ?? r.createdById, reason: "lucas-bid-migration" });

  return out;
}

type MembershipPlan = {
  userId: string;
  label: string;
  role: string;
  exists: boolean;
  status: string | null;
  action: "create" | "skip-active" | "report-inactive";
};

async function planMemberships(): Promise<MembershipPlan[]> {
  const plans: MembershipPlan[] = [];
  for (const m of MEMBERSHIP_USERS) {
    const existing = await db.organizationMember.findUnique({
      where: { orgId_userId: { orgId: TARGET_ORG, userId: m.userId } },
      select: { status: true },
    });
    if (!existing) {
      plans.push({ ...m, exists: false, status: null, action: "create" });
    } else if (existing.status === "active") {
      plans.push({ ...m, exists: true, status: existing.status, action: "skip-active" });
    } else {
      plans.push({ ...m, exists: true, status: existing.status, action: "report-inactive" });
    }
  }
  return plans;
}

function tallyByTableUser(rows: DetailRow[]) {
  const t: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    t[r.table] ??= {};
    t[r.table][r.createdById] = (t[r.table][r.createdById] ?? 0) + 1;
  }
  return t;
}

function printStatTable(title: string, rows: DetailRow[]) {
  const t = tallyByTableUser(rows);
  log(`\n### ${title}`);
  log("| 表名 | LucasJ | Alex Ma | Maggie | 总计 |");
  log("| -- | -----: | ------: | -----: | -: |");
  let gl = 0, ga = 0, gm = 0;
  for (const table of Object.keys(t)) {
    const l = t[table][U_LUCAS] ?? 0;
    const a = t[table][U_ALEX] ?? 0;
    const mg = t[table][U_MAGGIE] ?? 0;
    gl += l; ga += a; gm += mg;
    log(`| ${table} | ${l} | ${a} | ${mg} | ${l + a + mg} |`);
  }
  log(`| **小计** | ${gl} | ${ga} | ${gm} | ${gl + ga + gm} |`);
  return rows.length;
}

async function validateCommon() {
  const target = await db.organization.findUnique({
    where: { id: TARGET_ORG },
    select: { id: true, name: true, code: true, status: true },
  });
  if (!target) await fail(`目标组织不存在: ${TARGET_ORG}`);
  if (target!.status !== "active") await fail(`目标组织非 active: ${target!.status}`);

  const source = await db.organization.findUnique({
    where: { id: SOURCE_ORG },
    select: { id: true, name: true, code: true, status: true },
  });
  if (!source) await fail(`源组织(Lucas Bid)不存在: ${SOURCE_ORG}`);

  for (const uid of NULL_BACKFILL_USERS) {
    const u = await db.user.findUnique({ where: { id: uid }, select: { id: true } });
    if (!u) await fail(`用户不存在: ${USER_LABEL[uid]} (${uid})`);
  }
  return { target: target!, source: source! };
}

async function main() {
  log("=".repeat(64));
  log(`Sales orgId 归一化 mapping  ——  MODE: ${WRITE ? "WRITE（写库）" : "dry-run（只读）"}`);
  log("=".repeat(64));

  const { target, source } = await validateCommon();

  // 2. 校验结果
  log("\n## 校验结果");
  log(`- 目标组织: ${target.name} (${target.code}) [${target.id}] status=${target.status} ✓`);
  log(`- 源组织(Lucas Bid): ${source.name} (${source.code}) [${source.id}] status=${source.status} ✓`);
  for (const uid of NULL_BACKFILL_USERS) {
    const mem = await db.organizationMember.findUnique({
      where: { orgId_userId: { orgId: TARGET_ORG, userId: uid } },
      select: { status: true, role: true },
    });
    log(`- ${USER_LABEL[uid]} [${uid}] 存在 ✓ | 目标组织 membership: ${mem ? `${mem.status}/${mem.role}` : "无"}`);
  }

  // 3 + 5. 收集明细
  const nullRows = await collectNullBackfill();
  const migRows = await collectLucasBidMigration();
  const allRows = [...nullRows, ...migRows];

  log("\n## 预计更新统计");
  printStatTable("A) orgId:null 回填", nullRows);
  printStatTable("B) Lucas Bid 迁移", migRows);
  log(`\n**两类合计：${allRows.length} 条 sales 记录**（预期 36 + 12 = 48）`);

  // 4. membership
  const plans = await planMemberships();
  log("\n## Membership 预计变更");
  log("| 用户 | 当前是否 member | 当前状态 | 预计动作 |");
  log("| -- | -- | -- | -- |");
  for (const p of plans) {
    const act =
      p.action === "create" ? "→ --write 时创建 active org_member"
      : p.action === "skip-active" ? "已是 active，跳过"
      : "⚠️ 已存在但非 active：仅报告，不覆盖";
    log(`| ${p.label} | ${p.exists ? "是" : "否"} | ${p.status ?? "—"} | ${act} |`);
  }

  // 5. 明细
  log("\n## 将被更新的记录明细");
  for (const r of allRows) {
    log(JSON.stringify({ table: r.table, id: r.id, label: r.label, currentOrgId: r.currentOrgId, nextOrgId: r.nextOrgId, createdBy: r.createdBy, reason: r.reason }));
  }

  // 6. 安全检查
  const willCreateMemberships = plans.filter((p) => p.action === "create").length;
  log("\n## 安全检查");
  log(`- 仅更新 sales 记录条数: ${allRows.length}（A:${nullRows.length} + B:${migRows.length}）`);
  log(`- 仅 membership 新增: ${willCreateMemberships}`);
  log(`- where 限定: A=(orgId:null ∧ createdById∈三人), B=(orgId=LucasBid ∧ createdById=Lucas) — 不触碰其他组织`);
  log(`- 不删除任何数据 / 不改 schema / 不执行 migration`);

  if (!WRITE) {
    log("\n[dry-run] 未写入任何数据。确认无误后执行: pnpm exec tsx scripts/backfill-sales-org-mapping.ts --write");
    await db.$disconnect();
    return;
  }

  // ===== WRITE 路径：事务 =====
  log("\n[WRITE] 开始事务写入...");
  const result = await db.$transaction(async (tx) => {
    // 事务内再次校验
    const t = await tx.organization.findUnique({ where: { id: TARGET_ORG }, select: { status: true } });
    if (!t || t.status !== "active") throw new Error("事务内校验失败：目标组织不存在或非 active");
    const s = await tx.organization.findUnique({ where: { id: SOURCE_ORG }, select: { id: true } });
    if (!s) throw new Error("事务内校验失败：源组织不存在");
    for (const uid of NULL_BACKFILL_USERS) {
      const u = await tx.user.findUnique({ where: { id: uid }, select: { id: true } });
      if (!u) throw new Error(`事务内校验失败：用户不存在 ${uid}`);
    }

    // A) null 回填（DEPRECATED 死代码：orgId:null → undefined 仅为通过类型检查，不可达）
    const aCust = await tx.salesCustomer.updateMany({ where: { orgId: undefined, createdById: { in: NULL_BACKFILL_USERS } }, data: { orgId: TARGET_ORG } });
    const aOpp = await tx.salesOpportunity.updateMany({ where: { orgId: undefined, createdById: { in: NULL_BACKFILL_USERS } }, data: { orgId: TARGET_ORG } });
    const aQuote = await tx.salesQuote.updateMany({ where: { orgId: undefined, createdById: { in: NULL_BACKFILL_USERS } }, data: { orgId: TARGET_ORG } });
    const aInter = await tx.customerInteraction.updateMany({ where: { orgId: undefined, createdById: { in: NULL_BACKFILL_USERS } }, data: { orgId: TARGET_ORG } });

    // B) Lucas Bid 迁移
    const bCust = await tx.salesCustomer.updateMany({ where: { orgId: SOURCE_ORG, createdById: U_LUCAS }, data: { orgId: TARGET_ORG } });
    const bQuote = await tx.salesQuote.updateMany({ where: { orgId: SOURCE_ORG, createdById: U_LUCAS }, data: { orgId: TARGET_ORG } });
    const bInter = await tx.customerInteraction.updateMany({ where: { orgId: SOURCE_ORG, createdById: U_LUCAS }, data: { orgId: TARGET_ORG } });

    // C) membership（仅 action=create）
    let memCreated = 0;
    for (const p of plans) {
      if (p.action !== "create") continue;
      await tx.organizationMember.create({
        data: { orgId: TARGET_ORG, userId: p.userId, role: p.role, status: "active" },
      });
      memCreated++;
    }

    return {
      aCust: aCust.count, aOpp: aOpp.count, aQuote: aQuote.count, aInter: aInter.count,
      bCust: bCust.count, bQuote: bQuote.count, bInter: bInter.count,
      memCreated,
    };
  });

  log("\n[WRITE] 事务完成。实际写入：");
  log(JSON.stringify(result, null, 2));
  const totalUpdated = result.aCust + result.aOpp + result.aQuote + result.aInter + result.bCust + result.bQuote + result.bInter;
  log(`\n合计更新 sales 记录: ${totalUpdated} 条 | membership 新增: ${result.memCreated} 个`);
  await db.$disconnect();
}

// DEPRECATED：Phase B 后 orgId 为 NOT NULL，本脚本禁止运行。模块加载即抛错退出。
// 历史入口已禁用（保留 main 及其逻辑仅供归档审阅）：
//   main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
void main;
throw new Error(
  "Deprecated: orgId is NOT NULL after Phase B; this mapping/backfill script must not run.",
);
