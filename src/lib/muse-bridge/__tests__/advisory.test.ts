/**
 * P1-8 建议式回复契约 — 每个意图至少一例：第一行 ≤ 60 字、suggestedActions[0] = nextStep、理由 ≤ 3 条
 * （§4-1 status、§4-7 ask 映射、§4-12 事件摘要在此；next_step 见 next-step.test、偏好见 prefs.test）
 * 运行：npx tsx src/lib/muse-bridge/__tests__/advisory.test.ts
 */
import assert from "node:assert/strict";
import {
  ALTERNATIVES_MAX,
  CONCLUSION_MAX,
  REASON_MAX,
  REASONS_MAX,
  advisory,
  advisoryResponse,
  firstLine,
  gateAdvisory,
  renderAdvisory,
  type Advisory,
} from "../advisory";
import { museCommandResponseSchema, type MuseCommandResponse, type MuseIntent } from "../contract";
import { analysisReadyEventInput, buildMuseEvent, quoteRecordedEventInput } from "../events-pure";
import { EMPTY_PREFS } from "../prefs-pure";
import {
  askAdvisory,
  askNoContextAdvisory,
  compareAdvisory,
  formatApprovalOutcome,
  mapNextStepHint,
  preferencesAdvisory,
  priceScenarioAdvisory,
  rfqCandidatesAdvisory,
  rfqDraftAdvisory,
  setPreferenceAdvisory,
  statusAdvisory,
  type StatusProjectRow,
} from "../router-pure";
import { buildCompareMatrix, type CompareInput } from "@/lib/tender-rfq/compare";
import { normalizeQuote } from "@/lib/tender-rfq/landed-cost";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, `${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** §1.A 单测要求：第一行 ≤ 60、suggestedActions[0] 与 nextStep 一致、理由 ≤ 3，且符合契约 */
function contract(name: string, a: Advisory, res: MuseCommandResponse = advisoryResponse("req-adv-0001", a)) {
  const v = advisory(a);
  const lines = res.message.split("\n");
  ok(`${name}：第一行 ≤ ${CONCLUSION_MAX} 字`, firstLine(res.message).length <= CONCLUSION_MAX, firstLine(res.message));
  ok(`${name}：理由 ≤ ${REASONS_MAX} 条且每条 ≤ ${REASON_MAX} 字`, lines.filter((l) => l.startsWith("· ")).length <= REASONS_MAX && v.reasons.every((r) => r.length <= REASON_MAX));
  ok(
    `${name}：suggestedActions[0] 与 nextStep 一致`,
    v.nextStep
      ? JSON.stringify(res.suggestedActions[0]?.command) === JSON.stringify(v.nextStep.command) && lines[lines.length - 1] === `下一步：${v.nextStep.label}`
      : !res.message.includes("下一步："),
  );
  ok(`${name}：符合契约`, museCommandResponseSchema.safeParse(res).success);
}

const now = new Date("2026-10-25T12:00:00Z");
const row = (o: Partial<StatusProjectRow>): StatusProjectRow => ({
  id: "p1", name: "Halifax 媒体监测服务（一个名字很长很长很长很长很长很长的标）", createdAt: "2026-10-01T00:00:00Z", tenderStatus: "pursuing",
  publicDate: null, questionCloseDate: null, closeDate: "2026-11-02T00:00:00Z", dueDate: null, distributedAt: "2026-10-02T00:00:00Z",
  dispatchedAt: null, interpretedAt: "2026-10-03T00:00:00Z", supplierInquiredAt: null, supplierQuotedAt: null, submittedAt: null,
  awardDate: null, intakeStatus: null, sourceMetadataJson: null, analysisStatus: "REVIEW_REQUIRED", pendingApprovals: 0, ...o,
});

console.log("muse-bridge advisory");

/* 构造器本身：截断而不是越界 */
{
  const v = advisory({
    conclusion: "很长的结论".repeat(30),
    reasons: ["a".repeat(200), "b", "", "c", "d"],
    nextStep: { label: "看状态", command: { intent: "status" } },
    alternatives: [1, 2, 3].map((i) => ({ label: `备选${i}`, command: { intent: "status" as const } })),
  });
  ok("advisory()：结论截到 60、理由去空截到 3 条、每条截到 80、备选截到 2", v.conclusion.length === CONCLUSION_MAX && v.reasons.length === REASONS_MAX && v.reasons[0].length === REASON_MAX && v.alternatives!.length === ALTERNATIVES_MAX);
  ok("renderAdvisory：结论 / · 理由 / 下一步 固定格式", renderAdvisory({ conclusion: "结论", reasons: ["理由一"], nextStep: { label: "看状态", command: { intent: "status" } } }) === "结论\n· 理由一\n下一步：看状态");
  ok("renderAdvisory：没有 nextStep 不出「下一步」行", renderAdvisory({ conclusion: "结论", reasons: [], nextStep: null }) === "结论");
  const gated = gateAdvisory(
    { conclusion: "x", reasons: [], nextStep: { label: "催", command: { intent: "chase", projectId: "p1" } }, alternatives: [{ label: "看状态", command: { intent: "status" } }] },
    new Set<MuseIntent>(["status"]),
  );
  ok("gateAdvisory：未放行的 nextStep → null（不拿备选顶上）", gated.nextStep === null && gated.alternatives?.length === 1);
}

/* §4-1 status */
{
  const many = statusAdvisory([row({ id: "a", name: "A 标" }), row({ id: "b", name: "B 标", pendingApprovals: 2 }), row({ id: "c", name: "C 标" }), row({ id: "d", name: "D 标" })], now);
  contract("§4-1 status（多项目）", many);
  ok("§4-1 status：nextStep 是待批最多那个标的 next_step", many.nextStep?.command.intent === "next_step" && (many.nextStep.command as { projectId: string }).projectId === "b");
  const one = statusAdvisory([row({})], now, { singleProject: true });
  contract("§4-1 status（单项目，长名字）", one);
  contract("status（无项目）", statusAdvisory([], now));
}

/* §4-7 ask */
{
  const ctx = { projectId: "p1", earliestApprovalId: "pa-1" };
  const a = askAdvisory('{"conclusion":"R-07 保险额度不满足，可能废标","reasons":["R-07 要求 CGL ≥ $5M（p.12）","资料库无对应证明"],"nextStepHint":"比价"}', ctx);
  contract("§4-7 ask", a);
  ok("§4-7 nextStepHint「比价」→ compare", a.nextStep?.command.intent === "compare");
  ok("§4-7 nextStepHint「去火星」→ nextStep=null", askAdvisory('{"conclusion":"x","reasons":[],"nextStepHint":"去火星"}', ctx).nextStep === null);
  ok("§2.1 映射表：看状态/询价/问价/定价/算价/催/批", [
    mapNextStepHint("看状态", ctx)?.command.intent, mapNextStepHint("询价", ctx)?.command.intent, mapNextStepHint("问价", ctx)?.command.intent,
    mapNextStepHint("定价", ctx)?.command.intent, mapNextStepHint("算价", ctx)?.command.intent, mapNextStepHint("催", ctx)?.command.intent,
    mapNextStepHint("批", ctx)?.command.intent,
  ].join() === "status,rfq,rfq,price_scenario,price_scenario,chase,approve");
  ok("§2.1「批」指向最早待批；没有待批 → null", (mapNextStepHint("批", ctx)?.command as { approvalId?: string }).approvalId === "pa-1" && mapNextStepHint("批", { projectId: "p1", earliestApprovalId: null }) === null);
  const fallback = askAdvisory("结论：可以投。\n依据一\n依据二", ctx);
  ok("ask：LLM 没给 JSON → 第一行当结论、nextStep=null（不猜）", fallback.conclusion === "结论：可以投。" && fallback.reasons.length === 2 && fallback.nextStep === null);
  contract("ask（无分析结果）", askNoContextAdvisory("p1", "某标"));
}

/* approve / reject */
{
  const a = formatApprovalOutcome("req-adv-0002", "approve", { ok: true, status: "executed", message: "已创建项目任务：补齐保险证明" });
  contract("approve 结果", { conclusion: "已批准", reasons: ["已创建项目任务：补齐保险证明"], nextStep: { label: "看看还有什么要批", command: { intent: "status" } } }, a);
  const r = formatApprovalOutcome("req-adv-0003", "reject", { ok: true, duplicate: true });
  ok("reject 重复 → 结论注明未重复执行", firstLine(r.message).includes("未重复执行") && r.suggestedActions[0].command.intent === "status");
}

/* rfq */
{
  contract("rfq 草稿", rfqDraftAdvisory({
    projectId: "p1", actionId: "pa-9", roundNumber: 2, replyBy: "2026-11-07", fromEmail: "project@sunnyshutter.ca",
    suppliers: [{ name: "宁波某某户外用品有限公司" }, { name: "B 贸易" }], blockedSuppliers: [{ name: "C 厂", reason: "no_email" }],
    excludedRequirements: 3, supplierSource: "explicit", incoterm: null, incotermFromPrefs: false,
  }));
  contract("rfq 候选列表", rfqCandidatesAdvisory("p1", [{ id: "s1", name: "A 工厂", contactEmail: "a@x" }, { id: "s2", name: "B 贸易", contactEmail: null }]));
}

/* compare / price_scenario */
{
  const S = { fxRates: {}, fxAsOf: null, fxSource: null, freightEstimate: null, exportInlandEstimate: null, insurancePct: null, clearanceFlatCad: null, projects: {} };
  const q = (id: string, total: number, days: number): CompareInput => {
    const quoted = { unitPrice: null, totalPrice: total, currency: "CAD", incoterm: "DDP", moq: 500, deliveryDays: days, validUntil: "2026-12-31" };
    return { itemId: id, supplierId: id, supplierName: `${id} 公司`, quoted, emailDate: new Date("2026-10-25"), mandatoryAnswers: [], normalized: normalizeQuote(quoted, { settings: S, dutyRatePct: null, quantity: 1500, now }) };
  };
  const matrix = buildCompareMatrix([q("B", 54000, 15), q("A", 50000, 30)], { closeDate: "2026-11-14", deliveryDeadline: "2026-11-14", firstTierQty: 1500, mandatoryCodes: [] });
  const c = compareAdvisory({ projectId: "p1", roundNumber: 2, matrix });
  contract("compare", c, advisoryResponse("req-adv-0004", c, { strict: true }));
  ok("compare：nextStep 按推荐那家算情景", (c.nextStep?.command as { supplierItemId?: string }).supplierItemId === "B");
  const p = priceScenarioAdvisory({
    projectId: "p1", supplierName: "B 公司", competitorPriceCad: 70000, competitorSourceZh: "人工假设",
    view: { scenarios: [{ labelZh: "跟价（= 对手价）", priceCad: 70000, ourPriceScore: 40, deltaPts: 3 }], breakEvenPriceCad: 75676, breakEvenNoteZh: "我方非价格项领先：可高于对手价至此仍总分打平", candidate: null },
  });
  contract("price_scenario", p, advisoryResponse("req-adv-0005", p, { strict: true }));
  contract("price_scenario（缺对手价）", priceScenarioAdvisory({ projectId: "p1", supplierName: "B", competitorPriceCad: null, competitorSourceZh: null, view: { scenarios: [], breakEvenPriceCad: null, breakEvenNoteZh: "", candidate: null } }));
}

/* preferences / set_preference */
{
  contract("preferences", preferencesAdvisory({ ...EMPTY_PREFS, defaultSupplierIds: ["s1"], defaultIncoterm: "DDP" }, new Map([["s1", "A 工厂"]])));
  contract("set_preference", setPreferenceAdvisory("默认贸易条款 DDP"));
}

/* §4-12 事件 */
{
  const e = buildMuseEvent(analysisReadyEventInput({
    runId: "run-1:u1", orgId: "org_1", recipientUserId: "u1", projectId: "p1",
    facts: { projectName: "Halifax 媒体监测服务（一个名字很长很长很长很长的标）", analyzedFiles: 4, uploadedFiles: 5, keyRequirements: 12, risks: 3, clarifications: 2, needsHumanReview: true },
  }));
  ok("§4-12 analysis.ready 合法", e !== null);
  ok("§4-12 analysis.ready summary 第一行 ≤ 60 字", firstLine(e!.summary).length <= CONCLUSION_MAX, e!.summary);
  ok("§4-12 analysis.ready 是「结论 + 1 条理由」", e!.summary.split("\n").length === 2 && e!.summary.split("\n")[1].startsWith("· "), e!.summary);
  ok("§4-12 analysis.ready action 非空（= next_step）", e!.action?.command.intent === "next_step");
  const qp = buildMuseEvent(quoteRecordedEventInput({ itemId: "i1", orgId: "org_1", ownerId: "u1", projectId: "p1", projectName: "P", supplierName: "A 工厂", type: "quote.parsed", missing: [], quote: { unitPrice: 42.5, currency: "CAD", deliveryDays: 35 }, now }));
  ok("quote.parsed：结论 + 1 条理由，action = compare", qp !== null && firstLine(qp.summary) === "A 工厂 报价已入表，字段齐全" && qp.action?.command.intent === "compare");
  const mf = buildMuseEvent(quoteRecordedEventInput({ itemId: "i1", orgId: "org_1", ownerId: "u1", projectId: "p1", projectName: "P", supplierName: "A 工厂", type: "missing_fields", missing: ["币种"], quote: { unitPrice: 39.8, deliveryDays: 30 }, now }));
  ok("missing_fields：结论列出缺的字段，action = next_step", mf !== null && firstLine(mf.summary) === "A 工厂 报价已入表，缺：币种" && mf.action?.command.intent === "next_step" && mf.type === "missing_fields");
}

console.log(`\nmuse-bridge advisory: ${passed} passed`);
