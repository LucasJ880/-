/**
 * Muse Bridge 销售意图（TASKFLOW S1）— 真实 DB 端到端（隔离库，虚构企业）
 *
 *   经 resolveMuseBinding → handleMuseCommand 走完整链：意图门、读范围、决定 B 金额可见性、
 *   跨组织 / 跨负责人不可见、互动摘要脱敏、requestId 重放、账本留痕。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/muse-bridge/__tests__/sales-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业与人名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 Muse 销售意图 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Muse sales intents DB e2e" });

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

const DAY = 86_400_000;
const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ORG_A = `fx_org_a_${stamp}`;
const ORG_B = `fx_org_b_${stamp}`;
const MGR = `fx_mgr_${stamp}`;
const REP_A = `fx_rep_a_${stamp}`;
const REP_B = `fx_rep_b_${stamp}`;
const PLAIN = `fx_plain_${stamp}`;
const OUT = `fx_out_${stamp}`;

async function main() {
  const { db } = await import("@/lib/db");
  const { resolveMuseBinding } = await import("../binding");
  const { handleMuseCommand } = await import("../router");
  const { MUSE_BRIDGE_CONTRACT_VERSION } = await import("../contract");
  const { OUTBOUND_REDACTED } = await import("../advisory");

  const now = Date.now();
  const ago = (d: number) => new Date(now - d * DAY);
  const bind = (refs: Record<string, string>) => ({
    museBridge: { bindings: Object.fromEntries(Object.entries(refs).map(([ref, userId]) => [ref, { userId, boundAt: new Date(now).toISOString(), boundBy: MGR }])) },
  });

  async function cleanup() {
    const orgIds = [ORG_A, ORG_B];
    const userIds = [MGR, REP_A, REP_B, PLAIN, OUT];
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: orgIds } }, { userId: { in: userIds } }] } });
    await db.salesAction.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.customerInteraction.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.salesOpportunity.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.salesCustomer.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }

  try {
    // ── 夹具 ──
    await db.user.createMany({
      data: [
        { id: MGR, email: `${MGR}@fixture.test`, name: "Morgan Manager", role: "boss" },
        { id: REP_A, email: `${REP_A}@fixture.test`, name: "Avery Rep", role: "sales" },
        { id: REP_B, email: `${REP_B}@fixture.test`, name: "Blake Rep", role: "sales" },
        { id: PLAIN, email: `${PLAIN}@fixture.test`, name: "Pat Plain", role: "user" },
        { id: OUT, email: `${OUT}@fixture.test`, name: "Olive Outside", role: "boss" },
      ],
    });
    await db.organization.create({
      data: { id: ORG_A, name: "Fixture Shades Co", code: `fxa-${stamp}`, ownerId: MGR, settingsJson: bind({ "muse:mgr": MGR, "muse:rep-a": REP_A, "muse:rep-b": REP_B, "muse:plain": PLAIN }) },
    });
    await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Co", code: `fxb-${stamp}`, ownerId: OUT, settingsJson: bind({ "muse:out": OUT }) } });
    await db.organizationMember.createMany({
      data: [
        { orgId: ORG_A, userId: MGR, role: "org_member" },
        { orgId: ORG_A, userId: REP_A, role: "org_member" },
        { orgId: ORG_A, userId: REP_B, role: "org_member" },
        { orgId: ORG_A, userId: PLAIN, role: "org_member" },
        { orgId: ORG_B, userId: OUT, role: "org_owner" },
      ],
    });
    const customer = (orgId: string, name: string, createdById: string) =>
      db.salesCustomer.create({ data: { orgId, name, createdById }, select: { id: true } });
    const cA = await customer(ORG_A, "Northwind Interiors", MGR);
    const cB = await customer(ORG_A, "Contoso Homes", MGR);
    const cX = await customer(ORG_B, "Fabrikam Outside", OUT);
    const opportunity = (data: Record<string, unknown>) =>
      db.salesOpportunity.create({ data: data as never, select: { id: true, updatedAt: true } });
    const a1 = await opportunity({
      orgId: ORG_A, customerId: cA.id, title: "Lobby roller shades", stage: "quoted", priority: "hot", estimatedValue: 12000,
      createdById: MGR, assignedToId: REP_A, lastInteractionAt: ago(2), lastCustomerReplyAt: ago(1), lastOutboundAt: ago(4),
    });
    const a2 = await opportunity({
      orgId: ORG_A, customerId: cA.id, title: "Office blinds refresh", stage: "negotiation", createdById: MGR, assignedToId: REP_A,
      lastInteractionAt: ago(40), createdAt: ago(60),
    });
    const b1 = await opportunity({
      orgId: ORG_A, customerId: cB.id, title: "Model home drapery", stage: "Follow_Up", estimatedValue: 5000, createdById: MGR,
      assignedToId: REP_B, nextFollowupAt: ago(3), lastInteractionAt: ago(5),
    });
    await opportunity({ orgId: ORG_A, customerId: cB.id, title: "Signed showroom", stage: "won", wonAt: ago(5), createdById: MGR, assignedToId: REP_A });
    const x1 = await opportunity({ orgId: ORG_B, customerId: cX.id, title: "Outside deal", stage: "quoted", estimatedValue: 99000, createdById: OUT, assignedToId: OUT });
    await db.customerInteraction.createMany({
      data: [
        { orgId: ORG_A, customerId: cA.id, opportunityId: a1.id, type: "email", direction: "inbound", channel: "email", summary: "Customer asked for a revised quote", createdById: REP_A, createdAt: ago(1) },
        { orgId: ORG_A, customerId: cA.id, opportunityId: a1.id, type: "note", summary: "内部备注：这单毛利 32%", createdById: MGR, createdAt: ago(3) },
        { orgId: ORG_A, customerId: cA.id, type: "phone_call", summary: "Called about the lobby install date", createdById: REP_A, createdAt: ago(2) },
        { orgId: ORG_A, customerId: cB.id, type: "note", summary: "Other customer note", createdById: REP_B, createdAt: ago(1) },
      ],
    });
    await db.salesAction.create({
      data: { orgId: ORG_A, customerId: cA.id, opportunityId: a1.id, signalKey: `fx:${stamp}:1`, category: "follow_up", title: "Send revised quote", status: "open", dueAt: ago(1), assignedToId: REP_A, createdById: MGR },
    });

    let seq = 0;
    async function send(museUserRef: string, command: Record<string, unknown>, orgId = ORG_A, requestId = `req-s1-${stamp}-${++seq}`) {
      const bound = await resolveMuseBinding(orgId, museUserRef);
      if (!bound.ok) throw new Error(`binding failed: ${bound.errorCode}`);
      const envelope = { contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, requestId, orgId, museUserRef, command } as Parameters<typeof handleMuseCommand>[0];
      return { requestId, res: await handleMuseCommand(envelope, bound.identity) };
    }
    type OverviewData = { amountsVisible: boolean; summary: Record<string, number>; opportunities: Array<{ crm: { id: string; amount?: number } }> };
    const ids = (d: unknown) => (d as OverviewData).opportunities.map((o) => o.crm.id);

    // ── [1] 意图门 ──
    delete process.env.MUSE_BRIDGE_INTENTS;
    {
      const { res } = await send("muse:mgr", { intent: "sales_overview" });
      ok(res.errorCode === "INTENT_NOT_ENABLED", "[1] 未配置 MUSE_BRIDGE_INTENTS → INTENT_NOT_ENABLED", res);
    }
    process.env.MUSE_BRIDGE_INTENTS = "status,ask,approve,reject,next_step,set_preference,preferences,sales_overview,opportunity_status";

    // ── [2] 管理者：全组织 + 金额 ──
    {
      const { res } = await send("muse:mgr", { intent: "sales_overview", days: 30 });
      const got = ids(res.data);
      const d = res.data as OverviewData;
      ok(res.ok, "[2] 管理者 sales_overview 成功", res);
      ok(got.includes(a1.id) && got.includes(a2.id) && got.includes(b1.id), "[2] 包含本组织三个开放商机", got);
      ok(!got.includes(x1.id), "[2] 不含其他组织的商机");
      ok(got.length === 3, "[2] 成交商机不进排序；大小写不同的阶段（Follow_Up）照样进入", got);
      ok(got[0] === a1.id, "[2] 客户在等回复的排第一", got);
      ok(d.amountsVisible && d.opportunities[0].crm.amount === 12000, "[2] 决定 B：管理者看得到金额", d.opportunities[0]);
      ok(d.summary.wonInWindow === 1 && d.summary.customerWaiting === 1, "[2] 窗口成交与等回复统计", d.summary);
      ok(!JSON.stringify(res).includes("99000"), "[2] 不泄漏其他组织的金额");
    }

    // ── [3] 销售：只看自己，无金额 ──
    {
      const { res } = await send("muse:rep-a", { intent: "sales_overview" });
      const got = ids(res.data);
      const json = JSON.stringify(res);
      ok(res.ok && got.length === 2 && got.includes(a1.id) && got.includes(a2.id), "[3] 销售 A 只看到自己的两个商机", got);
      ok(!json.includes('"amount"') && !json.includes("12000") && !json.includes("12,000"), "[3] 销售响应里没有金额");
      ok(res.message.split("\n")[0].startsWith("你负责的"), "[3] 结论按本人口径", res.message);
    }
    {
      const { res } = await send("muse:rep-a", { intent: "sales_overview", assigneeUserId: REP_B });
      ok(res.errorCode === "PERMISSION_DENIED" && res.data === undefined, "[3] 销售指定别人 → PERMISSION_DENIED", res);
    }
    {
      const { res } = await send("muse:mgr", { intent: "sales_overview", assigneeUserId: REP_B });
      ok(res.ok && ids(res.data).join() === b1.id && res.message.startsWith("该负责人"), "[3] 管理者按负责人过滤", res);
    }

    // ── [4] 无销售角色 ──
    {
      const a = await send("muse:plain", { intent: "sales_overview" });
      const b = await send("muse:plain", { intent: "opportunity_status", opportunityId: a1.id });
      ok(a.res.errorCode === "PERMISSION_DENIED" && b.res.errorCode === "PERMISSION_DENIED", "[4] 普通成员两个意图都被拒", [a.res, b.res]);
    }

    // ── [5] 商机状态视图 ──
    {
      const { res } = await send("muse:mgr", { intent: "opportunity_status", opportunityId: a1.id });
      const d = res.data as {
        opportunity: { id: string; updatedAt: string; amount?: number };
        interactions: Array<{ summary: string; level: string }>;
        openActionsTotal: number;
        openActions: Array<{ overdue: boolean }>;
        employeeConfirmations: unknown[];
      };
      ok(res.ok && d.opportunity.id === a1.id && d.opportunity.updatedAt === a1.updatedAt.toISOString(), "[5] 引用真实记录 ID 与 updatedAt", d?.opportunity);
      ok(d.interactions.length === 3 && d.interactions.some((i) => i.summary === OUTBOUND_REDACTED), "[5] 含毛利的互动摘要被整段脱敏", d.interactions);
      ok(d.interactions.filter((i) => i.level === "customer").length === 1, "[5] 同一客户未挂商机的互动计入（level=customer），别的客户的不计入", d.interactions);
      ok(d.openActions.length === 1 && d.openActions[0].overdue && d.openActionsTotal === 1, "[5] 未结束行动且标出逾期", d.openActions);
      ok(Array.isArray(d.employeeConfirmations) && d.employeeConfirmations.length === 0, "[5] 员工确认为空数组");
      ok(d.opportunity.amount === 12000, "[5] 管理者状态视图带金额");
    }
    {
      const { res } = await send("muse:rep-a", { intent: "opportunity_status", opportunityId: a1.id });
      ok(res.ok && !JSON.stringify(res).includes('"amount"'), "[5] 销售看自己的商机，无金额", res.data);
    }

    // ── [6] 跨范围 = 不存在 ──
    {
      const ghost = await send("muse:mgr", { intent: "opportunity_status", opportunityId: `missing_${stamp}` });
      const otherOrg = await send("muse:mgr", { intent: "opportunity_status", opportunityId: x1.id });
      const otherRep = await send("muse:rep-a", { intent: "opportunity_status", opportunityId: b1.id });
      const codes = [ghost.res, otherOrg.res, otherRep.res].map((r) => r.errorCode);
      ok(codes.every((c) => c === "OPPORTUNITY_NOT_FOUND"), "[6] 不存在 / 外组织 / 别人负责 → 同一个 NOT_FOUND", codes);
      ok(otherOrg.res.message === ghost.res.message && otherRep.res.message === ghost.res.message, "[6] 三种情况消息一致");
    }

    // ── [7] 重放与账本 ──
    {
      const first = await send("muse:mgr", { intent: "sales_overview" }, ORG_A, `req-s1-replay-${stamp}`);
      await opportunity({ orgId: ORG_A, customerId: cB.id, title: "Late arrival", stage: "quoted", createdById: MGR, assignedToId: REP_B });
      const again = await send("muse:mgr", { intent: "sales_overview" }, ORG_A, `req-s1-replay-${stamp}`);
      ok(JSON.stringify(first.res) === JSON.stringify(again.res), "[7] 同 requestId 重放返回首次响应（新商机不出现）");
      const fresh = await send("muse:mgr", { intent: "sales_overview" });
      ok(ids(fresh.res.data).length === 4, "[7] 新 requestId 才重新查询", ids(fresh.res.data));
      const ledger = await db.auditLog.count({ where: { orgId: ORG_A, targetType: "muse_bridge_request", targetId: `req-s1-replay-${stamp}`, action: "muse:sales_overview" } });
      ok(ledger >= 1, "[7] 账本按 requestId 留痕", ledger);
    }
  } finally {
    await cleanup();
    await db.$disconnect();
  }

  console.log(`\nmuse-bridge sales DB e2e: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
