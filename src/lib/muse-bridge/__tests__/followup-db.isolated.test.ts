/**
 * Muse Bridge 跟进引擎（TASKFLOW S3）— 真实 DB 端到端（隔离库，虚构企业）
 *
 *   创建权限 → 询问 → 回复（建议动作 = 建跟进）→ 按建议建跟进（沿用 workflowId）→ 重放不重复
 *   → 更新（权限 / 证据 / 结束后拒绝 / 通知创建人）→ 提醒扫描（到期 / 逾期两人 / 不重复 / 改期限再提醒 / 询问逾期）
 *   → 复合游标跨页 → 商机状态与账本 traceId → 证据导出
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/muse-bridge/__tests__/followup-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业与人名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 Muse 跟进 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Muse followup loop DB e2e" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : "");
  }
}

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ORG = `fx_s3_org_${stamp}`;
const MGR = `fx_s3_mgr_${stamp}`;
const REP_A = `fx_s3_rep_a_${stamp}`;
const REP_B = `fx_s3_rep_b_${stamp}`;
const HOUR = 3_600_000;

async function main() {
  process.env.MUSE_BRIDGE_ENABLED = "1";
  process.env.MUSE_BRIDGE_ORG_ALLOWLIST = ORG;
  process.env.MUSE_BRIDGE_INTENTS =
    "status,ask,approve,reject,next_step,set_preference,preferences,sales_overview,opportunity_status,ask_colleague,reply_inquiry,create_followup,update_followup";
  const { db } = await import("@/lib/db");
  const { resolveMuseBinding } = await import("../binding");
  const { handleMuseCommand } = await import("../router");
  const { listMuseEvents, parseEventCursor } = await import("../events");
  const { MUSE_BRIDGE_CONTRACT_VERSION } = await import("../contract");
  const { createFollowup, followupSelect, notifyFollowupUpdated } = await import("../followup");
  const { scanMuseReminders } = await import("../reminder-scan");
  const { collectWorkflowEvidence } = await import("../evidence");

  const now = Date.now();
  const bind = (refs: Record<string, string>) => ({
    museBridge: { bindings: Object.fromEntries(Object.entries(refs).map(([ref, userId]) => [ref, { userId, boundAt: new Date(now).toISOString(), boundBy: MGR }])) },
  });
  const users = [MGR, REP_A, REP_B];

  async function cleanup() {
    const tasks = await db.task.findMany({ where: { OR: [{ creatorId: { in: users } }, { assigneeId: { in: users } }] }, select: { id: true } });
    const taskIds = tasks.map((t) => t.id);
    await db.taskComment.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.taskActivity.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.task.deleteMany({ where: { id: { in: taskIds } } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: users } }] } });
    await db.salesAction.deleteMany({ where: { orgId: ORG } });
    await db.salesOpportunity.deleteMany({ where: { orgId: ORG } });
    await db.salesCustomer.deleteMany({ where: { orgId: ORG } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }

  try {
    await db.user.createMany({
      data: [
        { id: MGR, email: `${MGR}@fixture.test`, name: "Morgan Manager", role: "boss" },
        { id: REP_A, email: `${REP_A}@fixture.test`, name: "Avery Rep", role: "sales" },
        { id: REP_B, email: `${REP_B}@fixture.test`, name: "Blake Rep", role: "sales" },
      ],
    });
    await db.organization.create({
      data: { id: ORG, name: "S3 Fixture Shades", code: `s3-${stamp}`, ownerId: MGR, settingsJson: bind({ "muse:mgr": MGR, "muse:rep-a": REP_A, "muse:rep-b": REP_B }) },
    });
    await db.organizationMember.createMany({ data: users.map((userId) => ({ orgId: ORG, userId })) });
    const customer = await db.salesCustomer.create({ data: { orgId: ORG, name: "Northwind Interiors", createdById: MGR }, select: { id: true } });
    const opp = await db.salesOpportunity.create({
      data: { orgId: ORG, customerId: customer.id, title: "Lobby roller shades", stage: "quoted", createdById: MGR, assignedToId: REP_A },
      select: { id: true },
    });

    let seq = 0;
    const nextId = () => `req-s3-${stamp}-${++seq}`;
    async function send(museUserRef: string, command: Record<string, unknown>, requestId = nextId()) {
      const bound = await resolveMuseBinding(ORG, museUserRef);
      if (!bound.ok) throw new Error(`binding failed: ${bound.errorCode}`);
      const envelope = { contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, requestId, orgId: ORG, museUserRef, command } as Parameters<typeof handleMuseCommand>[0];
      return handleMuseCommand(envelope, bound.identity);
    }
    const events = async (userId: string, type: string) =>
      (await listMuseEvents({ userId, orgId: ORG, limit: 200 })).events.filter((e) => e.type === type);
    const future = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
    const followupCount = () => db.salesAction.count({ where: { orgId: ORG, source: "muse_followup" } });

    // ── [1] 创建权限 ──
    {
      const other = await send("muse:rep-a", { intent: "create_followup", opportunityId: opp.id, title: "x", dueAt: future(24), assigneeUserId: REP_B });
      ok(other.errorCode === "PERMISSION_DENIED", "[1] 销售给别人当负责人 → PERMISSION_DENIED", other);
      const notMine = await send("muse:rep-b", { intent: "create_followup", opportunityId: opp.id, title: "x", dueAt: future(24) });
      ok(notMine.errorCode === "OPPORTUNITY_NOT_FOUND", "[1] 销售给别人负责的商机建 → 与看不到同口径", notMine);
      const past = await send("muse:mgr", { intent: "create_followup", opportunityId: opp.id, title: "x", dueAt: future(-1) });
      ok(past.errorCode === "VALIDATION_FAILED", "[1] 期限在过去 → VALIDATION_FAILED", past);
      const outsider = await send("muse:mgr", { intent: "create_followup", opportunityId: opp.id, title: "x", dueAt: future(24), assigneeUserId: `nobody_${stamp}` });
      ok(outsider.errorCode === "VALIDATION_FAILED", "[1] 指定的负责人不是成员 → VALIDATION_FAILED", outsider);
      ok((await followupCount()) === 0, "[1] 失败的创建不建跟进");
    }

    // ── [2] 询问 → 回复 → 按建议建跟进 ──
    const ask = await send("muse:mgr", { intent: "ask_colleague", opportunityId: opp.id, questions: ["客户最近怎么说？"] });
    const inquiryId = (ask.data as { inquiryId: string }).inquiryId;
    const workflowId = (ask.data as { workflowId: string }).workflowId;
    const dueAt = future(48);
    const reply = await send("muse:rep-a", { intent: "reply_inquiry", inquiryId, nextStep: "周五电话确认样板", nextStepDueAt: dueAt });
    ok(reply.ok && (reply.data as { workflowId: string }).workflowId === workflowId, "[2] 回复成功并带回 workflowId", reply);
    const replied = (await events(MGR, "inquiry.replied"))[0];
    ok(replied?.action?.command.intent === "create_followup", "[2] inquiry.replied 的建议动作是建跟进", replied?.action);
    const createRequestId = nextId();
    const created = await send("muse:mgr", replied!.action!.command as Record<string, unknown>, createRequestId);
    const followupId = (created.data as { followupId: string }).followupId;
    const row = await db.salesAction.findUnique({ where: { id: followupId }, select: { assignedToId: true, createdById: true, dueAt: true, source: true, category: true, activeKey: true, inputContext: true } });
    ok(
      created.ok && row?.assignedToId === REP_A && row.createdById === MGR && row.dueAt?.toISOString() === dueAt && row.source === "muse_followup" && row.category === "muse_followup",
      "[2] 按建议建跟进：负责人 = 商机负责人，期限 = 回复给的时间",
      { created, row },
    );
    ok((row?.inputContext as { workflowId?: string; inquiryTaskId?: string })?.workflowId === workflowId, "[2] 跟进沿用询问的 workflowId");
    ok((row?.inputContext as { inquiryTaskId?: string })?.inquiryTaskId === inquiryId, "[2] 跟进记下来源询问");
    ok((await events(REP_A, "followup.assigned")).some((e) => e.followupId === followupId), "[2] 负责人收到 followup.assigned");
    const foreign = await send("muse:rep-b", { intent: "create_followup", opportunityId: opp.id, title: "x", dueAt: future(24), fromInquiryId: inquiryId });
    ok(!foreign.ok, "[2] 无关的人不能借别人的询问建跟进", foreign);

    // ── [3] 更新 ──
    {
      const stranger = await send("muse:rep-b", { intent: "update_followup", followupId, status: "in_progress" });
      ok(stranger.errorCode === "FOLLOWUP_NOT_FOUND", "[3] 非负责人 / 创建人 → FOLLOWUP_NOT_FOUND", stranger);
      const noEvidence = await send("muse:rep-a", { intent: "update_followup", followupId, status: "completed" });
      ok(noEvidence.errorCode === "VALIDATION_FAILED", "[3] 完成不带证据 → VALIDATION_FAILED", noEvidence);
      const start = await send("muse:rep-a", { intent: "update_followup", followupId, status: "in_progress" });
      ok(start.ok, "[3] 负责人开始跟进", start);
      const done = await send("muse:rep-a", { intent: "update_followup", followupId, status: "completed", evidence: "客户确认周三收样" });
      ok(done.ok && (done.data as { evidence: string }).evidence === "客户确认周三收样", "[3] 带证据完成", done);
      const again = await send("muse:rep-a", { intent: "update_followup", followupId, status: "in_progress" });
      ok(again.errorCode === "FOLLOWUP_CLOSED", "[3] 结束后不能再动", again);
      const updates = (await events(MGR, "followup.updated")).filter((e) => e.followupId === followupId);
      ok(updates.length === 2, "[3] 创建人收到两次状态变化（进行中、已完成）", updates.map((e) => e.eventId));
    }

    // ── [4] 结束后重放不重复（绕过 24 小时账本，直接走服务层的 signalKey 查重） ──
    {
      const bound = await resolveMuseBinding(ORG, "muse:mgr");
      if (!bound.ok) throw new Error("binding");
      const replay = await createFollowup(bound.identity, { opportunityId: opp.id, title: "重放", dueAt: future(24) }, { requestId: createRequestId });
      ok(replay.ok && (replay.data as { followupId: string }).followupId === followupId && (await followupCount()) === 1, "[4] 跟进已结束后同一 requestId 重放：返回原跟进，不建第二条", replay);
      const repBound = await resolveMuseBinding(ORG, "muse:rep-a");
      if (!repBound.ok) throw new Error("binding");
      const hijack = await createFollowup(repBound.identity, { opportunityId: opp.id, title: "借用", dueAt: future(24) }, { requestId: createRequestId });
      ok(!hijack.ok || (hijack.data as { followupId: string }).followupId !== followupId, "[4] 别人拿同一 requestId 拿不到原跟进", hijack);
    }

    // ── [5] 网页更新的事件（服务层） ──
    {
      const second = await send("muse:mgr", { intent: "create_followup", opportunityId: opp.id, title: "寄样板", dueAt: future(72) });
      const secondId = (second.data as { followupId: string }).followupId;
      await db.salesAction.update({ where: { id: secondId }, data: { status: "in_progress" } });
      const rowAfter = await db.salesAction.findUniqueOrThrow({ where: { id: secondId }, select: followupSelect });
      await notifyFollowupUpdated(rowAfter, REP_A, null);
      await notifyFollowupUpdated(rowAfter, REP_A, null);
      ok((await events(MGR, "followup.updated")).filter((e) => e.followupId === secondId).length === 1, "[5] 网页改状态通知创建人，同一状态只发一次");
      await notifyFollowupUpdated(rowAfter, MGR, null);
      ok((await events(MGR, "followup.updated")).filter((e) => e.followupId === secondId).length === 1, "[5] 创建人自己改不通知自己");
      ok((await events(REP_A, "followup.updated")).filter((e) => e.followupId === secondId).length === 1, "[5] 创建人改状态时通知负责人");
      await db.salesAction.update({ where: { id: secondId }, data: { status: "open" } });
      await db.salesAction.update({ where: { id: secondId }, data: { status: "in_progress", dueAt: null } });
      const reopened = await db.salesAction.findUniqueOrThrow({ where: { id: secondId }, select: followupSelect });
      await notifyFollowupUpdated(reopened, REP_A, null);
      ok((await events(MGR, "followup.updated")).filter((e) => e.followupId === secondId).length === 2, "[5] 退回再开始（且已清空期限）仍会通知");
    }

    // ── [6] 提醒扫描 ──
    {
      const soon = await send("muse:mgr", { intent: "create_followup", opportunityId: opp.id, title: "下午回电", dueAt: future(2) });
      const soonId = (soon.data as { followupId: string }).followupId;
      const late = await send("muse:mgr", { intent: "create_followup", opportunityId: opp.id, title: "发修订报价", dueAt: future(10) });
      const lateId = (late.data as { followupId: string }).followupId;
      const lateDue = new Date(Date.now() - 5 * HOUR);
      await db.salesAction.update({ where: { id: lateId }, data: { dueAt: lateDue } });
      const ask2 = await send("muse:mgr", { intent: "ask_colleague", opportunityId: opp.id, questions: ["样板寄了吗？"], replyBy: future(5) });
      const inquiry2 = (ask2.data as { inquiryId: string }).inquiryId;
      await db.task.update({ where: { id: inquiry2 }, data: { dueDate: new Date(Date.now() - HOUR) } });

      const first = await scanMuseReminders();
      ok(!first.skipped && first.emitted >= 5, "[6] 第一次扫描发出提醒", first);
      ok((await events(REP_A, "followup.due")).some((e) => e.followupId === soonId), "[6] 24 小时内到期：负责人收到 followup.due");
      const overdueTo = async (id: string) =>
        (await Promise.all([events(REP_A, "followup.overdue"), events(MGR, "followup.overdue")])).map((list) => list.filter((e) => e.followupId === id).length);
      ok(JSON.stringify(await overdueTo(lateId)) === "[1,1]", "[6] 逾期：负责人与创建人各一条", await overdueTo(lateId));
      const inquiryOverdue = await Promise.all([events(REP_A, "inquiry.overdue"), events(MGR, "inquiry.overdue")]);
      ok(inquiryOverdue.every((list) => list.filter((e) => e.inquiryId === inquiry2).length === 1), "[6] 询问逾期：发起人与收件人各一条");

      const second = await scanMuseReminders();
      ok(second.emitted === 0, "[6] 再扫一次不重复发", second);
      await db.salesAction.update({ where: { id: lateId }, data: { dueAt: new Date(lateDue.getTime() - HOUR) } });
      await scanMuseReminders();
      ok(JSON.stringify(await overdueTo(lateId)) === "[2,2]", "[6] 改期限后再提醒一次", await overdueTo(lateId));
      ok((await events(REP_A, "followup.overdue")).every((e) => e.followupId !== followupId), "[6] 已完成的跟进不提醒");
    }

    // ── [7] 复合游标：同一毫秒的事件不丢 ──
    {
      const at = new Date(Date.now() - 1000);
      const env = (n: number) =>
        JSON.stringify({
          museEvent: {
            contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, eventId: `cursor-test:${stamp}:${n}`, type: "followup.due", orgId: ORG, userId: REP_B,
            summary: `同一毫秒 ${n}`, occurredAt: at.toISOString(),
          },
        });
      await db.notification.createMany({
        data: [1, 2, 3].map((n) => ({
          userId: REP_B, orgId: ORG, type: "project_update", category: "muse_bridge", title: "t", sourceKey: `muse:cursor-test:${stamp}:${n}`, metadata: env(n), createdAt: at,
        })),
      });
      const page1 = await listMuseEvents({ userId: REP_B, orgId: ORG, cursor: { at: new Date(at.getTime() - 1), id: "" }, limit: 2 });
      const page2 = await listMuseEvents({ userId: REP_B, orgId: ORG, cursor: parseEventCursor(page1.nextCursor ?? ""), limit: 2 });
      const ids = [...page1.events, ...page2.events].map((e) => e.eventId).filter((id) => id.startsWith("cursor-test"));
      ok(ids.length === 3 && new Set(ids).size === 3, "[7] 同一毫秒三条事件分两页：恰好三条、无重复", ids);
      const legacy = await listMuseEvents({ userId: REP_B, orgId: ORG, sinceIso: new Date(at.getTime() - 1).toISOString(), limit: 2 });
      ok(legacy.nextSince === at.toISOString() && typeof legacy.nextCursor === "string", "[7] 旧的 since / nextSince 仍可用，并同时给出 nextCursor");
      ok(parseEventCursor("2026-10-28T00:00:00.000Z") === null && parseEventCursor("bad|x y") === null, "[7] 坏游标解析为 null（路由据此返回 400）");
    }

    // ── [8] 商机状态与账本 traceId ──
    {
      const status = await send("muse:mgr", { intent: "opportunity_status", opportunityId: opp.id });
      const followups = (status.data as { followups: Array<{ followupId: string; status: string; evidence: string | null; overdue: boolean }> }).followups;
      const done = followups.find((f) => f.followupId === followupId);
      ok(done?.status === "completed" && done.evidence === "客户确认周三收样", "[8] opportunity_status 列出跟进与证据", followups);
      ok(followups[0].status !== "completed", "[8] 未结束的跟进排在前面");
      const traced = await db.auditLog.count({ where: { traceId: workflowId } });
      ok(traced >= 5, "[8] 账本按 workflowId 写 traceId（询问、回复、建跟进、两次更新）", traced);
    }

    // ── [9] 证据导出 ──
    {
      const evidence = await collectWorkflowEvidence(workflowId);
      ok(evidence.ledger.length >= 5 && evidence.ledger.every((l) => l.ok), "[9] 账本记录齐全且都成功", evidence.ledger.map((l) => l.intent));
      ok(evidence.inquiries.length === 1 && evidence.inquiries[0].replies.length === 1, "[9] 询问与回复", evidence.inquiries);
      ok(evidence.followups.length === 1 && evidence.followups[0].evidence === "客户确认周三收样" && evidence.followups[0].inquiryTaskId === inquiryId, "[9] 跟进及证据");
      const kinds = new Set(evidence.events.map((e) => (e.sourceKey ?? "").split(":")[1]));
      ok(["inquiry.received", "inquiry.replied", "followup.assigned", "followup.updated"].every((k) => kinds.has(k)), "[9] 事件链完整", [...kinds]);
      ok(!JSON.stringify(evidence).includes("estimatedValue"), "[9] 不输出金额字段");
    }
  } finally {
    await cleanup();
    await db.$disconnect();
  }

  console.log(`\nmuse-bridge followup DB e2e: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
