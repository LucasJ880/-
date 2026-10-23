/**
 * P1-8 next_step — 纯函数 decideNextStep 表驱动测试（任务书 §1.B 表每一行一例；§4-2 … §4-6）
 * 运行：npx tsx src/lib/muse-bridge/__tests__/next-step.test.ts
 */
import assert from "node:assert/strict";
import { advisoryResponse, firstLine } from "../advisory";
import { museCommandResponseSchema } from "../contract";
import { countUnknownCriticalFacts, decideNextStep, type NextStepSnapshot } from "../next-step";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, `${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-10-25T12:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

/** 基线：分析已确认、无待批、截标还远、已有一轮询价且报价已选定、已有投标价 → idle */
function snap(o: Partial<NextStepSnapshot> = {}): NextStepSnapshot {
  return {
    projectId: "p1",
    projectName: "RCMP 战术背包",
    now: NOW,
    closeDate: "2026-11-30T00:00:00Z",
    submittedAt: null,
    analysisStatus: "APPROVED",
    unknownCriticalFacts: 0,
    mandatoryNonCompliant: 0,
    pendingApprovals: [],
    latestRound: {
      inquiryId: "inq-1",
      items: [
        { itemId: "i-A", supplierName: "A 工厂", status: "quoted", sentAt: ago(10), isSelected: true },
        { itemId: "i-B", supplierName: "B 贸易", status: "quoted", sentAt: ago(10), isSelected: false },
      ],
    },
    hasProjectQuote: true,
    prefs: { defaultSupplierIds: [], chaseAfterDays: null },
    ...o,
  };
}

/** 每个决定都要满足回复契约 */
function contract(name: string, s: NextStepSnapshot) {
  const d = decideNextStep(s);
  const res = advisoryResponse("req-next-0001", d.advisory);
  ok(`${name}：第一行 ≤ 60 字`, firstLine(res.message).length <= 60, firstLine(res.message));
  ok(`${name}：suggestedActions[0] 与 nextStep 一致`, d.advisory.nextStep
    ? JSON.stringify(res.suggestedActions[0]?.command) === JSON.stringify(d.advisory.nextStep.command)
    : !res.message.includes("下一步："));
  ok(`${name}：符合契约`, museCommandResponseSchema.safeParse(res).success);
  return d;
}

console.log("muse-bridge next_step");

/* 行 1 / §4-2 */
{
  const d = contract("行1 待批", snap({ pendingApprovals: [
    { id: "pa-late", title: "发送第 2 轮询价", createdAt: "2026-10-24T10:00:00Z" },
    { id: "pa-early", title: "补齐保险证明任务", createdAt: "2026-10-20T10:00:00Z" },
  ] }));
  ok("§4-2 有待批 → approve 且 approvalId 为最早一条", d.rule === "pending_approval" && d.advisory.nextStep?.command.intent === "approve" && (d.advisory.nextStep.command as { approvalId: string }).approvalId === "pa-early", d);
  ok("行1 结论「有 N 条等你批」", d.advisory.conclusion === "有 2 条等你批");
}

/* 行 2 */
{
  const d = contract("行2 截标临近", snap({ closeDate: "2026-10-27T12:00:00Z" }));
  ok("行2 截标 ≤3 天且未提交 → status + 备选 ask「提交清单差什么」", d.rule === "deadline_soon" && d.advisory.conclusion === "2 天后截标，还没提交" && d.advisory.nextStep?.command.intent === "status" && d.advisory.alternatives?.[0].command.intent === "ask");
  ok("行2 已提交 → 不触发", decideNextStep(snap({ closeDate: "2026-10-27T12:00:00Z", submittedAt: "2026-10-24T00:00:00Z" })).rule !== "deadline_soon");
  ok("行2 已过截标 → 不触发", decideNextStep(snap({ closeDate: "2026-10-20T00:00:00Z" })).rule !== "deadline_soon");
}

/* 行 3 / §4-3 */
{
  const d = contract("行3 无分析", snap({ analysisStatus: null }));
  ok("§4-3 无分析 run → nextStep=null，理由含「上传」", d.rule === "no_analysis" && d.advisory.nextStep === null && d.advisory.reasons.some((r) => r.includes("上传")), d);
  const f = decideNextStep(snap({ analysisStatus: "FAILED" }));
  ok("行3 run FAILED → 同样 nextStep=null，理由含「上传」", f.rule === "no_analysis" && f.advisory.nextStep === null && f.advisory.reasons[0].includes("上传"));
}

/* 行 3b（表外）：分析进行中不建议询价 */
{
  const d = contract("行3b 分析中", snap({ analysisStatus: "ANALYZING", latestRound: null }));
  ok("行3b 分析中 → nextStep=null（不建议会失败的询价）", d.rule === "analysis_running" && d.advisory.nextStep === null);
}

/* 行 4 */
{
  const d = contract("行4 关键事实缺证据", snap({ analysisStatus: "REVIEW_REQUIRED", unknownCriticalFacts: 3 }));
  ok("行4 REVIEW_REQUIRED + UNKNOWN 关键事实 → ask「哪些关键事实缺证据」", d.rule === "unknown_facts" && d.advisory.conclusion === "分析完了，3 个关键事实没证据" && d.advisory.nextStep?.command.intent === "ask");
  ok("行4 APPROVED 时不因 UNKNOWN 触发", decideNextStep(snap({ analysisStatus: "APPROVED", unknownCriticalFacts: 3 })).rule !== "unknown_facts");
}

/* 行 5 */
{
  const d = contract("行5 强制要求", snap({ mandatoryNonCompliant: 2 }));
  ok("行5 强制要求不合规 → ask「列出无法满足的强制要求」", d.rule === "mandatory_gap" && d.advisory.conclusion === "2 条强制要求当前无法满足" && (d.advisory.nextStep?.command as { question?: string }).question === "列出无法满足的强制要求");
}

/* 行 6 */
{
  const d = contract("行6 无询价", snap({ latestRound: null, hasProjectQuote: false }));
  ok("行6 无询价轮次 → rfq（无偏好时不带 supplierIds）", d.rule === "no_rfq" && d.advisory.nextStep?.command.intent === "rfq" && !("supplierIds" in d.advisory.nextStep.command));
  const p = decideNextStep(snap({ latestRound: null, prefs: { defaultSupplierIds: ["s-1", "s-2"], chaseAfterDays: null } }));
  ok("行6 有偏好 → rfq 带常用供应商，理由含「常用」", JSON.stringify((p.advisory.nextStep?.command as { supplierIds?: string[] }).supplierIds) === '["s-1","s-2"]' && p.advisory.reasons[0].includes("常用"));
  const pend = decideNextStep(snap({ latestRound: { inquiryId: "inq", items: [{ itemId: "x", supplierName: "X", status: "pending", sentAt: null, isSelected: false }] } }));
  ok("行6 轮次全 pending（草稿未发）→ 也算没问过", pend.rule === "no_rfq");
}

/* 行 7 */
{
  const items = [
    { itemId: "i-A", supplierName: "A 工厂", status: "sent", sentAt: ago(5), isSelected: false },
    { itemId: "i-B", supplierName: "B 贸易", status: "quoted", sentAt: ago(5), isSelected: false },
  ];
  const d = contract("行7 没回", snap({ latestRound: { inquiryId: "inq", items }, hasProjectQuote: false }));
  ok("行7 有家超 3 天没回 → nextStep=null，理由写 P1-7", d.rule === "no_reply" && d.advisory.conclusion === "1 家没回" && d.advisory.nextStep === null && d.advisory.reasons.some((r) => r.includes("P1-7")));
  ok("行7 偏好 chaseAfterDays=7 → 5 天没回不算", decideNextStep(snap({ latestRound: { inquiryId: "inq", items }, prefs: { defaultSupplierIds: [], chaseAfterDays: 7 } })).rule !== "no_reply");
}

/* 行 8 / §4-4 */
{
  const items = [
    { itemId: "i-A", supplierName: "A 工厂", status: "quoted", sentAt: ago(5), isSelected: false },
    { itemId: "i-B", supplierName: "B 贸易", status: "quoted", sentAt: ago(5), isSelected: false },
  ];
  const d = contract("行8 报价齐了", snap({ latestRound: { inquiryId: "inq-9", items }, hasProjectQuote: false }));
  ok("§4-4 2 家 quoted 无 isSelected → compare", d.rule === "quotes_ready" && d.advisory.nextStep?.command.intent === "compare" && (d.advisory.nextStep.command as { inquiryId?: string }).inquiryId === "inq-9");
}

/* 行 9 / §4-5 */
{
  const d = contract("行9 定价", snap({ hasProjectQuote: false }));
  ok("§4-5 有 isSelected 无 ProjectQuote → price_scenario 且 supplierItemId 正确", d.rule === "price_pending" && d.advisory.nextStep?.command.intent === "price_scenario" && (d.advisory.nextStep.command as { supplierItemId?: string }).supplierItemId === "i-A", d);
}

/* 行 10 */
{
  const d = contract("行10 其它", snap());
  ok("行10 其它 → 当前没有待办 + status", d.rule === "idle" && d.advisory.conclusion === "这个标当前没有待办" && d.advisory.nextStep?.command.intent === "status");
}

/* 优先级：命中第一条即返回 */
{
  const all = snap({
    pendingApprovals: [{ id: "pa", title: "x", createdAt: NOW }],
    closeDate: "2026-10-26T00:00:00Z",
    analysisStatus: null,
    mandatoryNonCompliant: 4,
    latestRound: null,
  });
  ok("§4-6 优先级：待批 > 截标 > 分析 > …", decideNextStep(all).rule === "pending_approval" && decideNextStep({ ...all, pendingApprovals: [] }).rule === "deadline_soon" && decideNextStep({ ...all, pendingApprovals: [], closeDate: null }).rule === "no_analysis");
  ok("§4-6 不调 LLM：同一快照两次结果完全相同", JSON.stringify(decideNextStep(all)) === JSON.stringify(decideNextStep(all)));
}

/* criticalFacts UNKNOWN 计数 */
{
  ok("UNKNOWN 关键事实计数", countUnknownCriticalFacts({ criticalFacts: { quantity: { status: "KNOWN" }, delivery: { status: "UNKNOWN" }, location: { status: "UNKNOWN", text: null }, scope: "1500 个" } }) === 2);
  ok("坏数据 → 0", countUnknownCriticalFacts(null) === 0 && countUnknownCriticalFacts({ criticalFacts: "x" }) === 0);
}

console.log(`\nmuse-bridge next-step: ${passed} passed`);
