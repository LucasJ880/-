/**
 * T4 — canonical AwardRecord service + read model 纯测（注入内存 fake DB，零真实连接）
 * 运行：npx tsx src/lib/tender-intel/__tests__/awards.test.ts
 * 覆盖任务书 §29 T4-01..T4-10。
 */
import {
  createOrObserveAwardRecord,
  confirmAwardRecord,
  retractAwardRecord,
  listAwardsForOrg,
  listAwardsForBuyer,
  getAwardEvidence,
  AwardIntelError,
  isDistinctSolicitation,
  normalizeSolicitationKey,
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
        // 给了简单的 orderBy（{ 字段: "asc" | "desc" }）就照它排（与真实 DB 同）；没给时按日期、建档新到旧——
        // 相当于真实 DB 不保证的顺序，写入服务不写 orderBy 时结果会和写了不一样（T4-01i 靠这个抓「疑似原记录」不确定）
        const orderBy = (Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : []) as Array<Record<string, unknown>>;
        const simple = orderBy.length > 0 && orderBy.every((o) => Object.values(o).every((d) => d === "asc" || d === "desc"));
        out = [...out].sort((a, b) => {
          if (simple) {
            for (const o of orderBy) {
              for (const [k, d] of Object.entries(o)) {
                const av = (a as unknown as Record<string, unknown>)[k];
                const bv = (b as unknown as Record<string, unknown>)[k];
                const x = av instanceof Date ? av.getTime() : String(av);
                const y = bv instanceof Date ? bv.getTime() : String(bv);
                if (x !== y) return (x < y ? -1 : 1) * (d === "desc" ? -1 : 1);
              }
            }
            return 0;
          }
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

  /* T4-01d 同 winner+buyer、两条都有招标编号且不同 → 另一次招标，正常 ACTIVE（P2-0c） */
  {
    const { client, records } = makeFakeDb();
    await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const next = canadabuysInput("orgA", {
      solicitationNumber: "PW-2025-014",
      awardDate: new Date("2025-05-03"),
      contractAmount: 131000,
    });
    next.source.sourceKey = "canadabuys:PW-2025-014";
    const r = await createOrObserveAwardRecord(next, { client });
    ok(
      r.outcome === "CREATED" &&
        records.length === 2 &&
        r.record.status === "ACTIVE" &&
        r.record.possibleDuplicateOfId === null,
      "T4-01d 不同招标编号 → 第二条 ACTIVE，不判疑似重复",
    );
  }

  /* T4-01e 编号只差大小写 / 空格 / 标点 → 仍判疑似重复（不自动当成另一次招标） */
  {
    const { client, records } = makeFakeDb();
    await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const same = canadabuysInput("orgA", {
      solicitationNumber: "pw 2024 001",
      awardDate: new Date("2024-06-01"),
      contractAmount: 99000,
    });
    same.source.sourceKey = "web:pw-2024-001-copy";
    same.source.sourceType = "WEB_SEARCH";
    same.verificationStatus = "AI_EXTRACTED";
    const r = await createOrObserveAwardRecord(same, { client });
    ok(
      r.outcome === "NEEDS_REVIEW" && r.record.possibleDuplicateOfId === records[0].id,
      "T4-01e 编号写法不同（规范化后相同）→ NEEDS_REVIEW",
    );
  }

  /* T4-01f 既有记录没编号、新记录有编号 → 无法区分，仍判疑似重复 */
  {
    const { client } = makeFakeDb();
    const first = canadabuysInput("orgA", { solicitationNumber: null });
    first.source.sourceType = "WEB_SEARCH";
    first.source.sourceKey = "web:no-number";
    first.verificationStatus = "AI_EXTRACTED";
    await createOrObserveAwardRecord(first, { client });
    const withNo = canadabuysInput("orgA", { solicitationNumber: "PW-2026-777", awardDate: new Date("2026-02-01") });
    withNo.source.sourceKey = "canadabuys:PW-2026-777";
    const r = await createOrObserveAwardRecord(withNo, { client });
    ok(r.outcome === "NEEDS_REVIEW", "T4-01f 一方没编号 → NEEDS_REVIEW（保持原规则）");
  }

  /* T4-01h（CHAIN-1b，Lucas 2026-11-20 收紧）中标方、授标日期、金额都相同时：
     两条都有编号且规范化后不同 → 不挂上，新记录标为疑似重复指向那条（同一笔授标常有两套编号，不悄悄算两次）；
     编号缺一方或只差写法 → 照旧挂上 */
  {
    const attachTry = async (solicitationNumber: string | null, key: string, buyerNameRaw = "Other Buyer Office") => {
      const { client, records } = makeFakeDb();
      await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
      const input = canadabuysInput("orgA", { solicitationNumber, buyerNameRaw });
      input.source.sourceType = "USER_ENTRY";
      input.source.sourceKey = key;
      input.verificationStatus = "NEEDS_REVIEW";
      const r = await createOrObserveAwardRecord(input, { client });
      return { r, first: records[0], count: records.length };
    };
    const a = await attachTry("PW-2024-002", "manual:distinct");
    const aSame = await attachTry("PW-2024-002", "manual:distinct-same-buyer", canadabuysInput("orgA").award.buyerNameRaw ?? undefined);
    const b = await attachTry(null, "manual:no-number");
    const c = await attachTry("pw 2024 001", "manual:spelled");
    ok(
      a.r.outcome === "NEEDS_REVIEW" && a.count === 2 && a.r.record.status === "NEEDS_REVIEW" && a.r.record.possibleDuplicateOfId === a.first.id && a.r.record.solicitationNumber === "PW-2024-002" &&
        aSame.r.outcome === "NEEDS_REVIEW" && aSame.r.record.possibleDuplicateOfId === aSame.first.id &&
        b.r.outcome === "ATTACHED_EXISTING" && b.r.record.id === b.first.id && b.count === 1 &&
        c.r.outcome === "ATTACHED_EXISTING" && c.r.record.id === c.first.id && c.count === 1,
      "T4-01h 同中标方同日期同金额：编号不同 → 不挂上、新记录疑似重复指向那条（采购方同不同都一样）；没编号或只差写法 → 挂到既有",
      [a.r.outcome, aSame.r.outcome, b.r.outcome, c.r.outcome],
    );
  }

  /* T4-01i（CHAIN-1b 交叉验证 F4）同中标方同日期同金额的已有记录不止一条、编号都不同：
     疑似原记录总指向最早建档的那条（不随数据库返回顺序变） */
  {
    const { client } = makeFakeDb();
    const write = (n: string, buyer: string) =>
      createOrObserveAwardRecord({ ...canadabuysInput("orgA", { solicitationNumber: n, buyerNameRaw: buyer }), source: { ...canadabuysInput("orgA").source, sourceKey: `canadabuys:${n}` } }, { client });
    const first = await write("PW-2024-101", "Buyer One");
    const second = await write("PW-2024-103", "Buyer Two");
    const third = await write("PW-2024-102", "Buyer Three");
    ok(
      second.outcome === "NEEDS_REVIEW" && second.record.possibleDuplicateOfId === first.record.id &&
        third.outcome === "NEEDS_REVIEW" && third.record.possibleDuplicateOfId === first.record.id,
      "T4-01i 编号都不同的几条：新记录的疑似原记录是最早建档的那条",
      [second.record.possibleDuplicateOfId, third.record.possibleDuplicateOfId, first.record.id],
    );
  }

  /* T4-01j（CHAIN-1b 交叉验证 F1）疑似重复被人工确认的写入按编号挂上：只升信任级，状态仍待组织管理员裁决；
     不是疑似重复的照旧提升为 ACTIVE + 人工确认 */
  {
    const { client, records } = makeFakeDb();
    const e = await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const n = await createOrObserveAwardRecord(
      { ...canadabuysInput("orgA", { solicitationNumber: "PW-2024-002" }), source: { ...canadabuysInput("orgA").source, sourceType: "USER_ENTRY", sourceKey: "manual:apc:f1" }, confidence: "MEDIUM", verificationStatus: "NEEDS_REVIEW" },
      { client },
    );
    const h = await createOrObserveAwardRecord(
      { ...canadabuysInput("orgA", { solicitationNumber: "PW-2024-002" }), actor: USER, source: { ...canadabuysInput("orgA").source, sourceType: "USER_ENTRY", sourceKey: "tender-result-winner:p1" }, verificationStatus: "HUMAN_CONFIRMED" },
      { client },
    );
    const ai = await createOrObserveAwardRecord(
      { ...canadabuysInput("orgA", { winnerName: "Plain Lead Co", solicitationNumber: "PW-2024-777" }), source: { ...canadabuysInput("orgA").source, sourceType: "WEB_SEARCH", sourceKey: "web:f1" }, confidence: "LOW", verificationStatus: "AI_EXTRACTED" },
      { client },
    );
    const hAi = await createOrObserveAwardRecord(
      { ...canadabuysInput("orgA", { winnerName: "Plain Lead Co", solicitationNumber: "PW-2024-777" }), actor: USER, source: { ...canadabuysInput("orgA").source, sourceType: "USER_ENTRY", sourceKey: "tender-result-winner:p2" }, verificationStatus: "HUMAN_CONFIRMED" },
      { client },
    );
    ok(
      n.outcome === "NEEDS_REVIEW" && n.record.possibleDuplicateOfId === e.record.id &&
        h.outcome === "ATTACHED_EXISTING" && h.record.id === n.record.id && h.record.status === "NEEDS_REVIEW" && h.record.verificationStatus === "HUMAN_CONFIRMED" && h.record.confirmedById === "u1" && h.record.possibleDuplicateOfId === e.record.id &&
        records.find((r) => r.id === e.record.id)?.status === "ACTIVE" &&
        hAi.outcome === "ATTACHED_EXISTING" && hAi.record.id === ai.record.id && hAi.record.status === "ACTIVE" && hAi.record.verificationStatus === "HUMAN_CONFIRMED",
      "T4-01j 疑似重复被人工确认写入挂上：信任级升为人工确认、状态仍 NEEDS_REVIEW、仍指向原记录；不是疑似重复的照旧 ACTIVE + 人工确认",
      { n: [n.outcome, n.record.possibleDuplicateOfId], h: [h.outcome, h.record.status, h.record.verificationStatus], hAi: [hAi.outcome, hAi.record.status] },
    );
  }

  /* T4-01k（CHAIN-1b 复核 M1c）没有招标编号的「同中标方同买家」疑似重复，被人工确认的写入按日期金额挂上：
     状态仍 NEEDS_REVIEW、来源多一条（不转正与有没有编号无关） */
  {
    const { client, sources } = makeFakeDb();
    const noNumber = (date: string, amount: number, key: string) =>
      ({ ...canadabuysInput("orgA", { solicitationNumber: null, awardDate: new Date(date), contractAmount: amount }), source: { ...canadabuysInput("orgA").source, sourceType: "WEB_SEARCH" as const, sourceKey: key }, confidence: "LOW" as const, verificationStatus: "AI_EXTRACTED" as const });
    const orig = await createOrObserveAwardRecord(noNumber("2024-03-01", 50000, "web:k-orig"), { client });
    const dup = await createOrObserveAwardRecord(noNumber("2024-09-01", 64000, "web:k-dup"), { client });
    const h = await createOrObserveAwardRecord(
      { ...noNumber("2024-09-01", 64000, "tender-result-winner:pk"), actor: USER, source: { ...canadabuysInput("orgA").source, sourceType: "USER_ENTRY", sourceKey: "tender-result-winner:pk" }, confidence: "MEDIUM", verificationStatus: "HUMAN_CONFIRMED" },
      { client },
    );
    ok(
      orig.outcome === "CREATED" && dup.outcome === "NEEDS_REVIEW" && dup.record.solicitationNumber === null && dup.record.possibleDuplicateOfId === orig.record.id &&
        h.outcome === "ATTACHED_EXISTING" && h.record.id === dup.record.id && h.record.status === "NEEDS_REVIEW" && h.record.verificationStatus === "HUMAN_CONFIRMED" && h.record.possibleDuplicateOfId === orig.record.id &&
        sources.filter((s) => s.awardRecordId === dup.record.id).length === 2,
      "T4-01k 没有编号的疑似重复被人工确认写入按日期金额挂上：仍 NEEDS_REVIEW、仍指向原记录、来源 2 条",
      { dup: [dup.outcome, dup.record.possibleDuplicateOfId], h: [h.outcome, h.record.status, h.record.verificationStatus] },
    );
  }

  /* T4-01g 招标编号规范化 */
  ok(
    normalizeSolicitationKey(" pw-2024/001 ") === "PW2024001" &&
      normalizeSolicitationKey("  ") === null &&
      isDistinctSolicitation("PW-1", "pw 1") === false &&
      isDistinctSolicitation("PW-1", "PW-2") === true &&
      isDistinctSolicitation(null, "PW-2") === false,
    "T4-01g 编号规范化：大小写 / 空白 / 标点不算不同；一方为空不算不同",
  );

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
    const currencies = proj.historicalValues.byCurrency.map((g) => g.currency).sort();
    const cad = proj.historicalValues.byCurrency.find((g) => g.currency === "CAD");
    ok(
      currencies.join(",") === "CAD,USD" &&
        cad?.sampleSize === 1 &&
        cad?.median === 120000.5 &&
        !proj.historicalValues.byCurrency.some((g) => g.max === 999999) &&
        proj.historicalValues.label === "RAW_ORG_HISTORY" &&
        proj.historicalValues.comparability === "NOT_COMPARABLE_FOR_BID",
      "T4-07 原始金额：AI 排除；币种不合并；RAW_ORG_HISTORY 标注",
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
    const withScope = (d: string, i: number): AwardRecordRow =>
      ({ ...base(d, i), scopeSummary: "annual office furniture supply" }) as AwardRecordRow;
    const two = deriveAwardIntelligence([withScope("2023-01-01", 1), withScope("2024-01-05", 2)], {
      now: new Date("2026-08-14T00:00:00Z"),
    });
    const twoCycle = two.buyerPattern.buyers[0]?.cycle;
    ok(
      twoCycle?.status === "UNKNOWN" &&
        (twoCycle.reason ?? "").includes("INSUFFICIENT_COMPARABLE_DATA") &&
        twoCycle.medianIntervalDays === null,
      "T4-08 两个可比样本 → UNKNOWN，绝不外推「每年固定采购」",
    );
    const five = deriveAwardIntelligence(
      [
        withScope("2021-01-01", 1),
        withScope("2022-01-10", 2),
        withScope("2023-01-05", 3),
        withScope("2024-01-08", 4),
        withScope("2025-01-03", 5),
      ],
      { now: new Date("2026-08-14T00:00:00Z") },
    );
    const fiveCycle = five.buyerPattern.buyers[0]?.cycle;
    ok(
      fiveCycle?.status === "SUPPORTED" &&
        fiveCycle.sampleSize === 5 &&
        (fiveCycle.medianIntervalDays ?? 0) > 300 &&
        (fiveCycle.medianIntervalDays ?? 0) < 400,
      "T4-08 同买家同范围五个样本 → SUPPORTED + 中位间隔（确定性计算）",
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

  /* T4-11 人工撤回（P2-0d）：只改状态、留痕、幂等；撤回后不进列表、不参与去重 */
  {
    const { client, records, sources } = makeFakeDb();
    await createOrObserveAwardRecord(canadabuysInput("orgA"), { client });
    const id = records[0].id;
    let threw = "";
    try {
      await retractAwardRecord({ orgId: "orgA", actor: SYSTEM as never, awardRecordId: id, reason: "x" }, { client });
    } catch (e) {
      threw = e instanceof AwardIntelError ? e.code : String(e);
    }
    ok(threw === "RETRACT_REQUIRES_USER", "T4-11a 撤回必须是人工 user actor");
    threw = "";
    try {
      await retractAwardRecord({ orgId: "orgA", actor: USER as never, awardRecordId: id, reason: "   " }, { client });
    } catch (e) {
      threw = e instanceof AwardIntelError ? e.code : String(e);
    }
    ok(threw === "REASON_REQUIRED" && records[0].status === "ACTIVE", "T4-11b 原因必填；失败不改状态");
    threw = "";
    try {
      await retractAwardRecord({ orgId: "orgB", actor: USER as never, awardRecordId: id, reason: "wrong org" }, { client });
    } catch (e) {
      threw = e instanceof AwardIntelError ? e.code : String(e);
    }
    ok(threw === "NOT_FOUND", "T4-11c 跨组织撤回 → NOT_FOUND");

    const r1 = await retractAwardRecord(
      { orgId: "orgA", actor: USER as never, awardRecordId: id, reason: "  填错了   中标方 " },
      { client },
    );
    const retraction = (r1.record.metadata as { retraction?: Record<string, unknown> } | null)?.retraction;
    ok(
      r1.changed &&
        r1.record.status === "RETRACTED" &&
        retraction?.reason === "填错了 中标方" &&
        retraction?.byUserId === "u1" &&
        retraction?.previousStatus === "ACTIVE" &&
        retraction?.previousVerificationStatus === "SYSTEM_VERIFIED" &&
        records.length === 1 &&
        sources.length === 1,
      "T4-11d 撤回：状态 RETRACTED，原因 / 撤回人 / 撤回前状态记在 metadata；行与来源都保留",
    );
    const r2 = await retractAwardRecord({ orgId: "orgA", actor: USER as never, awardRecordId: id, reason: "again" }, { client });
    ok(!r2.changed && (r2.record.metadata as { retraction?: { reason?: string } }).retraction?.reason === "填错了 中标方", "T4-11e 再撤回幂等，不覆盖原因");
    ok((await listAwardsForOrg({ orgId: "orgA" }, { client })).length === 0, "T4-11f 撤回后不出现在组织列表");
    threw = "";
    try {
      await confirmAwardRecord({ orgId: "orgA", actor: USER as never, awardRecordId: id }, { client });
    } catch (e) {
      threw = e instanceof AwardIntelError ? e.code : String(e);
    }
    ok(threw === "RETRACTED_IMMUTABLE", "T4-11g 已撤回记录不能再确认");

    const again = canadabuysInput("orgA", { solicitationNumber: null, awardDate: new Date("2025-01-01"), contractAmount: 1 });
    again.source.sourceKey = "web:after-retract";
    again.source.sourceType = "WEB_SEARCH";
    again.verificationStatus = "AI_EXTRACTED";
    const r3 = await createOrObserveAwardRecord(again, { client });
    ok(r3.outcome === "CREATED" && r3.record.status === "ACTIVE", "T4-11h 撤回记录不参与去重（同中标方 + 同买家不再判疑似重复）");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
