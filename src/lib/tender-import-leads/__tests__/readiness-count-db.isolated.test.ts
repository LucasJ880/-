/**
 * CHAIN-3b 投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录——真实 DB（隔离库），调用真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-import-leads/__tests__/readiness-count-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；外部请求一律被替换成计数后报错的假函数（不出站）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-3b 投标准备度读取进口记录 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-3b readiness import leads DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Stage = { key: string; decision: string; detailZh: string };
type View = { materials: string[]; stages: { ok: boolean; stages: Stage[]; lists: { notConnected: Array<{ stageKey: string }> } } };

async function main() {
  let outbound = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
    if (!/^https?:\/\/localhost/.test(url)) { outbound += 1; throw new Error(`blocked outbound in test: ${url}`); }
    return realFetch(input as RequestInfo);
  }) as typeof fetch;

  const saved = {
    t4: process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY,
    leads: process.env.TENDER_IMPORT_LEADS_ENABLED,
    ws: process.env.TENDER_BID_WORKSPACE_ENABLED,
  };
  process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";
  process.env.TENDER_IMPORT_LEADS_ENABLED = "1";
  process.env.TENDER_BID_WORKSPACE_ENABLED = "1";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { normalizeBuyerName } = await import("@/lib/corporate-memory/normalize");
  const { normalizeVendorName } = await import("@/lib/tender-intel/awards");
  const { rejectSignal } = await import("@/lib/supplier-intel/signal-service");
  const { hasImportLeadsForReadiness } = await import("../readiness-count");
  const svc = await import("../service");
  const leadsRoute = await import("@/app/api/projects/[id]/tender-intel/import-leads/route");
  const workspaceRoute = await import("@/app/api/projects/[id]/bid-workspace/route");

  console.log("CHAIN-3b readiness reads import leads — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `rcowner_${stamp}`, OTHER = `rcother_${stamp}`, ORG = `rcorg_${stamp}`, ORG2 = `rcorg2_${stamp}`;
  const USERS = [OWNER, OTHER];
  const email = (id: string) => `${id}@fixture.test`;
  for (const id of USERS) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Sunny Fixture Inc.", code: `rc-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Other Fixture Org", code: `rc2-${stamp}`, ownerId: OTHER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OTHER, role: "org_admin", status: "active" } });

  const BUYER = "City of Fixture";
  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(orgId: string, ownerId: string) {
    seq += 1;
    const projectId = `rcproj_${stamp}_${seq}`;
    projectIds.push(projectId);
    await db.project.create({ data: { id: projectId, name: `Fixture Bedding Tender ${stamp}-${seq}`, orgId, ownerId, workDomain: "tender", intakeStatus: "dispatched", clientOrganization: BUYER } });
    return projectId;
  }
  const award = await db.awardRecord.create({
    data: { orgId: ORG, buyerNameRaw: BUYER, buyerNameNormalized: normalizeBuyerName(BUYER), winnerName: "Northfield Pest Supply Inc.", winnerNameNormalized: normalizeVendorName("Northfield Pest Supply Inc."), contractAmount: 1000, currency: "CAD", scopeSummary: "Bedding", awardDate: new Date("2025-03-01T00:00:00Z"), confidence: "HIGH", verificationStatus: "HUMAN_CONFIRMED", status: "ACTIVE", createdByType: "user", createdById: OWNER },
  });
  await db.awardRecordSource.create({ data: { orgId: ORG, awardRecordId: award.id, sourceType: "USER_ENTRY", sourceKey: `manual:rc-${stamp}`, capturedAt: new Date("2025-03-02T00:00:00Z"), createdById: OWNER } });

  const cookieOf = async (id: string) => `qy_session=${await createSession({ sub: id, email: email(id), role: "user" })}`;
  const owner = await cookieOf(OWNER);
  const doImport = async (p: string, text: string) => {
    const res = await leadsRoute.POST(new NextRequest(`http://localhost/api/projects/${p}/tender-intel/import-leads`, { method: "POST", headers: { cookie: owner, "content-type": "application/json" }, body: JSON.stringify({ text }) }), { params: Promise.resolve({ id: p }) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const readWorkspace = async (p: string) => {
    const res = await workspaceRoute.GET(new NextRequest(`http://localhost/api/projects/${p}/bid-workspace`, { headers: { cookie: owner } }), { params: Promise.resolve({ id: p }) });
    const json = (await res.json()) as { view?: View };
    return { status: res.status, text: JSON.stringify(json.view ?? null), view: json.view };
  };
  const stageOf = (v: View | undefined) => v?.stages.stages.find((s) => s.key === "import_leads");
  const stored = async (p: string) => (await svc.loadImportLeadsView({ orgId: ORG, projectId: p, canEdit: true })).storedLeadCount;
  const consistent = async (p: string) => (await hasImportLeadsForReadiness({ orgId: ORG, projectId: p })) === ((await stored(p)) > 0);

  const CSV = ["Importer,Exporter,Date,Goods,Quantity,URL", `Northfield Pest Supply Inc,Ningbo Bedding Co Ltd,2026-09-01,Mattress encasement,1200 PCS,https://example.test/bol/1`].join("\n");

  try {
    const P = await mkProject(ORG, OWNER);
    const P2 = await mkProject(ORG, OWNER);

    // —— 1. 没有导入记录：没有材料，阶段未接通 ——
    const w0 = await readWorkspace(P);
    ok((await hasImportLeadsForReadiness({ orgId: ORG, projectId: P })) === false && (await consistent(P)), "没有导入记录：false，与已导入 0 条一致");
    ok(w0.status === 200 && !w0.view!.materials.includes("IMPORT_LEADS") && stageOf(w0.view)?.decision === "NOT_CONNECTED" && w0.view!.stages.lists.notConnected.some((n) => n.stageKey === "import_leads"), "没有导入记录：投标工作区里进口线索阶段仍未接通", stageOf(w0.view));

    // —— 2. 经 CHAIN-3 真实导入接口导入一条 ——
    const imp = await doImport(P, CSV);
    ok(imp.status === 200 && (await stored(P)) === 1, "导入一条（真实导入接口）", imp.json);
    ok((await hasImportLeadsForReadiness({ orgId: ORG, projectId: P })) === true && (await consistent(P)), "导入之后：true，与已导入 1 条一致");
    const w1 = await readWorkspace(P);
    const s1 = stageOf(w1.view);
    ok(w1.view!.materials.includes("IMPORT_LEADS") && s1?.decision === "RUN" && s1.detailZh === "只处理人工提供的进口线索" && !w1.view!.stages.lists.notConnected.some((n) => n.stageKey === "import_leads"), "导入之后：手头材料有进口线索，阶段执行、只处理人工提供的，不在未接通清单里", s1);

    // —— 3. 别的项目、别的组织、非 import_lead_v1 的 TRADE_DATA 信号不算 ——
    ok((await hasImportLeadsForReadiness({ orgId: ORG, projectId: P2 })) === false && (await consistent(P2)), "同组织的另一个项目：false（导入记录在别的项目）");
    await db.supplierDiscoverySignal.create({ data: { orgId: ORG, projectId: P2, platform: "TRADE_DATA", contentType: "PROFILE", sourceOrigin: "PUBLIC_WEB", title: "search hit", rawMetadataJson: { provider: "search-engine" } } as never });
    ok((await hasImportLeadsForReadiness({ orgId: ORG, projectId: P2 })) === false && (await consistent(P2)), "非 import_lead_v1 的 TRADE_DATA 信号：不算");
    const PO = await mkProject(ORG2, OTHER);
    await db.supplierDiscoverySignal.create({ data: { orgId: ORG2, projectId: PO, platform: "TRADE_DATA", contentType: "USER_SUBMITTED", sourceOrigin: "MANUAL_ENTRY", title: "lead", rawMetadataJson: { kind: "import_lead_v1" } } as never });
    ok((await hasImportLeadsForReadiness({ orgId: ORG, projectId: PO })) === false && (await hasImportLeadsForReadiness({ orgId: ORG2, projectId: P })) === false, "组织与项目要对上：别的组织的记录、拿别的组织查本项目都不算");

    // —— 4. 开关关：不查、按没有；读取结果与没有记录时相同 ——
    process.env.TENDER_IMPORT_LEADS_ENABLED = "0";
    ok((await hasImportLeadsForReadiness({ orgId: ORG, projectId: P })) === false, "进口线索导入开关关：false（库里有记录也不算）");
    const wOff = await readWorkspace(P);
    const wOffEmpty = await readWorkspace(P2);
    ok(!wOff.view!.materials.includes("IMPORT_LEADS") && stageOf(wOff.view)?.decision === "NOT_CONNECTED" && JSON.stringify(wOff.view!.stages) === JSON.stringify(wOffEmpty.view!.stages), "开关关：阶段与没有导入记录的项目完全相同", [stageOf(wOff.view), stageOf(wOffEmpty.view)]);
    process.env.TENDER_IMPORT_LEADS_ENABLED = "1";

    // —— 5. 在供应链页标为不采用：不算 ——
    const sig = await db.supplierDiscoverySignal.findFirstOrThrow({ where: { orgId: ORG, projectId: P, platform: "TRADE_DATA" } });
    await rejectSignal({ orgId: ORG, userId: OWNER }, sig.id);
    ok((await hasImportLeadsForReadiness({ orgId: ORG, projectId: P })) === false && (await consistent(P)) && (await stored(P)) === 0, "唯一一条标为不采用：false，与已导入 0 条一致");
    const w2 = await readWorkspace(P);
    ok(stageOf(w2.view)?.decision === "NOT_CONNECTED" && !w2.view!.materials.includes("IMPORT_LEADS"), "标为不采用之后：阶段回到未接通");

    ok(outbound === 0, "外部请求次数为 0");
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of [["T4_AWARD_INTELLIGENCE_SCHEMA_READY", saved.t4], ["TENDER_IMPORT_LEADS_ENABLED", saved.leads], ["TENDER_BID_WORKSPACE_ENABLED", saved.ws]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.awardRecordSource.deleteMany({ where: { orgId: ORG } });
    await db.awardRecord.deleteMany({ where: { orgId: ORG } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG2] } }, { userId: { in: USERS } }, { projectId: { in: projectIds } }] } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.user.deleteMany({ where: { id: { in: USERS } } });
    await db.$disconnect();
  }

  console.log(`\nCHAIN-3b readiness import leads DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
