/**
 * Phase 3B-A：AiThread.orgId 历史安全回填
 *
 * 用法：
 *   npx tsx scripts/phase3b-backfill-ai-thread-org.ts           # dry-run（默认）
 *   npx tsx scripts/phase3b-backfill-ai-thread-org.ts --dry-run
 *   npx tsx scripts/phase3b-backfill-ai-thread-org.ts --apply
 *
 * 默认无参数 = dry-run，禁止误写。
 */

import fs from "fs";
import path from "path";
import { db } from "../src/lib/db";
import {
  decideAiThreadOrgBackfill,
  type ThreadOrgBackfillReasonCode,
} from "../src/lib/assistant/thread-org-backfill";

type ConflictRow = {
  threadId: string;
  reasonCode: ThreadOrgBackfillReasonCode;
  sourceOrgIds: string[];
};

type Report = {
  generatedAt: string;
  dryRun: boolean;
  totalThreads: number;
  alreadyBound: number;
  alreadyArchivedUnresolved: number;
  boundByProject: number;
  boundByPendingAction: number;
  boundByAgentRun: number;
  boundByUniqueMembership: number;
  conflicted: number;
  unresolved: number;
  archived: number;
  errors: string[];
  conflicts: ConflictRow[];
};

function parseMode(argv: string[]): "dry-run" | "apply" {
  if (argv.includes("--apply")) return "apply";
  return "dry-run";
}

function uniqueNonEmpty(ids: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      ids.filter((x): x is string => typeof x === "string" && x.length > 0),
    ),
  );
}

async function collectAgentRunOrgs(threadId: string): Promise<string[]> {
  const orgs = new Set<string>();

  const paWithRuns = await db.pendingAction.findMany({
    where: { threadId, agentRunId: { not: null } },
    select: { agentRunId: true },
  });
  const runIds = uniqueNonEmpty(paWithRuns.map((r) => r.agentRunId));
  if (runIds.length > 0) {
    const runs = await db.agentRun.findMany({
      where: { id: { in: runIds } },
      select: { orgId: true },
    });
    for (const r of runs) {
      if (r.orgId) orgs.add(r.orgId);
    }
  }

  // 可靠关联：metadata.threadId（禁止假设 sessionId = threadId）
  try {
    const metaRuns = await db.$queryRaw<Array<{ orgId: string }>>`
      SELECT DISTINCT "orgId"
      FROM "AgentRun"
      WHERE "metadata" IS NOT NULL
        AND "metadata"->>'threadId' = ${threadId}
    `;
    for (const r of metaRuns) {
      if (r.orgId) orgs.add(r.orgId);
    }
  } catch {
    // metadata 查询失败时不猜测，仅依赖 PA→Run 链路
  }

  return Array.from(orgs);
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const dryRun = mode === "dry-run";

  const report: Report = {
    generatedAt: new Date().toISOString(),
    dryRun,
    totalThreads: 0,
    alreadyBound: 0,
    alreadyArchivedUnresolved: 0,
    boundByProject: 0,
    boundByPendingAction: 0,
    boundByAgentRun: 0,
    boundByUniqueMembership: 0,
    conflicted: 0,
    unresolved: 0,
    archived: 0,
    errors: [],
    conflicts: [],
  };

  const threads = await db.aiThread.findMany({
    select: {
      id: true,
      userId: true,
      orgId: true,
      projectId: true,
      archived: true,
    },
    orderBy: { createdAt: "asc" },
  });
  report.totalThreads = threads.length;

  for (const thread of threads) {
    try {
      let projectOrg: string | null = null;
      if (thread.projectId) {
        const project = await db.project.findUnique({
          where: { id: thread.projectId },
          select: { orgId: true },
        });
        projectOrg = project?.orgId ?? null;
      }

      const paRows = await db.pendingAction.findMany({
        where: { threadId: thread.id, orgId: { not: null } },
        select: { orgId: true },
      });
      const pendingActionOrgs = uniqueNonEmpty(paRows.map((r) => r.orgId));
      const agentRunOrgs = await collectAgentRunOrgs(thread.id);

      const memberships = await db.organizationMember.findMany({
        where: { userId: thread.userId, status: "active" },
        select: { orgId: true },
      });
      const membershipOrgs = uniqueNonEmpty(memberships.map((m) => m.orgId));

      const decision = decideAiThreadOrgBackfill({
        existingOrgId: thread.orgId,
        archived: thread.archived,
        projectOrg,
        pendingActionOrgs,
        agentRunOrgs,
        membershipOrgs,
      });

      if (decision.kind === "skip_bound") {
        report.alreadyBound += 1;
        continue;
      }
      if (decision.kind === "skip_already_archived") {
        report.alreadyArchivedUnresolved += 1;
        continue;
      }
      if (decision.kind === "bind") {
        if (!dryRun) {
          await db.aiThread.update({
            where: { id: thread.id },
            data: { orgId: decision.orgId },
          });
        }
        if (decision.source === "project") report.boundByProject += 1;
        else if (decision.source === "pending_action")
          report.boundByPendingAction += 1;
        else if (decision.source === "agent_run") report.boundByAgentRun += 1;
        else report.boundByUniqueMembership += 1;
        continue;
      }

      const unresolvedCodes: ThreadOrgBackfillReasonCode[] = [
        "NO_RELIABLE_ORG_SOURCE",
        "NO_ACTIVE_MEMBERSHIP",
        "MULTIPLE_ACTIVE_MEMBERSHIPS",
      ];
      if (unresolvedCodes.includes(decision.reasonCode)) {
        report.unresolved += 1;
      } else {
        report.conflicted += 1;
      }
      report.conflicts.push({
        threadId: thread.id,
        reasonCode: decision.reasonCode,
        sourceOrgIds: decision.sourceOrgIds,
      });
      if (!dryRun) {
        await db.aiThread.update({
          where: { id: thread.id },
          data: { archived: true },
        });
      }
      report.archived += 1;
    } catch (e) {
      report.errors.push(
        `${thread.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const outPath = path.join(
    process.cwd(),
    "docs/phase3b-ai-thread-org-backfill.json",
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const publicReport = {
    ...report,
    conflicts: report.conflicts.slice(0, 500),
  };
  fs.writeFileSync(outPath, JSON.stringify(publicReport, null, 2) + "\n");
  console.log(JSON.stringify(publicReport, null, 2));
  console.log(dryRun ? "\nDRY_RUN_OK (no writes)" : "\nAPPLY_OK");
  console.log("wrote", outPath);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
