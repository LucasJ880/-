/**
 * P2-0b 竞争对手 / 采购机构画像 — 真实 DB（隔离库）+ 真实路由端到端（虚构企业）
 *
 *   结果表单回灌（未中标填中标方 + 我方中标）→ GET /api/org/tender-intel-profiles
 *   → 竞争对手只有对手、我方被排除计数；采购机构合并大小写、我方标出、我方项目按结果分类
 *   → 待派发项目与非 tender 项目不计；非成员 403；授标情报关闭时只按项目建机构；GET 不写数据
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-intel/__tests__/org-profiles-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构企业名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 P2-0b 竞争对手 / 采购机构 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "P2-0b org intel profiles DB e2e" });
process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";
process.env.JWT_SECRET = process.env.JWT_SECRET || "p2-0b-isolated-test-secret-0123456789abcdef";

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

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ORG = `fx_p20b_org_${stamp}`;
const MEMBER = `fx_p20b_member_${stamp}`;
const OUTSIDER = `fx_p20b_out_${stamp}`;
const ORG_NAME = `Fixture Shutters ${stamp} Inc.`;
const P_LOST = `fx_p20b_lost_${stamp}`;
const P_WON = `fx_p20b_won_${stamp}`;
const P_OPEN = `fx_p20b_open_${stamp}`;
const P_PENDING = `fx_p20b_pending_${stamp}`;
const P_GENERAL = `fx_p20b_general_${stamp}`;
const PROJECTS = [P_LOST, P_WON, P_OPEN, P_PENDING, P_GENERAL];

type Body = {
  awardsAvailable: boolean;
  ownAwardCount: number;
  competitors: Array<{ name: string; status: string; confirmedAwards: number; buyers: Array<{ name: string; count: number }> }>;
  agencies: Array<{
    name: string;
    awards: { total: number; winners: Array<{ name: string; isOwn: boolean }> };
    ourBids: { total: number; won: number; lost: number; open: number; recent: Array<{ id: string }> };
  }>;
};

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { markProjectTenderResult } = await import("@/lib/projects/tender-result");
  const route = await import("@/app/api/org/tender-intel-profiles/route");

  for (const id of [MEMBER, OUTSIDER]) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: "虚构投标员", role: "user" } });
  }
  await db.organization.create({ data: { id: ORG, name: ORG_NAME, code: `p20b-${stamp}`, ownerId: MEMBER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
  const mk = (id: string, over: Record<string, unknown>) =>
    db.project.create({
      data: { id, name: `Fixture Window Coverings ${id.slice(-6)}`, orgId: ORG, ownerId: MEMBER, workDomain: "tender", intakeStatus: "dispatched", clientOrganization: "Fixture Buyer Agency", currency: "CAD", ...over },
    });
  await mk(P_LOST, { solicitationNumber: `FX-L-${stamp}` });
  await mk(P_WON, { clientOrganization: "FIXTURE BUYER AGENCY", solicitationNumber: `FX-W-${stamp}` });
  await mk(P_OPEN, { clientOrganization: "Fixture Buyer Agency." });
  await mk(P_PENDING, { intakeStatus: "pending_dispatch" });
  await mk(P_GENERAL, { workDomain: "general" });

  const cookie = async (id: string) => `qy_session=${await createSession({ sub: id, email: `${id}@fixture.test`, role: "user" })}`;
  const get = async (uid: string) => {
    const r = new NextRequest(`http://localhost/api/org/tender-intel-profiles?orgId=${ORG}`, {
      method: "GET",
      headers: { cookie: await cookie(uid), "x-forwarded-for": "10.31.0.5", "x-org-id": ORG },
    });
    const res = await (route.GET as unknown as (r: unknown, c: unknown) => Promise<Response>)(r, { params: Promise.resolve({}) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Body };
  };

  try {
    console.log("\n[1] 结果表单回灌授标事实");
    const lost = await markProjectTenderResult({ projectId: P_LOST, result: "lost", winningBidPrice: 118000, winnerName: "ABC Blinds Ltd", actorUserId: MEMBER });
    const won = await markProjectTenderResult({ projectId: P_WON, result: "won", winningBidPrice: 95000, actorUserId: MEMBER });
    ok(lost.canonicalBackfill?.award === "written" && won.canonicalBackfill?.award === "written", "对手中标 + 我方中标都写入", { lost: lost.canonicalBackfill, won: won.canonicalBackfill });

    console.log("\n[2] 成员 GET：竞争对手");
    const before = await db.awardRecord.count({ where: { orgId: ORG } });
    const r = await get(MEMBER);
    ok(r.status === 200 && r.body.awardsAvailable === true, "200，授标情报可用", r);
    ok(r.body.competitors.map((c) => c.name).join() === "ABC Blinds Ltd" && r.body.ownAwardCount === 1, "只有对手 ABC；我方 1 条被排除", r.body);
    ok(r.body.competitors[0]?.status === "CONFIRMED" && r.body.competitors[0].buyers[0]?.name === "Fixture Buyer Agency", "人工填写 → 已确认；中过标的机构 = 项目采购方", r.body.competitors[0]);

    console.log("\n[3] 成员 GET：采购机构");
    ok(r.body.agencies.length === 1, "大小写 / 标点不同的采购方合并成一个机构", r.body.agencies.map((a) => a.name));
    const ag = r.body.agencies[0];
    ok(ag?.ourBids.total === 3 && ag.ourBids.won === 1 && ag.ourBids.lost === 1 && ag.ourBids.open === 1, "我方项目 3 个（中 1 · 未中 1 · 进行中 1）；待派发与非 tender 项目不计", ag?.ourBids);
    ok(!ag?.ourBids.recent.some((p) => p.id === P_PENDING || p.id === P_GENERAL), "最近项目里没有待派发 / 非 tender 项目", ag?.ourBids.recent);
    ok(
      ag?.awards.total === 2 && ag.awards.winners.some((w) => w.isOwn) && ag.awards.winners.some((w) => w.name === "ABC Blinds Ltd" && !w.isOwn),
      "授标 2 条：我方标出、对手 ABC",
      ag?.awards,
    );
    ok((await db.awardRecord.count({ where: { orgId: ORG } })) === before, "GET 不写授标记录");

    console.log("\n[4] 非成员 → 403");
    const out = await get(OUTSIDER);
    ok(out.status === 403, "非本组织成员拿不到画像", out.status);

    console.log("\n[5] 授标情报关闭：只按我方项目建机构");
    process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "0";
    const off = await get(MEMBER);
    process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";
    ok(off.status === 200 && off.body.awardsAvailable === false && off.body.competitors.length === 0, "awardsAvailable=false，竞争对手为空", off.body);
    ok(off.body.agencies.length === 1 && off.body.agencies[0].awards.total === 0 && off.body.agencies[0].ourBids.total === 3, "机构仍按项目显示，授标为 0", off.body.agencies);
  } finally {
    await db.awardRecordSource.deleteMany({ where: { orgId: ORG } });
    await db.awardRecord.deleteMany({ where: { orgId: ORG } });
    await db.projectReview.deleteMany({ where: { projectId: { in: PROJECTS } } });
    await db.project.deleteMany({ where: { id: { in: PROJECTS } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: [MEMBER, OUTSIDER] } } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
