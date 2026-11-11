/**
 * TI-4a 投标工作区——真实 DB（隔离库）+ 真实路由 端到端
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-bid-workspace/__tests__/bid-workspace-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 公司名）。
 * 覆盖任务书验收项 A17（租户隔离）、A20（开关关闭零影响）、A22（操作者来自登录身份）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 TI-4a 投标工作区 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "TI-4a bid workspace DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "ti-4a-isolated-test-secret-0123456789abcdef";
delete process.env.TENDER_BID_WORKSPACE_ENABLED;
delete process.env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST;

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : ""); }
}
type Handler = (r: unknown, c: unknown) => Promise<Response>;
type Json = Record<string, unknown>;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const route = await import("@/app/api/projects/[id]/bid-workspace/route");
  const costRoute = await import("@/app/api/projects/[id]/bid-workspace/cost-sheet/route");
  const { OTTAWA_18026_LINES } = await import("@/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026");
  const { OTTAWA_SYNTHETIC_SCENARIO } = await import("@/lib/tender-bid-cost/__tests__/fixtures/ottawa-synthetic-scenario");
  const { BID_WORKSPACE_AUDIT_ACTION } = await import("@/lib/tender-bid-workspace/store");

  const stamp = Date.now().toString(36);
  const OWNER = `bwowner_${stamp}`, MEMBER = `bwmember_${stamp}`, VIEWER = `bwviewer_${stamp}`, OUTSIDER = `bwoutsider_${stamp}`;
  const ORG = `bworg_${stamp}`, ORG_B = `bworgb_${stamp}`, PROJECT = `bwproj_${stamp}`, EMPTY_PROJECT = `bwempty_${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  for (const id of [OWNER, MEMBER, VIEWER, OUTSIDER]) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id.split("_")[0]}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Sunny Shutter Inc.", code: `bw-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `bwb-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: VIEWER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });
  const closeDate = new Date("2026-11-10T20:00:00Z");
  for (const id of [PROJECT, EMPTY_PROJECT]) {
    await db.project.create({ data: { id, name: `Fixture Tender ${id}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", closeDate } });
    await db.projectMember.create({ data: { projectId: id, userId: MEMBER, role: "project_admin", status: "active" } });
    await db.projectMember.create({ data: { projectId: id, userId: VIEWER, role: "viewer", status: "active" } });
  }

  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const call = async (h: unknown, uid: string, method: string, projectId: string, body?: unknown, sub = "") => {
    const r = new NextRequest(`http://localhost/api/projects/${projectId}/bid-workspace${sub}`, {
      method, headers: { cookie: await cookie(uid), "content-type": "application/json", "x-forwarded-for": "10.51.0.9" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await (h as Handler)(r, { params: Promise.resolve({ id: projectId }) });
    const text = await res.text();
    let parsed: Json | null = null;
    try { parsed = text ? (JSON.parse(text) as Json) : null; } catch { parsed = null; }
    return { status: res.status, body: parsed, text };
  };
  const get = (uid: string, pid = PROJECT) => call(route.GET, uid, "GET", pid);
  const put = (uid: string, body: unknown, pid = PROJECT) => call(route.PUT, uid, "PUT", pid, body);
  const cost = (uid: string, body: unknown, pid = PROJECT) => call(costRoute.POST, uid, "POST", pid, body, "/cost-sheet");
  const roomOf = (pid: string) => db.bidIntelligenceRoom.findUnique({ where: { projectId: pid }, select: { id: true, orgId: true, summaryJson: true } });
  const audits = (pid: string) => db.auditLog.findMany({ where: { projectId: pid, action: BID_WORKSPACE_AUDIT_ACTION }, orderBy: { createdAt: "asc" } });
  const schedule = { priceSchedule: { lines: OTTAWA_18026_LINES } };
  const HOLDERS = ["Northfield Pest Supply Inc.", "Lakeshore Linen Co.", "Maple Facility Products Ltd.", "Harbour Bedding Wholesale", "Rideau Janitorial Supply", "Capital Textile Imports Inc.", "SUNNY SHUTTER INC", "Prairie Hospitality Goods", "Summit Thermal Equipment"];
  const holders = { documentHolders: { solicitationId: "18026-93121-T01", portal: "MERX", sourceKind: "USER_UPLOAD_SCREENSHOT", capturedAt: "2026-11-06T10:00:00-05:00", entries: HOLDERS.map((name) => ({ name })) } };
  const costBody = {
    label: "合成数据",
    lines: OTTAWA_SYNTHETIC_SCENARIO.lines.map(({ line, ...rest }) => ({ lineNo: line.lineNo, ...rest })),
    importGst: OTTAWA_SYNTHETIC_SCENARIO.importGst, freight: OTTAWA_SYNTHETIC_SCENARIO.freight, reserves: OTTAWA_SYNTHETIC_SCENARIO.reserves, pricing: OTTAWA_SYNTHETIC_SCENARIO.pricing,
  };

  console.log("TI-4a bid workspace — isolated DB");

  // —— A20：开关关闭零影响 ——
  ok((await get(OWNER)).status === 404, "开关关闭：GET 404");
  ok((await put(OWNER, schedule)).status === 404, "开关关闭：PUT 404");
  ok((await cost(OWNER, costBody)).status === 404, "开关关闭：成本核算 404");
  ok((await roomOf(PROJECT)) === null && (await audits(PROJECT)).length === 0, "开关关闭：没有新建情报室记录，也没有审计记录");

  process.env.TENDER_BID_WORKSPACE_ENABLED = "1";
  process.env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST = ORG_B;
  ok((await get(OWNER)).status === 404 && (await roomOf(PROJECT)) === null, "组织不在白名单：404，零写入");
  process.env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST = "";

  // —— A17：租户隔离与访问控制 ——
  const outsiderGet = await get(OUTSIDER);
  const outsiderPut = await put(OUTSIDER, schedule);
  ok([403, 404].includes(outsiderGet.status) && [403, 404].includes(outsiderPut.status), "其它组织的管理员：读与写都被拒", { g: outsiderGet.status, p: outsiderPut.status });
  ok((await roomOf(PROJECT)) === null, "被拒之后数据未变（仍没有情报室记录）");
  ok((await get(VIEWER)).status === 200, "只读成员可以读取");
  const viewerPut = await put(VIEWER, schedule);
  ok(viewerPut.status === 403 && (await roomOf(PROJECT)) === null, "只读成员不能保存，数据未变", viewerPut.status);
  ok((await call(route.GET, OWNER, "GET", "no-such-project")).status === 404, "不存在的项目 → 404");

  // —— 保存、读回、A22 ——
  // 情报室里先放别的功能的内容，验证保存不碰它们
  await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: PROJECT, summaryJson: { pricingInputs: { ourCostCad: 12345, targetMarginPct: 25 }, tenderWatch: { url: "https://example.test/notice", hash: "abc" } } } });
  const before = (await roomOf(PROJECT))!.summaryJson as Json;
  const forged = await put(MEMBER, { ...schedule, orgId: ORG_B, userId: OUTSIDER, updatedById: OUTSIDER });
  ok(forged.status === 200, "有写权限的成员保存价格表成功", forged.body);
  const room1 = (await roomOf(PROJECT))!;
  const ws1 = (room1.summaryJson as Json).bidWorkspace as Json;
  ok(room1.orgId === ORG && ws1.updatedById === MEMBER, "请求体里伪造的组织与用户被忽略：数据在项目自己的组织下，操作者是登录用户");
  const a1 = await audits(PROJECT);
  ok(a1.length === 1 && a1[0].userId === MEMBER && a1[0].orgId === ORG && String(a1[0].afterData).includes("priceSchedule"), "多出一条审计记录：操作者是登录用户，改动块为价格表", a1.map((x) => [x.userId, x.afterData]));
  ok(!/unitPrice|ourCost|margin|\d+\.\d{2}/.test(String(a1[0].afterData)), "审计记录里没有金额");
  const after = (await roomOf(PROJECT))!.summaryJson as Json;
  ok(JSON.stringify(after.pricingInputs) === JSON.stringify(before.pricingInputs) && JSON.stringify(after.tenderWatch) === JSON.stringify(before.tenderWatch), "其它功能写在同一 JSON 位里的内容逐字保留");

  const detailsRes = await put(OWNER, {
    lineDetails: { "13": { product: { make: "合成品牌", model: "TC-S" }, certificates: [{ id: "CERT-1", status: "CLAIMED", coverage: "COMPONENT", issuerAccreditedInCanada: null, coveredModels: ["TC-S"] }] }, "18": { offeredDimensions: "36 x 39" } },
    ...holders,
    addenda: [{ number: 1, issuedOn: "2026-11-05", affectedLineNos: [13, 14, 15], effect: "整机加拿大电气认证" }],
  });
  ok(detailsRes.status === 200, "分块保存：行项详情、领取方名单、补遗", detailsRes.body);
  const read = await get(VIEWER);
  const ws = read.body!.workspace as { priceSchedule: { lines: unknown[] }; lineDetails: Json; documentHolders: { entries: unknown[] }; addenda: unknown[] };
  ok(ws.priceSchedule.lines.length === 18 && ws.documentHolders.entries.length === 9 && ws.addenda.length === 1 && !!ws.lineDetails["13"], "保存后读回：价格表仍在，新保存的三块都在");

  // —— 校验 ——
  const snapshot = JSON.stringify((await roomOf(PROJECT))!.summaryJson);
  const bad = await put(OWNER, { priceSchedule: { lines: [{ ...OTTAWA_18026_LINES[0], quantity: { n: 1 } }] } });
  ok(bad.status === 400 && /保存内容有误/.test(String(bad.body?.error)), "数量写成对象 → 400 与中文说明", bad.body);
  const many = await put(OWNER, { priceSchedule: { lines: Array.from({ length: 301 }, (_, i) => ({ ...OTTAWA_18026_LINES[0], lineNo: i + 1 })) } });
  ok(many.status === 400, "超过 300 行 → 400");
  ok((await put(OWNER, {})).status === 400, "一块都没给 → 400");
  ok(JSON.stringify((await roomOf(PROJECT))!.summaryJson) === snapshot, "校验失败时已存内容不变");
  const smuggle = await put(OWNER, { priceSchedule: { lines: OTTAWA_18026_LINES.map((l) => ({ ...l, unitPrice: "9.99", supplierQuote: "secret" })) }, costScenario: costBody });
  ok(smuggle.status === 200 && !/unitPrice|supplierQuote|costScenario|9\.99/.test(JSON.stringify(((await roomOf(PROJECT))!.summaryJson as Json).bidWorkspace)), "夹带的成本字段没有被保存");

  // —— 并发保存 ——
  await put(OWNER, { documentHolders: null, addenda: [] });
  const [c1, c2] = await Promise.all([put(OWNER, { addenda: [{ number: 2, affectedLineNos: [1] }] }), put(MEMBER, holders)]);
  const wsC = ((await roomOf(PROJECT))!.summaryJson as Json).bidWorkspace as { addenda: unknown[]; documentHolders: unknown };
  ok(c1.status === 200 && c2.status === 200 && wsC.addenda.length === 1 && !!wsC.documentHolders, "并发的两次分块保存都在，没有互相覆盖");
  const afterC = (await roomOf(PROJECT))!.summaryJson as Json;
  ok(JSON.stringify(afterC.pricingInputs) === JSON.stringify(before.pricingInputs), "并发保存之后其它功能的内容仍然保留");
  await put(OWNER, { addenda: [{ number: 1, issuedOn: "2026-11-05", affectedLineNos: [13, 14, 15] }] });

  // —— 读取结果 ——
  const view = (await get(OWNER)).body!.view as {
    schedule: { validation: { valid: boolean } }; documentHolders: { documentHolderCount: number; competitorHolderCount: number; bidderCount: number | null };
    lineChecks: Array<{ lineNo: number; certification: { verdict: string }; dimension: { verdict: string } | null }>;
    readiness: { state: string; blockers: Array<{ code: string; lineNo: number | null }> }; stages: { lists: { awaitingApproval: Array<{ stageKey: string }>; notConnected: Array<{ sourceKey: string }> } };
  };
  ok(view.schedule.validation.valid, "渥太华读取结果：价格表有效");
  ok(view.documentHolders.documentHolderCount === 9 && view.documentHolders.competitorHolderCount === 8 && view.documentHolders.bidderCount === null, "领取方数 9、竞争对手领取方数 8（我方按组织名识别）、投标人数未知");
  ok([13, 14, 15].every((n) => view.lineChecks.find((c) => c.lineNo === n)!.certification.verdict === "BLOCKED"), "第 13–15 行认证阻断（第 13 行那张只是声称且只覆盖部件）");
  ok(view.lineChecks.find((c) => c.lineNo === 18)!.dimension?.verdict === "MISMATCH", "第 18 行 36×39 → 尺寸不符");
  ok(view.readiness.state === "NOT_READY" && view.readiness.blockers.some((b) => b.code === "WINDOW_EXPIRED"), "可投标判定：不可投标，含已过截标（截标时间取自项目记录）");
  ok(view.stages.lists.awaitingApproval.length === 4 && view.stages.lists.notConnected.some((n) => n.sourceKey === "LICENSED_TRADE_DATA"), "阶段清单：四项停下等批准；授权贸易数据未接通");
  ok(!/"(goods|duty|freight|directCost|unitCost|unitBid|extended|profit|grossMarginPct|markupPct|bidExclHst)"\s*:/.test(JSON.stringify((await get(OWNER)).body)), "读取结果里没有成本、报价金额、利润、毛利率字段");

  // —— 成本核算：财务查看权、不落库 ——
  const beforeCost = JSON.stringify((await roomOf(PROJECT))!.summaryJson);
  const auditsBeforeCost = (await audits(PROJECT)).length;
  const sheet = await cost(OWNER, costBody);
  const sv = sheet.body?.view as { groups: Array<{ rows: Array<{ directCost: string; extended: string }> }>; totals: { directCost: string; bidExclHst: string } } | undefined;
  const cents = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);
  const rows = sv?.groups.flatMap((g) => g.rows) ?? [];
  ok(sheet.status === 200 && rows.length === 18 && String(sheet.body?.markdown).includes("## 合计"), "项目负责人算出核算表：行项 18 行，带 Markdown", sheet.body?.error);
  ok(!!sv && rows.reduce((a, r) => a + cents(r.directCost), 0) === cents(sv.totals.directCost) && rows.reduce((a, r) => a + cents(r.extended), 0) === cents(sv.totals.bidExclHst), "核算表合计等于逐行之和");
  ok((await cost(MEMBER, costBody)).status === 403, "有项目写权限但没有财务查看权的成员 → 403");
  ok((await cost(VIEWER, costBody)).status === 403, "只读成员 → 403");
  ok([403, 404].includes((await cost(OUTSIDER, costBody)).status), "其它组织的用户 → 被拒");
  ok(JSON.stringify((await roomOf(PROJECT))!.summaryJson) === beforeCost && (await audits(PROJECT)).length === auditsBeforeCost, "成本核算不落库：情报室记录与审计记录都没有变化");
  ok((await cost(OWNER, { ...costBody, lines: [...costBody.lines, { ...costBody.lines[0], lineNo: 99 }] })).status === 400, "成本输入引用不存在的行号 → 400");
  ok((await cost(OWNER, { lines: "x" })).status === 400, "成本输入格式不对 → 400");
  const noSchedule = await cost(OWNER, costBody, EMPTY_PROJECT);
  ok(noSchedule.status === 409 && /先保存价格表/.test(String(noSchedule.body?.error)), "还没有价格表 → 409 与说明", noSchedule.body);

  // —— 清理 ——
  await db.auditLog.deleteMany({ where: { projectId: { in: [PROJECT, EMPTY_PROJECT] } } });
  await db.project.deleteMany({ where: { id: { in: [PROJECT, EMPTY_PROJECT] } } });
  await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
  await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
  await db.user.deleteMany({ where: { id: { in: [OWNER, MEMBER, VIEWER, OUTSIDER] } } });
  await db.$disconnect();

  console.log(`\nTI-4a bid workspace DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
