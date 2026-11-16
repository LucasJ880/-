/**
 * P2-2 新标匹配度：真实接口 + 隔离库（可见范围、跨组织、同采购方、sort=fit、别的视图没有匹配度）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/procurement-records/__tests__/fit-score-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不发任何外部请求、不调模型。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 P2-2 新标匹配度 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "P2-2 fit score DB test" });
process.env.PROCUREMENT_RECORDS_SCHEMA_READY = "1";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;
type Dim = { key: string; points: number; reasonZh: string };
type Fit = { score: number; dimensions: Dim[]; noteZh: string };

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const candidatesRoute = await import("@/app/api/procurement/candidates/route");

  console.log("P2-2 fit score — isolated DB");
  const stamp = Date.now().toString(36);
  const MEMBER = `fsmember_${stamp}`, SUPER = `fssuper_${stamp}`, OUT = `fsout_${stamp}`;
  const ORG = `fsorg_${stamp}`, ORG_B = `fsorgb_${stamp}`;
  const users = [MEMBER, SUPER, OUT];
  const orgs = [ORG, ORG_B];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000;
  const now = Date.now();
  const roles: Record<string, string> = { [MEMBER]: "user", [SUPER]: "super_admin", [OUT]: "user" };
  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: roles[uid] })}`;
  const get = async (uid: string, query: string) => {
    const res = await (candidatesRoute.GET as unknown as (r: unknown, c: unknown) => Promise<Response>)(new NextRequest(`http://localhost/api/procurement/candidates?orgId=${ORG}${query}`, { headers: { cookie: await cookie(uid) } }), { params: Promise.resolve({}) });
    return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Rec };
  };
  let seq = 0;
  const mkInst = async (orgId: string, o: Rec = {}) => {
    seq += 1;
    const num = `FS${stamp}${seq}`;
    return (await db.procurementInstrument.create({
      data: {
        orgId, jurisdiction: "CA-FED", instrumentClass: "SOLICITATION", officialNumber: num, normalizedNumber: num.toLowerCase(),
        procuringEntityKey: "pspc", dedupeKey: `CA-FED|pspc|SOLICITATION|${num.toLowerCase()}`, title: `Fixture ${seq}`,
        publishedAt: new Date(now - seq * DAY), closingAt: new Date(now + 21 * DAY), triageStatus: "CANDIDATE", origin: "SCAN",
        contractingInstitution: "Public Services and Procurement Canada", ...o,
      } as never,
    })).id;
  };
  const pids: string[] = [];
  const mkProject = async (orgId: string, o: Rec) => {
    const p = await db.project.create({ data: { name: "Fixture project", orgId, ownerId: SUPER, workDomain: "tender", intakeStatus: "dispatched", ...o } as never, select: { id: true } });
    pids.push(p.id);
    return p.id;
  };
  const fitOf = (body: Rec, id: string) => ((body.items as Rec[]).find((i) => i.id === id)?.fit ?? null) as Fit | null;
  const dimOf = (f: Fit | null, key: string) => f?.dimensions.find((d) => d.key === key) ?? null;

  try {
    for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id.split("_")[0]}`, role: roles[id] } });
    await db.organization.create({ data: { id: ORG, name: "Fixture Shutters", code: `fs-${stamp}`, ownerId: SUPER } });
    await db.organization.create({ data: { id: ORG_B, name: "Other Org", code: `fsb-${stamp}`, ownerId: OUT } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUT, role: "org_admin", status: "active" } });

    // 本组织：DND 中标 + DND 没中；CSC 中标但还没分发（普通成员看不到）
    await mkProject(ORG, { name: "Roller blinds supply and installation", clientOrganization: "Department of National Defence", tenderStatus: "won", submittedAt: new Date(now - 200 * DAY), ourBidPrice: 123456 });
    await mkProject(ORG, { name: "Curtain tracks", clientOrganization: "DND", tenderStatus: "lost", submittedAt: new Date(now - 100 * DAY) });
    await mkProject(ORG, { name: "Privacy curtains for correctional facility", clientOrganization: "Correctional Service Canada", tenderStatus: "won", intakeStatus: "pending_dispatch" });
    // 别的组织：CSC 中标（任何人都不该计入）
    await mkProject(ORG_B, { name: "Privacy curtains for correctional facility", clientOrganization: "CSC", tenderStatus: "won" });
    // 不是招投标项目：不计入
    await mkProject(ORG, { name: "Privacy curtains for correctional facility", clientOrganization: "CSC", tenderStatus: "won", workDomain: "delivery" });

    const A = await mkInst(ORG, { title: "Supply and installation of roller blinds", buyingInstitution: "National Defence", matchJson: { productHits: ["roller blinds", "blinds"], serviceHits: ["installation"], categoryHits: [] }, publishedAt: new Date(now - 5 * DAY) });
    const B = await mkInst(ORG, { title: "Privacy curtains for correctional facility", buyingInstitution: "Correctional Service Canada", matchJson: { productHits: ["curtains"], serviceHits: [], categoryHits: [] }, publishedAt: new Date(now - 1 * DAY) });
    const C = await mkInst(ORG, { title: "Snow removal", buyingInstitution: null, contractingInstitution: null, matchJson: null, publishedAt: new Date(now - 2 * DAY), closingAt: new Date(now + 2 * DAY) });
    await mkInst(ORG, { instrumentClass: "AWARD_INSTRUMENT", title: "Award row", publishedAt: new Date(now - 3 * DAY) });

    // 默认排序：发布日期新到旧（P2-1 不变），但带匹配度
    const def = await get(MEMBER, "&view=new");
    ok(def.status === 200, "成员可读新标视图", def.status);
    ok(JSON.stringify((def.body.items as Rec[]).map((i) => i.id)) === JSON.stringify([B, C, A]), "默认仍按发布日期", (def.body.items as Rec[]).map((i) => i.title));
    const fa = fitOf(def.body, A);
    ok(!!fa && fa.noteZh.includes("不是中标概率"), "每条带匹配度与说明", fa);
    ok(dimOf(fa, "BUSINESS_MATCH")?.points === 24, "A 业务匹配：两个产品词 + 服务 = 24", dimOf(fa, "BUSINESS_MATCH"));
    ok(dimOf(fa, "BUYER_HISTORY")?.points === 25 && dimOf(fa, "BUYER_HISTORY")?.reasonZh === "与该采购方有 2 个投标项目，交过标 2 次，中标 1 次", "A 同采购方（DND 别名）：2 个、交过标 2 次、中标 1 次", dimOf(fa, "BUYER_HISTORY"));
    ok(dimOf(fa, "PAST_WORK")?.points === 20, "A 与已中标项目标题相近", dimOf(fa, "PAST_WORK"));
    ok(fa?.score === 24 + 25 + 20 + 15, "A 总分", fa?.score);
    ok(!JSON.stringify(def.body).includes("123456"), "价格不出现在接口里");

    // 可见范围：没分发的 CSC 项目普通成员看不到
    const fbMember = fitOf(def.body, B);
    ok(dimOf(fbMember, "BUYER_HISTORY")?.points === 0 && dimOf(fbMember, "PAST_WORK")?.points === 0, "成员：看不到的项目不计入（别的组织、非招投标也不计入）", fbMember);
    const sup = await get(SUPER, "&view=new");
    const fbSuper = fitOf(sup.body, B);
    ok(dimOf(fbSuper, "BUYER_HISTORY")?.points === 25 && dimOf(fbSuper, "BUYER_HISTORY")?.reasonZh.startsWith("与该采购方有 1 个投标项目"), "超级管理员：计入没分发的项目，但仍只算本组织、只算招投标", dimOf(fbSuper, "BUYER_HISTORY"));
    ok(dimOf(fbSuper, "PAST_WORK")?.reasonZh.includes("Privacy curtains for correctional facility"), "业绩写出看得到的项目名", dimOf(fbSuper, "PAST_WORK"));

    const fc = fitOf(def.body, C);
    ok(dimOf(fc, "BUYER_HISTORY")?.reasonZh === "公告没有写采购方" && dimOf(fc, "PREP_TIME")?.points === 0, "C：采购方未知、两天截标", fc);

    // sort=fit
    const byFit = await get(MEMBER, "&view=new&sort=fit");
    const order = (byFit.body.items as Rec[]).map((i) => i.id);
    ok(JSON.stringify(order) === JSON.stringify([A, B, C]), "按匹配度从高到低", (byFit.body.items as Rec[]).map((i) => [i.title, (i.fit as Fit).score]));

    // 审查 H1：跟了这个标（建项目 + 「本项目」关联）之后，A 的匹配度不变
    const scoreBefore = fitOf((await get(MEMBER, "&view=new")).body, A);
    const linked = await mkProject(ORG, { name: "Supply and installation of roller blinds", clientOrganization: "National Defence", tenderStatus: "bid_submitted", submittedAt: new Date(now - DAY) });
    await db.procurementTenderLink.create({ data: { orgId: ORG, projectId: linked, instrumentId: A, relation: "CURRENT", createdById: SUPER } });
    const followedOnly = await mkProject(ORG, { name: "Supply and installation of roller blinds", clientOrganization: "National Defence", tenderStatus: "won", sourceMetadataJson: JSON.stringify({ procurementInstrumentId: A }) });
    const scoreAfter = fitOf((await get(MEMBER, "&view=new")).body, A);
    ok(JSON.stringify(scoreAfter) === JSON.stringify(scoreBefore), "跟标建的项目（关联或来源元数据）不给这条公告加分", { before: scoreBefore?.score, after: scoreAfter?.score });
    const fbAfter = fitOf((await get(SUPER, "&view=new")).body, B);
    ok(dimOf(fbAfter, "PAST_WORK")?.points === 20, "但仍算进别的公告（B 的业绩照常）", dimOf(fbAfter, "PAST_WORK"));
    void followedOnly;

    // 别的视图没有匹配度、排序参数无效
    const all = await get(MEMBER, "&sort=fit");
    ok((all.body.items as Rec[]).length === 4 && (all.body.items as Rec[]).every((i) => i.fit === null), "全部视图没有匹配度", (all.body.items as Rec[]).map((i) => i.fit));

    // 别的组织的人读不了
    const out = await get(OUT, "&view=new");
    ok(out.status === 403 || out.status === 404, "别的组织的人读不了", out.status);
  } finally {
    await db.procurementTenderLink.deleteMany({ where: { orgId: { in: orgs } } });
    await db.procurementInstrument.deleteMany({ where: { orgId: { in: orgs } } });
    await db.project.deleteMany({ where: { id: { in: pids } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgs } } });
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
