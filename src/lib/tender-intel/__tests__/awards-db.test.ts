/**
 * T4 — canonical AwardRecord 真实 Postgres 矩阵（T4-DB-01..15）
 * 运行（仅隔离 DB）：DATABASE_URL=... DIRECT_URL=... npx tsx src/lib/tender-intel/__tests__/awards-db.test.ts
 * 守卫：无 DATABASE_URL → 拒跑；生产端点前缀 → 拒跑。
 * 数据纪律：仅写入合成 org（t4dbtest_*）行 + 借用一间既有调查室做事务往返（结束恢复原值）。
 */
import { PrismaClient } from "@prisma/client";
import {
  createOrObserveAwardRecord,
  confirmAwardRecord,
  listAwardsForOrg,
  listAwardsForBuyer,
  getAwardEvidence,
  AwardIntelError,
  toAmountNumber,
  type AwardsDbClient,
  type ObserveAwardInput,
} from "../awards";
import { deriveAwardIntelligence } from "../award-intelligence";

const PROD_PREFIX = "ep-super-field-antfibsl";
const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("REFUSED: 需要 DATABASE_URL（隔离 DB）");
  process.exit(1);
}
if (url.includes(PROD_PREFIX)) {
  console.error("REFUSED: DATABASE_URL 指向生产端点，本测试禁止在生产库运行");
  process.exit(1);
}

const db = new PrismaClient();
let pass = 0,
  fail = 0;
const ok = (c: boolean, n: string) => {
  if (c) {
    pass++;
    console.log("  ✓ " + n);
  } else {
    fail++;
    console.error("  ✗ " + n);
  }
};

const TS = Date.now();
const ORG_A = `t4dbtest_orgA_${TS}`;
const ORG_B = `t4dbtest_orgB_${TS}`;
const USER = { actorType: "user", userId: `t4dbtest_user_${TS}` };
const SYSTEM = { actorType: "system", userId: null };

function input(orgId: string, over?: Partial<ObserveAwardInput>): ObserveAwardInput {
  return {
    orgId,
    actor: over?.actor ?? SYSTEM,
    award: {
      winnerName: "ACME Foam Ltd.",
      buyerNameRaw: "Public Works Canada",
      solicitationNumber: `T4DB-${TS}-001`,
      awardDate: new Date("2024-05-01"),
      contractAmount: 120000.5,
      currency: "CAD",
      scopeSummary: "Institutional mattresses supply",
      ...(over?.award ?? {}),
    },
    source: {
      sourceType: "CANADABUYS_OPEN_DATA",
      sourceKey: `canadabuys:T4DB-${TS}-001`,
      sourceUrl: "https://open.canada.ca/x",
      evidenceSnippet: "ACME FOAM LTD | 120,000.50 | 2024-05-01",
      capturedAt: new Date(),
      ...(over?.source ?? {}),
    },
    confidence: over?.confidence ?? "HIGH",
    verificationStatus: over?.verificationStatus ?? "SYSTEM_VERIFIED",
  };
}

async function cleanup() {
  await db.awardRecordSource.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await db.awardRecord.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
}

