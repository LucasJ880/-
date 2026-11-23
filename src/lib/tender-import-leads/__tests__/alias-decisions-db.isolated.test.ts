/**
 * CHAIN-3c「是不是同一家」裁决与撤回——真实 DB（隔离库）的对抗用例（交叉验证 2026-11-23 补进正式测试）
 *
 * 覆盖：两个组织同一对互不影响（读裁决按组织过滤）；并发撤回 / 并发裁决只成功一个；
 * 加锁后重读、锁内与锁外各自比对裁决标识（「同事撤回后又重新裁决」，用测试自己先拿住同一把锁来造出确定的先后）；
 * 裁决人不是本组织现有成员时写「本组织以外的人」；没有采购方时撤回 422；槽里待确认条数按记录数；各种身份与请求形状。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-import-leads/__tests__/alias-decisions-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；外部请求一律被替换成计数后报错的假函数（不出站）。
 */
import type { Prisma } from "@prisma/client";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-3c 别名裁决与撤回 DB 对抗用例（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-3c alias decisions DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let outbound = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
    if (!/^https?:\/\/localhost/.test(url)) { outbound += 1; throw new Error(`blocked outbound in test: ${url}`); }
    return realFetch(input as RequestInfo);
  }) as typeof fetch;

  const saved = { t4: process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY, leads: process.env.TENDER_IMPORT_LEADS_ENABLED, allow: process.env.TENDER_IMPORT_LEADS_ORG_ALLOWLIST };
  process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";
  process.env.TENDER_IMPORT_LEADS_ENABLED = "1";
  delete process.env.TENDER_IMPORT_LEADS_ORG_ALLOWLIST;

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { normalizeBuyerName } = await import("@/lib/corporate-memory/normalize");
  const { normalizeVendorName } = await import("@/lib/tender-intel/awards");
  const { IMPORT_LEAD_ALIAS_AUDIT_ACTION: DEC, IMPORT_LEAD_ALIAS_REVOKE_AUDIT_ACTION: REV } = await import("../alias-decisions");
  const { slotSummaryZh, rejectedPairsSummaryZh } = await import("../aggregate-pure");
  const svc = await import("../service");
  const leadsRoute = await import("@/app/api/projects/[id]/tender-intel/import-leads/route");
  const aliasesRoute = await import("@/app/api/projects/[id]/tender-intel/import-leads/aliases/route");
  const revokeRoute = await import("@/app/api/projects/[id]/tender-intel/import-leads/aliases/revoke/route");
  type View = import("../aggregate-pure").ImportLeadsView;

  const CONFLICT = "同事已经撤回或改过这一对的裁决，页面已更新；请看清现在的结论再操作。";
  const DECIDE_CONFLICT = "同事已经处理过这一对，页面已更新。";

  console.log("CHAIN-3c alias decisions — isolated DB");
  const stamp = Date.now().toString(36);
  const ADMIN = `adv_admin_${stamp}`, POWNER = `adv_powner_${stamp}`, VIEWER = `adv_viewer_${stamp}`, OP = `adv_op_${stamp}`, INACT = `adv_inact_${stamp}`, ADMIN2 = `adv_admin2_${stamp}`, SUPER = `adv_super_${stamp}`, FORMER = `adv_former_${stamp}`;
  const ORG = `adv_org_${stamp}`, ORG2 = `adv_org2_${stamp}`;
  const USERS = [ADMIN, POWNER, VIEWER, OP, INACT, ADMIN2, SUPER, FORMER];
  const email = (id: string) => `${id}@fixture.test`;
  for (const id of USERS) await db.user.create({ data: { id, email: email(id), name: `N ${id}`, role: id === SUPER ? "super_admin" : "user" } });
  await db.organization.create({ data: { id: ORG, name: "Adv Org", code: `adv-${stamp}`, ownerId: ADMIN } });
  await db.organization.create({ data: { id: ORG2, name: "Adv Org2", code: `adv2-${stamp}`, ownerId: ADMIN2 } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: POWNER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: VIEWER, role: "org_viewer", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OP, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: INACT, role: "org_admin", status: "inactive" } });
  // FORMER：本组织的组织管理员（裁决之后被移出），同时是别的组织的现有成员
  await db.organizationMember.create({ data: { orgId: ORG, userId: FORMER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: ADMIN2, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: FORMER, role: "org_member", status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(org: string, ownerId: string, buyer: string | null) {
    seq += 1;
    const id = `adv_proj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Adv ${stamp}-${seq}`, orgId: org, ownerId, workDomain: "tender", intakeStatus: "dispatched", clientOrganization: buyer } });
    return id;
  }
  let aseq = 0;
  async function mkAward(org: string, buyer: string, winner: string) {
    aseq += 1;
    const rec = await db.awardRecord.create({ data: { orgId: org, buyerNameRaw: buyer, buyerNameNormalized: normalizeBuyerName(buyer), projectId: null, winnerName: winner, winnerNameNormalized: normalizeVendorName(winner), contractAmount: 1000, currency: "CAD", scopeSummary: "Bedding", awardDate: new Date("2025-03-01T00:00:00Z"), confidence: "HIGH", verificationStatus: "HUMAN_CONFIRMED", status: "ACTIVE", createdByType: "user", createdById: ADMIN } });
    await db.awardRecordSource.create({ data: { orgId: org, awardRecordId: rec.id, sourceType: "USER_ENTRY", sourceKey: `adv:${stamp}-${aseq}`, capturedAt: new Date("2025-03-02T00:00:00Z"), createdById: ADMIN } });
  }
  const cookie = async (id: string) => `qy_session=${await createSession({ sub: id, email: email(id), role: id === SUPER ? "super_admin" : "user" })}`;
  const base = (p: string) => `http://localhost/api/projects/${p}/tender-intel/import-leads`;
  const post = (url: string, body: unknown, who: string) => new NextRequest(url, { method: "POST", headers: { cookie: who, "content-type": "application/json" }, body: JSON.stringify(body) });
  const get = async (p: string, who: string) => {
    const res = await leadsRoute.GET(new NextRequest(base(p), { headers: { cookie: who } }), { params: Promise.resolve({ id: p }) });
    return { status: res.status, json: (await res.json()) as View & { error?: string } };
  };
  const doImport = async (p: string, text: string, who: string) => {
    const res = await leadsRoute.POST(post(base(p), { text }, who), { params: Promise.resolve({ id: p }) });
    return { status: res.status, json: (await res.json()) as { view?: View; error?: string } };
  };
  const decide = async (p: string, body: unknown, who: string) => {
    const res = await aliasesRoute.POST(post(`${base(p)}/aliases`, body, who), { params: Promise.resolve({ id: p }) });
    return { status: res.status, json: (await res.json()) as { view?: View; error?: string; code?: string } };
  };
  const revoke = async (p: string, body: unknown, who: string) => {
    const res = await revokeRoute.POST(post(`${base(p)}/aliases/revoke`, body, who), { params: Promise.resolve({ id: p }) });
    return { status: res.status, json: (await res.json()) as { view?: View; error?: string; code?: string; revokedDecision?: string } };
  };
  const aliasRows = (org: string, action?: string) => db.auditLog.count({ where: { orgId: org, action: action ? action : { in: [DEC, REV] } } });
  const rowsOf = (org: string, pairKey: string, action: string) => db.auditLog.findMany({ where: { orgId: org, action, targetId: svc.aliasTargetId(pairKey) }, orderBy: { createdAt: "asc" } });
  const effective = async (p: string, who: string, pairKey: string) => (await get(p, who)).json.decidedPairs.filter((d) => d.pairKey === pairKey);

  /**
   * 测试先在自己的事务里拿住某一对的那把锁，发出请求，等它在锁上排队（它的锁外判定已经做完）；
   * 再在锁里以「同事」身份写入 `whileHeld` 的那几行，提交、放锁，最后拿到请求的结果。
   */
  const lockKey = (org: string, pairKey: string) => `import-lead-alias:${org}:${svc.aliasTargetId(pairKey)}`;
  const holdLock = async <T>(org: string, pairKey: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey(org, pairKey)}))) AS l`;
      return fn(tx);
    }, { maxWait: 10_000, timeout: 30_000 });
  async function withPairLockHeld<T>(org: string, pairKey: string, fire: () => Promise<T>, whileHeld: (tx: Prisma.TransactionClient, waited: boolean) => Promise<void>): Promise<{ result: T; waited: boolean }> {
    const box: { pending?: Promise<T>; waited: boolean } = { waited: false };
    await holdLock(org, pairKey, async (tx) => {
      box.pending = fire();
      for (let i = 0; i < 100 && !box.waited; i++) {
        const rows = await db.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
        if ((rows[0]?.n ?? 0) > 0) box.waited = true;
        else await sleep(50);
      }
      await whileHeld(tx, box.waited);
    });
    return { result: await box.pending!, waited: box.waited };
  }

  try {
    const admin = await cookie(ADMIN), powner = await cookie(POWNER), viewer = await cookie(VIEWER), op = await cookie(OP), inact = await cookie(INACT), admin2 = await cookie(ADMIN2), sup = await cookie(SUPER), former = await cookie(FORMER);
    const BUYER = "Town of Adversarial Fixture";
    const W1 = "Alpha Linen Supply Inc.", W2 = "Alpha Linen Supply Wholesale", W3 = "Beta Tents Inc.";
    for (const w of [W1, W2, W3]) { await mkAward(ORG, BUYER, w); await mkAward(ORG2, BUYER, w); }
    const pA = await mkProject(ORG, POWNER, BUYER); // 项目负责人是 org_member
    const pA2 = await mkProject(ORG, ADMIN, BUYER);
    const pB = await mkProject(ORG2, ADMIN2, BUYER);
    for (const p of [pA, pA2]) {
      await db.projectMember.create({ data: { projectId: p, userId: VIEWER, role: "viewer", status: "active" } });
      await db.projectMember.create({ data: { projectId: p, userId: OP, role: "project_admin", status: "active" } });
      await db.projectMember.create({ data: { projectId: p, userId: INACT, role: "viewer", status: "active" } });
    }
    const CSV = ["Importer,Exporter,URL", "Alpha Linen Supply,Ningbo A Co,https://example.test/a/1", "Alpha Linen Supply,Ningbo B Co,https://example.test/a/2", "Beta Tents,Fuzhou T Co,https://example.test/a/3"].join("\n");

    // —— 1. 导入；一条记录同时涉及两对；待确认条数按记录数 ——
    const ia = await doImport(pA, CSV, powner);
    ok(ia.status === 200 && ia.json.view?.suggestions.length === 3 && ia.json.view.canDecideAliases === false && ia.json.view.canEdit === true, "项目负责人（org_member）能导入；canDecideAliases 为 false；三对待确认", ia.json.view && { s: ia.json.view.suggestions.map((s) => [s.importerName, s.winnerName, s.recordCount]), c: ia.json.view.canDecideAliases });
    const ib = await doImport(pB, CSV, admin2);
    ok(ib.status === 200 && ib.json.view?.suggestions.length === 3, "别的组织同采购方的项目导入同一批：三对待确认");
    const sug = ia.json.view!.suggestions;
    const k1 = sug.find((s) => s.winnerName === W1)!.pairKey, k2 = sug.find((s) => s.winnerName === W2)!.pairKey, k3 = sug.find((s) => s.winnerName === W3)!.pairKey;
    ok(sug.find((s) => s.pairKey === k1)?.recordCount === 2 && sug.find((s) => s.pairKey === k2)?.recordCount === 2, "一条记录（Alpha Linen Supply）同时涉及两对");
    ok(ia.json.view!.storedLeadCount === 3 && ia.json.view!.pendingLeadCount === 3 && slotSummaryZh(ia.json.view!) === "已导入 3 条进口记录，都在等组织管理员确认是不是同一家（打开进口线索查看）。", "待确认条数按记录数：3 条（不是各对条数相加的 5），槽里「都在等」", { stored: ia.json.view!.storedLeadCount, pending: ia.json.view!.pendingLeadCount });

    // —— 2. 权限：各种不是组织管理员的身份 ——
    const r0 = await aliasRows(ORG);
    const nonAdmins: Array<[string, string, number]> = [["项目负责人（org_member）", powner, 403], ["项目管理员（org_member）", op, 403], ["org_viewer + 项目 viewer", viewer, 403], ["已停用的 org_admin + 项目成员", inact, 404], ["别的组织的管理员", admin2, 404]];
    for (const [label, who, exp] of nonAdmins) {
      const d = await decide(pA, { pairKey: k1, decision: "CONFIRMED" }, who);
      const r = await revoke(pA, { pairKey: k1, decisionId: "x", reason: "r" }, who);
      ok(d.status === exp && r.status === exp, `${label}：裁决 ${exp}、撤回 ${exp}`, [d.status, r.status, d.json.error]);
    }
    ok((await revoke(pA, {}, powner)).status === 403, "不是组织管理员、请求体为空：403（权限在请求完整之前）");
    ok((await aliasRows(ORG)) === r0, "不是组织管理员的各种调用：没有写审计行");

    // —— 3. 两对否决（一条记录涉及两对）：单独计数与槽里那一行按实际待确认的条数说 ——
    ok((await decide(pA, { pairKey: k1, decision: "REJECTED" }, admin)).status === 200 && (await decide(pA, { pairKey: k2, decision: "REJECTED" }, admin)).status === 200, "组织管理员否决 k1、k2");
    const v = (await get(pA, admin)).json;
    const rejPairs = v.decidedPairs.filter((d) => d.decision === "REJECTED");
    ok(rejPairs.length === 2 && v.rejectedPairRecordCount === 2 && rejPairs.reduce((a, d) => a + d.recordCount, 0) === 4, "已标为不是同一家 2 对、涉及 2 条（去重；各对条数相加是 4）", { n: rejPairs.length, m: v.rejectedPairRecordCount });
    ok(v.storedLeadCount === 3 && v.pendingLeadCount === 1 && v.suggestions.length === 1 && slotSummaryZh(v) === "已导入 3 条进口记录，其中 1 条在等组织管理员确认是不是同一家（打开进口线索查看）。" && rejectedPairsSummaryZh(v) === "已标为不是同一家 2 对（涉及 2 条进口记录）", "槽里：其中 1 条在等（不说「都在等」），与「另有 1 对」「已标为不是同一家 2 对」不矛盾", [slotSummaryZh(v), rejectedPairsSummaryZh(v), v.pendingLeadCount]);

    // —— 4. 两个组织同一对互不影响（读裁决按组织过滤） ——
    const vb = (await get(pB, admin2)).json;
    ok(vb.suggestions.length === 3 && vb.decidedPairs.length === 0 && vb.rejectedPairRecordCount === 0 && vb.pendingLeadCount === 3, "别的组织的同一对不受本组织否决影响：仍是三对待确认、没有已裁决的", { s: vb.suggestions.length, d: vb.decidedPairs.length });
    const dk1 = v.decidedPairs.find((d) => d.pairKey === k1)!;
    const xr = await revoke(pB, { pairKey: k1, decisionId: dk1.decisionId, reason: "跨组织" }, admin2);
    ok(xr.status === 409 && (await aliasRows(ORG2)) === 0, "别的组织的管理员在自己的项目里拿本组织的裁决标识撤回：409，不写", xr);
    ok((await effective(pA, admin, k1)).some((d) => d.decisionId === dk1.decisionId), "本组织的裁决仍有效");
    const b1 = await decide(pB, { pairKey: k1, decision: "CONFIRMED" }, admin2);
    const aK1 = await effective(pA, admin, k1);
    ok(b1.status === 200 && aK1.length === 1 && aK1[0].decision === "REJECTED" && aK1[0].decisionId === dk1.decisionId && !(await get(pA, admin)).json.exporters.some((e) => e.exporterName === "Ningbo A Co"), "别的组织确认同一对（更晚）：本组织仍是否决、记录不进汇总", { b1: b1.status, aK1 });

    // —— 5. 撤回标识与请求的各种错 ——
    const orgTwoRow = await db.auditLog.findFirst({ where: { orgId: ORG2, action: DEC } });
    for (const [label, id] of [["别的组织那条裁决的标识", orgTwoRow!.id], ["不存在的标识", "c_nonexistent"], ["空白标识", " "]] as const) {
      const r = await revoke(pA, { pairKey: k1, decisionId: id, reason: "x" }, admin);
      ok(r.status === 409 && r.json.error === CONFLICT, `撤回带${label}：409`, r.status);
    }
    ok((await revoke(pA, { pairKey: k1, decisionId: dk1.decisionId, reason: 123 }, admin)).status === 400, "原因不是字符串：400");
    ok((await revoke(pA, { pairKey: k1, decisionId: 5, reason: "x" }, admin)).status === 400, "裁决标识不是字符串：400");

    // —— 6. 并发撤回同一条：只成功一个 ——
    const before6 = await aliasRows(ORG);
    const conc = await Promise.all(Array.from({ length: 6 }, (_, i) => revoke(pA, { pairKey: k1, decisionId: dk1.decisionId, reason: `并发 ${i}` }, i % 2 ? sup : admin)));
    const st = conc.map((c) => c.status).sort();
    ok(st.filter((s) => s === 200).length === 1 && st.filter((s) => s === 409).length === 5 && (await rowsOf(ORG, k1, REV)).length === 1 && (await aliasRows(ORG)) === before6 + 1, "6 个并发撤回同一条：1 个 200、5 个 409、只多 1 行撤回", st);
    ok((await aliasRows(ORG2, REV)) === 0 && (await effective(pB, admin2, k1)).some((d) => d.decision === "CONFIRMED"), "本组织撤回不影响别的组织对同一对的确认");

    // —— 7. 并发裁决同一对：只成功一个 ——
    const cd = await Promise.all([decide(pA, { pairKey: k1, decision: "CONFIRMED" }, admin), decide(pA, { pairKey: k1, decision: "REJECTED" }, sup), decide(pA, { pairKey: k1, decision: "CONFIRMED" }, admin)]);
    const cds = cd.map((c) => c.status).sort();
    const effK1 = await effective(pA, admin, k1);
    ok(cds.filter((s) => s === 200).length === 1 && cds.filter((s) => s === 409).length === 2 && effK1.length === 1 && (await rowsOf(ORG, k1, DEC)).length === 2, "3 个并发裁决：1 个 200、2 个 409、只多 1 行裁决", { cds, effK1 });

    // —— 8. 锁内重读并比对标识：请求的锁外判定已通过，等锁期间同事撤回又重新裁决 → 409、不写 ——
    {
      const cur = effK1[0];
      const decRow = (await rowsOf(ORG, k1, DEC)).find((r) => r.id === cur.decisionId)!;
      const prev = JSON.parse(decRow.afterData ?? "{}") as Record<string, unknown>;
      let colleagueDecisionId = "";
      const { result, waited } = await withPairLockHeld(ORG, k1, () => revoke(pA, { pairKey: k1, decisionId: cur.decisionId, reason: "锁内重读" }, admin), async (tx, w) => {
        if (!w) return;
        const at = new Date().toISOString();
        await tx.auditLog.create({ data: { userId: SUPER, orgId: ORG, projectId: pA, action: REV, targetType: "import_lead_alias", targetId: svc.aliasTargetId(k1), beforeData: decRow.afterData, afterData: JSON.stringify({ pairKey: k1, revokedAuditId: cur.decisionId, revokedBy: SUPER, revokedAt: at, reason: "同事撤回" }) } });
        const row = await tx.auditLog.create({ data: { userId: SUPER, orgId: ORG, projectId: pA, action: DEC, targetType: "import_lead_alias", targetId: svc.aliasTargetId(k1), afterData: JSON.stringify({ ...prev, decision: prev.decision === "CONFIRMED" ? "REJECTED" : "CONFIRMED", decidedBy: SUPER, decidedAt: at }) } });
        colleagueDecisionId = row.id;
      });
      const revs = await rowsOf(ORG, k1, REV);
      const pointsTo = (id: string) => revs.filter((r) => (JSON.parse(r.afterData ?? "{}") as { revokedAuditId?: string }).revokedAuditId === id).length;
      const now8 = await effective(pA, admin, k1);
      ok(waited && result.status === 409 && result.json.error === CONFLICT && revs.length === 2 && pointsTo(cur.decisionId) === 1 && pointsTo(colleagueDecisionId) === 0 && now8.length === 1 && now8[0].decisionId === colleagueDecisionId, "等锁期间同事撤回又重新裁决：锁内重读、标识对不上 → 409，没有撤掉同事的新裁决", { waited, status: result.status, revs: revs.length, now8 });
    }

    // —— 9. 锁外先比对标识：拿旧标识撤回时不去排队等锁，锁被占着也直接 409 ——
    {
      const stale = (await rowsOf(ORG, k1, DEC))[0].id; // 已被撤回的那条
      const before9 = await aliasRows(ORG);
      const box: { pending?: Promise<Awaited<ReturnType<typeof revoke>>> } = {};
      const raced = await holdLock(ORG, k1, async () => {
        box.pending = revoke(pA, { pairKey: k1, decisionId: stale, reason: "旧标识" }, admin);
        return Promise.race([box.pending.then((r) => r.status), sleep(4000).then(() => "TIMEOUT" as const)]);
      });
      const final9 = await box.pending!;
      ok(raced === 409 && final9.json.error === CONFLICT && (await aliasRows(ORG)) === before9, "拿旧标识撤回：锁被占着时也立即 409（锁外先比对，不排队），不写", { raced, status: final9.status });
    }

    // —— 10. 裁决也在锁内重读：等锁期间同事已裁决 → 409、只有同事那一行 ——
    {
      const cur = (await effective(pA, admin, k1))[0];
      ok((await revoke(pA, { pairKey: k1, decisionId: cur.decisionId, reason: "让它回到待确认" }, admin)).status === 200 && (await get(pA, admin)).json.suggestions.some((s) => s.pairKey === k1), "撤回同事的新裁决：回到待确认");
      const decBefore = (await rowsOf(ORG, k1, DEC)).length;
      const sample = JSON.parse((await rowsOf(ORG, k1, DEC))[0].afterData ?? "{}") as Record<string, unknown>;
      let colleague = "";
      const { result, waited } = await withPairLockHeld(ORG, k1, () => decide(pA, { pairKey: k1, decision: "CONFIRMED" }, admin), async (tx, w) => {
        if (!w) return;
        const row = await tx.auditLog.create({ data: { userId: SUPER, orgId: ORG, projectId: pA, action: DEC, targetType: "import_lead_alias", targetId: svc.aliasTargetId(k1), afterData: JSON.stringify({ ...sample, decision: "REJECTED", decidedBy: SUPER, decidedAt: new Date().toISOString() }) } });
        colleague = row.id;
      });
      const now10 = await effective(pA, admin, k1);
      ok(waited && result.status === 409 && result.json.error === DECIDE_CONFLICT && (await rowsOf(ORG, k1, DEC)).length === decBefore + 1 && now10.length === 1 && now10[0].decisionId === colleague && now10[0].decision === "REJECTED", "等锁期间同事已裁决：锁内重读 → 409，只多同事那一行", { waited, status: result.status, now10 });
    }

    // —— 11. 两个管理员同时撤回同一条；同组织另一个项目随之回到待确认 ——
    {
      const cur = (await effective(pA, admin, k1))[0];
      const mix = await Promise.all([revoke(pA, { pairKey: k1, decisionId: cur.decisionId, reason: "交错" }, admin), revoke(pA, { pairKey: k1, decisionId: cur.decisionId, reason: "交错 2" }, sup)]);
      ok(mix.map((m) => m.status).sort().join() === "200,409", "两个管理员同时撤回同一条：一个成功、一个 409", mix.map((m) => m.status));
      const imp2 = await doImport(pA2, "Importer,Exporter,URL\nAlpha Linen Supply,Dalian X Co,https://example.test/a2/1\n", admin);
      ok(imp2.json.view?.suggestions.some((s) => s.pairKey === k1) === true, "同组织另一个项目：撤回后这一对重新待确认");
    }

    // —— 12. 裁决人不是本组织现有成员（已被移出、但是别的组织的现有成员）：写「本组织以外的人」 ——
    {
      const f = await decide(pA, { pairKey: k3, decision: "CONFIRMED" }, former);
      const named = f.json.view?.decidedPairs.find((d) => d.pairKey === k3)?.deciderName;
      await db.organizationMember.update({ where: { orgId_userId: { orgId: ORG, userId: FORMER } }, data: { status: "inactive" } });
      const after = (await get(pA, admin)).json.decidedPairs.find((d) => d.pairKey === k3);
      const vals: string[] = [];
      const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") Object.values(x).forEach(walk); else if (typeof x === "string") vals.push(x); };
      walk((await get(pA, admin)).json);
      ok(f.status === 200 && named === `N ${FORMER}` && after?.deciderName === "本组织以外的人" && !vals.some((s) => s.includes(FORMER)), "裁决人被移出本组织（仍是别的组织的成员）：写「本组织以外的人」，不带名字与用户 id", { named, after: after?.deciderName });
      const s = await decide(pA, { pairKey: k1, decision: "CONFIRMED" }, sup);
      ok(s.status === 200 && s.json.view?.decidedPairs.find((d) => d.pairKey === k1)?.deciderName === "本组织以外的人", "平台超级管理员（不是本组织成员）裁决：写「本组织以外的人」");
    }

    // —— 13. 没有采购方：撤回 422（与导入同一判定），不写 ——
    {
      const pNoBuyer = await mkProject(ORG, ADMIN, null);
      const before = await aliasRows(ORG);
      const r = await revoke(pNoBuyer, { pairKey: k1, decisionId: "x", reason: "x" }, admin);
      ok(r.status === 422 && r.json.error === "项目没有采购方名称，没法找历史中标者。" && (await aliasRows(ORG)) === before, "项目没有采购方：撤回 422（中标者那句说明），不写", r);
    }

    // —— 14. 开关与白名单；原因 200 字 ——
    process.env.TENDER_IMPORT_LEADS_ORG_ALLOWLIST = ORG2;
    const g = await get(pA, admin), d404 = await decide(pA, { pairKey: k2, decision: "CONFIRMED" }, admin), r404 = await revoke(pA, { pairKey: k2, decisionId: "x", reason: "x" }, admin);
    delete process.env.TENDER_IMPORT_LEADS_ORG_ALLOWLIST;
    ok(g.status === 404 && d404.status === 404 && r404.status === 404, "白名单不含本组织：读、裁决、撤回都 404", [g.status, d404.status, r404.status]);
    process.env.TENDER_IMPORT_LEADS_ENABLED = "0";
    const sr = await revoke(pA, { pairKey: k2, decisionId: "x", reason: "x" }, sup);
    process.env.TENDER_IMPORT_LEADS_ENABLED = "1";
    ok(sr.status === 404, "开关关：平台超级管理员撤回也 404", sr.status);
    const dk2 = (await effective(pA, admin, k2))[0];
    const long = await revoke(pA, { pairKey: k2, decisionId: dk2.decisionId, reason: "错".repeat(200) }, admin);
    const last = (await rowsOf(ORG, k2, REV)).pop();
    ok(long.status === 200 && (JSON.parse(last?.afterData ?? "{}") as { reason?: string }).reason === "错".repeat(200), "原因 200 个汉字：通过，原样写入", long.status);

    ok(outbound === 0, "整个过程外部请求 0 次", outbound);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, val] of [["T4_AWARD_INTELLIGENCE_SCHEMA_READY", saved.t4], ["TENDER_IMPORT_LEADS_ENABLED", saved.leads], ["TENDER_IMPORT_LEADS_ORG_ALLOWLIST", saved.allow]] as const) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG2] } }, { userId: { in: USERS } }, { projectId: { in: projectIds } }] } });
    await db.awardRecordSource.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.awardRecord.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.user.deleteMany({ where: { id: { in: USERS } } });
    await db.$disconnect();
  }
  console.log(`CHAIN-3c alias decisions DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
