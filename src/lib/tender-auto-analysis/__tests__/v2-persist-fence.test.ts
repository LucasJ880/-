/**
 * BLOCKER 2 — V2 canonical 持久化 lease fence（确定性 race）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/v2-persist-fence.test.ts
 */

import {
  persistV2Fenced,
  TenderV2LeaseLostError,
  type RunV2Tx,
  type V2PersistTx,
} from "../v2-persist";
import type { V2MappedResult } from "../v2-map";

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

const ref = {
  documentId: "d1",
  pageNumber: 1,
  originalTextSnippet: "s",
  sectionLabel: null,
  extractionMethod: "v2-llm-extract",
  confidence: "CONFIRMED" as const,
};

const mapped: V2MappedResult = {
  facts: [
    {
      statementKind: "CONFIRMED_FACT",
      contentZh: "买方 X",
      contentOriginal: "Buyer X",
      confidence: "CONFIRMED",
      sourceRefs: [ref],
    },
  ],
  requirements: [
    {
      requirementCode: "r1",
      category: "mandatory",
      originalRequirement: "5-year warranty",
      chineseTranslation: "5 年质保",
      mandatory: true,
      evidenceRequired: false,
      complianceStatus: "NOT_ASSESSED",
      sourcePage: 1,
      sourceRefs: [ref],
    },
  ],
  clarifications: [
    { question: "voltage?", reason: "conflict", priority: "HIGH", enquiryDeadline: null, sourceRefs: [ref] },
  ],
  changeCandidates: [
    { changeType: "MODIFIED", entityType: "requirement", entityKey: null, summaryZh: "addendum" },
  ],
  sections: [],
  summaryText: "t",
  summaryJson: { engine: "v2" },
};

function makeTx(opts: { fenceCount: number; throwOnFactCreate?: boolean }) {
  const calls: Record<string, number> = {};
  const bump = (k: string) => {
    calls[k] = (calls[k] ?? 0) + 1;
  };
  const idr = (p: string) => ({ id: `${p}${Math.random()}` });
  const tx: V2PersistTx = {
    tenderAnalysisRun: {
      updateMany: async () => {
        bump("run.updateMany");
        return { count: opts.fenceCount };
      },
      update: async () => {
        bump("run.update");
        return {};
      },
    },
    tenderAnalysisSourceRef: {
      deleteMany: async () => {
        bump("ref.deleteMany");
        return { count: 0 };
      },
      create: async () => {
        bump("ref.create");
        return idr("ref");
      },
    },
    tenderAnalysisFact: {
      deleteMany: async () => {
        bump("fact.deleteMany");
        return { count: 0 };
      },
      create: async () => {
        bump("fact.create");
        if (opts.throwOnFactCreate) throw new Error("boom");
        return idr("f");
      },
    },
    tenderExtractedRequirement: {
      deleteMany: async () => {
        bump("req.deleteMany");
        return { count: 0 };
      },
      create: async () => {
        bump("req.create");
        return idr("r");
      },
    },
    tenderClarificationQuestion: {
      deleteMany: async () => {
        bump("clar.deleteMany");
        return { count: 0 };
      },
      create: async () => {
        bump("clar.create");
        return idr("c");
      },
    },
    tenderAnalysisChangeCandidate: {
      deleteMany: async () => {
        bump("change.deleteMany");
        return { count: 0 };
      },
      createMany: async () => {
        bump("change.createMany");
        return { count: 1 };
      },
    },
    tenderAnalysisSection: {
      upsert: async () => {
        bump("section.upsert");
        return {};
      },
    },
  };
  const runTx: RunV2Tx = (fn) => fn(tx);
  return { calls, runTx };
}

const baseArgs = {
  runId: "run_1",
  projectId: "proj_1",
  leaseOwner: "worker-A",
  leaseMs: 90_000,
  mapped,
  model: "m",
};

