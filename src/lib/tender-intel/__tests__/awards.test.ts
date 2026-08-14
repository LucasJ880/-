/**
 * T4 — canonical AwardRecord service + read model 纯测（注入内存 fake DB，零真实连接）
 * 运行：npx tsx src/lib/tender-intel/__tests__/awards.test.ts
 * 覆盖任务书 §29 T4-01..T4-10。
 */
import {
  createOrObserveAwardRecord,
  confirmAwardRecord,
  listAwardsForOrg,
  listAwardsForBuyer,
  getAwardEvidence,
  AwardIntelError,
  type AwardsDbClient,
  type AwardRecordRow,
  type AwardSourceRow,
  type ObserveAwardInput,
} from "../awards";
import { deriveAwardIntelligence } from "../award-intelligence";

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

/* ---------------- 内存 fake（实现 service 用到的查询语义 + 唯一约束） ---------------- */

function makeFakeDb() {
  const records: AwardRecordRow[] = [];
  const sources: AwardSourceRow[] = [];
  let seq = 0;
  const nextId = (p: string) => `${p}_${++seq}`;

  const eq = (a: unknown, b: unknown): boolean => {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return a === b;
  };
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      const rv = row[k];
      if (v != null && typeof v === "object" && !(v instanceof Date)) {
        const cond = v as Record<string, unknown>;
        if ("not" in cond && eq(rv, cond.not)) return false;
        if ("gte" in cond && !((rv as Date) >= (cond.gte as Date))) return false;
        if ("lte" in cond && !((rv as Date) <= (cond.lte as Date))) return false;
      } else if (!eq(rv, v)) return false;
    }
    return true;
  };

  const client: AwardsDbClient = {
    awardRecord: {
      findFirst: async (args) =>
        records.find((r) =>
          matches(r as unknown as Record<string, unknown>, (args.where ?? {}) as Record<string, unknown>),
        ) ?? null,
      findMany: async (args) => {
        let out = records.filter((r) =>
          matches(r as unknown as Record<string, unknown>, (args.where ?? {}) as Record<string, unknown>),
        );
        out = [...out].sort((a, b) => {
          const at = a.awardDate?.getTime() ?? -Infinity;
          const bt = b.awardDate?.getTime() ?? -Infinity;
          if (at !== bt) return bt - at;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
        if (typeof args.take === "number") out = out.slice(0, args.take);
        return out;
      },
      create: async ({ data }) => {
        const row = {
          id: nextId("aw"),
          metadata: null,
          possibleDuplicateOfId: null,
          confirmedById: null,
          confirmedAt: null,
          createdAt: new Date(2026, 0, 1, 0, 0, seq),
          updatedAt: new Date(2026, 0, 1, 0, 0, seq),
          ...data,
        } as AwardRecordRow;
        records.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = records.find((r) => r.id === where.id);
        if (!row) throw new Error("update: not found");
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    awardRecordSource: {
      findFirst: async (args) =>
        sources.find((s) =>
          matches(s as unknown as Record<string, unknown>, (args.where ?? {}) as Record<string, unknown>),
        ) ?? null,
      findMany: async (args) =>
        sources.filter((s) =>
          matches(s as unknown as Record<string, unknown>, (args.where ?? {}) as Record<string, unknown>),
        ),
      create: async ({ data }) => {
        const d = data as Record<string, unknown>;
        // 唯一约束 (orgId, sourceType, sourceKey) —— 与真实 DB 同语义
        if (
          sources.some(
            (s) =>
              s.orgId === d.orgId && s.sourceType === d.sourceType && s.sourceKey === d.sourceKey,
          )
        ) {
          throw new Error("Unique constraint failed: AwardRecordSource_orgId_sourceType_sourceKey");
        }
        const row = { id: nextId("src"), metadata: null, createdAt: new Date(), ...data } as AwardSourceRow;
        sources.push(row);
        return row;
      },
    },
  };
  return { client, records, sources };
}

const USER = { actorType: "user", userId: "u1" };
const SYSTEM = { actorType: "system", userId: null };

function canadabuysInput(orgId: string, over?: Partial<ObserveAwardInput["award"]>): ObserveAwardInput {
  return {
    orgId,
    actor: SYSTEM,
    award: {
      winnerName: "ACME Foam Ltd.",
      buyerNameRaw: "Public Works Canada",
      solicitationNumber: "PW-2024-001",
      awardDate: new Date("2024-05-01"),
      contractAmount: 120000.5,
      currency: "CAD",
      scopeSummary: "Institutional mattresses supply",
      ...over,
    },
    source: {
      sourceType: "CANADABUYS_OPEN_DATA",
      sourceKey: "canadabuys:PW-2024-001",
      sourceUrl: "https://open.canada.ca/x",
      evidenceSnippet: "ACME FOAM LTD | 120,000.50 | 2024-05-01",
      capturedAt: new Date("2026-08-14T00:00:00Z"),
    },
    confidence: "HIGH",
    verificationStatus: "SYSTEM_VERIFIED",
  };
}

console.log("tender-intel awards（T4 canonical service + read model）");
(async () => {
  /* T4-01 同一公开 award 重放 → 恰一条 canonical 观察（幂等） */
  {
    const { client, records, sources } = makeFakeDb();
    const r1 = await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const r2 = await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    ok(
      r1.outcome === "CREATED" &&
        r2.outcome === "ALREADY_OBSERVED" &&
        records.length === 1 &&
        sources.length === 1 &&
        r1.record.id === r2.record.id,
      "T4-01 同源重放幂等：1 record / 1 source",
    );
  }

  /* T4-01b 不同来源描述同一 award（solicitation+winner 强匹配）→ 挂靠同一记录，不产生垃圾重复 */
  {
    const { client, records, sources } = makeFakeDb();
    await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const web = canadabuysInput("orgA");
    web.source = {
      sourceType: "WEB_SEARCH",
      sourceKey: "web:https://news.example/award",
      sourceUrl: "https://news.example/award",
      evidenceSnippet: "ACME wins PW-2024-001",
      capturedAt: new Date("2026-08-14T01:00:00Z"),
    };
    web.verificationStatus = "AI_EXTRACTED";
    web.confidence = "MEDIUM";
    const r = await createOrObserveAwardRecord(web, { client });
    ok(
      r.outcome === "ATTACHED_EXISTING" && records.length === 1 && sources.length === 2,
      "T4-01b 异源强匹配 → 同一 AwardRecord + 双 provenance",
    );
    ok(
      records[0].verificationStatus === "SYSTEM_VERIFIED",
      "T4-01b AI_EXTRACTED 挂靠不降级既有 SYSTEM_VERIFIED",
    );
  }

  /* T4-01c 确定性弱信号（同 winner+buyer、日期对不上）→ NEEDS_REVIEW，绝不 fuzzy merge */
  {
    const { client, records } = makeFakeDb();
    await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const other = canadabuysInput("orgA", {
      solicitationNumber: null,
      awardDate: new Date("2025-06-01"),
      contractAmount: 99000,
    });
    other.source.sourceKey = "canadabuys:OTHER-ROW";
    other.verificationStatus = "AI_EXTRACTED";
    other.source.sourceType = "WEB_SEARCH";
    const r = await createOrObserveAwardRecord(other, { client });
    ok(
      r.outcome === "NEEDS_REVIEW" &&
        records.length === 2 &&
        r.record.status === "NEEDS_REVIEW" &&
        r.record.possibleDuplicateOfId === records[0].id,
      "T4-01c 弱匹配 → 新记录 NEEDS_REVIEW + possibleDuplicateOfId（人工裁决）",
    );
  }

  /* T4-02 跨 org 零可见 */
  {
    const { client } = makeFakeDb();
    await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const otherOrg = await listAwardsForOrg({ orgId: "orgB" }, { client });
    ok(otherOrg.length === 0, "T4-02 跨 org list → 0");
    let threw = false;
    try {
      const mine = await listAwardsForOrg({ orgId: "orgA" }, { client });
      await getAwardEvidence({ orgId: "orgB", awardRecordId: mine[0].id }, { client });
    } catch (e) {
      threw = e instanceof AwardIntelError && e.code === "NOT_FOUND";
    }
    ok(threw, "T4-02 跨 org 取证据 → NOT_FOUND fail closed");
  }

  /* T4-03 AI 推理不能悄悄变 CONFIRMED */
  {
    const { client } = makeFakeDb();
    let aiRejected = false;
    try {
      const bad = canadabuysInput("orgA");
      bad.actor = { actorType: "ai", userId: null };
      await createOrObserveAwardRecord(bad, { client });
    } catch (e) {
      aiRejected = e instanceof AwardIntelError && e.code === "AWARD_AI_WRITE_DISABLED";
    }
    ok(aiRejected, "T4-03 ai actor 直写 → AWARD_AI_WRITE_DISABLED");

    let sysConfirmRejected = false;
    try {
      const bad = canadabuysInput("orgA");
      bad.verificationStatus = "HUMAN_CONFIRMED"; // system actor 冒充人工确认
      await createOrObserveAwardRecord(bad, { client });
    } catch (e) {
      sysConfirmRejected = e instanceof AwardIntelError && e.code === "HUMAN_CONFIRM_REQUIRES_USER";
    }
    ok(sysConfirmRejected, "T4-03 system actor 落 HUMAN_CONFIRMED → 拒绝");

    const web = canadabuysInput("orgA", { solicitationNumber: null });
    web.verificationStatus = "AI_EXTRACTED";
    web.source.sourceType = "WEB_SEARCH";
    web.source.sourceKey = "web:only-mention";
    const r = await createOrObserveAwardRecord(web, { client });
    ok(r.record.verificationStatus === "AI_EXTRACTED", "T4-03 AI 产物落地即 AI_EXTRACTED，不自动提升");

    let svRejected = false;
    try {
      const bad = canadabuysInput("orgA", { solicitationNumber: null });
      bad.source.sourceKey = "web:x2";
      bad.source.sourceType = "WEB_SEARCH";
      bad.verificationStatus = "SYSTEM_VERIFIED"; // web 来源冒充权威
      await createOrObserveAwardRecord(bad, { client });
    } catch (e) {
      svRejected =
        e instanceof AwardIntelError && e.code === "SYSTEM_VERIFIED_REQUIRES_AUTHORITATIVE_SOURCE";
    }
    ok(svRejected, "T4-03 非权威来源落 SYSTEM_VERIFIED → 拒绝");
  }

  /* T4-04 人工确认 → canonical AwardRecord（两条路径） */
  {
    const { client } = makeFakeDb();
    const seed = canadabuysInput("orgA", { solicitationNumber: null });
    seed.verificationStatus = "AI_EXTRACTED";
    seed.source.sourceType = "WEB_SEARCH";
    seed.source.sourceKey = "web:candidate";
    const created = await createOrObserveAwardRecord(seed, { client });
    const confirmed = await confirmAwardRecord(
      {
        orgId: "orgA",
        actor: USER,
        awardRecordId: created.record.id,
        patch: { contractAmount: 118000, currency: "CAD" },
      },
      { client },
    );
    ok(
      confirmed.verificationStatus === "HUMAN_CONFIRMED" &&
        confirmed.confirmedById === "u1" &&
        confirmed.confirmedAt != null &&
        confirmed.status === "ACTIVE",
      "T4-04 confirmAwardRecord → HUMAN_CONFIRMED + actor/time 留痕",
    );

    const direct = canadabuysInput("orgA", { solicitationNumber: "PW-NEW-9" });
    direct.actor = USER;
    direct.verificationStatus = "HUMAN_CONFIRMED";
    direct.source.sourceType = "USER_ENTRY";
    direct.source.sourceKey = "manual:confirm-1";
    const r2 = await createOrObserveAwardRecord(direct, { client });
    ok(
      r2.record.verificationStatus === "HUMAN_CONFIRMED" && r2.record.confirmedById === "u1",
      "T4-04 user actor 直接落 HUMAN_CONFIRMED（人工确认路径）",
    );
  }

  /* T4-05 来源 URL / 证据留存 */
  {
    const { client } = makeFakeDb();
    const created = await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const ev = await getAwardEvidence({ orgId: "orgA", awardRecordId: created.record.id }, { client });
    ok(
      ev.length === 1 &&
        ev[0].sourceUrl === "https://open.canada.ca/x" &&
        ev[0].evidenceSnippet === "ACME FOAM LTD | 120,000.50 | 2024-05-01" &&
        ev[0].sourceType === "CANADABUYS_OPEN_DATA" &&
        ev[0].capturedAt.toISOString() === "2026-08-14T00:00:00.000Z",
      "T4-05 provenance（URL/snippet/type/capturedAt）完整留存",
    );
  }

  /* T4-06 buyer 查询仅返回本 org */
  {
    const { client } = makeFakeDb();
    await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const b = canadabuysInput("orgB");
    b.source.sourceKey = "canadabuys:PW-2024-001#orgB";
    await createOrObserveAwardRecord(b, { client });
    const mine = await listAwardsForBuyer({ orgId: "orgA", buyerName: "Public Works Canada" }, { client });
    ok(
      mine.length === 1 && mine.every((r) => r.orgId === "orgA"),
      "T4-06 listAwardsForBuyer 严格 org 隔离",
    );
  }

  /* T4-07 价格投影只用 evidence-backed 记录；币种不合并 */
  {
    const rows: AwardRecordRow[] = [];
    const { client, records } = makeFakeDb();
    await createOrObserveAwardRecord(canadabuysInput("orgA"), { client }); // SYSTEM_VERIFIED 120000.5 CAD
    const ai = canadabuysInput("orgA", {
      solicitationNumber: null,
      awardDate: new Date("2023-04-01"),
      contractAmount: 999999,
    });
    ai.verificationStatus = "AI_EXTRACTED";
    ai.source.sourceType = "WEB_SEARCH";
    ai.source.sourceKey = "web:ai-price";
    ai.award.winnerName = "Rumour Corp";
    await createOrObserveAwardRecord(ai, { client });
    const usd = canadabuysInput("orgA", {
      solicitationNumber: "US-1",
      awardDate: new Date("2023-09-01"),
      contractAmount: 80000,
      currency: "USD",
    });
    usd.source.sourceKey = "canadabuys:US-1";
    usd.award.winnerName = "Other Winner Inc";
    await createOrObserveAwardRecord(usd, { client });
    rows.push(...records);
    const proj = deriveAwardIntelligence(rows, { now: new Date("2026-08-14T00:00:00Z") });
    const currencies = proj.pricingHistory.byCurrency.map((g) => g.currency).sort();
    const cad = proj.pricingHistory.byCurrency.find((g) => g.currency === "CAD");
    ok(
      currencies.join(",") === "CAD,USD" &&
        cad?.sampleSize === 1 &&
        cad?.median === 120000.5 &&
        !proj.pricingHistory.byCurrency.some((g) => g.max === 999999),
      "T4-07 价格：AI 金额被排除；CAD/USD 分组不合并",
    );
    const aiRow = proj.historicalAwards.records.find((r) => r.winnerName === "Rumour Corp");
    ok(aiRow?.contractAmount === null, "T4-07 未确认记录的金额不进入数字层");
  }

  /* T4-08 周期样本不足 → UNKNOWN；充足 → 确定性区间 */
  {
    const base = (d: string, i: number): AwardRecordRow =>
      ({
        id: "r" + i,
        orgId: "orgA",
        buyerId: null,
        buyerNameRaw: "City of X",
        buyerNameNormalized: "city of x",
        projectId: null,
        winnerName: "W",
        winnerNameNormalized: "w",
        solicitationNumber: null,
        awardDate: new Date(d),
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
      }) as AwardRecordRow;
    const two = deriveAwardIntelligence([base("2023-01-01", 1), base("2024-01-05", 2)], {
      now: new Date("2026-08-14T00:00:00Z"),
    });
    ok(
      two.procurementCycle.status === "UNKNOWN" &&
        (two.procurementCycle.reason ?? "").includes("INSUFFICIENT_SAMPLES") &&
        two.procurementCycle.medianIntervalDays === null,
      "T4-08 两个样本 → UNKNOWN，绝不外推「每年固定采购」",
    );
    const five = deriveAwardIntelligence(
      [
        base("2021-01-01", 1),
        base("2022-01-10", 2),
        base("2023-01-05", 3),
        base("2024-01-08", 4),
        base("2025-01-03", 5),
      ],
      { now: new Date("2026-08-14T00:00:00Z") },
    );
    ok(
      five.procurementCycle.status === "SUPPORTED" &&
        five.procurementCycle.sampleSize === 5 &&
        (five.procurementCycle.medianIntervalDays ?? 0) > 300 &&
        (five.procurementCycle.medianIntervalDays ?? 0) < 400,
      "T4-08 五个样本 → SUPPORTED + 中位间隔（确定性计算）",
    );
  }

  /* T4-09 web 单次提及 → 线索，不是确认竞争对手 */
  {
    const { client, records } = makeFakeDb();
    const web = canadabuysInput("orgA", { solicitationNumber: null, contractAmount: null });
    web.verificationStatus = "AI_EXTRACTED";
    web.confidence = "LOW";
    web.source.sourceType = "WEB_SEARCH";
    web.source.sourceKey = "web:mention-1";
    web.award.winnerName = "Mystery Competitor Ltd";
    await createOrObserveAwardRecord(web, { client });
    const proj = deriveAwardIntelligence(records, { now: new Date("2026-08-14T00:00:00Z") });
    ok(
      proj.competitorSignals.confirmed.length === 0 &&
        proj.competitorSignals.signals.length === 1 &&
        proj.competitorSignals.signals[0].name === "Mystery Competitor Ltd" &&
        proj.competitorSignals.status === "INFERRED",
      "T4-09 web 提及 → signals（INFERRED），confirmed 为空",
    );
  }

  /* T4-10 read model 确定性：同输入同输出 */
  {
    const { client, records } = makeFakeDb();
    await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const now = new Date("2026-08-14T00:00:00Z");
    const a = deriveAwardIntelligence(records, { now });
    const b = deriveAwardIntelligence(records, { now });
    ok(JSON.stringify(a) === JSON.stringify(b), "T4-10 同输入 → 逐字节相同投影");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
