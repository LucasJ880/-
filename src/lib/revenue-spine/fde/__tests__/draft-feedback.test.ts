/**
 * B-1 询盘回复草稿反馈闭环：快照、终态映射、记录器、补漏扫描、接入点
 * （openspec change fde-feedback-loop，spec revenue-spine/fde-draft-feedback）
 * 运行：npx tsx src/lib/revenue-spine/fde/__tests__/draft-feedback.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHumanFeedbackEvent, type CreateFeedbackInput } from "@/lib/employee-ai/feedback-service";
import { PII_PLACEHOLDERS, draftContentHash, normalizeDraftBody } from "../draft-diff";
import {
  DRAFT_SNAPSHOT_AUDIT_ACTION,
  FDE_FEEDBACK_SKILL,
  INQUIRY_REPLY_TYPE,
  MANUAL_REPLY_REASON,
  parseSupersessionEvidence,
  buildDraftSnapshot,
  existingFeedbackWhere,
  feedbackSweepWhere,
  feedbackTerminal,
  parseDraftSnapshot,
  pickSnapshot,
  recordInquiryDraftSnapshotSafe,
  recordInquiryReplyFeedback,
  recordInquiryReplyFeedbackSafe,
  sweepInquiryReplyFeedback,
  type DraftSnapshotInput,
  type AfterRecordedContext,
  type FeedbackActionRow,
  type FeedbackDeps,
  type ManualReply,
} from "../draft-feedback";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 500)}`}`);
  }
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const BODY = [
  "Dear John,",
  "",
  "Thank you for contacting Sunny Home Deco on behalf of Acme Home Ltd. Call John Smith at +1 (416) 555-0199.",
  "",
  "To prepare an accurate quotation, could you please let us know:",
  "1. Which fabric colours do you need?",
  "",
  "Best regards,",
  "Lucas",
  "Sunny Home Deco",
].join("\n");
const BUYER = { contactName: "John Smith", companyName: "Acme Home Ltd", recipientEmail: "buyer@acme.com" };

/** 销售在外贸收件箱的人工回复：比草稿多一段 MOQ，末尾引用买家原信（B-2） */
const MANUAL_BODY = [
  "Dear John,",
  "",
  "Thank you for contacting Sunny Home Deco on behalf of Acme Home Ltd. Call John Smith at +1 (416) 555-0199.",
  "",
  "Our MOQ is 500 pcs per color.",
  "",
  "To prepare an accurate quotation, could you please let us know:",
  "1. Which fabric colours do you need?",
  "",
  "Best regards,",
  "Lucas",
  "Sunny Home Deco",
  "",
  "On Mon, Oct 26, 2026 at 9:00 AM John Smith <buyer@acme.com> wrote:",
  "> We need 3000 sets, please quote.",
].join("\n");
const MANUAL_REASON = `${"SUPERSEDED_BY_MANUAL_REPLY"} tradeMessageId=tm-1 outboundInteractionId=ix-1 triggeredBy=u-sales terminationMode=system_superseded`;

const snapshotInput = (o: Partial<DraftSnapshotInput> = {}): DraftSnapshotInput => ({
  orgId: "org-1",
  actorUserId: "u-owner",
  pendingActionId: "pa-1",
  opportunityId: "opp-1",
  followUpStep: null,
  subject: "Re: Your inquiry — Acme Home Ltd",
  body: BODY,
  language: "en",
  buyer: BUYER,
  guardrailViolations: [],
  factsUsed: [{ field: "quantity", value: "2,000 sets for John Smith" }],
  pendingInternalConfirmation: ["MOQ", "pricing"],
  templateOnly: true,
  ...o,
});

function row(o: Partial<FeedbackActionRow> = {}): FeedbackActionRow {
  return {
    id: "pa-1",
    orgId: "org-1",
    type: INQUIRY_REPLY_TYPE,
    status: "executed",
    failureReason: null,
    decidedById: "u-decider",
    approverUserId: "u-approver",
    createdById: "u-owner",
    payload: { opportunityId: "opp-1", to: "buyer@acme.com", subject: "Re: x", body: BODY, metadata: { orgId: "org-1", agentRunId: "run-9" } },
    ...o,
  };
}

