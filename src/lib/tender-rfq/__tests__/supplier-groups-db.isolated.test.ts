/**
 * RFQ-AUTO-5 供应商分组——真实 DB（隔离库），保存经真实路由处理函数
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-rfq/__tests__/supplier-groups-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 供应商）。
 * 整个测试不批准任何卡，也没有任何发送器被调用。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 RFQ-AUTO-5 供应商分组 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "RFQ-AUTO-5 supplier groups DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type GroupIn = { name: string; supplierIds: string[]; keywords?: string[] };
type EntryGroups = { groups: Array<{ name: string; supplierIds: string[]; keywords: string[]; readyCount: number }>; match: { kind: string; group?: string; keyword?: string; groups?: string[] }; version: string | null };
type PutBody = { ok?: boolean; changed?: boolean; errorCode?: string; error?: string; supplierGroups?: EntryGroups };

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { maybeAutoDraftRfq } = await import("../auto-draft-service");
  const { AUTO_DRAFT_AUDIT_ACTION } = await import("../auto-draft-pure");
  const { prepareRfqRound } = await import("../service");
  const { SUPPLIER_GROUPS_AUDIT_ACTION, groupPreselection } = await import("../supplier-groups");
  const { loadRfqWebEntry } = await import("../web-entry");
  const { TENDER_SEND_RFQ_TYPE } = await import("../types");
  const groupsRoute = await import("@/app/api/projects/[id]/tender-rfq/supplier-groups/route");

  console.log("RFQ-AUTO-5 supplier groups — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `sgowner_${stamp}`, OTHER = `sgother_${stamp}`, MEMBER = `sgmember_${stamp}`, OUTSIDER = `sgout_${stamp}`;
  const ORG = `sgorg_${stamp}`, ORG2 = `sgorg2_${stamp}`;
  const USERS = [OWNER, OTHER, MEMBER, OUTSIDER];
  const email = (id: string) => `${id}@fixture.test`;
  const MAILBOX = `mailbox_${stamp}@fixture.test`;
  const NOW = new Date("2026-11-12T12:00:00Z");
  // 组名特意起得不可能出现在询价邮件里，用来证明分组信息不出站
  const BLINDS = `窗饰组QX${stamp}`, FURN = `家具组QX${stamp}`, LIGHT = `灯具组QX${stamp}`;

  const groupsOn = () => { process.env.TENDER_RFQ_SUPPLIER_GROUPS_ENABLED = "1"; delete process.env.TENDER_RFQ_SUPPLIER_GROUPS_ORG_ALLOWLIST; };
  const groupsOff = () => { delete process.env.TENDER_RFQ_SUPPLIER_GROUPS_ENABLED; };
  process.env.TENDER_RFQ_AUTO_DRAFT_ENABLED = "1";
  delete process.env.TENDER_RFQ_AUTO_DRAFT_ORG_ALLOWLIST;
  delete process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED;

  // —— fixture ——
  for (const id of USERS) await db.user.create({ data: { id, email: email(id), name: id === OWNER ? "Fixture Owner" : `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `sg-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Fixture Other Org", code: `sg2-${stamp}`, ownerId: OUTSIDER } });
  for (const id of [OWNER, OTHER]) await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OUTSIDER, role: "org_admin", status: "active" } });
  await db.emailProvider.create({ data: { userId: OWNER, type: "gmail", accessToken: "fixture", accountEmail: MAILBOX, grantedScopes: "gmail.compose gmail.readonly" } });
  const mkSupplier = (n: string, o: { status?: string; contactEmail?: string | null; orgId?: string } = {}) =>
    db.supplier.create({ data: { orgId: o.orgId ?? ORG, name: `Fixture Supplier ${n} ${stamp}`, contactEmail: o.contactEmail === undefined ? `sales-${n.toLowerCase()}-${stamp}@supplier.test` : o.contactEmail, status: o.status ?? "active", createdById: OWNER } });
  const sA = await mkSupplier("A"), sB = await mkSupplier("B"), sC = await mkSupplier("C"), sD = await mkSupplier("D"), sZ = await mkSupplier("Z");
  const sI = await mkSupplier("I", { status: "inactive" });
  const sX = await mkSupplier("X", { orgId: ORG2 });
  // OWNER 的常用供应商：C、D；OTHER 的：Z。分组（稍后保存）：窗饰 = A、I（停用）、B；家具 = C；灯具 = I
  await db.organization.update({
    where: { id: ORG },
    data: {
      settingsJson: {
        tenderRfq: { fromName: "Fixture Purchasing", fromEmail: MAILBOX, mailboxEmail: MAILBOX },
        museBridge: {
          userPrefs: {
            [OWNER]: { defaultSupplierIds: [sC.id, sD.id], defaultIncoterm: "FOB", chaseAfterDays: null, lastUpdatedAt: null },
            [OTHER]: { defaultSupplierIds: [sZ.id], defaultIncoterm: null, chaseAfterDays: null, lastUpdatedAt: null },
          },
        },
      },
    },
  });
  const settingsBefore = JSON.stringify((await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } }))?.settingsJson);

  const projectIds: string[] = [];
  let seq = 0;
  /** 建一个投标项目（名字自定）+ 一份已批准的招标分析 + 两条已确认的要求 */
  async function mkProject(name: string) {
    seq += 1;
    const projectId = `sgproj_${stamp}_${seq}`;
    projectIds.push(projectId);
    await db.project.create({ data: { id: projectId, name, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", closeDate: new Date("2026-12-15T00:00:00Z") } });
    const run = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId, status: "APPROVED", idempotencyKey: `sg-${stamp}-${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    for (const i of [1, 2]) {
      await db.tenderExtractedRequirement.create({
        data: { projectId, analysisRunId: run.id, requirementCode: `R-00${i}`, category: "SAFETY", originalRequirement: `Fixture requirement ${i}: flame retardant certificate`, chineseTranslation: `示例要求 ${i}：阻燃证书`, mandatory: true, reviewStatus: "CONFIRMED" },
      });
    }
    return { projectId, runId: run.id };
  }
  const rounds = (projectId: string) => db.projectInquiry.findMany({ where: { projectId }, include: { items: true } });
  const cards = (projectId: string) => db.pendingAction.findMany({ where: { orgId: ORG, projectId, type: TENDER_SEND_RFQ_TYPE } });
  const draft = (p: { projectId: string; runId: string }, userId = OWNER) => maybeAutoDraftRfq({ orgId: ORG, projectId: p.projectId, runId: p.runId, userId, trigger: "approve_run", now: NOW });
  const entryOf = async (projectId: string, userId = OWNER) => {
    const e = await loadRfqWebEntry({ projectId, orgId: ORG, userId, now: NOW });
    if (!e.available) throw new Error("fixture: 入口不可用");
    return e;
  };
  const records = (userId: string) => db.auditLog.findMany({ where: { userId, action: SUPPLIER_GROUPS_AUDIT_ACTION }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const cookieOf = async (id: string) => `qy_session=${await createSession({ sub: id, email: email(id), role: "user" })}`;
  const put = async (projectId: string, body: unknown, cookie: string | null, raw = false) => {
    const res = await groupsRoute.PUT(
      new NextRequest(`http://localhost/api/projects/${projectId}/tender-rfq/supplier-groups`, { method: "PUT", headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" }, body: raw ? String(body) : JSON.stringify(body) }),
      { params: Promise.resolve({ id: projectId }) },
    );
    return { status: res.status, json: (await res.json().catch(() => null)) as PutBody | null };
  };

  try {
    const owner = await cookieOf(OWNER);
    const home = await mkProject(`Fixture Home ${stamp}`);
    const GROUPS: GroupIn[] = [
      { name: BLINDS, supplierIds: [sA.id, sI.id, sB.id], keywords: ["blind", "窗帘"] },
      { name: FURN, supplierIds: [sC.id], keywords: ["furniture"] },
    ];

    // —— 1. 功能关闭：没有分组 ——
    groupsOff();
    const offPut = await put(home.projectId, { baseVersion: null, groups: GROUPS }, owner);
    ok(offPut.status === 404 && offPut.json?.errorCode === "DISABLED" && (await records(OWNER)).length === 0, "功能关闭：保存返回 404，没有写入任何记录", offPut);
    ok(!("supplierGroups" in (await entryOf(home.projectId))), "功能关闭：入口响应里没有 supplierGroups");

    // —— 2. 功能开启、还没有分组：一切照旧 ——
    groupsOn();
    const empty = await entryOf(home.projectId);
    ok(empty.supplierGroups?.groups.length === 0 && empty.supplierGroups.version === null && empty.supplierGroups.match.kind === "none", "功能开启、还没有分组：入口给出空的分组、没有版本", empty.supplierGroups);
    ok(groupPreselection({ groups: empty.supplierGroups, suppliers: empty.suppliers, max: 8 }).selected.join() === [sC.id, sD.id].join(), "还没有分组：抽屉预选的仍是可选的常用供应商");
    const pNoGroups = await mkProject(`Window Blinds NoGroups ${stamp}`);
    const noGroups = await draft(pNoGroups);
    const noGroupsCard = (await cards(pNoGroups.projectId))[0];
    ok(noGroups?.drafted === true && (noGroupsCard?.payload as { items: Array<{ supplierId: string }> }).items.map((i) => i.supplierId).join() === [sC.id, sD.id].join() && (noGroupsCard.preview ?? "").includes("的常用供应商"), "还没有分组：自动起草照旧取常用供应商，摘要照旧", noGroups);

    // —— 3. 保存与读回 ——
    const saved = await put(home.projectId, { baseVersion: null, groups: GROUPS }, owner);
    const v1 = saved.json?.supplierGroups?.version ?? null;
    const recs1 = await records(OWNER);
    ok(saved.status === 200 && saved.json?.ok === true && saved.json.changed === true && typeof v1 === "string" && saved.json.supplierGroups?.groups.map((g) => g.name).join() === [BLINDS, FURN].join(), "保存成功：返回最新的分组与这一版的标识", saved);
    ok(recs1.length === 1 && recs1[0].id === v1 && recs1[0].orgId === ORG && recs1[0].targetId === OWNER && recs1[0].projectId === home.projectId && JSON.parse(recs1[0].afterData ?? "{}").groups.length === 2 && JSON.parse(recs1[0].beforeData ?? "{}").groups.length === 0, "留下一条记录：谁、哪个组织、保存前后的内容；记录的 id 就是版本", recs1.map((r) => ({ id: r.id, before: r.beforeData })));
    ok(JSON.stringify((await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } }))?.settingsJson) === settingsBefore, "保存没有动组织设置（常用供应商等原样）");
    const e1 = await entryOf(home.projectId);
    const g1 = e1.supplierGroups?.groups ?? [];
    ok(g1.length === 2 && g1[0].supplierIds.join() === [sA.id, sI.id, sB.id].join() && g1[0].readyCount === 2 && g1[1].readyCount === 1 && e1.supplierGroups?.version === v1, "重新读入口：分组还在；组里停用的那家仍列在组里，可选的是 2 家", g1);
    const inactiveRow = e1.suppliers.find((s) => s.id === sI.id);
    ok(inactiveRow?.ready === false && inactiveRow.blockedReason === "inactive" && inactiveRow.isDefault === false, "分组里停用的供应商出现在可选列表里，标明不可选", inactiveRow);
    ok(e1.suppliers.find((s) => s.id === sC.id)?.isDefault === true && e1.suppliers[0].id === sC.id, "常用供应商仍标为常用、排在前面");

    // —— 4. 抽屉预选（用入口的真实数据走纯函数） ——
    const pBlinds = await mkProject(`Supply and Install Window BLINDS ${stamp}`);
    const eBlinds = await entryOf(pBlinds.projectId);
    const preBlinds = groupPreselection({ groups: eBlinds.supplierGroups, suppliers: eBlinds.suppliers, max: 8 });
    ok(eBlinds.supplierGroups?.match.kind === "one" && eBlinds.supplierGroups.match.group === BLINDS && eBlinds.supplierGroups.match.keyword === "blind" && preBlinds.selected.join() === [sA.id, sB.id].join() && preBlinds.hint?.textZh.includes(`项目名称里有「blind」，对上了分组「${BLINDS}」，已按这一组勾选`) === true, "项目名称对上一组：预选这一组里可选的 2 家（按组内顺序），写明依据；常用供应商没有被勾", { match: eBlinds.supplierGroups?.match, pre: preBlinds });
    const preHome = groupPreselection({ groups: e1.supplierGroups, suppliers: e1.suppliers, max: 8 });
    ok(e1.supplierGroups?.match.kind === "none" && preHome.selected.length === 0 && preHome.hint?.tone === "undetermined", "项目名称对不上：不预先勾选任何供应商（有 2 家可选的常用供应商也不勾）", preHome);

    // —— 5. 内容不合规 / 别的组织的供应商：整体拒绝，库里不变 ——
    const tooMany = await put(home.projectId, { baseVersion: v1, groups: Array.from({ length: 11 }, (_, i) => ({ name: `组${i}`, supplierIds: [sA.id], keywords: [] })) }, owner);
    const nine = await put(home.projectId, { baseVersion: v1, groups: [{ name: "大组", supplierIds: [sA.id, sB.id, sC.id, sD.id, sZ.id, sI.id, "x1", "x2", "x3"], keywords: [] }] }, owner);
    const dupName = await put(home.projectId, { baseVersion: v1, groups: [{ name: "Blinds", supplierIds: [sA.id] }, { name: "blinds", supplierIds: [sB.id] }] }, owner);
    const shortKw = await put(home.projectId, { baseVersion: v1, groups: [{ name: "窗饰", supplierIds: [sA.id], keywords: ["ab"] }] }, owner);
    ok([tooMany, nine, dupName, shortKw].every((r) => r.status === 400 && r.json?.errorCode === "INVALID" && (r.json.error ?? "").length > 0), "内容不合规（11 组 / 一组 9 家 / 同名 / 关键词太短）：400 并说明原因", [tooMany, nine, dupName, shortKw].map((r) => r.json?.error));
    const foreign = await put(home.projectId, { baseVersion: v1, groups: [...GROUPS, { name: "外来", supplierIds: [sA.id, sX.id], keywords: [] }] }, owner);
    ok(foreign.status === 400 && foreign.json?.errorCode === "FOREIGN_SUPPLIER", "混入别的组织的供应商：整体拒绝", foreign);
    const ghost = await put(home.projectId, { baseVersion: v1, groups: [...GROUPS, { name: "不存在", supplierIds: ["no-such-supplier"], keywords: [] }] }, owner);
    ok(ghost.status === 400 && ghost.json?.errorCode === "FOREIGN_SUPPLIER", "不存在的供应商号：整体拒绝", ghost);
    const badBody = await put(home.projectId, { baseVersion: v1, groups: GROUPS, userId: OTHER }, owner);
    const noBase = await put(home.projectId, { groups: GROUPS }, owner);
    const notJson = await put(home.projectId, "<html>", owner, true);
    ok([badBody, noBase, notJson].every((r) => r.status === 400), "请求体多了字段（想指定别的用户）/ 缺版本 / 不是 JSON：400", [badBody.status, noBase.status, notJson.status]);
    ok((await records(OWNER)).length === 1 && (await entryOf(home.projectId)).supplierGroups?.version === v1, "以上被拒的请求都没有写入：仍是第一版");

    // —— 6. 权限：只能保存本人的；别人、外人、没登录的都被拒 ——
    const asMember = await put(home.projectId, { baseVersion: null, groups: GROUPS }, await cookieOf(MEMBER));
    const asOutsider = await put(home.projectId, { baseVersion: null, groups: [{ name: "外人", supplierIds: [sX.id], keywords: [] }] }, await cookieOf(OUTSIDER));
    const anonymous = await put(home.projectId, { baseVersion: null, groups: GROUPS }, null);
    ok(asMember.status === 403 && [403, 404].includes(asOutsider.status) && anonymous.status === 401, "对项目没有写权限的本组织成员 403、不是本组织的人被拒、没登录 401", [asMember.status, asOutsider.status, anonymous.status]);
    ok((await records(MEMBER)).length === 0 && (await records(OUTSIDER)).length === 0, "被拒的人没有留下任何分组记录");
    const eOther = await entryOf(pBlinds.projectId, OTHER);
    ok(eOther.supplierGroups?.groups.length === 0 && eOther.supplierGroups.version === null && groupPreselection({ groups: eOther.supplierGroups, suppliers: eOther.suppliers, max: 8 }).selected.join() === sZ.id, "别人的分组读不到也用不到：同组织另一位成员的入口里分组为空，预选仍是他自己的常用供应商", eOther.supplierGroups);

    // —— 7. 版本：不互相覆盖 ——
    const stale = await put(home.projectId, { baseVersion: null, groups: [{ name: "旧页面", supplierIds: [sZ.id], keywords: [] }] }, owner);
    ok(stale.status === 409 && stale.json?.errorCode === "VERSION_CONFLICT" && stale.json.supplierGroups?.version === v1 && stale.json.supplierGroups.groups.map((g) => g.name).join() === [BLINDS, FURN].join() && (await records(OWNER)).length === 1, "基于旧版的保存：409，带回最新的分组，先保存的内容还在", stale);
    const same = await put(home.projectId, { baseVersion: v1, groups: GROUPS }, owner);
    ok(same.status === 200 && same.json?.changed === false && same.json.supplierGroups?.version === v1 && (await records(OWNER)).length === 1, "内容没有变化的保存：成功但不多写一条记录", same);
    const WITH_LIGHT: GroupIn[] = [...GROUPS, { name: LIGHT, supplierIds: [sI.id], keywords: ["lighting"] }];
    const [raceA, raceB] = await Promise.all([
      put(home.projectId, { baseVersion: v1, groups: WITH_LIGHT }, owner),
      put(home.projectId, { baseVersion: v1, groups: [...GROUPS, { name: "并发的另一份", supplierIds: [sZ.id], keywords: [] }] }, owner),
    ]);
    const raceStatuses = [raceA.status, raceB.status].sort().join();
    ok(raceStatuses === "200,409" && (await records(OWNER)).length === 2, "基于同一版的两个保存同时到达：一个成功、一个 409，库里只多一条记录", { raceStatuses, n: (await records(OWNER)).length });
    // 让后面的用例有确定的内容：不论刚才谁赢，都落到 WITH_LIGHT
    const vRace = (await entryOf(home.projectId)).supplierGroups?.version ?? null;
    const settle = await put(home.projectId, { baseVersion: vRace, groups: WITH_LIGHT }, owner);
    const v2 = settle.json?.supplierGroups?.version ?? null;
    ok(settle.status === 200 && typeof v2 === "string" && v2 !== v1 && settle.json?.supplierGroups?.groups.length === 3, "在最新的一版上继续保存：成功，版本前进", settle);
    const latest = await records(OWNER);
    ok(JSON.parse(latest[latest.length - 1].beforeData ?? "{}").version === (settle.json?.changed ? vRace : v1) && latest.every((r) => r.userId === OWNER && r.orgId === ORG), "每条记录都记在本人与本组织名下，并记着保存前是哪一版");

    // —— 8. 自动起草：有分组时只认分组 ——
    const dBlinds = await draft(pBlinds);
    const cardBlinds = (await cards(pBlinds.projectId))[0];
    const payloadBlinds = cardBlinds?.payload as { items: Array<{ supplierId: string; to: string; subject: string; body: string }> };
    ok(dBlinds?.drafted === true && dBlinds.supplierCount === 2 && dBlinds.skippedCount === 1 && payloadBlinds.items.map((i) => i.supplierId).join() === [sA.id, sB.id].join(), "项目名称对上「窗饰」：起草给这一组里可选的 2 家，顺序与组内一致；常用供应商（C、D）不在收件人里", { dBlinds, to: payloadBlinds?.items.map((i) => i.to) });
    ok(dBlinds?.drafted === true && dBlinds.messageZh.includes(`分组「${BLINDS}」`) && dBlinds.messageZh.includes("blind") && (cardBlinds.preview ?? "").includes(`Fixture Owner 的分组「${BLINDS}」（项目名称里有「blind」）`) && !(cardBlinds.preview ?? "").includes("常用供应商"), "结果与卡的摘要都写明用的是谁的哪一组、凭哪个关键词", { msg: dBlinds?.drafted ? dBlinds.messageZh : null, preview: cardBlinds?.preview });
    const roundBlinds = (await rounds(pBlinds.projectId))[0];
    const auditBlinds = await db.auditLog.findMany({ where: { orgId: ORG, action: AUTO_DRAFT_AUDIT_ACTION, targetId: roundBlinds.id } });
    const ab = JSON.parse(auditBlinds[0]?.afterData ?? "{}") as { supplierSource?: string; supplierGroup?: { name?: string; matchedKeyword?: string; version?: string }; skipped?: Array<{ reason: string }> };
    ok(auditBlinds.length === 1 && ab.supplierSource === "operator_supplier_group" && ab.supplierGroup?.name === BLINDS && ab.supplierGroup.matchedKeyword === "blind" && ab.supplierGroup.version === v2 && ab.skipped?.[0]?.reason === "inactive", "审计：供应商来源是分组，记着组名、对上的关键词、当时那一版分组、跳过了谁", ab);
    const noteBlinds = (await entryOf(pBlinds.projectId)).autoDraftedRounds?.[roundBlinds.id]?.noteZh ?? "";
    ok(noteBlinds.includes(`分组「${BLINDS}」`), "轮次上的那句说明也写明分组", noteBlinds);
    ok(cardBlinds.status === "pending" && cardBlinds.decidedById === null && roundBlinds.items.every((i) => i.sentAt === null), "零出站：卡仍是待批，没有任何询价项被标为已发出");

    const pChairs = await mkProject(`Office Chairs Supply ${stamp}`);
    const dChairs = await draft(pChairs);
    ok(dChairs?.drafted === false && dChairs.reason === "SUPPLIER_GROUP_UNDETERMINED" && !dChairs.quiet && dChairs.messageZh.includes("没有对上") && dChairs.action?.href === `/projects/${pChairs.projectId}?tab=bid` && (await rounds(pChairs.projectId)).length === 0 && (await cards(pChairs.projectId)).length === 0, "项目名称对不上任何一组：不起草、不退回常用供应商（他有 2 家可选的常用供应商），给出去处", dChairs);
    const pBoth = await mkProject(`Blinds and Furniture Supply ${stamp}`);
    const dBoth = await draft(pBoth);
    ok(dBoth?.drafted === false && dBoth.reason === "SUPPLIER_GROUP_UNDETERMINED" && !dBoth.quiet && dBoth.messageZh.includes(`「${BLINDS}」「${FURN}」`) && (await rounds(pBoth.projectId)).length === 0, "对上不止一组：不起草，结果里列出这几组", dBoth);
    const pLight = await mkProject(`Lighting Upgrade ${stamp}`);
    const dLight = await draft(pLight);
    ok(dLight?.drafted === false && dLight.reason === "SUPPLIER_GROUP_EMPTY" && dLight.messageZh.includes(`分组「${LIGHT}」`) && (await rounds(pLight.projectId)).length === 0, "对上的那一组里没有能发的供应商：不起草，写明是哪一组", dLight);
    const pFurn = await mkProject(`School Furniture ${stamp}`);
    const dFurn = await draft(pFurn);
    ok(dFurn?.drafted === true && ((await cards(pFurn.projectId))[0].payload as { items: Array<{ supplierId: string }> }).items.map((i) => i.supplierId).join() === sC.id, "另一个品类的项目落到另一组：只起草给「家具」这一组的那一家（常用供应商里的 D 没有被带上）", dFurn);

    // —— 9. 别人的分组不被使用 ——
    const pBlinds2 = await mkProject(`Window Blinds Phase Two ${stamp}`);
    const dOther = await draft(pBlinds2, OTHER);
    const cardOther = (await cards(pBlinds2.projectId))[0];
    ok(dOther?.drafted === true && (cardOther.payload as { items: Array<{ supplierId: string }> }).items.map((i) => i.supplierId).join() === sZ.id && (cardOther.preview ?? "").includes("的常用供应商") && !(cardOther.preview ?? "").includes(BLINDS), "操作者自己没有分组（同组织别人有一个对得上的）：起草给他自己的常用供应商，不用别人的分组", { dOther, preview: cardOther?.preview });

    // —— 10. 分组信息不出站：与手动选同样几家时的邮件逐字相同 ——
    const twinName = `Window Blinds Twin ${stamp}`;
    const pAuto = await mkProject(twinName);
    const pManual = await mkProject(twinName);
    const dAuto = await draft(pAuto);
    const manual = await prepareRfqRound({ projectId: pManual.projectId, orgId: ORG, userId: OWNER, source: "web", supplierIds: [sA.id, sB.id], incoterm: "FOB", now: NOW });
    const itemsOf = async (projectId: string) => ((await cards(projectId))[0].payload as { items: Array<{ supplierId: string; subject: string; body: string }> }).items.map((i) => ({ supplierId: i.supplierId, subject: i.subject, body: i.body }));
    const autoItems = await itemsOf(pAuto.projectId);
    const manualItems = await itemsOf(pManual.projectId);
    ok(dAuto?.drafted === true && manual.ok && autoItems.length === 2 && JSON.stringify(autoItems) === JSON.stringify(manualItems), "按分组自动起草与手动勾选同样 2 家：每家的邮件标题与正文逐字相同", { auto: autoItems[0], manual: manualItems[0] });
    const allMail = JSON.stringify([...autoItems, ...(payloadBlinds?.items ?? [])]);
    ok(![BLINDS, FURN, LIGHT, "分组"].some((w) => allMail.includes(w)), "发给供应商的标题与正文里没有组名，也没有「分组」二字");

    // —— 11. 组里的供应商之后不在本组织了：不卡住别的修改，起草时跳过 ——
    await db.supplier.update({ where: { id: sB.id }, data: { orgId: ORG2 } });
    const afterGone = await put(home.projectId, { baseVersion: v2, groups: WITH_LIGHT.map((g) => (g.name === FURN ? { ...g, keywords: ["furniture", "desk"] } : g)) }, owner);
    const v3 = afterGone.json?.supplierGroups?.version ?? null;
    ok(afterGone.status === 200 && afterGone.json?.changed === true && afterGone.json.supplierGroups?.groups[0].readyCount === 1, "组里有一家已不在本组织：改别的组照样能保存；这一组可选的只剩 1 家", afterGone);
    const reAdd = await put(home.projectId, { baseVersion: v3, groups: [...WITH_LIGHT, { name: "新组", supplierIds: [sX.id], keywords: [] }] }, owner);
    ok(reAdd.status === 400 && reAdd.json?.errorCode === "FOREIGN_SUPPLIER", "新加进来的供应商照样要属于本组织", reAdd);
    const pBlinds3 = await mkProject(`Roller Blind Supply ${stamp}`);
    const dGone = await draft(pBlinds3);
    ok(dGone?.drafted === true && dGone.supplierCount === 1 && dGone.skippedCount === 2 && ((await cards(pBlinds3.projectId))[0].payload as { items: Array<{ supplierId: string }> }).items.map((i) => i.supplierId).join() === sA.id, "起草时跳过停用的与已不在本组织的，只发给剩下的那一家", dGone);
    await db.supplier.update({ where: { id: sB.id }, data: { orgId: ORG } });

    // —— 12. 保存之后把功能关掉：回到常用供应商，分组留在记录里 ——
    groupsOff();
    const pOff = await mkProject(`Window Blinds FlagOff ${stamp}`);
    const dOff = await draft(pOff);
    const cardOff = (await cards(pOff.projectId))[0];
    ok(dOff?.drafted === true && (cardOff.payload as { items: Array<{ supplierId: string }> }).items.map((i) => i.supplierId).join() === [sC.id, sD.id].join() && (cardOff.preview ?? "").includes("的常用供应商"), "功能关闭：已保存的分组不生效，自动起草回到常用供应商", dOff);
    const eOff = await entryOf(pOff.projectId);
    ok(!("supplierGroups" in eOff) && !eOff.suppliers.some((s) => s.id === sI.id), "功能关闭：入口没有分组字段，可选列表也回到本功能之前的样子（组里停用的那家不再并入）");
    groupsOn();
    ok((await entryOf(home.projectId)).supplierGroups?.version === v3, "重新打开：之前保存的分组还在");
  } finally {
    groupsOff();
    delete process.env.TENDER_RFQ_AUTO_DRAFT_ENABLED;
    // —— 清理 ——
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG2] } }, { userId: { in: USERS } }] } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.notification.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.emailProvider.deleteMany({ where: { userId: { in: USERS } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.user.deleteMany({ where: { id: { in: USERS } } });
    await db.$disconnect();
  }

  console.log(`\nRFQ-AUTO-5 supplier groups DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
