/**
 * PR #106 — V2 canonical 持久化 lease fence 的真实 Postgres 校验（DB 平面，手动运行）
 *
 * 目的：在真实 Neon/Postgres 事务语义下验证 persistV2Fenced（不是只有 injectable fake tx）。
 *   V2-LEASE-01：stale worker（leaseOwner 不匹配）→ 零 canonical 写，既有数据不被覆盖/删除。
 *   V2-LEASE-02：正常 owner → 恰好一次持久化。
 *   V2-LEASE-03：事务中途异常（重复 requirementCode 触发 @@unique）→ 全回滚，无 partial。
 *
 * 运行（仅隔离 Neon 分支，绝不指向生产）：
 *   DATABASE_URL="$CS" DIRECT_URL="$CS" npx tsx scripts/pr106-v2-fence-db-validation.ts
 *
 * 结束会清理自建 fixtures。不注册进 test-all（纯平面无 DB）。
 */

import { db } from "@/lib/db";
import {
  persistV2Fenced,
  TenderV2LeaseLostError,
} from "@/lib/tender-auto-analysis/v2-persist";
import type { V2MappedResult } from "@/lib/tender-auto-analysis/v2-map";

const TAG = `pr106fence_${Date.now()}`;
let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function mappedWith(reqCodes: string[]): V2MappedResult {
  return {
    facts: [
      {
        statementKind: "CONFIRMED_FACT",
        contentZh: "买方 X",
        contentOriginal: "Buyer X",
        confidence: "CONFIRMED",
        sourceRefs: [], // 避免 documentId FK；fence 语义无需 sourceRef
      },
    ],
    requirements: reqCodes.map((code) => ({
      requirementCode: code,
      category: "mandatory",
      originalRequirement: `req ${code}`,
      chineseTranslation: `要求 ${code}`,
      mandatory: true,
      evidenceRequired: false,
      complianceStatus: "NOT_ASSESSED" as const,
      sourcePage: 1,
      sourceRefs: [],
    })),
    clarifications: [],
    changeCandidates: [],
    sections: [],
    summaryText: "t",
    summaryJson: { engine: "v2" },
  };
}

async function counts(runId: string) {
  const [facts, reqs, sections] = await Promise.all([
    db.tenderAnalysisFact.count({ where: { runId } }),
    db.tenderExtractedRequirement.count({ where: { analysisRunId: runId } }),
    db.tenderAnalysisSection.count({ where: { runId } }),
  ]);
  return { facts, reqs, sections };
}