function deps(
  o: Partial<FeedbackDeps> & {
    action?: FeedbackActionRow | null;
    existing?: boolean;
    snapshot?: ReturnType<typeof buildDraftSnapshot> | null;
    testInquiry?: boolean;
    manual?: ManualReply | null;
  } = {},
) {
  const created: CreateFeedbackInput[] = [];
  const after: AfterRecordedContext[] = [];
  const manualLoads: Array<[string, string]> = [];
  let locks = 0;
  const d: FeedbackDeps = {
    loadAction: async () => (o.action === undefined ? row() : o.action),
    loadManualReply: async (orgId, interactionId) => {
      manualLoads.push([orgId, interactionId]);
      return o.manual === undefined ? { content: MANUAL_BODY, source: "trade_inbox.reply" } : o.manual;
    },
    afterRecorded: async (ctx) => {
      after.push(ctx);
    },
    loadSnapshots: async () => (o.snapshot === undefined ? [buildDraftSnapshot(snapshotInput())] : o.snapshot ? [o.snapshot] : []),
    loadBuyer: async () => ({ ...BUYER, testInquiry: o.testInquiry ?? false }),
    hasFeedback: async () => o.existing ?? false,
    createFeedback: async (input) => {
      created.push(input);
      return { id: `ev-${created.length}` };
    },
    withLock: async (_id, fn) => {
      locks++;
      return fn();
    },
    ...o,
  };
  return { d, created, after, manualLoads, locks: () => locks };
}

