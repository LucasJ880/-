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
/** 失败明细留给诊断转储（清库前保存），不只打印在滚动日志里 */
const failures: Array<{ name: string; detail: string }> = [];
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    const rendered = detail !== undefined ? JSON.stringify(detail).slice(0, 2000) : "";
    failures.push({ name, detail: rendered });
    console.error(`  ✗ ${name}`, rendered.slice(0, 600));
  }
}

/**
 * 诊断转储：在测试库被清理之前，把失败判定与相关运行态写成文件。
 * 邮箱只保留域名，正文只留前 200 字符。默认仅在有失败时写；QY_DIAG_ALWAYS=1 时每次都写。
 */
async function captureDiagnostics(orgId: string, stamp: string, failures: Array<{ name: string; detail: string }>, thrown?: unknown) {
  if (failures.length === 0 && !thrown && process.env.QY_DIAG_ALWAYS !== "1") return;
  const { writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { db } = await import("@/lib/db");
  const mask = (email?: string | null) => (email ? `***@${email.split("@")[1] ?? "?"}` : null);
  const opportunities = await db.salesOpportunity.findMany({
    where: { orgId },
    select: { id: true, stage: true, score: true, scoreGrade: true, assignedToId: true, customer: { select: { id: true, email: true, name: true } } },
  });
  const actions = await db.salesAction.findMany({
    where: { orgId },
    select: { id: true, opportunityId: true, status: true, signalKey: true, agentRunId: true, pendingActionId: true, inputContext: true, updatedAt: true },
  });
  const runs = await db.agentRun.findMany({
    where: { orgId, runType: "fde_inbound_sales" },
    select: { id: true, status: true, errorCode: true, errorMessage: true, metadata: true, createdAt: true },
  });
  const drafts = await db.pendingAction.findMany({
    where: { orgId },
    select: { id: true, type: true, status: true, failureReason: true, decidedById: true, expiresAt: true, createdAt: true, idempotencyKey: true },
  });
  const receipts = await db.websiteInquiryReceipt.findMany({
    where: { orgId },
    select: { id: true, eventId: true, eventIdProvided: true, status: true, attempts: true, conflictCount: true, duplicateOfReceiptId: true, prospectId: true, tradeMessageId: true, customerId: true, opportunityId: true, interactionId: true, salesActionId: true, agentRunId: true, pendingActionId: true },
  });
  const interactions = await db.customerInteraction.findMany({
    where: { orgId },
    select: { id: true, opportunityId: true, direction: true, channel: true, content: true, createdAt: true },
  });
  const dir = process.env.QY_DIAG_DIR || "/tmp";
  const file = path.join(dir, `revenue-spine-diag-${stamp}.json`);
  const payload = {
    capturedAt: new Date().toISOString(),
    orgId,
    failures,
    thrown: thrown ? { message: thrown instanceof Error ? thrown.message : String(thrown), stack: thrown instanceof Error ? (thrown.stack ?? "").split("\n").slice(0, 6) : [] } : null,
    opportunities: opportunities.map((o) => ({ ...o, customer: { id: o.customer.id, name: o.customer.name, email: mask(o.customer.email) } })),
    salesActions: actions.map((a) => ({ ...a, fdeStatus: ((a.inputContext ?? {}) as Record<string, unknown>).fdeStatus ?? null, inputContext: undefined })),
    agentRuns: runs,
    pendingActions: drafts,
    receipts,
    interactions: interactions.map((i) => ({ ...i, content: (i.content ?? "").slice(0, 200) })),
  };
  await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n[diag] 诊断已保存（清库前）：${file}（失败 ${failures.length} 项）`);
}

const ACCEPTANCE =
  "We are a hotel supplier in Canada and are looking for 3,000 blackout curtains for an upcoming hotel project. Please advise MOQ, pricing and delivery time.";

async function main() {
  const { db } = await import("@/lib/db");
  const { intakeInquiry } = await import("../inquiry-intake");
  const { runInboundSalesFde: runInboundSalesFdeRaw, INQUIRY_REPLY_ACTION_TYPE } = await import("../fde/inbound-sales");
  const { transitionOpportunity } = await import("../transition");
  const { logRevenueInteraction } = await import("../interactions");
  const { computeFdeAttribution } = await import("../attribution");
  const { computeRevenueCockpit } = await import("../cockpit");
  const { buildRevenueQueue } = await import("../daily-actions");
  const { listOpportunityOutcomes } = await import("../outcomes");
  const { loadRevenueSpinePolicy, publishRevenueSpineRule, RULE_KEY_POLICY } = await import("../policy");
  const { ingestWebsiteInquiry: ingestWebsiteInquiryRaw, normalizeInquiry, buildInquiryMessage } = await import("@/lib/trade/website-inquiry");
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

  /**
   * 平台配额与本套件的关系（不是放宽断言，是消除与被测行为无关的限流）：
   * MAX_CONCURRENT_RUNS 平台 hard=10，占用量 =「running/claimed/queued 的 run」+「未过期的 RESERVED 预留」。
   * createAgentRun 会预留一个并发额度，但**没有任何终态路径释放它**（run.ts 只在创建失败时 release），
   * 只能等 5 分钟 TTL 过期。组织级策略只能收紧、不能放宽（resolve.ts 的 tighter()），所以无法用配置抬高。
   * 本套件是严格串行的（任何时刻只有一个 run 在跑，不存在真实并发），但几分钟内要跑几十次 FDE，
   * 于是会被这条并发闸挡住。下面这个 helper 等价于「时间过去了 5 分钟」：只清理夹具组织自己的并发预留，
   * 不改任何限额、不碰任何被测状态。生产侧的真实影响见报告 R4-2。
   */
  const releaseFixtureRunSlots = async () => {
    await db.capabilityQuotaReservation.deleteMany({
      where: { orgId: { in: [ORG, ORG2] }, metric: "MAX_CONCURRENT_RUNS" },
    });
  };
  // 每次会触发 FDE 的调用前先"让时间过去"，把平台并发闸排除在被测范围之外
  const runInboundSalesFde = async (...args: Parameters<typeof runInboundSalesFdeRaw>) => {
    await releaseFixtureRunSlots();
    return runInboundSalesFdeRaw(...args);
  };
  const ingestWebsiteInquiry = async (...args: Parameters<typeof ingestWebsiteInquiryRaw>) => {
    await releaseFixtureRunSlots();
    return ingestWebsiteInquiryRaw(...args);
  };

  let thrownError: unknown = null;
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

    await releaseFixtureRunSlots();
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

    await releaseFixtureRunSlots();
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
    if (!fdeI.ok || !fdeI.pendingActionId) throw new Error(`fixture I: no pending draft (${JSON.stringify({ ok: fdeI.ok, errorCode: fdeI.errorCode, error: fdeI.error, stage: fdeI.stage, grade: fdeI.grade, approvalRequired: fdeI.approvalRequired, agentRunId: fdeI.agentRunId })})`);
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
    if (!fdeK.ok || !fdeK.pendingActionId) throw new Error(`fixture K: no pending draft (${JSON.stringify({ ok: fdeK.ok, errorCode: fdeK.errorCode, error: fdeK.error, stage: fdeK.stage, approvalRequired: fdeK.approvalRequired })})`);
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

    await releaseFixtureRunSlots();
    console.log("\n[14] 事件身份（收据）：最早边界持久化 / 按 id 重放 / 窗口外恢复 / 冲突不覆盖");
    const { claimInquiryReceipt, computePayloadHash, findReceiptByEventId } = await import("@/lib/trade/website-inquiry-receipts");
    const evt = (n: string) => `inq_${stamp}_${n}`;
    const R1 = {
      eventId: evt("r1"),
      name: "Rita Bridge",
      email: "rita@bridge-hotels.ca",
      company: "Bridge Hotels",
      country: "Canada",
      message: "We need 1,200 waffle bathrobes for a hotel refurbishment in Calgary. Please advise MOQ and lead time.",
      page: "https://www.mengxinhometextile.com/contact?utm_source=site",
      utm_source: "site",
    };
    const formR1 = normalizeInquiry(R1);
    if (!formR1.ok || formR1.value.honeypotTripped) throw new Error("fixture R1 failed");

    // 事件身份必须在任何业务对象之前落库：单独认领一次，确认此刻还没有任何业务对象
    const probeForm = normalizeInquiry({ ...R1, eventId: evt("probe"), email: "probe@bridge-hotels.ca" });
    if (!probeForm.ok) throw new Error("fixture probe failed");
    const probeClaim = await claimInquiryReceipt(ORG, probeForm.value);
    const probeProspects = await db.tradeProspect.count({ where: { orgId: ORG, contactEmail: "probe@bridge-hotels.ca" } });
    ok(
      probeClaim.created &&
        probeClaim.receipt.status === "processing" &&
        probeClaim.receipt.tradeMessageId === null &&
        probeClaim.receipt.payloadHash === computePayloadHash(probeForm.value) &&
        probeProspects === 0,
      "事件身份在最早边界落库：收据先于 Trade 线索/消息存在",
      { status: probeClaim.receipt.status, msg: probeClaim.receipt.tradeMessageId, probeProspects },
    );
    // 同一事件并发到达：后到者不并行执行（单执行者控制）
    const busyClaim = await claimInquiryReceipt(ORG, probeForm.value);
    ok(busyClaim.busy && !busyClaim.created && busyClaim.receipt.id === probeClaim.receipt.id, "同一事件正在处理中 → 后到者 busy，不并行", { busy: busyClaim.busy });
    const busyIngest = await ingestWebsiteInquiry(ORG, probeForm.value);
    ok(
      busyIngest.busy && busyIngest.recoveredSteps.length === 0 && (await db.tradeProspect.count({ where: { orgId: ORG, contactEmail: "probe@bridge-hotels.ca" } })) === 0,
      "busy 时不执行任何步骤（不重复建对象）",
      { busy: busyIngest.busy, steps: busyIngest.recoveredSteps },
    );
    await db.websiteInquiryReceipt.update({ where: { id: probeClaim.receipt.id }, data: { status: "received", processingSince: null } });

    const r1 = await ingestWebsiteInquiry(ORG, formR1.value);
    const r1Spine = r1.spine.ok ? r1.spine : null;
    ok(
      !r1.replay && !r1.recovered && !!r1Spine && !!r1.fde?.ok && r1.fdeState?.status === "completed" && r1.fdeState.terminal && r1.complete,
      "R1：全新事件 → 主干 + FDE；fdeState 取自真实记录且为终态，complete=true",
      { replay: r1.replay, fde: r1.fde?.ok, state: r1.fdeState, complete: r1.complete },
    );
    const receiptR1 = await findReceiptByEventId(ORG, R1.eventId);
    ok(
      receiptR1?.status === "complete" &&
        receiptR1.tradeMessageId === r1.messageId &&
        receiptR1.opportunityId === r1Spine?.opportunityId &&
        receiptR1.interactionId === r1Spine?.interactionId &&
        !!receiptR1.salesActionId &&
        receiptR1.pendingActionId === r1.fde?.pendingActionId,
      "R1：收据回填全部下游对象 id（消息/商机/互动/行动/草稿）",
      receiptR1,
    );
    type SourceRef = { sourceRef?: { externalId?: string; tradeMessageId?: string } } | null;
    const interR1 = r1Spine ? await db.customerInteraction.findUnique({ where: { id: r1Spine.interactionId }, select: { analysisResult: true } }) : null;
    const refR1 = (interR1?.analysisResult as SourceRef)?.sourceRef;
    ok(refR1?.externalId === R1.eventId && refR1?.tradeMessageId === r1.messageId, "R1：eventId 同时写入互动 sourceRef.externalId", refR1);
    const cR1 = await wCounts(R1.email);
    ok(cR1.prospects === 1 && cR1.tradeMessages === 1 && cR1.customers === 1 && cR1.opportunities === 1 && cR1.interactions === 1 && cR1.runs === 1 && cR1.pending === 1, "R1 计数：1/1/1/1/1/1/1", cR1);

    // ① 同 eventId 重复请求 → 重放，不新建任何对象，不重跑 FDE
    const r2 = await ingestWebsiteInquiry(ORG, formR1.value);
    ok(
      r2.replay && !r2.recovered && r2.messageId === r1.messageId && r2.spine.ok && r2.spine.replay && r2.spine.opportunityId === r1Spine?.opportunityId && r2.fde === null && r2.fdeState?.terminal === true,
      "①：同 eventId 重复请求 → 重放，返回既有对象与终态 FDE，不重跑",
      { replay: r2.replay, spine: r2.spine, state: r2.fdeState },
    );
    ok(JSON.stringify(await wCounts(R1.email)) === JSON.stringify(cR1), "① 计数不变");

    // ② 超出旧正文去重窗口（>24h）后按事件 id 恢复：仍是同一事件，不新建询盘
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const r3 = await ingestWebsiteInquiry(ORG, formR1.value, { now: later });
    ok(
      r3.replay && r3.messageId === r1.messageId && r3.spine.ok && r3.spine.opportunityId === r1Spine?.opportunityId,
      "②：超过 24h 正文窗口后同 eventId 重发 → 仍关联原事件（不再依赖正文匹配）",
      { replay: r3.replay, messageId: r3.messageId },
    );
    ok(JSON.stringify(await wCounts(R1.email)) === JSON.stringify(cR1), "② 计数不变（窗口外未复制询盘）");

    // ③ 同 eventId、冲突业务内容 → 只记冲突，不覆盖原始事实
    const conflictForm = normalizeInquiry({ ...R1, message: "Actually make it 5,000 pieces and add slippers.", company: "Bridge Hotels Group" });
    if (!conflictForm.ok) throw new Error("fixture conflict failed");
    const r4 = await ingestWebsiteInquiry(ORG, conflictForm.value);
    const msgR1 = await db.tradeMessage.findUnique({ where: { id: r1.messageId }, select: { content: true } });
    const receiptAfterConflict = await findReceiptByEventId(ORG, R1.eventId);
    ok(
      r4.conflict && r4.replay && r4.messageId === r1.messageId && (msgR1?.content ?? "").includes("1,200 waffle bathrobes") && !(msgR1?.content ?? "").includes("5,000 pieces"),
      "③：同 eventId 冲突内容 → 标记 conflict，原始事实未被覆盖",
      { conflict: r4.conflict, content: msgR1?.content?.slice(0, 60) },
    );
    ok(
      receiptAfterConflict?.conflictCount === 1 && !!receiptAfterConflict.lastConflictAt && receiptAfterConflict.payloadHash === computePayloadHash(formR1.value),
      "③：收据记录冲突次数，载荷仍是首次事实",
      { conflictCount: receiptAfterConflict?.conflictCount },
    );
    // 来源页/UTM 变化不算冲突（非业务字段）
    const pageOnly = normalizeInquiry({ ...R1, page: "https://www.mengxinhometextile.com/products/bathrobes?utm_source=ads", utm_source: "ads" });
    if (!pageOnly.ok) throw new Error("fixture pageOnly failed");
    const r5 = await ingestWebsiteInquiry(ORG, pageOnly.value);
    const receiptAfterPage = await findReceiptByEventId(ORG, R1.eventId);
    ok(!r5.conflict && receiptAfterPage?.conflictCount === 1, "③：仅来源页/UTM 变化不算业务冲突", { conflict: r5.conflict, conflictCount: receiptAfterPage?.conflictCount });

    // ④ 两个不同 eventId、相同内容 → 各自有记录，不被正文去重静默吞掉
    const twinForm = normalizeInquiry({ ...R1, eventId: evt("r1twin") });
    if (!twinForm.ok) throw new Error("fixture twin failed");
    const r6 = await ingestWebsiteInquiry(ORG, twinForm.value);
    const twinReceipt = await findReceiptByEventId(ORG, evt("r1twin"));
    ok(
      !!twinReceipt && twinReceipt.duplicateOfReceiptId === receiptR1?.id && r6.contentDuplicateOf === receiptR1?.id && r6.messageId === r1.messageId,
      "④：不同 eventId 相同内容 → 独立收据并指向原事件（有记录，不静默吞掉），业务对象复用",
      { twin: twinReceipt?.eventId, dup: r6.contentDuplicateOf },
    );
    ok(JSON.stringify(await wCounts(R1.email)) === JSON.stringify(cR1), "④ 计数不变（未重复建询盘）");

    // ⑤ 旧接口（无 eventId）：服务端派生身份，保留 24h 正文窗口语义
    const legacyRaw = { name: "Legacy Buyer", email: "legacy@old-form.ca", company: "Old Form Ltd", country: "Canada", message: "Do you make 300 GSM cotton towels? Need 500 pcs." };
    const legacy1 = normalizeInquiry(legacyRaw);
    const legacy2 = normalizeInquiry(legacyRaw);
    if (!legacy1.ok || !legacy2.ok) throw new Error("fixture legacy failed");
    const l1 = await ingestWebsiteInquiry(ORG, legacy1.value, { runFde: false });
    const l2 = await ingestWebsiteInquiry(ORG, legacy2.value, { runFde: false });
    // 只数这条 legacy 内容对应的收据（同套件里其它无 eventId 的夹具也会派生身份）
    const legacyReceipts = await db.websiteInquiryReceipt.count({
      where: { orgId: ORG, eventIdProvided: false, payloadHash: computePayloadHash(legacy1.value) },
    });
    ok(
      !l1.replay && l2.replay && l2.messageId === l1.messageId && legacyReceipts === 1 && l1.eventId.startsWith("sha256:"),
      "⑤：无 eventId → 派生身份，窗口内同内容仍是同一事件",
      { l1: l1.eventId.slice(0, 20), replay: l2.replay, legacyReceipts },
    );
    const l3 = await ingestWebsiteInquiry(ORG, legacy2.value, { runFde: false, now: new Date(Date.now() + 25 * 60 * 60 * 1000) });
    ok(!l3.replay && l3.messageId !== l1.messageId, "⑤：派生身份在窗口外是新事件（保持旧语义）", { replay: l3.replay });

    await releaseFixtureRunSlots();
    console.log("\n[15] 中间步骤补齐：逐项核对七个对象 + 不复活已终结动作");
    // A. 互动已建、SalesAction 缺失
    const A = { eventId: evt("a"), name: "Alan Gap", email: "alan@gap-suites.ca", company: "Gap Suites", country: "Canada", message: "Quote for 900 waffle bathrobes, 400gsm, embroidered logo, ship to Halifax." };
    const formA2 = normalizeInquiry(A);
    if (!formA2.ok) throw new Error("fixture A failed");
    const a1 = await ingestWebsiteInquiry(ORG, formA2.value);
    const aOpp = a1.spine.ok ? a1.spine.opportunityId : "";
    const aInteraction = a1.spine.ok ? a1.spine.interactionId : "";
    const aCounts = await wCounts(A.email);
    // 删除 SalesAction（模拟建互动后中断）；同时清掉草稿，使 FDE 状态回到未完成
    await db.pendingAction.deleteMany({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: aOpp } } });
    await db.salesAction.deleteMany({ where: { orgId: ORG, signalKey: `inbound:${aInteraction}` } });
    const aRecover = await ingestWebsiteInquiry(ORG, formA2.value);
    const aCountsAfter = await wCounts(A.email);
    const aAction = await db.salesAction.findFirst({ where: { orgId: ORG, signalKey: `inbound:${aInteraction}` }, select: { id: true, opportunityId: true, customerId: true } });
    ok(
      aRecover.recovered && aRecover.recoveredSteps.includes("sales_action") && !!aAction && aAction.opportunityId === aOpp,
      "A：互动已建、SalesAction 缺失 → 用 canonical helper 补建同一 signalKey 的行动",
      { steps: aRecover.recoveredSteps, action: aAction?.id },
    );
    ok(
      aCountsAfter.customers === aCounts.customers && aCountsAfter.opportunities === aCounts.opportunities && aCountsAfter.interactions === aCounts.interactions && aCountsAfter.tradeMessages === aCounts.tradeMessages,
      "A：不新建重复客户/商机/互动/消息",
      { before: aCounts, after: aCountsAfter },
    );
    ok(aRecover.recoveredSteps.includes("fde") && aCountsAfter.pending === 1, "A：补建行动后 FDE 重跑并产生一份未决草稿", { steps: aRecover.recoveredSteps, pending: aCountsAfter.pending });

    // B. SalesAction 已存在、Trade 线索关联回填缺失
    const B = { eventId: evt("b"), name: "Bella Link", email: "bella@link-resorts.ca", company: "Link Resorts", country: "Canada", message: "Need 700 coral fleece blankets 150x200 for a resort in Banff." };
    const formB = normalizeInquiry(B);
    if (!formB.ok) throw new Error("fixture B failed");
    const b1 = await ingestWebsiteInquiry(ORG, formB.value);
    const bOpp = b1.spine.ok ? b1.spine.opportunityId : "";
    await db.tradeProspect.update({ where: { id: b1.prospectId }, data: { convertedToSalesCustomerId: null, convertedToSalesOpportunityId: null, convertedAt: null } });
    const bRecover = await ingestWebsiteInquiry(ORG, formB.value);
    const bProspect = await db.tradeProspect.findUnique({ where: { id: b1.prospectId }, select: { convertedToSalesOpportunityId: true, convertedToSalesCustomerId: true } });
    ok(
      bRecover.recovered && bRecover.recoveredSteps.includes("prospect_link") && bProspect?.convertedToSalesOpportunityId === bOpp && !!bProspect?.convertedToSalesCustomerId,
      "B：SalesAction 已存在、Trade↔Sales 关联缺失 → 只补关联",
      { steps: bRecover.recoveredSteps, prospect: bProspect },
    );
    ok(!bRecover.recoveredSteps.includes("spine") && !bRecover.recoveredSteps.includes("fde"), "B：不重复 intake、不重跑已完成的 FDE", bRecover.recoveredSteps);

    // C. Trade 消息已存、主干整体缺失（上一次 SPINE_FAILED / 中途被杀）
    const C = { eventId: evt("c"), name: "Cara Partial", email: "cara@partial-inn.ca", company: "Partial Inn", country: "Canada", message: "Quote for 600 hotel slippers and 300 coral fleece blankets, ship to Montreal." };
    const formC2 = normalizeInquiry(C);
    if (!formC2.ok) throw new Error("fixture C failed");
    const cClaim = await claimInquiryReceipt(ORG, formC2.value);
    const campaignC = await db.tradeCampaign.findFirst({ where: { orgId: ORG, name: "网站询盘" }, select: { id: true } });
    if (!campaignC) throw new Error("fixture C: campaign missing");
    const pC = await db.tradeProspect.create({ data: { campaignId: campaignC.id, orgId: ORG, companyName: "Partial Inn", contactName: "Cara Partial", contactEmail: C.email, country: "Canada", source: "website", stage: "replied" }, select: { id: true } });
    const mC = await db.tradeMessage.create({ data: { prospectId: pC.id, direction: "inbound", channel: "website", subject: "网站询盘", content: buildInquiryMessage(formC2.value) }, select: { id: true } });
    await db.websiteInquiryReceipt.update({ where: { id: cClaim.receipt.id }, data: { prospectId: pC.id, tradeMessageId: mC.id, status: "linked", processingSince: null } });
    const cRecover = await ingestWebsiteInquiry(ORG, formC2.value);
    const cCounts = await wCounts(C.email);
    ok(
      cRecover.recovered && cRecover.recoveredSteps.includes("spine") && cRecover.messageId === mC.id && cRecover.prospectId === pC.id && cCounts.tradeMessages === 1 && cCounts.customers === 1 && cCounts.opportunities === 1 && cCounts.interactions === 1,
      "C：Trade 已存、主干缺失 → 用原消息补建主干，不复制消息/客户/商机",
      { steps: cRecover.recoveredSteps, counts: cCounts },
    );
    const interC = await db.customerInteraction.findUnique({ where: { id: cRecover.spine.ok ? cRecover.spine.interactionId : "" }, select: { analysisResult: true, content: true } });
    const refC = (interC?.analysisResult as SourceRef)?.sourceRef;
    ok(refC?.tradeMessageId === mC.id && refC?.externalId === C.eventId, "C：补建的互动指向原始消息与事件 id", refC);

    // D. 已人工拒绝的草稿：恢复不得复活
    const D = { eventId: evt("d"), name: "Dan Rejected", email: "dan@rejected-hotels.ca", company: "Rejected Hotels", country: "Canada", message: "Need 400 bath towels 70x140 for a lodge in Whistler." };
    const formD2 = normalizeInquiry(D);
    if (!formD2.ok) throw new Error("fixture D failed");
    const d1 = await ingestWebsiteInquiry(ORG, formD2.value);
    const dDraft = d1.fde?.pendingActionId;
    if (!dDraft) throw new Error("fixture D: no draft");
    const rejectD = await rejectApprovalItem("pending_action", dDraft, { userId: TRADE, role: "trade", orgId: ORG });
    const dState = await ingestWebsiteInquiry(ORG, formD2.value);
    const dDraftRow = await db.pendingAction.findUnique({ where: { id: dDraft }, select: { status: true, decidedById: true } });
    const dPendingCount = await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", payload: { path: ["opportunityId"], equals: d1.spine.ok ? d1.spine.opportunityId : "" } } });
    ok(
      rejectD.ok && dDraftRow?.status === "rejected" && dDraftRow.decidedById === TRADE && dState.fdeState?.status === "human_rejected" && dState.fdeState.terminal && dState.fde === null && dPendingCount === 0,
      "D：人工拒绝后重发 → 不复活、不重造草稿（human_rejected 终态）",
      { state: dState.fdeState, pending: dPendingCount },
    );

    // E. 已批准发送：恢复不得重发
    const E = { eventId: evt("e"), name: "Ed Sent", email: "ed@sent-suites.ca", company: "Sent Suites", country: "Canada", message: "Need 350 waffle bathrobes for a boutique hotel in Victoria." };
    const formE2 = normalizeInquiry(E);
    if (!formE2.ok) throw new Error("fixture E failed");
    const e1 = await ingestWebsiteInquiry(ORG, formE2.value);
    const eDraft = e1.fde?.pendingActionId;
    if (!eDraft) throw new Error("fixture E: no draft");
    const sentBeforeE = sent.length;
    const approveE = await approveApprovalItem("pending_action", eDraft, { userId: TRADE, role: "trade", orgId: ORG });
    const eState = await ingestWebsiteInquiry(ORG, formE2.value);
    ok(
      approveE.ok === true && sent.length === sentBeforeE + 1 && eState.fdeState?.status === "already_sent" && eState.fdeState.terminal && eState.fde === null && sent.length === sentBeforeE + 1,
      "E：已批准发送后重发 → already_sent 终态，不重跑、不二次发送",
      { state: eState.fdeState, sent: sent.length - sentBeforeE },
    );

    // F. run 被 supervisor 取消且草稿已过期：恢复不得重跑
    const F = { eventId: evt("f"), name: "Fay Cancelled", email: "fay@cancelled-inn.ca", company: "Cancelled Inn", country: "Canada", message: "Need 250 slippers and 250 towels for a small inn in Tofino." };
    const formF = normalizeInquiry(F);
    if (!formF.ok) throw new Error("fixture F failed");
    const f1 = await ingestWebsiteInquiry(ORG, formF.value);
    const fRun = f1.fde?.agentRunId;
    const fDraft = f1.fde?.pendingActionId;
    if (!fRun || !fDraft) throw new Error("fixture F: no run/draft");
    await db.agentRun.update({ where: { id: fRun }, data: { status: "cancelled" } });
    await db.pendingAction.update({ where: { id: fDraft }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const fRunsBefore = await db.agentRun.count({ where: { orgId: ORG, runType: "fde_inbound_sales", metadata: { path: ["opportunityId"], equals: f1.spine.ok ? f1.spine.opportunityId : "" } } });
    const fState = await ingestWebsiteInquiry(ORG, formF.value);
    const fRunsAfter = await db.agentRun.count({ where: { orgId: ORG, runType: "fde_inbound_sales", metadata: { path: ["opportunityId"], equals: f1.spine.ok ? f1.spine.opportunityId : "" } } });
    ok(
      fState.fdeState?.status === "cancelled" && fState.fdeState.terminal && fState.fde === null && fRunsAfter === fRunsBefore,
      "F：run 已取消 → 恢复不复活（不新增 run）",
      { state: fState.fdeState, before: fRunsBefore, after: fRunsAfter },
    );

    // G. 未决草稿仍有效：恢复复用，不重复制造审批
    const G = { eventId: evt("g"), name: "Gina Pending", email: "gina@pending-lodge.ca", company: "Pending Lodge", country: "Canada", message: "Need 800 hotel bathrobes with logo, ship to Ottawa in December." };
    const formG = normalizeInquiry(G);
    if (!formG.ok) throw new Error("fixture G failed");
    const g1 = await ingestWebsiteInquiry(ORG, formG.value);
    const gOpp = g1.spine.ok ? g1.spine.opportunityId : "";
    const gInteraction = g1.spine.ok ? g1.spine.interactionId : "";
    // FDE 状态被写成 failed（模拟上一次记账失败），但草稿仍未决 → 不应再造第二份审批
    const gAction = await db.salesAction.findFirst({ where: { orgId: ORG, signalKey: `inbound:${gInteraction}` }, select: { id: true, inputContext: true } });
    if (!gAction) throw new Error("fixture G: no action");
    await db.salesAction.update({ where: { id: gAction.id }, data: { inputContext: { ...((gAction.inputContext as Record<string, unknown> | null) ?? {}), fdeStatus: "failed" } } });
    const gState = await ingestWebsiteInquiry(ORG, formG.value);
    const gPending = await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", payload: { path: ["opportunityId"], equals: gOpp } } });
    ok(
      gState.fde === null && gState.fdeState?.status === "completed" && gState.fdeState.terminal && gPending === 1 && gState.fdeState.pendingActionId === g1.fde?.pendingActionId,
      "G：仍有有效未决草稿 → 复用，不重跑、不重复制造审批",
      { state: gState.fdeState, pending: gPending },
    );

    // H. FDE 曾失败且无草稿 → 重跑；running 未超时 → 不重跑；running 超时 → 重跑
    const H = { eventId: evt("h"), name: "Hana Retry", email: "hana@retry-hotels.ca", company: "Retry Hotels", country: "Canada", message: "Need 500 bath towels and 200 bathrobes for a hotel in Regina." };
    const formH = normalizeInquiry(H);
    if (!formH.ok) throw new Error("fixture H failed");
    const h1 = await ingestWebsiteInquiry(ORG, formH.value);
    const hOpp = h1.spine.ok ? h1.spine.opportunityId : "";
    const hInteraction = h1.spine.ok ? h1.spine.interactionId : "";
    const hAction = await db.salesAction.findFirst({ where: { orgId: ORG, signalKey: `inbound:${hInteraction}` }, select: { id: true, inputContext: true } });
    if (!hAction) throw new Error("fixture H: no action");
    const setFde = async (fdeStatus: string) => {
      const cur = await db.salesAction.findUniqueOrThrow({ where: { id: hAction.id }, select: { inputContext: true } });
      await db.salesAction.update({ where: { id: hAction.id }, data: { inputContext: { ...((cur.inputContext as Record<string, unknown> | null) ?? {}), fdeStatus } } });
    };
    const hRuns = async () => db.agentRun.count({ where: { orgId: ORG, runType: "fde_inbound_sales", metadata: { path: ["opportunityId"], equals: hOpp } } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: hOpp } } });
    await setFde("failed");
    const runsBeforeH = await hRuns();
    const h2 = await ingestWebsiteInquiry(ORG, formH.value);
    ok((await hRuns()) === runsBeforeH + 1 && h2.recoveredSteps.includes("fde") && !!h2.fde?.ok, "H：FDE 曾失败且无草稿 → 重跑", { runs: await hRuns(), steps: h2.recoveredSteps });
    await db.pendingAction.deleteMany({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: hOpp } } });
    await setFde("running");
    const runsAfterH2 = await hRuns();
    const h3 = await ingestWebsiteInquiry(ORG, formH.value);
    ok((await hRuns()) === runsAfterH2 && h3.fde === null && h3.fdeState?.status === "running" && !h3.fdeState.terminal, "H：running 未超时 → 不重跑（避免并发双跑）", { state: h3.fdeState });
    // 用夹具时钟前进 20 分钟来触发 stale_running（loadFdeState 以传入的 now 计算陈旧度），
    // 比改写 updatedAt 更直接、也不依赖数据库时钟
    const h4 = await ingestWebsiteInquiry(ORG, formH.value, { now: new Date(Date.now() + 20 * 60_000) });
    ok((await hRuns()) === runsAfterH2 + 1 && h4.recoveredSteps.includes("fde") && h4.fdeState?.terminal === true, "H：running 超过 10 分钟（stale_running）→ 视为中断并重跑", { runs: await hRuns(), state: h4.fdeState });

    // I. 真实 webhook 路由：响应字段来自真实记录
    await db.tradeChannel.create({ data: { orgId: ORG, channel: "website", name: "fixture site", status: "active", config: { secret: `s3cret_${stamp}` } } });
    const { POST: webhookPost } = await import("@/app/api/trade/webhook/website/route");
    type WebhookBody = { ok?: boolean; eventId?: string | null; receiptId?: string | null; prospectId?: string; messageId?: string; opportunityId?: string | null; spine?: string; replay?: boolean; recovered?: boolean; recoveredSteps?: string[]; busy?: boolean; conflict?: boolean; complete?: boolean; fde?: { status?: string; terminal?: boolean; reason?: string; pendingActionId?: string | null } | null; error?: string };
    const hitWebhook = async (body: Record<string, unknown>, secret = `s3cret_${stamp}`) => {
      const res = await webhookPost(new NextRequest("http://localhost/api/trade/webhook/website", { method: "POST", headers: { "content-type": "application/json", "x-qingyan-webhook-secret": secret }, body: JSON.stringify(body) }));
      return { status: res.status, body: (await res.json()) as WebhookBody };
    };
    const W = { eventId: evt("w"), name: "Wendy Webhook", email: "wendy@webhook-suites.ca", company: "Webhook Suites", country: "Canada", message: "Need 900 bath towels 70x140cm for a resort in Kelowna. MOQ and price please." };
    const h1w = await hitWebhook(W);
    ok(
      h1w.status === 200 && h1w.body.ok === true && h1w.body.eventId === W.eventId && !!h1w.body.receiptId && !!h1w.body.opportunityId && h1w.body.spine === "ok" && h1w.body.complete === true && h1w.body.fde?.terminal === true && !!h1w.body.fde?.pendingActionId,
      "I：webhook 首发响应含事件身份 + 真实 FDE 终态 + complete",
      h1w.body,
    );
    const h2w = await hitWebhook(W);
    ok(
      h2w.body.replay === true && h2w.body.recovered === false && h2w.body.messageId === h1w.body.messageId && h2w.body.opportunityId === h1w.body.opportunityId && h2w.body.fde?.pendingActionId === h1w.body.fde?.pendingActionId,
      "I：webhook 重放返回真实下游 ID 与 FDE 状态",
      h2w.body,
    );
    const cW = await wCounts(W.email);
    const h3w = await hitWebhook(W, "wrong-secret");
    ok(h3w.status === 401 && JSON.stringify(await wCounts(W.email)) === JSON.stringify(cW), "I：错误密钥 → 401，不落库且不建收据", h3w);
    const noReceiptForBadSecret = await db.websiteInquiryReceipt.count({ where: { orgId: ORG, eventId: evt("nope") } });
    ok(noReceiptForBadSecret === 0 && cW.prospects === 1 && cW.tradeMessages === 1 && cW.opportunities === 1 && cW.pending === 1, "I 计数：1/1/1/1", cW);

    await releaseFixtureRunSlots();
    console.log("\n[16] 事务失败注入：失败后不重复审批、不自动发送、状态可解释、可再次恢复");
    // 真实 Prisma 写入与审批状态机全部保留，只把指定的一次 db.$transaction 注入为失败，
    // 复现观察到的 "Transaction API error: Transaction not found" 形态（run.ts 的运行态事务）。
    const txClient = db as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
    const origTx = txClient.$transaction.bind(db);
    let armed: { match: string; skip: number } | null = null;
    const armTxFailure = (match: string, skip = 0) => {
      armed = { match, skip };
    };
    txClient.$transaction = async (...args: unknown[]) => {
      if (armed && (new Error().stack ?? "").includes(armed.match)) {
        if (armed.skip > 0) {
          armed.skip -= 1;
        } else {
          armed = null;
          throw new Error("Transaction API error: Transaction not found. Transaction ID is invalid (simulated fault injection).");
        }
      }
      return origTx(...args);
    };

    try {
      // 16A：草稿产生之前失败 → 不留半份审批，可再次恢复
      const FA = { eventId: evt("tx-a"), name: "Tina Fault", email: "tina@fault-hotels.ca", company: "Fault Hotels", country: "Canada", message: "Need 450 waffle bathrobes for a hotel in Saskatoon, logo embroidered." };
      const formFA = normalizeInquiry(FA);
      if (!formFA.ok) throw new Error("fixture 16A failed");
      const sentBeforeA = sent.length;
      // 注入点必须是 FDE 真正会失败的事务：RFQ 落库（草稿之前、且异常会冒泡到 FDE 的 catch）。
      // agent-runtime 的事件写入不适合做这个用途 —— appendAgentRunEvent 自带 try/catch，
      // 事件写入失败按设计只记日志、不影响流程（见 16C）。
      armTxFailure("revenue-spine/rfq/persist.ts", 0);
      const a16 = await ingestWebsiteInquiry(ORG, formFA.value);
      const oppA = a16.spine.ok ? a16.spine.opportunityId : "";
      const interA = a16.spine.ok ? a16.spine.interactionId : "";
      const draftsA = await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: oppA } } });
      const runsA = await db.agentRun.findMany({ where: { orgId: ORG, runType: "fde_inbound_sales", metadata: { path: ["opportunityId"], equals: oppA } }, select: { status: true, errorMessage: true } });
      const actionA = await db.salesAction.findFirst({ where: { orgId: ORG, signalKey: `inbound:${interA}` }, select: { inputContext: true } });
      const fdeStatusA = ((actionA?.inputContext ?? {}) as Record<string, unknown>).fdeStatus;
      const receiptA = await findReceiptByEventId(ORG, FA.eventId);
      ok(
        a16.spine.ok && !!oppA && !!interA,
        "16A：主干仍已建立（线索 + 消息 + 客户 + 商机 + 互动），失败只发生在 FDE 内",
        { spine: a16.spine.ok },
      );
      ok(
        draftsA === 0 && sent.length === sentBeforeA && runsA.some((r) => r.status === "failed" && (r.errorMessage ?? "").includes("Transaction")) && fdeStatusA === "failed" && receiptA?.status === "linked",
        "16A：草稿前事务失败 → 无审批、无发送；run=failed 且原因留痕，SalesAction=failed，收据=linked（未标完成）",
        { draftsA, sent: sent.length - sentBeforeA, runs: runsA.map((r) => r.status), fdeStatusA, receipt: receiptA?.status },
      );
      // 再次恢复 → 正常完成，且只有一份审批
      const a16b = await ingestWebsiteInquiry(ORG, formFA.value);
      const draftsAafter = await db.pendingAction.findMany({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: oppA } }, select: { id: true, status: true } });
      const receiptAafter = await findReceiptByEventId(ORG, FA.eventId);
      ok(
        a16b.recovered && a16b.recoveredSteps.includes("fde") && draftsAafter.length === 1 && draftsAafter[0].status === "pending" && a16b.fdeState?.terminal === true && receiptAafter?.status === "complete" && sent.length === sentBeforeA,
        "16A：再次恢复 → FDE 重跑并只产生一份未决审批，收据转 complete，仍未发送",
        { steps: a16b.recoveredSteps, drafts: draftsAafter, state: a16b.fdeState, receipt: receiptAafter?.status },
      );
      const countsA = await wCounts(FA.email);
      ok(countsA.prospects === 1 && countsA.tradeMessages === 1 && countsA.customers === 1 && countsA.opportunities === 1 && countsA.interactions === 1, "16A：失败 + 恢复全程不复制业务对象", countsA);

      // 16B：草稿已产生之后失败（正是观察到的形态：completeAgentRun 的事务）
      const FB = { eventId: evt("tx-b"), name: "Ben Fault", email: "ben@fault-suites.ca", company: "Fault Suites", country: "Canada", message: "Need 700 bath towels 70x140 and 200 slippers for a hotel in Halifax." };
      const formFB = normalizeInquiry(FB);
      if (!formFB.ok) throw new Error("fixture 16B failed");
      const sentBeforeB = sent.length;
      const b16 = await ingestWebsiteInquiry(ORG, formFB.value);
      const oppB = b16.spine.ok ? b16.spine.opportunityId : "";
      const interB = b16.spine.ok ? b16.spine.interactionId : "";
      const draftB1 = b16.fde?.pendingActionId;
      if (!draftB1) throw new Error("fixture 16B: no draft");
      // 回到可重跑状态：FDE 记为 failed，并让首份草稿过期（否则会被复用而不重跑）
      const actionB = await db.salesAction.findFirstOrThrow({ where: { orgId: ORG, signalKey: `inbound:${interB}` }, select: { id: true, inputContext: true } });
      await db.salesAction.update({ where: { id: actionB.id }, data: { inputContext: { ...((actionB.inputContext as Record<string, unknown> | null) ?? {}), fdeStatus: "failed" } } });
      await db.pendingAction.update({ where: { id: draftB1 }, data: { expiresAt: new Date(Date.now() - 60_000) } });
      armTxFailure("completeAgentRun"); // 草稿已建之后、run 收尾时失败
      const b16b = await ingestWebsiteInquiry(ORG, formFB.value);
      const draftsB = await db.pendingAction.findMany({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: oppB } }, select: { id: true, status: true, decidedById: true, expiresAt: true } });
      const validB = draftsB.filter((d) => d.status === "pending" && d.expiresAt > new Date());
      const runsB = await db.agentRun.findMany({ where: { orgId: ORG, runType: "fde_inbound_sales", metadata: { path: ["opportunityId"], equals: oppB } }, select: { status: true, errorMessage: true } });
      ok(
        b16b.fde?.ok === false && sent.length === sentBeforeB && validB.length === 1 && draftsB.every((d) => d.decidedById === null) && runsB.some((r) => r.status === "failed"),
        "16B：草稿后事务失败 → FDE 如实报失败，不自动发送，有效未决审批恰一份，无人被记为决策者，run=failed",
        { fdeOk: b16b.fde?.ok, sent: sent.length - sentBeforeB, valid: validB.length, drafts: draftsB.map((d) => d.status), runs: runsB.map((r) => r.status) },
      );
      const countsB = await wCounts(FB.email);
      ok(countsB.prospects === 1 && countsB.tradeMessages === 1 && countsB.opportunities === 1 && countsB.interactions === 1, "16B：失败不复制业务对象", countsB);
      // 恢复：要么完成（有有效草稿即终态），要么明确停在未完成状态待人工
      const b16c = await ingestWebsiteInquiry(ORG, formFB.value);
      const receiptB = await findReceiptByEventId(ORG, FB.eventId);
      const validBafter = (await db.pendingAction.findMany({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", payload: { path: ["opportunityId"], equals: oppB } }, select: { expiresAt: true } })).filter((d) => d.expiresAt > new Date());
      ok(
        (b16c.fdeState?.terminal === true && validBafter.length === 1 && receiptB?.status === "complete") ||
          (b16c.fdeState?.terminal === false && receiptB?.status === "linked"),
        "16B：再次恢复 → 要么完成（恰一份有效未决审批 + 收据 complete），要么明确停在未完成状态待人工",
        { state: b16c.fdeState, valid: validBafter.length, receipt: receiptB?.status },
      );
      ok(sent.length === sentBeforeB, "16B：全程没有任何自动发送", sent.length - sentBeforeB);

      // 16C：事件写入事务失败是"尽力而为"，按设计不影响主流程（appendAgentRunEvent 自带 try/catch）
      const FC = { eventId: evt("tx-c"), name: "Cleo Event", email: "cleo@event-lodge.ca", company: "Event Lodge", country: "Canada", message: "Need 300 coral fleece blankets 150x200 for a lodge in Jasper." };
      const formFC = normalizeInquiry(FC);
      if (!formFC.ok) throw new Error("fixture 16C failed");
      const sentBeforeC = sent.length;
      armTxFailure("agent-runtime/run.ts", 2); // FDE 起步阶段的一次事件写入
      const c16 = await ingestWebsiteInquiry(ORG, formFC.value);
      const oppC = c16.spine.ok ? c16.spine.opportunityId : "";
      const draftsC = await db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", payload: { path: ["opportunityId"], equals: oppC } } });
      const runsC = await db.agentRun.findMany({ where: { orgId: ORG, runType: "fde_inbound_sales", metadata: { path: ["opportunityId"], equals: oppC } }, select: { status: true } });
      ok(
        c16.fde?.ok === true && draftsC === 1 && runsC.every((r) => r.status === "completed") && c16.complete && sent.length === sentBeforeC,
        "16C：事件写入事务失败 → 按设计不影响 FDE（run 仍 completed、恰一份未决审批、未发送）",
        { fde: c16.fde?.ok, draftsC, runs: runsC.map((r) => r.status), complete: c16.complete },
      );
    } finally {
      armed = null;
      txClient.$transaction = origTx as never;
    }

    console.log("\n[10] Audit trail");
    const audits = await db.auditLog.count({ where: { orgId: ORG, action: { in: ["revenue_spine.inquiry.intake", "revenue_spine.opportunity.transition", "revenue_spine.inquiry_reply.sent", "employee_ai.outcome.create"] } } });
    ok(audits >= 10, "审计日志覆盖 intake / transition / send / outcome", audits);
  } catch (err) {
    // 记下抛出的错误，让 finally 里的诊断能连同它一起落盘，然后原样抛出
    thrownError = err;
    throw err;
  } finally {
    __setInquiryReplySenderForTest(null);
    // 清库前保存脱敏诊断：失败断言 / 抛出的异常 / AgentRun / SalesAction / PendingAction / 关联 ID
    await captureDiagnostics(ORG, stamp, failures, thrownError).catch((err) => console.warn("[diag] capture failed:", err));
    // 清理失败不得掩盖真正的失败原因（清理异常会替换掉 try 里抛出的错误）
    try {
    // 清理（按依赖顺序；级联删除覆盖 RFQ/证据/评估/行动）
    for (const orgId of [ORG, ORG2]) {
      const opps = await db.salesOpportunity.findMany({ where: { orgId }, select: { id: true } });
      const oppIds = opps.map((o) => o.id);
      await db.businessOutcome.deleteMany({ where: { orgId } });
      const prospectsToClean = await db.tradeProspect.findMany({ where: { orgId }, select: { id: true } });
      await db.tradeMessage.deleteMany({ where: { prospectId: { in: prospectsToClean.map((p) => p.id) } } });
      await db.tradeProspect.deleteMany({ where: { orgId } });
      await db.capabilityQuotaPolicy.deleteMany({ where: { orgId } });
      await db.capabilityQuotaReservation.deleteMany({ where: { orgId } });
      await db.websiteInquiryReceipt.deleteMany({ where: { orgId } });
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
    } catch (cleanupErr) {
      console.warn("[cleanup] 清理未完成（不覆盖原始错误）：", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
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
