/**
 * Revenue Spine — 真实 DB 端到端（隔离库）：
 *   Website Inquiry → SalesCustomer → SalesOpportunity → RFQ(+evidence) → Score → Missing Info → Draft
 *   → PendingAction(requestApproval) → Approve(execute, 注入发送器) → CustomerInteraction/outbound → Next Action
 *   → Customer Reply → CUSTOMER_REPLIED → 阶段流转（quoted/sample/negotiation/won/lost）→ BusinessOutcome → Attribution → Cockpit
 *   + 去重（existing / duplicate / same-domain / invalid email）+ 无效流转 + 跨组织拒绝 + 审批拒绝/取消
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/revenue-spine/__tests__/revenue-spine-db.isolated.test.ts
 * 无隔离库时自动跳过。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 Revenue Spine DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Revenue Spine DB e2e" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 600) : "");
  }
}

const ACCEPTANCE =
  "We are a hotel supplier in Canada and are looking for 3,000 blackout curtains for an upcoming hotel project. Please advise MOQ, pricing and delivery time.";

async function main() {
  const { db } = await import("@/lib/db");
  const { intakeInquiry } = await import("../inquiry-intake");
  const { runInboundSalesFde, INQUIRY_REPLY_ACTION_TYPE } = await import("../fde/inbound-sales");
  const { transitionOpportunity } = await import("../transition");
  const { logRevenueInteraction } = await import("../interactions");
  const { computeFdeAttribution } = await import("../attribution");
  const { computeRevenueCockpit } = await import("../cockpit");
  const { buildRevenueQueue } = await import("../daily-actions");
  const { listOpportunityOutcomes } = await import("../outcomes");
  const { loadRevenueSpinePolicy, publishRevenueSpineRule, RULE_KEY_POLICY } = await import("../policy");
  const { ingestWebsiteInquiry, normalizeInquiry, buildInquiryMessage } = await import("@/lib/trade/website-inquiry");
  const { executePendingAction, __setToolPolicyLoaderForTest } = await import("@/lib/pending-actions/executor");
  // 真实 UI 路径：/api/ai/pending-actions/[id] → approval/port（含 run reconcile）
  const { approveApprovalItem, rejectApprovalItem } = await import("@/lib/approval/port");
  const { __setInquiryReplySenderForTest } = await import("@/lib/pending-actions/exec-sales-inquiry-reply");

  __setToolPolicyLoaderForTest(async () => ({ value: {} }));

  const stamp = Date.now().toString(36);
  const ORG = `rsorg_${stamp}`;
  const ORG2 = `rsorg2_${stamp}`;
  const OWNER = `rsowner_${stamp}`;
  const TRADE = `rstrade_${stamp}`;
  const OTHER = `rsother_${stamp}`;
  const TRADE2 = `rstrade2_${stamp}`;

  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Lucas Owner", role: "boss" } });
  await db.user.create({ data: { id: TRADE, email: `${TRADE}@fixture.test`, name: "Mengxin Trade Rep", role: "trade" } });
  await db.user.create({ data: { id: OTHER, email: `${OTHER}@fixture.test`, name: "Other Org User", role: "trade" } });
  await db.user.create({ data: { id: TRADE2, email: `${TRADE2}@fixture.test`, name: "Second Trade Rep", role: "trade" } });
  await db.organization.create({ data: { id: ORG, name: "Mengxin Fixture OEM", code: `rs-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Other Fixture Org", code: `rs2-${stamp}`, ownerId: OTHER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_owner", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: TRADE, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: TRADE2, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OTHER, role: "org_owner", status: "active" } });

  const sent: Array<{ to: string; subject: string; body: string }> = [];
  __setInquiryReplySenderForTest(async (input) => {
    sent.push({ to: input.to, subject: input.subject, body: input.body });
    return { channel: "test", messageId: `msg_${sent.length}` };
  });

  try {
    console.log("\n[1] 策略配置化");
    const r = await publishRevenueSpineRule({ orgId: ORG, ruleKey: RULE_KEY_POLICY, config: { scoring: { strategicMarkets: ["Canada"] }, salesSla: { newInquiryResponseHours: 4 } }, userId: OWNER });
    const policy = await loadRevenueSpinePolicy(ORG);
    ok(r.version === 1 && policy.scoring.strategicMarkets.includes("Canada"), "OrgBusinessRule revenue_spine.policy 覆盖生效");

    console.log("\n[2] 新客户询盘 intake");
    // 夹具时间 = 真实时钟 5 周前的周一 08:00Z（executor 发送用真实时钟，来信必须早于外发）
    const { addBusinessHours } = await import("../business-days");
    const t0 = new Date(Date.now() - 35 * 86_400_000);
    t0.setUTCHours(8, 0, 0, 0);
    while (t0.getUTCDay() !== 1) t0.setTime(t0.getTime() - 86_400_000);
    const a = await intakeInquiry({
      orgId: ORG,
      source: "website_inquiry",
      contact: { name: "Cathy Li", email: "Cathy@Hotel-Supply.ca", company: "Hotel Supply Inc", country: "Canada" },
      message: ACCEPTANCE,
      meta: { page: "https://www.mengxinhometextile.com/contact?utm_source=coldemail", utm: { source: "coldemail", campaign: "hotel" }, channel: "website" },
      now: t0,
    });
    ok(a.ok, "intake ok", a);
    if (!a.ok) throw new Error("intake failed");
    ok(a.customerCreated && a.opportunityCreated && a.matchLevel === null, "新客户 + 新商机", a);
    ok(a.ownerUserId === TRADE, "负责人 = 组织内 trade 成员", a.ownerUserId);
    const cust = await db.salesCustomer.findUnique({ where: { id: a.customerId } });
    ok(cust?.email === "cathy@hotel-supply.ca" && cust.emailDomain === "hotel-supply.ca" && cust.normalizedName === "hotel supply" && cust.contactName === "Cathy Li", "邮箱归一化 + 去重键写入", cust);
    const opp0 = await db.salesOpportunity.findUnique({ where: { id: a.opportunityId } });
    ok(opp0?.stage === "new_inquiry" && opp0.source === "website_inquiry" && opp0.nextActionType === "reply_inquiry" && opp0.nextFollowupAt?.toISOString() === addBusinessHours(t0, 4).toISOString(), "商机 stage=new_inquiry + SLA next action", opp0);
    const inter0 = await db.customerInteraction.findUnique({ where: { id: a.interactionId } });
    ok(inter0?.direction === "inbound" && inter0.channel === "website" && (inter0.rawMessages ?? "").includes("coldemail"), "CustomerInteraction 保存 UTM/来源页", inter0?.rawMessages?.slice(0, 200));
    const act0 = await db.salesAction.findUnique({ where: { id: a.salesActionId! } });
    ok(act0?.employeeKey === "inbound_sales_fde" && act0.actionType === "inbound_inquiry" && act0.status === "open", "SalesAction 进入 FDE 队列", act0);

    console.log("\n[3] 去重：duplicate / same-domain / invalid email / existing customer");
    const dup = await intakeInquiry({ orgId: ORG, source: "website_inquiry", contact: { name: "Cathy Li", email: "cathy@hotel-supply.ca" }, message: "Following up on my curtain inquiry, sizes are 140x260cm.", now: new Date(t0.getTime() + 3_600_000) });
    ok(dup.ok && !dup.customerCreated && dup.matchLevel === "email" && !dup.opportunityCreated && dup.opportunityId === a.opportunityId, "重复询盘：同客户 + 附到既有商机", dup);
    const sameDomain = await intakeInquiry({ orgId: ORG, source: "website_inquiry", contact: { name: "Purchasing", email: "sales@hotel-supply.ca" }, message: "Also need 500 towels.", now: new Date(t0.getTime() + 5_400_000) });
    ok(sameDomain.ok && !sameDomain.customerCreated && sameDomain.matchLevel === "domain" && sameDomain.customerId === a.customerId, "同域不同联系人：复用账户，不建第二客户", sameDomain);
    const bad = await intakeInquiry({ orgId: ORG, source: "website_inquiry", contact: { email: "not-an-email" }, message: "hi" });
    ok(!bad.ok && bad.code === "INVALID_EMAIL", "无效邮箱拒收", bad);
    const custCount = await db.salesCustomer.count({ where: { orgId: ORG } });
    ok(custCount === 1, "组织内只有 1 个客户账户", custCount);
    const oppCount = await db.salesOpportunity.count({ where: { orgId: ORG } });
    ok(oppCount === 1, "组织内只有 1 个商机（补充来信不建平行商机）", oppCount);

    console.log("\n[4] Inbound Sales FDE（确定性路径，无 LLM）");
    const fde = await runInboundSalesFde({ orgId: ORG, opportunityId: a.opportunityId, salesActionId: a.salesActionId, trigger: "inquiry", useLlm: false, now: t0 });
    ok(fde.ok, "FDE run ok", fde);
    ok(!!fde.agentRunId && !!fde.rfqId && !!fde.assessmentId, "AgentRun / RFQ / Assessment 均落库", { run: fde.agentRunId, rfq: fde.rfqId });
    ok(fde.grade === "HIGH" && (fde.score ?? 0) >= 70, "评分 HIGH", { score: fde.score, grade: fde.grade });
    ok(fde.stage === "needs_info", "阶段 → needs_info（缺 feasibility 字段）", fde.stage);
    ok(fde.missing.slice(0, 4).join(",") === "size,material,destinationCity,requiredDeliveryDate" || fde.missing.slice(0, 3).join(",") === "material,destinationCity,requiredDeliveryDate", "缺失信息按优先级", fde.missing);
    ok(!!fde.draft && fde.draft.guardrailViolations.length === 0 && /confirm these internally/i.test(fde.draft.body), "回复草稿接地且无承诺", fde.draft?.body.slice(0, 200));
    ok(!!fde.pendingActionId && fde.approvalRequired, "进入 PendingAction 审批", fde.pendingActionId);
    const rfq = await db.salesRfq.findUnique({ where: { opportunityId: a.opportunityId }, include: { evidence: true } });
    ok(rfq?.quantity === 3000 && rfq.destinationCountry === "Canada" && rfq.buyerType === "hotel_supplier", "RFQ 字段", rfq);
    const qtyEv = rfq?.evidence.find((e) => e.field === "quantity");
    ok(!!qtyEv && qtyEv.sourceInteractionId !== null && (qtyEv.evidenceText ?? "").includes("3,000") && qtyEv.confidence >= 0.85, "数量证据回溯到来源 interaction", qtyEv);
    const run = await db.agentRun.findUnique({ where: { id: fde.agentRunId! }, include: { events: { orderBy: { sequence: "asc" } } } });
    const types = run?.events.map((e) => e.eventType) ?? [];
    ok(run?.status === "completed" && run.runType === "fde_inbound_sales", "AgentRun completed", { status: run?.status });
    ok(["run.started", "tool.started", "tool.completed", "retrieval.completed", "approval.required", "agent.output", "run.completed"].every((t) => types.includes(t)), "事件链 trigger→tools→facts→decision→approval→result", types);
    const pa = await db.pendingAction.findUnique({ where: { id: fde.pendingActionId! } });
    const paMeta = ((pa?.payload as Record<string, unknown> | null)?.metadata ?? {}) as Record<string, unknown>;
    ok(pa?.type === INQUIRY_REPLY_ACTION_TYPE && pa.status === "pending" && pa.orgId === ORG && pa.approverUserId === TRADE && pa.agentRunId === null && paMeta.agentRunId === fde.agentRunId && paMeta.canonicalRisk === "high_impact", "PendingAction 字段（审批人=负责人；run 追溯在 metadata，不挂 assistant reconcile）", { pa, paMeta });
    const actAfter = await db.salesAction.findUnique({ where: { id: a.salesActionId! } });
    ok(actAfter?.pendingActionId === fde.pendingActionId && actAfter.agentRunId === fde.agentRunId && actAfter.approvalRequired && actAfter.priority === "high", "SalesAction 回填 FDE 追踪字段", actAfter);
    const oppAfter = await db.salesOpportunity.findUnique({ where: { id: a.opportunityId } });
    ok(oppAfter?.fdeInfluenced === true && oppAfter.firstFdeActionId === a.salesActionId && oppAfter.score === fde.score && oppAfter.scoreGrade === "HIGH" && oppAfter.priority === "hot", "商机归因 + 评分缓存", oppAfter);
    const fdeAgain = await runInboundSalesFde({ orgId: ORG, opportunityId: a.opportunityId, salesActionId: a.salesActionId, trigger: "manual", useLlm: false, now: t0 });
    ok(fdeAgain.ok && fdeAgain.pendingActionId === fde.pendingActionId, "重跑 FDE：审批草稿幂等复用", fdeAgain.pendingActionId);

    console.log("\n[5] 审批：拒绝一次不发送；批准后唯一发送");
    const rejected = await rejectApprovalItem("pending_action", fde.pendingActionId!, { userId: OWNER, role: "boss", orgId: ORG, note: "先改措辞" });
    ok(rejected.ok === true, "拒绝成功（组织 owner 可决策）", rejected);
    ok(sent.length === 0, "拒绝不发送", sent.length);
    const fdeRedo = await runInboundSalesFde({ orgId: ORG, opportunityId: a.opportunityId, salesActionId: a.salesActionId, trigger: "manual", useLlm: false, now: new Date(t0.getTime() + 7_200_000) });
    ok(fdeRedo.ok && !!fdeRedo.pendingActionId && fdeRedo.pendingActionId !== fde.pendingActionId, "拒绝后重跑生成新草稿（旧 key 已终态）", fdeRedo.pendingActionId);
    const crossOrg = await approveApprovalItem("pending_action", fdeRedo.pendingActionId!, { userId: OTHER, role: "trade", orgId: ORG2 });
    ok(!crossOrg.ok, "跨组织用户不能批准", crossOrg);
    await db.organizationMember.update({ where: { orgId_userId: { orgId: ORG, userId: TRADE } }, data: { status: "inactive" } });
    const inactiveApprove = await approveApprovalItem("pending_action", fdeRedo.pendingActionId!, { userId: TRADE, role: "trade", orgId: ORG });
    ok(inactiveApprove.ok === false && sent.length === 0, "失效成员（approverUserId 但 membership inactive）批准 → 拒发", inactiveApprove);
    const paAfterInactive = await db.pendingAction.findUnique({ where: { id: fdeRedo.pendingActionId! }, select: { status: true } });
    await db.organizationMember.update({ where: { orgId_userId: { orgId: ORG, userId: TRADE } }, data: { status: "active" } });
    let approvedByTrade: Awaited<ReturnType<typeof approveApprovalItem>>;
    if (paAfterInactive?.status === "pending") {
      approvedByTrade = await approveApprovalItem("pending_action", fdeRedo.pendingActionId!, { userId: TRADE, role: "trade", orgId: ORG });
    } else {
      // executor 失败会把草稿标 failed（B2 语义）：重跑 FDE 起新草稿再批准
      const fdeRedo2 = await runInboundSalesFde({ orgId: ORG, opportunityId: a.opportunityId, salesActionId: a.salesActionId, trigger: "manual", useLlm: false, now: new Date(t0.getTime() + 9_000_000) });
      fdeRedo.pendingActionId = fdeRedo2.pendingActionId;
      approvedByTrade = await approveApprovalItem("pending_action", fdeRedo2.pendingActionId!, { userId: TRADE, role: "trade", orgId: ORG });
    }
    ok(approvedByTrade.ok === true, "恢复 active 后负责人批准 → 发送", approvedByTrade);
    ok(sent.length === 1 && sent[0].to === "cathy@hotel-supply.ca" && /blackout curtains/i.test(sent[0].subject), "只发送一次，收件人=客户邮箱", sent);
    const dupExec = await approveApprovalItem("pending_action", fdeRedo.pendingActionId!, { userId: TRADE, role: "trade", orgId: ORG });
    ok(sent.length === 1 && dupExec.duplicate === true, "重复批准不重复发送（B2 CAS，port 幂等）", { sent: sent.length, dupExec });
    const dupExecRaw = await executePendingAction(fdeRedo.pendingActionId!, { userId: TRADE, role: "trade", orgId: ORG });
    ok(sent.length === 1 && dupExecRaw.errorCode === "ALREADY_EXECUTED", "executor 直调重复执行同样阻断", { sent: sent.length, dupExecRaw });
    const oppSent = await db.salesOpportunity.findUnique({ where: { id: a.opportunityId } });
    ok(!!oppSent?.lastOutboundAt && oppSent.followUpCount === 1 && oppSent.nextActionType === "follow_up", "外发后 lastOutboundAt / followUpCount / next=follow_up", oppSent);
    const outbound = await db.customerInteraction.findFirst({ where: { opportunityId: a.opportunityId, direction: "outbound" } });
    ok(!!outbound && outbound.channel === "email" && outbound.emailMessageId === "msg_1", "outbound CustomerInteraction", outbound);
    const actExec = await db.salesAction.findUnique({ where: { id: a.salesActionId! } });
    ok(actExec?.status === "completed" && !!actExec.executedAt && actExec.approvedById === TRADE && actExec.activeKey === null, "SalesAction executed（approvedBy / executedAt / result）", actExec);

    console.log("\n[6] 客户回复 → CUSTOMER_REPLIED → Next Action");
    const reply = await logRevenueInteraction({ orgId: ORG, opportunityId: a.opportunityId, direction: "inbound", channel: "email", content: "Size 140x260cm, 100% polyester blackout, deliver to Toronto by 2026-12-01.", actorUserId: TRADE });
    ok(reply.customerReplied && !!reply.outcomeId, "CUSTOMER_REPLIED 结果落库", reply);
    const oppReplied = await db.salesOpportunity.findUnique({ where: { id: a.opportunityId } });
    ok(oppReplied?.nextActionType === "reply_customer", "客户来信后 next=reply_customer", oppReplied?.nextActionType);
    const fde2 = await runInboundSalesFde({ orgId: ORG, opportunityId: a.opportunityId, trigger: "customer_reply", useLlm: false });
    ok(fde2.ok && fde2.stage === "rfq_ready", "补充信息后 → rfq_ready", { ok: fde2.ok, errorCode: fde2.errorCode, error: fde2.error, stage: fde2.stage, missing: fde2.missing });
    ok(!!fde2.pendingActionId && fde2.pendingActionId !== fdeRedo.pendingActionId, "客户来信后生成新的回复草稿待审批", fde2.pendingActionId);
    const approve2 = await approveApprovalItem("pending_action", fde2.pendingActionId!, { userId: TRADE, role: "trade", orgId: ORG });
    ok(approve2.ok === true && sent.length === 2, "第二封回复经审批发送", { approve2, sent: sent.length });
    const rfq2 = await db.salesRfq.findUnique({ where: { opportunityId: a.opportunityId } });
    ok(rfq2?.status === "complete" && rfq2.quantity === 3000 && /140\s*x\s*260/i.test(rfq2.size ?? "") && rfq2.version >= 3, "RFQ 合并：保留历史数量 + 新增尺寸/材质，版本递增", rfq2);

    console.log("\n[7] 阶段流转 + 结果 + 无效流转");
    const bad1 = await transitionOpportunity({ orgId: ORG, opportunityId: a.opportunityId, to: "won", actorUserId: OWNER, source: "human" });
    ok(!bad1.ok && bad1.code === "INVALID_STAGE_TRANSITION", "rfq_ready → won 被拒", bad1);
    const q1 = await transitionOpportunity({ orgId: ORG, opportunityId: a.opportunityId, to: "quoting", actorUserId: OWNER, source: "human" });
    const q2 = await transitionOpportunity({ orgId: ORG, opportunityId: a.opportunityId, to: "quoted", actorUserId: OWNER, source: "human", estimatedValue: 24000 });
    ok(q1.ok && q2.ok && q2.outcomes.includes("QUOTE_SENT") && q2.nextAction?.type === "quote_follow_up", "quoting → quoted：QUOTE_SENT + 报价跟进", q2);
    const s1 = await transitionOpportunity({ orgId: ORG, opportunityId: a.opportunityId, to: "sample", actorUserId: OWNER, source: "human" });
    const n1 = await transitionOpportunity({ orgId: ORG, opportunityId: a.opportunityId, to: "negotiation", actorUserId: OWNER, source: "human" });
    ok(s1.ok && s1.outcomes.includes("SAMPLE_REQUESTED") && n1.ok && n1.outcomes.includes("NEGOTIATION_STARTED"), "sample / negotiation 结果", { s1, n1 });
    const crossTransition = await transitionOpportunity({ orgId: ORG2, opportunityId: a.opportunityId, to: "won", actorUserId: OTHER, source: "human" });
    ok(!crossTransition.ok && crossTransition.code === "NOT_FOUND", "跨组织流转拒绝", crossTransition);
    const won = await transitionOpportunity({ orgId: ORG, opportunityId: a.opportunityId, to: "won", actorUserId: OWNER, source: "human", estimatedValue: 25500 });
    ok(won.ok && won.outcomes.includes("DEAL_WON") && won.outcomes.includes("REVENUE_RECORDED") && won.nextAction === null, "won：DEAL_WON + REVENUE_RECORDED，next 清空", won);
    const outcomes = await listOpportunityOutcomes(ORG, a.opportunityId);
    const types2 = outcomes.map((o) => o.outcomeType);
    ok(["CUSTOMER_REPLIED", "RFQ_RECEIVED", "QUOTE_SENT", "SAMPLE_REQUESTED", "NEGOTIATION_STARTED", "DEAL_WON", "REVENUE_RECORDED"].every((t) => types2.includes(t)), "Outcome 链完整", types2);
    const rev = outcomes.find((o) => o.outcomeType === "REVENUE_RECORDED");
    ok(rev?.revenueImpact === 25500 && rev.sourceType === "user_confirmed" && rev.manuallyVerified, "REVENUE_RECORDED 金额 + 人工确认来源", rev);
    const afterWon = await db.salesOpportunity.findUnique({ where: { id: a.opportunityId } });
    ok(afterWon?.stage === "won" && !!afterWon.wonAt && afterWon.estimatedValue === 25500, "商机 won", afterWon);

    console.log("\n[8] 丢单归因 + 培育");
    const b = await intakeInquiry({ orgId: ORG, source: "email", contact: { name: "John", email: "john@gmail.com" }, message: "I want 2 bathrobes for my home, price?", actorUserId: TRADE });
    ok(b.ok && b.customerCreated && b.opportunityCreated, "第二询盘（个人买家）新客户新商机", b);
    if (!b.ok) throw new Error("intake b failed");
    const fdeB = await runInboundSalesFde({ orgId: ORG, opportunityId: b.opportunityId, salesActionId: b.salesActionId, trigger: "inquiry", useLlm: false });
    ok(fdeB.ok && fdeB.stage === "disqualified" && !fdeB.pendingActionId, "个人小单 → disqualified，无审批草稿", { stage: fdeB.stage, pa: fdeB.pendingActionId });
    const actB = await db.salesAction.findUnique({ where: { id: b.salesActionId! } });
    ok(actB?.status === "auto_resolved", "不合格行动 auto_resolved", actB?.status);
    const nurture = await transitionOpportunity({ orgId: ORG, opportunityId: b.opportunityId, to: "nurture", actorUserId: OWNER, source: "human" });
    ok(nurture.ok && nurture.nextAction?.type === "nurture_check_in", "disqualified → nurture + 回访", nurture);
    const c = await intakeInquiry({ orgId: ORG, source: "trade_show", contact: { name: "Anna", email: "anna@nordic-linen.se", company: "Nordic Linen AB" }, message: "Need 1000 blankets, 150x200cm, 100% polyester, deliver to Stockholm by 2026-12-01", actorUserId: TRADE, fdeSourced: true });
    if (!c.ok) throw new Error("intake c failed");
    const fdeC = await runInboundSalesFde({ orgId: ORG, opportunityId: c.opportunityId, salesActionId: c.salesActionId, trigger: "inquiry", useLlm: false });
    ok(fdeC.ok && fdeC.stage === "rfq_ready", "完整 RFQ → rfq_ready", { stage: fdeC.stage, missing: fdeC.missing });
    if (fdeC.pendingActionId) {
      const rejC = await rejectApprovalItem("pending_action", fdeC.pendingActionId, { userId: OWNER, role: "boss", orgId: ORG, note: "先不回复" });
      ok(rejC.ok === true, "C 的草稿被拒绝（不发送）", rejC);
    }
    await transitionOpportunity({ orgId: ORG, opportunityId: c.opportunityId, to: "quoting", actorUserId: OWNER, source: "human" });
    await transitionOpportunity({ orgId: ORG, opportunityId: c.opportunityId, to: "quoted", actorUserId: OWNER, source: "human", estimatedValue: 9000 });
    const lost = await transitionOpportunity({ orgId: ORG, opportunityId: c.opportunityId, to: "lost", actorUserId: OWNER, source: "human", reason: "price too high" });
    ok(lost.ok && lost.outcomes.includes("DEAL_LOST"), "lost：DEAL_LOST", lost);
    const lostOpp = await db.salesOpportunity.findUnique({ where: { id: c.opportunityId } });
    ok(lostOpp?.lostReason === "price too high" && !!lostOpp.lostAt && lostOpp.fdeSourced && lostOpp.fdeInfluenced, "丢单原因 + FDE sourced/influenced 归因保留", lostOpp);

    console.log("\n[9] Attribution / Queue / Cockpit");
    const attr = await computeFdeAttribution(ORG);
    ok(attr.fdeInfluencedWonCount === 1 && attr.fdeInfluencedRevenue === 25500 && attr.fdeInfluencedGrossProfit === null, "FDE influenced revenue = 25500，毛利接口 null", attr);
    const queue = await buildRevenueQueue(ORG, { now: new Date(Date.now() + 40 * 86_400_000) });
    ok(queue.approvalsRequired === 0 && queue.counts.hotLeads === 0, "队列：无待审批，无 hot（已成交/丢单/培育）", queue.counts);
    const cockpit = await computeRevenueCockpit(ORG, { now: new Date(Date.now() + 40 * 86_400_000) });
    ok(cockpit.metrics.wonRevenue.value === 25500 && cockpit.metrics.fdeInfluencedRevenue === 25500 && cockpit.metrics.grossProfit.status === "unavailable", "Cockpit：Won Revenue / FDE Influenced Revenue", cockpit.metrics);
    const cockpit2 = await computeRevenueCockpit(ORG2);
    ok(cockpit2.metrics.openOpportunities === 0 && cockpit2.metrics.wonRevenue.value === 0, "跨组织：ORG2 看不到 ORG 数据", cockpit2.metrics);

    console.log("\n[11] 网站 webhook 幂等（Trade 线索 + Revenue Spine 双车道）");
    const wCounts = async (email: string) => {
      const prospects = await db.tradeProspect.findMany({ where: { orgId: ORG, contactEmail: { equals: email, mode: "insensitive" } }, select: { id: true } });
      const pids = prospects.map((p) => p.id);
      const customers = await db.salesCustomer.findMany({ where: { orgId: ORG, email: { equals: email, mode: "insensitive" } }, select: { id: true } });
      const cids = customers.map((c) => c.id);
      const opps = await db.salesOpportunity.findMany({ where: { orgId: ORG, customerId: { in: cids } }, select: { id: true } });
      const oids = opps.map((o) => o.id);
      return {
        prospects: pids.length,
        tradeMessages: await db.tradeMessage.count({ where: { prospectId: { in: pids }, direction: "inbound" } }),
        customers: cids.length,
        opportunities: oids.length,
        interactions: await db.customerInteraction.count({ where: { orgId: ORG, customerId: { in: cids }, direction: "inbound" } }),
        rfqs: await db.salesRfq.count({ where: { opportunityId: { in: oids } } }),
        runs: await db.agentRun.count({ where: { orgId: ORG, runType: "fde_inbound_sales", metadata: { path: ["opportunityId"], equals: oids[0] ?? "none" } } }),
        pending: await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", payload: { path: ["opportunityId"], equals: oids[0] ?? "none" } } }),
        rejected: await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "rejected", payload: { path: ["opportunityId"], equals: oids[0] ?? "none" } } }),
        superseded: await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "failed", failureReason: { startsWith: "SUPERSEDED_" }, payload: { path: ["opportunityId"], equals: oids[0] ?? "none" } } }),
      };
    };
    const oids0 = async () => (await db.salesOpportunity.findFirst({ where: { orgId: ORG, customer: { email: "mark@maple-hotels.ca" } }, select: { id: true } }))?.id ?? "none";
    const formA = normalizeInquiry({ name: "Mark Chen", email: "mark@maple-hotels.ca", company: "Maple Hotels Group", country: "Canada", message: ACCEPTANCE, page: "https://www.mengxinhometextile.com/contact?utm_source=ads", utm_source: "ads" });
    if (!formA.ok || formA.value.honeypotTripped) throw new Error("fixture normalize failed");
    const w1 = await ingestWebsiteInquiry(ORG, formA.value);
    ok(!w1.duplicate && !w1.replay && w1.spine.ok && w1.spine.opportunityCreated && !!w1.fde?.ok, "Case A：全新询盘 → 线索 + 消息 + 客户 + 商机 + FDE", { duplicate: w1.duplicate, spine: w1.spine.ok, fde: w1.fde?.ok });
    const cA = await wCounts("mark@maple-hotels.ca");
    ok(cA.prospects === 1 && cA.tradeMessages === 1 && cA.customers === 1 && cA.opportunities === 1 && cA.interactions === 1 && cA.rfqs === 1 && cA.runs === 1 && cA.pending === 1, "Case A 计数：1/1/1/1/1/1/1/1", cA);
    const prospectA = await db.tradeProspect.findFirst({ where: { orgId: ORG, contactEmail: "mark@maple-hotels.ca" } });
    ok(prospectA?.convertedToSalesOpportunityId === (w1.spine.ok ? w1.spine.opportunityId : null) && prospectA?.stage === "replied", "Trade 线索 ↔ 商机链接 + Trade Inbox 阶段 replied", prospectA);
    const w2 = await ingestWebsiteInquiry(ORG, formA.value);
    ok(w2.replay && w2.duplicate && w2.messageId === w1.messageId && w2.spine.ok && w2.spine.replay && w2.spine.opportunityId === (w1.spine.ok ? w1.spine.opportunityId : "") && w2.fde === null && !w2.recovered && w2.fdeState?.status === "completed", "Case B：原样重放 → replay，不建任何对象，返回既有主干 ID 与 FDE 状态", { replay: w2.replay, spine: w2.spine, recovered: w2.recovered });
    const cB = await wCounts("mark@maple-hotels.ca");
    ok(JSON.stringify(cB) === JSON.stringify(cA), "Case B 计数不变", cB);
    const spineReplay = await intakeInquiry({ orgId: ORG, source: "website_inquiry", contact: { name: "Mark Chen", email: "mark@maple-hotels.ca", company: "Maple Hotels Group" }, message: ACCEPTANCE, product: null });
    ok(spineReplay.ok && spineReplay.replay && spineReplay.interactionId === (w1.spine.ok ? w1.spine.interactionId : ""), "Case B（主干层）：intakeInquiry 自身也幂等", spineReplay);
    const formC = normalizeInquiry({ name: "Mark Chen", email: "mark@maple-hotels.ca", message: "Sizes are 140x260cm, material 100% polyester blackout, ship to Vancouver by 2026-12-15." });
    if (!formC.ok || formC.value.honeypotTripped) throw new Error("fixture C failed");
    const w3 = await ingestWebsiteInquiry(ORG, formC.value);
    ok(w3.duplicate && !w3.replay && w3.spine.ok && !w3.spine.opportunityCreated && w3.spine.attachedToExisting && !!w3.fde?.ok, "Case C：同买家新内容 → 新消息/互动，复用商机", { spine: w3.spine.ok, fde: w3.fde?.ok });
    const cC = await wCounts("mark@maple-hotels.ca");
    ok(cC.prospects === 1 && cC.tradeMessages === 2 && cC.customers === 1 && cC.opportunities === 1 && cC.interactions === 2 && cC.rfqs === 1 && cC.runs === 2 && cC.pending === 1 && cC.superseded === 1 && cC.rejected === 0, "Case C 计数：线索 1 / 消息 2 / 客户 1 / 商机 1 / 互动 2 / RFQ 1 / 运行 2 / 未决草稿 1（旧草稿系统作废 SUPERSEDED_BY_NEWER_INBOUND，非人类拒绝）", cC);
    const supersededByInbound = await db.pendingAction.findFirst({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "failed", failureReason: { startsWith: "SUPERSEDED_BY_NEWER_INBOUND" }, payload: { path: ["opportunityId"], equals: await oids0() } }, select: { decidedById: true, decidedAt: true, failureReason: true } });
    ok(!!supersededByInbound && supersededByInbound.decidedById === null && supersededByInbound.decidedAt === null && /triggeredBy=none/.test(supersededByInbound.failureReason ?? "") && /terminationMode=system_superseded/.test(supersededByInbound.failureReason ?? ""), "Case C：新来信作废旧草稿不写 decidedById（无人类决策者）", supersededByInbound);
    const rfqC = await db.salesRfq.findUnique({ where: { opportunityId: w1.spine.ok ? w1.spine.opportunityId : "" } });
    ok(rfqC?.quantity === 3000 && /140\s*x\s*260/i.test(rfqC.size ?? "") && rfqC.destinationCity?.toLowerCase() === "vancouver", "Case C RFQ 合并（保留数量，补尺寸/目的地）", rfqC);
    // executor 边界：针对旧来信的草稿即使被批准也拒发（STALE_DRAFT）
    const { execSalesSendInquiryReply } = await import("@/lib/pending-actions/exec-sales-inquiry-reply");
    const sentBefore = sent.length;
    const stale = await execSalesSendInquiryReply(
      {
        opportunityId: w1.spine.ok ? w1.spine.opportunityId : "",
        customerId: w1.spine.ok ? w1.spine.customerId : "",
        to: "mark@maple-hotels.ca",
        subject: "stale",
        body: "stale draft body",
        replyToInteractionId: w1.spine.ok ? w1.spine.interactionId : "",
        metadata: { orgId: ORG, customerId: w1.spine.ok ? w1.spine.customerId : "", opportunityId: w1.spine.ok ? w1.spine.opportunityId : "" },
      },
      { userId: TRADE, role: "trade", orgId: ORG },
      "manual-stale-probe",
    );
    ok(!stale.ok && stale.errorCode === "STALE_DRAFT" && sent.length === sentBefore, "executor 拒发过时草稿（STALE_DRAFT），未发送", stale);

    const formD = normalizeInquiry({ name: "Purchasing Dept", email: "purchasing@maple-hotels.ca", company: "Maple Hotels Group", message: "Following Mark's inquiry — we also need 800 bath towels." });
    if (!formD.ok || formD.value.honeypotTripped) throw new Error("fixture D failed");
    const w4 = await ingestWebsiteInquiry(ORG, formD.value, { runFde: false });
    ok(!w4.duplicate && w4.spine.ok && w4.spine.matchLevel === "domain" && w4.spine.customerId === (w1.spine.ok ? w1.spine.customerId : "") && w4.spine.opportunityId === (w1.spine.ok ? w1.spine.opportunityId : ""), "Case D：同公司第二联系人 → 复用账户与开放商机", w4.spine);
    const prospectsD = await db.tradeProspect.count({ where: { orgId: ORG, companyName: "Maple Hotels Group" } });
    const interD = await db.customerInteraction.findUnique({ where: { id: w4.spine.ok ? w4.spine.interactionId : "" }, select: { rawMessages: true } });
    ok(prospectsD === 2 && (interD?.rawMessages ?? "").includes("purchasing@maple-hotels.ca") && (interD?.rawMessages ?? "").includes("Purchasing Dept"), "Case D：Trade 侧保留独立联系人线索，互动保留第二联系人证据", { prospectsD, raw: interD?.rawMessages?.slice(0, 200) });
    const custD = await db.salesCustomer.findUnique({ where: { id: w4.spine.ok ? w4.spine.customerId : "" } });
    ok(custD?.email === "mark@maple-hotels.ca" && custD.contactName === "Mark Chen", "Case D：账户主联系人不被覆盖", custD);

    console.log("\n[12] 授权边界：API org 解析 + supervisor 取消");
    const { NextRequest } = await import("next/server");
    const { resolveTradeOrgId } = await import("@/lib/trade/access");
    const mkUser = (id: string, role: string) => ({ id, email: `${id}@fixture.test`, name: id, role, status: "active" } as unknown as Parameters<typeof resolveTradeOrgId>[1]);
    const reqOrg = (orgId: string) => new NextRequest(`http://localhost/api/revenue/cockpit?orgId=${orgId}`);
    await db.user.update({ where: { id: TRADE }, data: { activeOrgId: ORG } }).catch(() => undefined);
    const okActive = await resolveTradeOrgId(reqOrg(ORG), mkUser(TRADE, "trade"));
    ok(okActive.ok && okActive.orgId === ORG, "active 成员解析到本组织", okActive);
    await db.organizationMember.update({ where: { orgId_userId: { orgId: ORG, userId: TRADE } }, data: { status: "inactive" } });
    const denyInactive = await resolveTradeOrgId(reqOrg(ORG), mkUser(TRADE, "trade"));
    ok(!denyInactive.ok && denyInactive.response.status === 403, "inactive membership → 403（API 边界）", denyInactive.ok ? "ok?!" : denyInactive.response.status);
    await db.organizationMember.update({ where: { orgId_userId: { orgId: ORG, userId: TRADE } }, data: { status: "active" } });
    const denyCross = await resolveTradeOrgId(reqOrg(ORG), mkUser(OTHER, "trade"));
    ok(!denyCross.ok && denyCross.response.status === 403, "他组织成员显式请求本组织 → 403（cross-org）", denyCross.ok ? "ok?!" : denyCross.response.status);
    // supervisor 取消：run 取消后 FDE 不再产生审批草稿
    const { cancelAgentRun } = await import("@/lib/agent-runtime/run");
    const cancelProbe = await intakeInquiry({ orgId: ORG, source: "email", contact: { name: "Cancel Probe", email: "probe@cancel-probe.ca", company: "Cancel Probe Ltd" }, message: "Need 2000 bathrobes, cotton, size L, ship to Toronto by 2026-12-20.", actorUserId: TRADE });
    if (!cancelProbe.ok) throw new Error("cancel probe intake failed");
    const origCreate = db.salesOpportunityAssessment.create.bind(db.salesOpportunityAssessment);
    let cancelledRunId: string | null = null;
    // 在评分落库这一步（审批之前）模拟 supervisor 取消 run
    (db.salesOpportunityAssessment as unknown as { create: typeof origCreate }).create = (async (args: Parameters<typeof origCreate>[0]) => {
      const row = await origCreate(args);
      cancelledRunId = (args.data as { agentRunId?: string | null }).agentRunId ?? null;
      if (cancelledRunId) await cancelAgentRun(ORG, cancelledRunId);
      return row;
    }) as unknown as typeof origCreate;
    let cancelRun: Awaited<ReturnType<typeof runInboundSalesFde>>;
    try {
      cancelRun = await runInboundSalesFde({ orgId: ORG, opportunityId: cancelProbe.opportunityId, salesActionId: cancelProbe.salesActionId, trigger: "inquiry", useLlm: false });
    } finally {
      (db.salesOpportunityAssessment as unknown as { create: typeof origCreate }).create = origCreate;
    }
    const cancelledRun = cancelledRunId ? await db.agentRun.findUnique({ where: { id: cancelledRunId }, select: { status: true } }) : null;
    const cancelPending = await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", payload: { path: ["opportunityId"], equals: cancelProbe.opportunityId } } });
    ok(cancelledRun?.status === "cancelled" && cancelRun.pendingActionId === null && cancelPending === 0, "run 被 supervisor 取消 → 不生成审批草稿，run 保持 cancelled", { status: cancelledRun?.status, pa: cancelRun.pendingActionId, cancelPending });

    console.log("\n[13] Trade 收件箱外发 ↔ Revenue Spine 同步（P0.5）");
    process.env.JWT_SECRET = process.env.JWT_SECRET || "revenue-spine-e2e-jwt-secret";
    const { createSession } = await import("@/lib/auth/session");
    const { POST: replyRoute } = await import("@/app/api/trade/inbox/[prospectId]/reply/route");
    const { POST: messagesRoute } = await import("@/app/api/trade/prospects/[id]/messages/route");
    const { syncTradeOutboundToRevenueSpine } = await import("@/lib/trade/outbound-sync");
    const { createProspect } = await import("@/lib/trade/service");
    const { ensureInquiryCampaign } = await import("@/lib/trade/website-inquiry");
    const routeReq = async (userId: string, role: string, url: string, body: Record<string, unknown>) => {
      const token = await createSession({ sub: userId, email: `${userId}@fixture.test`, role });
      return new NextRequest(url, {
        method: "POST",
        headers: { cookie: `qy_session=${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    };
    const tradeCounts = async (prospectId: string) => ({
      outboundMsgs: await db.tradeMessage.count({ where: { prospectId, direction: "outbound" } }),
      inboundMsgs: await db.tradeMessage.count({ where: { prospectId, direction: "inbound" } }),
    });
    const spineCounts = async (opportunityId: string) => ({
      outboundInteractions: await db.customerInteraction.count({ where: { orgId: ORG, opportunityId, direction: "outbound" } }),
      pending: await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", payload: { path: ["opportunityId"], equals: opportunityId } } }),
      rejected: await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "rejected", payload: { path: ["opportunityId"], equals: opportunityId } } }),
      superseded: await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "failed", failureReason: { startsWith: "SUPERSEDED_" }, payload: { path: ["opportunityId"], equals: opportunityId } } }),
    });
    await db.user.update({ where: { id: TRADE2 }, data: { activeOrgId: ORG } });
    const auditData = (v: unknown): Record<string, unknown> => {
      if (typeof v === "string") { try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; } }
      return (v ?? {}) as Record<string, unknown>;
    };

    await db.user.update({ where: { id: TRADE }, data: { activeOrgId: ORG } });

    // 前置：网站询盘 → FDE 草稿 pending
    const formN = normalizeInquiry({ name: "Nora Park", email: "nora@peak-hotels.ca", company: "Peak Hotels Ltd", country: "Canada", message: ACCEPTANCE });
    if (!formN.ok || formN.value.honeypotTripped) throw new Error("fixture N failed");
    const wn = await ingestWebsiteInquiry(ORG, formN.value);
    if (!wn.spine.ok || !wn.fde?.pendingActionId) throw new Error(`fixture N: no pending draft (${JSON.stringify({ spine: wn.spine, fde: wn.fde && { ok: wn.fde.ok, errorCode: wn.fde.errorCode, error: wn.fde.error }, fdeState: wn.fdeState })})`);
    const nProspect = wn.prospectId;
    const nOpp = wn.spine.opportunityId;
    const nDraft1 = wn.fde.pendingActionId;
    const sentAtStart = sent.length;
    const beforeA = await spineCounts(nOpp);
    ok(beforeA.pending === 1 && beforeA.outboundInteractions === 0, "前置：1 个 FDE 草稿 pending，尚无 outbound", beforeA);

    // A — 收件箱人工回复（真实路由；mark_sent = 人已在系统外发出，一次真实发送）
    const resA = await replyRoute(
      await routeReq(TRADE, "trade", `http://localhost/api/trade/inbox/${nProspect}/reply`, { orgId: ORG, subject: "Re: blackout curtains", body: "Thanks Nora, we can produce these. Sizes?", mode: "mark_sent" }),
      { params: Promise.resolve({ prospectId: nProspect }) },
    );
    const bodyA = (await resA.json()) as { ok?: boolean; messageId?: string; revenueSync?: { linked: boolean; interactionId: string | null; supersededPendingActionIds: string[]; supersedeFailures: unknown[] } };
    ok(resA.status === 200 && bodyA.ok === true && !!bodyA.revenueSync?.linked && !!bodyA.revenueSync.interactionId, "A：收件箱回复路由 200 + 已镜像到 Revenue Spine", { status: resA.status, body: bodyA });
    const tcA = await tradeCounts(nProspect);
    const scA = await spineCounts(nOpp);
    const oppA = await db.salesOpportunity.findUnique({ where: { id: nOpp }, select: { lastOutboundAt: true, followUpCount: true, nextActionType: true } });
    const mirroredA = await db.customerInteraction.findUnique({ where: { id: bodyA.revenueSync!.interactionId! }, select: { direction: true, channel: true, type: true, analysisResult: true, createdById: true } });
    const mirroredMeta = (mirroredA?.analysisResult ?? {}) as Record<string, unknown>;
    ok(tcA.outboundMsgs === 1 && scA.outboundInteractions === 1 && !!oppA?.lastOutboundAt && oppA.followUpCount === 1 && oppA.nextActionType === "follow_up", "A：TradeMessage(outbound)=1，CustomerInteraction(outbound)=1，lastOutboundAt 已更新", { tcA, scA, oppA });
    ok(mirroredA?.direction === "outbound" && mirroredA.channel === "email" && mirroredA.type === "email" && mirroredMeta.source === "trade_inbox.mark_sent" && mirroredMeta.tradeMessageId === bodyA.messageId && mirroredMeta.tradeProspectId === nProspect && mirroredA.createdById === TRADE, "A：镜像语义 outbound/email/email + source + Trade 证据 + 操作者", { mirroredA, mirroredMeta });
    const draft1 = await db.pendingAction.findUnique({ where: { id: nDraft1 }, select: { status: true, failureReason: true, decidedById: true, decidedAt: true, approverUserId: true } });
    ok(draft1?.status === "failed" && (draft1.failureReason ?? "").startsWith("SUPERSEDED_BY_MANUAL_REPLY") && (draft1.failureReason ?? "").includes(`tradeMessageId=${bodyA.messageId}`) && (draft1.failureReason ?? "").includes(`outboundInteractionId=${bodyA.revenueSync!.interactionId}`) && (draft1.failureReason ?? "").includes(`triggeredBy=${TRADE}`) && (draft1.failureReason ?? "").includes("terminationMode=system_superseded"), "A：旧 FDE 草稿系统性作废（failed + 机器可读原因 + 证据 + 真实触发者）", draft1);
    ok(draft1?.approverUserId === TRADE && draft1.decidedById === null && draft1.decidedAt === null, "J：操作者恰为审批人时仍走系统作废语义——不写 decidedById（不是人类点了拒绝）", draft1);
    const auditA = await db.auditLog.findFirst({ where: { orgId: ORG, action: "APPROVAL_SYSTEM_SUPERSEDED", targetId: nDraft1 }, select: { userId: true, afterData: true } });
    const auditAData = auditData(auditA?.afterData);
    ok(!!auditA && auditA.userId === TRADE && auditAData.terminationMode === "system_superseded" && auditAData.reasonCode === "SUPERSEDED_BY_MANUAL_REPLY" && auditAData.triggeredByUserId === TRADE && auditAData.tradeMessageId === bodyA.messageId && auditAData.outboundInteractionId === bodyA.revenueSync!.interactionId && auditAData.decidedById === null, "A/J：AuditLog APPROVAL_SYSTEM_SUPERSEDED 记录真实触发者与证据", { auditA });
    ok(bodyA.revenueSync!.supersededPendingActionIds.includes(nDraft1) && bodyA.revenueSync!.supersedeFailures.length === 0 && scA.pending === 0 && scA.superseded >= 1 && scA.rejected === 0 && sent.length === sentAtStart, "A：一次真实发送（无 Revenue 发送），无 pending 草稿，无人类拒绝记录", { sync: bodyA.revenueSync, scA, sent: sent.length - sentAtStart });
    const replayA = await syncTradeOutboundToRevenueSpine({ orgId: ORG, prospectId: nProspect, tradeMessageId: bodyA.messageId!, actorUserId: TRADE, actorRole: "trade", source: "trade_inbox.mark_sent", channel: "email", subject: "Re: blackout curtains", content: "Thanks Nora, we can produce these. Sizes?" });
    ok(replayA.replay && replayA.interactionId === bodyA.revenueSync!.interactionId && (await spineCounts(nOpp)).outboundInteractions === 1, "A：同一 tradeMessageId 重复镜像 → replay，不重复写互动", replayA);

    // B — 迟到批准旧草稿 → 不能二次发送
    const lateB = await approveApprovalItem("pending_action", nDraft1, { userId: TRADE, role: "trade", orgId: ORG });
    ok(lateB.ok === false && lateB.status === "failed" && lateB.duplicate === true && sent.length === sentAtStart, "B：迟到批准落到已作废草稿 → port 幂等返回 failed（system_superseded），无第二封邮件", lateB);
    const lateBraw = await executePendingAction(nDraft1, { userId: TRADE, role: "trade", orgId: ORG });
    ok(lateBraw.ok === false && lateBraw.errorCode === "ALREADY_FAILED" && sent.length === sentAtStart, "B：executor 直调同样拒绝（ALREADY_FAILED）", lateBraw);

    // C — 竞态：新草稿 T1 → 人工外发 T2（作废步骤缺席）→ 迟到批准 T3 → executor 独立拒绝
    const fdeC1 = await runInboundSalesFde({ orgId: ORG, opportunityId: nOpp, trigger: "manual", useLlm: false });
    ok(fdeC1.ok && !!fdeC1.pendingActionId && fdeC1.pendingActionId !== nDraft1, "C：重跑 FDE 生成新草稿 T1", fdeC1.pendingActionId);
    const t2 = await logRevenueInteraction({ orgId: ORG, opportunityId: nOpp, direction: "outbound", channel: "email", content: "manual reply sent, cleanup delayed", actorUserId: TRADE, source: "trade_inbox.reply" });
    const raceC = await approveApprovalItem("pending_action", fdeC1.pendingActionId!, { userId: TRADE, role: "trade", orgId: ORG });
    ok(raceC.ok === false && /STALE_DRAFT|过时|已收到回复/.test(`${raceC.errorCode ?? ""} ${raceC.error ?? ""} ${raceC.message ?? ""}`) && sent.length === sentAtStart, "C/L：作废缺席时 executor 仍按 createdAt 对比拒发（STALE_DRAFT），0 次二次发送", { raceC, t2: t2.interactionId });

    // D — Trade-only 线索（未转商机）：回复行为不变，不伪造 Revenue 对象
    const campaignId = await ensureInquiryCampaign(ORG);
    const onlyProspect = await createProspect({ campaignId, orgId: ORG, companyName: "Trade Only GmbH", contactEmail: "buyer@trade-only.de", contactName: "Jonas", source: "manual", stage: "new" });
    const resD = await replyRoute(
      await routeReq(TRADE, "trade", `http://localhost/api/trade/inbox/${onlyProspect.id}/reply`, { orgId: ORG, subject: "Re: your inquiry", body: "Hello Jonas", mode: "mark_sent" }),
      { params: Promise.resolve({ prospectId: onlyProspect.id }) },
    );
    const bodyD = (await resD.json()) as { ok?: boolean; revenueSync?: { linked: boolean; interactionId: string | null } };
    const tcD = await tradeCounts(onlyProspect.id);
    const custD2 = await db.salesCustomer.count({ where: { orgId: ORG, email: "buyer@trade-only.de" } });
    ok(resD.status === 200 && bodyD.ok === true && bodyD.revenueSync?.linked === false && bodyD.revenueSync.interactionId === null && tcD.outboundMsgs === 1 && custD2 === 0, "D：Trade-only 线索回复不变，无 Revenue 对象", { status: resD.status, bodyD, tcD, custD2 });

    // E — 人工回复之后客户再来信：记录 inbound、CUSTOMER_REPLIED、允许新 FDE 与新草稿
    const scBeforeE = await spineCounts(nOpp);
    const formE = normalizeInquiry({ name: "Nora Park", email: "nora@peak-hotels.ca", message: "Sizes are 140x260cm, polyester blackout, ship to Toronto by 2026-12-10." });
    if (!formE.ok || formE.value.honeypotTripped) throw new Error("fixture E failed");
    const wE = await ingestWebsiteInquiry(ORG, formE.value);
    const outcomesE = await listOpportunityOutcomes(ORG, nOpp);
    const scE = await spineCounts(nOpp);
    const draftC1After = await db.pendingAction.findUnique({ where: { id: fdeC1.pendingActionId! }, select: { status: true } });
    ok(wE.spine.ok && !wE.spine.opportunityCreated && wE.spine.customerReplied && outcomesE.some((o) => o.outcomeType === "CUSTOMER_REPLIED") && !!wE.fde?.ok && !!wE.fde.pendingActionId && wE.fde.pendingActionId !== fdeC1.pendingActionId && scE.pending === 1 && scE.rejected >= scBeforeE.rejected && draftC1After?.status === "failed", "E：新来信 → inbound + CUSTOMER_REPLIED + 新 FDE 草稿（C 的过时草稿已 failed，商机未被永久压制）", { spine: wE.spine, fde: wE.fde?.pendingActionId, scE, draftC1After });

    // F — 授权：跨组织 / 失效成员 / 他组织线索
    const resF1 = await replyRoute(
      await routeReq(OTHER, "trade", `http://localhost/api/trade/inbox/${nProspect}/reply`, { orgId: ORG, subject: "x", body: "cross org", mode: "mark_sent" }),
      { params: Promise.resolve({ prospectId: nProspect }) },
    );
    ok(resF1.status === 403, "F：他组织成员显式指定本组织 → 403", resF1.status);
    await db.organizationMember.update({ where: { orgId_userId: { orgId: ORG, userId: TRADE } }, data: { status: "inactive" } });
    const resF2 = await replyRoute(
      await routeReq(TRADE, "trade", `http://localhost/api/trade/inbox/${nProspect}/reply`, { orgId: ORG, subject: "x", body: "inactive", mode: "mark_sent" }),
      { params: Promise.resolve({ prospectId: nProspect }) },
    );
    await db.organizationMember.update({ where: { orgId_userId: { orgId: ORG, userId: TRADE } }, data: { status: "active" } });
    ok(resF2.status === 403, "F：失效成员 → 403", resF2.status);
    const foreignProspect = await createProspect({ campaignId: await ensureInquiryCampaign(ORG2), orgId: ORG2, companyName: "Foreign Co", contactEmail: "f@foreign.example", source: "manual", stage: "new" });
    const resF3 = await replyRoute(
      await routeReq(TRADE, "trade", `http://localhost/api/trade/inbox/${foreignProspect.id}/reply`, { orgId: ORG, subject: "x", body: "foreign prospect", mode: "mark_sent" }),
      { params: Promise.resolve({ prospectId: foreignProspect.id }) },
    );
    ok(resF3.status === 404 && (await tradeCounts(foreignProspect.id)).outboundMsgs === 0, "F：本组织成员回复他组织线索 → 404，无写入", resF3.status);
    const tcAfterF = await tradeCounts(nProspect);
    ok(tcAfterF.outboundMsgs === 1, "F：授权失败不产生 TradeMessage", tcAfterF);

    // G — 反向镜像：审批发送的 FDE 回复出现在 Trade 时间线（幂等）
    const approveG = await approveApprovalItem("pending_action", wE.fde!.pendingActionId!, { userId: TRADE, role: "trade", orgId: ORG });
    const tcG = await tradeCounts(nProspect);
    const mirroredG = await db.tradeMessage.findFirst({ where: { prospectId: nProspect, direction: "outbound", content: { contains: "[青砚审批发送 · ref " } }, select: { id: true, subject: true } });
    ok(approveG.ok === true && sent.length === sentAtStart + 1 && tcG.outboundMsgs === 2 && !!mirroredG, "G：审批发送 → 一次真实发送 + Trade 时间线 outbound（收件箱视为已回复）", { approveG, tcG, mirroredG });
    const dupG = await approveApprovalItem("pending_action", wE.fde!.pendingActionId!, { userId: TRADE, role: "trade", orgId: ORG });
    ok(dupG.duplicate === true && sent.length === sentAtStart + 1 && (await tradeCounts(nProspect)).outboundMsgs === 2, "G：重复批准不重复发送、不重复镜像", { dupG, out: (await tradeCounts(nProspect)).outboundMsgs });
    const prospectG = await db.tradeProspect.findUnique({ where: { id: nProspect }, select: { stage: true, lastContactAt: true, nextFollowUpAt: true } });
    ok(prospectG?.stage !== "new" && !!prospectG?.lastContactAt && !!prospectG.nextFollowUpAt, "G：线索 stage/lastContactAt/nextFollowUpAt 随反向镜像更新", prospectG);
    // 收件箱「已处理」标记路径同样镜像
    const fdeH = await runInboundSalesFde({ orgId: ORG, opportunityId: nOpp, trigger: "manual", useLlm: false });
    const resH = await messagesRoute(
      await routeReq(TRADE, "trade", `http://localhost/api/trade/prospects/${nProspect}/messages`, { orgId: ORG, direction: "outbound", channel: "whatsapp", content: "已在系统外回复买家（收件箱标记）" }),
      { params: Promise.resolve({ id: nProspect }) },
    );
    const bodyH = (await resH.json()) as { revenueSync?: { linked: boolean; supersededPendingActionIds: string[] } };
    const draftH = fdeH.pendingActionId ? await db.pendingAction.findUnique({ where: { id: fdeH.pendingActionId }, select: { status: true } }) : null;
    ok(resH.status === 201 && bodyH.revenueSync?.linked === true && !!fdeH.pendingActionId && bodyH.revenueSync.supersededPendingActionIds.includes(fdeH.pendingActionId) && draftH?.status === "failed", "H：收件箱「已处理」标记（messages 路由 outbound）同样镜像并系统作废草稿", { status: resH.status, bodyH, draftH });

    // I — 非审批人的外贸员真实回复：作废旧草稿但绝不把审批人记成决策者
    const fdeI = await runInboundSalesFde({ orgId: ORG, opportunityId: nOpp, trigger: "manual", useLlm: false });
    if (!fdeI.ok || !fdeI.pendingActionId) throw new Error("fixture I: no pending draft");
    const draftIBefore = await db.pendingAction.findUnique({ where: { id: fdeI.pendingActionId }, select: { approverUserId: true, status: true } });
    ok(draftIBefore?.approverUserId === TRADE && draftIBefore.status === "pending", "I 前置：草稿审批人 = TRADE（USER_B），操作者将是 TRADE2（USER_A，非审批人、非管理员）", draftIBefore);
    const sentBeforeI = sent.length;
    const resI = await replyRoute(
      await routeReq(TRADE2, "trade", `http://localhost/api/trade/inbox/${nProspect}/reply`, { orgId: ORG, subject: "Re: sizes", body: "Confirming sizes, quotation to follow.", mode: "mark_sent" }),
      { params: Promise.resolve({ prospectId: nProspect }) },
    );
    const bodyI = (await resI.json()) as { ok?: boolean; messageId?: string; revenueSync?: { linked: boolean; interactionId: string | null; supersededPendingActionIds: string[]; supersedeFailures: unknown[] } };
    const draftI = await db.pendingAction.findUnique({ where: { id: fdeI.pendingActionId }, select: { status: true, failureReason: true, decidedById: true, decidedAt: true } });
    const interI = bodyI.revenueSync?.interactionId ? await db.customerInteraction.findUnique({ where: { id: bodyI.revenueSync.interactionId }, select: { createdById: true, direction: true } }) : null;
    const auditI = await db.auditLog.findFirst({ where: { orgId: ORG, action: "APPROVAL_SYSTEM_SUPERSEDED", targetId: fdeI.pendingActionId }, select: { userId: true, afterData: true } });
    const auditIData = auditData(auditI?.afterData);
    ok(resI.status === 200 && bodyI.ok === true && bodyI.revenueSync?.linked === true && interI?.direction === "outbound" && interI.createdById === TRADE2 && sent.length === sentBeforeI, "I：非审批人真实回复成功，outbound 互动归属 TRADE2，无第二封发送", { status: resI.status, bodyI, interI });
    ok(draftI?.status === "failed" && (draftI.failureReason ?? "").startsWith("SUPERSEDED_BY_MANUAL_REPLY") && (draftI.failureReason ?? "").includes(`triggeredBy=${TRADE2}`) && bodyI.revenueSync!.supersededPendingActionIds.includes(fdeI.pendingActionId) && bodyI.revenueSync!.supersedeFailures.length === 0, "I：草稿终止（failed/superseded），触发者 = TRADE2", draftI);
    ok(draftI?.decidedById !== TRADE && draftI?.decidedById === null && draftI.decidedAt === null, "I：decidedById 绝不伪造成审批人 TRADE（USER_B 未执行任何动作）", draftI);
    ok(!!auditI && auditI.userId === TRADE2 && auditIData.triggeredByUserId === TRADE2 && auditIData.reasonCode === "SUPERSEDED_BY_MANUAL_REPLY" && auditIData.terminationMode === "system_superseded" && auditIData.decidedById === null, "I：审计 = 系统作废，triggeredByUserId = TRADE2", { auditI });
    const lateI = await approveApprovalItem("pending_action", fdeI.pendingActionId, { userId: TRADE, role: "trade", orgId: ORG });
    ok(lateI.ok === false && sent.length === sentBeforeI, "I：审批人迟到批准 → 拒绝，无发送", lateI);

    // K — 伪造主体不可能：请求体里的 approverUserId / decidedById / actor 一律被忽略
    const fdeK = await runInboundSalesFde({ orgId: ORG, opportunityId: nOpp, trigger: "manual", useLlm: false });
    if (!fdeK.ok || !fdeK.pendingActionId) throw new Error("fixture K: no pending draft");
    const resK = await replyRoute(
      await routeReq(TRADE2, "trade", `http://localhost/api/trade/inbox/${nProspect}/reply`, { orgId: ORG, subject: "Re: forged", body: "forged principal attempt", mode: "mark_sent", approverUserId: OTHER, decidedById: OTHER, actor: OTHER, actorUserId: OTHER, triggeredByUserId: OTHER, userId: OTHER, systemActor: "system" }),
      { params: Promise.resolve({ prospectId: nProspect }) },
    );
    const bodyK = (await resK.json()) as { ok?: boolean; revenueSync?: { interactionId: string | null } };
    const interK = bodyK.revenueSync?.interactionId ? await db.customerInteraction.findUnique({ where: { id: bodyK.revenueSync.interactionId }, select: { createdById: true } }) : null;
    const draftK = await db.pendingAction.findUnique({ where: { id: fdeK.pendingActionId }, select: { status: true, failureReason: true, decidedById: true } });
    const auditK = await db.auditLog.findFirst({ where: { orgId: ORG, action: "APPROVAL_SYSTEM_SUPERSEDED", targetId: fdeK.pendingActionId }, select: { userId: true, afterData: true } });
    const auditKData = auditData(auditK?.afterData);
    ok(resK.status === 200 && interK?.createdById === TRADE2 && draftK?.status === "failed" && draftK.decidedById === null && (draftK.failureReason ?? "").includes(`triggeredBy=${TRADE2}`) && !(draftK.failureReason ?? "").includes(OTHER) && auditK?.userId === TRADE2 && auditKData.triggeredByUserId === TRADE2, "K：请求体伪造 approverUserId/decidedById/actor 全部被忽略，主体只来自服务端会话", { interK, draftK, auditK });
    const auditForged = await db.auditLog.count({ where: { orgId: ORG, action: "APPROVAL_SYSTEM_SUPERSEDED", userId: OTHER } });
    ok(auditForged === 0, "K：不存在以伪造主体记账的审计行", auditForged);

    console.log("\n[14] 网站桥接可靠性：eventId / 重放补齐 / 部分失败恢复 / FDE 重跑 / 电话-only / webhook 响应");
    const evt = (n: string) => `inq_${stamp}_${n}`;
    const R1 = { eventId: evt("r1"), name: "Rita Bridge", email: "rita@bridge-hotels.ca", company: "Bridge Hotels", country: "Canada", message: "We need 1,200 waffle bathrobes for a hotel refurbishment in Calgary. Please advise MOQ and lead time.", page: "https://www.mengxinhometextile.com/contact?utm_source=site", utm_source: "site" };
    const formR1 = normalizeInquiry(R1);
    if (!formR1.ok || formR1.value.honeypotTripped) throw new Error("fixture R1 failed");
    const r1 = await ingestWebsiteInquiry(ORG, formR1.value);
    const r1Spine = r1.spine.ok ? r1.spine : null;
    ok(!r1.replay && !r1.recovered && !!r1Spine && !r1Spine.replay && !!r1.fde?.ok && r1.fdeState?.status === "completed" && r1.fdeState.pendingActionId === r1.fde.pendingActionId && r1.fdeState.agentRunId === r1.fde.agentRunId, "R1：带 eventId 的全新询盘 → 主干 + FDE；fdeState 取自 SalesAction 且与运行结果一致", { replay: r1.replay, fde: r1.fde?.ok, state: r1.fdeState });
    type SourceRef = { sourceRef?: { externalId?: string; tradeMessageId?: string } } | null;
    const interR1 = r1Spine ? await db.customerInteraction.findUnique({ where: { id: r1Spine.interactionId }, select: { analysisResult: true } }) : null;
    const refR1 = (interR1?.analysisResult as SourceRef)?.sourceRef;
    ok(refR1?.externalId === R1.eventId && refR1?.tradeMessageId === r1.messageId, "R1：eventId 存入互动 sourceRef.externalId 并关联 Trade 消息 id（接收端解析 + 存储）", refR1);
    const cR1 = await wCounts(R1.email);
    ok(cR1.prospects === 1 && cR1.tradeMessages === 1 && cR1.customers === 1 && cR1.opportunities === 1 && cR1.interactions === 1 && cR1.runs === 1 && cR1.pending === 1, "R1 计数：1/1/1/1/1/1/1", cR1);

    const r2 = await ingestWebsiteInquiry(ORG, formR1.value);
    ok(r2.replay && !r2.recovered && r2.prospectId === r1.prospectId && r2.messageId === r1.messageId && r2.spine.ok && r2.spine.replay && r2.spine.opportunityId === r1Spine?.opportunityId && r2.spine.interactionId === r1Spine?.interactionId && r2.fde === null && r2.fdeState?.status === "completed" && r2.fdeState.pendingActionId === r1.fde?.pendingActionId, "R2：原样重放 → 返回既有 prospect/message/opportunity/interaction 与 FDE 状态，不新建、不重跑", { replay: r2.replay, spine: r2.spine, state: r2.fdeState });
    ok(JSON.stringify(await wCounts(R1.email)) === JSON.stringify(cR1), "R2 计数不变");

    const formR3 = normalizeInquiry({ ...R1, page: "https://www.mengxinhometextile.com/contact?utm_source=retry", utm_source: "retry" });
    if (!formR3.ok || formR3.value.honeypotTripped) throw new Error("fixture R3 failed");
    const r3 = await ingestWebsiteInquiry(ORG, formR3.value);
    ok(r3.replay && r3.messageId === r1.messageId && r3.spine.ok && r3.spine.opportunityId === r1Spine?.opportunityId && r3.fde === null, "R3：同 eventId、不同来源页（正文不同）→ 仍按事件 ID 重放（接收端使用 eventId）", { replay: r3.replay, messageId: r3.messageId });
    ok(JSON.stringify(await wCounts(R1.email)) === JSON.stringify(cR1), "R3 计数不变（未新建消息/互动）");

    // R4：Trade 已落库、主干缺失（模拟上一次 SPINE_FAILED / 处理中途被杀）
    const R4 = { eventId: evt("r4"), name: "Paul Partial", email: "paul@partial-inn.ca", company: "Partial Inn", country: "Canada", message: "Quote for 600 hotel slippers and 300 coral fleece blankets, ship to Montreal." };
    const formR4 = normalizeInquiry(R4);
    if (!formR4.ok || formR4.value.honeypotTripped) throw new Error("fixture R4 failed");
    const campaign4 = await db.tradeCampaign.findFirst({ where: { orgId: ORG, name: "网站询盘" }, select: { id: true } });
    if (!campaign4) throw new Error("fixture R4: campaign missing");
    const p4 = await db.tradeProspect.create({ data: { campaignId: campaign4.id, orgId: ORG, companyName: "Partial Inn", contactName: "Paul Partial", contactEmail: R4.email, country: "Canada", source: "website", stage: "replied" }, select: { id: true } });
    const m4 = await db.tradeMessage.create({ data: { prospectId: p4.id, direction: "inbound", channel: "website", subject: "网站询盘", content: buildInquiryMessage(formR4.value) }, select: { id: true } });
    const r4 = await ingestWebsiteInquiry(ORG, formR4.value);
    ok(r4.replay && r4.recovered && r4.prospectId === p4.id && r4.messageId === m4.id && r4.spine.ok && !r4.spine.replay && r4.spine.opportunityCreated && !!r4.fde?.ok && r4.fdeState?.status === "completed", "R4：Trade 已存但主干缺失 → 重放补建主干 + FDE，关联原消息、不改正文", { replay: r4.replay, recovered: r4.recovered, spine: r4.spine.ok, fde: r4.fde?.ok });
    const p4after = await db.tradeProspect.findUnique({ where: { id: p4.id }, select: { convertedToSalesOpportunityId: true, convertedAt: true } });
    const cR4 = await wCounts(R4.email);
    ok(p4after?.convertedToSalesOpportunityId === (r4.spine.ok ? r4.spine.opportunityId : "") && !!p4after?.convertedAt && cR4.prospects === 1 && cR4.tradeMessages === 1 && cR4.customers === 1 && cR4.opportunities === 1 && cR4.interactions === 1 && cR4.runs === 1 && cR4.pending === 1, "R4 计数：线索 1 / 消息 1 / 客户 1 / 商机 1 / 互动 1 / 运行 1 / 草稿 1，线索已链接商机", { p4after, cR4 });
    const inter4 = await db.customerInteraction.findUnique({ where: { id: r4.spine.ok ? r4.spine.interactionId : "" }, select: { analysisResult: true } });
    const ref4 = (inter4?.analysisResult as SourceRef)?.sourceRef;
    ok(ref4?.tradeMessageId === m4.id && ref4?.externalId === R4.eventId, "R4：补建的互动仍指向原始 Trade 消息与 eventId", ref4);
    const r4b = await ingestWebsiteInquiry(ORG, formR4.value);
    ok(r4b.replay && !r4b.recovered && r4b.spine.ok && r4b.spine.replay && r4b.fde === null && JSON.stringify(await wCounts(R4.email)) === JSON.stringify(cR4), "R4：补齐后再重放 → 纯重放，不再恢复", { recovered: r4b.recovered });

    // R5：FDE 曾失败 → 重放重跑；running 未超时 → 不重跑；running 超时（stale）→ 重跑
    const actionR1 = r1Spine ? await db.salesAction.findFirst({ where: { orgId: ORG, signalKey: `inbound:${r1Spine.interactionId}` }, select: { id: true, inputContext: true } }) : null;
    if (!actionR1) throw new Error("fixture R5: SalesAction missing");
    const patchFde = async (fdeStatus: string) => {
      const cur = await db.salesAction.findUniqueOrThrow({ where: { id: actionR1.id }, select: { inputContext: true } });
      await db.salesAction.update({ where: { id: actionR1.id }, data: { inputContext: { ...((cur.inputContext as Record<string, unknown> | null) ?? {}), fdeStatus } } });
    };
    await patchFde("failed");
    const r5 = await ingestWebsiteInquiry(ORG, formR1.value);
    const cR5 = await wCounts(R1.email);
    ok(r5.replay && r5.recovered && !!r5.fde?.ok && r5.fdeState?.status === "completed" && cR5.runs === cR1.runs + 1 && cR5.tradeMessages === 1 && cR5.interactions === 1 && cR5.pending === 1 && cR5.superseded === 0, "R5：FDE 曾失败 → 重放重跑 FDE（运行 +1），消息/互动不重复，未决草稿复用为 1", { recovered: r5.recovered, fde: r5.fde?.ok, cR5 });
    await patchFde("running");
    const r5b = await ingestWebsiteInquiry(ORG, formR1.value);
    ok(r5b.replay && !r5b.recovered && r5b.fde === null && r5b.fdeState?.status === "running" && (await wCounts(R1.email)).runs === cR5.runs, "R5：FDE running（未超时）→ 重放不重跑（避免并发双跑）", { state: r5b.fdeState });
    await db.$executeRaw`UPDATE "SalesAction" SET "updatedAt" = NOW() - interval '20 minutes' WHERE "id" = ${actionR1.id}`;
    const r5c = await ingestWebsiteInquiry(ORG, formR1.value);
    const cR5c = await wCounts(R1.email);
    ok(r5c.replay && r5c.recovered && !!r5c.fde?.ok && r5c.fdeState?.status === "completed" && cR5c.runs === cR5.runs + 1, "R5：FDE running 超过 10 分钟（stale_running）→ 视为中断并重跑", { state: r5c.fdeState, runs: cR5c.runs });

    // R6：电话-only 询盘重放（无邮箱不再复制线索）
    const formR6 = normalizeInquiry({ name: "Ali WhatsApp", whatsapp: "+1 555 0199", message: "Price for 500 coral fleece blankets 150x200?" });
    if (!formR6.ok || formR6.value.honeypotTripped) throw new Error("fixture R6 failed");
    const r6a = await ingestWebsiteInquiry(ORG, formR6.value, { runFde: false });
    const r6b = await ingestWebsiteInquiry(ORG, formR6.value, { runFde: false });
    const prospects6 = await db.tradeProspect.count({ where: { orgId: ORG, companyName: "Ali WhatsApp" } });
    const messages6 = await db.tradeMessage.count({ where: { prospect: { orgId: ORG, companyName: "Ali WhatsApp" }, direction: "inbound" } });
    ok(!r6a.replay && r6b.replay && r6b.prospectId === r6a.prospectId && r6b.messageId === r6a.messageId && prospects6 === 1 && messages6 === 1, "R6：电话-only 询盘重放 → 不复制线索/消息（按 org 内正文匹配）", { prospects6, messages6 });

    // R7：真实 webhook 路由（密钥鉴权）的响应字段
    await db.tradeChannel.create({ data: { orgId: ORG, channel: "website", name: "fixture site", status: "active", config: { secret: `s3cret_${stamp}` } } });
    const { POST: webhookPost } = await import("@/app/api/trade/webhook/website/route");
    type WebhookBody = { ok?: boolean; eventId?: string | null; prospectId?: string; messageId?: string; opportunityId?: string | null; spine?: string; replay?: boolean; recovered?: boolean; fde?: { status?: string; pendingActionId?: string | null; agentRunId?: string | null } | null; error?: string };
    const hitWebhook = async (body: Record<string, unknown>, secret = `s3cret_${stamp}`) => {
      const res = await webhookPost(new NextRequest("http://localhost/api/trade/webhook/website", { method: "POST", headers: { "content-type": "application/json", "x-qingyan-webhook-secret": secret }, body: JSON.stringify(body) }));
      return { status: res.status, body: (await res.json()) as WebhookBody };
    };
    const R7 = { eventId: evt("r7"), name: "Wendy Webhook", email: "wendy@webhook-suites.ca", company: "Webhook Suites", country: "Canada", message: "Need 900 bath towels 70x140cm for a resort in Kelowna. MOQ and price please." };
    const h1 = await hitWebhook(R7);
    ok(h1.status === 200 && h1.body.ok === true && h1.body.eventId === R7.eventId && !!h1.body.prospectId && !!h1.body.messageId && !!h1.body.opportunityId && h1.body.spine === "ok" && h1.body.replay === false && h1.body.recovered === false && h1.body.fde?.status === "completed" && !!h1.body.fde?.pendingActionId && !!h1.body.fde?.agentRunId, "R7：webhook 首发响应含 eventId / messageId / opportunityId / spine / fde（真实记录）", h1.body);
    const h2 = await hitWebhook(R7);
    ok(h2.status === 200 && h2.body.replay === true && h2.body.recovered === false && h2.body.prospectId === h1.body.prospectId && h2.body.messageId === h1.body.messageId && h2.body.opportunityId === h1.body.opportunityId && h2.body.spine === "replay" && h2.body.fde?.status === "completed" && h2.body.fde?.pendingActionId === h1.body.fde?.pendingActionId, "R7：webhook 重放响应返回真实下游 ID 与 FDE 状态（不再是 REPLAY + opportunityId null）", h2.body);
    const cR7 = await wCounts(R7.email);
    const h3 = await hitWebhook(R7, "wrong-secret");
    ok(h3.status === 401 && JSON.stringify(await wCounts(R7.email)) === JSON.stringify(cR7), "R7：错误密钥 → 401，不落库", h3);
    ok(cR7.prospects === 1 && cR7.tradeMessages === 1 && cR7.opportunities === 1 && cR7.interactions === 1 && cR7.runs === 1 && cR7.pending === 1, "R7 计数：1/1/1/1/1/1", cR7);

    console.log("\n[10] Audit trail");
    const audits = await db.auditLog.count({ where: { orgId: ORG, action: { in: ["revenue_spine.inquiry.intake", "revenue_spine.opportunity.transition", "revenue_spine.inquiry_reply.sent", "employee_ai.outcome.create"] } } });
    ok(audits >= 10, "审计日志覆盖 intake / transition / send / outcome", audits);
  } finally {
    __setInquiryReplySenderForTest(null);
    // 清理（按依赖顺序；级联删除覆盖 RFQ/证据/评估/行动）
    for (const orgId of [ORG, ORG2]) {
      const opps = await db.salesOpportunity.findMany({ where: { orgId }, select: { id: true } });
      const oppIds = opps.map((o) => o.id);
      await db.businessOutcome.deleteMany({ where: { orgId } });
      const prospectsToClean = await db.tradeProspect.findMany({ where: { orgId }, select: { id: true } });
      await db.tradeMessage.deleteMany({ where: { prospectId: { in: prospectsToClean.map((p) => p.id) } } });
      await db.tradeProspect.deleteMany({ where: { orgId } });
      await db.tradeCampaign.deleteMany({ where: { orgId } });
      await db.tradeChannel.deleteMany({ where: { orgId } });
      await db.pendingAction.deleteMany({ where: { orgId } });
      await db.notification.deleteMany({ where: { orgId } });
      await db.customerInteraction.deleteMany({ where: { orgId } });
      await db.salesAction.deleteMany({ where: { orgId } });
      await db.salesRfqEvidence.deleteMany({ where: { orgId } });
      await db.salesRfq.deleteMany({ where: { orgId } });
      await db.salesOpportunityAssessment.deleteMany({ where: { orgId } });
      await db.salesOpportunity.deleteMany({ where: { id: { in: oppIds } } });
      await db.salesCustomer.deleteMany({ where: { orgId } });
      await db.agentRunEvent.deleteMany({ where: { orgId } });
      await db.agentRun.deleteMany({ where: { orgId } });
      await db.agentSession.deleteMany({ where: { orgId } });
      await db.orgBusinessRule.deleteMany({ where: { orgId } });
      await db.auditLog.deleteMany({ where: { orgId } });
      await db.organizationMember.deleteMany({ where: { orgId } });
    }
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.auditLog.deleteMany({ where: { userId: { in: [OWNER, TRADE, OTHER, TRADE2] } } });
    await db.notification.deleteMany({ where: { userId: { in: [OWNER, TRADE, OTHER, TRADE2] } } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, TRADE, OTHER, TRADE2] } } });
  }

  console.log(`\nRevenue Spine DB e2e 结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  });
