/**
 * Muse Bridge 跨助理询问与回复（TASKFLOW S2）— 真实 DB 端到端（隔离库，虚构企业）
 *
 *   发起（权限 / 收件人 / Task / 事件）→ 非收件人被拒 → Muse 回复 → 重复回复被拒 → 发起人事件
 *   → 商机状态员工确认 → 网页回复服务（渠道 web）→ requestId 重放
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/muse-bridge/__tests__/inquiry-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业与人名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 Muse 询问与回复 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Muse inquiry loop DB e2e" });

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
const ORG = `fx_s2_org_${stamp}`;
const OTHER_ORG = `fx_s2_other_${stamp}`;
const MGR = `fx_s2_mgr_${stamp}`;
const REP_A = `fx_s2_rep_a_${stamp}`;
const REP_B = `fx_s2_rep_b_${stamp}`;
const OUT = `fx_s2_out_${stamp}`;

async function main() {
  process.env.MUSE_BRIDGE_ENABLED = "1";
  process.env.MUSE_BRIDGE_INTENTS =
    "status,ask,approve,reject,next_step,set_preference,preferences,sales_overview,opportunity_status,ask_colleague,reply_inquiry";
  const { db } = await import("@/lib/db");
  const { resolveMuseBinding } = await import("../binding");
  const { handleMuseCommand } = await import("../router");
  const { listMuseEvents } = await import("../events");
  const { MUSE_BRIDGE_CONTRACT_VERSION } = await import("../contract");
  const { replyInquiry, getInquiryForUser } = await import("../inquiry");

  const now = Date.now();
  const bind = (refs: Record<string, string>) => ({
    museBridge: { bindings: Object.fromEntries(Object.entries(refs).map(([ref, userId]) => [ref, { userId, boundAt: new Date(now).toISOString(), boundBy: MGR }])) },
  });

  async function cleanup() {
    const users = [MGR, REP_A, REP_B, OUT];
    const tasks = await db.task.findMany({ where: { OR: [{ creatorId: { in: users } }, { assigneeId: { in: users } }] }, select: { id: true } });
    const taskIds = tasks.map((t) => t.id);
    await db.taskComment.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.taskActivity.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.task.deleteMany({ where: { id: { in: taskIds } } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, OTHER_ORG] } }, { userId: { in: users } }] } });
    await db.salesOpportunity.deleteMany({ where: { orgId: { in: [ORG, OTHER_ORG] } } });
    await db.salesCustomer.deleteMany({ where: { orgId: { in: [ORG, OTHER_ORG] } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, OTHER_ORG] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, OTHER_ORG] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }

  try {
    await db.user.createMany({
      data: [
        { id: MGR, email: `${MGR}@fixture.test`, name: "Morgan Manager", role: "boss" },
        { id: REP_A, email: `${REP_A}@fixture.test`, name: "Avery Rep", role: "sales" },
        { id: REP_B, email: `${REP_B}@fixture.test`, name: "Blake Rep", role: "sales" },
        { id: OUT, email: `${OUT}@fixture.test`, name: "Olive Outside", role: "sales" },
      ],
    });
    await db.organization.create({
      data: { id: ORG, name: "S2 Fixture Shades", code: `s2a-${stamp}`, ownerId: MGR, settingsJson: bind({ "muse:mgr": MGR, "muse:rep-a": REP_A, "muse:rep-b": REP_B }) },
    });
    await db.organization.create({ data: { id: OTHER_ORG, name: "S2 Other", code: `s2b-${stamp}`, ownerId: OUT, settingsJson: bind({ "muse:out": OUT }) } });
    await db.organizationMember.createMany({
      data: [
        { orgId: ORG, userId: MGR },
        { orgId: ORG, userId: REP_A },
        { orgId: ORG, userId: REP_B },
        { orgId: OTHER_ORG, userId: OUT },
      ],
    });
    const customer = await db.salesCustomer.create({ data: { orgId: ORG, name: "Northwind Interiors", createdById: MGR }, select: { id: true } });
    const opp = await db.salesOpportunity.create({
      data: { orgId: ORG, customerId: customer.id, title: "Lobby roller shades", stage: "quoted", estimatedValue: 12000, createdById: MGR, assignedToId: REP_A, lastInteractionAt: new Date(now - 30 * 86_400_000) },
      select: { id: true },
    });
    const unassigned = await db.salesOpportunity.create({
      data: { orgId: ORG, customerId: customer.id, title: "Unassigned lead", stage: "qualified", createdById: MGR },
      select: { id: true },
    });

    let seq = 0;
    async function send(museUserRef: string, command: Record<string, unknown>, requestId = `req-s2-${stamp}-${++seq}`) {
      const bound = await resolveMuseBinding(ORG, museUserRef);
      if (!bound.ok) throw new Error(`binding failed: ${bound.errorCode}`);
      const envelope = { contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, requestId, orgId: ORG, museUserRef, command } as Parameters<typeof handleMuseCommand>[0];
      return handleMuseCommand(envelope, bound.identity);
    }
    const events = async (userId: string, type: string) =>
      (await listMuseEvents({ userId, orgId: ORG, limit: 50 })).events.filter((e) => e.type === type);

    // ── [1] 权限与收件人 ──
    {
      const rep = await send("muse:rep-b", { intent: "ask_colleague", opportunityId: opp.id, questions: ["进展？"] });
      ok(rep.errorCode === "PERMISSION_DENIED", "[1] 销售角色不能发起询问", rep);
      const none = await send("muse:mgr", { intent: "ask_colleague", opportunityId: unassigned.id, questions: ["进展？"] });
      ok(none.errorCode === "OPPORTUNITY_UNASSIGNED", "[1] 没有负责人的商机 → OPPORTUNITY_UNASSIGNED", none);
      const ghost = await send("muse:mgr", { intent: "ask_colleague", opportunityId: `missing_${stamp}`, questions: ["进展？"] });
      ok(ghost.errorCode === "OPPORTUNITY_NOT_FOUND", "[1] 不存在的商机 → OPPORTUNITY_NOT_FOUND", ghost);
      const count = await db.task.count({ where: { sourceType: "muse_inquiry", creatorId: { in: [MGR, REP_B] } } });
      ok(count === 0, "[1] 失败的发起不建 Task", count);
    }

    // ── [2] 发起询问 ──
    const askRequestId = `req-s2-ask-${stamp}`;
    const asked = await send("muse:mgr", { intent: "ask_colleague", opportunityId: opp.id, questions: ["客户最近怎么说？", "下一步是什么？"], note: "周会前要" }, askRequestId);
    const inquiryId = (asked.data as { inquiryId: string } | undefined)?.inquiryId ?? "";
    {
      ok(asked.ok && !!inquiryId, "[2] 管理者发起成功并返回 inquiryId", asked);
      const task = await db.task.findUnique({ where: { id: inquiryId }, select: { status: true, assigneeId: true, creatorId: true, sourceType: true, sourceId: true, dueDate: true } });
      ok(task?.status === "waiting_internal" && task.assigneeId === REP_A && task.creatorId === MGR, "[2] Task 负责人 = 商机负责人、状态 waiting_internal", task);
      ok(task?.sourceType === "muse_inquiry" && task.sourceId === opp.id, "[2] Task 关联商机", task);
      ok(!!task?.dueDate && task.dueDate.getTime() > now + 23 * 3_600_000, "[2] 默认期限约 24 小时", task?.dueDate);
      const received = await events(REP_A, "inquiry.received");
      ok(received.length === 1 && received[0].inquiryId === inquiryId && received[0].opportunityId === opp.id, "[2] 负责人收到 inquiry.received", received);
      ok(!JSON.stringify(received).includes("12000") && !JSON.stringify(received).includes("12,000"), "[2] 事件不含金额");
      const notification = await db.notification.findFirst({ where: { userId: REP_A, entityId: inquiryId }, select: { entityType: true } });
      ok(notification?.entityType === "muse_inquiry", "[2] 站内通知可跳到询问页", notification);
    }

    // ── [3] 重放 ──
    {
      const again = await send("muse:mgr", { intent: "ask_colleague", opportunityId: opp.id, questions: ["客户最近怎么说？", "下一步是什么？"], note: "周会前要" }, askRequestId);
      ok(JSON.stringify(again) === JSON.stringify(asked), "[3] 同 requestId 重放返回首次响应");
      const count = await db.task.count({ where: { sourceType: "muse_inquiry", sourceId: opp.id } });
      ok(count === 1, "[3] 只有一条询问 Task", count);
    }

    // ── [4] 非收件人回复 ──
    {
      const byMgr = await send("muse:mgr", { intent: "reply_inquiry", inquiryId, nextStep: "我替他回" });
      const byOther = await send("muse:rep-b", { intent: "reply_inquiry", inquiryId, nextStep: "我替他回" });
      ok(byMgr.errorCode === "INQUIRY_NOT_FOUND" && byOther.errorCode === "INQUIRY_NOT_FOUND", "[4] 发起人与其他销售都不能回复", [byMgr, byOther]);
      const outside = await replyInquiry({ userId: OUT, orgId: null }, { inquiryId, nextStep: "x" }, "web");
      ok(!outside.ok && outside.errorCode === "INQUIRY_NOT_FOUND", "[4] 外组织用户经网页也不能回复", outside);
      ok((await getInquiryForUser(OUT, inquiryId)) === null, "[4] 外组织用户读不到询问");
    }

    // ── [5] 收件人经 Muse 回复 ──
    {
      const replied = await send("muse:rep-a", {
        intent: "reply_inquiry", inquiryId, nextStep: "周五发修订报价", customerFeedback: "客户要求改尺寸",
        nextStepDueAt: new Date(now + 3 * 86_400_000).toISOString(), needs: ["quote_revision"],
      });
      ok(replied.ok, "[5] 收件人回复成功", replied);
      const task = await db.task.findUnique({ where: { id: inquiryId }, select: { status: true, completedAt: true } });
      ok(task?.status === "done" && !!task.completedAt, "[5] 询问 Task 置 done", task);
      const comments = await db.taskComment.findMany({ where: { taskId: inquiryId }, select: { authorId: true, content: true } });
      ok(comments.length === 1 && comments[0].authorId === REP_A && comments[0].content.startsWith("下一步：周五发修订报价"), "[5] 评论作者是回复人", comments);
      const activity = await db.taskActivity.findFirst({ where: { taskId: inquiryId, action: "muse_inquiry.replied" }, select: { detail: true } });
      ok(!!activity?.detail && JSON.parse(activity.detail).channel === "muse", "[5] 活动记录渠道 = muse", activity);
      const repliedEvents = await events(MGR, "inquiry.replied");
      ok(repliedEvents.length === 1 && repliedEvents[0].summary.includes("周五发修订报价"), "[5] 发起人收到 inquiry.replied", repliedEvents);
    }

    // ── [6] 重复回复 ──
    {
      const again = await send("muse:rep-a", { intent: "reply_inquiry", inquiryId, nextStep: "再回一次" });
      ok(again.errorCode === "INQUIRY_CLOSED", "[6] 已回复的询问再回复 → INQUIRY_CLOSED", again);
      const web = await replyInquiry({ userId: REP_A, orgId: null }, { inquiryId, nextStep: "网页再回" }, "web");
      ok(!web.ok && web.errorCode === "INQUIRY_CLOSED", "[6] 网页同样拒绝");
      ok((await db.taskComment.count({ where: { taskId: inquiryId } })) === 1, "[6] 评论数仍为 1");
    }

    // ── [7] 商机状态里的员工确认 ──
    {
      const status = await send("muse:mgr", { intent: "opportunity_status", opportunityId: opp.id });
      const d = status.data as { employeeConfirmations: Array<{ inquiryId: string; channel: string; nextStep: string; repliedBy: { id: string }; questions: string[] }>; openInquiries: unknown[] };
      ok(d.employeeConfirmations.length === 1 && d.employeeConfirmations[0].channel === "muse" && d.employeeConfirmations[0].repliedBy.id === REP_A, "[7] 员工确认含回复人与渠道", d.employeeConfirmations);
      ok(d.employeeConfirmations[0].questions.length === 2 && d.openInquiries.length === 0, "[7] 带原问题，没有未结束询问");
      ok(status.suggestedActions[0]?.command.intent === "ask_colleague", "[7] 无未结束询问时下一步是再问负责人", status.suggestedActions);
    }

    // ── [8] 网页回复 ──
    {
      const second = await send("muse:mgr", { intent: "ask_colleague", opportunityId: opp.id, questions: ["样板寄了吗？"] });
      const secondId = (second.data as { inquiryId: string }).inquiryId;
      const view = await getInquiryForUser(REP_A, secondId);
      ok(!!view && view.canReply && view.questions[0] === "样板寄了吗？", "[8] 负责人在网页能看到问题并可回复", view);
      const mgrView = await getInquiryForUser(MGR, secondId);
      ok(!!mgrView && !mgrView.canReply, "[8] 发起人能看但不能回复");
      const status = await send("muse:mgr", { intent: "opportunity_status", opportunityId: opp.id });
      ok((status.data as { openInquiries: unknown[] }).openInquiries.length === 1 && status.suggestedActions.every((a) => a.command.intent !== "ask_colleague"), "[8] 有未结束询问时不再建议发起");
      const web = await replyInquiry({ userId: REP_A, orgId: null }, { inquiryId: secondId, nextStep: "明天寄出" }, "web");
      ok(web.ok, "[8] 网页回复成功", web);
      const activity = await db.taskActivity.findFirst({ where: { taskId: secondId, action: "muse_inquiry.replied" }, select: { detail: true } });
      ok(!!activity?.detail && JSON.parse(activity.detail).channel === "web", "[8] 渠道 = web");
    }
  } finally {
    await cleanup();
    await db.$disconnect();
  }

  console.log(`\nmuse-bridge inquiry DB e2e: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
