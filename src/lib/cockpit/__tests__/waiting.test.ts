/**
 * A-2 "等你 N 件"——归属、去重、截断、脱敏（openspec change org-cockpit-read-model，spec cockpit/posts-overview）
 * 运行：npx tsx src/lib/cockpit/__tests__/waiting.test.ts
 */
import {
  COCKPIT_REDACTED,
  WAITING_HREF,
  approvalDetailHref,
  approvalLandingHref,
  type WaitingAccess,
  attributeNeedsYouJob,
  attributePendingMine,
  buildWaitingForYou,
  lookupIdsFor,
  projectIdOf,
  redactCockpitText,
  targetTypeOf,
  type AttributionLookups,
  type NeedsYouJobInput,
  type PendingActionRow,
  type PendingMineInput,
} from "../waiting";
import { canOpenHref } from "@/lib/navigation/landing";
import type { RouteGateContext } from "@/lib/navigation/filter-context";
import { asWorkDomain, canReadWorkDomain } from "@/lib/workforce-runtime/readable-domains";
import { WINDOW_COVERING_INDUSTRY_PACK, mergedProfileBindings } from "@/lib/authorization/role-defaults";
import { DEFAULT_SUNNY_MODULES } from "@/lib/tenancy/modules";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}

const pm = (o: Partial<PendingMineInput> & { sourceId: string }): PendingMineInput => ({
  sourceType: "PENDING_ACTION",
  actionType: "sales.send_inquiry_reply",
  title: `审批 ${o.sourceId}`,
  createdAt: "2026-10-26T10:00:00.000Z",
  projectId: null,
  ...o,
});
const job = (o: Partial<NeedsYouJobInput> & { jobId: string }): NeedsYouJobInput => ({
  title: `作业 ${o.jobId}`,
  needsYouTitle: "需要你审批",
  pendingActionIds: [],
  lastActivityAt: "2026-10-26T09:00:00.000Z",
  workDomain: "sales",
  ...o,
});
const lookups = (o: Partial<{ pas: Record<string, PendingActionRow>; projects: Record<string, string>; runs: Record<string, string> }> = {}): AttributionLookups => ({
  pendingActions: new Map(Object.entries(o.pas ?? {})),
  projectWorkDomains: new Map(Object.entries(o.projects ?? {})),
  agentRunTypes: new Map(Object.entries(o.runs ?? {})),
});
const row = (o: Partial<PendingActionRow>): PendingActionRow => ({ type: "calendar.create_event", projectId: null, agentRunId: null, payload: {}, ...o });

// ── 脱敏 ──────────────────────────────────────────────────────
console.log("脱敏");
ok(redactCockpitText("请审批本单毛利 32%") === COCKPIT_REDACTED, "含毛利 → 整段替换");
ok(redactCockpitText("预计利润 5 万") === COCKPIT_REDACTED, "strict：含利润 → 整段替换");
ok(redactCockpitText("winningBidPrice=1000") === COCKPIT_REDACTED, "含 winningBidPrice → 整段替换");
ok(redactCockpitText("给 ACME 发询盘回复") === "给 ACME 发询盘回复", "普通文本原样");
for (const t of ["项目估值 120 万", "valuation 3m", "标的额 500 万", "我方报价 $88,000", "我方最终报价 99000", "最终报价 99000", "中标金额 880000 CAD", "中标价 12 万", "成交价 10 万", "our bid price is 9k"]) {
  ok(redactCockpitText(t) === COCKPIT_REDACTED, `驾驶舱补充词表拦截「${t}」`);
}
ok(redactCockpitText("已中标，等待合同") === "已中标，等待合同", "单独的「中标」不误伤");
ok(redactCockpitText(null) === "" && redactCockpitText("  ") === "", "空值 → 空串");
ok(redactCockpitText("长".repeat(500)).length === 300, "超长截断到 300 字");
ok(!COCKPIT_REDACTED.includes("Muse"), "替换文案是驾驶舱自己的，不提 Muse 通道");

