/**
 * Revenue Spine — 评分校准读模型与接口（B-4）测试：假依赖，无 DB。
 *   查询条件（组织 / 窗口 / IN 列表 / 常量与源码一致）、首评选取与窗口前剔除、跨组织防御、入驻测试三种判定、
 *   QUOTE_SENT 去重、截断与分批、窗口参数、响应不含个人信息与金额、只读源码断言、路由鉴权
 * 运行：npx tsx src/lib/revenue-spine/__tests__/score-calibration-read-model.test.ts
 *
 * 公开仓库：只用虚构企业。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ONBOARDING_TEST_CLOSE_REASON, ONBOARDING_TEST_TAG, ONBOARDING_TEST_UTM_SOURCE } from "@/lib/organizations/onboarding-rules";
import { DEFAULT_REVENUE_SPINE_POLICY } from "../policy";
import { isOnboardingTestInquiry, utmSourceOf } from "../sla-metrics";
import { CALIBRATION_DIMENSIONS, type CalibrationDimensionKey } from "../score-calibration";
import {
  CALIBRATION_FDE_EMPLOYEE_KEY,
  CALIBRATION_ID_BATCH,
  CALIBRATION_INQUIRY_ACTION_TYPE,
  CALIBRATION_OUTCOME_ENTITY_TYPE,
  CALIBRATION_ROW_LIMIT,
  buildCalibrationRows,
  calibrationAssessmentWhere,
  calibrationInquiryWhere,
  calibrationOpportunityWhere,
  chunkIds,
  earlierAssessmentWhere,
  firstAssessments,
  getScoreCalibration,
  quoteSentOutcomeWhere,
  type AssessmentSource,
  type CalibrationDeps,
  type InquirySource,
  type OpportunitySource,
} from "../score-calibration-read-model";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const ORG = "org_sunny_home_deco";
const NOW = new Date("2026-10-24T12:00:00Z");
const DAY = 86_400_000;
const W = DEFAULT_REVENUE_SPINE_POLICY.scoring.weights;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

function dims(s: Partial<Record<CalibrationDimensionKey, number>>) {
  return CALIBRATION_DIMENSIONS.map(({ key, label }) => ({ key, label, score: s[key] ?? 0, max: W[key], reason: "Acme 说 MOQ 太高，联系人 John 很急" }));
}

interface World {
  assessments: AssessmentSource[];
  earlier?: string[];
  opportunities: Array<OpportunitySource & Record<string, unknown>>;
  inquiries?: InquirySource[];
  quoteSent?: string[];
  weights?: Partial<Record<string, unknown>>;
}

interface Calls {
  assessments: Array<{ orgId: string; since: Date; now: Date; limit: number }>;
  batches: Record<string, number[]>;
  orgIds: Set<string>;
}

function fakeDeps(w: World): { deps: CalibrationDeps; calls: Calls } {
  const calls: Calls = { assessments: [], batches: { earlier: [], opportunities: [], inquiries: [], quotes: [] }, orgIds: new Set() };
  const deps: CalibrationDeps = {
    now: () => NOW,
    loadWeights: async (orgId) => {
      calls.orgIds.add(orgId);
      return w.weights ?? W;
    },
    assessments: async (orgId, since, now, limit) => {
      calls.assessments.push({ orgId, since, now, limit });
      calls.orgIds.add(orgId);
      return w.assessments.slice(0, limit);
    },
    earlierAssessed: async (orgId, ids) => {
      calls.batches.earlier.push(ids.length);
      calls.orgIds.add(orgId);
      return (w.earlier ?? []).filter((id) => ids.includes(id));
    },
    opportunities: async (orgId, ids) => {
      calls.batches.opportunities.push(ids.length);
      calls.orgIds.add(orgId);
      const set = new Set(ids);
      return w.opportunities.filter((o) => set.has(o.id));
    },
    firstInquiries: async (orgId, ids) => {
      calls.batches.inquiries.push(ids.length);
      calls.orgIds.add(orgId);
      return (w.inquiries ?? []).filter((q) => q.opportunityId && ids.includes(q.opportunityId));
    },
    quoteSentOpportunities: async (orgId, ids) => {
      calls.batches.quotes.push(ids.length);
      calls.orgIds.add(orgId);
      return (w.quoteSent ?? []).filter((id) => ids.includes(id));
    },
    classifier: async () => ({ isOnboardingTestInquiry, utmSourceOf }),
  };
  return { deps, calls };
}

let seq = 0;
function assessment(opportunityId: string, at: Date, s: Partial<Record<CalibrationDimensionKey, number>> = {}, grade = "MEDIUM"): AssessmentSource {
  seq++;
  return { id: `asm_${String(seq).padStart(5, "0")}`, opportunityId, createdAt: at, grade, dimensionsJson: dims(s) };
}

function opp(id: string, stage: string, over: Partial<OpportunitySource> & Record<string, unknown> = {}): OpportunitySource & Record<string, unknown> {
  return { id, orgId: ORG, stage, lostReason: null, customer: { tags: null }, ...over };
}

const t = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

async function main() {
  console.log("\n查询条件");

  await ok("评估查询限定组织与窗口 [since, now]；窗口前查询为 createdAt < since", () => {
    const since = t(90);
    assert.deepEqual(calibrationAssessmentWhere(ORG, since, NOW), { orgId: ORG, createdAt: { gte: since, lte: NOW } });
    assert.deepEqual(earlierAssessmentWhere(ORG, ["o1"], since), { orgId: ORG, opportunityId: { in: ["o1"] }, createdAt: { lt: since } });
  });

  await ok("商机 / 询盘 / 报价结果查询均带 orgId 与 IN 列表", () => {
    assert.deepEqual(calibrationOpportunityWhere(ORG, ["o1", "o2"]), { orgId: ORG, id: { in: ["o1", "o2"] } });
    assert.deepEqual(calibrationInquiryWhere(ORG, ["o1"]), {
      orgId: ORG,
      employeeKey: "inbound_sales_fde",
      actionType: "inbound_inquiry",
      opportunityId: { in: ["o1"] },
    });
    assert.deepEqual(quoteSentOutcomeWhere(ORG, ["o1"]), {
      orgId: ORG,
      entityType: "sales_opportunity",
      outcomeType: "QUOTE_SENT",
      entityId: { in: ["o1"] },
    });
  });

  await ok("常量与源码一致：FDE 员工键、询盘行动类型、业务结果实体类型", () => {
    assert.match(read("src/lib/revenue-spine/fde/actions.ts"), new RegExp(`FDE_EMPLOYEE_KEY = "${CALIBRATION_FDE_EMPLOYEE_KEY}"`));
    assert.match(read("src/lib/revenue-spine/sla-metrics.ts"), new RegExp(`INBOUND_INQUIRY_ACTION_TYPE = "${CALIBRATION_INQUIRY_ACTION_TYPE}"`));
    assert.match(read("src/lib/revenue-spine/outcomes.ts"), new RegExp(`OUTCOME_ENTITY_TYPE = "${CALIBRATION_OUTCOME_ENTITY_TYPE}"`));
  });

  console.log("\n样本选取");

  await ok("firstAssessments：每个商机取 (createdAt, id) 最小一条", () => {
    const a = assessment("o1", t(5));
    const b = assessment("o1", t(10));
    const c1 = { ...assessment("o2", t(3)), id: "asm_b" };
    const c2 = { ...assessment("o2", t(3)), id: "asm_a" };
    const picked = firstAssessments([a, b, c1, c2]);
    assert.deepEqual(picked.map((x) => x.id).sort(), [b.id, "asm_a"].sort());
  });

  await ok("场景「多次评估取最早」：意向 3/15 → 15/15 → 15/15，按 3/15（不看好）统计", async () => {
    const { deps } = fakeDeps({
      assessments: [assessment("o1", t(20), { intent: 3 }), assessment("o1", t(10), { intent: 15 }), assessment("o1", t(2), { intent: 15 })],
      opportunities: [opp("o1", "won")],
    });
    const r = await getScoreCalibration(ORG, null, deps);
    const intent = r.dimensions.find((d) => d.key === "intent")!;
    assert.equal(r.sample.n, 1);
    assert.equal(intent.unfavorable.decided, 1);
    assert.equal(intent.favorable.decided, 0);
    assert.equal(intent.buckets.low.n, 1);
  });

  await ok("场景「窗口前已评估」：最早评估在窗口前的商机整体不进样本", async () => {
    const { deps } = fakeDeps({
      assessments: [assessment("o1", t(10)), assessment("o2", t(10))],
      earlier: ["o1"],
      opportunities: [opp("o1", "won"), opp("o2", "lost")],
    });
    const r = await getScoreCalibration(ORG, null, deps);
    assert.equal(r.sample.n, 1);
    assert.equal(r.sample.lost, 1);
    assert.equal(r.sample.won, 0);
  });

  await ok("跨组织：商机属于别的组织或不存在 → 不进样本；所有查询都用服务端组织", async () => {
    const { deps, calls } = fakeDeps({
      assessments: [assessment("o1", t(10)), assessment("o_other", t(10)), assessment("o_missing", t(10))],
      opportunities: [opp("o1", "won"), opp("o_other", "won", { orgId: "org_other" })],
    });
    const r = await getScoreCalibration(ORG, null, deps);
    assert.equal(r.sample.n, 1);
    assert.deepEqual([...calls.orgIds], [ORG]);
  });

  await ok("场景「入驻测试与不合格」：UTM / 标签 / 关闭原因三种测试判定；测试 + 不合格只计测试", async () => {
    const { deps } = fakeDeps({
      assessments: ["o_utm", "o_tag", "o_reason", "o_dq", "o_real"].map((id) => assessment(id, t(10))),
      opportunities: [
        opp("o_utm", "won"),
        opp("o_tag", "won", { customer: { tags: `vip,${ONBOARDING_TEST_TAG}` } }),
        opp("o_reason", "disqualified", { lostReason: ONBOARDING_TEST_CLOSE_REASON }),
        opp("o_dq", "disqualified", { lostReason: "individual buyer" }),
        opp("o_real", "won"),
      ],
      inquiries: [
        { opportunityId: "o_utm", inputContext: { meta: { utm: { source: ONBOARDING_TEST_UTM_SOURCE } } } },
        { opportunityId: "o_utm", inputContext: { meta: { utm: { source: "google" } } } },
      ],
    });
    const r = await getScoreCalibration(ORG, null, deps);
    assert.equal(r.sample.excludedOnboardingTest, 3);
    assert.equal(r.sample.excludedDisqualified, 1);
    assert.equal(r.sample.n, 1);
    assert.equal(r.sample.won, 1);
  });

  await ok("同一商机多条询盘行动：取第一条的 UTM（与 SLA 指标一致）", () => {
    const rows = buildCalibrationRows({
      orgId: ORG,
      firsts: [assessment("o1", t(10))],
      earlier: new Set(),
      opportunities: [opp("o1", "won")],
      inquiries: [
        { opportunityId: "o1", inputContext: { meta: { utm: { source: "google" } } } },
        { opportunityId: "o1", inputContext: { meta: { utm: { source: ONBOARDING_TEST_UTM_SOURCE } } } },
      ],
      quoteSent: new Set(),
      classifier: { isOnboardingTestInquiry, utmSourceOf },
    });
    assert.equal(rows[0].onboardingTest, false);
  });

  await ok("QUOTE_SENT 重复记录按商机去重：lost + 两条报价 → 曾报价 1", async () => {
    const { deps } = fakeDeps({
      assessments: [assessment("o1", t(10))],
      opportunities: [opp("o1", "lost")],
      quoteSent: ["o1", "o1"],
    });
    const r = await getScoreCalibration(ORG, null, deps);
    assert.equal(r.sample.quoted, 1);
    assert.equal(r.sample.lost, 1);
  });

  console.log("\n窗口、截断、分批");

  await ok("场景「窗口参数」：7 / 365 / abc / 缺省 → 30 / 180 / 90 / 90，since = now − 窗口", async () => {
    for (const [days, expected] of [["7", 30], ["365", 180], ["abc", 90], [null, 90]] as const) {
      const { deps, calls } = fakeDeps({ assessments: [], opportunities: [] });
      const r = await getScoreCalibration(ORG, days, deps);
      assert.equal(r.windowDays, expected);
      assert.equal(calls.assessments[0].since.getTime(), NOW.getTime() - expected * DAY);
      assert.equal(calls.assessments[0].now.getTime(), NOW.getTime());
    }
  });

  await ok("截断：评估读满上限 + 1 → truncated，只统计前 5000 行", async () => {
    const assessments = Array.from({ length: CALIBRATION_ROW_LIMIT + 1 }, (_, i) => assessment(`o${i}`, new Date(t(80).getTime() + i * 1000)));
    const opportunities = assessments.map((a) => opp(a.opportunityId, "lost"));
    const { deps, calls } = fakeDeps({ assessments, opportunities });
    const r = await getScoreCalibration(ORG, null, deps);
    assert.equal(calls.assessments[0].limit, CALIBRATION_ROW_LIMIT + 1);
    assert.equal(r.truncated, true);
    assert.equal(r.sample.n, CALIBRATION_ROW_LIMIT);
  });

  await ok("未触顶 → truncated = false", async () => {
    const { deps } = fakeDeps({ assessments: [assessment("o1", t(1))], opportunities: [opp("o1", "won")] });
    assert.equal((await getScoreCalibration(ORG, null, deps)).truncated, false);
  });

  await ok("IN 列表每批 ≤ 1000：2500 个商机 → 四类查询各 3 批（1000 / 1000 / 500）", async () => {
    assert.deepEqual(chunkIds(["a", "b", "c"], 2), [["a", "b"], ["c"]]);
    assert.deepEqual(chunkIds([]), []);
    const assessments = Array.from({ length: 2500 }, (_, i) => assessment(`o${i}`, t(30)));
    const { deps, calls } = fakeDeps({ assessments, opportunities: assessments.map((a) => opp(a.opportunityId, "lost")) });
    await getScoreCalibration(ORG, null, deps);
    for (const k of ["earlier", "opportunities", "inquiries", "quotes"]) assert.deepEqual(calls.batches[k], [CALIBRATION_ID_BATCH, CALIBRATION_ID_BATCH, 500]);
  });

  await ok("没有评估 → 不发 IN 查询，报告为样本不足", async () => {
    const { deps, calls } = fakeDeps({ assessments: [], opportunities: [] });
    const r = await getScoreCalibration(ORG, null, deps);
    assert.equal(r.status, "insufficient");
    assert.deepEqual(calls.batches.opportunities, []);
  });

  await ok("现有权重取自 policy（自定义权重透传）", async () => {
    const { deps } = fakeDeps({ assessments: [], opportunities: [], weights: { ...W, productFit: 30, completeness: 5 } });
    const r = await getScoreCalibration(ORG, null, deps);
    assert.equal(r.currentWeights.productFit, 30);
    assert.equal(r.currentWeights.completeness, 5);
  });

  console.log("\n不输出个人信息与金额");

  await ok("场景「响应不含个人信息」：来源行带客户名 / 邮箱 / 金额 / 标题 / 理由 → 序列化后都不出现，也不含商机 id", async () => {
    const pii = {
      title: "Acme Home Ltd 窗帘询盘",
      estimatedValue: 98765.43,
      customerName: "Acme Home Ltd",
      email: "john.smith@acme-home.example",
    };
    const assessments = Array.from({ length: 31 }, (_, i) => ({
      ...assessment(`opp_secret_${i}`, t(20), i < 16 ? { productFit: 25, intent: 15 } : { productFit: 0 }),
      reasoning: "联系人 John Smith 预算 USD 98765",
    }));
    const opportunities = assessments.map((a, i) =>
      opp(a.opportunityId, i < 16 ? "won" : "lost", { ...pii, customer: { tags: "vip", name: pii.customerName, email: pii.email } as { tags: string } }),
    );
    const { deps } = fakeDeps({ assessments, opportunities });
    const r = await getScoreCalibration(ORG, null, deps);
    assert.equal(r.status, "ok");
    const json = JSON.stringify(r);
    for (const v of [pii.title, "98765", pii.customerName, pii.email, "John", "MOQ 太高", "opp_secret_", "asm_", ORG]) {
      assert.ok(!json.includes(v), `响应包含 ${v}`);
    }
    assert.deepEqual(Object.keys(r).sort(), [
      "currentWeights",
      "dimensions",
      "generatedAt",
      "grades",
      "minDecided",
      "policySnippet",
      "sample",
      "status",
      "suggestedWeights",
      "truncated",
      "windowDays",
    ]);
  });

  await ok("生产查询只选统计所需列：读模型源码不选客户名 / 邮箱 / 金额 / 标题 / 理由", () => {
    const src = strip(read("src/lib/revenue-spine/score-calibration-read-model.ts"));
    for (const col of ["estimatedValue", "reasoning", "email", "contactName", "name: true", "title: true", "revenueImpact", "outcomeValue"]) {
      assert.ok(!src.includes(col), `读模型源码含 ${col}`);
    }
  });

  console.log("\n只读与接口");

  await ok("场景「只读」：读模型、接口与区块不调用 policy 发布与任何写方法", () => {
    const files = [
      "src/lib/revenue-spine/score-calibration.ts",
      "src/lib/revenue-spine/score-calibration-read-model.ts",
      "src/app/api/revenue/score-calibration/route.ts",
      "src/components/revenue/score-calibration-panel.tsx",
    ];
    for (const f of files) {
      assert.ok(existsSync(join(process.cwd(), f)), `缺少 ${f}`);
      const src = strip(read(f));
      assert.doesNotMatch(src, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/, `${f} 含写方法`);
      assert.doesNotMatch(src, /\$executeRaw|\$queryRaw|\$transaction/, `${f} 含原生 SQL / 事务`);
      assert.doesNotMatch(src, /publishRevenueSpineRule|logAudit|recordRevenueOutcome/, `${f} 含发布 / 审计 / 结果写入`);
      assert.doesNotMatch(src, /method:\s*["'](PUT|POST|PATCH|DELETE)["']/, `${f} 含写请求`);
      assert.doesNotMatch(src, /\/api\/revenue\/policy/, `${f} 请求 policy 接口`);
    }
  });

  await ok("路由：resolveRevenueAccess 解析组织、force-dynamic、只导出 GET、不读请求里的 orgId", () => {
    const src = strip(read("src/app/api/revenue/score-calibration/route.ts"));
    assert.match(src, /export const dynamic = "force-dynamic"/);
    assert.match(src, /const access = await resolveRevenueAccess\(request\);\s*if \(!access\.ok\) return access\.response;/);
    assert.match(src, /getScoreCalibration\(access\.orgId, request\.nextUrl\.searchParams\.get\("days"\)\)/);
    assert.doesNotMatch(src, /export (async )?function (POST|PUT|PATCH|DELETE)/);
    assert.doesNotMatch(src, /searchParams\.get\("orgId"\)|bodyOrgId/);
  });

  console.log(`\nscore-calibration-read-model: ${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
