/**
 * T4 语义门 — SEM-T4-01..08（PR #107 Final Review 整改）
 * 运行：npx tsx src/lib/tender-intel/__tests__/award-semantics.test.ts
 *
 * 锁定：
 * - 采购周期无「组织级」概念（不同买家不可共推周期）
 * - 可比性 = 买家 + 字面可比范围（确定性规则），不可比 → UNKNOWN
 * - raw history 与 comparable pricing 分离；NEEDS_REVIEW 出数字层
 * - T4 schema-ready gate：OFF = 对 T4 表零访问、确认路径走兼容策略 B
 */
import {
  materializeWinnerConfirmation,
  type AwardsDbClient,
  type AwardRecordRow,
} from "../awards";
import {
  deriveAwardIntelligence,
  normalizeScopeKey,
} from "../award-intelligence";
import { isT4AwardSchemaReadyWithEnv } from "../award-flags";

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

let seq = 0;
function row(over: Partial<AwardRecordRow>): AwardRecordRow {
  seq += 1;
  return {
    id: `r${seq}`,
    orgId: "orgA",
    buyerId: null,
    buyerNameRaw: "Buyer A",
    buyerNameNormalized: "buyer a",
    projectId: null,
    winnerName: `Winner ${seq}`,
    winnerNameNormalized: `winner ${seq}`,
    solicitationNumber: null,
    awardDate: null,
    contractAmount: null,
    currency: null,
    scopeSummary: null,
    confidence: "HIGH",
    verificationStatus: "SYSTEM_VERIFIED",
    status: "ACTIVE",
    possibleDuplicateOfId: null,
    confirmedById: null,
    confirmedAt: null,
    createdByType: "system",
    createdById: null,
    metadata: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  } as AwardRecordRow;
}

const NOW = { now: new Date("2026-08-14T00:00:00Z") };