// ── 上下文字段 ────────────────────────────────────────────────
console.log("上下文字段");
ok(targetTypeOf({ targetType: "CUSTOMER", metadata: { targetType: "PROJECT" } }) === "CUSTOMER", "payload.targetType 优先");
ok(targetTypeOf({ metadata: { targetType: "quote" } }) === "quote", "其次 payload.metadata.targetType");
ok(targetTypeOf(null) === null && targetTypeOf([1]) === null && targetTypeOf({ targetType: 3 }) === null, "非对象 / 非字符串 → null");
ok(projectIdOf(row({ projectId: "p1", payload: { targetType: "PROJECT", targetId: "p2" } })) === "p1", "PendingAction.projectId 优先");
ok(projectIdOf(row({ payload: { targetType: "project", targetId: "p2" } })) === "p2", "目标类型 PROJECT 时取 targetId（不区分大小写）");
ok(projectIdOf(row({ payload: { targetType: "CUSTOMER", targetId: "c1" } })) === null, "目标不是项目 → null");
{
  const ids = lookupIdsFor([row({ projectId: "p1", agentRunId: "r1" }), row({ payload: { targetType: "PROJECT", targetId: "p2" } }), row({ agentRunId: "r1" })], ["p3", null]);
  ok(JSON.stringify(ids.projectIds.sort()) === '["p1","p2","p3"]' && JSON.stringify(ids.agentRunIds) === '["r1"]', "装配层需要查的项目 / run id 去重");
}

// ── 归属 ──────────────────────────────────────────────────────
console.log("岗位归属");
ok(attributePendingMine(pm({ sourceId: "a1", actionType: "sales.send_inquiry_reply" }), lookups()) === "inbound_sales", "固定类型 sales.send_inquiry_reply → inbound_sales");
ok(attributePendingMine(pm({ sourceId: "a2", actionType: "tender.send_rfq" }), lookups()) === "tender", "固定类型 tender.send_rfq → tender");
ok(
  attributePendingMine(pm({ sourceId: "a3", actionType: "grader.email_draft" }), lookups({ pas: { a3: row({ type: "grader.email_draft", payload: { targetType: "CUSTOMER" } }) } })) === "inbound_sales",
  "通用类型 grader.email_draft + targetType CUSTOMER → inbound_sales",
);
ok(
  attributePendingMine(pm({ sourceId: "a4", actionType: "grader.internal_note" }), lookups({ pas: { a4: row({ type: "grader.internal_note", payload: { targetType: "PROJECT", targetId: "p9" } }) }, projects: { p9: "tender" } })) === "tender",
  "通用类型目标为投标项目 → tender（项目工作域优先）",
);
ok(
  attributePendingMine(pm({ sourceId: "a5", actionType: "calendar.create_event" }), lookups({ pas: { a5: row({ agentRunId: "r5" }) }, runs: { r5: "runtime_v2" } })) === "inbound_sales",
  "通用类型按产出 run 类型 runtime_v2 → inbound_sales",
);
ok(attributePendingMine(pm({ sourceId: "a6", actionType: "calendar.create_event" }), lookups({ pas: { a6: row({}) } })) === null, "通用类型无上下文 → 未归属");
ok(attributePendingMine(pm({ sourceId: "a7", actionType: "calendar.create_event" }), lookups()) === null, "取不到 PendingAction 行时通用类型 → 未归属");
ok(attributePendingMine(pm({ sourceId: "r1", sourceType: "APPROVAL_REQUEST", actionType: "send_email", projectId: "p1" }), lookups({ projects: { p1: "tender" } })) === "tender", "ApprovalRequest 按项目工作域");
ok(attributePendingMine(pm({ sourceId: "r2", sourceType: "APPROVAL_REQUEST", actionType: "x", projectId: "p404" }), lookups()) === "projects", "ApprovalRequest 判定不出 → projects");
ok(attributePendingMine(pm({ sourceId: "r3", sourceType: "APPROVAL_REQUEST", actionType: "x", projectId: "pg" }), lookups({ projects: { pg: "general" } })) === "projects", "ApprovalRequest 挂在未分类项目（general）→ projects，不是 ops_knowledge");
ok(
  attributePendingMine(pm({ sourceId: "a8", actionType: "grader.project_task" }), lookups({ pas: { a8: row({ type: "grader.project_task", projectId: "pg", payload: { targetType: "PROJECT", targetId: "pg" } }) }, projects: { pg: "general" } })) === "projects",
  "通用动作挂在未分类项目 → 落到目标类型 PROJECT → projects",
);
ok(attributePendingMine(pm({ sourceId: "c1", sourceType: "PRODUCT_CONTENT", actionType: "publish" }), lookups()) === "content", "产品内容审批 → content");
ok(attributePendingMine(pm({ sourceId: "o1", sourceType: "OTHER", actionType: "x" }), lookups()) === null, "OTHER → null");
ok(attributeNeedsYouJob(job({ jobId: "j1", workDomain: "sales" })) === "inbound_sales", "需要你作业 sales → inbound_sales");
ok(attributeNeedsYouJob(job({ jobId: "j2", workDomain: "Delivery " })) === "projects", "工作域大小写 / 空白归一");
ok(attributeNeedsYouJob(job({ jobId: "j3", workDomain: null })) === null, "工作域判定不出 → 不归属");

