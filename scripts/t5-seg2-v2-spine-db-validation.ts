/**
 * T5-P1 Segment 2 §19/§20 — canonical V2 持久化脊柱的真实 Postgres fence 矩阵
 *
 * 纯平面测试只能证明"代码构造了正确的 where 子句"；真正的原子性、行锁串行化、
 * 以及 AgentRun 租约被**真实重新认领**后旧 worker 是否还能写，只有真库能证明。
 * 因此本脚本零 mock fence、零 LLM，用固定 mapped fixture 只打持久化/fence。
 *
 *   A  legacy 有效 Tender lease            → 写入成功
 *   B  legacy stale Tender lease           → 零 canonical 写
 *   C  Workforce 有效 AgentRun fence       → 写入成功
 *   D  真实 lease reclaim（旧 token 落后）  → 旧 worker 零 canonical 写
 *   E  reclaim 后的新 fence                → 写入成功
 *   F  错误 job 幂等键                      → 零写
 *   G  终态（AGENT_FAILED）域 run          → 零写
 *   H  事务中途异常（重复 requirementCode） → 全回滚，无 partial
 *   I  非 tender workDomain 的 Job         → 工具层拒绝执行（V2-SPINE-17 真实版）
 *
 * 运行（仅隔离 Neon 分支，绝不指向生产）：
 *   DATABASE_URL="$CS" DIRECT_URL="$CS" npx tsx scripts/t5-seg2-v2-spine-db-validation.ts
 *
 * 与 pr106 脚本同纪律：结束清理自建 fixtures，不注册进 test-all。
 */

import { db } from "@/lib/db";
import {
  claimRunLease,
  createRunFence,
  type RunLeaseHandle,
} from "@/lib/agent-runtime/lease";
import { persistV2Fenced } from "@/lib/tender-auto-analysis/v2-persist";
import type { V2MappedResult } from "@/lib/tender-auto-analysis/v2-map";
import { persistV2ForWorkforce } from "@/lib/tender-workforce/v2-persist-workforce";
import {
  buildWorkforceTenderIdempotencyKey,
  TENDER_AGENT_RUN_STATUS,
  TENDER_WORKFORCE_ANALYSIS_VERSION,
} from "@/lib/tender-workforce/analysis-run-service";
import { TENDER_WORKFORCE_TOOL_HANDLERS } from "@/lib/tender-workforce/tools";
import { WORKFORCE_JOB_RUN_TYPE } from "@/lib/workforce-runtime/constants";

const TAG = `t5seg2_${Date.now()}`;
let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

