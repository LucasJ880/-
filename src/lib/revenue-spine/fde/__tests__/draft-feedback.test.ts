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
  buildDraftSnapshot,
  existingFeedbackWhere,
  feedbackSweepWhere,
  feedbackTerminal,
  parseDraftSnapshot,
  recordInquiryDraftSnapshotSafe,
  recordInquiryReplyFeedback,
  recordInquiryReplyFeedbackSafe,
  sweepInquiryReplyFeedback,
  type DraftSnapshotInput,
  type FeedbackActionRow,
  type FeedbackDeps,
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

function deps(o: Partial<FeedbackDeps> & { action?: FeedbackActionRow | null; existing?: boolean; snapshot?: ReturnType<typeof buildDraftSnapshot> | null } = {}) {
  const created: CreateFeedbackInput[] = [];
  const d: FeedbackDeps = {
    loadAction: async () => (o.action === undefined ? row() : o.action),
    loadSnapshot: async () => (o.snapshot === undefined ? buildDraftSnapshot(snapshotInput()) : o.snapshot),
    loadBuyer: async () => BUYER,
    hasFeedback: async () => o.existing ?? false,
    createFeedback: async (input) => {
      created.push(input);
      return { id: `ev-${created.length}` };
    },
    ...o,
  };
  return { d, created };
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
    ["人工已回复作废 → 不记", { status: "failed", failureReason: "SUPERSEDED_BY_MANUAL_REPLY", decidedById: null }, null],
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
    ok(e.feedbackScope === "team_candidate" && e.skillSlug === FDE_FEEDBACK_SKILL && e.taskType === "inquiry_reply" && e.pendingActionId === "pa-1" && e.systemRecorded === true, "团队候选范围、员工键、审批 id、系统记录");
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

  console.log("补漏扫描");
  {
    const now = new Date("2026-10-26T12:00:00Z");
    const w = feedbackSweepWhere(now);
    ok(w.type === INQUIRY_REPLY_TYPE && JSON.stringify(w.status) === '{"in":["executed","rejected","failed"]}', "只看询盘回复的终态");
    ok(w.updatedAt.lte.getTime() === now.getTime() - 10 * 60_000 && w.updatedAt.gte.getTime() === now.getTime() - 7 * 86_400_000, "近 7 天、终态已超过 10 分钟");
    ok(JSON.stringify(existingFeedbackWhere(["a"])) === JSON.stringify({ skillSlug: FDE_FEEDBACK_SKILL, pendingActionId: { in: ["a"] } }), "已有事件按员工键 + 审批 id 查");
    const recorded: string[] = [];
    const res = await sweepInquiryReplyFeedback(now, {
      listCandidates: async () => ["a", "b", "c"],
      withFeedback: async () => new Set(["b"]),
      record: async (id) => {
        recorded.push(id);
        return id === "c" ? { status: "skipped", reason: "not_terminal" } : { status: "recorded", feedbackType: "approved_as_is", eventId: "e" };
      },
    });
    ok(recorded.join(",") === "a,c" && res.scanned === 3 && res.recorded === 1 && res.skipped === 1, "已有事件的跳过，其余逐个记录", { recorded, res });
  }

  console.log("常量与写入方一致");
  ok(read("src/lib/revenue-spine/fde/inbound-sales.ts").includes(`INQUIRY_REPLY_ACTION_TYPE = "${INQUIRY_REPLY_TYPE}"`), "询盘回复动作类型");
  ok(read("src/lib/revenue-spine/fde/actions.ts").includes(`FDE_EMPLOYEE_KEY = "${FDE_FEEDBACK_SKILL}"`), "员工键");

  console.log(`\nFDE 询盘回复反馈闭环: ${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
