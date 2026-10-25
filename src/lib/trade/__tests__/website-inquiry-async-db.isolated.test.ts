/**
 * 网站询盘异步入站（PRD F3.1–F3.3）— 真实 DB 端到端（隔离库）
 *
 *   webhook POST（deferred）→ 收据 + Trade + Revenue Spine 后立即返回（FDE 未执行、queued）
 *   → 注入的调度器确定性地执行 after() 回调 → FDE 原子认领后执行 → 草稿 PendingAction → 收据 complete
 *   + 重发不在请求内执行 FDE；两个回调 / 两个认领并发只有一个执行；cron 兜底接管排队的 FDE（墙钟截止）；
 *   终态（人工拒绝 / 行动已关闭）永不重跑；早退释放认领；只读状态接口；真实响应喂给站点桥接判定逻辑；
 *   配额 run_blocked 不占重试上限；卡住的候选不挡住后面的排队 FDE；人工入口经认领。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/trade/__tests__/website-inquiry-async-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过网站询盘异步入站 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Website inquiry async intake DB e2e" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : "");
  }
}

type FdeBody = { status?: string; terminal?: boolean; reason?: string; agentRunId?: string | null; pendingActionId?: string | null; scheduled?: boolean } | null;
type Body = {
  ok?: boolean;
  eventId?: string;
  receiptId?: string;
  prospectId?: string;
  messageId?: string;
  opportunityId?: string | null;
  spine?: string;
  replay?: boolean;
  recovered?: boolean;
  busy?: boolean;
  complete?: boolean;
  receiptStatus?: string;
  fde?: FdeBody;
  error?: string;
};

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const {
    ingestWebsiteInquiry,
    normalizeInquiry,
    settleReceiptsForSalesAction,
    __setDefaultFdeSchedulerForTest,
  } = await import("@/lib/trade/website-inquiry");
  type FdeScheduler = import("@/lib/trade/website-inquiry").FdeScheduler;
  const {
    claimInboundFde,
    runQueuedInboundFde,
    runInboundFdeForHuman,
    drainInboundFdeQueue,
    listInboundFdeCandidates,
    loadFdeState,
    FDE_CLAIM_STALE_MS,
    FDE_CRON_MAX_ATTEMPTS,
  } = await import("@/lib/revenue-spine/fde/inbound-queue");
  const { createFdeAction } = await import("@/lib/revenue-spine/fde/actions");
  const { INQUIRY_REPLY_ACTION_TYPE } = await import("@/lib/revenue-spine/fde/inbound-sales");
  const { findReceiptByEventId } = await import("@/lib/trade/website-inquiry-receipts");
  const { __setToolPolicyLoaderForTest } = await import("@/lib/pending-actions/executor");
  const { rejectApprovalItem } = await import("@/lib/approval/port");
  const { __setInquiryReplySenderForTest } = await import("@/lib/pending-actions/exec-sales-inquiry-reply");
  const { POST: webhookPost } = await import("@/app/api/trade/webhook/website/route");
  const { GET: statusGet } = await import("@/app/api/trade/webhook/website/status/route");
  const { classifyQingyanResponse, processingStateFrom } = await import("./fixtures/site-bridge-classify");
  __setToolPolicyLoaderForTest(async () => ({ value: {} }));

  const stamp = Date.now().toString(36);
  const ORG = `aiorg_${stamp}`;
  const ORG2 = `aiorg2_${stamp}`;
  const OWNER = `aiowner_${stamp}`;
  const TRADE = `aitrade_${stamp}`;
  const OTHER = `aiother_${stamp}`;
  const SECRET = `sec_${stamp}`;
  const SECRET2 = `sec2_${stamp}`;
  const sent: string[] = [];

  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Example Owner", role: "boss" } });
  await db.user.create({ data: { id: TRADE, email: `${TRADE}@fixture.test`, name: "Example Trade Rep", role: "trade" } });
  await db.user.create({ data: { id: OTHER, email: `${OTHER}@fixture.test`, name: "Other Owner", role: "boss" } });
  await db.organization.create({ data: { id: ORG, name: "Example Textiles Fixture", code: `ai-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Other Fixture Org", code: `ai2-${stamp}`, ownerId: OTHER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_owner", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: TRADE, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OTHER, role: "org_owner", status: "active" } });
  await db.tradeChannel.create({ data: { orgId: ORG, channel: "website", name: "fixture site", status: "active", config: { secret: SECRET } } });
  await db.tradeChannel.create({ data: { orgId: ORG2, channel: "website", name: "other site", status: "active", config: { secret: SECRET2 } } });

  // 调度器：捕获 after() 回调，测试决定何时（以及是否并发）执行
  const tasks: Array<() => Promise<void>> = [];
  const capture: FdeScheduler = (task) => {
    tasks.push(task);
  };
  const drop: FdeScheduler = () => {
    /* 回调丢失（模拟函数实例在 after() 执行前被回收），只能靠 cron / 重发接手 */
  };
  const runTasks = async (concurrent: boolean) => {
    const batch = tasks.splice(0);
    if (concurrent) await Promise.all(batch.map((t) => t()));
    else for (const t of batch) await t();
    return batch.length;
  };

  const post = async (body: Record<string, unknown>, secret = SECRET) => {
    const res = await webhookPost(
      new NextRequest("http://localhost/api/trade/webhook/website", {
        method: "POST",
        headers: { "content-type": "application/json", "x-qingyan-webhook-secret": secret },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as Body };
  };
  const getStatus = async (eventId: string | null, opts: { secret?: string; viaQuery?: boolean } = {}) => {
    const secret = opts.secret ?? SECRET;
    const qs = [eventId !== null ? `eventId=${encodeURIComponent(eventId)}` : "", opts.viaQuery ? `secret=${secret}` : ""].filter(Boolean).join("&");
    const res = await statusGet(
      new NextRequest(`http://localhost/api/trade/webhook/website/status?${qs}`, {
        method: "GET",
        headers: opts.viaQuery ? {} : { "x-qingyan-webhook-secret": secret },
      }),
    );
    return { status: res.status, body: (await res.json()) as Body };
  };
  const runsFor = (opportunityId: string) =>
    db.agentRun.count({ where: { orgId: ORG, runType: "fde_inbound_sales", metadata: { path: ["opportunityId"], equals: opportunityId } } });
  const pendingFor = (opportunityId: string) =>
    db.pendingAction.count({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", payload: { path: ["opportunityId"], equals: opportunityId } } });
  const ctxOf = async (salesActionId: string) => {
    const a = await db.salesAction.findUniqueOrThrow({ where: { id: salesActionId }, select: { inputContext: true, status: true, updatedAt: true } });
    return { ...(a.inputContext as Record<string, unknown>), _status: a.status, _updatedAt: a.updatedAt };
  };
  const form = (raw: Record<string, unknown>) => {
    const n = normalizeInquiry(raw);
    if (!n.ok || n.value.honeypotTripped) throw new Error(`fixture normalize failed: ${JSON.stringify(raw).slice(0, 80)}`);
    return n.value;
  };
  const inquiry = (key: string, message: string) => ({
    eventId: `evt_${key}_${stamp}`,
    name: `${key.toUpperCase()} Buyer`,
    email: `${key}.${stamp}@maple-home-${key}.example`,
    company: `Maple Home Goods ${key.toUpperCase()} ${stamp}`,
    country: "Canada",
    message,
  });

  __setInquiryReplySenderForTest(async (input) => {
    sent.push(input.to);
    return { channel: "test", messageId: `msg_${sent.length}` };
  });
  __setDefaultFdeSchedulerForTest(capture);

  try {
    console.log("\n[1] 首个 POST：请求路径做到 Revenue Spine 就返回，FDE 只排队");
    const A = inquiry("a", "Need 1,500 waffle bathrobes 380gsm with embroidered logo for a hotel group in Toronto. MOQ and lead time please.");
    const t0 = Date.now();
    const r1 = await post(A);
    const elapsedMs = Date.now() - t0;
    const oppA = r1.body.opportunityId ?? "";
    ok(
      r1.status === 200 && r1.body.ok === true && r1.body.eventId === A.eventId && !!r1.body.receiptId && !!r1.body.prospectId && !!oppA && r1.body.spine === "ok",
      "HTTP 200（不是 202）+ 事件身份 + Trade 线索 + 商机",
      r1.body,
    );
    ok(
      r1.body.complete === false && r1.body.fde?.status === "queued" && r1.body.fde.terminal === false && r1.body.fde.scheduled === true && tasks.length === 1,
      "响应：fde queued / terminal=false / complete=false，且安排了一个 after() 回调",
      { fde: r1.body.fde, complete: r1.body.complete, tasks: tasks.length },
    );
    ok((await runsFor(oppA)) === 0 && (await pendingFor(oppA)) === 0, "请求内没有执行 FDE（无 AgentRun、无草稿）");
    console.log(`    （请求路径耗时 ${elapsedMs} ms，本机隔离库，无 LLM）`);
    const receiptA0 = await findReceiptByEventId(ORG, A.eventId);
    ok(receiptA0?.status === "linked" && receiptA0.processingSince === null && receiptA0.attempts === 1 && !!receiptA0.salesActionId, "收据在返回前已释放（linked），不在 FDE 期间占用", receiptA0 && { status: receiptA0.status, since: receiptA0.processingSince });
    const actionA = receiptA0?.salesActionId ?? "";
    ok((await ctxOf(actionA)).fdeStatus === "queued", "SalesAction.fdeStatus = queued");
    const bridge1 = classifyQingyanResponse(r1.status, r1.body);
    ok(bridge1.status === "delivered" && processingStateFrom(bridge1.result) === "incomplete", "站点桥接判定：delivered + processing incomplete", { bridge: bridge1.status, error: bridge1.error });

    console.log("\n[2] 只读状态接口");
    const before = await findReceiptByEventId(ORG, A.eventId);
    const s0 = await getStatus(A.eventId);
    const after = await findReceiptByEventId(ORG, A.eventId);
    ok(
      s0.status === 200 && s0.body.receiptId === r1.body.receiptId && s0.body.opportunityId === oppA && s0.body.spine === "replay" && s0.body.complete === false && s0.body.fde?.status === "queued" && s0.body.fde.terminal === false && s0.body.receiptStatus === "linked",
      "状态接口返回同一套快照字段（FDE queued）",
      s0.body,
    );
    ok(
      after?.attempts === before?.attempts && after?.status === before?.status && after?.lastSeenAt.getTime() === before?.lastSeenAt.getTime() && tasks.length === 1 && (await runsFor(oppA)) === 0,
      "状态接口只读：不认领收据、不增加 attempts、不安排也不执行 FDE",
      { before: before?.attempts, after: after?.attempts, tasks: tasks.length },
    );
    const sQuery = await getStatus(A.eventId, { viaQuery: true });
    const sWrong = await getStatus(A.eventId, { secret: "wrong-secret" });
    const sOtherOrg = await getStatus(A.eventId, { secret: SECRET2 });
    const sUnknown = await getStatus(`evt_missing_${stamp}`);
    const sNoId = await getStatus(null);
    ok(sQuery.status === 401 && sWrong.status === 401, "密钥只认 header：?secret= 与错误密钥 → 401", { q: sQuery.status, w: sWrong.status });
    ok(sOtherOrg.status === 404 && sUnknown.status === 404 && sNoId.status === 400, "他组织密钥查不到本组织事件（404）；未知事件 404；缺 eventId 400", { other: sOtherOrg.status, unknown: sUnknown.status, noId: sNoId.status });

    console.log("\n[3] 重发：不在请求内执行 FDE，只安排");
    const r2 = await post(A);
    ok(
      r2.status === 200 && r2.body.replay === true && r2.body.recovered === false && r2.body.messageId === r1.body.messageId && r2.body.opportunityId === oppA && r2.body.fde?.status === "queued" && r2.body.fde.scheduled === true,
      "重发返回当前快照；FDE 可重跑且未被认领 → 用调度器安排",
      r2.body,
    );
    ok(tasks.length === 2 && (await runsFor(oppA)) === 0, "重发后仍没有任何 FDE 在请求内执行（两个待执行回调）", { tasks: tasks.length });

    console.log("\n[4] 两个回调并发执行：原子认领只让一个跑");
    const ranTasks = await runTasks(true);
    const ctxA = await ctxOf(actionA);
    ok(ranTasks === 2 && (await runsFor(oppA)) === 1 && (await pendingFor(oppA)) === 1, "两个回调并发 → 恰 1 个 AgentRun、1 份待审批草稿", { runs: await runsFor(oppA), pending: await pendingFor(oppA) });
    ok(
      ctxA.fdeStatus === "completed" && ctxA.fdeAttempts === 1 && ["after", "replay"].includes(String((ctxA.fdeClaim as Record<string, unknown> | undefined)?.by)),
      "SalesAction：completed、认领 1 次、认领者记录在案",
      { fdeStatus: ctxA.fdeStatus, attempts: ctxA.fdeAttempts, claim: ctxA.fdeClaim },
    );
    const receiptA1 = await findReceiptByEventId(ORG, A.eventId);
    ok(receiptA1?.status === "complete" && !!receiptA1.agentRunId && !!receiptA1.pendingActionId && !!receiptA1.completedAt, "回调执行后回填收据：run / 草稿 id + complete", receiptA1 && { status: receiptA1.status, run: receiptA1.agentRunId, pa: receiptA1.pendingActionId });
    ok(sent.length === 0, "全程没有自动发送");

    console.log("\n[5] FDE 终态后的重发 / 状态查询");
    const r3 = await post(A);
    ok(
      r3.body.complete === true && r3.body.fde?.terminal === true && r3.body.fde.status === "completed" && r3.body.fde.pendingActionId === receiptA1?.pendingActionId && r3.body.fde.scheduled === false && tasks.length === 0 && (await runsFor(oppA)) === 1,
      "重发：complete=true、fde 终态 + 草稿 id，不再安排、不重跑",
      r3.body,
    );
    const bridge3 = classifyQingyanResponse(r3.status, r3.body);
    ok(bridge3.status === "delivered" && processingStateFrom(bridge3.result) === "complete", "站点桥接判定：delivered + processing complete", { bridge: bridge3.status });
    const s1 = await getStatus(A.eventId);
    const bridgeS = classifyQingyanResponse(s1.status, s1.body);
    ok(s1.body.complete === true && s1.body.fde?.terminal === true && s1.body.receiptStatus === "complete" && processingStateFrom(bridgeS.result) === "complete", "状态接口：complete + 终态（站点判 processing complete）", s1.body);

    console.log("\n[6] 两个认领并发：恰一个成功；过期认领可被再次认领");
    const B = inquiry("b", "Quote for 800 coral fleece blankets 150x200cm, ship to Vancouver in January.");
    const rb = await ingestWebsiteInquiry(ORG, form(B), { fdeMode: "deferred", scheduleFde: drop });
    const bReceipt = await findReceiptByEventId(ORG, B.eventId);
    const actionB = bReceipt?.salesActionId ?? "";
    ok(rb.fdeScheduled && rb.fde === null && rb.fdeState?.status === "queued" && !!actionB, "deferred 入站（回调丢失）：FDE 仍 queued", { scheduled: rb.fdeScheduled, state: rb.fdeState });
    const [c1, c2] = await Promise.all([claimInboundFde(ORG, actionB, { by: "cron" }), claimInboundFde(ORG, actionB, { by: "after" })]);
    ok(
      [c1, c2].filter((c) => c.claimed).length === 1 && [c1, c2].some((c) => ["in_flight", "lost_race"].includes(c.reason)),
      "两个并发认领 → 恰一个 claimed，另一个 in_flight / lost_race",
      { c1: c1.reason, c2: c2.reason },
    );
    const c3 = await claimInboundFde(ORG, actionB, { by: "replay" });
    ok(!c3.claimed && c3.reason === "in_flight" && (await loadFdeState(ORG, rb.spine.ok ? rb.spine.interactionId : "")).status === "running", "认领未过期 → 他人 in_flight，状态报告 running", c3.reason);
    const later = new Date(Date.now() + FDE_CLAIM_STALE_MS + 60_000);
    const c4 = await claimInboundFde(ORG, actionB, { by: "cron", now: later });
    ok(c4.claimed && c4.attempts === 2 && c4.state?.status === "stale_running", "认领超过 FDE_CLAIM_STALE_MS 没有写入 → 视为中断，可再次认领（累计 2 次）", { reason: c4.reason, attempts: c4.attempts, state: c4.state?.status });
    ok((await runsFor(rb.spine.ok ? rb.spine.opportunityId : "")) === 0, "认领本身不执行 FDE");

    console.log("\n[7] cron 兜底：接管 after() 丢失的排队 FDE；墙钟截止");
    // D：默认调度器（真的 after()）在请求上下文之外不可用 → 留在 queued
    __setDefaultFdeSchedulerForTest(null);
    const D = inquiry("d", "Need 2,000 hotel bath towels 70x140cm 600gsm for a resort in Banff, delivery March.");
    const rd = await ingestWebsiteInquiry(ORG, form(D), { fdeMode: "deferred" });
    __setDefaultFdeSchedulerForTest(capture);
    const oppD = rd.spine.ok ? rd.spine.opportunityId : "";
    const actionD = (await findReceiptByEventId(ORG, D.eventId))?.salesActionId ?? "";
    ok(!rd.fdeScheduled && rd.fdeState?.status === "queued" && rd.complete === false, "请求上下文之外 after() 不可用 → fdeScheduled=false，FDE 留在 queued（响应仍正常）", { scheduled: rd.fdeScheduled, state: rd.fdeState?.status });
    const candidates = await listInboundFdeCandidates(ORG, new Date(), 50);
    ok(candidates.some((c) => c.id === actionD) && !candidates.some((c) => c.id === actionB) && !candidates.some((c) => c.id === actionA), "候选：queued 的 D 在；认领中的 B、已完成的 A 不在", candidates.map((c) => c.id));
    const expired = await drainInboundFdeQueue({ orgIds: [ORG], deadlineAt: Date.now() - 1 });
    ok(expired.deadlineReached && expired.results[0].fdeExecuted === 0 && (await runsFor(oppD)) === 0, "截止时间已过 → 不启动任何新的 FDE", expired);
    const drained = await drainInboundFdeQueue({
      orgIds: [ORG],
      deadlineAt: Date.now() + 120_000,
      afterRun: async (orgId, salesActionId) => {
        await settleReceiptsForSalesAction(orgId, salesActionId);
      },
    });
    const dReceipt = await findReceiptByEventId(ORG, D.eventId);
    ok(drained.results[0].fdeExecuted >= 1 && drained.results[0].fdeRan >= 1 && (await runsFor(oppD)) === 1 && (await pendingFor(oppD)) === 1, "cron 认领并执行 D：1 个 run、1 份草稿（fdeRan 仍是成功次数）", drained.results);
    ok(dReceipt?.status === "complete" && !!dReceipt.pendingActionId, "cron 执行后回填收据 complete", dReceipt?.status);
    ok((await ctxOf(actionD)).fdeClaim && ((await ctxOf(actionD)).fdeClaim as Record<string, unknown>).by === "cron", "认领者记录为 cron");
    const sD = await getStatus(D.eventId);
    ok(sD.body.complete === true && sD.body.fde?.terminal === true, "状态接口看到 cron 完成的结果", sD.body.fde);
    const again = await drainInboundFdeQueue({ orgIds: [ORG], deadlineAt: Date.now() + 120_000 });
    ok((await runsFor(oppD)) === 1 && !again.results.some((r) => r.fdeExecuted > 0 && r.error), "再跑一次 cron 不重跑已完成的 FDE", again.results);

    console.log("\n[8] 终态永不重跑：人工拒绝 / 行动已关闭");
    const E = inquiry("e", "Need 600 waffle bathrobes for a spa in Whistler, logo embroidery, April delivery.");
    const re = await ingestWebsiteInquiry(ORG, form(E)); // inline（默认）：请求内认领并执行
    const oppE = re.spine.ok ? re.spine.opportunityId : "";
    const draftE = re.fdeState?.pendingActionId ?? "";
    ok(!!re.fde?.ok && !!draftE && re.complete, "inline 路径（展会速记卡同款）照常在请求内执行 FDE", { fde: re.fde?.ok, state: re.fdeState?.status });
    const actionE = (await findReceiptByEventId(ORG, E.eventId))?.salesActionId ?? "";
    const rejected = await rejectApprovalItem("pending_action", draftE, { userId: TRADE, role: "trade", orgId: ORG });
    // 模拟记账被改回 failed（最坏情况）：草稿已被人工拒绝，仍不得复活
    const cur = await ctxOf(actionE);
    const { _status: _s, _updatedAt: _u, ...ctxE } = cur;
    void _s;
    void _u;
    await db.salesAction.update({ where: { id: actionE }, data: { inputContext: { ...ctxE, fdeStatus: "failed" } as object } });
    const runsE = await runsFor(oppE);
    const claimE = await claimInboundFde(ORG, actionE, { by: "cron" });
    const drainE = await drainInboundFdeQueue({ orgIds: [ORG], deadlineAt: Date.now() + 120_000 });
    const rE = await post(E);
    ok(rejected.ok && !claimE.claimed && claimE.reason === "terminal" && claimE.state?.status === "human_rejected", "人工拒绝后：认领拒绝（terminal / human_rejected）", { reason: claimE.reason, state: claimE.state?.status });
    ok(
      (await runsFor(oppE)) === runsE && drainE.results[0].fdeExecuted === 0 && rE.body.fde?.status === "human_rejected" && rE.body.fde.terminal === true && rE.body.fde.scheduled === false && tasks.length === 0,
      "cron 与重发都不重跑、不安排（human_rejected 终态）",
      { runs: await runsFor(oppE), drain: drainE.results, fde: rE.body.fde, tasks: tasks.length },
    );
    const F = inquiry("f", "Need 300 sherpa throws for a boutique hotel, please share MOQ.");
    const rf = await ingestWebsiteInquiry(ORG, form(F), { fdeMode: "deferred", scheduleFde: drop });
    const oppF = rf.spine.ok ? rf.spine.opportunityId : "";
    const actionF = (await findReceiptByEventId(ORG, F.eventId))?.salesActionId ?? "";
    await db.salesAction.update({ where: { id: actionF }, data: { status: "dismissed", dismissedAt: new Date(), dismissedReason: "fixture: handled by phone", activeKey: null } });
    const claimF = await claimInboundFde(ORG, actionF, { by: "cron" });
    const rF = await post(F);
    ok(
      !claimF.claimed && claimF.reason === "action_closed" && rF.body.fde?.status === "action_closed" && rF.body.fde.terminal === true && rF.body.fde.scheduled === false && (await runsFor(oppF)) === 0,
      "行动在 FDE 前被人工关闭 → 不认领、不安排，报告 action_closed 终态",
      { claim: claimF.reason, fde: rF.body.fde },
    );

    console.log("\n[9] FDE 在建 run 前早退：释放认领，不挂在 running");
    const G = inquiry("g", "Need 900 microfiber bathrobes for a cruise line, delivery May.");
    const rg = await ingestWebsiteInquiry(ORG, form(G), { fdeMode: "deferred", scheduleFde: drop });
    const oppG = rg.spine.ok ? rg.spine.opportunityId : "";
    const actionG = (await findReceiptByEventId(ORG, G.eventId))?.salesActionId ?? "";
    await db.salesOpportunity.update({ where: { id: oppG }, data: { stage: "won" } });
    const runG = await runQueuedInboundFde(ORG, actionG, { by: "cron", trigger: "cron" });
    const ctxG = await ctxOf(actionG);
    ok(runG.ran && runG.result?.errorCode === "TERMINAL" && !runG.result.agentRunId && ctxG.fdeStatus === "failed" && ctxG.fdeErrorCode === "TERMINAL", "商机已终结 → FDE 早退，认领被释放为 failed（带原因），不挂 running", { ran: runG.ran, code: runG.result?.errorCode, ctx: { s: ctxG.fdeStatus, c: ctxG.fdeErrorCode } });

    console.log("\n[10] cron 候选过滤：重试上限 / 历史行 / 过期 running / 非来信行动");
    const setCtx = async (id: string, patch: Record<string, unknown>, removeKeys: string[] = [], updatedAt?: Date) => {
      const c = await ctxOf(id);
      const { _status: _a, _updatedAt: _b, ...rest } = c;
      void _a;
      void _b;
      for (const k of removeKeys) delete rest[k];
      await db.salesAction.update({ where: { id }, data: { inputContext: { ...rest, ...patch } as object, ...(updatedAt ? { updatedAt } : {}) } });
    };
    const has = async (id: string) => (await listInboundFdeCandidates(ORG, new Date(), 100)).some((c) => c.id === id);
    ok(await has(actionG), "failed 且认领 1 次 → 候选");
    await setCtx(actionG, { fdeAttempts: FDE_CRON_MAX_ATTEMPTS });
    ok(!(await has(actionG)), `failed 且已认领 ${FDE_CRON_MAX_ATTEMPTS} 次 → 不再自动重试`);
    await setCtx(actionG, {}, ["fdeAttempts"]);
    ok(!(await has(actionG)), "没有 fdeAttempts 的历史 failed 行 → 不在候选（与改动前 cron 一致）");
    await setCtx(actionG, { fdeStatus: "running", fdeAttempts: 1 }, [], new Date(Date.now() - FDE_CLAIM_STALE_MS - 60_000));
    ok(await has(actionG), "过期 running（认领者已中断）→ 候选");
    await setCtx(actionG, { fdeStatus: "run_blocked", fdeAttempts: 9 });
    ok(await has(actionG), "run_blocked（未建 run、未花 LLM）不受 fdeAttempts 上限；没有 fdeBlockedAttempts 的历史行照常是候选");
    await setCtx(actionG, { fdeBlockedAttempts: FDE_CRON_MAX_ATTEMPTS - 1 });
    ok(await has(actionG), "非配额 run_blocked 未到上限 → 候选");
    await setCtx(actionG, { fdeBlockedAttempts: FDE_CRON_MAX_ATTEMPTS });
    ok(!(await has(actionG)), `非配额 run_blocked 已 ${FDE_CRON_MAX_ATTEMPTS} 次 → 不再自动重试（不会永远排在候选前面）`);
    await setCtx(actionG, {}, ["fdeBlockedAttempts"]);
    const custA = (await db.salesOpportunity.findUniqueOrThrow({ where: { id: oppA }, select: { customerId: true } })).customerId;
    const nextAction = await createFdeAction({
      orgId: ORG,
      customerId: custA,
      opportunityId: oppA,
      actionType: "follow_up",
      category: "record_followup",
      title: "fixture next action",
      priority: "high",
      signalKey: `next_action:follow_up:${stamp}`,
      assignedToId: OWNER,
      createdById: OWNER,
      inputContext: { generatedBy: "cron", fdeStatus: "queued" },
    });
    ok(!(await has(nextAction.id)) && !(await claimInboundFde(ORG, nextAction.id, { by: "cron" })).claimed, "next_action 等非来信行动（同 employeeKey）不是 FDE 候选、不可认领");
    const otherOrgCandidates = await listInboundFdeCandidates(ORG2, new Date(), 100);
    const crossClaim = await claimInboundFde(ORG2, actionD, { by: "cron" });
    ok(otherOrgCandidates.length === 0 && !crossClaim.claimed && crossClaim.reason === "not_found", "按组织限定：他组织看不到、也认领不了本组织的 FDE", { n: otherOrgCandidates.length, cross: crossClaim.reason });

    // 排队一条来信 FDE（回调丢失，只能靠 cron / 重发 / 人工入口接手）
    const queuedInquiry = async (key: string, message: string) => {
      const q = inquiry(key, message);
      const r = await ingestWebsiteInquiry(ORG, form(q), { fdeMode: "deferred", scheduleFde: drop });
      const opp = r.spine.ok ? r.spine.opportunityId : "";
      const action = (await findReceiptByEventId(ORG, q.eventId))?.salesActionId ?? "";
      if (!opp || !action || r.fdeState?.status !== "queued") throw new Error(`fixture ${key} not queued`);
      return { opp, action };
    };

    console.log("\n[11] 配额 run_blocked：不占重试上限；配额恢复后照常执行");
    const H = await queuedInquiry("h", "Need 1,200 bath sheets 90x180cm for a hotel chain in Calgary, June delivery.");
    await db.capabilityQuotaPolicy.create({ data: { orgId: ORG, metric: "DAILY_AGENT_RUNS", period: "DAILY", hardLimit: 0, enabled: true } });
    const quotaRuns: Array<{ ran: boolean; code: string | undefined; attempts: unknown; blocked: unknown; status: unknown; errorCode: unknown }> = [];
    for (let i = 0; i < FDE_CRON_MAX_ATTEMPTS + 1; i++) {
      const run = await runQueuedInboundFde(ORG, H.action, { by: "cron", trigger: "cron" });
      const c = await ctxOf(H.action);
      quotaRuns.push({ ran: run.ran, code: run.result?.errorCode, attempts: c.fdeAttempts, blocked: c.fdeBlockedAttempts, status: c.fdeStatus, errorCode: c.fdeErrorCode });
    }
    ok(
      quotaRuns.every((q) => q.ran && q.code === "QUOTA" && q.status === "run_blocked" && q.attempts === 0 && q.blocked === undefined && q.errorCode === "QUOTA") && (await runsFor(H.opp)) === 0,
      `配额耗尽时连续 ${FDE_CRON_MAX_ATTEMPTS + 1} 次认领：每次都 run_blocked，fdeAttempts 退回 0、不计 fdeBlockedAttempts，没有 AgentRun`,
      quotaRuns,
    );
    ok(await has(H.action), "配额 run_blocked 仍是 cron 候选");
    const drainQ = await drainInboundFdeQueue({ orgIds: [ORG], deadlineAt: Date.now() + 120_000 });
    ok(drainQ.results[0].quotaBlocked === true && (await ctxOf(H.action)).fdeAttempts === 0, "cron 遇到配额 → 本轮停止该组织的 FDE；计数仍为 0", drainQ.results);
    await db.capabilityQuotaPolicy.deleteMany({ where: { orgId: ORG } });
    const runH = await runQueuedInboundFde(ORG, H.action, { by: "cron", trigger: "cron" });
    const ctxH = await ctxOf(H.action);
    ok(
      runH.ran && !!runH.result?.agentRunId && ctxH.fdeStatus === "completed" && ctxH.fdeAttempts === 1 && (await runsFor(H.opp)) === 1 && (await pendingFor(H.opp)) === 1,
      "配额恢复后：执行一次（fdeAttempts = 1，重试上限完整保留）→ 1 个 run、1 份草稿",
      { ran: runH.ran, code: runH.result?.errorCode, ctx: { s: ctxH.fdeStatus, a: ctxH.fdeAttempts } },
    );

    console.log("\n[12] 卡住的候选不挡住后面的排队 FDE（每批只读 1 条也能轮到）");
    const J1 = await queuedInquiry("j1", "Need 400 linen duvet covers queen size for a B&B group.");
    const J2 = await queuedInquiry("j2", "Need 250 cotton waffle robes for a gym chain.");
    const K = await queuedInquiry("k", "Need 3,000 white hotel hand towels 40x70cm 550gsm for Montreal, delivery July.");
    await db.salesOpportunity.updateMany({ where: { id: { in: [J1.opp, J2.opp] } }, data: { stage: "won" } });
    const head = await listInboundFdeCandidates(ORG, new Date(), 1);
    ok(head.length === 1 && head[0].id !== K.action, "按 updatedAt 升序：更早的卡住行排在新排队的 K 前面", head);
    const drainK = await drainInboundFdeQueue({ orgIds: [ORG], deadlineAt: Date.now() + 120_000, perOrgCandidates: 1 });
    const kRow = drainK.results[0];
    ok(
      (await runsFor(K.opp)) === 1 && (await pendingFor(K.opp)) === 1 && kRow.fdeRan === 1 && kRow.fdeExecuted >= 3 && kRow.fdeSkipped >= 1 && !drainK.deadlineReached,
      "每批 1 条：跳过的终态行（E）与早退行（J1 / J2）处理后继续读下一批，K 被执行",
      kRow,
    );
    ok((await ctxOf(J1.action)).fdeAttempts === 1 && (await ctxOf(J2.action)).fdeAttempts === 1, "本轮每个候选最多处理一次");
    const drainK2 = await drainInboundFdeQueue({ orgIds: [ORG], deadlineAt: Date.now() + 120_000, perOrgCandidates: 1 });
    ok(
      (await ctxOf(J1.action)).fdeAttempts === 2 && (await ctxOf(J2.action)).fdeAttempts === 2 && (await runsFor(K.opp)) === 1 && drainK2.results[0].fdeRan === 0,
      "下一轮：早退行各再试一次（计入上限），已完成的 K 不重跑",
      drainK2.results,
    );

    console.log("\n[13] 人工入口经认领");
    const L = await queuedInquiry("l", "Need 700 bamboo bath towels for an eco resort in Tofino.");
    const claimL = await claimInboundFde(ORG, L.action, { by: "cron" });
    const manualL = await runInboundFdeForHuman({ orgId: ORG, opportunityId: L.opp, salesActionId: L.action, trigger: "manual", by: "manual", actorUserId: OWNER, rerunFinished: true });
    ok(claimL.claimed && !manualL.ok && manualL.errorCode === "FDE_IN_FLIGHT" && (await runsFor(L.opp)) === 0, "手动重跑（带 salesActionId）遇到别处正在执行 → FDE_IN_FLIGHT，不并行", manualL.errorCode);
    const M = await queuedInquiry("m", "Need 1,000 jacquard bath mats for a hotel refurbishment in Ottawa.");
    const intakeM = await runInboundFdeForHuman({ orgId: ORG, opportunityId: M.opp, salesActionId: M.action, trigger: "inquiry", by: "inline", actorUserId: OWNER, rerunFinished: false });
    const ctxM = await ctxOf(M.action);
    ok(
      intakeM.ok && (await runsFor(M.opp)) === 1 && (ctxM.fdeClaim as Record<string, unknown> | undefined)?.by === "inline" && ctxM.fdeAttempts === 1,
      "录入询盘：经认领执行（认领者 inline）",
      { ok: intakeM.ok, claim: ctxM.fdeClaim },
    );
    const replayM = await runInboundFdeForHuman({ orgId: ORG, opportunityId: M.opp, salesActionId: M.action, trigger: "inquiry", by: "inline", actorUserId: OWNER, rerunFinished: false });
    ok(!replayM.ok && replayM.errorCode === "FDE_FINISHED" && (await runsFor(M.opp)) === 1, "重复录入（intake replay）：FDE 已结束 → 不重跑", replayM.errorCode);
    const rerunM = await runInboundFdeForHuman({ orgId: ORG, opportunityId: M.opp, salesActionId: M.action, trigger: "manual", by: "manual", actorUserId: OWNER, rerunFinished: true });
    ok(rerunM.ok && (await runsFor(M.opp)) === 2 && (await pendingFor(M.opp)) === 1, "手动重跑已结束的 FDE：按原行为重跑（复用未决草稿，仍只有 1 份）", { ok: rerunM.ok, code: rerunM.errorCode });
  } finally {
    __setDefaultFdeSchedulerForTest(null);
    __setInquiryReplySenderForTest(null);
    try {
      for (const orgId of [ORG, ORG2]) {
        const opps = await db.salesOpportunity.findMany({ where: { orgId }, select: { id: true } });
        await db.businessOutcome.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.websiteInquiryReceipt.deleteMany({ where: { orgId } });
        await db.tradeInquiryAnalysis.deleteMany({ where: { prospect: { orgId } } }).catch(() => undefined);
        await db.tradeOutreachStep.deleteMany({ where: { prospect: { orgId } } }).catch(() => undefined);
        await db.tradeMessage.deleteMany({ where: { prospect: { orgId } } });
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
        await db.salesOpportunity.deleteMany({ where: { id: { in: opps.map((o) => o.id) } } });
        await db.salesCustomer.deleteMany({ where: { orgId } });
        await db.agentRunEvent.deleteMany({ where: { orgId } });
        await db.agentRun.deleteMany({ where: { orgId } });
        await db.agentSession.deleteMany({ where: { orgId } });
        await db.capabilityQuotaReservation.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.capabilityQuotaPolicy.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.orgBusinessRule.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.auditLog.deleteMany({ where: { orgId } });
        await db.organizationMember.deleteMany({ where: { orgId } });
      }
      await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
      await db.auditLog.deleteMany({ where: { userId: { in: [OWNER, TRADE, OTHER] } } });
      await db.notification.deleteMany({ where: { userId: { in: [OWNER, TRADE, OTHER] } } });
      await db.user.deleteMany({ where: { id: { in: [OWNER, TRADE, OTHER] } } });
    } catch (cleanupErr) {
      console.warn("[cleanup] 清理未完成（不覆盖原始错误）：", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  }

  console.log(`\n网站询盘异步入站 DB e2e 结果: ${pass} 通过, ${fail} 失败`);
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