async function main() {
  console.log("草稿快照（spec「草稿创建时留存脱敏快照」）");
  {
    const s = buildDraftSnapshot(snapshotInput());
    const json = JSON.stringify(s);
    ok(!json.includes("John Smith") && !json.includes("Acme Home Ltd") && !json.includes("555-0199") && json.includes(PII_PLACEHOLDERS.contact), "买家联系人名、公司名、电话替换为占位符（主题、正文、引用事实一起）", json.slice(0, 400));
    ok(!/\bJohn\b/.test(json), "只写名字（Dear John）也替换");
    ok(s.bodyHash === draftContentHash(normalizeDraftBody(BODY)), "哈希取替换前的归一正文：判定是否改过不受替换影响");
    ok(s.guardrail.passed && s.guardrail.violations.length === 0 && s.pendingInternalConfirmation.join(",") === "MOQ,pricing" && s.templateOnly === true, "护栏结果、待内部确认项、是否模板");
    ok(buildDraftSnapshot(snapshotInput({ body: "x".repeat(12_000) })).body.length === 10_000, "正文截断 10k（与执行器一致）");
    ok(parseDraftSnapshot(s)?.bodyHash === s.bodyHash && parseDraftSnapshot({ version: 2 }) === null && parseDraftSnapshot(null) === null, "读回快照：版本或字段不符视为没有");
    ok(parseDraftSnapshot(JSON.stringify(s))?.bodyHash === s.bodyHash && parseDraftSnapshot("not json") === null, "AuditLog.afterData 是 JSON 字符串：读回时解析（交叉审查阻塞项）");
    const other = buildDraftSnapshot(snapshotInput({ body: `${BODY}\nP.S.` }));
    ok(pickSnapshot([other, s], s.bodyHash) === s && pickSnapshot([other, s], "zzz") === other && pickSnapshot([], "x") === null, "多份快照：取正文哈希一致的，否则最早一份");
    const written: unknown[] = [];
    await recordInquiryDraftSnapshotSafe(snapshotInput(), { writeAudit: async (p) => void written.push(p) });
    const w = written[0] as { action: string; targetType: string; targetId: string; userId: string };
    ok(w.action === DRAFT_SNAPSHOT_AUDIT_ACTION && w.targetType === "pending_action" && w.targetId === "pa-1" && w.userId === "u-owner", "审计：动作、目标为该审批、操作者为负责人");
    let threw = false;
    try {
      await recordInquiryDraftSnapshotSafe(snapshotInput(), { writeAudit: async () => { throw new Error("db down"); } });
    } catch {
      threw = true;
    }
    ok(!threw, "快照写入失败不抛出（不影响审批创建与 FDE 流程）");
  }

  console.log("终态映射");
  const cases: Array<[string, Partial<FeedbackActionRow>, string | null]> = [
    ["已执行 → 批准", { status: "executed" }, "approved"],
    ["批准后执行失败 → 批准", { status: "failed", failureReason: "SMTP 550", decidedById: "u" }, "approved"],
    ["执行中（approved 占位）→ 不记", { status: "approved" }, null],
    ["人工驳回", { status: "rejected", failureReason: "不对", decidedById: "u" }, "rejected"],
    ["关联任务取消导致的驳回 → 不记", { status: "rejected", failureReason: "关联任务已取消，动作未执行", decidedById: null }, null],
    ["过期", { status: "failed", failureReason: "已过期", decidedById: null }, "expired"],
    ["人工取消 → 不记", { status: "failed", failureReason: "已取消", decidedById: "u" }, null],
    ["新来信作废 → 不记（spec 场景）", { status: "failed", failureReason: "SUPERSEDED_BY_NEWER_INBOUND;inboundInteractionId=i", decidedById: null }, null],
    ["人工已回复作废 → manual_reply（B-2）", { status: "failed", failureReason: "SUPERSEDED_BY_MANUAL_REPLY", decidedById: null }, "manual_reply"],
    ["入驻测试作废 → 不记", { status: "failed", failureReason: "SUPERSEDED_BY_ONBOARDING_TEST", decidedById: null }, null],
    ["批量准备失败 → 不记", { status: "failed", failureReason: "BATCH_PREPARE_FAILED", decidedById: "u" }, null],
    ["待审批 → 不记", { status: "pending" }, null],
  ];
  for (const [name, o, expected] of cases) {
    const r = row(o);
    ok(feedbackTerminal(r) === expected, name, feedbackTerminal(r));
  }

  console.log("记录器（spec「终态自动产生反馈事件」「驳回原因原样带入」）");
  {
    const { d, created } = deps();
    const r = await recordInquiryReplyFeedback("pa-1", d);
    const e = created[0];
    ok(r.status === "recorded" && r.feedbackType === "approved_as_is" && e.humanDecision === "accepted" && e.userId === "u-decider", "照发批准 → approved_as_is / accepted，用户为决策人（spec 场景）", { r, e });
    ok(e.feedbackScope === "team_candidate" && e.skillSlug === FDE_FEEDBACK_SKILL && e.pendingActionId === "pa-1" && e.systemRecorded === true, "团队候选范围、员工键、审批 id、系统记录");
    const miner = read("src/lib/employee-ai/practice-miner.ts");
    const learner = read("src/lib/employee-ai/preference-learner.ts");
    ok(/\/follow\|跟进\|mail\|email\|quote\/i\.test\(e\.taskType\)/.test(miner) && /follow|跟进|mail|email|quote/i.test(e.taskType) && /\/mail\|email\|跟进\|draft\/i\.test\(e\.taskType\)/.test(learner) && /mail|email|跟进|draft/i.test(e.taskType), "taskType 能被 practice-miner / preference-learner 识别为邮件类反馈", e.taskType);
    const ref = e.aiOutputRef as Record<string, unknown>;
    ok(ref.terminal === "approved" && ref.feedbackType === "approved_as_is" && ref.opportunityId === "opp-1" && ref.agentRunId === "run-9" && ref.type === "pending_action", "引用：终态、类型、商机、FDE 运行");
    ok(!("aiOutputSnapshot" in e) && !("humanEditedOutput" in e) && (e.diffSummary as { changed: boolean }).changed === false, "不传正文快照与修改结果；diff 为无修改");
  }
  {
    const { d, created } = deps({ action: row({ status: "failed", failureReason: "已过期", decidedById: null }) });
    const r = await recordInquiryReplyFeedback("pa-1", d);
    ok(r.status === "recorded" && r.feedbackType === "expired" && created[0].humanDecision === "deferred" && created[0].userId === "u-approver", "过期 → expired / deferred，用户为审批人（spec 场景）");
    const { d: d2, created: c2 } = deps({ action: row({ status: "failed", failureReason: "已过期", decidedById: null, approverUserId: null }) });
    await recordInquiryReplyFeedback("pa-1", d2);
    ok(c2[0].userId === "u-owner", "没有审批人 → 创建人");
  }
  {
    const { d, created } = deps({ action: row({ status: "rejected", failureReason: null, decidedById: "u-decider" }) });
    const r = await recordInquiryReplyFeedback("pa-1", d);
    ok(r.status === "recorded" && created[0].humanDecision === "rejected" && created[0].reasonText === null && created[0].reasonCode === null, "无备注驳回 → 原因与原因代码为空（spec 场景）");
    const { d: d2, created: c2 } = deps({ action: row({ status: "rejected", failureReason: "语气太硬，John 是老客户", decidedById: "u-decider" }) });
    await recordInquiryReplyFeedback("pa-1", d2);
    ok(c2[0].reasonText === `语气太硬，${PII_PLACEHOLDERS.contact} 是老客户`, "有备注 → 原样带入，只替换买家信息（spec 场景）", c2[0].reasonText);
  }
  {
    const edited = row({ payload: { ...(row().payload as object), body: BODY.replace("Lucas", "Lucas Jiang\nExport Manager") } });
    const { d, created } = deps({ action: edited });
    const r = await recordInquiryReplyFeedback("pa-1", d);
    const diff = created[0].diffSummary as { changed: boolean; sections: string[] };
    ok(r.status === "recorded" && r.feedbackType === "approved_edited" && created[0].humanDecision === "edited" && diff.changed && diff.sections.join(",") === "signature", "执行正文与快照不同 → approved_edited，带段落级 diff", { r, diff });
    const { d: d2, created: c2 } = deps({ snapshot: null });
    const r2 = await recordInquiryReplyFeedback("pa-1", d2);
    ok(r2.status === "recorded" && r2.feedbackType === "approved_as_is" && (c2[0].diffSummary as { noSnapshot?: boolean }).noSnapshot === true, "没有快照 → 按照发记，标无快照");
  }

  console.log("不记的情况与幂等（spec「同一审批同一终态只产一条事件」）");
  {
    const test = deps({ testInquiry: true });
    const r = await recordInquiryReplyFeedback("pa-1", test.d);
    ok(r.status === "skipped" && r.reason === "onboarding_test" && test.created.length === 0, "入驻测试询盘的草稿不产学习事件（与工作量 / SLA 同一判定）");
    // 两路同时到达：锁内先查后写，只写一条
    const store = new Set<string>();
    let chain = Promise.resolve();
    const created: string[] = [];
    const shared: Partial<FeedbackDeps> = {
      hasFeedback: async (id, terminal) => store.has(`${id}:${terminal}`),
      createFeedback: async (input) => {
        await new Promise((res) => setTimeout(res, 5));
        const ref = input.aiOutputRef as { id: string; terminal: string };
        store.add(`${ref.id}:${ref.terminal}`);
        created.push(ref.id);
        return { id: "e" };
      },
      withLock: async (_id, fn) => {
        const run = chain.then(fn);
        chain = run.then(() => undefined, () => undefined);
        return run;
      },
    };
    await Promise.all([recordInquiryReplyFeedback("pa-1", deps(shared).d), recordInquiryReplyFeedback("pa-1", deps(shared).d)]);
    ok(created.length === 1, "端口与补漏同时到达：锁内先查后写只产一条", created);
    const counted = deps();
    await recordInquiryReplyFeedback("pa-1", counted.d);
    ok(counted.locks() === 1, "写入走锁");
    const feedbackSrc = stripComments(read("src/lib/revenue-spine/fde/draft-feedback.ts"));
    ok(/tx\.\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(\$\{`fde-draft-feedback:\$\{actionId\}`\}\)\)`/.test(feedbackSrc), "生产锁：事务内 pg_advisory_xact_lock（与仓库既有模式一致）");
  }
  {
    const { d, created } = deps({ existing: true });
    const r = await recordInquiryReplyFeedback("pa-1", d);
    ok(r.status === "skipped" && r.reason === "duplicate" && created.length === 0, "已有同键事件 → 不再写（spec 场景：重复调用）");
    let seen = false;
    const { d: d2, created: c2 } = deps({ hasFeedback: async () => (seen ? true : ((seen = true), false)) });
    await recordInquiryReplyFeedback("pa-1", d2);
    await recordInquiryReplyFeedback("pa-1", d2);
    ok(c2.length === 1, "连续两次记录只产一条");
    const types = await Promise.all([
      recordInquiryReplyFeedback("x", deps({ action: null }).d),
      recordInquiryReplyFeedback("x", deps({ action: row({ type: "tender.send_rfq" }) }).d),
      recordInquiryReplyFeedback("x", deps({ action: row({ orgId: null }) }).d),
      recordInquiryReplyFeedback("x", deps({ action: row({ status: "failed", failureReason: "SUPERSEDED_BY_NEWER_INBOUND" }) }).d),
    ]);
    ok(types.map((t) => (t.status === "skipped" ? t.reason : t.status)).join(",") === "not_found,not_inquiry_reply,no_org,not_terminal", "不存在 / 非询盘回复 / 无组织 / 系统作废 → 不记", types);
  }
  {
    const loads: string[] = [];
    const r = await recordInquiryReplyFeedbackSafe("pa-x", { type: "tender.send_rfq", deps: deps({ loadAction: async (id) => (loads.push(id), null) }).d });
    ok(r?.status === "skipped" && loads.length === 0, "已知类型不是询盘回复 → 不查库");
    let threw = false;
    let res: unknown = "unset";
    try {
      res = await recordInquiryReplyFeedbackSafe("pa-1", { deps: deps({ loadAction: async () => { throw new Error("db down"); } }).d });
    } catch {
      threw = true;
    }
    ok(!threw && res === null, "记录失败不抛出、返回 null（spec 场景：记录失败不影响审批）");
  }

  console.log("事件不含买家个人信息与正文（spec 场景）");
  {
    const all: CreateFeedbackInput[] = [];
    for (const r of [row(), row({ status: "rejected", failureReason: "Call John Smith at +1 (416) 555-0199, buyer@acme.com", decidedById: "u" }), row({ status: "failed", failureReason: "已过期", decidedById: null })]) {
      const { d, created } = deps({ action: r });
      await recordInquiryReplyFeedback("pa-1", d);
      all.push(...created);
    }
    const editedRow = row({ payload: { ...(row().payload as object), body: `${BODY}\nMOQ is 500 pcs per color for Acme Home Ltd.` } });
    const { d, created } = deps({ action: editedRow });
    await recordInquiryReplyFeedback("pa-1", d);
    all.push(...created);
    const json = JSON.stringify(all);
    const leaks = ["John", "Smith", "Acme Home Ltd", "555-0199", "buyer@acme.com", "Thank you for contacting", "Which fabric colours"].filter((s) => json.includes(s));
    ok(all.length === 4 && leaks.length === 0, "四类事件序列化后不含联系人、公司、电话、收件人邮箱、正文句子", leaks);
  }

  console.log("手工反馈入口行为不变（spec 场景）");
  {
    let message = "";
    try {
      await createHumanFeedbackEvent({ orgId: "o", userId: "u", taskType: "t", humanDecision: "rejected", aiOutputRef: { type: "x", id: "y" } });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    ok(message === "拒绝操作需要选择简短原因", "不带系统记录标记、驳回无原因 → 仍然报错（校验先于数据库）", message);
    const svc = stripComments(read("src/lib/employee-ai/feedback-service.ts"));
    ok(/input\.humanDecision === "rejected" &&\s*!input\.systemRecorded &&/.test(svc), "只有系统记录才跳过驳回原因校验");
    ok(/const diffSummary =\s*input\.diffSummary \?\?/.test(svc), "给定 diff 才覆盖；缺省仍按原逻辑计算");
    ok(!stripComments(read("src/app/api/agent-feedback/route.ts")).includes("systemRecorded"), "手工入口不传系统记录标记");
  }

  console.log("人工已回复（B-2，修改后 spec「终态自动产生反馈事件」）");
  {
    const manualRow = row({ status: "failed", failureReason: MANUAL_REASON, decidedById: null });
    const { d, created, after, manualLoads } = deps({ action: manualRow });
    const r = await recordInquiryReplyFeedback("pa-1", d);
    const e = created[0];
    const ref = e?.aiOutputRef as Record<string, unknown>;
    const diff = e?.diffSummary as { sections?: string[]; capturedNumbers?: Array<{ value: number; unit: string }> };
    ok(r.status === "recorded" && r.feedbackType === "replaced_by_manual_reply" && e.humanDecision === "edited" && e.userId === "u-sales", "人工已回复 → replaced_by_manual_reply / edited，用户为发出人工回复的人（spec 场景）", { r, user: e?.userId });
    ok(ref.terminal === "manual_reply" && ref.feedbackType === "replaced_by_manual_reply", "引用里带终态与类型");
    ok(JSON.stringify(manualLoads) === JSON.stringify([["org-1", "ix-1"]]), "按组织读那次外发互动的正文", manualLoads);
    ok(diff.sections?.join(",") === "facts" && diff.capturedNumbers?.some((n) => n.value === 500 && n.unit === "pcs") === true, "diff：改动只在事实段，捕获 500 pcs；引用的买家原信不算改动", diff);
    const json = JSON.stringify(e);
    ok(!json.includes("Our MOQ is 500") && !json.includes("John") && !json.includes("Acme") && !json.includes("buyer@acme.com") && !json.includes("3000 sets"), "事件不含正文句子与买家信息", json.slice(0, 300));
    ok(after.length === 1 && after[0].feedbackType === "replaced_by_manual_reply" && after[0].principalUserId === "u-sales" && after[0].sourcePendingActionId === "pa-1" && after[0].opportunityId === "opp-1", "记录后触发商务事实提案（来源草稿 / 商机 / 创建人）", after[0]);
    ok(after[0]?.sentRaw.includes("Our MOQ is 500 pcs per color.") && !after[0]?.sentRaw.includes("3000 sets") && after[0]?.snapshotBody?.includes("{{buyer_contact}}") === true, "交给提案的是截掉引用后的原文 + 草稿快照");

    const outreach = deps({ action: manualRow, manual: { content: MANUAL_BODY, source: "trade_outreach.send" } });
    const r2 = await recordInquiryReplyFeedback("pa-1", outreach.d);
    ok(r2.status === "recorded" && outreach.after.length === 0, "开发信作废：照样记事件，但不从模板里抽商务事实");

    const noText = deps({ action: manualRow, manual: null });
    await recordInquiryReplyFeedback("pa-1", noText.d);
    const noTextDiff = noText.created[0]?.diffSummary as { noManualReply?: boolean; changed?: boolean };
    ok(noTextDiff.noManualReply === true && noTextDiff.changed === false && noText.after.length === 0, "找不到外发正文：空 diff 并注明，不起提案");

    const asIs = deps();
    await recordInquiryReplyFeedback("pa-1", asIs.d);
    ok(asIs.after.length === 0, "照发批准不触发提案（只有改稿类事件）");

    const boom = deps({ action: manualRow, afterRecorded: async () => { throw new Error("boom"); } });
    const r3 = await recordInquiryReplyFeedback("pa-1", boom.d);
    ok(r3.status === "recorded", "提案失败不影响事件记录");

    const dup = deps({ action: manualRow, existing: true });
    const r4 = await recordInquiryReplyFeedback("pa-1", dup.d);
    ok(r4.status === "skipped" && dup.after.length === 0, "已有同终态事件：不重复记，也不重复起提案");

    const tested = deps({ action: manualRow, testInquiry: true });
    ok((await recordInquiryReplyFeedback("pa-1", tested.d)).status === "skipped" && tested.after.length === 0, "入驻测试询盘：不记、不起提案");

    ok(JSON.stringify(parseSupersessionEvidence(MANUAL_REASON)) === JSON.stringify({ outboundInteractionId: "ix-1", triggeredBy: "u-sales" }), "解析作废证据");
    ok(JSON.stringify(parseSupersessionEvidence("SUPERSEDED_BY_MANUAL_REPLY triggeredBy=none")) === JSON.stringify({ outboundInteractionId: null, triggeredBy: null }) && parseSupersessionEvidence(null).triggeredBy === null, "缺证据 / triggeredBy=none → null");
    const noTrigger = deps({ action: row({ status: "failed", failureReason: "SUPERSEDED_BY_MANUAL_REPLY outboundInteractionId=ix-1 triggeredBy=none", decidedById: null }) });
    await recordInquiryReplyFeedback("pa-1", noTrigger.d);
    ok(noTrigger.created[0]?.userId === "u-approver", "没有触发人：回退到审批人");
  }

  console.log("补漏扫描");
  {
    const now = new Date("2026-10-26T12:00:00Z");
    const w = feedbackSweepWhere(now);
    const json = JSON.stringify(w.OR);
    ok(w.type === INQUIRY_REPLY_TYPE && json.includes('"status":"executed"') && json.includes('"failureReason":"已过期"') && json.includes('"startsWith":"关联任务已取消"') && json.includes('"startsWith":"BATCH_PREPARE_FAILED"') && json.includes('"startsWith":"SUPERSEDED_"') && json.includes('"failureReason":"已取消"'), "查询里就排除不会产事件的终态（取消 / 作废 / 批量失败 / 关联任务取消）", json);
    ok(w.updatedAt.lte.getTime() === now.getTime() - 10 * 60_000 && w.updatedAt.gte.getTime() === now.getTime() - 7 * 86_400_000, "近 7 天、终态已超过 10 分钟");
    ok(json.includes('{"status":"failed","failureReason":{"startsWith":"SUPERSEDED_BY_MANUAL_REPLY"}}'), "补漏也覆盖人工已回复的作废（B-2）", json);
    ok(JSON.stringify(existingFeedbackWhere(["a"])) === JSON.stringify({ skillSlug: FDE_FEEDBACK_SKILL, pendingActionId: { in: ["a"] } }), "已有事件按员工键 + 审批 id 查");
    const recorded: string[] = [];
    const res = await sweepInquiryReplyFeedback(now, {
      listCandidates: async (_now, _limit, cursor) => (cursor ? [] : ["a", "b", "c"]),
      withFeedback: async () => new Set(["b"]),
      record: async (id) => {
        recorded.push(id);
        return id === "c" ? { status: "skipped", reason: "not_terminal" } : { status: "recorded", feedbackType: "approved_as_is", eventId: "e" };
      },
    });
    ok(recorded.join(",") === "a,c" && res.scanned === 3 && res.recorded === 1 && res.skipped === 1, "已有事件的跳过，其余逐个记录", { recorded, res });
    // 分页：最早的一页全已有事件，不能让后面的漏记饿死
    const all = Array.from({ length: 450 }, (_, i) => `id${String(i).padStart(3, "0")}`);
    const cursors: Array<string | null> = [];
    const got: string[] = [];
    const paged = await sweepInquiryReplyFeedback(now, {
      listCandidates: async (_now, limit, cursor) => {
        cursors.push(cursor);
        const from = cursor ? all.indexOf(cursor) + 1 : 0;
        return all.slice(from, from + limit);
      },
      withFeedback: async (ids) => new Set(ids.filter((id) => Number(id.slice(2)) < 400)),
      record: async (id) => {
        got.push(id);
        return { status: "recorded", feedbackType: "expired", eventId: "e" };
      },
    });
    ok(got.length === 50 && got[0] === "id400" && paged.pages === 3 && JSON.stringify(cursors) === JSON.stringify([null, "id199", "id399"]), "从最早翻页：前两页都已有事件也会翻到后面的漏记", { got: got.length, first: got[0], cursors, paged });
    const capped = await sweepInquiryReplyFeedback(now, {
      listCandidates: async (_now, limit, cursor) => {
        const from = cursor ? all.indexOf(cursor) + 1 : 0;
        return all.slice(from, from + limit);
      },
      withFeedback: async () => new Set(),
      record: async () => ({ status: "recorded", feedbackType: "expired", eventId: "e" }),
    });
    ok(capped.recorded === 100, "每轮最多处理 100 条", capped);
  }

  console.log("接入点（spec「接入点覆盖全部审批入口并有补漏」）");
  {
    const port = stripComments(read("src/lib/approval/port.ts"));
    const helper = port.slice(port.indexOf("async function recordFdeDraftFeedback"), port.indexOf("export async function approveApprovalItem"));
    ok(/if \(type && type !== INQUIRY_REPLY_ACTION\) return;/.test(helper) && /try \{[\s\S]*recordInquiryReplyFeedbackSafe\(actionId, \{ type \}\)[\s\S]*\} catch/.test(helper), "端口钩子：非询盘回复不加载、包在异常保护里");
    const approve = port.slice(port.indexOf("export async function approveApprovalItem"), port.indexOf("export async function rejectApprovalItem"));
    const reject = port.slice(port.indexOf("export async function rejectApprovalItem"), port.indexOf("export async function expireOverdueApprovals"));
    for (const [name, fn, call] of [["批准", approve, "executePendingAction("], ["驳回", reject, "rejectPendingAction("]] as const) {
      const hook = fn.indexOf("recordFdeDraftFeedback(");
      const lastDuplicate = fn.lastIndexOf("duplicate: true");
      ok(hook !== -1 && fn.split("recordFdeDraftFeedback(").length === 2, `${name}：恰好一处调用`);
      ok(hook > fn.indexOf(call) && hook > lastDuplicate, `${name}：在执行之后、所有重复 / 已终态分支之后（重复请求不调用，spec 场景）`);
    }
    ok(/if \(before && after && after\.status !== before\.status\) await recordFdeDraftFeedback\(id, before\.type\);/.test(approve), "批准：只在本次调用确实改变了状态时记（无权 / 隔离 / 跨组织不记）");
    ok(/if \(result\.ok\) await recordFdeDraftFeedback\(id, before\?\.type\);/.test(reject), "驳回：只在驳回真正生效时记");
    ok(/select: \{ agentRunId: true, orgId: true, status: true, type: true \}/.test(reject), "驳回前读出类型，非询盘回复不加载模块");
    const expire = port.slice(port.indexOf("export async function expireOverdueApprovals"));
    ok(/for \(const row of expiredWinners\) \{\s*if \(row\.type === INQUIRY_REPLY_ACTION\) await recordFdeDraftFeedback\(row\.id, row\.type\);/.test(expire), "过期：只对本轮赢家调用");
    ok(expire.indexOf("recordFdeDraftFeedback(") > expire.indexOf("reconcileWorkforceRunsAfterApprovalExpiry(expiredWinners)"), "过期：放在 run 收敛之后");
    ok(/select: \{ id: true, orgId: true, agentRunId: true, type: true \}/.test(expire), "过期候选带类型");

    const inbound = stripComments(read("src/lib/revenue-spine/fde/inbound-sales.ts"));
    const snap = inbound.indexOf("await recordInquiryDraftSnapshotSafe(");
    ok(snap !== -1 && inbound.split("recordInquiryDraftSnapshotSafe(").length === 2, "首封回复：一处写快照");
    ok(/if \(draftCreated && pendingActionId\) \{\s*await recordInquiryDraftSnapshotSafe\(/.test(inbound) && /draftCreated = !openDraft && !!pendingActionId;/.test(inbound), "首封回复：只在新建（非复用）时写快照（spec 场景）");
    ok(/buyer: \{ contactName: draftInput\.contactName, companyName: opp\.customer\.name, recipientEmail: opp\.customer\.email \}/.test(inbound), "首封回复：买家信息传给替换");
    const follow = stripComments(read("src/lib/revenue-spine/fde/no-reply-followup.ts"));
    ok(/const pendingActionId = approval\.actionIds\[0\];\s*out\.drafted \+= 1;\s*if \(pendingActionId\) \{\s*await recordInquiryDraftSnapshotSafe\(/.test(follow) && /followUpStep: due\.step/.test(follow), "跟进草稿：新建后写快照，带第几次跟进");
    const route = stripComments(read("src/app/api/cron/approval-timeout/route.ts"));
    ok(/try \{[\s\S]*sweepInquiryReplyFeedback\(now\)[\s\S]*\} catch/.test(route) && route.indexOf("sweepInquiryReplyFeedback(") > route.indexOf("expireOverdueApprovals(now)"), "approval-timeout：过期之后补漏，包在异常保护里");
    const sync = stripComments(read("src/lib/trade/outbound-sync.ts"));
    const main = sync.slice(sync.indexOf("export async function syncTradeOutboundToRevenueSpine"));
    ok(/const sup = await supersedePendingInquiryReplies\(\{[\s\S]*?\}\);\s*if \(sup\.superseded\.length\) await recordManualReplyFeedback\(sup\.superseded\);/.test(main), "外贸外发同步：作废成功后为被作废的草稿记反馈（B-2）");
    const syncHelper = sync.slice(sync.indexOf("async function recordManualReplyFeedback"), sync.indexOf("export async function syncTradeOutboundToRevenueSpine"));
    ok(/try \{\s*const \{ recordInquiryReplyFeedbackSafe \} = await import\("@\/lib\/revenue-spine\/fde\/draft-feedback"\);[\s\S]*recordInquiryReplyFeedbackSafe\(id, \{ type: INQUIRY_REPLY_ACTION_TYPE \}\)[\s\S]*\} catch/.test(syncHelper), "外贸外发同步：动态导入、包在异常保护里（不影响外发同步结果）");
    const vercel = read("vercel.json");
    ok(!/feedback/i.test(vercel) && (vercel.match(/"path":/g) ?? []).length === 23, "不新增定时任务（vercel.json 仍是 23 条 cron）");
  }

  console.log("常量与写入方一致");
  ok(read("src/lib/revenue-spine/fde/inbound-sales.ts").includes(`INQUIRY_REPLY_ACTION_TYPE = "${INQUIRY_REPLY_TYPE}"`), "询盘回复动作类型");
  ok(read("src/lib/revenue-spine/fde/actions.ts").includes(`FDE_EMPLOYEE_KEY = "${FDE_FEEDBACK_SKILL}"`), "员工键");
  ok(read("src/lib/trade/outbound-sync.ts").includes(`SUPERSEDED_BY_MANUAL_REPLY = "${MANUAL_REPLY_REASON}"`), "人工已回复作废原因（B-2）");

  console.log(`\nFDE 询盘回复反馈闭环: ${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