// ── 合并与去重 ────────────────────────────────────────────────
console.log("合并与去重");
{
  const r = buildWaitingForYou({
    pendingMine: [pm({ sourceId: "pa1", createdAt: "2026-10-26T08:00:00.000Z" })],
    pendingMineTotal: 1,
    pendingMineTruncated: false,
    jobs: [job({ jobId: "j1", pendingActionIds: ["pa1"], lastActivityAt: "2026-10-26T11:00:00.000Z" })],
    jobsTruncated: false,
    lookups: lookups(),
  });
  ok(r.waitingForYou.total === 1, "作业的审批已在待我审批里 → total 只计 1", r.waitingForYou);
  ok(r.waitingForYou.items.length === 1 && r.waitingForYou.items[0].kind === "pending_action" && r.waitingForYou.items[0].id === "pa1", "items 里只出现这条 PendingAction");
  ok(r.perPost.inbound_sales.pendingApprovals === 1 && r.perPost.inbound_sales.needsYou === 1, "岗位 needsYou 不受去重影响");
}
{
  const r = buildWaitingForYou({
    pendingMine: [pm({ sourceId: "pa1" })],
    pendingMineTotal: 1,
    pendingMineTruncated: false,
    jobs: [job({ jobId: "j2", pendingActionIds: ["pa1", "pa-missing"] }), job({ jobId: "j3", pendingActionIds: [], workDomain: "tender" })],
    jobsTruncated: false,
    lookups: lookups(),
  });
  ok(r.waitingForYou.total === 3, "作业关联的审批只有部分在待我审批里 → 作业单独计数；没有关联审批的作业也计数");
  const jobItem = r.waitingForYou.items.find((i) => i.id === "j3");
  ok(jobItem?.kind === "workforce_job" && jobItem.href === "/workforce/j3" && jobItem.post === "tender", "需要你作业的条目形状与 href");
}
{
  const many = Array.from({ length: 15 }, (_, i) => pm({ sourceId: `pa${String(i).padStart(2, "0")}`, createdAt: `2026-10-26T${String(i).padStart(2, "0")}:00:00.000Z` }));
  const r = buildWaitingForYou({ pendingMine: many, pendingMineTotal: 15, pendingMineTruncated: false, jobs: [], jobsTruncated: false, lookups: lookups() });
  ok(r.waitingForYou.items.length === 10, "items 只取前 10 条");
  ok(r.waitingForYou.items[0].id === "pa14" && r.waitingForYou.items[9].id === "pa05", "按时间倒序（审批取创建时间）");
  ok(r.waitingForYou.items[0].at === "2026-10-26T14:00:00.000Z", "条目的 at 字段");
  ok(r.waitingForYou.total === 15 && r.waitingForYou.truncated === false, "total 为全部条数，未截断");
  // VIS-1b：没有专属落点的审批跳审批详情（编码后的「来源类型:来源 id」），不再一律跳列表页
  ok(r.waitingForYou.items.every((i) => i.href === `${WAITING_HREF}/${encodeURIComponent(`PENDING_ACTION:${i.id}`)}`), "无专属落点的审批条目跳审批详情（编码后的 PENDING_ACTION:<id>）");
  ok(r.waitingForYou.href === WAITING_HREF, "横幅本身仍跳 /capabilities/approvals");
}
{
  const r = buildWaitingForYou({
    pendingMine: [pm({ sourceId: "pa1" })],
    pendingMineTotal: 120,
    pendingMineTruncated: false,
    jobs: [],
    jobsTruncated: false,
    lookups: lookups(),
  });
  ok(r.waitingForYou.total === 120 && r.waitingForYou.truncated === true, "待我审批总数大于已取回条数 → total 用总数且 truncated");
}
{
  const r = buildWaitingForYou({ pendingMine: [], pendingMineTotal: 0, pendingMineTruncated: false, jobs: [job({ jobId: "j1" })], jobsTruncated: true, lookups: lookups() });
  ok(r.waitingForYou.truncated === true, "需要你作业被截断 → truncated");
}
{
  const r = buildWaitingForYou({
    pendingMine: [pm({ sourceId: "pa1", actionType: "calendar.create_event", title: "提醒" }), pm({ sourceId: "pa2", title: "本单毛利偏低请确认" })],
    pendingMineTotal: 2,
    pendingMineTruncated: false,
    jobs: [job({ jobId: "j1", workDomain: null, title: null, needsYouTitle: "需要澄清" })],
    jobsTruncated: false,
    lookups: lookups(),
  });
  ok(r.waitingForYou.unattributed === 2, "未归属条数：无上下文的通用动作 + 无工作域的作业", r.waitingForYou);
  ok(r.waitingForYou.items.find((i) => i.id === "pa2")?.title === COCKPIT_REDACTED, "标题含毛利 → 整段替换");
  ok(r.waitingForYou.items.find((i) => i.id === "j1")?.title === "需要澄清", "作业无标题时用需要你文案");
  ok(Object.keys(r.perPost).length === 7, "perPost 含七个岗位");
}
{
  const r = buildWaitingForYou({
    pendingMine: [pm({ sourceId: "o1", sourceType: "OTHER" })],
    pendingMineTotal: 1,
    pendingMineTruncated: false,
    jobs: [],
    jobsTruncated: false,
    lookups: lookups(),
  });
  ok(r.waitingForYou.items.length === 0 && r.waitingForYou.total === 1, "OTHER 来源不进 items，但仍计入总数");
}