console.log("tender-intel award-semantics（SEM-T4-01..08）");
(async () => {
  /* SEM-T4-01 三个不同买家各一条（2024/2025/2026）→ 绝不产生 ~365 天「组织周期」 */
  {
    const rows = [
      row({ buyerNameRaw: "Buyer A", buyerNameNormalized: "buyer a", awardDate: new Date("2024-03-01"), scopeSummary: "office chairs" }),
      row({ buyerNameRaw: "Buyer B", buyerNameNormalized: "buyer b", awardDate: new Date("2025-03-01"), scopeSummary: "road construction" }),
      row({ buyerNameRaw: "Buyer C", buyerNameNormalized: "buyer c", awardDate: new Date("2026-03-01"), scopeSummary: "medical supplies" }),
    ];
    const proj = deriveAwardIntelligence(rows, NOW);
    const anyMedian = proj.buyerPattern.buyers.some((b) => b.cycle.medianIntervalDays != null);
    ok(
      !("procurementCycle" in (proj as unknown as Record<string, unknown>)) &&
        !anyMedian &&
        proj.buyerPattern.buyers.every((b) => b.cycle.status === "UNKNOWN"),
      "SEM-T4-01 跨买家记录 → 无组织级周期字段，任何买家都不产生 365 天假周期",
    );
  }

  /* SEM-T4-02 同买家但范围明显不同 → NOT_COMPARABLE/INSUFFICIENT，不算周期 */
  {
    const rows = [
      row({ awardDate: new Date("2023-01-01"), scopeSummary: "office furniture supply" }),
      row({ awardDate: new Date("2024-01-01"), scopeSummary: "bridge construction works" }),
      row({ awardDate: new Date("2025-01-01"), scopeSummary: "IT consulting services" }),
    ];
    const proj = deriveAwardIntelligence(rows, NOW);
    const cycle = proj.buyerPattern.buyers[0].cycle;
    ok(
      cycle.status === "UNKNOWN" &&
        cycle.medianIntervalDays === null &&
        (cycle.reason ?? "").includes("INSUFFICIENT_COMPARABLE_DATA"),
      "SEM-T4-02 同买家异范围 → UNKNOWN（最大可比组样本不足），拒绝跨范围推周期",
    );
    const noScope = deriveAwardIntelligence(
      [
        row({ awardDate: new Date("2023-01-01"), scopeSummary: null }),
        row({ awardDate: new Date("2024-01-01"), scopeSummary: null }),
        row({ awardDate: new Date("2025-01-01"), scopeSummary: null }),
      ],
      NOW,
    );
    ok(
      noScope.buyerPattern.buyers[0].cycle.status === "UNKNOWN" &&
        (noScope.buyerPattern.buyers[0].cycle.reason ?? "").includes("NOT_COMPARABLE"),
      "SEM-T4-02b 缺范围描述 → NOT_COMPARABLE（无可比序列）",
    );
  }

  /* SEM-T4-03 同买家 + 可靠可比组（字面同范围）3 条 → 允许计算 */
  {
    const rows = [
      row({ awardDate: new Date("2022-04-01"), scopeSummary: "Office furniture and furnishings, incl parts" }),
      row({ awardDate: new Date("2023-04-05"), scopeSummary: "office furniture AND furnishings incl parts" }),
      row({ awardDate: new Date("2024-04-02"), scopeSummary: "Office furniture, and furnishings — incl parts" }),
    ];
    const proj = deriveAwardIntelligence(rows, NOW);
    const cycle = proj.buyerPattern.buyers[0].cycle;
    ok(
      cycle.sampleSize === 3 &&
        cycle.status === "LOW_CONFIDENCE" &&
        (cycle.medianIntervalDays ?? 0) > 300 &&
        (cycle.medianIntervalDays ?? 0) < 400 &&
        cycle.comparableScopeKey === normalizeScopeKey(rows[0].scopeSummary),
      "SEM-T4-03 同买家同范围（字面规范化相等）3 样本 → 计算周期（低置信标注）",
    );
  }

  /* SEM-T4-04 CAD 小额供货 + CAD 大额施工 → 不得产出可比中位价；raw history 必须标 NOT_COMPARABLE */
  {
    const rows = [
      row({ contractAmount: 10_000, currency: "CAD", scopeSummary: "small stationery supply", awardDate: new Date("2024-01-01") }),
      row({ contractAmount: 1_000_000, currency: "CAD", scopeSummary: "highway construction project", awardDate: new Date("2024-06-01") }),
    ];
    const proj = deriveAwardIntelligence(rows, NOW);
    ok(
      proj.comparablePricing.groups.length === 0 &&
        proj.comparablePricing.status === "UNKNOWN" &&
        (proj.comparablePricing.reason ?? "").includes("INSUFFICIENT_COMPARABLE_DATA"),
      "SEM-T4-04 异范围同币种 → 零可比价格组（拒绝把 1 万和 100 万折成中位数结论）",
    );
    ok(
      proj.historicalValues.label === "RAW_ORG_HISTORY" &&
        proj.historicalValues.comparability === "NOT_COMPARABLE_FOR_BID" &&
        proj.historicalValues.byCurrency[0]?.sampleSize === 2,
      "SEM-T4-04b raw history 允许汇总但强制 NOT_COMPARABLE_FOR_BID 标注",
    );
  }

  /* SEM-T4-05 同可比组同币种样本充足 → 允许可比价格统计 */
  {
    const rows = [
      row({ contractAmount: 11_000, currency: "CAD", scopeSummary: "annual mattress supply", awardDate: new Date("2022-05-01") }),
      row({ contractAmount: 12_500, currency: "CAD", scopeSummary: "Annual mattress supply", awardDate: new Date("2023-05-01") }),
      row({ contractAmount: 13_000, currency: "CAD", scopeSummary: "annual  mattress   supply", awardDate: new Date("2024-05-01") }),
    ];
    const proj = deriveAwardIntelligence(rows, NOW);
    const g = proj.comparablePricing.groups[0];
    ok(
      proj.comparablePricing.groups.length === 1 &&
        g.sampleSize === 3 &&
        g.median === 12_500 &&
        g.currency === "CAD" &&
        g.buyerName === "Buyer A",
      "SEM-T4-05 同买家×同范围×同币种 3 样本 → 可比价格统计允许",
    );
  }

  /* SEM-T4-06 NEEDS_REVIEW 记录（即使 HUMAN_CONFIRMED）→ 排除出全部权威数字层 */
  {
    const good = [
      row({ contractAmount: 11_000, currency: "CAD", scopeSummary: "annual mattress supply", awardDate: new Date("2022-05-01"), winnerName: "Clean Co", winnerNameNormalized: "clean co", verificationStatus: "HUMAN_CONFIRMED" }),
      row({ contractAmount: 12_500, currency: "CAD", scopeSummary: "annual mattress supply", awardDate: new Date("2023-05-01"), winnerName: "Clean Co", winnerNameNormalized: "clean co", verificationStatus: "HUMAN_CONFIRMED" }),
      row({ contractAmount: 13_000, currency: "CAD", scopeSummary: "annual mattress supply", awardDate: new Date("2024-05-01"), winnerName: "Clean Co", winnerNameNormalized: "clean co", verificationStatus: "HUMAN_CONFIRMED" }),
    ];
    const suspect = row({
      contractAmount: 999_999,
      currency: "CAD",
      scopeSummary: "annual mattress supply",
      awardDate: new Date("2024-08-01"),
      winnerName: "Suspect Dup Co",
      winnerNameNormalized: "suspect dup co",
      verificationStatus: "HUMAN_CONFIRMED",
      status: "NEEDS_REVIEW",
      possibleDuplicateOfId: good[2].id,
    });
    const proj = deriveAwardIntelligence([...good, suspect], NOW);
    const cycle = proj.buyerPattern.buyers[0].cycle;
    const price = proj.comparablePricing.groups[0];
    ok(
      proj.basis.authoritative === 3 &&
        proj.basis.needsReview === 1 &&
        cycle.sampleSize === 3 &&
        price.sampleSize === 3 &&
        price.max === 13_000 &&
        proj.historicalValues.byCurrency[0].sampleSize === 3 &&
        !proj.competitorSignals.confirmed.some((c) => c.name === "Suspect Dup Co") &&
        proj.competitorSignals.signals.some((s) => s.name === "Suspect Dup Co"),
      "SEM-T4-06 NEEDS_REVIEW 全面出数字层（周期/raw/可比价/确认竞争对手），仅存为线索",
    );
    const suspectRow = proj.historicalAwards.records.find((r) => r.winnerName === "Suspect Dup Co");
    ok(suspectRow?.contractAmount === null, "SEM-T4-06b NEEDS_REVIEW 行金额不被投影背书");
  }

  /* SEM-T4-07 schema-ready 默认 OFF；解析 fail-closed */
  {
    ok(
      !isT4AwardSchemaReadyWithEnv({}) &&
        !isT4AwardSchemaReadyWithEnv({ T4_AWARD_INTELLIGENCE_SCHEMA_READY: "0" }) &&
        !isT4AwardSchemaReadyWithEnv({ T4_AWARD_INTELLIGENCE_SCHEMA_READY: "garbage" }) &&
        isT4AwardSchemaReadyWithEnv({ T4_AWARD_INTELLIGENCE_SCHEMA_READY: "1" }) &&
        isT4AwardSchemaReadyWithEnv({ T4_AWARD_INTELLIGENCE_SCHEMA_READY: "true" }),
      "SEM-T4-07 T4_AWARD_INTELLIGENCE_SCHEMA_READY 默认 OFF / 非法值 OFF / 1|true ON",
    );
  }

  /* SEM-T4-08 gate OFF → 确认物化零 DB 访问（兼容策略 B）；ON → 正常 materialize */
  {
    let calls = 0;
    const counting = new Proxy(
      {},
      {
        get: () =>
          new Proxy(
            {},
            {
              get:
                () =>
                async () => {
                  calls++;
                  throw new Error("should not be called when gate OFF");
                },
            },
          ),
      },
    ) as AwardsDbClient;
    const input = {
      orgId: "orgA",
      actor: { actorType: "user", userId: "u1" },
      award: { winnerName: "Any Co" },
      source: {
        sourceType: "USER_ENTRY" as const,
        sourceKey: "manual:x",
        capturedAt: new Date("2026-08-14T00:00:00Z"),
      },
      confidence: "MEDIUM" as const,
      verificationStatus: "HUMAN_CONFIRMED" as const,
    };
    const off = await materializeWinnerConfirmation(input, { client: counting, env: {} });
    ok(
      off.materialized === false && off.reason === "SCHEMA_NOT_READY" && calls === 0,
      "SEM-T4-08 gate OFF → materialized:false + T4 表 0 次访问（策略 B）",
    );

    // ON：换成可用的内存 fake，正常走 canonical 路径
    const rows2: AwardRecordRow[] = [];
    const srcs: Array<Record<string, unknown>> = [];
    const fake: AwardsDbClient = {
      awardRecord: {
        findFirst: async () => null,
        findMany: async () => [],
        create: async ({ data }) => {
          const r = { id: "aw1", metadata: null, createdAt: new Date(), updatedAt: new Date(), ...data } as AwardRecordRow;
          rows2.push(r);
          return r;
        },
        update: async () => {
          throw new Error("no update expected");
        },
      },
      awardRecordSource: {
        findFirst: async () => null,
        findMany: async () => [],
        create: async ({ data }) => {
          srcs.push(data);
          return { id: "s1", metadata: null, createdAt: new Date(), ...data } as never;
        },
      },
    };
    const on = await materializeWinnerConfirmation(input, {
      client: fake,
      env: { T4_AWARD_INTELLIGENCE_SCHEMA_READY: "1" },
    });
    ok(
      on.materialized === true && rows2.length === 1 && srcs.length === 1 &&
        rows2[0].verificationStatus === "HUMAN_CONFIRMED",
      "SEM-T4-08b gate ON → canonical materialize 正常（HUMAN_CONFIRMED + provenance）",
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
