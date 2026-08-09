/**
 * Governance Hygiene — Concurrency Gate（Final Micro-Fix 验收）
 *
 * 验证同一 org 的 quota-policy 写操作在数据库层（Organization 行锁）串行执行：
 *   C1 并发 create：版本唯一、enabled ≤ 1、effective = 最新 enabled
 *   C2 并发 patch：一胜一 version_conflict
 *   C3 顺序 stale patch：指向旧行的 patch 必须 version_conflict，不产生重复版本
 *   C4 不同 metric 互不影响：org 粗粒度锁不得破坏各 metric 数据独立性
 *
 * 运行：npx tsx src/lib/capabilities/__tests__/governance-hygiene-concurrency-gate.test.ts
 * ⚠️ 必须指向隔离 Preview/Test DB（禁止生产 DB）。创建独立测试组织，结束后清理。
 */

import { db } from "@/lib/db";
import {
  createQuotaPolicy,
  patchQuotaPolicy,
  resolveEffectiveQuota,
} from "../governance";

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

// Fail-closed：禁止对生产/未识别数据库执行 destructive 测试
assertSafeTestDatabase({ scriptName: "src/lib/capabilities/__tests__/governance-hygiene-concurrency-gate.test.ts" });

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

function isVersionConflict(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as Error & { code?: string }).code === "version_conflict"
  );
}

async function enabledRows(orgId: string, metric: string) {
  return db.capabilityQuotaPolicy.findMany({
    where: { orgId, workspaceId: null, metric, enabled: true },
    orderBy: { version: "desc" },
  });
}

async function allVersions(orgId: string, metric: string): Promise<number[]> {
  const rows = await db.capabilityQuotaPolicy.findMany({
    where: { orgId, workspaceId: null, metric },
    select: { version: true },
    orderBy: { version: "asc" },
  });
  return rows.map((r) => r.version);
}