const V2_SUMMARY_FIELDS = [
  "engine",
  "brief",
  "criticalFacts",
  "submissionChecklist",
  "unknowns",
  "conflicts",
  "addendumChanges",
  "evidenceCoverage",
  "analystSynthesis",
  "metadata",
];

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
    summaryJson: Object.fromEntries(
      V2_SUMMARY_FIELDS.map((f) => [f, f === "engine" ? "v2" : { ok: true }]),
    ),
  } as unknown as V2MappedResult;
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
  console.log(`T5 Segment 2 — canonical V2 fence 矩阵（真实 Postgres，${TAG}）`);

  const user = await db.user.create({
    data: { email: `${TAG}@test.qingyan.local`, name: `${TAG}-user` },
  });
  const org = await db.organization.create({
    data: { name: `${TAG}-org`, code: TAG, ownerId: user.id, status: "active" },
  });
  const project = await db.project.create({
    data: { name: `${TAG}-project`, ownerId: user.id, orgId: org.id },
  });
  const session = await db.agentSession.create({
    data: {
      orgId: org.id,
      userId: user.id,
      channel: "web",
    },
  });

  let seq = 0;
  async function makeDomainRun(input: {
    status: string;
    jobId?: string;
    leaseOwner?: string;
    leaseValid?: boolean;
    analysisVersion?: string;
  }): Promise<string> {
    seq += 1;
    const run = await db.tenderAnalysisRun.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        status: input.status,
        runKind: "FULL",
        analysisVersion:
          input.analysisVersion ?? TENDER_WORKFORCE_ANALYSIS_VERSION,
        promptVersion: "tender-workforce-prompt-v1",
        idempotencyKey: input.jobId
          ? buildWorkforceTenderIdempotencyKey(input.jobId)
          : `${TAG}-${seq}`,
        sourceHashFingerprint: `${TAG}-fp`,
        createdById: user.id,
        ...(input.leaseOwner
          ? {
              leaseOwner: input.leaseOwner,
              leaseExpiresAt: new Date(
                Date.now() + (input.leaseValid === false ? -1_000 : 90_000),
              ),
            }
          : {}),
      },
      select: { id: true },
    });
    return run.id;
  }

  async function makeAgentRun(metadata: Record<string, unknown>) {
    return db.agentRun.create({
      data: {
        orgId: org.id,
        sessionId: session.id,
        runType: WORKFORCE_JOB_RUN_TYPE,
        status: "running",
        runtimeVersion: "v2",
        leaseExpiresAt: new Date(Date.now() + 180_000),
        metadata: metadata as never,
      },
      select: { id: true, leaseExpiresAt: true },
    });
  }

  try {
    /* ── A：legacy 有效 Tender lease → 成功 ── */
    {
      const runId = await makeDomainRun({
        status: "ANALYZING",
        leaseOwner: "worker-A",
      });
      await persistV2Fenced({
        runId,
        projectId: project.id,
        leaseOwner: "worker-A",
        leaseMs: 90_000,
        mapped: mappedWith(["A-1", "A-2"]),
        model: "m",
      });
      const c = await counts(runId);
      ok(
        c.facts === 1 && c.reqs === 2 && c.sections === 16,
        "A: legacy 有效 Tender lease → canonical 写入成功（parity 未因抽核心漂移）",
        c,
      );
    }

    /* ── B：legacy stale lease → 零写 ── */
    {
      const runId = await makeDomainRun({
        status: "ANALYZING",
        leaseOwner: "worker-A",
        leaseValid: false,
      });
      let threw = "";
      try {
        await persistV2Fenced({
          runId,
          projectId: project.id,
          leaseOwner: "worker-A",
          leaseMs: 90_000,
          mapped: mappedWith(["B-1"]),
          model: "m",
        });
      } catch (e) {
        threw = e instanceof Error ? e.name : "unknown";
      }
      const c = await counts(runId);
      ok(
        threw === "TenderV2LeaseLostError" &&
          c.facts === 0 &&
          c.reqs === 0 &&
          c.sections === 0,
        "B: legacy 过期 lease → 零 canonical 写",
        { threw, ...c },
      );
    }

    /* ── C：Workforce 有效 AgentRun fence → 成功 ── */
    const jobRun = await makeAgentRun({
      workDomain: "tender",
      projectId: project.id,
    });
    const holderC: { lease: RunLeaseHandle } = {
      lease: {
        runId: jobRun.id,
        leaseExpiresAt: jobRun.leaseExpiresAt!,
        leaseMs: 180_000,
      },
    };
    const domainRunC = await makeDomainRun({
      status: TENDER_AGENT_RUN_STATUS.running,
      jobId: jobRun.id,
    });
    {
      const r = await persistV2ForWorkforce({
        orgId: org.id,
        projectId: project.id,
        analysisRunId: domainRunC,
        jobId: jobRun.id,
        mapped: mappedWith(["C-1", "C-2", "C-3"]),
        model: "m",
        runFence: createRunFence(holderC),
      });
      const c = await counts(domainRunC);
      const row = await db.tenderAnalysisRun.findUniqueOrThrow({
        where: { id: domainRunC },
        select: { status: true, summaryJson: true, model: true },
      });
      const sj = (row.summaryJson ?? {}) as Record<string, unknown>;
      ok(
        r.requirementCount === 3 && c.reqs === 3 && c.sections === 16,
        "C: Workforce 有效 AgentRun fence → canonical 写入成功",
        c,
      );
      ok(
        row.status === TENDER_AGENT_RUN_STATUS.running,
        "C2: 持久化后仍是 AGENT_ANALYZING（Segment 2 不终态化）",
        row.status,
      );
      ok(
        V2_SUMMARY_FIELDS.every((f) => sj[f] !== undefined) && row.model === "m",
        "C3: summaryJson 十个 V2 语义字段与 model 全部落库",
        Object.keys(sj),
      );
    }

    /* ── D：真实 lease reclaim → 旧 worker 零写 ── */
    {
      // 让租约过期，另一 worker 原子重新认领（token 前进）
      await db.agentRun.update({
        where: { id: jobRun.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      });
      const reclaim = await claimRunLease({
        runId: jobRun.id,
        allowedRunTypes: [WORKFORCE_JOB_RUN_TYPE],
        leaseMs: 180_000,
        maxAttempts: 5,
        reclaimableStatuses: ["running"],
        resetStartedAt: false,
        clearError: false,
      });
      ok(reclaim.ok, "D0: 第二个 worker 成功重新认领租约（token 前进）");

      const before = await counts(domainRunC);
      let threw = "";
      try {
        // 旧 worker 仍拿着旧 token
        await persistV2ForWorkforce({
          orgId: org.id,
          projectId: project.id,
          analysisRunId: domainRunC,
          jobId: jobRun.id,
          mapped: mappedWith(["D-1", "D-2", "D-3", "D-4"]),
          model: "stale",
          runFence: createRunFence(holderC),
        });
      } catch (e) {
        threw = e instanceof Error ? e.name : "unknown";
      }
      const after = await counts(domainRunC);
      const row = await db.tenderAnalysisRun.findUniqueOrThrow({
        where: { id: domainRunC },
        select: { model: true },
      });
      ok(
        threw === "LostLeaseError" &&
          after.reqs === before.reqs &&
          after.facts === before.facts &&
          row.model === "m",
        "D: 租约被真实接管后，旧 worker 零 canonical 写（既有数据未被覆盖/删除）",
        { threw, before, after, model: row.model },
      );

      /* ── E：reclaim 后的新 fence → 成功 ── */
      if (reclaim.ok) {
        const holderE: { lease: RunLeaseHandle } = { lease: reclaim.lease };
        await persistV2ForWorkforce({
          orgId: org.id,
          projectId: project.id,
          analysisRunId: domainRunC,
          jobId: jobRun.id,
          mapped: mappedWith(["E-1"]),
          model: "fresh",
          runFence: createRunFence(holderE),
        });
        const c = await counts(domainRunC);
        const row2 = await db.tenderAnalysisRun.findUniqueOrThrow({
          where: { id: domainRunC },
          select: { model: true },
        });
        ok(
          c.reqs === 1 && row2.model === "fresh",
          "E: 新 worker 用新 token 写入成功（幂等重建，旧要求被替换）",
          c,
        );
      }
    }

    /* ── F：错误 job 幂等键 → 零写 ── */
    {
      const jobRunF = await makeAgentRun({
        workDomain: "tender",
        projectId: project.id,
      });
      const domainRunF = await makeDomainRun({
        status: TENDER_AGENT_RUN_STATUS.running,
        jobId: jobRunF.id,
      });
      let threw = "";
      try {
        await persistV2ForWorkforce({
          orgId: org.id,
          projectId: project.id,
          analysisRunId: domainRunF,
          jobId: `${jobRunF.id}_other`, // 幂等键不符
          mapped: mappedWith(["F-1"]),
          model: "m",
          runFence: createRunFence({
            lease: {
              runId: jobRunF.id,
              leaseExpiresAt: jobRunF.leaseExpiresAt!,
              leaseMs: 180_000,
            },
          }),
        });
      } catch (e) {
        threw = e instanceof Error ? e.name : "unknown";
      }
      const c = await counts(domainRunF);
      ok(
        threw === "WorkforceTenderDomainOwnershipError" &&
          c.reqs === 0 &&
          c.sections === 0,
        "F: Job 幂等键不匹配 → 域归属 fail-closed，零写",
        { threw, ...c },
      );
    }

    /* ── G：终态域 run → 零写 ── */
    {
      const jobRunG = await makeAgentRun({
        workDomain: "tender",
        projectId: project.id,
      });
      const domainRunG = await makeDomainRun({
        status: TENDER_AGENT_RUN_STATUS.failed,
        jobId: jobRunG.id,
      });
      let threw = "";
      try {
        await persistV2ForWorkforce({
          orgId: org.id,
          projectId: project.id,
          analysisRunId: domainRunG,
          jobId: jobRunG.id,
          mapped: mappedWith(["G-1"]),
          model: "m",
          runFence: createRunFence({
            lease: {
              runId: jobRunG.id,
              leaseExpiresAt: jobRunG.leaseExpiresAt!,
              leaseMs: 180_000,
            },
          }),
        });
      } catch (e) {
        threw = e instanceof Error ? e.name : "unknown";
      }
      const c = await counts(domainRunG);
      ok(
        threw === "WorkforceTenderDomainOwnershipError" &&
          c.reqs === 0 &&
          c.sections === 0,
        "G: 已终态（AGENT_FAILED）的域 run → 零 canonical 写（不复活）",
        { threw, ...c },
      );
    }

    /* ── H：事务中途异常 → 全回滚 ── */
    {
      const jobRunH = await makeAgentRun({
        workDomain: "tender",
        projectId: project.id,
      });
      const domainRunH = await makeDomainRun({
        status: TENDER_AGENT_RUN_STATUS.running,
        jobId: jobRunH.id,
      });
      let threw = "";
      try {
        await persistV2ForWorkforce({
          orgId: org.id,
          projectId: project.id,
          analysisRunId: domainRunH,
          jobId: jobRunH.id,
          // 重复 requirementCode → @@unique(analysisRunId, requirementCode) 冲突
          mapped: mappedWith(["H-1", "H-1"]),
          model: "m",
          runFence: createRunFence({
            lease: {
              runId: jobRunH.id,
              leaseExpiresAt: jobRunH.leaseExpiresAt!,
              leaseMs: 180_000,
            },
          }),
        });
      } catch (e) {
        threw = e instanceof Error ? e.constructor.name : "unknown";
      }
      const c = await counts(domainRunH);
      const row = await db.tenderAnalysisRun.findUniqueOrThrow({
        where: { id: domainRunH },
        select: { summaryJson: true, model: true },
      });
      ok(
        threw !== "" &&
          c.facts === 0 &&
          c.reqs === 0 &&
          c.sections === 0 &&
          row.summaryJson === null &&
          row.model === null,
        "H: 事务中途异常 → facts/requirements/sections/summaryJson 全部回滚，无 partial",
        { threw, ...c, model: row.model },
      );
    }

    /* ── I：非 tender workDomain 的 Job → 工具层拒绝 ── */
    {
      const salesJob = await makeAgentRun({
        workDomain: "sales",
        projectId: project.id,
      });
      const handler = TENDER_WORKFORCE_TOOL_HANDLERS.tender_analyze_package_v2;
      const res = await handler({
        orgId: org.id,
        userId: user.id,
        role: "sales",
        runId: salesJob.id,
        stepKey: "s1",
        operationKey: "op1",
        priorEvidence: {},
        runFence: createRunFence({
          lease: {
            runId: salesJob.id,
            leaseExpiresAt: salesJob.leaseExpiresAt!,
            leaseMs: 180_000,
          },
        }),
      });
      ok(
        res.ok === false && (res.error ?? "").includes("仅限投标"),
        "I: 非 tender workDomain 的 Job 无法执行 canonical V2 工具（V2-SPINE-17 真实版）",
        res,
      );
    }
  } finally {
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: org.id } });
    await db.agentRun.deleteMany({ where: { orgId: org.id } });
    await db.agentSession.deleteMany({ where: { orgId: org.id } });
    await db.project.deleteMany({ where: { orgId: org.id } });
    await db.organization.deleteMany({ where: { id: org.id } });
    await db.user.deleteMany({ where: { id: user.id } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("异常：", e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
