/**
 * Phase 5 数据完整性只读检查（不修复）
 * 用法：npx tsx scripts/verify-phase5-data-integrity.ts
 */
import { PrismaClient } from "@prisma/client";

type Severity = "PASS" | "WARNING" | "BLOCKER";

const findings: Array<{ severity: Severity; area: string; message: string; count?: number }> =
  [];

function note(severity: Severity, area: string, message: string, count?: number) {
  findings.push({ severity, area, message, count });
}

function hostOf(url: string): string {
  try {
    return new URL(url.replace(/^postgresql:/i, "http:")).hostname;
  } catch {
    return "(unparseable)";
  }
}

const TASK_STATUSES = new Set([
  "todo",
  "in_progress",
  "waiting_external",
  "waiting_internal",
  "blocked",
  "needs_approval",
  "done",
  "cancelled",
]);

const WORK_DOMAINS = new Set(["tender", "delivery", "general"]);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("缺少 DATABASE_URL");
  console.log(`[verify-phase5] host=${hostOf(url)}`);

  const db = new PrismaClient();
  try {
    // Task 字段存在性
    const taskCols = (await db.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Task'
        AND column_name IN ('blockedReason','waitingOn','waitingUntil','sourceType','sourceId','sourceTemplateKey')
    `)) as Array<{ column_name: string }>;
    const colSet = new Set(taskCols.map((c) => c.column_name));
    for (const c of [
      "blockedReason",
      "waitingOn",
      "waitingUntil",
      "sourceType",
      "sourceId",
      "sourceTemplateKey",
    ]) {
      if (!colSet.has(c)) note("BLOCKER", "Task", `缺少列 ${c}`);
    }
    if (colSet.size >= 6) note("PASS", "Task", "Phase3/5 Task 列存在");

    const badStatus = (await db.$queryRawUnsafe(`
      SELECT status, count(*)::int AS n FROM "Task"
      WHERE status IS NULL OR status NOT IN ('todo','in_progress','waiting_external','waiting_internal','blocked','needs_approval','done','cancelled')
      GROUP BY status
    `)) as Array<{ status: string; n: number }>;
    if (badStatus.length) {
      note(
        "BLOCKER",
        "Task",
        `非法 status: ${badStatus.map((r) => `${r.status}:${r.n}`).join(",")}`,
        badStatus.reduce((a, b) => a + b.n, 0),
      );
    } else note("PASS", "Task", "status 均在允许集合");

    const doneNoCompleted = (await db.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "Task" WHERE status='done' AND "completedAt" IS NULL
    `)) as Array<{ n: number }>;
    if (doneNoCompleted[0]?.n) {
      note("WARNING", "Task", "done 但 completedAt 为空", doneNoCompleted[0].n);
    } else note("PASS", "Task", "done 与 completedAt 一致");

    const blockedNoReason = (await db.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "Task" WHERE status='blocked' AND (\"blockedReason\" IS NULL OR trim(\"blockedReason\")='')
    `)) as Array<{ n: number }>;
    if (blockedNoReason[0]?.n) {
      note("WARNING", "Task", "blocked 缺少 blockedReason", blockedNoReason[0].n);
    } else note("PASS", "Task", "blocked 均有 blockedReason（或无 blocked）");

    const waitingNoOn = (await db.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "Task"
      WHERE status IN ('waiting_external','waiting_internal')
        AND (\"waitingOn\" IS NULL OR trim(\"waitingOn\")='')
    `)) as Array<{ n: number }>;
    if (waitingNoOn[0]?.n) {
      note("WARNING", "Task", "waiting_* 缺少 waitingOn", waitingNoOn[0].n);
    } else note("PASS", "Task", "waiting 状态 waitingOn 完整（或无 waiting）");

    // Project
    const badDomain = (await db.$queryRawUnsafe(`
      SELECT "workDomain", count(*)::int AS n FROM "Project"
      WHERE "workDomain" IS NULL OR "workDomain" NOT IN ('tender','delivery','general')
      GROUP BY "workDomain"
    `)) as Array<{ workDomain: string; n: number }>;
    if (badDomain.length) {
      note("BLOCKER", "Project", `非法 workDomain`, badDomain.reduce((a, b) => a + b.n, 0));
    } else note("PASS", "Project", "workDomain 合法");

    const tenderWithStage = (await db.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "Project"
      WHERE "workDomain" IN ('tender','general') AND "deliveryStage" IS NOT NULL AND trim("deliveryStage") <> ''
    `)) as Array<{ n: number }>;
    if (tenderWithStage[0]?.n) {
      note(
        "WARNING",
        "Project",
        "tender/general 带有 deliveryStage",
        tenderWithStage[0].n,
      );
    } else note("PASS", "Project", "非 delivery 无 deliveryStage");

    const deliveryBadSource = (await db.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "Project" d
      LEFT JOIN "Project" s ON s.id = d."sourceTenderProjectId"
      WHERE d."workDomain"='delivery' AND d."sourceTenderProjectId" IS NOT NULL
        AND (s.id IS NULL OR s."workDomain" <> 'tender' OR s."orgId" IS DISTINCT FROM d."orgId")
    `)) as Array<{ n: number }>;
    if (deliveryBadSource[0]?.n) {
      note(
        "BLOCKER",
        "Project",
        "delivery.sourceTender 非法或跨组织",
        deliveryBadSource[0].n,
      );
    } else note("PASS", "Project", "delivery sourceTender 指向同组织 tender（或空）");

    // ProjectHandoff
    const handoffTable = (await db.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name='ProjectHandoff'
    `)) as Array<{ n: number }>;
    if (!handoffTable[0]?.n) {
      note("BLOCKER", "ProjectHandoff", "表不存在");
    } else {
      note("PASS", "ProjectHandoff", "表存在");
      const completedNoTarget = (await db.$queryRawUnsafe(`
        SELECT count(*)::int AS n FROM "ProjectHandoff"
        WHERE status='completed' AND "targetDeliveryProjectId" IS NULL
      `)) as Array<{ n: number }>;
      if (completedNoTarget[0]?.n) {
        note("BLOCKER", "ProjectHandoff", "completed 无 target", completedNoTarget[0].n);
      } else note("PASS", "ProjectHandoff", "completed 均有 target");

      const badTargets = (await db.$queryRawUnsafe(`
        SELECT count(*)::int AS n FROM "ProjectHandoff" h
        LEFT JOIN "Project" t ON t.id = h."targetDeliveryProjectId"
        LEFT JOIN "Project" s ON s.id = h."sourceTenderProjectId"
        WHERE h.status='completed' AND (
          t.id IS NULL OR t."workDomain" <> 'delivery'
          OR s.id IS NULL OR s."workDomain" <> 'tender'
          OR t."orgId" IS DISTINCT FROM h."orgId"
          OR s."orgId" IS DISTINCT FROM h."orgId"
        )
      `)) as Array<{ n: number }>;
      if (badTargets[0]?.n) {
        note("BLOCKER", "ProjectHandoff", "completed 源/目标域或组织非法", badTargets[0].n);
      } else note("PASS", "ProjectHandoff", "completed 源/目标域与组织一致");

      const multiCompleted = (await db.$queryRawUnsafe(`
        SELECT count(*)::int AS n FROM (
          SELECT "orgId","sourceTenderProjectId","handoffType"
          FROM "ProjectHandoff" WHERE status='completed'
          GROUP BY 1,2,3 HAVING count(*) > 1
        ) x
      `)) as Array<{ n: number }>;
      if (multiCompleted[0]?.n) {
        note("BLOCKER", "ProjectHandoff", "同业务键多个 completed", multiCompleted[0].n);
      } else note("PASS", "ProjectHandoff", "业务键 completed 唯一");

      const multiTarget = (await db.$queryRawUnsafe(`
        SELECT count(*)::int AS n FROM (
          SELECT "targetDeliveryProjectId" FROM "ProjectHandoff"
          WHERE "targetDeliveryProjectId" IS NOT NULL
          GROUP BY 1 HAVING count(*) > 1
        ) x
      `)) as Array<{ n: number }>;
      if (multiTarget[0]?.n) {
        note("BLOCKER", "ProjectHandoff", "同一 target 被多个 handoff 引用", multiTarget[0].n);
      } else note("PASS", "ProjectHandoff", "target 引用唯一");
    }

    // Task 来源
    const orphanSource = (await db.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "Task" t
      LEFT JOIN "ProjectHandoff" h ON h.id = t."sourceId"
      WHERE t."sourceType"='project_handoff' AND h.id IS NULL
    `)) as Array<{ n: number }>;
    if (orphanSource[0]?.n) {
      note("BLOCKER", "TaskSource", "project_handoff 任务 sourceId 不存在", orphanSource[0].n);
    } else note("PASS", "TaskSource", "handoff 任务 sourceId 有效");

    const wrongProject = (await db.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "Task" t
      JOIN "ProjectHandoff" h ON h.id = t."sourceId"
      WHERE t."sourceType"='project_handoff'
        AND (h."targetDeliveryProjectId" IS NULL OR t."projectId" IS DISTINCT FROM h."targetDeliveryProjectId")
    `)) as Array<{ n: number }>;
    if (wrongProject[0]?.n) {
      note("WARNING", "TaskSource", "handoff 任务 projectId 与 target 不一致", wrongProject[0].n);
    } else note("PASS", "TaskSource", "handoff 任务挂在 target delivery");

    void TASK_STATUSES;
    void WORK_DOMAINS;
  } finally {
    await db.$disconnect();
  }

  const blockers = findings.filter((f) => f.severity === "BLOCKER");
  const warnings = findings.filter((f) => f.severity === "WARNING");
  const passes = findings.filter((f) => f.severity === "PASS");

  console.log("\n=== Findings ===");
  for (const f of findings) {
    const c = f.count != null ? ` (n=${f.count})` : "";
    console.log(`[${f.severity}] ${f.area}: ${f.message}${c}`);
  }
  console.log(
    `\nSummary: PASS=${passes.length} WARNING=${warnings.length} BLOCKER=${blockers.length}`,
  );
  if (blockers.length) process.exit(2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