async function main() {
  console.log("governance hygiene concurrency gate");
  const stamp = Date.now().toString(36);

  const user = await db.user.create({
    data: { email: `ghc-${stamp}@test.local`, name: `GHC ${stamp}` },
  });
  const org = await db.organization.create({
    data: {
      name: `GHC Org ${stamp}`,
      code: `GHC${stamp}`,
      owner: { connect: { id: user.id } },
    },
  });

  const AI = "MONTHLY_AI_COST" as const;
  const RUNS = "DAILY_AGENT_RUNS" as const;

  try {
    // ---------- C1：并发 create ----------
    console.log("Case C1: concurrent create");
    const c1 = await Promise.allSettled([
      createQuotaPolicy({
        orgId: org.id,
        userId: user.id,
        metric: AI,
        period: "MONTHLY",
        hardLimit: 40,
      }),
      createQuotaPolicy({
        orgId: org.id,
        userId: user.id,
        metric: AI,
        period: "MONTHLY",
        hardLimit: 30,
      }),
    ]);
    const c1ok = c1.filter((r) => r.status === "fulfilled");
    ok(c1ok.length === 2, `两个并发 create 均确定性完成（成功 ${c1ok.length}/2）`);

    const c1versions = await allVersions(org.id, AI);
    ok(
      new Set(c1versions).size === c1versions.length,
      `版本号唯一（${c1versions.join(",")}）`,
    );
    ok(
      c1versions.length === 2 && Math.max(...c1versions) === 2,
      "串行化产生 v1 + v2（无重复 v1-A/v1-B）",
    );

    const c1enabled = await enabledRows(org.id, AI);
    ok(c1enabled.length === 1, `enabled count = 1（实际 ${c1enabled.length}）`);
    ok(c1enabled[0]?.version === 2, "enabled 的是最大版本 v2");

    const c1eff = await resolveEffectiveQuota({
      orgId: org.id,
      workspaceId: null,
      metric: AI,
    });
    const c1winner = Number(c1enabled[0]?.hardLimit?.toString());
    ok(
      c1eff.hardLimit === c1winner,
      `resolveEffectiveQuota = 最新 enabled 策略（hard=${c1eff.hardLimit}）`,
    );

    // ---------- C2：并发 patch ----------
    console.log("Case C2: concurrent patch");
    const base = c1enabled[0]!; // v2 enabled
    const c2 = await Promise.allSettled([
      patchQuotaPolicy({
        orgId: org.id,
        userId: user.id,
        id: base.id,
        expectedVersion: base.version,
        hardLimit: 25,
      }),
      patchQuotaPolicy({
        orgId: org.id,
        userId: user.id,
        id: base.id,
        expectedVersion: base.version,
        hardLimit: 15,
      }),
    ]);
    const c2ok = c2.filter((r) => r.status === "fulfilled");
    const c2conflict = c2.filter(
      (r) => r.status === "rejected" && isVersionConflict(r.reason),
    );
    ok(
      c2ok.length === 1 && c2conflict.length === 1,
      `1 SUCCESS + 1 version_conflict（实际 ${c2ok.length} 成功 / ${c2conflict.length} 冲突）`,
    );

    const c2enabled = await enabledRows(org.id, AI);
    ok(c2enabled.length === 1, `enabled count = 1（实际 ${c2enabled.length}）`);
    ok(
      c2enabled[0]?.version === base.version + 1,
      `latest version = ${base.version + 1}（无 v${base.version + 1}-A/-B）`,
    );
    const c2versions = await allVersions(org.id, AI);
    ok(
      new Set(c2versions).size === c2versions.length,
      `版本号仍唯一（${c2versions.join(",")}）`,
    );

    // ---------- C3：顺序 stale patch ----------
    console.log("Case C3: sequential stale patch");
    const v3row = c2enabled[0]!; // v3 enabled
    await patchQuotaPolicy({
      orgId: org.id,
      userId: user.id,
      id: v3row.id,
      expectedVersion: v3row.version,
      hardLimit: 12,
    }); // → v4
    let c3conflict = false;
    try {
      // 拿着旧 v3 行再 patch（旧行 version 自身没变，老实现会恒通过）
      await patchQuotaPolicy({
        orgId: org.id,
        userId: user.id,
        id: v3row.id,
        expectedVersion: v3row.version,
        hardLimit: 999,
      });
    } catch (err) {
      c3conflict = isVersionConflict(err);
    }
    ok(c3conflict, "stale patch（指向已 supersede 的旧行）→ version_conflict");
    const c3versions = await allVersions(org.id, AI);
    ok(
      new Set(c3versions).size === c3versions.length &&
        Math.max(...c3versions) === 4,
      `未生成重复 v4，最大版本仍为 4（${c3versions.join(",")}）`,
    );
    const c3eff = await resolveEffectiveQuota({
      orgId: org.id,
      workspaceId: null,
      metric: AI,
    });
    ok(c3eff.hardLimit === 12, "有效配额来自合法 patch（hard=12），999 未生效");

    // ---------- C4：不同 metric 互不影响 ----------
    console.log("Case C4: different metrics independent");
    const runs1 = await createQuotaPolicy({
      orgId: org.id,
      userId: user.id,
      metric: RUNS,
      period: "DAILY",
      hardLimit: 50,
    });
    ok(runs1.version === 1, "DAILY_AGENT_RUNS 版本从 1 开始（不受 AI metric 影响）");

    await patchQuotaPolicy({
      orgId: org.id,
      userId: user.id,
      id: runs1.id,
      expectedVersion: 1,
      hardLimit: 40,
    });

    const aiEnabled = await enabledRows(org.id, AI);
    const runsEnabled = await enabledRows(org.id, RUNS);
    ok(
      aiEnabled.length === 1 && aiEnabled[0]?.version === 4,
      "RUNS 的写操作没有错误 supersede AI 的 current（AI 仍 v4 enabled）",
    );
    ok(
      runsEnabled.length === 1 && runsEnabled[0]?.version === 2,
      "RUNS 自身收敛为单一 enabled v2",
    );
    const aiEff = await resolveEffectiveQuota({
      orgId: org.id,
      workspaceId: null,
      metric: AI,
    });
    const runsEff = await resolveEffectiveQuota({
      orgId: org.id,
      workspaceId: null,
      metric: RUNS,
    });
    ok(
      aiEff.hardLimit === 12 && runsEff.hardLimit === 40,
      `各 metric 有效配额独立（AI=${aiEff.hardLimit}, RUNS=${runsEff.hardLimit}）`,
    );

    // ---------- Disable 语义确认 ----------
    console.log("Case C5: disable 语义不变");
    const aiCurrent = aiEnabled[0]!;
    const disabled = await patchQuotaPolicy({
      orgId: org.id,
      userId: user.id,
      id: aiCurrent.id,
      expectedVersion: aiCurrent.version,
      enabled: false,
    });
    ok(disabled.enabled === false, "disable patch 生成 enabled=false 新版本");
    const afterDisable = await enabledRows(org.id, AI);
    ok(
      afterDisable.length === 0,
      "允许 0 条 enabled（不变量是「最多一条」而非「必须一条」）",
    );
    const effAfterDisable = await resolveEffectiveQuota({
      orgId: org.id,
      workspaceId: null,
      metric: AI,
    });
    ok(
      effAfterDisable.sourcePolicies.every((s) => s.scope === "PLATFORM"),
      "disable 后回落平台默认",
    );
  } finally {
    await db.auditLog.deleteMany({ where: { orgId: org.id } });
    await db.capabilityQuotaPolicy.deleteMany({ where: { orgId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
    await db.user.delete({ where: { id: user.id } });
  }

  console.log(`\npass=${pass} fail=${fail}`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
