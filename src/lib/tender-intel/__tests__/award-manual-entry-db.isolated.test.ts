/**
 * CHAIN-1b Alberta 授标人工录入——真实 DB（隔离库），调用真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；外部请求一律被替换成计数后报错的假函数（不出站，也不访问 APC）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-1b Alberta 授标人工录入 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-1b award manual entry DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

async function main() {
  let outbound = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
    if (!/^https?:\/\/localhost/.test(url)) { outbound += 1; throw new Error(`blocked outbound in test: ${url}`); }
    return realFetch(input as RequestInfo);
  }) as typeof fetch;
  const savedFlag = process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY;
  process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { createOrObserveAwardRecord } = await import("@/lib/tender-intel/awards");
  const manualRoute = await import("@/app/api/organizations/[orgId]/tender-awards/manual/route");
  const reviewRoute = await import("@/app/api/organizations/[orgId]/tender-awards/[awardId]/review/route");
  const listRoute = await import("@/app/api/org/tender-awards/route");

  console.log("CHAIN-1b award manual entry — isolated DB");
  const stamp = Date.now().toString(36);
  const id = (k: string) => `am${k}_${stamp}`;
  const MEMBER = id("member"), VIEWER = id("viewer"), ADMIN = id("admin"), OTHER = id("other"), SUPER = id("super");
  const USERS = [MEMBER, VIEWER, ADMIN, OTHER, SUPER];
  const ORG = id("org"), ORG2 = id("org2");
  const email = (u: string) => `${u}@fixture.test`;
  for (const u of USERS) await db.user.create({ data: { id: u, email: email(u), name: `Fixture ${u}`, role: u === SUPER ? "super_admin" : "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder AB", code: `am-${stamp}`, ownerId: ADMIN } });
  await db.organization.create({ data: { id: ORG2, name: "Other Org", code: `am2-${stamp}`, ownerId: OTHER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: VIEWER, role: "org_viewer", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OTHER, role: "org_admin", status: "active" } });
  const PROJECT = id("proj"), PENDING = id("pend"), GENERAL = id("gen");
  await db.project.create({ data: { id: PROJECT, name: `Fixture AB Tender ${stamp}`, orgId: ORG, ownerId: ADMIN, workDomain: "tender", intakeStatus: "dispatched", clientOrganization: "Alberta Health Services" } });
  // 采购方候选不该带出的两种项目：待分派的（只有超级管理员看得到）、不是招标的
  await db.project.create({ data: { id: PENDING, name: `Fixture Pending ${stamp}`, orgId: ORG, ownerId: ADMIN, workDomain: "tender", intakeStatus: "pending_dispatch", clientOrganization: `Pending Dispatch Buyer ${stamp}` } });
  await db.project.create({ data: { id: GENERAL, name: `Fixture General ${stamp}`, orgId: ORG, ownerId: ADMIN, workDomain: "general", intakeStatus: "dispatched", clientOrganization: `Sales Client Corp ${stamp}` } });

  const cookieOf = async (u: string) => `qy_session=${await createSession({ sub: u, email: email(u), role: u === SUPER ? "super_admin" : "user" })}`;
  const enterRaw = async (raw: string, u: string = MEMBER, orgId: string = ORG) => {
    const res = await manualRoute.POST(new NextRequest(`http://localhost/api/organizations/${orgId}/tender-awards/manual`, { method: "POST", headers: { cookie: await cookieOf(u), "content-type": "application/json" }, body: raw }), { params: Promise.resolve({ orgId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const enter = async (body: Rec, u: string = MEMBER, orgId: string = ORG) => {
    const res = await manualRoute.POST(new NextRequest(`http://localhost/api/organizations/${orgId}/tender-awards/manual`, { method: "POST", headers: { cookie: await cookieOf(u), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ orgId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const reviewAs = async (awardId: string, body: Rec) => {
    const res = await reviewRoute.POST(new NextRequest(`http://localhost/api/organizations/${ORG}/tender-awards/${awardId}/review`, { method: "POST", headers: { cookie: await cookieOf(ADMIN), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ orgId: ORG, awardId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const list = async (u: string) => {
    const res = await listRoute.GET(new NextRequest(`http://localhost/api/org/tender-awards?orgId=${ORG}`, { headers: { cookie: await cookieOf(u) } }), { params: Promise.resolve({}) } as never);
    return rec(await res.json());
  };
  const recordCount = () => db.awardRecord.count({ where: { orgId: ORG } });
  const auditRows = () => db.auditLog.findMany({ where: { orgId: ORG, action: "tender.award_manual_entry" }, orderBy: { createdAt: "asc" } });
  const URL1 = "https://purchasing.alberta.ca/posting/AB-2026-01234";
  const base = { buyerName: "Alberta Health Services", winnerName: "Glacier Linen Supply Inc.", apcUrl: `${URL1}/#notice` };

  try {
    /* ---------- 1. 新录入 ---------- */
    const c1 = await enter({ ...base, awardDate: "2026-03-01", contractAmount: "48,000", scopeSummary: "Linen service" });
    const r1 = rec(c1.body.record);
    const rec1 = await db.awardRecord.findUnique({ where: { id: String(r1.id) }, include: { sources: true } });
    ok(c1.status === 200 && c1.body.outcome === "CREATED" && c1.body.messageZh === "已录入，等组织管理员复核。" && rec1?.verificationStatus === "NEEDS_REVIEW" && rec1.status === "ACTIVE" && rec1.confidence === "MEDIUM" && rec1.projectId === null && rec1.sources.length === 1 && rec1.sources[0].sourceType === "USER_ENTRY" && rec1.sources[0].sourceUrl === URL1 && rec1.sources[0].sourceKey.startsWith("manual:apc:") && rec1.sources[0].evidenceSnippet === null, "成员录入：USER_ENTRY、规整后的 APC 链接、NEEDS_REVIEW、ACTIVE、可信度中、不挂项目", { body: c1.body, rec1 });
    ok(r1.verificationStatus === "NEEDS_REVIEW" && r1.status === "ACTIVE" && r1.buyerName === "Alberta Health Services" && r1.solicitationNumber === null && r1.awardDate === "2026-03-01" && Object.keys(r1).sort().join() === "awardDate,buyerName,id,solicitationNumber,status,verificationStatus", "成功响应的 record：编号、信任级、状态、采购方、招标编号、授标日期", r1);
    const a1 = await auditRows();
    const ad = JSON.parse(a1[0]?.afterData ?? "{}") as Rec;
    ok(a1.length === 1 && a1[0].userId === MEMBER && a1[0].targetId === r1.id && ad.outcome === "CREATED" && ad.buyerName === base.buyerName && ad.winnerName === base.winnerName && ad.awardDate === "2026-03-01" && ad.contractAmount === 48000 && ad.currency === "CAD" && ad.scopeSummary === "Linen service" && ad.apcUrl === URL1 && ad.verificationStatus === "NEEDS_REVIEW", "审计：提交的全部字段、链接、信任级", ad);

    /* ---------- 2. 重录 ---------- */
    const c2 = await enter({ ...base, apcUrl: URL1 });
    ok(c2.status === 200 && c2.body.outcome === "ALREADY_ENTERED" && c2.body.messageZh === "这条公告的这个中标方已经录过了（同一公告同一中标方只录一条；中了几个标段的请合成一条，金额合计或留空）。" && rec(c2.body.record).id === r1.id && (await auditRows()).length === 1, "同一链接同一中标方再录：已经录过、不新建、不写审计", c2.body);

    /* ---------- 3. 权限 ---------- */
    const before = await recordCount();
    const v = await enter({ ...base, winnerName: "Viewer Try Ltd." }, VIEWER);
    const o = await enter({ ...base, winnerName: "Other Try Ltd." }, OTHER);
    const s = await enter({ ...base, winnerName: "Super Entry Ltd." }, SUPER);
    const sNo = await enter({ ...base, winnerName: "Nowhere Ltd." }, SUPER, `nope_${stamp}`);
    ok(v.status === 403 && o.status === 403 && s.status === 200 && s.body.outcome === "CREATED" && sNo.status === 404 && sNo.body.error === "组织不存在" && (await recordCount()) === before + 1, "查看者、别的组织的管理员 403；平台超级管理员可以录入；不存在的组织 404", [v.status, o.status, s.status, sNo.status]);

    /* ---------- 4. 校验 ---------- */
    const bad = await enter({ ...base, winnerName: "Bad Url Ltd.", apcUrl: "https://purchasing.alberta.ca:8443/x" });
    const badDate = await enter({ ...base, winnerName: "Bad Date Ltd.", apcUrl: URL1, awardDate: "2023-02-29" });
    const badAmt = await enter({ ...base, winnerName: "Bad Amount Ltd.", apcUrl: URL1, contractAmount: "1234,56" });
    const big = await enterRaw(JSON.stringify({ ...base, winnerName: "Too Large Ltd.", scopeSummary: "x".repeat(17 * 1024) }));
    const notJson = await enterRaw("not json");
    const declaredBig = await manualRoute.POST(new NextRequest(`http://localhost/api/organizations/${ORG}/tender-awards/manual`, { method: "POST", headers: { cookie: await cookieOf(MEMBER), "content-type": "application/json", "content-length": String(64 * 1024) }, body: JSON.stringify({ ...base, winnerName: "Declared Large Ltd." }) }), { params: Promise.resolve({ orgId: ORG }) }).catch((e: unknown) => e);
    const declaredBody = declaredBig instanceof Response ? ((await declaredBig.json()) as Rec) : null;
    ok(declaredBig instanceof Response && declaredBig.status === 400 && declaredBody?.code === "TOO_LARGE", "声明的长度超过 16 KB：不读请求体，400 TOO_LARGE", declaredBig instanceof Response ? declaredBody : String(declaredBig));
    ok(bad.status === 400 && bad.body.error === "APC 公告链接要以 https://purchasing.alberta.ca/ 开头，并指向具体的公告。" && bad.body.code === "BAD_URL" && bad.body.field === "apcUrl" && badDate.status === 400 && badDate.body.error === "授标日期要写成 年-月-日，且在 1900 年到今天之间。" && badDate.body.field === "awardDate" && badAmt.status === 400 && badAmt.body.code === "BAD_AMOUNT" && big.status === 400 && big.body.code === "TOO_LARGE" && big.body.error === "请求太大" && notJson.status === 400 && notJson.body.error === "请填写采购方。" && (await recordCount()) === before + 1, "坏链接、坏日期、当小数点用的逗号、超过 16 KB、不是 JSON：400 那句话与字段、不写库", [bad.body, badDate.body, badAmt.body, big.body, notJson.body]);

    /* ---------- 5. 挂到既有：按编号（CanadaBuys 权威记录）、按日期金额；疑似重复 ---------- */
    const cb = await createOrObserveAwardRecord({ orgId: ORG, actor: { actorType: "system", userId: null }, award: { winnerName: "Prairie Hospitality Goods", buyerNameRaw: "Government of Alberta", solicitationNumber: "AB-2025-777", awardDate: new Date("2025-06-01T00:00:00Z"), contractAmount: 9000, currency: "CAD" }, source: { sourceType: "CANADABUYS_OPEN_DATA", sourceKey: `canadabuys:AB-2025-777-${stamp}`, capturedAt: new Date() }, confidence: "HIGH", verificationStatus: "SYSTEM_VERIFIED" } as never);
    const c5 = await enter({ buyerName: "Government of Alberta", winnerName: "Prairie Hospitality Goods", apcUrl: "https://purchasing.alberta.ca/posting/AB-2025-777", solicitationNumber: "AB-2025-777" });
    const cbAfter = await db.awardRecord.findUnique({ where: { id: cb.record.id }, include: { sources: true } });
    const a5 = JSON.parse((await auditRows()).find((r) => r.targetId === cb.record.id)?.afterData ?? "{}") as Rec;
    ok(c5.status === 200 && c5.body.outcome === "ATTACHED_BY_SOLICITATION" && c5.body.messageZh === "已有同一条授标（招标编号与中标方相同），这条公告链接已挂到那条记录上。那条记录原有的内容和可信度不变（你这次填的没有写进去）；有出入请告诉组织管理员。" && cbAfter?.verificationStatus === "SYSTEM_VERIFIED" && cbAfter.sources.length === 2 && a5.targetVerificationStatus === "SYSTEM_VERIFIED", "同编号同中标方：挂到 CanadaBuys 记录上，它仍是 SYSTEM_VERIFIED；审计记那条的信任级", { body: c5.body, a5 });
    // 目标用 AI_EXTRACTED：写入服务唯一可能提升的级别，验证人工录入挂上去也不提升
    const ai = await createOrObserveAwardRecord({ orgId: ORG, actor: { actorType: "system", userId: null }, award: { winnerName: "Harbour Bedding Wholesale", buyerNameRaw: "City of Calgary", awardDate: new Date("2025-09-01T00:00:00Z"), contractAmount: 12000, currency: "CAD" }, source: { sourceType: "WEB_SEARCH", sourceKey: `web:${stamp}-dateamt`, capturedAt: new Date() }, confidence: "LOW", verificationStatus: "AI_EXTRACTED" } as never);
    const c6 = await enter({ buyerName: "City of Calgary", winnerName: "Harbour Bedding Wholesale", apcUrl: "https://purchasing.alberta.ca/posting/AB-2025-888", awardDate: "2025-09-01", contractAmount: 12000 });
    const aiAfter = await db.awardRecord.findUnique({ where: { id: ai.record.id }, include: { sources: true } });
    const a6 = JSON.parse((await auditRows()).find((r) => r.targetId === ai.record.id)?.afterData ?? "{}") as Rec;
    ok(c6.status === 200 && c6.body.outcome === "ATTACHED_BY_DATE_AMOUNT" && c6.body.messageZh === "已有同一条授标（中标方、授标日期、金额都相同），这条公告链接已挂到那条记录上。那条记录原有的内容（含招标编号与采购方）和可信度不变（你这次填的没有写进去）；有出入请告诉组织管理员。" && aiAfter?.verificationStatus === "AI_EXTRACTED" && aiAfter.sources.length === 2 && a6.outcome === "ATTACHED_BY_DATE_AMOUNT" && a6.targetVerificationStatus === "AI_EXTRACTED" && a6.winnerName === "Harbour Bedding Wholesale", "没有编号、同中标方同日期同金额：挂到 AI 提取的那条，它仍是 AI_EXTRACTED、来源 2 个；审计记结果与那条的信任级", { body: c6.body, v: aiAfter?.verificationStatus, n: aiAfter?.sources.length, a6 });
    // 既有写入规则：按编号没对上时，中标方、日期、金额都相同就挂上（不看编号、不看采购方）——规格照实写
    const c6b = await enter({ buyerName: "City X", winnerName: "Prairie Hospitality Goods", apcUrl: "https://purchasing.alberta.ca/posting/AB-2025-778", solicitationNumber: "AB-2025-778", awardDate: "2025-06-01", contractAmount: 9000 });
    const cbAfter2 = await db.awardRecord.findUnique({ where: { id: cb.record.id }, include: { sources: true } });
    ok(c6b.status === 200 && c6b.body.outcome === "ATTACHED_BY_DATE_AMOUNT" && rec(c6b.body.record).id === cb.record.id && cbAfter2?.solicitationNumber === "AB-2025-777" && cbAfter2.buyerNameRaw === "Government of Alberta" && cbAfter2.sources.length === 3 && cbAfter2.verificationStatus === "SYSTEM_VERIFIED" && (await auditRows()).filter((r) => r.targetId === cb.record.id).map((r) => (JSON.parse(r.afterData ?? "{}") as Rec)).some((a) => a.outcome === "ATTACHED_BY_DATE_AMOUNT" && a.targetVerificationStatus === "SYSTEM_VERIFIED" && a.solicitationNumber === "AB-2025-778"), "编号不同、采购方不同，但中标方、日期、金额相同：也挂到既有，那条的编号、采购方与信任级不变；审计记那条的信任级与提交的编号", { body: c6b.body, sol: cbAfter2?.solicitationNumber, n: cbAfter2?.sources.length });
    const c7 = await enter({ buyerName: "City of Calgary", winnerName: "Harbour Bedding Wholesale", apcUrl: "https://purchasing.alberta.ca/posting/AB-2026-999", awardDate: "2026-02-01", contractAmount: 15000 });
    const r7 = await db.awardRecord.findUnique({ where: { id: String(rec(c7.body.record).id) } });
    ok(c7.status === 200 && c7.body.outcome === "NEEDS_REVIEW" && c7.body.messageZh === "已录入；和已有的一条记录可能重复，等组织管理员裁决。" && r7?.status === "NEEDS_REVIEW" && !!r7.possibleDuplicateOfId, "同采购方同中标方、日期不同：疑似重复", c7.body);

    /* ---------- 6. 复核：组织管理员确认成员的录入后人工确认（不是 SYSTEM_VERIFIED） ---------- */
    const mc = await enter({ buyerName: "Alberta Health Services", winnerName: "Member Confirm Ltd.", apcUrl: "https://purchasing.alberta.ca/posting/AB-2026-4242" });
    const conf = await reviewAs(String(rec(mc.body.record).id), { action: "confirm" });
    const confRec = await db.awardRecord.findUnique({ where: { id: String(rec(mc.body.record).id) } });
    ok(mc.body.outcome === "CREATED" && conf.status === 200 && confRec?.verificationStatus === "HUMAN_CONFIRMED", "组织管理员确认成员的人工录入：HUMAN_CONFIRMED", { conf: conf.body, v: confRec?.verificationStatus });
    const auditOutcomes = (await auditRows()).map((r) => String((JSON.parse(r.afterData ?? "{}") as Rec).outcome));
    ok(auditOutcomes.join(",") === "CREATED,CREATED,ATTACHED_BY_SOLICITATION,ATTACHED_BY_DATE_AMOUNT,ATTACHED_BY_DATE_AMOUNT,NEEDS_REVIEW,CREATED", "审计：每次新建、挂到既有、疑似重复各一条，重录与被拒的没有", auditOutcomes);

    /* ---------- 7. 撤回后重录：新建一条、撤回的那条保持撤回、重放仍不重复 ---------- */
    const ret = await reviewAs(String(r1.id), { action: "retract", reason: "金额填错" });
    const re1 = await enter({ ...base, contractAmount: "50,000" });
    const re2 = await enter({ ...base, contractAmount: "50,000" });
    const old = await db.awardRecord.findUnique({ where: { id: String(r1.id) } });
    const fresh = rec(re1.body.record);
    ok(ret.status === 200 && old?.status === "RETRACTED" && re1.status === 200 && re1.body.outcome === "CREATED" && fresh.id !== r1.id && re2.body.outcome === "ALREADY_ENTERED" && rec(re2.body.record).id === fresh.id, "撤回后重录：新建一条，撤回的那条仍撤回，再录不新建", { ret: ret.body, re1: re1.body, re2: re2.body });

    /* ---------- 8. 两次同时提交：一条记录、两次都成功 ---------- */
    const dup = { buyerName: "Alberta Health Services", winnerName: "Concurrent Linen Ltd.", apcUrl: "https://purchasing.alberta.ca/posting/AB-2026-55555" };
    const [p1, p2] = await Promise.all([enter(dup), enter(dup)]);
    const concurrentCount = await db.awardRecord.count({ where: { orgId: ORG, winnerName: "Concurrent Linen Ltd." } });
    ok(p1.status === 200 && p2.status === 200 && concurrentCount === 1 && [p1.body.outcome, p2.body.outcome].includes("CREATED"), "两次同时提交：一条记录，两次都 200", [p1.body.outcome, p2.body.outcome, concurrentCount]);

    /* ---------- 9. 列表 ---------- */
    await createOrObserveAwardRecord({ orgId: ORG, actor: { actorType: "user", userId: ADMIN }, award: { winnerName: "Backfilled Winner Ltd.", buyerNameRaw: "Alberta Health Services" }, source: { sourceType: "USER_ENTRY", sourceKey: `own-result:${PROJECT}`, sourceUrl: "https://purchasing.alberta.ca/posting/should-not-show", capturedAt: new Date() }, confidence: "HIGH", verificationStatus: "HUMAN_CONFIRMED" });
    await createOrObserveAwardRecord({ orgId: ORG, actor: { actorType: "user", userId: ADMIN }, award: { winnerName: "Spelling Variant Ltd.", buyerNameRaw: "ALBERTA HEALTH SERVICES." }, source: { sourceType: "USER_ENTRY", sourceKey: `manual:${stamp}-variant`, capturedAt: new Date() }, confidence: "HIGH", verificationStatus: "HUMAN_CONFIRMED" });
    const lm = await list(MEMBER);
    const ls = await list(SUPER);
    const lv = await list(VIEWER);
    const rows = (lm.records as Rec[]) ?? [];
    const freshRow = rows.find((r) => r.id === fresh.id);
    const backfilled = rows.find((r) => r.winnerName === "Backfilled Winner Ltd.");
    ok(lm.canEnterManual === true && lv.canEnterManual === false && freshRow?.manualApcUrl === URL1 && backfilled?.manualApcUrl === null && Array.isArray(lm.buyerSuggestions) && (lm.buyerSuggestions as string[]).includes("Alberta Health Services") && Array.isArray(lv.buyerSuggestions) && (lv.buyerSuggestions as string[]).length === 0, "列表：成员能录入、查看者不能；人工录入的带 APC 链接、项目回灌来源的不带；采购方候选只给能录入的人", { canM: lm.canEnterManual, canV: lv.canEnterManual, fresh: freshRow?.manualApcUrl, back: backfilled?.manualApcUrl, sug: lm.buyerSuggestions });
    ok(!JSON.stringify(lm).includes("should-not-show") && !JSON.stringify(lm).includes("evidenceSnippet"), "列表不带别的来源的链接与原文片段");
    const sug = (lm.buyerSuggestions as string[]) ?? [];
    ok(!sug.includes(`Pending Dispatch Buyer ${stamp}`) && !sug.includes(`Sales Client Corp ${stamp}`) && sug.filter((b) => b.toLowerCase().replace(/[^a-z]/g, "") === "albertahealthservices").length === 1 && sug.includes("Alberta Health Services") && sug.includes("Government of Alberta") && sug.includes("City of Calgary"), "采购方候选：不带待分派的与不是招标的项目；写法不同的同一采购方只留一个（项目写法优先）；含已有授标的采购方", sug);
    const sugS = (ls.buyerSuggestions as string[]) ?? [];
    ok(ls.canEnterManual === true && !sugS.includes(`Pending Dispatch Buyer ${stamp}`) && !sugS.includes(`Sales Client Corp ${stamp}`) && sugS.includes("Alberta Health Services"), "平台超级管理员的采购方候选也不带待分派与不是招标的项目", sugS);

    /* ---------- 10. 开关关 ---------- */
    process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "0";
    const cOff = await enter({ ...base, winnerName: "Flag Off Ltd." });
    process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";
    ok(cOff.status === 409 && cOff.body.error === "组织授标情报尚未启用" && (await db.awardRecord.count({ where: { orgId: ORG, winnerName: "Flag Off Ltd." } })) === 0, "开关关：409 那句话、没有新记录", cOff.body);

    ok(outbound === 0, "整个过程外部请求 0 次（不访问 APC）", outbound);
  } finally {
    globalThis.fetch = realFetch;
    if (savedFlag === undefined) delete process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY;
    else process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = savedFlag;
    await db.awardRecordSource.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.awardRecord.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG2] } }, { userId: { in: USERS } }] } });
    await db.project.deleteMany({ where: { id: { in: [PROJECT, PENDING, GENERAL] } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.user.deleteMany({ where: { id: { in: USERS } } });
    await db.$disconnect();
  }

  console.log(`\nCHAIN-1b award manual entry DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
