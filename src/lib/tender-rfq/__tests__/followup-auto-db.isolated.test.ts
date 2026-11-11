/**
 * RFQ-AUTO-1 跟进授权——真实 DB（隔离库）+ 真实审批执行器 + 假邮件发送 端到端
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-rfq/__tests__/followup-auto-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 供应商；邮件只进内存里的假发送器）。
 * 覆盖任务书验收项 A19（并发与重试不重复对外）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 RFQ-AUTO-1 跟进授权 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "RFQ-AUTO-1 follow-up preapproval DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { runChaseScan } = await import("../chase-service");
  const { __setChaseExecuteIoForTest } = await import("../chase-execute");
  const { chaseTemplateHash, parseChaseNotes } = await import("../chase-pure");
  const { buildFollowUpPolicy, FOLLOWUP_AUTO_SEND_AUDIT_ACTION, FOLLOWUP_STOP_AUDIT_ACTION } = await import("../followup-coverage");
  const { loadRoundFollowUpStatus, stopRoundFollowUp } = await import("../followup-service");
  const { formatRfqContactNotes } = await import("../inbound-contract");
  const { TENDER_SEND_CHASE_TYPE, TENDER_SEND_RFQ_TYPE } = await import("../types");

  console.log("RFQ-AUTO-1 follow-up preapproval — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `fuowner_${stamp}`, EX = `fuex_${stamp}`, ORG = `fuorg_${stamp}`, PROJECT = `fuproj_${stamp}`;
  const NOW = new Date("2026-11-14T12:00:00Z");
  const SENT_AT = new Date("2026-11-10T09:00:00Z"); // 4 天前，间隔 3 天 → 该催了
  const DUE = new Date("2026-11-20T00:00:00Z");
  const email = (id: string) => `${id}@fixture.test`;
  const MAILBOX = `mailbox_${stamp}@fixture.test`;

  // —— 假邮件发送器 ——
  const sends: Array<{ to: string; subject: string; threadId?: string }> = [];
  let failSends = false;
  __setChaseExecuteIoForTest({
    findProviders: async () => [{ userId: OWNER, accountEmail: MAILBOX, grantedScopes: "gmail.compose" }],
    hasComposeScope: () => true,
    getMessageIdHeader: async () => "<original@fixture.test>",
    send: (async (_userId: string, p: { to: string; subject: string; threadId?: string }) => {
      if (failSends) throw new Error("fixture: 邮箱授权失效");
      sends.push({ to: p.to, subject: p.subject, threadId: p.threadId });
      return { messageId: `gm-fu-${sends.length}`, threadId: p.threadId ?? "t" };
    }) as never,
  });

  // —— fixture ——
  for (const id of [OWNER, EX]) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id.split("_")[0]}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `fu-${stamp}`, ownerId: OWNER, settingsJson: { tenderRfq: { fromName: "Fixture Purchasing", fromEmail: MAILBOX, mailboxEmail: MAILBOX } } } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: EX, role: "org_admin", status: "active" } });
  await db.project.create({ data: { id: PROJECT, name: `Fixture Tender ${stamp}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched" } });
  const mkSupplier = async (n: string) => db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier ${n} ${stamp}`, contactEmail: `sales-${n.toLowerCase()}-${stamp}@supplier.test`, createdById: OWNER } });

  const policy = buildFollowUpPolicy({ chaseAfterDays: 3, replyBy: "2026-11-20", templateHash: chaseTemplateHash() })!;
  let roundNo = 0;
  /** 建一轮已批准并发出的询价（发询价卡直接写成已执行，决定人 = approver） */
  async function mkRound(opts: { names: string[]; withPolicy?: boolean; approver?: string; status?: string } ) {
    roundNo += 1;
    const inquiry = await db.projectInquiry.create({ data: { projectId: PROJECT, roundNumber: roundNo, status: opts.status ?? "in_progress", dueDate: DUE, createdById: OWNER } });
    const items: Array<{ id: string; to: string; name: string }> = [];
    for (const n of opts.names) {
      const s = await mkSupplier(`${n}${roundNo}`);
      const threadId = `th-${stamp}-${roundNo}-${n}`;
      const item = await db.inquiryItem.create({ data: { inquiryId: inquiry.id, supplierId: s.id, status: "sent", sentAt: SENT_AT, sentVia: "email", contactNotes: formatRfqContactNotes(`gm-${threadId}`, threadId, SENT_AT), createdById: OWNER } });
      items.push({ id: item.id, to: s.contactEmail!, name: s.name });
    }
    const payload = {
      projectId: PROJECT, inquiryId: inquiry.id, roundNumber: roundNo, fromName: "Fixture Purchasing", fromEmail: MAILBOX, rfqDocHash: "fixture",
      items: items.map((i) => ({ inquiryItemId: i.id, supplierId: "s", supplierName: i.name, to: i.to, subject: `询价：Fixture Tender（第 ${roundNo} 轮）`, body: "fixture" })),
      ...(opts.withPolicy === false ? {} : { followUpPolicy: policy }),
    };
    const card = await db.pendingAction.create({
      data: {
        type: TENDER_SEND_RFQ_TYPE, title: `fixture round ${roundNo}`, preview: "fixture", payload, status: "executed", createdById: OWNER, orgId: ORG, projectId: PROJECT,
        decidedById: opts.approver === undefined ? OWNER : opts.approver, decidedAt: SENT_AT, expiresAt: new Date(SENT_AT.getTime() + 72 * 3600_000), idempotencyKey: `${TENDER_SEND_RFQ_TYPE}:${inquiry.id}`,
      },
    });
    return { inquiryId: inquiry.id, items, cardId: card.id };
  }
  const chaseCards = (itemId: string) => db.pendingAction.findMany({ where: { orgId: ORG, type: TENDER_SEND_CHASE_TYPE, idempotencyKey: { startsWith: `${TENDER_SEND_CHASE_TYPE}:${itemId}:` } }, orderBy: { createdAt: "asc" } });
  const notesOf = async (itemId: string) => parseChaseNotes((await db.inquiryItem.findUnique({ where: { id: itemId }, select: { contactNotes: true } }))?.contactNotes ?? null);
  const autoAudits = (inquiryId: string) => db.auditLog.findMany({ where: { orgId: ORG, action: FOLLOWUP_AUTO_SEND_AUDIT_ACTION, targetId: inquiryId } });
  const flagOn = () => { process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED = "1"; delete process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ORG_ALLOWLIST; };
  const flagOff = () => { delete process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED; };
  // 允许执行器走到（假的）发送：非生产默认禁对外副作用，这里发的全是内存里的假邮件
  process.env.QINGYAN_ALLOW_REAL_EMAIL_NON_PROD = "1";

  try {
    // —— 1. 开关关闭：零变化 ——
    flagOff();
    const r1 = await mkRound({ names: ["A"] });
    const off = await runChaseScan(ORG, NOW);
    const offCards = await chaseCards(r1.items[0].id);
    ok(off.autoSent.length === 0 && off.drafted.length === 1 && offCards.length === 1 && offCards[0].status === "pending" && sends.length === 0, "开关关闭：带授权的轮次也只建待批卡，没有邮件发出", { off, statuses: offCards.map((c) => c.status) });
    ok((await loadRoundFollowUpStatus(ORG, [r1.inquiryId])).get(r1.inquiryId)?.state === "none", "开关关闭：轮次状态不显示自动跟进");
    ok((await stopRoundFollowUp({ orgId: ORG, projectId: PROJECT, inquiryId: r1.inquiryId, userId: OWNER })).ok === false, "开关关闭：停止接口不可用");
    await db.projectInquiry.update({ where: { id: r1.inquiryId }, data: { status: "completed" } }); // 这一轮不再参与后面的扫描

    // —— 2. 自动催单 ——
    flagOn();
    const r2 = await mkRound({ names: ["A", "B"] });
    const run2 = await runChaseScan(ORG, NOW);
    const cardsA = await chaseCards(r2.items[0].id);
    ok(run2.autoSent.length === 2 && run2.autoSent.every((a) => a.sent) && run2.drafted.length === 0 && sends.length === 2, "授权覆盖：两家各发出一封催单，不留待批卡", { run2, sends });
    ok(cardsA.length === 1 && cardsA[0].status === "executed" && cardsA[0].decidedById === OWNER, "每封仍有自己的审批记录：已执行，决定人是批准该轮的人", cardsA.map((c) => ({ s: c.status, d: c.decidedById })));
    ok(sends.every((s) => r2.items.some((i) => i.to === s.to)) && sends.every((s) => s.subject.startsWith("Re: ") && !!s.threadId), "收件人是原询价的收件人，回复在原线程");
    ok((await notesOf(r2.items[0].id)).some((c) => c.kind === "no_reply" && c.index === 1), "询价项的联系记录里记下了第 1 次催单");
    const audits2 = await autoAudits(r2.inquiryId);
    const a0 = JSON.parse(audits2[0]?.afterData ?? "{}") as Record<string, unknown>;
    ok(audits2.length === 2 && audits2.every((a) => a.userId === OWNER) && a0.source === "round_preapproval" && a0.roundActionId === r2.cardId && a0.sent === true && typeof a0.chaseActionId === "string" && (a0.policy as { maxReminders?: number })?.maxReminders === 2, "每封自动发出的邮件有一条审计：指向发询价卡、带授权内容", a0);
    const st2 = (await loadRoundFollowUpStatus(ORG, [r2.inquiryId])).get(r2.inquiryId);
    ok(st2?.state === "active" && st2.autoSentCount === 2, "轮次状态：生效中，已自动发出 2 封", st2);

    // —— 3. 重试与并发不重复发（A19） ——
    const before3 = sends.length;
    const again = await runChaseScan(ORG, NOW);
    ok(again.autoSent.length === 0 && sends.length === before3 && (await chaseCards(r2.items[0].id)).length === 1, "同一时刻再扫一次：不重复发、不重复建记录");
    const r3 = await mkRound({ names: ["C"] });
    const [p1, p2] = await Promise.all([runChaseScan(ORG, NOW), runChaseScan(ORG, NOW)]);
    const cardsC = await chaseCards(r3.items[0].id);
    ok(sends.length === before3 + 1 && cardsC.length === 1 && cardsC[0].status === "executed" && (await notesOf(r3.items[0].id)).filter((c) => c.kind === "no_reply").length === 1, "并发两次扫描：只发出一封，只有一条审批记录", { sends: sends.length - before3, cards: cardsC.map((c) => c.status), p1: p1.autoSent.length, p2: p2.autoSent.length });

    // —— 4. 发送失败：不自动重试，之后退回人工 ——
    const r4 = await mkRound({ names: ["D"] });
    failSends = true;
    const before4 = sends.length;
    const failed = await runChaseScan(ORG, NOW);
    failSends = false;
    const cardsD1 = await chaseCards(r4.items[0].id);
    ok(failed.autoSent.length === 0 && failed.failed.some((f) => f.itemId === r4.items[0].id) && cardsD1.length === 1 && cardsD1[0].status === "failed" && sends.length === before4, "发送失败：记为失败，没有邮件发出", { failed, statuses: cardsD1.map((c) => c.status) });
    const retry = await runChaseScan(ORG, NOW);
    const cardsD2 = await chaseCards(r4.items[0].id);
    ok(retry.autoSent.length === 0 && sends.length === before4 && cardsD2.length === 2 && cardsD2[1].status === "pending" && retry.notCovered.some((n) => n.itemId === r4.items[0].id && n.reason === "PRIOR_ATTEMPT"), "下次扫描不自动重试：重起草为待批卡，原因是此前起草过", { retry, statuses: cardsD2.map((c) => c.status) });
    await db.projectInquiry.update({ where: { id: r4.inquiryId }, data: { status: "completed" } });

    // —— 5. 停止 ——
    const r5 = await mkRound({ names: ["E"] });
    const stop = await stopRoundFollowUp({ orgId: ORG, projectId: PROJECT, inquiryId: r5.inquiryId, userId: OWNER });
    const stopAgain = await stopRoundFollowUp({ orgId: ORG, projectId: PROJECT, inquiryId: r5.inquiryId, userId: OWNER });
    const stopAudits = await db.auditLog.findMany({ where: { orgId: ORG, action: FOLLOWUP_STOP_AUDIT_ACTION, targetId: r5.inquiryId } });
    ok(stop.ok && !stop.alreadyStopped && stopAgain.ok && stopAgain.alreadyStopped && stopAudits.length === 1 && stopAudits[0].userId === OWNER, "停止：留一条审计（谁、何时），重复停止不重复记");
    const before5 = sends.length;
    const stopped = await runChaseScan(ORG, NOW);
    const cardsE = await chaseCards(r5.items[0].id);
    ok(stopped.autoSent.length === 0 && sends.length === before5 && cardsE.length === 1 && cardsE[0].status === "pending" && stopped.notCovered.some((n) => n.reason === "STOPPED"), "停止后：建待批卡，没有邮件自动发出", { stopped, statuses: cardsE.map((c) => c.status) });
    ok((await loadRoundFollowUpStatus(ORG, [r5.inquiryId])).get(r5.inquiryId)?.state === "stopped", "轮次状态：已停止");
    ok((await stopRoundFollowUp({ orgId: ORG, projectId: `${PROJECT}_x`, inquiryId: r5.inquiryId, userId: OWNER })).ok === false, "别的项目下的轮次号 → 找不到");
    await db.projectInquiry.update({ where: { id: r5.inquiryId }, data: { status: "completed" } });

    // —— 6. 取消的轮次：不建卡 ——
    const r6 = await mkRound({ names: ["F"], status: "canceled" });
    const before6 = sends.length;
    await runChaseScan(ORG, NOW);
    ok((await chaseCards(r6.items[0].id)).length === 0 && sends.length === before6, "轮次已取消：扫描不建卡、不发信");

    // —— 7. 没有授权 / 批准人不在职：退回人工 ——
    const r7 = await mkRound({ names: ["G"], withPolicy: false });
    const r8 = await mkRound({ names: ["H"], approver: EX });
    await db.organizationMember.update({ where: { orgId_userId: { orgId: ORG, userId: EX } }, data: { status: "inactive" } });
    const before7 = sends.length;
    const run7 = await runChaseScan(ORG, NOW);
    const cardsG = await chaseCards(r7.items[0].id);
    const cardsH = await chaseCards(r8.items[0].id);
    ok(sends.length === before7 && cardsG.length === 1 && cardsG[0].status === "pending" && cardsH.length === 1 && cardsH[0].status === "pending", "没带授权的轮次、批准人已离职的轮次：都只建待批卡", { g: cardsG.map((c) => c.status), h: cardsH.map((c) => c.status) });
    ok(run7.notCovered.some((n) => n.itemId === r8.items[0].id && n.reason === "APPROVER_INACTIVE") && !run7.notCovered.some((n) => n.itemId === r7.items[0].id), "未覆盖的原因只对带授权的轮次记录", run7.notCovered);
    const st8 = (await loadRoundFollowUpStatus(ORG, [r7.inquiryId, r8.inquiryId]));
    ok(st8.get(r7.inquiryId)?.state === "none" && st8.get(r8.inquiryId)?.state === "inactive", "轮次状态：没带授权 = 不显示；批准人离职 = 未生效并给出原因");

    // —— 8. 第二次催单与上限 ——
    const LATER = new Date("2026-11-17T13:00:00Z"); // 第一次催单后又过 3 天
    const before8 = sends.length;
    const second = await runChaseScan(ORG, LATER);
    ok(second.autoSent.filter((a) => a.chaseIndex === 2 && a.sent).length >= 2 && sends.length >= before8 + 2 && (await notesOf(r2.items[0].id)).filter((c) => c.kind === "no_reply").length === 2, "间隔到了：自动发出第 2 次催单", { n: second.autoSent.length });
    const MUCH_LATER = new Date("2026-11-19T12:00:00Z");
    const before9 = sends.length;
    await runChaseScan(ORG, MUCH_LATER);
    ok(sends.length === before9 && (await notesOf(r2.items[0].id)).filter((c) => c.kind === "no_reply").length === 2, "催满两次后不再发");
  } finally {
    __setChaseExecuteIoForTest(null);
    flagOff();
    delete process.env.QINGYAN_ALLOW_REAL_EMAIL_NON_PROD;
    // —— 清理 ——
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: [OWNER, EX] } }] } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: PROJECT } } });
    await db.projectInquiry.deleteMany({ where: { projectId: PROJECT } });
    await db.supplier.deleteMany({ where: { orgId: ORG } });
    await db.notification.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.project.deleteMany({ where: { id: PROJECT } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, EX] } } });
    await db.$disconnect();
  }

  console.log(`\nRFQ-AUTO-1 follow-up preapproval DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