async function main() {
  console.log("tender-auto-analysis v2-persist-fence");

  // V2-LEASE-01：A lease 已失（fence count=0）→ LOST_LEASE + ZERO canonical write
  {
    const { calls, runTx } = makeTx({ fenceCount: 0 });
    let threw: unknown = null;
    try {
      await persistV2Fenced(baseArgs, runTx);
    } catch (e) {
      threw = e;
    }
    ok(threw instanceof TenderV2LeaseLostError, "V2-LEASE-01: fence 失败 → TenderV2LeaseLostError");
    ok((calls["run.updateMany"] ?? 0) === 1, "V2-LEASE-01: 仅执行 fence 检查");
    const canonicalWrites =
      (calls["fact.deleteMany"] ?? 0) +
      (calls["fact.create"] ?? 0) +
      (calls["req.create"] ?? 0) +
      (calls["clar.create"] ?? 0) +
      (calls["ref.create"] ?? 0) +
      (calls["change.createMany"] ?? 0) +
      (calls["section.upsert"] ?? 0) +
      (calls["run.update"] ?? 0);
    ok(canonicalWrites === 0, "V2-LEASE-01: canonical business writes = 0（B 数据不被覆盖/删除）");
  }

  // V2-LEASE-02：正常 fence + 持久化 → 恰好一次 canonical 持久化
  {
    const { calls, runTx } = makeTx({ fenceCount: 1 });
    const res = await persistV2Fenced(baseArgs, runTx);
    ok(res.factCount === 1 && res.requirementCount === 1 && res.clarificationCount === 1, "V2-LEASE-02: facts/reqs/clars 各 1");
    ok(res.changeCount === 1 && res.sectionCount === 16, "V2-LEASE-02: change 1、sections 16");
    ok((calls["fact.create"] ?? 0) === 1, "V2-LEASE-02: fact.create 恰好 1 次（无重复持久化）");
    ok((calls["ref.create"] ?? 0) === 3, "V2-LEASE-02: sourceRef 3 条（fact+req+clar 各 1）");
    ok((calls["run.update"] ?? 0) === 1, "V2-LEASE-02: summary 写入 1 次");
  }

  // V2-LEASE-03：持久化中途异常 → 抛出，且未完成（summary 未写；真实 Prisma 事务回滚）
  {
    const { calls, runTx } = makeTx({ fenceCount: 1, throwOnFactCreate: true });
    let threw: unknown = null;
    try {
      await persistV2Fenced(baseArgs, runTx);
    } catch (e) {
      threw = e;
    }
    ok(threw instanceof Error && (threw as Error).message === "boom", "V2-LEASE-03: 中途异常向上抛出");
    ok((calls["run.update"] ?? 0) === 0, "V2-LEASE-03: 未到达 summary 写（事务回滚，无 partial 完成）");
    ok((calls["fact.create"] ?? 0) === 1, "V2-LEASE-03: 异常发生在 fact.create（fence 已通过）");
  }

  console.log(`\nv2-persist-fence: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();

/* FB-18 — 空壳分析护栏（纯函数） */
import { isEmptyAnalysisOutcome } from "../v2-persist";
{
  ok(isEmptyAnalysisOutcome({ llmCalls: 120, llmFailures: 120, factCount: 0, requirementCount: 0 }), "FB-18: 全 429 空产出 → 空壳");
  ok(isEmptyAnalysisOutcome({ llmCalls: 0, llmFailures: 0, factCount: 0, requirementCount: 0 }), "FB-18: 零调用零产出 → 空壳");
  ok(!isEmptyAnalysisOutcome({ llmCalls: 40, llmFailures: 3, factCount: 12, requirementCount: 30 }), "FB-18: 正常 run 非空壳");
  ok(!isEmptyAnalysisOutcome({ llmCalls: 40, llmFailures: 40, factCount: 5, requirementCount: 0 }), "FB-18: 有产出即便全失败标记也不算空壳（保守）");
}