// ── VIS-1b：按类型给落点、落点放行才列、截断口径、作业按可读域（spec cockpit/posts-overview、agents/workforce-job-scope）──
{
  const L = (actionType: string, payload: Record<string, unknown>, extra: Partial<PendingActionRow> = {}) =>
    approvalLandingHref(pm({ sourceId: "pa1", actionType }), row({ type: actionType, payload, ...extra }));
  ok(L("sales.approve_quote_promotion", { quoteId: "q1" }) === "/sales/quote-sheet?mode=order&quoteId=q1", "超限折扣 → 报价单");
  ok(L("sales.update_signed_quote", { quoteId: "q1" }) === "/sales/quote-sheet?mode=order&quoteId=q1", "签约改价 → 报价单");
  ok(L("sales.update_quote_settings", {}) === "/sales/cockpit", "折扣设置变更 → 销售驾驶舱");
  ok(L("install.send_warranty_email", { orderId: "o1" }) === "/accounting?tab=balance&order=o1", "质保邮件 → 会计待收尾款页签");
  ok(L("install.send_repair_visit_email", { repairId: "r1", orderId: "o1" }) === "/install/repairs/r1", "返修邮件 → 维修单");
  ok(L("orders.cancel_blinds_order", { orderId: "o1" }) === "/blinds-orders/o1", "取消订单 → 工艺单");
  ok(L("tender.send_rfq", { projectId: "p1", inquiryId: "i1" }) === "/projects/p1?tab=bid#rfq-round-i1", "询价 → 项目的该轮询价");
  ok(L("tender.send_chase", { inquiryId: "i1" }, { projectId: "p1" }) === "/projects/p1?tab=bid#rfq-round-i1", "催单：payload 缺 projectId 时取 PendingAction.projectId");
  ok(L("revenue_spine.propose_commercial_fact", {}) === "/revenue", "营收脊柱 → 营收中心");
  ok(L("grader.email_draft", {}) === "/capabilities/approvals/PENDING_ACTION%3Apa1", "没有专属落点 → 审批详情（PENDING_ACTION%3Apa1）");
  ok(L("sales.approve_quote_promotion", {}) === "/capabilities/approvals/PENDING_ACTION%3Apa1", "payload 缺 id → 退回审批详情");
  ok(
    approvalLandingHref(pm({ sourceType: "APPROVAL_REQUEST", sourceId: "ar1", actionType: "send_email" }), null) === "/capabilities/approvals/APPROVAL_REQUEST%3Aar1" &&
      approvalLandingHref(pm({ sourceType: "PRODUCT_CONTENT", sourceId: "pc1", actionType: "publish" }), null) === approvalDetailHref("PRODUCT_CONTENT", "pc1"),
    "ApprovalRequest 与产品内容审批 → 审批详情",
  );

  const keys = (...p: string[]) => [...new Set(p.flatMap((k) => mergedProfileBindings(WINDOW_COVERING_INDUSTRY_PACK, k).filter((b) => (b.effect ?? "ALLOW") === "ALLOW").map((b) => b.permissionKey)))];
  const ctx = (permissionKeys: string[], extra: Partial<RouteGateContext> = {}): RouteGateContext => ({
    platformRole: "user", orgRole: "org_admin", hasMembership: true, workspaceIds: [], modules: { enabled: [...DEFAULT_SUNNY_MODULES] },
    isPlatformAdmin: false, permissionKeys, positionMode: true, hasBidCapability: false, autopilotAllowed: false, wechatEntryEnabled: false, ...extra,
  });
  const access = (c: RouteGateContext): WaitingAccess => ({ canOpen: (h) => canOpenHref(h, c), canReadWorkDomain: (d) => canReadWorkDomain(asWorkDomain(d), c) });
  const owner = ctx(keys("owner"));
  const landings = ["/sales/quote-sheet?mode=order&quoteId=q1", "/sales/cockpit", "/accounting?tab=balance&order=o1", "/install/repairs/r1", "/blinds-orders/o1", "/projects/p1?tab=bid#rfq-round-i1", "/capabilities/approvals/PENDING_ACTION%3Apa1"];
  ok(landings.every((h) => canOpenHref(h, owner)) && !canOpenHref("/revenue", owner), "Sunny 老板：各专属落点都放行，营收中心不放行（未启用 trade）");

  const pas = {
    pa1: row({ type: "sales.approve_quote_promotion", payload: { quoteId: "q1" } }),
    pa2: row({ type: "revenue_spine.propose_commercial_fact", payload: {} }),
    pa3: row({ type: "install.send_warranty_email", payload: { orderId: "o1" } }),
  };
  const mine = [
    pm({ sourceId: "pa1", actionType: "sales.approve_quote_promotion", createdAt: "2026-10-26T12:00:00.000Z" }),
    pm({ sourceId: "pa2", actionType: "revenue_spine.propose_commercial_fact", createdAt: "2026-10-26T11:00:00.000Z" }),
    pm({ sourceId: "pa3", actionType: "install.send_warranty_email", createdAt: "2026-10-26T10:00:00.000Z" }),
  ];
  const r = buildWaitingForYou({ pendingMine: mine, pendingMineTotal: 3, pendingMineTruncated: false, jobs: [], jobsTruncated: false, lookups: lookups({ pas }), access: access(owner) });
  ok(r.waitingForYou.items.find((i) => i.id === "pa1")?.href === "/sales/quote-sheet?mode=order&quoteId=q1", "折扣审批跳报价单（含 quoteId）");
  ok(r.waitingForYou.items.find((i) => i.id === "pa3")?.href === "/accounting?tab=balance&order=o1", "质保邮件跳会计页（含 orderId）");
  ok(!r.waitingForYou.items.some((i) => i.id === "pa2") && r.waitingForYou.total === 2, "落点不放行的条目不列：Sunny 老板的营收脊柱不计入 total、不出现在 items", r.waitingForYou);
  ok(r.perPost.inbound_sales.pendingApprovals === 1, "不列的条目也不计入岗位待审批数（只剩折扣那一条）");

  const superAdmin = ctx([], { platformRole: "super_admin", isPlatformAdmin: true });
  const rs = buildWaitingForYou({ pendingMine: mine, pendingMineTotal: 3, pendingMineTruncated: false, jobs: [], jobsTruncated: false, lookups: lookups({ pas }), access: access(superAdmin) });
  ok(rs.waitingForYou.total === 3 && rs.waitingForYou.items.length === 3, "平台 super_admin：落点一律放行，三条都列");

  // 截断：总数 120、取到 100 条、其中 3 条落点不放行 → 97 + 未取到的 20
  const hundred = Array.from({ length: 100 }, (_, i) =>
    pm({ sourceId: `p${i}`, actionType: i < 3 ? "revenue_spine.propose_commercial_fact" : "grader.email_draft", createdAt: `2026-10-26T10:${String(i % 60).padStart(2, "0")}:00.000Z` }),
  );
  const rt = buildWaitingForYou({ pendingMine: hundred, pendingMineTotal: 120, pendingMineTruncated: true, jobs: [], jobsTruncated: false, lookups: lookups(), access: access(owner) });
  ok(rt.waitingForYou.total === 117 && rt.waitingForYou.truncated === true, "待我审批被截断时的总数：117（97 + 未取到的 20），truncated", { total: rt.waitingForYou.total, truncated: rt.waitingForYou.truncated });

  // 需要你作业按可读工作域：只可读交付域
  const opsStaff = ctx(keys("ops_staff"), { orgRole: "org_member" });
  const rj = buildWaitingForYou({
    pendingMine: [],
    pendingMineTotal: 0,
    pendingMineTruncated: false,
    jobs: [job({ jobId: "jt", workDomain: "tender" }), job({ jobId: "jd", workDomain: "delivery" }), job({ jobId: "jn", workDomain: null })],
    jobsTruncated: false,
    lookups: lookups(),
    access: access(opsStaff),
  });
  ok(JSON.stringify(rj.waitingForYou.items.map((i) => i.id)) === '["jd"]' && rj.waitingForYou.total === 1, "只可读交付域：投标域与解析不出的需要你作业不出现在条目与总数里", rj.waitingForYou.items.map((i) => i.id));
  ok(rj.perPost.tender.needsYou === 0 && rj.perPost.projects.needsYou === 1, "不可读的作业也不计入岗位需要你数");
}

console.log(`\n组织驾驶舱等你 N 件: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
