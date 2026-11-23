/**
 * BIDPAGE-1「标书与报价」页汇总接口——真实 DB（隔离库）经真实路由处理函数
 * （openspec change bid-page-v2-shell，spec tender/bid-page「汇总接口」「汇总接口只把金额给有成本与财务查看权的人」「下一步是确定性的查表」）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/bid-page-v2/__tests__/bid-page-summary-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 供应商 / 合成金额）。不发任何邮件、不批准任何询价卡。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 BIDPAGE-1 汇总接口 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "BIDPAGE-1 bid page summary DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 2000) : ""); }
}

type View = {
  rule: string;
  headlineZh: string;
  reasonZh: string | null;
  alsoZh: string | null;
  action: { labelZh: string; target: { kind: string; section?: string; tab?: string } };
  expanded: string;
  sections: Record<"sourcing" | "quote" | "documents", { statusZh: string }>;
  quote: { decided: boolean; amount?: { value: number; currency: string } };
  viewer: { canViewAmounts: boolean };
};
type Body = { enabled?: boolean; view?: View; error?: string };

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { createEngineQuote, updateEngineQuote, transitionQuote } = await import("@/lib/quote-engine/service");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const route = await import("@/app/api/projects/[id]/bid-page-summary/route");

  console.log("BIDPAGE-1 bid page summary — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `bpowner_${stamp}`, VIEWER = `bpviewer_${stamp}`, OPERATOR = `bpop_${stamp}`, ORGMATE = `bpmate_${stamp}`, OUTSIDER = `bpout_${stamp}`;
  const ORGADMIN = `bpadmin_${stamp}`, FINREAD = `bpfin_${stamp}`;
  const ORG = `bporg_${stamp}`, ORG_B = `bporgb_${stamp}`;
  const users = [OWNER, VIEWER, OPERATOR, ORGMATE, OUTSIDER, ORGADMIN, FINREAD];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000;
  const ENV_KEYS = ["TENDER_BID_PAGE_V2_ENABLED", "TENDER_BID_PAGE_V2_ORG_ALLOWLIST", "TENDER_QUOTE_ENGINE_ENABLED", "TENDER_BID_WORKSPACE_ENABLED", "TENDER_WEB_NEXT_STEP_ENABLED"];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.TENDER_QUOTE_ENGINE_ENABLED = "1";

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `bp-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `bpb-${stamp}`, ownerId: OUTSIDER } });
  for (const [u, role] of [[OWNER, "org_admin"], [VIEWER, "org_member"], [OPERATOR, "org_member"], [ORGMATE, "org_member"], [ORGADMIN, "org_admin"], [FINREAD, "org_member"]] as const) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: u, role, status: "active" } });
  }
  // 岗位模板：accounting 在 ORG 范围持 project.finance.read
  await seedOrgAuthorizationProfiles(ORG);
  const accounting = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key: "accounting" } } });
  if (!accounting) throw new Error("缺少岗位模板 accounting");
  await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: FINREAD, roleProfileId: accounting.id, status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });

  const projectIds: string[] = [];
  const supplierIds: string[] = [];
  let seq = 0;
  async function mkProject(o: { orgId?: string; ownerId?: string; workDomain?: string } = {}) {
    seq += 1;
    const id = `bpproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: o.orgId ?? ORG, ownerId: o.ownerId ?? OWNER, workDomain: o.workDomain ?? "tender", intakeStatus: "dispatched", closeDate: new Date(Date.now() + 20 * DAY) } });
    return id;
  }
  const mkSupplier = async (name: string) => {
    const s = await db.supplier.create({ data: { orgId: ORG, name, contactEmail: `${name.toLowerCase().replace(/[^a-z]/g, "")}${stamp}@fixture.test`, status: "active", createdById: OWNER } });
    supplierIds.push(s.id);
    return s.id;
  };
  const approveRun = (projectId: string, status = "APPROVED") =>
    db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId, status, idempotencyKey: `bp-${stamp}-run-${projectId}-${status}`, sourceHashFingerprint: "fixture", createdById: OWNER } });

  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: "user" })}`;
  const call = async (projectId: string, userId: string | null = OWNER) => {
    const res = await route.GET(new NextRequest(`http://localhost/api/projects/${projectId}/bid-page-summary`, { headers: userId ? { cookie: await cookieOf(userId) } : {} }), { params: Promise.resolve({ id: projectId }) });
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as Body };
  };
  const view = async (projectId: string, userId: string = OWNER): Promise<View> => {
    const r = await call(projectId, userId);
    if (!r.body.view) throw new Error(`no view: ${r.status} ${r.text}`);
    return r.body.view;
  };
  const snapshot = async () =>
    JSON.stringify({
      quotes: (await db.projectQuote.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true, summaryJson: true } })).map((q) => [q.id, q.status, q.updatedAt.toISOString(), q.summaryJson]),
      costLines: await db.quoteCostLine.count({ where: { quote: { projectId: { in: projectIds } } } }),
      projects: (await db.project.findMany({ where: { id: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true, bidQuoteId: true, ourBidPrice: true } })).map((p) => [p.id, p.updatedAt.toISOString(), p.bidQuoteId, p.ourBidPrice]),
      inquiries: (await db.projectInquiry.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } })).map((r) => [r.id, r.status, r.updatedAt.toISOString()]),
      items: (await db.inquiryItem.findMany({ where: { inquiry: { projectId: { in: projectIds } } }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } })).map((r) => [r.id, r.status, r.updatedAt.toISOString()]),
      links: (await db.projectSupplierLink.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, role: true, updatedAt: true } })).map((r) => [r.id, r.role, r.updatedAt.toISOString()]),
      actions: (await db.pendingAction.findMany({ where: { OR: [{ projectId: { in: projectIds } }, { orgId: { in: [ORG, ORG_B] } }] }, orderBy: { id: "asc" }, select: { id: true, status: true, decidedAt: true, executedAt: true } })).map((a) => [a.id, a.status, a.decidedAt, a.executedAt]),
      notifications: await db.notification.count({ where: { userId: { in: users } } }),
      audits: await db.auditLog.count({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } }),
      docs: await db.projectGeneratedDocument.count({ where: { projectId: { in: projectIds } } }),
      rooms: await db.bidIntelligenceRoom.count({ where: { projectId: { in: projectIds } } }),
    });

  try {
    const P = await mkProject();
    await db.projectMember.create({ data: { projectId: P, userId: VIEWER, role: "viewer", status: "active" } });
    await db.projectMember.create({ data: { projectId: P, userId: OPERATOR, role: "operator", status: "active" } });
    await db.projectMember.create({ data: { projectId: P, userId: FINREAD, role: "viewer", status: "active" } });

    // —— 1. 开关与权限（规格场景「开关与权限」）——
    const off = await call(P);
    ok(off.status === 404 && !off.body.view && off.body.enabled === undefined, "开关未设：404，没有内容", off.body);
    const offAnon = await call(P, null);
    ok(offAnon.status === 404 && !offAnon.body.view, "开关未设、没登录：也是 404（总闸在鉴权之前判）", offAnon.status);
    const offOutsider = await call(P, OUTSIDER);
    ok(offOutsider.status === 404 && !offOutsider.text.includes("Fixture Tender"), "开关未设、别的组织的人：404，没有项目内容", offOutsider.status);
    process.env.TENDER_BID_PAGE_V2_ENABLED = "1";
    process.env.TENDER_BID_PAGE_V2_ORG_ALLOWLIST = ORG_B;
    ok((await call(P)).status === 404, "功能只对别的组织开放：404");
    process.env.TENDER_BID_PAGE_V2_ORG_ALLOWLIST = `${ORG_B}, ${ORG}`;
    const on = await call(P);
    ok(on.status === 200 && on.body.enabled === true && !!on.body.view, "组织在名单里：200，enabled = true", on.body);
    delete process.env.TENDER_BID_PAGE_V2_ORG_ALLOWLIST;
    ok((await call(P)).status === 200, "名单为空：所有组织都开");
    const anon = await call(P, null);
    ok(anon.status === 401 && !anon.body.view, "没登录：401", anon.status);
    const outsider = await call(P, OUTSIDER);
    ok(outsider.status >= 400 && outsider.status < 500 && !outsider.body.view && !outsider.text.includes("Fixture Tender"), "别的组织的人：被拒，拿不到项目内容", outsider.status);
    const orgmate = await call(P, ORGMATE);
    ok(orgmate.status >= 400 && orgmate.status < 500 && !orgmate.body.view, "本组织的人但不是项目成员：被拒", orgmate.status);
    const NT = await mkProject({ workDomain: "trade" });
    ok((await call(NT)).status === 404, "不是招投标项目：404");

    // —— 2. 七条规则在真实数据上各走一遍 ——
    const before = await snapshot();
    let v = await view(P);
    ok(v.rule === "requirements_unapproved" && v.reasonZh === "还没有招标分析" && v.action.target.kind === "tab" && v.expanded === "sourcing", "没有分析 → 先去「招标要求」确认要求", v);
    await approveRun(P, "REVIEW_REQUIRED");
    v = await view(P);
    ok(v.rule === "requirements_unapproved" && v.reasonZh === "招标分析还没批准", "分析待审 → 仍是先去「招标要求」", v);
    await db.tenderAnalysisRun.updateMany({ where: { projectId: P }, data: { status: "APPROVED" } });
    v = await view(P);
    ok(v.rule === "no_suppliers" && v.sections.sourcing.statusZh === "还没有供应商", "分析已批准、没有供应商 → 添加供应商或起草询价", v);

    const sA = await mkSupplier("Alpha Fixture Textiles");
    const sB = await mkSupplier("Beta Fixture Mills");
    const sC = await mkSupplier("Gamma Fixture Co");
    await db.projectSupplierLink.create({ data: { orgId: ORG, projectId: P, supplierId: sA, role: "candidate" } });
    await db.projectSupplierLink.create({ data: { orgId: ORG, projectId: P, supplierId: sC, role: "rejected" } });
    v = await view(P);
    ok(v.rule === "no_rfq_sent" && v.sections.sourcing.statusZh === "1 家供应商，还没询价", "关联了一家（另一家标了未入选，不算）→ 起草询价", v);

    const round1 = await db.projectInquiry.create({ data: { projectId: P, roundNumber: 1, title: "round 1", scope: "x", status: "draft", createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: round1.id, supplierId: sA, status: "pending", createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: round1.id, supplierId: sB, status: "pending", createdById: OWNER } });
    await db.pendingAction.create({ data: { type: "tender.send_rfq", title: "第 1 轮询价（2 家）", preview: "fixture", payload: { inquiryId: round1.id }, status: "pending", createdById: OWNER, orgId: ORG, projectId: P, expiresAt: new Date(Date.now() + 72 * 3600_000), idempotencyKey: `bp-${stamp}-card1` } });
    await db.pendingAction.create({ data: { type: "tender.send_rfq", title: "过期的卡", preview: "fixture", payload: { inquiryId: round1.id }, status: "pending", createdById: OWNER, orgId: ORG, projectId: P, expiresAt: new Date(Date.now() - 3600_000), idempotencyKey: `bp-${stamp}-card2` } });
    v = await view(P);
    ok(v.rule === "rfq_pending_approval" && v.reasonZh === "有 1 张询价卡等批准" && v.sections.sourcing.statusZh === "询价已起草，等批准", "两家在待批询价里（过期的卡不算）→ 询价已起草，等批准后发出", v);
    ok(!JSON.stringify(v).includes("第 1 轮询价（2 家）"), "响应里不出审批卡的标题");
    const viewerV = await view(P, VIEWER);
    ok(viewerV.rule === "rfq_pending_approval", "看不到这张卡的只读成员也得出同一条（不按看的人过滤）", viewerV.rule);

    await db.pendingAction.updateMany({ where: { projectId: P }, data: { status: "executed", executedAt: new Date() } });
    await db.projectInquiry.update({ where: { id: round1.id }, data: { status: "in_progress" } });
    await db.inquiryItem.updateMany({ where: { inquiryId: round1.id }, data: { status: "sent", sentAt: new Date(Date.now() - 3 * DAY - 3600_000) } });
    v = await view(P);
    ok(v.rule === "waiting_replies" && v.headlineZh === "等供应商回复（已等 3 天）" && v.sections.sourcing.statusZh === "2 家已询价，0 家已回", "两家已发、3 天没回 → 等供应商回复（已等 3 天）", v);

    await db.inquiryItem.updateMany({ where: { inquiryId: round1.id, supplierId: sB }, data: { status: "declined", declinedAt: new Date() } });
    v = await view(P);
    ok(v.rule === "waiting_replies" && v.sections.sourcing.statusZh === "2 家已询价，1 家已回", "一家拒绝、一家还在等 → 仍在等", v);
    await db.inquiryItem.updateMany({ where: { inquiryId: round1.id, supplierId: sA }, data: { status: "quoted", repliedAt: new Date(), totalPrice: 7777.77 } });
    v = await view(P);
    ok(v.rule === "start_quote" && v.reasonZh === "已有 1 家报价" && v.expanded === "quote" && v.sections.sourcing.statusZh === "2 家已询价，2 家已回", "一家报价 → 开始做报价", v);
    ok(!JSON.stringify(v).includes("7777") && !JSON.stringify(v).includes("7,777"), "响应里没有供应商报价");
    ok(v.sections.quote.statusZh === "还没有报价", "② 还没有报价", v.sections.quote);

    // 报价草稿 → 待批准 → 已批准（自动成为我方报价）
    const q = await createEngineQuote({ projectId: P, orgId: ORG, userId: OWNER, quoteType: "SUPPLY_ONLY", seedTemplate: false });
    await updateEngineQuote({ quoteId: q.id, projectId: P, userId: OWNER, header: { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: 20 }, lines: [{ sortOrder: 10, category: "PROCUREMENT", description: "Fixture goods", calculationType: "FIXED", unitCost: 9876, quantity: null, sourceCurrency: "CAD", fxRate: null, rate: null, duration: null, included: true }] });
    v = await view(P);
    ok(v.rule === "quote_draft" && v.reasonZh === `第 ${q.version} 版是草稿` && v.sections.quote.statusZh === `草稿（第 ${q.version} 版），未定`, "有草稿 → 检查后定为我方报价", v);
    await transitionQuote({ quoteId: q.id, projectId: P, userId: OWNER, orgId: ORG, to: "review" });
    v = await view(P);
    ok(v.rule === "quote_draft" && v.sections.quote.statusZh === `待批准（第 ${q.version} 版），未定`, "待批准 → 仍是检查后定为我方报价", v.sections.quote);
    await transitionQuote({ quoteId: q.id, projectId: P, userId: OWNER, orgId: ORG, to: "approved" });
    const afterSetup = await snapshot();

    // —— 3. 金额只给有成本与财务查看权的人（规格场景「只读成员看不到金额」「项目负责人看得到金额」）——
    const owner = await call(P, OWNER);
    ok(owner.body.view?.rule === "bid_decided" && owner.body.view.sections.quote.statusZh === "我方报价 12,345.00 加元，已定" && owner.body.view.quote.amount?.value === 12345 && owner.body.view.quote.amount.currency === "CAD", "项目负责人：我方报价 12,345.00 加元，已定，带金额与币种", owner.body.view);
    ok(owner.body.view?.viewer.canViewAmounts === true, "项目负责人：viewer.canViewAmounts = true");
    const fin = await call(P, FINREAD);
    ok(fin.status === 200 && fin.body.view?.sections.quote.statusZh === "我方报价 12,345.00 加元，已定" && fin.body.view.viewer.canViewAmounts === true, "持 ORG 范围 project.finance.read 的项目成员：看得到金额", fin.body.view);
    for (const [who, uid] of [["项目只读成员（带 project:cost:read、没有财务查看权）", VIEWER], ["项目操作员（能看能改内部成本、没有财务查看权）", OPERATOR], ["组织管理员（不是负责人、没有财务键）", ORGADMIN]] as const) {
      const r = await call(P, uid);
      ok(r.status === 200 && r.body.view?.rule === "bid_decided" && r.body.view.sections.quote.statusZh === "我方报价已定" && r.body.view.viewer.canViewAmounts === false, `${who}：我方报价已定、viewer.canViewAmounts = false`, r.body.view);
      ok(!/12,?345|9,?876|7,?777|加元|"amount"|"currency"|"CAD"/.test(r.text), `${who}：整个响应里没有金额（12345 / 12345.00 / 12,345.00）、成本、供应商报价与币种`, r.text);
    }
    // 对任何人：响应里只有我方报价售价一个金额，没有成本、毛利、供应商报价
    ok(!/9,?876|7,?777|estimatedCost|grossMargin|grossProfit|markup|unitPrice|totalPrice|candidates|mirror|"reason"/.test(owner.text), "项目负责人：响应里也没有成本、毛利、供应商报价，也不透传我方报价解析的其它字段", owner.text);
    delete process.env.TENDER_QUOTE_ENGINE_ENABLED;
    const engineOff = await call(P, OWNER);
    ok(engineOff.status === 200 && engineOff.body.view?.sections.quote.statusZh === "报价功能未开通" && !/12,?345|"amount"/.test(engineOff.text), "报价功能未开通：负责人也拿不到金额", engineOff.text);
    process.env.TENDER_QUOTE_ENGINE_ENABLED = "1";

    // —— 4. 生成文件（有编辑权限的人才说生成了几种）——
    await db.projectGeneratedDocument.create({ data: { orgId: ORG, projectId: P, docType: "internal_analysis", title: "fixture", blobUrl: "https://fixture.test/a.pdf", metaJson: JSON.stringify({ renderMode: "chromium_pdf" }) } });
    await db.projectGeneratedDocument.create({ data: { orgId: ORG, projectId: P, docType: "internal_analysis", title: "fixture v2", blobUrl: "https://fixture.test/b.pdf", metaJson: JSON.stringify({ renderMode: "chromium_pdf" }) } });
    await db.projectGeneratedDocument.create({ data: { orgId: ORG, projectId: P, docType: "teammate_tasks", title: "garbled", blobUrl: "https://fixture.test/c.pdf", metaJson: null } });
    v = await view(P, OWNER);
    ok(v.sections.documents.statusZh === "已生成 1 种文件", "负责人：同一种生成两次算一种，乱码旧件不算 → 已生成 1 种文件", v.sections.documents);
    ok((await view(P, VIEWER)).sections.documents.statusZh === "需要项目编辑权限", "只读成员：需要项目编辑权限");
    const afterDocs = await snapshot();

    // —— 5. 不写库（规格场景「不写库」）——
    for (let i = 0; i < 3; i++) { await call(P, OWNER); await call(P, VIEWER); await call(P, OPERATOR); }
    ok((await snapshot()) === afterDocs, "反复调用前后：报价、询价、审批、通知、审计、生成文件、关联卡都没变");
    ok(before !== afterSetup, "（对照）测试自己改数据时快照确实会变");

    // —— 6. 报价状态优先于找供应商：一个没有供应商、直接定了价的项目 ——
    const P2 = await mkProject();
    await approveRun(P2);
    const q2 = await createEngineQuote({ projectId: P2, orgId: ORG, userId: OWNER, quoteType: "SUPPLY_ONLY", seedTemplate: false });
    await updateEngineQuote({ quoteId: q2.id, projectId: P2, userId: OWNER, header: { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: 25 }, lines: [{ sortOrder: 10, category: "PROCUREMENT", description: "Fixture goods", calculationType: "FIXED", unitCost: 900000, quantity: null, sourceCurrency: "CAD", fxRate: null, rate: null, duration: null, included: true }] });
    ok((await view(P2)).rule === "quote_draft", "没有供应商、有草稿 → 检查后定为我方报价（不是添加供应商）");
    await transitionQuote({ quoteId: q2.id, projectId: P2, userId: OWNER, orgId: ORG, to: "review" });
    await transitionQuote({ quoteId: q2.id, projectId: P2, userId: OWNER, orgId: ORG, to: "approved" });
    const v2 = await view(P2);
    ok(v2.rule === "bid_decided" && v2.sections.quote.statusZh === "我方报价 1,200,000.00 加元，已定" && v2.sections.sourcing.statusZh === "还没有供应商", "没有供应商、已定 → 导出价格表 / 生成投标文件", v2);

    // —— 7. 取消的轮次不算 ——
    const P3 = await mkProject();
    await approveRun(P3);
    const dead = await db.projectInquiry.create({ data: { projectId: P3, roundNumber: 1, title: "canceled", scope: "x", status: "canceled", createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: dead.id, supplierId: sA, status: "quoted", sentAt: new Date(), createdById: OWNER } });
    const v3 = await view(P3);
    ok(v3.rule === "no_suppliers" && v3.sections.sourcing.statusZh === "还没有供应商", "只有已取消的轮次 → 不算有供应商、不算询价过", v3);

    // —— 8. 已批准两份、还没选为我方报价 ——
    const P4 = await mkProject();
    await approveRun(P4);
    for (const cost of [8000, 9000]) {
      const qq = await createEngineQuote({ projectId: P4, orgId: ORG, userId: OWNER, quoteType: "SUPPLY_ONLY", seedTemplate: false });
      await updateEngineQuote({ quoteId: qq.id, projectId: P4, userId: OWNER, header: { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: 20 }, lines: [{ sortOrder: 10, category: "PROCUREMENT", description: "Fixture goods", calculationType: "FIXED", unitCost: cost, quantity: null, sourceCurrency: "CAD", fxRate: null, rate: null, duration: null, included: true }] });
      await transitionQuote({ quoteId: qq.id, projectId: P4, userId: OWNER, orgId: ORG, to: "review" });
      await transitionQuote({ quoteId: qq.id, projectId: P4, userId: OWNER, orgId: ORG, to: "approved" });
    }
    await db.project.update({ where: { id: P4 }, data: { bidQuoteId: null, ourBidPrice: null } });
    const v4 = await view(P4);
    ok(v4.rule === "quote_draft" && v4.reasonZh === "已批准 2 份，还没选为我方报价" && v4.sections.quote.statusZh === "已批准 2 份，还没选为我方报价", "两份已批准、没选为我方报价 → 检查后定为我方报价", v4);

    // —— 9. 回复了没报价、没人在等 → 把供应商的报价记下来 ——
    const P5 = await mkProject();
    await approveRun(P5);
    const r5 = await db.projectInquiry.create({ data: { projectId: P5, roundNumber: 1, title: "round 1", scope: "x", status: "in_progress", createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: r5.id, supplierId: sA, status: "replied", sentAt: new Date(Date.now() - 2 * DAY), repliedAt: new Date(), createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: r5.id, supplierId: sB, status: "declined", sentAt: new Date(Date.now() - 2 * DAY), declinedAt: new Date(), createdById: OWNER } });
    const v5 = await view(P5);
    ok(v5.rule === "replies_to_record" && v5.reasonZh === "1 家回复了，报价还没录入" && v5.sections.sourcing.statusZh === "2 家已询价，2 家已回", "一家回复没报价、一家拒绝 → 把供应商的报价记下来", v5);

    // —— 10. 分析待审、但已经发了询价 → 照实际进度，顺带一句 ——
    const P6 = await mkProject();
    await approveRun(P6, "REVIEW_REQUIRED");
    const r6 = await db.projectInquiry.create({ data: { projectId: P6, roundNumber: 1, title: "round 1", scope: "x", status: "in_progress", createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: r6.id, supplierId: sA, status: "sent", sentAt: new Date(Date.now() - 2 * DAY - 3600_000), createdById: OWNER } });
    const v6 = await view(P6);
    ok(v6.rule === "waiting_replies" && v6.headlineZh === "等供应商回复（已等 2 天）" && v6.alsoZh === "招标要求还没批准", "分析待审、已发询价 → 等供应商回复，另外说招标要求还没批准", v6);

    // —— 11. 别的组织的项目：这边的人被拒 ——
    const PB = await mkProject({ orgId: ORG_B, ownerId: OUTSIDER });
    ok((await call(PB, OWNER)).status >= 400, "别的组织的项目：这边的人被拒");
  } finally {
    for (const k of ENV_KEYS) delete process.env[k];
    await db.pendingAction.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { orgId: { in: [ORG, ORG_B] } }] } });
    await db.projectGeneratedDocument.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.updateMany({ where: { id: { in: projectIds } }, data: { bidQuoteId: null } });
    await db.projectQuote.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectSupplierLink.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nBIDPAGE-1 bid page summary DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
