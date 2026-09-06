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
  const { ingestWebsiteInquiry, normalizeInquiry } = await import("@/lib/trade/website-inquiry");
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

  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Lucas Owner", role: "boss" } });
  await db.user.create({ data: { id: TRADE, email: `${TRADE}@fixture.test`, name: "Mengxin Trade Rep", role: "trade" } });
  await db.user.create({ data: { id: OTHER, email: `${OTHER}@fixture.test`, name: "Other Org User", role: "trade" } });
  await db.organization.create({ data: { id: ORG, name: "Mengxin Fixture OEM", code: `rs-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Other Fixture Org", code: `rs2-${stamp}`, ownerId: OTHER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_owner", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: TRADE, role: "org_member", status: "active" } });
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
    const inactive = await db.organizationMember.update({ where: { orgId_userId: { orgId: ORG, userId: TRADE } }, data: { status: "inactive" } }).catch(() => null);
    const approvedByTrade = await approveApprovalItem("pending_action", fdeRedo.pendingActionId!, { userId: TRADE, role: "trade", orgId: ORG });
    ok(approvedByTrade.ok === true, "负责人（approverUserId）批准 → 发送", approvedByTrade);
    if (inactive) await db.organizationMember.update({ where: { orgId_userId: { orgId: ORG, userId: TRADE } }, data: { status: "active" } });
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
    ok(fde2.ok && fde2.stage === "rfq_ready", "补充信息后 → rfq_ready", { stage: fde2.stage, missing: fde2.missing });
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
      };
    };
    const formA = normalizeInquiry({ name: "Mark Chen", email: "mark@maple-hotels.ca", company: "Maple Hotels Group", country: "Canada", message: ACCEPTANCE, page: "https://www.mengxinhometextile.com/contact?utm_source=ads", utm_source: "ads" });
    if (!formA.ok || formA.value.honeypotTripped) throw new Error("fixture normalize failed");
    const w1 = await ingestWebsiteInquiry(ORG, formA.value);
    ok(!w1.duplicate && !w1.replay && w1.spine.ok && w1.spine.opportunityCreated && !!w1.fde?.ok, "Case A：全新询盘 → 线索 + 消息 + 客户 + 商机 + FDE", { duplicate: w1.duplicate, spine: w1.spine.ok, fde: w1.fde?.ok });
    const cA = await wCounts("mark@maple-hotels.ca");
    ok(cA.prospects === 1 && cA.tradeMessages === 1 && cA.customers === 1 && cA.opportunities === 1 && cA.interactions === 1 && cA.rfqs === 1 && cA.runs === 1 && cA.pending === 1, "Case A 计数：1/1/1/1/1/1/1/1", cA);
    const prospectA = await db.tradeProspect.findFirst({ where: { orgId: ORG, contactEmail: "mark@maple-hotels.ca" } });
    ok(prospectA?.convertedToSalesOpportunityId === (w1.spine.ok ? w1.spine.opportunityId : null) && prospectA?.stage === "replied", "Trade 线索 ↔ 商机链接 + Trade Inbox 阶段 replied", prospectA);
    const w2 = await ingestWebsiteInquiry(ORG, formA.value);
    ok(w2.replay && w2.duplicate && w2.messageId === w1.messageId && !w2.spine.ok && w2.spine.code === "REPLAY" && w2.fde === null, "Case B：原样重放 → replay，不建任何对象", { replay: w2.replay, spine: w2.spine });
    const cB = await wCounts("mark@maple-hotels.ca");
    ok(JSON.stringify(cB) === JSON.stringify(cA), "Case B 计数不变", cB);
    const spineReplay = await intakeInquiry({ orgId: ORG, source: "website_inquiry", contact: { name: "Mark Chen", email: "mark@maple-hotels.ca", company: "Maple Hotels Group" }, message: ACCEPTANCE, product: null });
    ok(spineReplay.ok && spineReplay.replay && spineReplay.interactionId === (w1.spine.ok ? w1.spine.interactionId : ""), "Case B（主干层）：intakeInquiry 自身也幂等", spineReplay);
    const formC = normalizeInquiry({ name: "Mark Chen", email: "mark@maple-hotels.ca", message: "Sizes are 140x260cm, material 100% polyester blackout, ship to Vancouver by 2026-12-15." });
    if (!formC.ok || formC.value.honeypotTripped) throw new Error("fixture C failed");
    const w3 = await ingestWebsiteInquiry(ORG, formC.value);
    ok(w3.duplicate && !w3.replay && w3.spine.ok && !w3.spine.opportunityCreated && w3.spine.attachedToExisting && !!w3.fde?.ok, "Case C：同买家新内容 → 新消息/互动，复用商机", { spine: w3.spine.ok, fde: w3.fde?.ok });
    const cC = await wCounts("mark@maple-hotels.ca");
    ok(cC.prospects === 1 && cC.tradeMessages === 2 && cC.customers === 1 && cC.opportunities === 1 && cC.interactions === 2 && cC.rfqs === 1 && cC.runs === 2 && cC.pending === 1 && cC.rejected === 1, "Case C 计数：线索 1 / 消息 2 / 客户 1 / 商机 1 / 互动 2 / RFQ 1 / 运行 2 / 未决草稿 1（旧草稿已被取代）", cC);
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
    await db.auditLog.deleteMany({ where: { userId: { in: [OWNER, TRADE, OTHER] } } });
    await db.notification.deleteMany({ where: { userId: { in: [OWNER, TRADE, OTHER] } } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, TRADE, OTHER] } } });
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
