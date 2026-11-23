/**
 * BIDPAGE-6 定报价只点一次——真实 DB（隔离库）经真实路由处理函数
 * （openspec change quote-one-step-confirm，spec tender/quote-one-step-confirm、tender/quote-line-mode、tender/bid-page 的修改）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 任务书的合成金额）。不发任何邮件、不批准任何询价卡。
 * 回归样本按任务书附录 C 决定 J 用合成数据覆盖：项目里 0 份 / 1 份 / 已有另一份我方报价 / 两份已批准没选 / 另一份已中标。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 BIDPAGE-6 定报价 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "BIDPAGE-6 定报价 隔离库测试" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 2000) : ""); }
}

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { transitionQuote } = await import("@/lib/quote-engine/service");
  const { resolveTenderBid, selectQuoteAsTenderBid, TenderBidSyncError } = await import("@/lib/quote-engine/tender-bid");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { quoteStatusEventKey } = await import("@/lib/project-ledger/event-keys");
  const { notificationHref } = await import("@/lib/notifications/href");
  const { DEFAULT_ENABLED_TYPES } = await import("@/lib/notifications/constants");
  const { confirmAsOurBid } = await import("@/lib/bid-page-v2/quote-confirm/service");
  const { EXPORT_NOT_DECIDED_ZH } = await import("@/lib/bid-page-v2/quote-line/service");
  const listRoute = await import("@/app/api/projects/[id]/bid-page/quotes/route");
  const lumpRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/lump/route");
  const confirmRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/confirm/route");
  const submitRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/submit/route");
  const returnRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/return/route");
  const reviseRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/revise/route");
  const statusRoute = await import("@/app/api/projects/[id]/quote-engine/[quoteId]/status/route");
  type LumpView = import("@/lib/bid-page-v2/lump-sum/contract").LumpView;
  type LumpState = import("@/lib/bid-page-v2/lump-sum/contract").LumpState;
  type ListView = import("@/lib/bid-page-v2/quote-line/contract").QuoteListView;

  console.log("BIDPAGE-6 定报价只点一次——隔离库");
  const stamp = Date.now().toString(36);
  const OWNER = `qcowner_${stamp}`, FINEDIT = `qcfinedit_${stamp}`, FINVIEW = `qcfinview_${stamp}`, OPERATOR = `qcop_${stamp}`, GHOST = `qcghost_${stamp}`, PADMIN = `qcpadmin_${stamp}`;
  const ORG = `qcorg_${stamp}`;
  const users = [OWNER, FINEDIT, FINVIEW, OPERATOR, GHOST, PADMIN];
  const email = (id: string) => `${id}@fixture.test`;
  const nameOf = (id: string) => `Fixture ${id}`;
  const ENV_KEYS = ["TENDER_BID_PAGE_V2_ENABLED", "TENDER_BID_PAGE_V2_ORG_ALLOWLIST", "TENDER_QUOTE_ENGINE_ENABLED", "T2_LEDGER_SCHEMA_READY", "T2_LEDGER_PRODUCERS_ENABLED"];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.TENDER_QUOTE_ENGINE_ENABLED = "1";
  process.env.T2_LEDGER_SCHEMA_READY = "1";
  process.env.T2_LEDGER_PRODUCERS_ENABLED = "1";

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: nameOf(id), role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `qc-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  // GHOST 不是组织成员（导入用的系统账号、离开组织的人）
  for (const [u, role] of [[OWNER, "org_admin"], [FINEDIT, "org_member"], [FINVIEW, "org_member"], [OPERATOR, "org_member"], [PADMIN, "org_member"]] as const) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: u, role, status: "active" } });
  }
  await seedOrgAuthorizationProfiles(ORG);
  const accounting = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key: "accounting" } } });
  if (!accounting) throw new Error("缺少岗位模板 accounting");
  for (const u of [FINEDIT, FINVIEW]) await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: u, roleProfileId: accounting.id, status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(ownerId = OWNER) {
    seq += 1;
    const id = `qcproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId, workDomain: "tender", intakeStatus: "dispatched" } });
    // FINEDIT：编辑权限、没有批准权限、有财务查看权（提交的人）；FINVIEW：只读 + 财务查看权；OPERATOR：编辑权限、没有财务查看权
    // PADMIN：项目管理员（有批准权限 project:cost:review），没有财务查看权
    for (const [u, role] of [[FINEDIT, "operator"], [FINVIEW, "viewer"], [OPERATOR, "operator"], [PADMIN, "project_admin"]] as const) await db.projectMember.create({ data: { projectId: id, userId: u, role, status: "active" } });
    return id;
  }
  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: "user" })}`;
  const req = async (url: string, userId: string | null, init: { method?: string; body?: unknown } = {}) =>
    new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers: { ...(userId ? { cookie: await cookieOf(userId) } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}) }, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  const json = async (res: Response) => {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: res.status, text, body };
  };
  const pq = (P: string, Q: string) => ({ params: Promise.resolve({ id: P, quoteId: Q }) });
  const list = async (P: string, u: string | null = OWNER) => json(await listRoute.GET(await req(`/api/projects/${P}/bid-page/quotes`, u), { params: Promise.resolve({ id: P }) }));
  const create = async (P: string, body: unknown, u: string | null = OWNER) => json(await listRoute.POST(await req(`/api/projects/${P}/bid-page/quotes`, u, { method: "POST", body }), { params: Promise.resolve({ id: P }) }));
  const getLump = async (P: string, Q: string, u: string | null = OWNER) => json(await lumpRoute.GET(await req(`/api/projects/${P}/bid-page/quotes/${Q}/lump`, u), pq(P, Q)));
  const putLump = async (P: string, Q: string, body: unknown, u: string | null = OWNER) => json(await lumpRoute.PUT(await req(`/api/projects/${P}/bid-page/quotes/${Q}/lump`, u, { method: "PUT", body }), pq(P, Q)));
  const post = (route: { POST: (r: InstanceType<typeof NextRequest>, c: ReturnType<typeof pq>) => Promise<Response> }, name: string) => async (P: string, Q: string, body: unknown, u: string | null = OWNER) =>
    json(await route.POST(await req(`/api/projects/${P}/bid-page/quotes/${Q}/${name}`, u, { method: "POST", body }), pq(P, Q)));
  const confirm = post(confirmRoute, "confirm");
  const submit = post(submitRoute, "submit");
  const ret = post(returnRoute, "return");
  const revise = post(reviseRoute, "revise");
  const proStatus = async (P: string, Q: string, to: string, u = OWNER) => json(await statusRoute.POST(await req(`/api/projects/${P}/quote-engine/${Q}/status`, u, { method: "POST", body: { to } }), pq(P, Q)));

  const offPresets = (p: LumpState["presets"]) => ({ financing: { ...p.financing, included: false }, admin: { ...p.admin, included: false }, cashAllowance: { ...p.cashAllowance, included: false }, commission: { ...p.commission, included: false } });
  /** 一份填好的总价报价（验收 3 的合成数字：税前报价 = 900,000 ÷ (1 − margin)） */
  async function pricedLump(P: string, margin = 25, name = "合成总价报价"): Promise<{ Q: string; view: LumpView }> {
    const c = await create(P, { entryMode: "LUMP_SUM", businessType: "SUPPLY_ONLY", name });
    const Q = String(c.body.id);
    const v0 = (await getLump(P, Q)).body as unknown as LumpView;
    const state: LumpState = {
      ...v0.state,
      goods: { ...v0.state.goods, amount: 800000, evidenceKind: "ESTIMATE" },
      items: v0.state.items.map((i) => (i.key === "ocean_freight" ? { ...i, amount: 60000 } : { ...i, amount: 40000 })),
      presets: offPresets(v0.state.presets),
      tax: { hstPct: 7, gstPct: null, pstPct: null },
      targetMarginPct: margin,
    };
    const r = await putLump(P, Q, { baseUpdatedAt: v0.quote.updatedAt, state });
    if (r.status !== 200) throw new Error(`保存总价报价失败 ${r.status} ${r.text}`);
    return { Q, view: r.body as unknown as LumpView };
  }
  const sp = (v: LumpView) => (v.computed.ok ? v.computed.totals.sellingPrice : Number.NaN);
  const body = (v: LumpView) => ({ baseUpdatedAt: v.quote.updatedAt, expectedSellingPrice: sp(v) });
  const fresh = async (P: string, Q: string) => (await getLump(P, Q)).body as unknown as LumpView;
  const audits = (Q: string, action: string) => db.auditLog.count({ where: { targetId: Q, action } });
  const auditTriple = async (Q: string) => [await audits(Q, "quote_submitted_for_review"), await audits(Q, "quote_approved"), await audits(Q, "quote_selected_as_tender_bid")];
  const events = (P: string, Q: string) => db.projectEvent.findMany({ where: { projectId: P }, orderBy: { seq: "asc" }, select: { eventType: true, eventKey: true, refs: true, payload: true } }).then((rows) => rows.filter((r) => (r.refs as { quoteId?: string } | null)?.quoteId === Q));
  const pointer = async (P: string) => db.project.findUnique({ where: { id: P }, select: { bidQuoteId: true, ourBidPrice: true, currency: true } });
  const status = async (Q: string) => (await db.projectQuote.findUnique({ where: { id: Q }, select: { status: true } }))?.status;
  const snapshot = async (P: string) => JSON.stringify([
    await db.projectQuote.findMany({ where: { projectId: P }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true, approvedAt: true, submittedAt: true } }),
    await pointer(P),
    await db.projectEvent.count({ where: { projectId: P } }),
    await db.auditLog.count({ where: { projectId: P } }),
    await db.notification.count({ where: { projectId: P } }),
  ]);
  const spied = async (url: string, body: unknown) => {
    const r = await req(url, OWNER, { method: "POST", body });
    let reads = 0;
    const orig = r.json.bind(r);
    (r as unknown as { json: () => Promise<unknown> }).json = async () => { reads += 1; return orig(); };
    return { r, reads: () => reads };
  };

  try {
    // —— 1. 开关关着：四个接口 404，不读请求体，库里不变 ——
    const P0 = await mkProject();
    process.env.TENDER_BID_PAGE_V2_ENABLED = "1";
    const { Q: Q0, view: v00 } = await pricedLump(P0);
    delete process.env.TENDER_BID_PAGE_V2_ENABLED;
    const before0 = await snapshot(P0);
    const routes = [[confirmRoute, "confirm", body(v00)], [submitRoute, "submit", { baseUpdatedAt: v00.quote.updatedAt }], [returnRoute, "return", { baseUpdatedAt: v00.quote.updatedAt }], [reviseRoute, "revise", { reason: "x" }]] as const;
    const offs = [];
    let reads = 0;
    for (const [route, name, b] of routes) {
      const s = await spied(`/api/projects/${P0}/bid-page/quotes/${Q0}/${name}`, b);
      offs.push(await json(await route.POST(s.r, pq(P0, Q0))));
      reads += s.reads();
    }
    ok(offs.every((r) => r.status === 404 && r.body.error === "新版标书与报价页未启用") && reads === 0 && (await snapshot(P0)) === before0, "开关关：四个接口都 404、请求体没被读、库里不变", offs.map((r) => r.status));
    process.env.TENDER_BID_PAGE_V2_ENABLED = "1";

    // —— 2. 守卫与门 ——
    const anon = await Promise.all([confirm(P0, Q0, body(v00), null), submit(P0, Q0, {}, null), ret(P0, Q0, {}, null), revise(P0, Q0, { reason: "x" }, null)]);
    ok(anon.every((r) => r.status === 401), "没登录：四个接口都 401（第一步报价权限守卫）", anon.map((r) => r.status));
    const v0b = await fresh(P0, Q0);
    const noApprove = [await confirm(P0, Q0, body(v0b), FINEDIT), await ret(P0, Q0, { baseUpdatedAt: v0b.quote.updatedAt }, FINEDIT)];
    ok(noApprove.every((r) => r.status === 403) && (await snapshot(P0)) === before0, "只有编辑权限的人调一次定价、退回：403，库里不变", noApprove.map((r) => r.status));
    const noFinance = [await submit(P0, Q0, { baseUpdatedAt: v0b.quote.updatedAt }, OPERATOR), await revise(P0, Q0, { reason: "x" }, OPERATOR)];
    ok(noFinance.every((r) => r.status === 403) && (await snapshot(P0)) === before0, "有编辑权限、没有财务查看权：提交、另起新版 403", noFinance.map((r) => r.status));
    ok((await submit(P0, Q0, { baseUpdatedAt: v0b.quote.updatedAt }, FINVIEW)).status === 403, "只读成员（有财务查看权、没有编辑权限）提交：403");
    const bad = [await confirm(P0, Q0, { baseUpdatedAt: v0b.quote.updatedAt }), await confirm(P0, Q0, null), await submit(P0, Q0, { nope: 1 }), await revise(P0, Q0, {})];
    ok(bad.every((r) => r.status === 400) && (await snapshot(P0)) === before0, "请求体不对：400（一次定价缺报价合计、空、提交缺修改时间、另起新版缺原因）", bad.map((r) => r.status));
    const nf = await confirm(P0, `q_nope_${stamp}`, body(v0b));
    ok(nf.status === 404, "报价不存在：404", nf.status);
    const approverNoFin = [await confirm(P0, Q0, body(v0b), PADMIN), await ret(P0, Q0, { baseUpdatedAt: v0b.quote.updatedAt }, PADMIN), await submit(P0, Q0, { baseUpdatedAt: v0b.quote.updatedAt }, PADMIN)];
    ok(approverNoFin.every((r) => r.status === 403 && !/\d{4,}/.test(r.text)) && (await snapshot(P0)) === before0, "有批准权限、没有财务查看权（项目管理员）：一次定价、退回、提交都 403，响应里没有数，库里不变", approverNoFin.map((r) => r.status));
    const listNoFin = await list(P0, OPERATOR);
    ok(listNoFin.status === 403 && !("ourBid" in listNoFin.body) && !/1200000|1,200,000|900000/.test(listNoFin.text), "没有财务查看权的人读报价列表：403，没有我方报价一行、没有金额", listNoFin.status);
    // 别的项目的报价 id、旧版报价单（CUSTOM）
    const Pother = await mkProject();
    const { Q: Qother, view: vOther } = await pricedLump(Pother);
    const beforeOther = await snapshot(Pother);
    const cross = [await confirm(P0, Qother, body(vOther)), await submit(P0, Qother, { baseUpdatedAt: vOther.quote.updatedAt }), await ret(P0, Qother, { baseUpdatedAt: vOther.quote.updatedAt }), await revise(P0, Qother, { reason: "x" })];
    ok(cross.every((r) => r.status === 404) && (await snapshot(Pother)) === beforeOther && (await snapshot(P0)) === before0, "别的项目的报价 id：四个接口都 404，两边库里不变", cross.map((r) => r.status));
    const legacy = await db.projectQuote.create({ data: { projectId: P0, orgId: ORG, quoteType: "CUSTOM", createdById: OWNER, title: "合成旧版报价单" } });
    const legacyU = legacy.updatedAt.toISOString();
    const legacyRes = [await confirm(P0, legacy.id, { baseUpdatedAt: legacyU, expectedSellingPrice: 0 }), await submit(P0, legacy.id, { baseUpdatedAt: legacyU }), await ret(P0, legacy.id, { baseUpdatedAt: legacyU }), await revise(P0, legacy.id, { reason: "x" })];
    ok(legacyRes.every((r) => r.status === 409 && r.body.code === "NOT_BID_QUOTE" && String(r.body.error).includes("旧版报价单")) && (await db.projectQuote.findUnique({ where: { id: legacy.id } }))?.status === legacy.status, "旧版报价单（CUSTOM）：四个接口都 409 写明是旧版报价单，状态不变", legacyRes.map((r) => [r.status, r.body.code]));
    await db.projectQuote.delete({ where: { id: legacy.id } });

    // —— 3. 项目里 0 份：一次定价 ——
    const stale = await confirm(P0, Q0, { baseUpdatedAt: new Date(Date.parse(v0b.quote.updatedAt) - 1000).toISOString(), expectedSellingPrice: sp(v0b) });
    ok(stale.status === 409 && String(stale.body.error).includes("刚被改过或刚被处理过") && (await snapshot(P0)) === before0, "修改时间对不上：409，库里不变", stale.body);
    const off1 = await confirm(P0, Q0, { baseUpdatedAt: v0b.quote.updatedAt, expectedSellingPrice: sp(v0b) + 1 });
    ok(off1.status === 409 && String(off1.body.error).includes("刚被改过或刚被处理过") && (await snapshot(P0)) === before0, "报价合计多 1 元：409，库里不变", off1.body);
    const off001 = await confirm(P0, Q0, { baseUpdatedAt: v0b.quote.updatedAt, expectedSellingPrice: sp(v0b) + 0.01 });
    ok(off001.status === 409 && (await snapshot(P0)) === before0, "报价合计多 0.01 元：也 409（只容 0.005 的浮点误差）", off001.body);
    const c0 = await confirm(P0, Q0, body(v0b));
    const p0 = await pointer(P0);
    ok(c0.status === 200 && c0.body.isOurBid === true && c0.body.reselectedFrom === null && c0.body.alreadyOurBid === false && (await status(Q0)) === "approved" && p0?.bidQuoteId === Q0 && p0.ourBidPrice === 1200000 && p0.currency === "CAD", "0 份：一次定价后是已批准、是我方报价，项目金额 = 税前报价 1,200,000 加元", [c0.body, p0]);
    ok(JSON.stringify(await auditTriple(Q0)) === "[1,1,1]", "0 份：提交、批准、选定审计各一条", await auditTriple(Q0));
    const sel0 = await db.auditLog.findFirst({ where: { targetId: Q0, action: "quote_selected_as_tender_bid" } });
    ok(!!sel0 && JSON.parse(sel0.afterData ?? "{}").auto === true, "0 份：选定由同步自动选中写（auto: true），本次操作不再写第二条");
    const sub0 = await db.auditLog.findFirst({ where: { targetId: Q0, action: "quote_submitted_for_review" } });
    ok(!!sub0 && JSON.parse(sub0.afterData ?? "{}").via === "bid_page" && JSON.parse(sub0.beforeData ?? "{}").status === "draft", "迁移审计写明是在标书与报价页做的、从草稿出发");
    const ev0 = await events(P0, Q0);
    ok(ev0.map((e) => e.eventType).join(",") === "quote.submitted_for_review,quote.approved" && new Set(ev0.map((e) => e.eventKey)).size === 2, "台账：送审、批准两条事件，去重键不同", ev0);
    const pay = ev0.map((e) => e.payload as { from?: string; status?: string; sellingPrice?: number | null });
    ok(pay[0]?.from === "draft" && pay[0]?.status === "review" && pay[1]?.from === "review" && pay[1]?.status === "approved" && pay[0]?.sellingPrice === 1200000 && pay[1]?.sellingPrice === 1200000, "台账载荷：两步各写从哪个状态到哪个状态、税前报价（与专业模式同一写法）", pay);
    const apAudit = await db.auditLog.findFirst({ where: { targetId: Q0, action: "quote_approved" } });
    ok(JSON.parse(apAudit?.beforeData ?? "{}").status === "review" && JSON.parse(apAudit?.afterData ?? "{}").status === "approved", "批准审计：从待批准到已批准（第二步从第一步之后的状态出发）");
    const appr = await db.projectQuote.findUnique({ where: { id: Q0 }, select: { approvedById: true, submittedAt: true, approvedAt: true } });
    ok(appr?.approvedById === OWNER && !!appr.submittedAt && !!appr.approvedAt, "批准人与提交 / 批准时间写在报价上");
    const newAudits = await db.auditLog.findMany({ where: { targetId: Q0, action: { in: ["quote_submitted_for_review", "quote_approved", "quote_selected_as_tender_bid"] } } });
    const auditText = newAudits.map((a) => `${a.beforeData ?? ""}${a.afterData ?? ""}`).join(" ");
    ok(!/estimatedCost|grossProfit|grossMargin|internalCost|"cost"|margin/i.test(auditText) && !auditText.includes("900000"), "审计里没有成本合计、利润、毛利率的值与键", auditText.slice(0, 400));
    const again = await confirm(P0, Q0, { baseUpdatedAt: (await fresh(P0, Q0)).quote.updatedAt, expectedSellingPrice: 1200000 });
    ok(again.status === 200 && again.body.alreadyOurBid === true && JSON.stringify(await auditTriple(Q0)) === "[1,1,1]", "已是我方报价再点：200、什么都不做", again.body);
    const vFrozen = await fresh(P0, Q0);
    const frozenSave = await putLump(P0, Q0, { baseUpdatedAt: vFrozen.quote.updatedAt, state: vFrozen.state });
    ok(frozenSave.status === 409 && frozenSave.body.error === "这份报价「已批准」，内容锁定；要改请点「另起新版」" && vFrozen.quote.frozen === true, "定了以后再保存：409，说明是「要改请点「另起新版」」（不再叫人去专业模式）", frozenSave.body);
    const lv0 = (await list(P0)).body as unknown as ListView;
    const ob0 = lv0.ourBid;
    ok(ob0.status === "AUTHORITATIVE" && ob0.quoteId === Q0 && ob0.version === 1 && ob0.sellingPrice === 1200000 && ob0.decidedBy === nameOf(OWNER) && !!ob0.decidedAt && ob0.entryMode === "LUMP_SUM", "列表的我方报价一行：第 1 版、1,200,000、谁定的、何时、做法", ob0);

    // —— 4. 已有另一份我方报价：改选 ——
    const { Q: Q0b, view: v0c } = await pricedLump(P0, 20, "合成总价报价 B");
    ok(sp(v0c) === 1125000, "第二份：税前报价 1,125,000", sp(v0c));
    const c1 = await confirm(P0, Q0b, body(v0c));
    const p1 = await pointer(P0);
    ok(c1.status === 200 && (c1.body.reselectedFrom as { id?: string } | null)?.id === Q0 && p1?.bidQuoteId === Q0b && p1.ourBidPrice === 1125000 && (await status(Q0)) === "approved", "已有另一份：改选这一份，项目金额换成 1,125,000；原来那份仍是已批准", [c1.body, p1]);
    ok(JSON.stringify(await auditTriple(Q0b)) === "[1,1,1]", "已有另一份：这一份的提交、批准、选定各一条", await auditTriple(Q0b));
    const sel1 = await db.auditLog.findFirst({ where: { targetId: Q0b, action: "quote_selected_as_tender_bid" } });
    const sel1a = JSON.parse(sel1?.afterData ?? "{}");
    ok(sel1a.auto === false && sel1a.sellingPrice === 1125000 && sel1a.via === "bid_page" && JSON.parse(sel1?.beforeData ?? "{}").bidQuoteId === Q0, "改选的选定审计：手动、带税前报价、前一份是谁");
    ok((await db.auditLog.count({ where: { projectId: P0, action: { in: ["tender_bid_pointer_synced", "tender_bid_mirrors_cleared"] } } })) === 0, "改选时同步的中间结果（刷新原来那份）不另写审计");
    const res1 = await resolveTenderBid({ projectId: P0, orgId: ORG, internal: true });
    ok(res1.status === "AUTHORITATIVE" && res1.quote?.id === Q0b && res1.candidates.some((c) => c.id === Q0), "原来那份还在候选里，可以再选");

    // —— 5. 两份已批准、都没选 ——
    const P2 = await mkProject();
    const { Q: A } = await pricedLump(P2, 25, "A");
    const { Q: B } = await pricedLump(P2, 20, "B");
    await transitionQuote({ quoteId: A, projectId: P2, userId: OWNER, orgId: ORG, to: "review" });
    await transitionQuote({ quoteId: A, projectId: P2, userId: OWNER, orgId: ORG, to: "approved" });
    await transitionQuote({ quoteId: B, projectId: P2, userId: OWNER, orgId: ORG, to: "review" });
    await transitionQuote({ quoteId: B, projectId: P2, userId: OWNER, orgId: ORG, to: "approved" });
    await db.project.update({ where: { id: P2 }, data: { bidQuoteId: null, ourBidPrice: null } });
    const vb = await fresh(P2, B);
    const cb = await confirm(P2, B, body(vb));
    ok(cb.status === 200 && (await pointer(P2))?.bidQuoteId === B && (await status(A)) === "approved" && (await status(B)) === "approved", "两份已批准都没选：只做选定，两份状态都不变", cb.body);
    const bSel = await db.auditLog.count({ where: { targetId: B, action: "quote_selected_as_tender_bid" } });
    const bViaSubmit = await db.auditLog.count({ where: { targetId: B, action: "quote_submitted_for_review", afterData: { contains: "bid_page" } } });
    ok(bSel === 1 && bViaSubmit === 0, "只做选定：一条选定审计，没有新的迁移审计", [bSel, bViaSubmit]);
    // 两份已批准没选，再把一份草稿定为我方报价
    await db.project.update({ where: { id: P2 }, data: { bidQuoteId: null, ourBidPrice: null } });
    const { Q: C, view: vc } = await pricedLump(P2, 30, "C");
    const cc = await confirm(P2, C, body(vc));
    ok(cc.status === 200 && (await pointer(P2))?.bidQuoteId === C && JSON.stringify(await auditTriple(C)) === "[1,1,1]" && (await events(P2, C)).length === 2, "两份已批准没选时把草稿定为我方报价：选上这一份，提交、批准、选定各一条，台账两条", await auditTriple(C));

    // —— 6. 另起新版后定新版（跟随新版） ——
    const P3 = await mkProject();
    const { Q: R1, view: vr1 } = await pricedLump(P3);
    await confirm(P3, R1, body(vr1));
    const draftRev = await revise(P3, R1, { reason: "  " });
    ok(draftRev.status === 400 && String(draftRev.body.error).includes("为什么"), "另起新版不写原因：400", draftRev.body);
    const rv = await revise(P3, R1, { reason: "招标方要求降价" }, FINEDIT);
    const R2 = String(rv.body.id);
    ok(rv.status === 200 && rv.body.version === 2 && rv.body.entryMode === "LUMP_SUM" && (await status(R1)) === "superseded" && (await status(R2)) === "draft", "另起新版：第 2 版草稿、做法仍是只报总价，第 1 版已被新版替代", rv.body);
    const lv3 = (await list(P3)).body as unknown as ListView;
    ok(lv3.ourBid.status === "QUOTE_REVISION_PENDING" && lv3.ourBid.version === 1 && lv3.ourBid.pending?.id === R2, "我方报价一行：新版待定", lv3.ourBid);
    const lines1 = await db.quoteCostLine.count({ where: { quoteId: R1 } });
    ok((await db.quoteCostLine.count({ where: { quoteId: R2 } })) === lines1, "新版成本行条数与原来相同");
    const reviseDraft = await revise(P3, R2, { reason: "x" });
    ok(reviseDraft.status === 409 && String(reviseDraft.body.error).includes("草稿"), "草稿不能另起新版：409 写着「草稿」", reviseDraft.body);
    const vr2 = await fresh(P3, R2);
    const cr2 = await confirm(P3, R2, body(vr2));
    ok(cr2.status === 200 && (await pointer(P3))?.bidQuoteId === R2 && JSON.stringify(await auditTriple(R2)) === "[1,1,1]" && (await audits(R2, "tender_bid_pointer_synced")) === 1, "定新版：第 2 版是我方报价；提交、批准、选定各一条（另有一条跟随新版的同步记录）", [await auditTriple(R2), cr2.body]);

    // —— 7. 现在的我方报价已中标：不改选 ——
    const P4 = await mkProject();
    const { Q: W, view: vw } = await pricedLump(P4);
    await confirm(P4, W, body(vw));
    await transitionQuote({ quoteId: W, projectId: P4, userId: OWNER, orgId: ORG, to: "awarded" });
    const { Q: W2, view: vw2 } = await pricedLump(P4, 20, "W2");
    const before4 = await snapshot(P4);
    const cw = await confirm(P4, W2, body(vw2));
    ok(cw.status === 409 && cw.body.code === "OUR_BID_AWARDED" && String(cw.body.error).includes("第 1 版已中标") && (await status(W2)) === "draft" && (await snapshot(P4)) === before4, "我方报价已中标：409，第二份仍是草稿、指针与金额不变、没有新审计与台账", cw.body);

    // —— 8. 有计入但没填数的行 ——
    const P5 = await mkProject();
    const cu = await create(P5, { entryMode: "LUMP_SUM", businessType: "SUPPLY_ONLY" });
    const QU = String(cu.body.id);
    const vu = await fresh(P5, QU);
    const before5 = await snapshot(P5);
    const un = await confirm(P5, QU, { baseUpdatedAt: vu.quote.updatedAt, expectedSellingPrice: vu.computed.ok ? vu.computed.totals.sellingPrice : 0 });
    ok(un.status === 409 && un.body.code === "QUOTE_UNPRICED_LINES" && /还有 \d+ 行没填数（供应商报价或比例空着），填完才能定为我方报价/.test(String(un.body.error)) && (await snapshot(P5)) === before5, "有计入但没填数的行：409 写明几行，库里不变", un.body);

    // —— 9. 同时点两次 ——
    const P6 = await mkProject();
    const { Q: QC, view: vqc } = await pricedLump(P6);
    const both = await Promise.all([confirm(P6, QC, body(vqc)), confirm(P6, QC, body(vqc))]);
    const codes = both.map((r) => r.status).sort();
    ok(JSON.stringify(codes) === "[200,409]" && JSON.stringify(await auditTriple(QC)) === "[1,1,1]" && (await events(P6, QC)).length === 2, "同时点两次：一个 200、一个 409；审计各一条、台账两条", [codes, await auditTriple(QC)]);

    // 同一项目两份不同的草稿同时一次定价：都不出 500（锁的顺序：报价行 → 项目行）；互锁看交错时机，连跑 4 组
    {
      const rounds: unknown[] = [];
      let allOk = true;
      for (let k = 0; k < 4; k++) {
        const Pk = await mkProject();
        const { Q: QX1, view: vx1 } = await pricedLump(Pk, 25, `X1-${k}`);
        const { Q: QX2, view: vx2 } = await pricedLump(Pk, 20, `X2-${k}`);
        const two = await Promise.all([confirm(Pk, QX1, body(vx1)).catch((e) => ({ status: 500, body: { error: String(e) } })), confirm(Pk, QX2, body(vx2)).catch((e) => ({ status: 500, body: { error: String(e) } }))]);
        const ptr = (await pointer(Pk))?.bidQuoteId;
        const good = two.every((r) => r.status === 200) && (await status(QX1)) === "approved" && (await status(QX2)) === "approved" && (ptr === QX1 || ptr === QX2) && JSON.stringify(await auditTriple(QX1)) === "[1,1,1]" && JSON.stringify(await auditTriple(QX2)) === "[1,1,1]";
        if (!good) allOk = false;
        rounds.push(two.map((r) => [r.status, String((r.body as { error?: unknown }).error ?? "").slice(0, 120)]));
      }
      ok(allOk, "同一项目两份草稿同时定（4 组）：都成功（后一个改选），不互锁、不出 500；各自审计各一条", rounds);
    }

    // 同一份草稿：一次定价与总价保存同时发（连做 4 组）——只有一个成功；定成了的话项目金额就是确认框里的数
    {
      const rounds: unknown[] = [];
      let allOk = true;
      for (let k = 0; k < 4; k++) {
        const Pk = await mkProject();
        const { Q: QS2, view: vs2 } = await pricedLump(Pk, 25, `S-${k}`);
        const changed = { ...vs2.state, targetMarginPct: 30 };
        const res = await Promise.all([confirm(Pk, QS2, body(vs2)).catch((e) => ({ status: 500, body: { error: String(e) }, text: "" })), putLump(Pk, QS2, { baseUpdatedAt: vs2.quote.updatedAt, state: changed }).catch((e) => ({ status: 500, body: { error: String(e) }, text: "" }))]);
        const [c, sv] = res;
        const ptr = await pointer(Pk);
        const st = await status(QS2);
        const good = (c.status === 200) !== (sv.status === 200) && (c.status === 200 ? st === "approved" && ptr?.bidQuoteId === QS2 && ptr.ourBidPrice === 1200000 : st === "draft" && ptr?.bidQuoteId == null);
        if (!good) allOk = false;
        rounds.push([c.status, sv.status, st, ptr?.ourBidPrice ?? null]);
      }
      ok(allOk, "同一份草稿一次定价与保存同时发（4 组）：每组只有一个成功；定成的那组项目金额是确认框里的 1,200,000（批准的就是看到的那一份）", rounds);
    }

    // —— 10. 同步失败 / 改选写镜像失败：整笔回滚 ——
    const P7 = await mkProject();
    const { Q: QF, view: vqf } = await pricedLump(P7);
    const before7 = await snapshot(P7);
    let sf: unknown = null;
    try {
      await confirmAsOurBid({ projectId: P7, orgId: ORG, userId: OWNER, quoteId: QF, request: body(vqf), deps: { bidSync: async () => { throw new TenderBidSyncError("注入的同步失败"); } } });
    } catch (e) { sf = e; }
    const sfe = sf as { code?: string; status?: number; message?: string } | null;
    const after7 = JSON.parse(await snapshot(P7)) as unknown[];
    const before7j = JSON.parse(before7) as unknown[];
    ok(sfe?.code === "TENDER_BID_SYNC_FAILED" && sfe.status === 500 && String(sfe.message).includes("这次的操作都已撤回") && (await status(QF)) === "draft" && JSON.stringify(after7.slice(0, 3)) === JSON.stringify(before7j.slice(0, 3)) && (await audits(QF, "tender_bid_sync_failed")) === 1 && JSON.stringify(await auditTriple(QF)) === "[0,0,0]", "同步失败：500 与中文说明；仍是草稿，台账与指针不变，一条同步失败审计", sfe);
    await confirm(P7, QF, body(await fresh(P7, QF)));
    const { Q: QF2, view: vqf2 } = await pricedLump(P7, 20, "F2");
    const before7b = JSON.parse(await snapshot(P7)) as unknown[];
    let mf: unknown = null;
    try {
      await confirmAsOurBid({ projectId: P7, orgId: ORG, userId: OWNER, quoteId: QF2, request: body(vqf2), deps: { mirror: async () => { throw new Error("注入的镜像写失败"); } } });
    } catch (e) { mf = e; }
    const after7b = JSON.parse(await snapshot(P7)) as unknown[];
    ok((mf as { code?: string } | null)?.code === "TENDER_BID_SYNC_FAILED" && (await status(QF2)) === "draft" && JSON.stringify(after7b.slice(0, 3)) === JSON.stringify(before7b.slice(0, 3)) && (await pointer(P7))?.bidQuoteId === QF, "改选时写镜像失败：整笔回滚，第二份仍是草稿，我方报价仍是第一份", mf);

    // —— 11. 提交给负责人、通知、退回 ——
    const P8 = await mkProject();
    const { Q: QS, view: vqs } = await pricedLump(P8, 25, "合成提交报价");
    const s1 = await submit(P8, QS, { baseUpdatedAt: vqs.quote.updatedAt }, FINEDIT);
    const n1 = await db.notification.findMany({ where: { userId: OWNER, entityType: "bid_quote", entityId: QS } });
    ok(s1.status === 200 && (s1.body.notify as { kind?: string }).kind === "notified" && s1.body.messageZh === `已提交，已通知负责人 ${nameOf(OWNER)}` && (await status(QS)) === "review" && n1.length === 1, "操作员提交：待批准，负责人有一条通知，页面写已通知负责人", s1.body);
    ok(JSON.stringify(await auditTriple(QS)) === "[1,0,0]" && (await events(P8, QS)).map((e) => e.eventType).join(",") === "quote.submitted_for_review", "提交：一条提交审计、一条送审台账事件");
    const nt = n1[0]!;
    const ntText = `${nt.title} ${nt.summary ?? ""} ${nt.metadata ?? ""}`;
    ok(nt.type === "project_update" && nt.status === "unread" && nt.priority === "high" && nt.title.startsWith("报价等你批准 · Fixture Tender") && (nt.summary ?? "").includes(`${nameOf(FINEDIT)} 提交了「合成提交报价」第 1 版`), "通知：既有类型、未读、高优先级，标题写项目名，摘要写谁提交了哪一份第几版", nt);
    ok(!/1200000|1,200,000|900000|900,000|加元|CAD|供应商/.test(ntText), "通知里没有金额、币种、供应商", ntText);
    ok(notificationHref(nt) === `/projects/${P8}?tab=bid#bid-quote-${QS}`, "点开通知：回到这个项目的「标书与报价」，带 #bid-quote-{报价 id}", notificationHref(nt));
    const s1b = await submit(P8, QS, { baseUpdatedAt: (await fresh(P8, QS)).quote.updatedAt }, FINEDIT);
    ok(s1b.status === 409 && String(s1b.body.error).includes("待批准"), "已是待批准再提交：409 写出状态名", s1b.body);
    const rt = await ret(P8, QS, { baseUpdatedAt: (await fresh(P8, QS)).quote.updatedAt, note: "海运费要重新问\u0007" });
    const rtAudit = await db.auditLog.findFirst({ where: { targetId: QS, action: "quote_updated", afterData: { contains: "海运费要重新问" } } });
    ok(rt.status === 200 && (await status(QS)) === "draft" && !!rtAudit && !String(rtAudit.afterData).includes("\\u0007") && (await db.notification.count({ where: { entityId: QS } })) === 1, "退回：回到草稿，审计里有这句原因（去掉控制字符），没有新通知", rt.body);
    ok((await ret(P8, QS, { baseUpdatedAt: (await fresh(P8, QS)).quote.updatedAt })).status === 409, "草稿不能退回：409");
    const s2 = await submit(P8, QS, { baseUpdatedAt: (await fresh(P8, QS)).quote.updatedAt }, FINEDIT);
    ok(s2.status === 200 && (await db.notification.count({ where: { userId: OWNER, entityId: QS } })) === 2, "退回后再提交：另发一条通知");
    // 负责人在待批准时批准并定为
    const vqs2 = await fresh(P8, QS);
    const ap = await confirm(P8, QS, body(vqs2));
    ok(ap.status === 200 && (await status(QS)) === "approved" && (await pointer(P8))?.bidQuoteId === QS && (await audits(QS, "quote_approved")) === 1, "负责人对待批准的报价「批准并定为我方报价」：已批准、是我方报价", ap.body);
    // 负责人关掉了这类通知
    const { Q: QG, view: vqg } = await pricedLump(P8, 20, "G");
    await db.userNotificationPreference.create({ data: { userId: OWNER, enabledTypesJson: JSON.stringify(DEFAULT_ENABLED_TYPES.filter((t) => t !== "project_update")), metadata: JSON.stringify({ knownTypes: DEFAULT_ENABLED_TYPES }) } });
    const sg = await submit(P8, QG, { baseUpdatedAt: vqg.quote.updatedAt }, FINEDIT);
    ok(sg.status === 200 && (sg.body.notify as { kind?: string }).kind === "gated" && String(sg.body.messageZh).includes("关掉了这类通知") && (await db.notification.count({ where: { entityId: QG } })) === 0, "负责人关掉了项目动态：没有新通知，结果写明", sg.body);
    await db.userNotificationPreference.deleteMany({ where: { userId: OWNER } });
    // 负责人自己提交
    const { Q: QO, view: vqo } = await pricedLump(P8, 22, "O");
    const so = await submit(P8, QO, { baseUpdatedAt: vqo.quote.updatedAt });
    ok(so.status === 200 && (so.body.notify as { kind?: string }).kind === "self" && (await db.notification.count({ where: { entityId: QO } })) === 0, "负责人自己提交：不发通知，写明你就是负责人", so.body);
    // 负责人不是组织在职成员
    const P9 = await mkProject(GHOST);
    const { Q: QH, view: vqh } = await pricedLump(P9, 25, "H").catch(async () => {
      // GHOST 是负责人时 OWNER 不是项目成员：用 FINEDIT 建（有编辑权限与财务查看权）
      const c = await create(P9, { entryMode: "LUMP_SUM", businessType: "SUPPLY_ONLY", name: "H" }, FINEDIT);
      const Qh = String(c.body.id);
      const v0 = (await getLump(P9, Qh, FINEDIT)).body as unknown as LumpView;
      const r = await putLump(P9, Qh, { baseUpdatedAt: v0.quote.updatedAt, state: { ...v0.state, goods: { ...v0.state.goods, amount: 800000, evidenceKind: "ESTIMATE" }, items: v0.state.items.map((i) => ({ ...i, amount: i.key === "ocean_freight" ? 60000 : 40000 })), presets: offPresets(v0.state.presets), targetMarginPct: 25 } }, FINEDIT);
      return { Q: Qh, view: r.body as unknown as LumpView };
    });
    const sh = await submit(P9, QH, { baseUpdatedAt: vqh.quote.updatedAt }, FINEDIT);
    ok(sh.status === 200 && (sh.body.notify as { kind?: string }).kind === "no_recipient" && String(sh.body.messageZh).includes("没人收到通知") && (await db.notification.count({ where: { entityId: QH } })) === 0 && (await status(QH)) === "review", "负责人不是组织在职成员：待批准，没有通知，写明请直接联系有批准权限的同事", sh.body);

    // —— 11b. 专业模式做的报价不在这里定（接口只收逐行 / 总价报价） ——
    {
      const { createEngineQuote } = await import("@/lib/quote-engine/service");
      const P8b = await mkProject();
      const pro = await createEngineQuote({ projectId: P8b, orgId: ORG, userId: OWNER, quoteType: "SUPPLY_ONLY" });
      const proQ = await db.projectQuote.findUnique({ where: { id: pro.id }, select: { updatedAt: true } });
      const beforePro = await snapshot(P8b);
      const rs = [await confirm(P8b, pro.id, { baseUpdatedAt: proQ!.updatedAt.toISOString(), expectedSellingPrice: 0 }), await submit(P8b, pro.id, { baseUpdatedAt: proQ!.updatedAt.toISOString() }), await revise(P8b, pro.id, { reason: "x" })];
      ok(rs.every((r) => r.status === 409 && r.body.code === "PRO_MODE_QUOTE" && String(r.body.error).includes("专业模式")) && (await snapshot(P8b)) === beforePro, "专业模式做的报价：一次定价、提交、另起新版都 409 写明去专业模式，库里不变", rs.map((r) => [r.status, r.body.code]));
    }

    // —— 12. 谁定的：取选定记录 ——
    const P10 = await mkProject();
    const { Q: D1 } = await pricedLump(P10, 25, "D1");
    const { Q: D2 } = await pricedLump(P10, 20, "D2");
    for (const q of [D1, D2]) {
      await transitionQuote({ quoteId: q, projectId: P10, userId: OWNER, orgId: ORG, to: "review" });
      await transitionQuote({ quoteId: q, projectId: P10, userId: OWNER, orgId: ORG, to: "approved" });
    }
    await selectQuoteAsTenderBid({ projectId: P10, quoteId: D2, orgId: ORG, userId: FINEDIT });
    const lv10 = (await list(P10)).body as unknown as ListView;
    ok(lv10.ourBid.status === "AUTHORITATIVE" && lv10.ourBid.quoteId === D2 && lv10.ourBid.decidedBy === nameOf(FINEDIT), "甲批准、乙在专业模式里手动选定：一行写乙", lv10.ourBid);
    await selectQuoteAsTenderBid({ projectId: P10, quoteId: D1, orgId: ORG, userId: FINEDIT });
    await selectQuoteAsTenderBid({ projectId: P10, quoteId: D2, orgId: ORG, userId: OWNER });
    const lv10c = (await list(P10)).body as unknown as ListView;
    ok(lv10c.ourBid.status === "AUTHORITATIVE" && lv10c.ourBid.quoteId === D2 && lv10c.ourBid.decidedBy === nameOf(OWNER), "同一份被选过几次：写最近一次选定的人", lv10c.ourBid);
    await db.auditLog.deleteMany({ where: { targetId: D2, action: { in: ["quote_selected_as_tender_bid", "tender_bid_pointer_synced"] } } });
    const lv10b = (await list(P10)).body as unknown as ListView;
    ok(lv10b.ourBid.status === "AUTHORITATIVE" && lv10b.ourBid.decidedBy === nameOf(OWNER), "没有选定记录：退回用批准人", lv10b.ourBid);

    // —— 13. 导出原因不再叫人去专业模式 ——
    const P11 = await mkProject();
    await pricedLump(P11);
    const lv11 = (await list(P11)).body as unknown as ListView;
    ok(!lv11.export.available && lv11.export.reasonZh === EXPORT_NOT_DECIDED_ZH && !lv11.export.reasonZh.includes("专业模式") && lv11.ourBid.status === "NONE", "没定：导出原因写在这一页定、没有「专业模式」；我方报价一行是还没有", lv11.export);

    // —— 14. 专业模式的状态接口：迁移与改动前相同（开关关着也一样） ——
    delete process.env.TENDER_BID_PAGE_V2_ENABLED;
    const P12 = await mkProject();
    process.env.TENDER_BID_PAGE_V2_ENABLED = "1";
    const { Q: PM } = await pricedLump(P12);
    delete process.env.TENDER_BID_PAGE_V2_ENABLED;
    const u0 = (await db.projectQuote.findUnique({ where: { id: PM }, select: { updatedAt: true } }))!.updatedAt.toISOString();
    const r1 = await proStatus(P12, PM, "review");
    const u1 = (await db.projectQuote.findUnique({ where: { id: PM }, select: { updatedAt: true } }))!.updatedAt.toISOString();
    const r2 = await proStatus(P12, PM, "approved");
    const evPm = await events(P12, PM);
    const actPm = (await db.auditLog.findMany({ where: { targetId: PM }, orderBy: { createdAt: "asc" }, select: { action: true, afterData: true } })).filter((a) => a.action !== "quote_created" && a.action !== "quote_updated");
    ok(r1.status === 200 && r1.body.status === "review" && r2.status === 200 && r2.body.status === "approved" && (await pointer(P12))?.bidQuoteId === PM, "专业模式状态接口：送审、批准照旧，批准后自动选中");
    ok(evPm.map((e) => e.eventKey).join("|") === [quoteStatusEventKey(PM, "review", u0), quoteStatusEventKey(PM, "approved", u1)].join("|"), "专业模式：台账去重键 = 目标状态 + 迁移前修改时间（与改动前的规则相同）", evPm);
    ok(actPm.map((a) => a.action).join(",") === "quote_submitted_for_review,quote_selected_as_tender_bid,quote_approved" && actPm.every((a) => !String(a.afterData).includes("bid_page")), "专业模式：审计 action 与先后照旧（送审 → 同步选中 → 批准），不带 bid_page", actPm.map((a) => a.action));
    const rvPm = await reviseQuote_(P12, PM);
    ok(rvPm && (await status(PM)) === "superseded" && (await resolveTenderBid({ projectId: P12, orgId: ORG, internal: true })).status === "QUOTE_REVISION_PENDING", "专业模式另起新版：原版被替代、我方报价新版待定（照旧）");
    process.env.TENDER_BID_PAGE_V2_ENABLED = "1";
  } finally {
    for (const k of ENV_KEYS) delete process.env[k];
    await db.userNotificationPreference.deleteMany({ where: { userId: { in: users } } });
    await db.project.updateMany({ where: { id: { in: projectIds } }, data: { bidQuoteId: null } });
    await db.projectEvent.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
    await db.projectQuote.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.notification.deleteMany({ where: { OR: [{ userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: users } } }).catch(() => undefined);
    await db.$disconnect();
  }

  /** 专业模式另起新版（与专业模式页面同一个服务） */
  async function reviseQuote_(P: string, Q: string): Promise<boolean> {
    const { reviseQuote } = await import("@/lib/quote-engine/service");
    const nq = await reviseQuote({ quoteId: Q, projectId: P, userId: OWNER, orgId: ORG, reason: "专业模式修订" });
    return !!nq.id;
  }

  console.log(`\nBIDPAGE-6 定报价 隔离库：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