async function main() {
  console.log(`PR106 V2 fence DB validation (${TAG})`);

  // —— fixtures：User → Org → Project → Run —— //
  const user = await db.user.create({
    data: { email: `${TAG}@example.test`, name: `${TAG}-user` },
  });
  const org = await db.organization.create({
    data: { name: `${TAG}-org`, code: `${TAG}-code`, ownerId: user.id },
  });
  const project = await db.project.create({
    data: { name: `${TAG}-project`, ownerId: user.id, orgId: org.id },
  });

  async function makeRun(leaseOwner: string, leaseValid: boolean) {
    return db.tenderAnalysisRun.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        status: "EXTRACTING",
        runKind: "FULL",
        analysisVersion: "tender-auto-analysis-v1",
        promptVersion: "tender-analysis-prompt-v1",
        idempotencyKey: `${TAG}-${leaseOwner}-${Math.random()}`,
        sourceHashFingerprint: `${TAG}-fp`,
        createdById: user.id,
        leaseOwner,
        leaseExpiresAt: new Date(Date.now() + (leaseValid ? 90_000 : -1000)),
      },
      select: { id: true },
    });
  }

  const createdRunIds: string[] = [];
  try {
    // —— V2-LEASE-02：正常 owner → 恰好一次持久化 —— //
    {
      const run = await makeRun("worker-A", true);
      createdRunIds.push(run.id);
      const res = await persistV2Fenced({
        runId: run.id,
        projectId: project.id,
        leaseOwner: "worker-A",
        leaseMs: 90_000,
        mapped: mappedWith(["R1", "R2"]),
        model: "m",
      });
      const c = await counts(run.id);
      ok(res.factCount === 1 && c.facts === 1, "V2-LEASE-02: 1 fact 持久化");
      ok(res.requirementCount === 2 && c.reqs === 2, "V2-LEASE-02: 2 requirements 持久化");
      ok(c.sections === 16, "V2-LEASE-02: 16 sections 持久化");
    }

    // —— V2-LEASE-01：B 拥有 lease，A（stale）尝试写 → 零写，B 数据不动 —— //
    {
      const run = await makeRun("worker-B", true);
      createdRunIds.push(run.id);
      // B 正常持久化
      await persistV2Fenced({
        runId: run.id,
        projectId: project.id,
        leaseOwner: "worker-B",
        leaseMs: 90_000,
        mapped: mappedWith(["B1"]),
        model: "m",
      });
      const before = await counts(run.id);
      // A（已失租/从未拥有）尝试写同一 run
      let threw: unknown = null;
      try {
        await persistV2Fenced({
          runId: run.id,
          projectId: project.id,
          leaseOwner: "worker-A", // 不匹配当前 owner=B
          leaseMs: 90_000,
          mapped: mappedWith(["A1", "A2", "A3"]),
          model: "m",
        });
      } catch (e) {
        threw = e;
      }
      const after = await counts(run.id);
      ok(threw instanceof TenderV2LeaseLostError, "V2-LEASE-01: stale A → TenderV2LeaseLostError");
      ok(
        after.facts === before.facts &&
          after.reqs === before.reqs &&
          after.reqs === 1,
        "V2-LEASE-01: B 数据未被覆盖/删除（reqs 仍为 B 的 1 条，非 A 的 3 条）",
      );
    }

    // —— V2-LEASE-03：事务中途异常（重复 requirementCode）→ 全回滚，无 partial —— //
    {
      const run = await makeRun("worker-C", true);
      createdRunIds.push(run.id);
      let threw: unknown = null;
      try {
        await persistV2Fenced({
          runId: run.id,
          projectId: project.id,
          leaseOwner: "worker-C",
          leaseMs: 90_000,
          mapped: mappedWith(["DUP", "DUP"]), // 第 2 条违反 @@unique([analysisRunId, requirementCode])
          model: "m",
        });
      } catch (e) {
        threw = e;
      }
      const c = await counts(run.id);
      ok(threw instanceof Error && !(threw instanceof TenderV2LeaseLostError), "V2-LEASE-03: 中途异常抛出");
      ok(c.facts === 0 && c.reqs === 0 && c.sections === 0, "V2-LEASE-03: 事务回滚，无 partial facts/reqs/sections");
    }

    // —— 失效 lease（过期）也被 fence 拒绝 —— //
    {
      const run = await makeRun("worker-D", false); // leaseExpiresAt 已过期
      createdRunIds.push(run.id);
      let threw: unknown = null;
      try {
        await persistV2Fenced({
          runId: run.id,
          projectId: project.id,
          leaseOwner: "worker-D",
          leaseMs: 90_000,
          mapped: mappedWith(["X1"]),
          model: "m",
        });
      } catch (e) {
        threw = e;
      }
      const c = await counts(run.id);
      ok(threw instanceof TenderV2LeaseLostError, "FENCE: lease 过期 → 拒绝");
      ok(c.facts === 0 && c.reqs === 0, "FENCE: lease 过期 → 零写");
    }
  } finally {
    // —— cleanup fixtures —— //
    for (const id of createdRunIds) {
      await db.tenderAnalysisSourceRef.deleteMany({ where: { runId: id } }).catch(() => {});
      await db.tenderAnalysisSection.deleteMany({ where: { runId: id } }).catch(() => {});
      await db.tenderAnalysisFact.deleteMany({ where: { runId: id } }).catch(() => {});
      await db.tenderExtractedRequirement.deleteMany({ where: { analysisRunId: id } }).catch(() => {});
      await db.tenderClarificationQuestion.deleteMany({ where: { analysisRunId: id } }).catch(() => {});
      await db.tenderAnalysisChangeCandidate.deleteMany({ where: { runId: id } }).catch(() => {});
      await db.tenderAnalysisRun.delete({ where: { id } }).catch(() => {});
    }
    await db.project.delete({ where: { id: project.id } }).catch(() => {});
    await db.organization.delete({ where: { id: org.id } }).catch(() => {});
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    await db.$disconnect();
  }

  console.log(`\nPR106 fence DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