console.log("tender-intel awards — REAL Postgres 矩阵（隔离 DB）");
(async () => {
  await cleanup();

  /* T4-DB-01/02 同源重放幂等（真实唯一约束） */
  {
    const r1 = await createOrObserveAwardRecord(input(ORG_A));
    const r2 = await createOrObserveAwardRecord(input(ORG_A));
    const records = await db.awardRecord.findMany({ where: { orgId: ORG_A } });
    const sources = await db.awardRecordSource.findMany({ where: { orgId: ORG_A } });
    ok(
      r1.outcome === "CREATED" && r2.outcome === "ALREADY_OBSERVED" && records.length === 1 && sources.length === 1,
      "T4-DB-01 同 sourceType+sourceKey 重放 → 恰一条 canonical + 恰一条 source",
    );
    const r3 = await createOrObserveAwardRecord(input(ORG_A));
    ok(
      r3.outcome === "ALREADY_OBSERVED" && r3.record.id === r1.record.id,
      "T4-DB-02 三次重试仍幂等，同一记录 id",
    );
  }

  /* T4-DB-03/04 跨 org 读零行 / 写拒绝 */
  {
    const otherRead = await listAwardsForOrg({ orgId: ORG_B });
    ok(otherRead.length === 0, "T4-DB-03 跨 org read → 0 行");
    const mine = await listAwardsForOrg({ orgId: ORG_A });
    let rejected = false;
    try {
      await confirmAwardRecord({ orgId: ORG_B, actor: USER, awardRecordId: mine[0].id });
    } catch (e) {
      rejected = e instanceof AwardIntelError && e.code === "NOT_FOUND";
    }
    const untouched = await db.awardRecord.findUnique({ where: { id: mine[0].id } });
    ok(
      rejected && untouched?.verificationStatus === "SYSTEM_VERIFIED",
      "T4-DB-04 跨 org mutation → NOT_FOUND 拒绝且原行不变",
    );
  }

  /* T4-DB-05 事务原子性：source 写失败 → AwardRecord 一并回滚 */
  {
    const before = await db.awardRecord.count({ where: { orgId: ORG_A } });
    let threw = false;
    try {
      await db.$transaction(async (tx) => {
        const failing = {
          ...(tx as unknown as AwardsDbClient),
          awardRecordSource: {
            ...(tx as unknown as AwardsDbClient).awardRecordSource,
            create: async () => {
              throw new Error("simulated source write failure");
            },
          },
        } as AwardsDbClient;
        await createOrObserveAwardRecord(
          input(ORG_A, {
            award: { winnerName: "Atomicity Test Co", solicitationNumber: null },
            source: { sourceType: "WEB_SEARCH", sourceKey: `web:atomicity-${TS}` },
            verificationStatus: "AI_EXTRACTED",
            confidence: "LOW",
          }),
          { client: failing },
        );
      });
    } catch {
      threw = true;
    }
    const after = await db.awardRecord.count({ where: { orgId: ORG_A } });
    const ghost = await db.awardRecord.findFirst({
      where: { orgId: ORG_A, winnerName: "Atomicity Test Co" },
    });
    ok(threw && after === before && ghost === null, "T4-DB-05 source 写失败 → AwardRecord 回滚，零 ghost 行");
  }

  /* T4-DB-06/07 AI 产物不得变 CONFIRMED / 冒充人工被拒 */
  {
    const ai = await createOrObserveAwardRecord(
      input(ORG_A, {
        award: { winnerName: "Rumour Corp", solicitationNumber: null, contractAmount: 999999 },
        source: { sourceType: "WEB_SEARCH", sourceKey: `web:rumour-${TS}` },
        verificationStatus: "AI_EXTRACTED",
        confidence: "LOW",
      }),
    );
    ok(ai.record.verificationStatus === "AI_EXTRACTED", "T4-DB-06 AI 检索产物落地即 AI_EXTRACTED");
    let sysRejected = false;
    try {
      await createOrObserveAwardRecord(
        input(ORG_A, {
          source: { sourceType: "USER_ENTRY", sourceKey: `manual:impersonate-${TS}` },
          verificationStatus: "HUMAN_CONFIRMED",
        }),
      );
    } catch (e) {
      sysRejected = e instanceof AwardIntelError && e.code === "HUMAN_CONFIRM_REQUIRES_USER";
    }
    let aiRejected = false;
    try {
      const bad = input(ORG_A, { source: { sourceKey: `x-${TS}` } });
      bad.actor = { actorType: "ai", userId: null };
      await createOrObserveAwardRecord(bad);
    } catch (e) {
      aiRejected = e instanceof AwardIntelError && e.code === "AWARD_AI_WRITE_DISABLED";
    }
    ok(sysRejected && aiRejected, "T4-DB-07 system 冒充人工 / ai actor 直写 → 双双拒绝");
  }

  /* T4-DB-08/09 人工确认全链路原子性（借真实调查室行往返；结束恢复） */
  {
    const room = await db.bidIntelligenceRoom.findFirst({
      where: { orgId: { not: "" } },
      select: { id: true, summaryJson: true },
    });
    if (!room) {
      ok(false, "T4-DB-08 前置：库内无调查室行（快照异常）");
      ok(false, "T4-DB-09 前置失败");
    } else {
      const originalSj = room.summaryJson;
      const sj = ((originalSj as Record<string, unknown>) ?? {}) as Record<string, unknown>;
      // 08：同事务 canonical + 投影同时成功
      const res = await db.$transaction(async (tx) => {
        const observed = await createOrObserveAwardRecord(
          input(ORG_A, {
            actor: USER,
            award: { winnerName: "Confirmed Winner Inc", solicitationNumber: `T4DB-${TS}-C1` },
            source: { sourceType: "USER_ENTRY", sourceKey: `manual:confirm-${TS}` },
            verificationStatus: "HUMAN_CONFIRMED",
            confidence: "HIGH",
          }),
          { client: tx as unknown as AwardsDbClient },
        );
        await tx.bidIntelligenceRoom.update({
          where: { id: room.id },
          data: { summaryJson: { ...sj, __t4dbtest: `${TS}` } },
        });
        return observed;
      });
      const persisted = await db.awardRecord.findUnique({ where: { id: res.record.id } });
      const roomAfter = await db.bidIntelligenceRoom.findUnique({
        where: { id: room.id },
        select: { summaryJson: true },
      });
      const markerSet =
        ((roomAfter?.summaryJson as Record<string, unknown>) ?? {}).__t4dbtest === `${TS}`;
      ok(
        persisted?.verificationStatus === "HUMAN_CONFIRMED" &&
          persisted.confirmedById === USER.userId &&
          markerSet,
        "T4-DB-08 人工确认：canonical + 项目投影同事务成功（actor 留痕）",
      );

      // 09：canonical 写失败 → 投影不得单独成功
      let threw = false;
      try {
        await db.$transaction(async (tx) => {
          await tx.bidIntelligenceRoom.update({
            where: { id: room.id },
            data: { summaryJson: { ...sj, __t4dbtest: "SHOULD_NOT_PERSIST" } },
          });
          const failing = {
            ...(tx as unknown as AwardsDbClient),
            awardRecord: {
              ...(tx as unknown as AwardsDbClient).awardRecord,
              create: async () => {
                throw new Error("simulated canonical write failure");
              },
            },
          } as AwardsDbClient;
          await createOrObserveAwardRecord(
            input(ORG_A, {
              actor: USER,
              award: { winnerName: "Ghost Winner", solicitationNumber: null },
              source: { sourceType: "USER_ENTRY", sourceKey: `manual:ghost-${TS}` },
              verificationStatus: "HUMAN_CONFIRMED",
            }),
            { client: failing },
          );
        });
      } catch {
        threw = true;
      }
      const roomFinal = await db.bidIntelligenceRoom.findUnique({
        where: { id: room.id },
        select: { summaryJson: true },
      });
      const leaked =
        ((roomFinal?.summaryJson as Record<string, unknown>) ?? {}).__t4dbtest ===
        "SHOULD_NOT_PERSIST";
      ok(threw && !leaked, "T4-DB-09 canonical 写失败 → 项目投影一并回滚（无静默半成功）");

      // 恢复调查室原值
      await db.bidIntelligenceRoom.update({
        where: { id: room.id },
        data: { summaryJson: originalSj === null ? undefined : (originalSj as object) },
      });
    }
  }

  /* T4-DB-10 provenance 完整保留 */
  {
    const mine = await listAwardsForOrg({ orgId: ORG_A, filters: { winnerName: "ACME Foam Ltd." } });
    const ev = await getAwardEvidence({ orgId: ORG_A, awardRecordId: mine[0].id });
    ok(
      ev.length >= 1 &&
        ev[0].sourceType === "CANADABUYS_OPEN_DATA" &&
        ev[0].sourceKey === `canadabuys:T4DB-${TS}-001` &&
        ev[0].sourceUrl === "https://open.canada.ca/x" &&
        (ev[0].evidenceSnippet ?? "").includes("ACME FOAM LTD"),
      "T4-DB-10 sourceUrl/sourceKey/sourceType/evidence 全留存",
    );
  }

  /* T4-DB-11 buyer 历史查询 tenant safe */
  {
    await createOrObserveAwardRecord(
      input(ORG_B, { source: { sourceKey: `canadabuys:T4DB-${TS}-001#B` } }),
    );
    const a = await listAwardsForBuyer({ orgId: ORG_A, buyerName: "Public Works Canada" });
    const b = await listAwardsForBuyer({ orgId: ORG_B, buyerName: "Public Works Canada" });
    ok(
      a.every((r) => r.orgId === ORG_A) && b.every((r) => r.orgId === ORG_B) && a.length >= 1 && b.length === 1,
      "T4-DB-11 同名买家跨 org 查询各回各家",
    );
  }

  /* T4-DB-12 周期：样本 1/2 → UNKNOWN；≥3 → 确定性统计 */
  {
    const two = await listAwardsForOrg({ orgId: ORG_B });
    const projTwo = deriveAwardIntelligence(two);
    const twoCycle = projTwo.buyerPattern.buyers[0]?.cycle;
    ok(
      twoCycle?.status === "UNKNOWN" &&
        (twoCycle.reason ?? "").includes("INSUFFICIENT_COMPARABLE_DATA"),
      "T4-DB-12a 可比样本不足（1 条）→ 买家周期 UNKNOWN",
    );
    // 周期可比组 = 买家×范围（winner 各异，避免同 winner+buyer 弱匹配落 NEEDS_REVIEW——
    // NEEDS_REVIEW 记录按语义规则不得进入周期统计）
    for (let i = 0; i < 3; i++) {
      await createOrObserveAwardRecord(
        input(ORG_B, {
          award: {
            winnerName: `Cycle Winner ${i} Ltd`,
            solicitationNumber: `T4DB-${TS}-CY${i}`,
            awardDate: new Date(2021 + i, 3, 10),
          },
          source: { sourceKey: `canadabuys:T4DB-${TS}-CY${i}` },
        }),
      );
    }
    const rows = await listAwardsForOrg({ orgId: ORG_B });
    const proj = deriveAwardIntelligence(rows);
    const cycle = proj.buyerPattern.buyers[0]?.cycle;
    ok(
      (cycle?.sampleSize ?? 0) >= 3 &&
        cycle?.medianIntervalDays != null &&
        cycle.medianIntervalDays > 250 &&
        cycle.medianIntervalDays < 400 &&
        cycle.comparableScopeKey != null,
      "T4-DB-12b 同买家同范围样本≥3 → 确定性间隔统计（含可比组键）",
    );
  }

  /* T4-DB-13 价格：跨币种不得合并成单一 median */
  {
    await createOrObserveAwardRecord(
      input(ORG_B, {
        award: {
          winnerName: "USD Winner LLC",
          solicitationNumber: `T4DB-${TS}-USD`,
          contractAmount: 80000,
          currency: "USD",
        },
        source: { sourceKey: `canadabuys:T4DB-${TS}-USD` },
      }),
    );
    const rows = await listAwardsForOrg({ orgId: ORG_B });
    const proj = deriveAwardIntelligence(rows);
    const currencies = proj.historicalValues.byCurrency.map((g) => g.currency).sort();
    ok(
      currencies.includes("CAD") &&
        currencies.includes("USD") &&
        proj.historicalValues.byCurrency.length >= 2 &&
        proj.historicalValues.comparability === "NOT_COMPARABLE_FOR_BID",
      "T4-DB-13 CAD/USD 原始金额分组独立、标注不可对标，绝不混合 median",
    );
    ok(
      proj.comparablePricing.groups.every((g) => g.currency !== "USD" || g.sampleSize >= 3),
      "T4-DB-13b 可比价格组仅在同组样本≥3 时出现",
    );
  }

  /* T4-DB-14/15 竞争对手边界 */
  {
    const rowsA = await listAwardsForOrg({ orgId: ORG_A });
    const projA = deriveAwardIntelligence(rowsA);
    const rumourConfirmed = projA.competitorSignals.confirmed.some((c) => c.name === "Rumour Corp");
    const rumourSignal = projA.competitorSignals.signals.some((s) => s.name === "Rumour Corp");
    ok(!rumourConfirmed && rumourSignal, "T4-DB-14 web-only 提及 → 线索，不进 confirmed");
    const confirmedWinner = projA.competitorSignals.confirmed.some(
      (c) => c.name === "Confirmed Winner Inc" || c.name === "ACME Foam Ltd.",
    );
    ok(confirmedWinner, "T4-DB-15 evidence-backed 中标方 → confirmed competitor 投影可用");
  }

  await cleanup();
  const leftovers = await db.awardRecord.count({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  ok(leftovers === 0, "cleanup：合成 org 测试行全部清除");

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error("矩阵执行异常：", e instanceof Error ? e.message : e);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
