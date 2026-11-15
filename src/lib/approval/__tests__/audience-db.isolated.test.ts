/**
 * VIS-1d 审批的可见集合 — 真实 DB 端到端（隔离库，虚构企业；spec approvals/visibility，design D8）
 *
 *   岗位模式（窗饰）：不持岗位的 org_admin 看不到他人询价卡（审批中心列表 / 详情 404 / 批准 404 且状态不变），
 *     Sunny 老板「待我审批」有让利审批且能批；「待我确认」列表与红点同一组条件、只含当前企业；
 *     AI 助手 / 端口 / Muse 对看不见的卡与不存在的 id 返回相同；幂等缓存在可见判定之后、按审批与动作命中；
 *     收件箱不含看不见的卡与另一企业的卡；以看不见的批准人批催单卡留作待批。
 *   家纺外贸：Cathy 看得到营收类审批。
 *   旧模式：管理员列表看全企业；项目负责人的「待我确认」照旧含他人的询价卡；非处理人经 AI 助手与端口得到
 *     执行器的「无权」而不是「不存在」（可见校验已放行）；两家旧模式企业的管理员红点只数当前企业。
 *
 * 不真的执行任何审批（询价、邮件类执行会出站）：放行路径只断言 canApprove / 可见结果；
 * 真正调端口的只有在执行器之前返回、或被执行器拒绝的路径。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/approval/__tests__/audience-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构企业名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 VIS-1d 审批可见集合隔离 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "VIS-1d approvals audience DB test" });
process.env.JWT_SECRET = process.env.JWT_SECRET || "vis1d-isolated-test-secret-0123456789abcdef";

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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Json = Record<string, unknown>;
type Handler = (req: unknown, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const id = (p: string) => `fx_vis1d_${p}_${stamp}`;
// 窗饰（岗位模式）
const OWNER = id("owner");
const ADMIN0 = id("admin0");
const ADMIN1 = id("admin1");
const ACCT = id("acct");
const REP1 = id("rep1");
const REP2 = id("rep2");
const BIDS = id("bids");
// 家纺外贸（岗位模式）
const CATHY = id("cathy");
const TR = id("tr");
// 旧模式
const LADMIN = id("ladmin");
const LOWNER = id("lowner");
const LNON = id("lnon");
const LG2OWNER = id("lg2owner");
const USERS = [OWNER, ADMIN0, ADMIN1, ACCT, REP1, REP2, BIDS, CATHY, TR, LADMIN, LOWNER, LNON, LG2OWNER];

const WC = id("orgwc");
const MX = id("orgmx");
const LG = id("orglg");
const LG2 = id("orglg2");
const ORGS = [WC, MX, LG, LG2];
const P1 = id("p1");
const LP = id("lp");

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { buildCapabilitiesAccess, CapabilitiesAccessError } = await import("@/lib/capabilities/access");
  const { listCapabilityApprovals, getCapabilityApproval } = await import("@/lib/capabilities/approvals/query");
  const { decideCapabilityApproval } = await import("@/lib/capabilities/approvals/decision");
  const { makeApprovalId } = await import("@/lib/capabilities/approvals/types");
  const { listMyPendingActions, countMyPendingActions } = await import("@/lib/approval/pending-mine");
  const { approveApprovalItem, rejectApprovalItem, listApprovalInbox } = await import("@/lib/approval/port");
  const { getPendingApprovals } = await import("@/lib/agent/approval");
  const { handleMuseCommand } = await import("@/lib/muse-bridge/router");
  const { resolveMuseBinding } = await import("@/lib/muse-bridge/binding");
  const { MUSE_BRIDGE_CONTRACT_VERSION } = await import("@/lib/muse-bridge/contract");
  const approveRoute = await import("@/app/api/ai/pending-actions/[id]/route");
  const { cardVisibleTo, loadApprovalViewer } = await import("@/lib/approval/audience-server");
  const { pendingActionAudienceWhere, pendingActionItem } = await import("@/lib/approval/audience");
  const { DEFAULT_SUNNY_MODULES } = await import("@/lib/tenancy");

  const cardIds: string[] = [];
  const taskIds: string[] = [];
  const idemKeys: string[] = [];

  try {
    // ── 种子：先绑岗位，再取任何判定输入 ──
    for (const uid of USERS) await db.user.create({ data: { id: uid, email: `${uid}@fixture.test`, name: `Example ${uid.slice(9, 17)}`, role: "user" } });
    const museBindings = { [`muse-admin0-${stamp}`]: { userId: ADMIN0, boundAt: new Date().toISOString(), boundBy: OWNER } };
    await db.organization.create({ data: { id: WC, name: `Example Blinds ${stamp}`, code: `fx-vis1d-wc-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1", modulesJson: { enabled: [...DEFAULT_SUNNY_MODULES] }, settingsJson: { museBridge: { bindings: museBindings } } } });
    await db.organization.create({ data: { id: MX, name: `Example Textiles ${stamp}`, code: `fx-vis1d-mx-${stamp}`, ownerId: CATHY, industryPackId: "home_textile_trade_v1", modulesJson: { enabled: ["trade"] } } });
    await db.organization.create({ data: { id: LG, name: `Example Legacy ${stamp}`, code: `fx-vis1d-lg-${stamp}`, ownerId: LADMIN } });
    await db.organization.create({ data: { id: LG2, name: `Example Legacy Two ${stamp}`, code: `fx-vis1d-lg2-${stamp}`, ownerId: LG2OWNER } });
    const member = (orgId: string, userId: string, role = "org_member") => ({ orgId, userId, role, status: "active" });
    await db.organizationMember.createMany({
      data: [
        member(WC, OWNER, "org_admin"),
        member(WC, ADMIN0, "org_admin"),
        member(WC, ADMIN1, "org_admin"),
        member(WC, ACCT),
        member(WC, REP1),
        member(WC, REP2),
        member(WC, BIDS),
        member(MX, CATHY, "org_admin"),
        member(MX, TR),
        member(MX, ADMIN0, "org_admin"),
        member(MX, ADMIN1, "org_admin"),
        member(LG, LADMIN, "org_admin"),
        member(LG, LOWNER),
        member(LG, LNON),
        member(LG2, LADMIN, "org_admin"),
        member(LG2, LG2OWNER, "org_admin"),
      ],
    });
    // ADMIN0 同时是两家企业成员：AI 助手入口按当前企业解析
    await db.user.updateMany({ where: { id: { in: [ADMIN0, ADMIN1] } }, data: { activeOrgId: WC } });
    await seedOrgAuthorizationProfiles(WC);
    await seedOrgAuthorizationProfiles(MX);
    const bind = async (orgId: string, userId: string, key: string) => {
      const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId, key } } });
      if (!profile) throw new Error(`岗位 ${key} 不存在于 ${orgId}`);
      await db.principalRoleBinding.create({ data: { orgId, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
    };
    await bind(WC, OWNER, "owner");
    await bind(WC, ACCT, "accounting");
    await bind(WC, REP1, "sales_rep");
    await bind(WC, REP2, "sales_rep");
    await bind(WC, BIDS, "bids");
    await bind(MX, CATHY, "owner");
    await bind(MX, CATHY, "trade_rep");
    await bind(MX, TR, "trade_rep");

    await db.project.create({ data: { id: P1, name: "Example Tender", ownerId: BIDS, orgId: WC, status: "active" } });
    await db.project.create({ data: { id: LP, name: "Example Legacy Tender", ownerId: LOWNER, orgId: LG, status: "active" } });

    const future = new Date(Date.now() + 72 * 3600_000);
    const past = new Date(Date.now() - 3600_000);
    const card = async (data: { type: string; orgId: string | null; createdById: string; projectId?: string; approverUserId?: string; status?: string; expiresAt?: Date }) => {
      const row = await db.pendingAction.create({
        data: {
          type: data.type,
          title: `Example ${data.type}`,
          preview: "fixture",
          payload: {},
          createdById: data.createdById,
          orgId: data.orgId,
          projectId: data.projectId ?? null,
          approverUserId: data.approverUserId ?? null,
          status: data.status ?? "pending",
          expiresAt: data.expiresAt ?? future,
        },
        select: { id: true },
      });
      cardIds.push(row.id);
      return row.id;
    };
    const RFQ = await card({ type: "tender.send_rfq", orgId: WC, createdById: BIDS, projectId: P1 });
    const RFQ_DONE = await card({ type: "tender.send_rfq", orgId: WC, createdById: BIDS, projectId: P1, status: "executed" });
    const CHASE = await card({ type: "tender.send_chase", orgId: WC, createdById: BIDS, projectId: P1 });
    const PROMO = await card({ type: "sales.approve_quote_promotion", orgId: WC, createdById: REP1, approverUserId: OWNER });
    const WARRANTY = await card({ type: "install.send_warranty_email", orgId: WC, createdById: OWNER });
    const GRADER = await card({ type: "grader.email_draft", orgId: WC, createdById: REP1 });
    const GRADER_EXPIRED = await card({ type: "grader.email_draft", orgId: WC, createdById: REP1, expiresAt: past });
    const PERSONAL = await card({ type: "grader.email_draft", orgId: null, createdById: ADMIN0 });
    const REV = await card({ type: "revenue_spine.propose_commercial_fact", orgId: MX, createdById: TR });
    const MX_DRAFT = await card({ type: "grader.email_draft", orgId: MX, createdById: TR });
    const LCARD = await card({ type: "tender.send_rfq", orgId: LG, createdById: LNON, projectId: LP });
    const LCARD2 = await card({ type: "grader.email_draft", orgId: LG2, createdById: LG2OWNER });
    // 无企业、挂了项目的卡（历史数据形态）
    const NOORG_WC = await card({ type: "tender.send_rfq", orgId: null, createdById: REP1, projectId: P1 });
    const NOORG_LG = await card({ type: "tender.send_rfq", orgId: null, createdById: LNON, projectId: LP });
    const MISSING = id("missing");

    const task = await db.agentTask.create({ data: { projectId: P1, intent: "fixture", createdById: BIDS }, select: { id: true } });
    taskIds.push(task.id);
    const step = await db.agentTaskStep.create({ data: { taskId: task.id, stepIndex: 0, skillId: "fixture", agentName: "fixture", title: "Example step" }, select: { id: true } });
    const AR = (await db.approvalRequest.create({ data: { taskId: task.id, stepId: step.id, actionType: "tender.fixture", riskLevel: "medium" }, select: { id: true } })).id;

    const fakeUser = (uid: string) => ({ id: uid, email: `${uid}@fixture.test`, name: uid, nickname: null, avatar: null, role: "user", status: "active" }) as never;
    const access = (userId: string, orgId: string, orgRole: string) =>
      buildCapabilitiesAccess({ userId, orgId, orgRole, isPlatformAdmin: false, user: fakeUser(userId) });
    const pa = (sourceId: string) => makeApprovalId("PENDING_ACTION", sourceId);
    const status = async (cardId: string) => (await db.pendingAction.findUnique({ where: { id: cardId }, select: { status: true } }))?.status;
    const caught = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return null;
      } catch (e) {
        return e instanceof CapabilitiesAccessError ? { name: e.name, code: e.code, httpStatus: e.httpStatus, message: e.message } : { other: String(e) };
      }
    };

    // ── 审批中心 ──
    console.log("\n审批中心");
    const adminAccess = await access(ADMIN0, WC, "org_admin");
    const adminList = await listCapabilityApprovals(adminAccess, { tab: "all", pageSize: 100 });
    const adminIds = new Set(adminList.items.map((i) => i.id));
    ok(!adminIds.has(pa(RFQ)) && !adminIds.has(pa(RFQ_DONE)) && !adminIds.has(makeApprovalId("APPROVAL_REQUEST", AR)), "不持岗位的 org_admin：列表里没有他人的询价卡与项目智能体审批", [...adminIds]);
    ok(adminIds.has(pa(GRADER)) && !adminIds.has(pa(PROMO)) && !adminIds.has(pa(WARRANTY)), "不持岗位的 org_admin：只见无业务归属的草稿，不见销售 / 安装类", [...adminIds]);
    const hiddenDetail = await caught(() => getCapabilityApproval(adminAccess, pa(RFQ)));
    const missingDetail = await caught(() => getCapabilityApproval(adminAccess, pa(MISSING)));
    ok(hiddenDetail?.httpStatus === 404 && same(hiddenDetail, missingDetail), "详情：看不见与不存在同一个 404", { hiddenDetail, missingDetail });
    const hiddenDecide = await caught(() => decideCapabilityApproval(adminAccess, { approvalId: pa(RFQ), action: "approve" }));
    const missingDecide = await caught(() => decideCapabilityApproval(adminAccess, { approvalId: pa(MISSING), action: "approve" }));
    ok(hiddenDecide?.httpStatus === 404 && same(hiddenDecide, missingDecide) && (await status(RFQ)) === "pending", "批准：看不见的 404，状态不变", { hiddenDecide, missingDecide });
    const arDetail = await caught(() => getCapabilityApproval(adminAccess, makeApprovalId("APPROVAL_REQUEST", AR)));
    ok(arDetail?.httpStatus === 404, "项目智能体审批详情：看不见 404", arDetail);

    const ownerAccess = await access(OWNER, WC, "org_admin");
    const ownerMine = await listCapabilityApprovals(ownerAccess, { tab: "pending_mine", pageSize: 100 });
    const promo = ownerMine.items.find((i) => i.id === pa(PROMO));
    ok(!!promo && promo.capabilities.canApprove === true, "Sunny 老板：「待我审批」有让利审批且能批", ownerMine.items.map((i) => i.id));
    const ownerAll = new Set((await listCapabilityApprovals(ownerAccess, { tab: "all", pageSize: 100 })).items.map((i) => i.id));
    ok(ownerAll.has(pa(RFQ)) && ownerAll.has(pa(WARRANTY)) && ownerAll.has(pa(GRADER)), "Sunny 老板：询价、质保邮件、无业务归属草稿都可见", [...ownerAll]);

    const acctAll = new Set((await listCapabilityApprovals(await access(ACCT, WC, "org_member"), { tab: "all", pageSize: 100 })).items.map((i) => i.id));
    ok(acctAll.has(pa(WARRANTY)) && !acctAll.has(pa(PROMO)) && !acctAll.has(pa(RFQ)) && !acctAll.has(pa(GRADER)), "会计：只见质保邮件", [...acctAll]);

    const cathyAll = new Set((await listCapabilityApprovals(await access(CATHY, MX, "org_admin"), { tab: "all", pageSize: 100 })).items.map((i) => i.id));
    ok(cathyAll.has(pa(REV)), "梦馨 Cathy：看得到营收类审批", [...cathyAll]);

    // 幂等：看不见的卡带它的键 → 404；可见的审批 id 带别人的键 → 不返回别人的缓存
    const K_HIDDEN = id("khidden");
    const K_OWN = id("kown");
    idemKeys.push(K_HIDDEN, K_OWN);
    await db.approvalDecisionIdempotency.create({ data: { orgId: WC, idempotencyKey: K_HIDDEN, approvalKey: pa(RFQ), action: "approve", userId: BIDS, resultJson: { ok: true, status: "EXECUTED", message: "SENTINEL-OTHER" } } });
    await db.approvalDecisionIdempotency.create({ data: { orgId: WC, idempotencyKey: K_OWN, approvalKey: pa(GRADER_EXPIRED), action: "approve", userId: ADMIN0, resultJson: { ok: false, message: "SENTINEL-OWN" } } });
    const idemHidden = await caught(() => decideCapabilityApproval(adminAccess, { approvalId: pa(RFQ), action: "approve", idempotencyKey: K_HIDDEN }));
    ok(idemHidden?.httpStatus === 404, "幂等：看不见的卡带它自己的幂等键 → 404", idemHidden);
    const borrowed = await decideCapabilityApproval(adminAccess, { approvalId: pa(GRADER_EXPIRED), action: "approve", idempotencyKey: K_HIDDEN });
    ok(borrowed.message !== "SENTINEL-OTHER" && borrowed.code === "expired" && borrowed.duplicate !== true, "幂等：可见的审批 id 带别人的键，不返回别人的缓存（照常判过期）", borrowed);
    const own = await decideCapabilityApproval(adminAccess, { approvalId: pa(GRADER_EXPIRED), action: "approve", idempotencyKey: K_OWN });
    ok(own.message === "SENTINEL-OWN" && own.duplicate === true, "幂等：审批与动作都相同时照旧命中", own);
    const ownOtherAction = await decideCapabilityApproval(adminAccess, { approvalId: pa(GRADER_EXPIRED), action: "reject", idempotencyKey: K_OWN });
    ok(ownOtherAction.message !== "SENTINEL-OWN", "幂等：同一审批、不同动作不命中", ownOtherAction);

    // ── 待我确认 / 红点 ──
    console.log("\n待我确认与红点");
    const mine = await listMyPendingActions(ADMIN0, WC, { status: "pending" });
    const mineIds = new Set(mine.map((a) => a.id));
    ok(mineIds.has(GRADER) && mineIds.has(PERSONAL) && !mineIds.has(RFQ) && !mineIds.has(CHASE) && !mineIds.has(MX_DRAFT), "不持岗位的 org_admin：「待我确认」只有本企业无业务归属草稿与个人草稿，不含另一企业的", [...mineIds]);
    const count = await countMyPendingActions(ADMIN0, WC);
    const unexpired = mine.filter((a) => a.status === "pending" && a.expiresAt.getTime() > Date.now()).length;
    ok(count === unexpired && mineIds.has(GRADER_EXPIRED) && count === mine.length - 1, "红点数 = 列表里未过期的条数（过期的列表照常显示）", { count, unexpired, total: mine.length });
    ok((await countMyPendingActions(ADMIN0, null)) === 1, "解析不出当前企业：红点只数本人的个人草稿");
    // spec 场景「红点数与列表一致」：企业里一条他人的询价、一条无业务归属的助手草稿（另有一条已过期的），另一企业里一条他本可处理的草稿
    const mine1 = await listMyPendingActions(ADMIN1, WC, { status: "pending" });
    const mine1Live = mine1.filter((a) => a.expiresAt.getTime() > Date.now());
    ok(
      mine1.every((a) => a.orgId === WC && a.type === "grader.email_draft") && mine1Live.length === 1 && mine1Live[0].id === GRADER,
      "spec 场景：列表只有本企业的助手草稿（过期的照常列出）",
      mine1.map((a) => [a.id, a.type, a.orgId]),
    );
    ok((await countMyPendingActions(ADMIN1, WC)) === 1, "spec 场景：红点数为 1");
    const ownerMinePA = new Set((await listMyPendingActions(OWNER, WC, { status: "pending" })).map((a) => a.id));
    ok(ownerMinePA.has(PROMO) && ownerMinePA.has(RFQ) && ownerMinePA.has(GRADER), "Sunny 老板：「待我确认」有让利审批、询价与无业务归属草稿", [...ownerMinePA]);

    // ── 收件箱（Muse 与 /api/agent/approvals 所用） ──
    console.log("\n收件箱");
    const inbox = await listApprovalInbox(ADMIN0, { orgId: WC });
    const inboxIds = new Set(inbox.map((i) => i.id));
    ok(!inboxIds.has(RFQ) && !inboxIds.has(CHASE) && !inboxIds.has(AR) && !inboxIds.has(MX_DRAFT) && inboxIds.has(GRADER), "不持岗位的 org_admin：收件箱不含看不见的卡（含项目智能体审批），也不含另一企业的", [...inboxIds]);
    const bidsInbox = new Set((await listApprovalInbox(BIDS, { orgId: WC })).map((i) => `${i.kind}:${i.id}`));
    ok(bidsInbox.has(`pending_action:${RFQ}`) && bidsInbox.has(`approval_request:${AR}`), "招投标（项目负责人）：收件箱有询价卡与项目智能体审批", [...bidsInbox]);
    ok((await getPendingApprovals(ADMIN0, { orgId: WC })).length === 0 && (await getPendingApprovals(OWNER, { orgId: WC })).some((r) => r.id === AR), "项目智能体审批：只给看得见的（Sunny 老板有，不持岗位的管理员没有）");
    ok((await getPendingApprovals(OWNER, { orgId: null })).length === 0 && (await getPendingApprovals(OWNER, { orgId: MX })).length === 0, "项目智能体审批：企业为空或另一企业时为空");

    // ── 端口：看不见与不存在逐键相同，且不执行 ──
    console.log("\n审批端口");
    const portCtx = { userId: ADMIN0, role: "user", orgId: WC };
    const hiddenApprove = await approveApprovalItem("pending_action", RFQ, portCtx);
    const missingApprove = await approveApprovalItem("pending_action", MISSING, portCtx);
    ok(same(hiddenApprove, missingApprove) && hiddenApprove.error === "草稿不存在" && (await status(RFQ)) === "pending", "端口批准：看不见的卡与随机 id 结果相同，未执行", { hiddenApprove, missingApprove });
    const doneApprove = await approveApprovalItem("pending_action", RFQ_DONE, portCtx);
    ok(same(doneApprove, missingApprove), "端口批准：看不见的已执行卡也不透露状态", doneApprove);
    const hiddenReject = await rejectApprovalItem("pending_action", RFQ, portCtx);
    const missingReject = await rejectApprovalItem("pending_action", MISSING, portCtx);
    ok(same(hiddenReject, missingReject) && (await status(RFQ)) === "pending", "端口驳回：看不见的卡与随机 id 结果相同，状态不变", { hiddenReject, missingReject });
    const arHidden = await approveApprovalItem("approval_request", AR, portCtx);
    const arMissing = await approveApprovalItem("approval_request", MISSING, portCtx);
    const arRejectHidden = await rejectApprovalItem("approval_request", AR, portCtx);
    const arStatus = (await db.approvalRequest.findUnique({ where: { id: AR }, select: { status: true } }))?.status;
    ok(same(arHidden, arMissing) && same(arRejectHidden, arMissing) && arStatus === "pending", "端口项目智能体审批：看不见与不存在相同，状态不变", { arHidden, arMissing, arRejectHidden, arStatus });
    const crossOrg = await approveApprovalItem("pending_action", MX_DRAFT, portCtx);
    ok(same(crossOrg, missingApprove) && (await status(MX_DRAFT)) === "pending", "端口：调用方企业与卡的企业不同 → 视为不存在", crossOrg);
    const chase = await approveApprovalItem("pending_action", CHASE, { userId: REP2, role: "user", orgId: WC });
    ok(!chase.ok && (await status(CHASE)) === "pending", "催单自动批准：批准人看不见那张卡时端口拒绝，留作待批", chase);

    // ── AI 助手 [id] 路由 ──
    console.log("\nAI 助手批准入口");
    const session = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: "user" })}`;
    const post = async (uid: string, cardId: string, orgId: string) => {
      const r = new NextRequest(`http://localhost/api/ai/pending-actions/${cardId}`, {
        method: "POST",
        body: JSON.stringify({ decision: "approve", orgId }),
        headers: { cookie: await session(uid), "content-type": "application/json", "x-forwarded-for": "10.34.0.9" },
      });
      const res = await (approveRoute.POST as unknown as Handler)(r, { params: Promise.resolve({ id: cardId }) });
      const text = await res.text();
      let body: Json | null = null;
      try {
        body = JSON.parse(text) as Json;
      } catch {
        body = null;
      }
      return { status: res.status, body };
    };
    const aiHidden = await post(ADMIN0, RFQ, WC);
    const aiMissing = await post(ADMIN0, MISSING, WC);
    ok(aiHidden.status === 404 && same(aiHidden, aiMissing) && (await status(RFQ)) === "pending", "AI 助手：看不见的卡与不存在的 id 返回相同的 404，未执行", { aiHidden, aiMissing });
    const aiCrossHidden = await post(ADMIN0, REV, WC);
    ok(same(aiCrossHidden, aiMissing) && (await status(REV)) === "pending", "AI 助手：另一企业里也看不见的卡，与不存在相同（不透露属于哪家企业）", aiCrossHidden);
    const aiCrossNonMember = await post(REP1, MX_DRAFT, WC);
    ok(aiCrossNonMember.status === 404 && aiCrossNonMember.body?.error === "草稿不存在", "AI 助手：不是那家企业成员的，另一企业的卡按不存在", aiCrossNonMember);
    const aiCrossVisible = await post(ADMIN0, MX_DRAFT, WC);
    ok(aiCrossVisible.status === 403 && (await status(MX_DRAFT)) === "pending", "AI 助手：在卡所属企业里看得见、但当前企业不同的，照旧提示切换企业（403），未执行", aiCrossVisible);

    // ── Muse approve ──
    console.log("\nMuse");
    const bound = await resolveMuseBinding(WC, `muse-admin0-${stamp}`);
    ok(bound.ok, "Muse：绑定解析成功", bound);
    if (bound.ok) {
      let seq = 0;
      const muse = async (approvalId: string) => {
        const requestId = `req-vis1d-${stamp}-${++seq}`;
        const envelope = { contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, requestId, orgId: WC, museUserRef: `muse-admin0-${stamp}`, command: { intent: "approve", approvalId } } as Parameters<typeof handleMuseCommand>[0];
        const res = (await handleMuseCommand(envelope, bound.identity)) as unknown as Json;
        const rest: Json = { ...res };
        delete rest.requestId;
        return rest;
      };
      const museHidden = await muse(RFQ);
      const museMissing = await muse(MISSING);
      ok(same(museHidden, museMissing) && (await status(RFQ)) === "pending", "Muse approve：看不见的卡与不存在的 id 答复相同（不是网页预览答复）", { museHidden, museMissing });
    }

    // ── 旧模式 ──
    console.log("\n旧模式企业");
    const ladminAll = new Set((await listCapabilityApprovals(await access(LADMIN, LG, "org_admin"), { tab: "all", pageSize: 100 })).items.map((i) => i.id));
    ok(ladminAll.has(pa(LCARD)), "旧模式管理员：审批中心列表看全企业（含他人的询价卡）", [...ladminAll]);
    const lmemberAll = new Set((await listCapabilityApprovals(await access(LOWNER, LG, "org_member"), { tab: "all", pageSize: 100 })).items.map((i) => i.id));
    ok(!lmemberAll.has(pa(LCARD)), "旧模式普通成员：列表照原规则只见本人相关", [...lmemberAll]);
    const lownerMine = new Set((await listMyPendingActions(LOWNER, LG, { status: "pending" })).map((a) => a.id));
    ok(lownerMine.has(LCARD), "旧模式项目负责人：「待我确认」照旧含他人的 tender.send_rfq", [...lownerMine]);
    const lnonAi = await post(LNON, LCARD, LG);
    ok(lnonAi.status === 403 && lnonAi.body?.error === "无权操作" && (await status(LCARD)) === "pending", "旧模式非处理人经 AI 助手：处理人判定拒绝（不是 404，可见校验已放行），未执行", lnonAi);
    const lnonPort = await approveApprovalItem("pending_action", LCARD, { userId: LNON, role: "user", orgId: LG });
    ok(lnonPort.error === "无权操作该草稿" && (await status(LCARD)) === "pending", "旧模式非处理人经端口：执行器「无权操作该草稿」（可见校验已放行），未执行", lnonPort);
    // 无企业、挂了项目的卡：给创建人、指定审批人与该项目的负责人（与执行器一致），不按岗位
    const noOrgWc = pendingActionItem((await db.pendingAction.findUnique({ where: { id: NOORG_WC } }))!);
    ok((await cardVisibleTo(noOrgWc, BIDS, WC)) && (await cardVisibleTo(noOrgWc, REP1, WC)) && !(await cardVisibleTo(noOrgWc, ADMIN0, WC)) && !(await cardVisibleTo(noOrgWc, OWNER, WC)), "无企业的项目卡（岗位模式）：项目负责人与创建人可见，企业管理员与持岗位的老板不可见");
    const audienceCount = async (userId: string, orgId: string, cardId: string) =>
      db.pendingAction.count({ where: { AND: [{ id: cardId }, pendingActionAudienceWhere(await loadApprovalViewer(userId, orgId)) as never] } });
    ok((await audienceCount(BIDS, WC, NOORG_WC)) === 1 && (await audienceCount(ADMIN0, WC, NOORG_WC)) === 0, "无企业的项目卡：真实查询条件与单条判定一致（运营看板口径）");
    const noOrgLg = pendingActionItem((await db.pendingAction.findUnique({ where: { id: NOORG_LG } }))!);
    ok((await cardVisibleTo(noOrgLg, LOWNER, LG)) && !(await cardVisibleTo(noOrgLg, LADMIN, LG)), "无企业的项目卡（旧模式）：项目负责人照旧可批（不收窄），企业管理员按执行器本就不认");

    const lgCount = await countMyPendingActions(LADMIN, LG);
    const lg2Count = await countMyPendingActions(LADMIN, LG2);
    ok(lgCount === 1 && lg2Count === 1, "两家旧模式企业的管理员：红点只数当前企业", { lgCount, lg2Count, LCARD, LCARD2 });
  } finally {
    await db.approvalDecisionIdempotency.deleteMany({ where: { idempotencyKey: { in: idemKeys } } }).catch(() => undefined);
    await db.approvalRequest.deleteMany({ where: { taskId: { in: taskIds } } }).catch(() => undefined);
    await db.agentTaskStep.deleteMany({ where: { taskId: { in: taskIds } } }).catch(() => undefined);
    await db.agentTask.deleteMany({ where: { id: { in: taskIds } } }).catch(() => undefined);
    await db.pendingAction.deleteMany({ where: { OR: [{ id: { in: cardIds } }, { createdById: { in: USERS } }] } }).catch(() => undefined);
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: USERS } }, { orgId: { in: ORGS } }] } }).catch(() => undefined);
    await db.notification.deleteMany({ where: { userId: { in: USERS } } }).catch(() => undefined);
    await db.project.deleteMany({ where: { id: { in: [P1, LP] } } }).catch((e) => console.warn("project cleanup:", e instanceof Error ? e.message : e));
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: ORGS } } }).catch(() => undefined);
    await db.roleProfile.deleteMany({ where: { orgId: { in: ORGS } } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: { in: ORGS } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: ORGS } } }).catch(() => undefined);
    await db.organization.deleteMany({ where: { id: { in: ORGS } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: USERS } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nVIS-1d 审批可见集合 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
