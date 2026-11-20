/**
 * CHAIN-3 进口线索——真实 DB（隔离库）端到端：导入 / 去重 / 比对三档 / 裁决 / 汇总 / 加入供应商库 / 审计 / 权限
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；外部请求一律被替换成计数后报错的假函数（不出站）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-3 进口线索 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-3 import leads DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

async function main() {
  let outbound = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
    if (!/^https?:\/\/localhost/.test(url)) { outbound += 1; throw new Error(`blocked outbound in test: ${url}`); }
    return realFetch(input as RequestInfo);
  }) as typeof fetch;

  process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { normalizeBuyerName } = await import("@/lib/corporate-memory/normalize");
  const { normalizeVendorName } = await import("@/lib/tender-intel/awards");
  const { loadRfqWebEntry } = await import("@/lib/tender-rfq/web-entry");
  const { rejectSignal } = await import("@/lib/supplier-intel/signal-service");
  const svc = await import("../service");
  const leadsRoute = await import("@/app/api/projects/[id]/tender-intel/import-leads/route");
  const aliasesRoute = await import("@/app/api/projects/[id]/tender-intel/import-leads/aliases/route");
  const suppliersRoute = await import("@/app/api/projects/[id]/tender-intel/import-leads/suppliers/route");
  type View = import("../aggregate-pure").ImportLeadsView;
  type Result = import("../service").ImportResult;

  console.log("CHAIN-3 import leads — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `ilowner_${stamp}`, OUTSIDER = `ilout_${stamp}`, MEMBER = `ilmember_${stamp}`, REMOVED = `ilremoved_${stamp}`, ORG = `ilorg_${stamp}`, ORG2 = `ilorg2_${stamp}`;
  const USERS = [OWNER, OUTSIDER, MEMBER, REMOVED];
  const email = (id: string) => `${id}@fixture.test`;
  for (const id of USERS) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Sunny Fixture Inc.", code: `il-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Other Org", code: `il2-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OUTSIDER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: REMOVED, role: "org_member", status: "inactive" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(buyer: string | null) {
    seq += 1;
    const projectId = `ilproj_${stamp}_${seq}`;
    projectIds.push(projectId);
    await db.project.create({ data: { id: projectId, name: `Fixture Bedding Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", clientOrganization: buyer } });
    for (const userId of [MEMBER, REMOVED]) await db.projectMember.create({ data: { projectId, userId, role: "operator", status: "active" } });
    const run = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId, status: "APPROVED", idempotencyKey: `il-${stamp}-${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    await db.tenderExtractedRequirement.create({ data: { projectId, analysisRunId: run.id, requirementCode: "R-001", category: "product", originalRequirement: "Mattress encasement, zippered, bed bug proof", chineseTranslation: "床垫防虫套", mandatory: true, reviewStatus: "CONFIRMED" } });
    return projectId;
  }
  let awardSeq = 0;
  async function mkAward(buyer: string, winner: string, o: { sourceKey?: string; projectId?: string | null; verification?: string } = {}) {
    awardSeq += 1;
    const rec = await db.awardRecord.create({
      data: { orgId: ORG, buyerNameRaw: buyer, buyerNameNormalized: normalizeBuyerName(buyer), projectId: o.projectId ?? null, winnerName: winner, winnerNameNormalized: normalizeVendorName(winner), contractAmount: 1000, currency: "CAD", scopeSummary: "Bedding", awardDate: new Date("2025-03-01T00:00:00Z"), confidence: "HIGH", verificationStatus: o.verification ?? "HUMAN_CONFIRMED", status: "ACTIVE", createdByType: "user", createdById: OWNER },
    });
    await db.awardRecordSource.create({ data: { orgId: ORG, awardRecordId: rec.id, sourceType: "USER_ENTRY", sourceKey: o.sourceKey ?? `manual:${stamp}-${awardSeq}`, capturedAt: new Date("2025-03-02T00:00:00Z"), createdById: OWNER } });
  }

  const cookieOf = async (id: string) => `qy_session=${await createSession({ sub: id, email: email(id), role: "user" })}`;
  const owner = await cookieOf(OWNER);
  const base = (p: string) => `http://localhost/api/projects/${p}/tender-intel/import-leads`;
  const get = async (p: string, who: string | null = owner) => {
    const res = await leadsRoute.GET(new NextRequest(base(p), { headers: who ? { cookie: who } : {} }), { params: Promise.resolve({ id: p }) });
    return { status: res.status, json: (await res.json()) as View & { error?: string } };
  };
  const post = (url: string, body: unknown, who: string | null = owner) => new NextRequest(url, { method: "POST", headers: { ...(who ? { cookie: who } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
  const doImport = async (p: string, body: unknown, who: string | null = owner) => {
    const res = await leadsRoute.POST(post(base(p), body, who), { params: Promise.resolve({ id: p }) });
    return { status: res.status, json: (await res.json()) as { result?: Result; view?: View; error?: string; code?: string } };
  };
  const decide = async (p: string, body: unknown, who: string | null = owner) => {
    const res = await aliasesRoute.POST(post(`${base(p)}/aliases`, body, who), { params: Promise.resolve({ id: p }) });
    return { status: res.status, json: (await res.json()) as { view?: View; error?: string } };
  };
  const addSupplier = async (p: string, exporterKey: string, who: string | null = owner) => {
    const res = await suppliersRoute.POST(post(`${base(p)}/suppliers`, { exporterKey }, who), { params: Promise.resolve({ id: p }) });
    return { status: res.status, json: (await res.json()) as { result?: { supplier: { id: string; created: boolean; hasEmail: boolean }; linkedLeads: number; messageZh: string }; view?: View; error?: string } };
  };
  const leadSignals = (p: string) => db.supplierDiscoverySignal.findMany({ where: { orgId: ORG, projectId: p, platform: "TRADE_DATA" }, orderBy: { createdAt: "asc" } });

  const BUYER = "City of Fixture";
  const CSV = [
    "Importer,Exporter,Date,Goods,Quantity,URL",
    `"NORTHFIELD PEST SUPPLY, INC.","Ningbo Bedding Co., Ltd.",2026-09-01,"Mattress encasement, zippered",1200 PCS,https://example.test/bol/1`,
    `Northfield Pest Supply Inc,Ningbo Bedding Co Ltd,2026-10-01,Mattress covers,800 PCS,https://example.test/bol/2`,
    `Northfield Pest Supply,Hangzhou Tent Factory,2026-05-01,Tents,50 PCS,https://example.test/bol/3`,
    `Boreal Outfitters,Xiamen Outdoor Gear,2026-04-01,Sleeping bags,30 PCS,https://example.test/bol/4`,
    `Northfield Pet Supply,Shenzhen Pet Toys,2026-04-01,Pet toys,10 PCS,https://example.test/bol/5`,
    `Northfield Pest Supply Inc.,,2026-04-01,Sheets,10 PCS,https://example.test/bol/6`,
  ].join("\n");

  try {
    // —— 1. 开关关闭：404 ——
    delete process.env.TENDER_IMPORT_LEADS_ENABLED;
    const p1 = await mkProject(BUYER);
    ok((await get(p1)).status === 404 && (await doImport(p1, { text: CSV })).status === 404, "开关关闭：读与导入都是 404");
    process.env.TENDER_IMPORT_LEADS_ENABLED = "1";

    // —— 2. 没有可比对的中标者：不导入（授标记录没接通 / 项目没有采购方 / 只有我方结果）——
    delete process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY;
    const offT4 = await doImport(p1, { text: CSV });
    process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";
    const pNoBuyer = await mkProject(null);
    const noBuyer = await doImport(pNoBuyer, { text: CSV });
    ok(offT4.status === 422 && offT4.json.error === "授标记录还没有接通，没法比对历史中标者（请联系管理员开启）。" && noBuyer.status === 422 && noBuyer.json.error === "项目没有采购方名称，没法找历史中标者。" && (await leadSignals(p1)).length === 0, "授标记录没接通、项目没有采购方：422，不导入", [offT4.json, noBuyer.json]);
    await mkAward("Only Own Buyer", "Sunny Fixture Inc.");
    const pNone = await mkProject("only own buyer");
    const none = await doImport(pNone, { text: CSV });
    ok(none.status === 422 && none.json.error === "本项目采购方还没有他人中标的记录（不含我方结果），没法比对。" && (await leadSignals(pNone)).length === 0, "采购方只有我方中标的记录：422，不导入", none);
    const vNone = await get(pNone);
    ok(vNone.json.winners.status === "none", "视图写明没有可比对的中标者", vNone.json.winners);

    // 本项目采购方的中标者：两家他人 + 我方中标（剔除）+ 我方没中时回灌的对手（剔除）
    await mkAward("CITY OF FIXTURE", "Northfield Pest Supply Inc.");
    await mkAward(BUYER, "Boreal Outfitters Ltd.");
    await mkAward(BUYER, "Sunny Fixture Inc.");
    await mkAward(BUYER, "Backfilled Rival Ltd.", { sourceKey: `tender-result-winner:${p1}`, projectId: p1 });

    // —— 3. 导入：三档 + 逐条问题 ——
    const r1 = await doImport(p1, { text: CSV, sourceLabel: "ImportYeti 查询" });
    const res1 = r1.json.result;
    ok(r1.status === 200 && !!res1 && res1.imported === 4 && res1.matched === 2 && res1.suggested === 2 && res1.unrelated === 1 && res1.unrelatedImporters.join() === "Northfield Pet Supply" && res1.problems.length === 1 && res1.problems[0].messageZh === "缺少出口商：第 6 条记录", "导入：4 条（2 条挂上、2 条待确认），1 条对不上（列出进口商名称），1 条缺出口商", r1.json);
    const sigs = await leadSignals(p1);
    const meta0 = sigs[0]?.rawMetadataJson as { kind?: string; lead?: { status?: string; statusZh?: string }; importerRaw?: string } | null;
    ok(sigs.length === 4 && sigs.every((s) => s.platform === "TRADE_DATA" && s.sourceOrigin === "MANUAL_ENTRY" && s.status === "NEW") && meta0?.kind === "import_lead_v1" && meta0.lead?.status === "LEAD_UNVERIFIED" && meta0.lead?.statusZh === "线索，未证实当前供货" && sigs[0].contentUrl === "https://example.test/bol/1", "存为 4 条信号：平台 TRADE_DATA、来源人工录入、线索状态「线索，未证实当前供货」", sigs.map((s) => ({ p: s.platform, o: s.sourceOrigin, st: s.status })));
    const v1 = r1.json.view!;
    ok(v1.winners.status === "ok" && [...v1.winners.names].sort().join("|") === "Boreal Outfitters Ltd.|Northfield Pest Supply Inc.", "历史中标者：两家他人（剔除我方中标与我方结果回灌）", v1.winners);
    ok(v1.exporters.length === 1 && v1.exporters[0].exporterName === "Ningbo Bedding Co., Ltd." && v1.exporters[0].shipments === 2 && v1.exporters[0].last12Months === 2 && v1.exporters[0].latestDate === "2026-10-01" && v1.exporters[0].sharedKeywords.includes("encasement") && v1.leadCount === 2, "汇总：挂上的 Ningbo 两票（规整后同名算一家），品名共有关键词", v1.exporters);
    ok(v1.suggestions.length === 2 && v1.suggestions.some((s) => s.importerName === "Northfield Pest Supply" && s.winnerName === "Northfield Pest Supply Inc." && s.basisZh === "只差公司后缀" && s.recordCount === 1), "待裁决：两对疑似同一家（写明依据与条数）", v1.suggestions);
    ok(v1.caveatZh === "历史进口关联只是寻源线索：不代表独家、不代表当前供货，也不代表对方的投标价。" && v1.sourceNotesZh[0] === "授权贸易 / 提单数据：未接通。这不表示没有记录，而是没有查。" && v1.canEdit === true && v1.storedLeadCount === 4, "视图带线索说明、来源情况、canEdit、存着的条数");
    const keys = new Set<string>();
    const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) { keys.add(k); walk(y); } };
    walk(r1.json);
    walk((await get(p1)).json);
    ok(![...keys].some((k) => /recommend|price|cost|margin|bid|score|rank/i.test(k)), "真实的导入与读取响应：各层的键里没有推荐、价格、成本、毛利、投标价", [...keys]);

    // —— 4. 再导入一次：全部跳过重复 ——
    const r2 = await doImport(p1, { text: CSV, sourceLabel: "ImportYeti 查询" });
    ok(r2.status === 200 && r2.json.result?.imported === 0 && r2.json.result?.duplicates === 4 && (await leadSignals(p1)).length === 4, "再导入一次：一条都没有新增，4 条计为跳过重复", r2.json.result);

    // —— 5. 裁决：确认一对、否决一对；否决后再导入同样一对按无关处理；再裁决 409 ——
    const pairNorth = v1.suggestions.find((s) => s.importerName === "Northfield Pest Supply")!.pairKey;
    const pairBoreal = v1.suggestions.find((s) => s.importerName === "Boreal Outfitters")!.pairKey;
    const c1 = await decide(p1, { pairKey: pairNorth, decision: "CONFIRMED" });
    ok(c1.status === 200 && !!c1.json.view?.exporters.some((e) => e.exporterName === "Hangzhou Tent Factory") && c1.json.view.suggestions.length === 1, "确认后：Hangzhou 进汇总，待裁决剩一对", c1.json.view?.exporters.map((e) => e.exporterName));
    const c2 = await decide(p1, { pairKey: pairBoreal, decision: "REJECTED" });
    ok(c2.status === 200 && c2.json.view?.suggestions.length === 0 && !c2.json.view.exporters.some((e) => e.exporterName === "Xiamen Outdoor Gear"), "否决后：这一对的记录不再显示", c2.json.view);
    const r3 = await doImport(p1, { text: "Importer,Exporter,URL\nBoreal Outfitters,Fuzhou New Gear,https://example.test/bol/9\n" });
    ok(r3.status === 200 && r3.json.result?.imported === 0 && r3.json.result?.unrelated === 1, "否决过的一对再导入：按无关处理，没有导入", r3.json.result);
    const again = await decide(p1, { pairKey: pairNorth, decision: "REJECTED" });
    ok(again.status === 409 && again.json.error === "同事已经处理过这一对，页面已更新。", "已裁决的一对再裁决：409", again);
    const stray = await decide(p1, { pairKey: "nobody ⇄ nothing", decision: "CONFIRMED" });
    ok(stray.status === 404 && stray.json.error === "这一对已不需要确认。", "不在本项目待裁决列表里的一对：404", stray);
    // 裁决对本组织所有项目生效：另一个同采购方的项目里同样一对直接算挂上
    const pOther = await mkProject(BUYER);
    const otherImp = await doImport(pOther, { text: "Importer,Exporter,URL\nNorthfield Pest Supply,Guangzhou Sheets,https://example.test/o/1\n" });
    ok(otherImp.json.result?.matched === 1 && otherImp.json.view?.suggestions.length === 0 && otherImp.json.view?.exporters[0]?.exporterName === "Guangzhou Sheets", "在别的项目确认过的一对：这个项目里直接挂上、不再要确认", otherImp.json);
    const aliasAudits = await db.auditLog.findMany({ where: { orgId: ORG, action: "tender.import_lead_alias_decided" } });
    const ad = JSON.parse(aliasAudits[0]?.afterData ?? "{}") as Record<string, unknown>;
    ok(aliasAudits.length === 2 && aliasAudits.every((a) => a.targetType === "import_lead_alias" && a.targetId?.startsWith("alias:") && a.userId === OWNER) && typeof ad.decidedAt === "string" && ad.decidedBy === OWNER, "裁决审计各一条：两个名称、裁决、裁决人、时间", aliasAudits.map((a) => a.afterData));

    // —— 6. 加入供应商库：新建（无邮箱）→ 出现在询价入口；再点只关联；同名已有 → 关联 ——
    const ningboKey = v1.exporters[0].exporterKey;
    const a1 = await addSupplier(p1, ningboKey);
    const created = a1.json.result?.supplier;
    const sup = created ? await db.supplier.findUnique({ where: { id: created.id } }) : null;
    ok(a1.status === 200 && !!created && created.created === true && created.hasEmail === false && sup?.source === "trade_data" && sup.contactEmail === null && sup.status === "active" && (sup.sourceDetail ?? "").includes("Northfield Pest Supply Inc.") && a1.json.result?.messageZh === "已加入供应商库。提单记录通常没有邮箱，请先补上联系邮箱，才能发询价。", "新建供应商：来源 trade_data、邮箱留空，说明写明中标者", { a1: a1.json.result, sup });
    const linked = (await leadSignals(p1)).filter((s) => s.linkedSupplierId === created?.id);
    const resolution = linked[0]?.resolutionJson as Array<{ decision?: string }> | null;
    ok(linked.length === 2 && linked.every((s) => s.status === "LINKED") && Array.isArray(resolution) && resolution.some((e) => e.decision === "HUMAN_LINKED") && a1.json.result?.linkedLeads === 2, "这家的 2 条线索经既有关联流程关联到它", linked.map((s) => s.status));
    const entry = await loadRfqWebEntry({ projectId: p1, orgId: ORG, userId: OWNER });
    const entrySuppliers = entry.available ? ((entry as unknown as { suppliers?: Array<{ id: string }> }).suppliers ?? []) : [];
    ok(entrySuppliers.some((s) => s.id === created?.id), "询价入口的供应商列表里有它", entry.available ? entrySuppliers.length : entry);
    const a2 = await addSupplier(p1, ningboKey);
    ok(a2.status === 200 && a2.json.result?.supplier.created === false && a2.json.result.supplier.id === created?.id && (await db.supplier.count({ where: { orgId: ORG, source: "trade_data" } })) === 1, "再点一次：只关联，不新建", a2.json.result);
    const existing = await db.supplier.create({ data: { orgId: ORG, name: "HANGZHOU TENT FACTORY", contactEmail: "sales@hangzhou-tent.test", status: "active", createdById: OWNER } });
    const hzKey = c2.json.view!.exporters.find((e) => e.exporterName === "Hangzhou Tent Factory")!.exporterKey;
    const a3 = await addSupplier(p1, hzKey);
    ok(a3.status === 200 && a3.json.result?.supplier.created === false && a3.json.result.supplier.id === existing.id && a3.json.result.messageZh === "供应商库里已有「HANGZHOU TENT FACTORY」，已关联，没有新建。", "库里已有同名的：关联它，不新建", a3.json.result);
    const notIn = await addSupplier(p1, "not a key");
    ok(notIn.status === 404 && notIn.json.error === "这家出口商不在本项目的进口线索汇总里。", "不在本项目汇总里的出口商：404");
    // 加入之后又导入了同一家的新记录：还能「关联新导入的」，关联到同一家，不新建
    const more = await doImport(p1, { text: "Importer,Exporter,Date,URL\nNorthfield Pest Supply Inc.,Ningbo Bedding Co Ltd,2026-11-01,https://example.test/bol/7\n" });
    const ningboRow = more.json.view?.exporters.find((e) => e.exporterKey === ningboKey);
    const a4 = await addSupplier(p1, ningboKey);
    ok(more.json.result?.imported === 1 && ningboRow?.unlinkedLeads === 1 && a4.json.result?.supplier.id === created?.id && a4.json.result?.linkedLeads === 1 && a4.json.view?.exporters.find((e) => e.exporterKey === ningboKey)?.unlinkedLeads === 0, "新导入的同一家：还有 1 条没关联，再点一次关联到同一家", { ningboRow, a4: a4.json.result });
    // 同名的几种写法与挑选规则：「&」与「and」；只有停用的那家；在用且有邮箱的优先
    await db.supplier.create({ data: { orgId: ORG, name: "P&G Trading Ltd", status: "active", createdById: OWNER } });
    const dalianOld = await db.supplier.create({ data: { orgId: ORG, name: "Dalian Cots Co.", status: "inactive", contactEmail: "x@dalian.test", createdById: OWNER } });
    await db.supplier.create({ data: { orgId: ORG, name: "SHANGHAI LINEN MILL", status: "inactive", contactEmail: "a@sh.test", createdById: OWNER } });
    const shActive = await db.supplier.create({ data: { orgId: ORG, name: "Shanghai Linen Mill", status: "active", contactEmail: "b@sh.test", createdById: OWNER } });
    await db.supplier.create({ data: { orgId: ORG, name: "Shanghai  Linen  Mill", status: "active", createdById: OWNER } });
    const imp4 = await doImport(p1, { text: "Importer,Exporter,URL\nNorthfield Pest Supply Inc.,P and G Trading Ltd,https://example.test/s/1\nNorthfield Pest Supply Inc.,Dalian Cots Co,https://example.test/s/2\nNorthfield Pest Supply Inc.,Shanghai Linen Mill,https://example.test/s/3\n" });
    const keyOf = (name: string) => imp4.json.view!.exporters.find((e) => e.exporterName === name)!.exporterKey;
    const pg = await addSupplier(p1, keyOf("P and G Trading Ltd"));
    const dl = await addSupplier(p1, keyOf("Dalian Cots Co"));
    const sh = await addSupplier(p1, keyOf("Shanghai Linen Mill"));
    ok(pg.json.result?.supplier.created === false && dl.json.result?.supplier.id === dalianOld.id && dl.json.result.messageZh === "供应商库里已有「Dalian Cots Co.」，已关联，没有新建。它已停用，要发询价请先在供应商页启用。" && sh.json.result?.supplier.id === shActive.id, "同名：「P&G」与「P and G」算同一家；只有停用的那家照实说；几家同名时取在用且有邮箱的", [pg.json.result, dl.json.result, sh.json.result]);
    const memberAdd = await addSupplier(p1, keyOf("Shanghai Linen Mill"), await cookieOf(MEMBER));
    ok(memberAdd.status === 403, "只读成员加入供应商库：403", memberAdd.status);
    const vAfter = await get(p1);
    ok(vAfter.json.exporters.find((e) => e.exporterKey === ningboKey)?.supplier?.hasEmail === false && vAfter.json.exporters.find((e) => e.exporterKey === hzKey)?.supplier?.hasEmail === true, "汇总里写明供应商库状态与有无邮箱", vAfter.json.exporters.map((e) => e.supplier));

    // —— 7. 在供应链页被驳回的线索不再计入 ——
    const pRej = await mkProject(BUYER);
    await doImport(pRej, { text: "Importer,Exporter,Date,URL\nNorthfield Pest Supply Inc.,Qingdao Linen,2026-08-01,https://example.test/q/1\nNorthfield Pest Supply Inc.,Qingdao Linen,2026-09-01,https://example.test/q/2\n" });
    const rejSig = (await leadSignals(pRej))[0];
    await rejectSignal({ orgId: ORG, userId: OWNER }, rejSig.id);
    const vRej = await get(pRej);
    ok(vRej.json.exporters[0]?.shipments === 1 && vRej.json.leadCount === 1, "供应链页驳回了一条：汇总只算剩下那一条", vRej.json.exporters);

    // —— 8. 审计 ——
    const importAudits = await db.auditLog.findMany({ where: { orgId: ORG, projectId: p1, action: "tender.import_leads_imported" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const supAudits = await db.auditLog.findMany({ where: { orgId: ORG, action: "tender.import_lead_supplier_added" } });
    const ia = JSON.parse(importAudits[0]?.afterData ?? "{}") as Record<string, unknown>;
    const sa = supAudits.map((a) => JSON.parse(a.afterData ?? "{}") as Record<string, unknown>).find((x) => x.created === true);
    ok(importAudits.length === 5 && ia.imported === 4 && ia.sourceLabel === "ImportYeti 查询" && typeof ia.batchId === "string" && supAudits.length >= 6 && !!sa && sa.exporterName === "Ningbo Bedding Co., Ltd." && sa.linkedLeads === 2 && typeof sa.supplierId === "string" && !supAudits.some((a) => (a.afterData ?? "").includes("@")) && !importAudits.some((a) => (a.afterData ?? "").includes("example.test")), "导入、加入供应商库各有审计（供应商、是否新建、出口商、关联条数）；不记联系方式与运单原文", { ia, sa });

    // —— 9. 权限 ——
    const outRead = await get(p1, await cookieOf(OUTSIDER));
    const outWrite = await doImport(p1, { text: CSV }, await cookieOf(OUTSIDER));
    const anon = await get(p1, null);
    const removed = await get(p1, await cookieOf(REMOVED));
    const member = await cookieOf(MEMBER);
    const memberRead = await get(p1, member);
    const memberWrite = await doImport(p1, { text: CSV }, member);
    const memberDecide = await decide(p1, { pairKey: pairBoreal, decision: "CONFIRMED" }, member);
    ok(outRead.status === 404 && outWrite.status === 404 && anon.status === 401 && removed.status === 404 && memberWrite.status === 403 && memberDecide.status === 403, "别的组织读写 404、未登录 401、被移出组织 404、只读成员写 403", [outRead.status, outWrite.status, anon.status, removed.status, memberWrite.status, memberDecide.status]);
    ok(memberRead.status === 200 && memberRead.json.canEdit === false, "只读成员能看，canEdit 为 false", memberRead.json.canEdit);

    // —— 10. 外部请求 ——
    ok(outbound === 0, "整个过程外部请求 0 次", outbound);
    void svc;
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ["TENDER_IMPORT_LEADS_ENABLED", "T4_AWARD_INTELLIGENCE_SCHEMA_READY"]) delete process.env[k];
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG2] } }, { userId: { in: USERS } }] } });
    await db.awardRecordSource.deleteMany({ where: { orgId: ORG } });
    await db.awardRecord.deleteMany({ where: { orgId: ORG } });
    await db.supplier.deleteMany({ where: { orgId: ORG } });
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.user.deleteMany({ where: { id: { in: USERS } } });
    await db.$disconnect();
  }
  console.log(`CHAIN-3 import leads DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
