/**
 * FIX-26 旧报价单、报价 AI、智能体报价技能、问青砚两个报价工具与审计日志详情只给有财务查看权的人看内部成本与利润率——
 * 真实 DB（隔离库），调用真实路由 / 工具
 * （openspec change legacy-quote-finance-gate，spec projects/legacy-quote-finance-view 各条 Requirement 的隔离库场景）
 *
 * 八种身份：只读成员、不是负责人的项目管理员、operator、不是项目成员也没有财务键的组织管理员、只在分配范围持
 * `project.finance.read` 的投标同事（bids 岗位，operator）、持组织范围 `project.finance.read` 且项目角色为 viewer 的成员（accounting 岗位）、
 * 项目负责人、平台超级管理员；另有不是项目成员的普通组织成员（工具）、组织管理员 + accounting 岗位（审计详情）、
 * 负责人是导入用的系统账号的项目（提示改句）。
 * 旧报价单与报价引擎 / 逐行报价 / 只报总价的报价各一份，用少见的数（成本价 17.31、内部成本 91,234.56、利润率 23.45、
 * 引擎快照估算成本 87,654.32、定价比例 27.13），在没有权限的人的响应里搜。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目）。
 * 模型端是本机起的 OpenAI 兼容假服务（OPENAI_BASE_URL 指过去），记下每次请求，不打真模型；不发任何邮件。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-26 旧报价单财务查看权 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-26 legacy quote finance view DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);

/** 少见的数 / 文字：没有财务查看权的人的响应里都不该出现 */
const COST_PRICE = 17.31;
const INTERNAL_COST = 91234.56;
const MARGIN = 23.45;
const ENGINE_COST = 87654.32;
const ENGINE_MARGIN = 23.7;
const PRICING_RATE = 27.13;
const SELLING = 114881.15;
const RARE_NOTE = "内部备注稀有词-LQ47";
const RARE_DRAFT = "按供应商报价加价-稀有词LQ58";
const RARE_REVIEW = "审查稀有词-LQ69";
const SECRETS = ["17.31", "91234.56", "91,234.56", "23.45", "87654.32", "87,654.32", RARE_NOTE, RARE_DRAFT, RARE_REVIEW];
/** 搜少见数字时去掉时间戳（秒与毫秒可能恰好拼出「23.45」这类数） */
const hay = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>");
const leaks = (t: string, list: string[] = SECRETS) => list.filter((s) => hay(t).includes(s));

/* 句子（与规格逐字相同；这里写死，不从实现取） */
const S_WRITE = "没有改动：你不是本项目负责人，不能新建、修改、确认或删除报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。";
const S_WRITE_NO_OWNER = "没有改动：你不是本项目负责人，不能新建、修改、确认或删除报价单。这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人。";
const S_DRAFT = "没有生成：你不是本项目负责人，不能用 AI 起草报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。";
const S_REVIEW = "AI 审查用到的成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。";
const S_ENGINE = "这份报价是在报价页里做的，旧报价单不能打开或修改它；请到报价页查看和修改。";
const S_SKILL_DRAFT = "没有起草：起草报价草稿要看供应商报价并填成本价，只给项目负责人和有全企业「查看项目结算」权限的人用。";

// ── 本机 OpenAI 兼容假服务：按队列回复，记录每次请求 ──
const replies: string[] = [];
const received: Array<{ system: string; user: string }> = [];
const REVIEW_REPLY = JSON.stringify({ overallRisk: "low", summary: "fixture 审查", issues: [], strengths: ["齐全"], suggestions: [] });
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}") as { model?: string; messages?: Array<{ role: string; content: string }> };
    const msgs = parsed.messages ?? [];
    received.push({ system: msgs.find((m) => m.role !== "user")?.content ?? "", user: msgs.find((m) => m.role === "user")?.content ?? "" });
    const content = replies.shift() ?? REVIEW_REPLY;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "chatcmpl-test", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: parsed.model ?? "test-model", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
  });
});

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const prevEnv = { base: process.env.OPENAI_BASE_URL, key: process.env.OPENAI_API_KEY };
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.OPENAI_API_KEY = "test-key";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { createEngineQuote, reviseQuote } = await import("@/lib/quote-engine/service");
  const { createLineQuote } = await import("@/lib/bid-page-v2/quote-line/service");
  const { createLumpQuote } = await import("@/lib/bid-page-v2/lump-sum/service");
  const { getQuoteReviewPrompt, getQuoteDraftPrompt } = await import("@/lib/ai/prompts");
  const { getProjectAiMemory, buildMemoryBlock } = await import("@/lib/ai/memory");
  const listRoute = await import("@/app/api/projects/[id]/quotes/route");
  const oneRoute = await import("@/app/api/projects/[id]/quotes/[quoteId]/route");
  const reviewRoute = await import("@/app/api/projects/[id]/quotes/[quoteId]/ai/review/route");
  const draftRoute = await import("@/app/api/projects/[id]/quotes/ai/generate-draft/route");
  const saveDraftRoute = await import("@/app/api/projects/[id]/quotes/save-ai-draft/route");
  const auditRoute = await import("@/app/api/audit-logs/[id]/route");
  await import("@/lib/agent-core/tools/project-skills");
  await import("@/lib/agent-core/tools/enterprise-readonly");
  const { registry } = await import("@/lib/agent-core/tool-registry");

  console.log("FIX-26 legacy quote finance view — isolated DB");
  const stamp = Date.now().toString(36);
  const id = (k: string) => `lqf${k}_${stamp}`;
  const ORG_OWNER = id("orgowner"), OWNER = id("owner"), VIEWER = id("viewer"), PADMIN = id("padmin"), OPER = id("oper"), ADMIN = id("admin"), BIDS = id("bids"), ACC = id("acc"), SUPER = id("super"), MEMBER = id("member"), ADMIN_ACC = id("adminacc");
  const users = [ORG_OWNER, OWNER, VIEWER, PADMIN, OPER, ADMIN, BIDS, ACC, SUPER, MEMBER, ADMIN_ACC];
  const ORG = id("org");
  const P = `lqfproj_${stamp}`;
  const P2 = `lqfother_${stamp}`;
  const PSYS = `lqfsys_${stamp}`;
  const PIDS = [P, P2, PSYS];
  let createdSystemUser: string | null = null;
  const email = (u: string) => `${u}@fixture.test`;
  const now = new Date();

  const cookieOf = async (u: string) => `qy_session=${await createSession({ sub: u, email: email(u), role: u === SUPER ? "super_admin" : "user" })}`;
  type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
  const call = async (handler: Handler, url: string, u: string, params: Record<string, string>, init: { method?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { cookie: await cookieOf(u) };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const res = await handler(new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) }), { params: Promise.resolve(params) });
    const text = await res.text();
    let body: Rec = {};
    try { body = rec(JSON.parse(text || "null")); } catch { body = {}; }
    return { status: res.status, text, body };
  };
  const tool = async (name: string, u: string, args: Rec) => {
    const t = registry.get(name);
    if (!t) throw new Error(`工具没注册：${name}`);
    const r = await t.execute({ args, userId: u, orgId: ORG } as never);
    return { r, text: JSON.stringify(r) };
  };
  const snap = async (qid: string) => JSON.stringify(await db.projectQuote.findUnique({ where: { id: qid }, include: { lineItems: { orderBy: { sortOrder: "asc" } }, costLines: { orderBy: { sortOrder: "asc" } } } }));
  const quoteCount = () => db.projectQuote.count({ where: { projectId: P } });

  try {
    /* ---------- fixture ---------- */
    for (const u of users) await db.user.create({ data: { id: u, email: email(u), name: `Fixture ${u}`, role: u === SUPER ? "super_admin" : "user" } });
    await db.organization.create({ data: { id: ORG, name: "Fixture Legacy Quote Inc.", code: `lqf-${stamp}`, ownerId: ORG_OWNER, industryPackId: "window_covering_services_v1" } as never });
    await db.organizationMember.create({ data: { orgId: ORG, userId: ORG_OWNER, role: "org_owner", status: "active" } });
    for (const u of [OWNER, VIEWER, PADMIN, OPER, BIDS, ACC, MEMBER]) await db.organizationMember.create({ data: { orgId: ORG, userId: u, role: "org_member", status: "active" } });
    for (const u of [ADMIN, ADMIN_ACC]) await db.organizationMember.create({ data: { orgId: ORG, userId: u, role: "org_admin", status: "active" } });
    await seedOrgAuthorizationProfiles(ORG);
    const bind = async (userId: string, key: string) => {
      const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
      if (!profile) throw new Error(`缺少岗位模板 ${key}`);
      await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
    };
    await bind(BIDS, "bids"); // project.finance.read 只在 ASSIGNED 范围
    await bind(ACC, "accounting"); // project.finance.read 在 ORG 范围
    await bind(ADMIN_ACC, "accounting");

    const projectData = { name: `Fixture Legacy ${stamp}`, clientOrganization: "Fixture Client Board", description: "fixture 旧报价单项目", location: "Toronto", currency: "CAD", closeDate: new Date(Date.UTC(2027, 0, 15)) };
    await db.project.create({ data: { id: P, ...projectData, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active" } as never });
    await db.project.create({ data: { id: P2, name: `Fixture Other ${stamp}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active" } as never });
    for (const [u, role] of [[OWNER, "project_admin"], [VIEWER, "viewer"], [PADMIN, "project_admin"], [OPER, "operator"], [BIDS, "operator"], [ACC, "viewer"]] as const) {
      await db.projectMember.create({ data: { projectId: P, userId: u, role, status: "active" } });
    }
    for (const [u, role] of [[OWNER, "project_admin"], [VIEWER, "viewer"]] as const) await db.projectMember.create({ data: { projectId: P2, userId: u, role, status: "active" } });

    const legacyHeader = { templateType: "export_standard", currency: "CAD", tradeTerms: "FOB", paymentTerms: "T/T 30/70", deliveryDays: 21, validUntil: new Date(Date.UTC(2027, 1, 1)), moq: 50, originCountry: "China" };
    const QL = await db.projectQuote.create({
      data: {
        projectId: P, version: 1, status: "draft", title: "Legacy Fixture Quote", ...legacyHeader,
        subtotal: 119175, totalAmount: 119175, internalCost: INTERNAL_COST, profitMargin: MARGIN, internalNotes: RARE_NOTE,
        aiGenerated: true, aiDraftJson: JSON.stringify({ lines: [{ itemName: "Roller blind", costPrice: COST_PRICE }], reasoning: RARE_DRAFT }), aiReviewJson: JSON.stringify({ summary: RARE_REVIEW }),
        createdById: OWNER,
        lineItems: { create: [{ sortOrder: 0, category: "product", itemName: "Roller blind", specification: "1.2m", unit: "pc", quantity: 100, unitPrice: 18, totalPrice: 1800, remarks: "fixture", costPrice: COST_PRICE, isInternal: false }] },
      },
      select: { id: true },
    });
    const QL_EDIT = await db.projectQuote.create({ data: { projectId: P, version: 2, status: "draft", title: "Legacy Edit Quote", ...legacyHeader, subtotal: 1800, totalAmount: 1800, internalCost: 1731, profitMargin: 3.83, createdById: OWNER, lineItems: { create: [{ sortOrder: 0, category: "product", itemName: "Roller blind", quantity: 100, unitPrice: 18, totalPrice: 1800, costPrice: COST_PRICE }] } }, select: { id: true } });
    const QL_DEL = await db.projectQuote.create({ data: { projectId: P, version: 3, status: "draft", title: "Legacy Delete Quote", ...legacyHeader, createdById: OWNER }, select: { id: true } });
    const QL_OTHER = await db.projectQuote.create({ data: { projectId: P2, version: 1, status: "draft", title: "Other Project Quote", ...legacyHeader, internalCost: INTERNAL_COST, profitMargin: MARGIN, createdById: OWNER, lineItems: { create: [{ sortOrder: 0, category: "product", itemName: "Other", quantity: 1, unitPrice: 10, totalPrice: 10, costPrice: COST_PRICE }] } }, select: { id: true } });

    // 报价引擎 / 逐行报价 / 只报总价：orgId 不为空
    const QE = await createEngineQuote({ projectId: P, orgId: ORG, userId: OWNER, quoteType: "SUPPLY_ONLY" });
    await db.projectQuote.update({ where: { id: QE.id }, data: { status: "approved", approvedAt: now, approvedById: OWNER, internalCost: ENGINE_COST, profitMargin: ENGINE_MARGIN, pricingRate: PRICING_RATE, summaryJson: { sellingPrice: SELLING, estimatedCost: ENGINE_COST, grossProfit: 27226.83, grossMarginPct: ENGINE_MARGIN, markupPct: 31.06 } as never } });
    const QLINE = await createLineQuote({ projectId: P, orgId: ORG, userId: OWNER, businessType: "SUPPLY_ONLY" });
    await db.projectQuote.update({ where: { id: QLINE.id }, data: { pricingRate: PRICING_RATE } });
    const QLUMP = await createLumpQuote({ projectId: P, orgId: ORG, userId: OWNER, businessType: "SUPPLY_ONLY" });
    await db.projectQuote.update({ where: { id: QLUMP.id }, data: { pricingRate: PRICING_RATE } });
    const engineIds = [QE.id, QLINE.id, QLUMP.id];
    const legacyIdsNow = async () => (await db.projectQuote.findMany({ where: { projectId: P, orgId: null }, select: { id: true } })).map((q) => q.id).sort();

    // 负责人看到的形状（改动前后都一样的部分）作为对照
    const ownerList = await call(listRoute.GET as never, `/api/projects/${P}/quotes`, OWNER, { id: P });
    const ownerListRow = arr(ownerList.body.quotes).find((q) => q.id === QL.id);
    const ownerDetail = await call(oneRoute.GET as never, `/api/projects/${P}/quotes/${QL.id}`, OWNER, { id: P, quoteId: QL.id });
    const HEADER_KEYS = ["id", "projectId", "templateType", "version", "status", "title", "currency", "tradeTerms", "paymentTerms", "deliveryDays", "validUntil", "moq", "originCountry", "subtotal", "totalAmount", "aiGenerated", "inquiryId", "createdById", "createdAt"];
    const LINE_PUBLIC = ["id", "sortOrder", "category", "itemName", "specification", "unit", "quantity", "unitPrice", "totalPrice", "remarks", "isInternal"];
    const pick = (o: Rec, keys: string[]) => JSON.stringify(keys.map((k) => [k, o[k]]));
    ok(ownerList.status === 200 && !!ownerListRow && String(ownerListRow.profitMargin) === "23.45", "前提：负责人读列表拿到旧报价单利润率 23.45", { status: ownerList.status, row: ownerListRow });
    ok(ownerDetail.status === 200 && String(ownerDetail.body.internalCost) === "91234.56" && String(arr(ownerDetail.body.lineItems)[0]?.costPrice) === "17.31", "前提：负责人读详情拿到内部成本与成本价", { status: ownerDetail.status });

    /* ---------- 八种身份 ---------- */
    const who: Array<{ u: string; label: string; canView: boolean; canEdit: boolean }> = [
      { u: VIEWER, label: "只读成员（viewer）", canView: false, canEdit: false },
      { u: PADMIN, label: "不是负责人的项目管理员（没有财务键）", canView: false, canEdit: false },
      { u: OPER, label: "operator（没有岗位）", canView: false, canEdit: false },
      { u: ADMIN, label: "组织管理员（没有财务键、不是项目成员）", canView: false, canEdit: false },
      { u: BIDS, label: "bids 岗位（只在分配范围持 project.finance.read）、operator", canView: false, canEdit: false },
      { u: ACC, label: "accounting 岗位（组织范围 project.finance.read）、项目角色 viewer", canView: true, canEdit: false },
      { u: OWNER, label: "项目负责人", canView: true, canEdit: true },
      { u: SUPER, label: "平台超级管理员", canView: true, canEdit: true },
    ];

    for (const w of who) {
      console.log(`\n[${w.label}]`);
      const texts: string[] = [];

      // 列表
      const list = await call(listRoute.GET as never, `/api/projects/${P}/quotes`, w.u, { id: P });
      texts.push(list.text);
      const caps = rec(list.body.capabilities);
      const rows = arr(list.body.quotes);
      const legacyIds = await legacyIdsNow();
      ok(list.status === 200 && caps.canViewInternal === w.canView && caps.canEdit === w.canEdit && !("hintReason" in caps), `列表 capabilities：canViewInternal=${w.canView}、canEdit=${w.canEdit}，有真人负责人不带 hintReason`, { status: list.status, caps });
      ok(JSON.stringify(rows.map((r) => r.id).sort()) === JSON.stringify(legacyIds) && rows.every((r) => !engineIds.includes(String(r.id))), "列表只列旧报价单（没有报价引擎、逐行报价、只报总价的报价）", { got: rows.map((r) => r.id), legacyIds });
      const row = rows.find((r) => r.id === QL.id) ?? {};
      ok(String(row.totalAmount) === String(ownerListRow?.totalAmount) && row.title === ownerListRow?.title && rec(row._count).lineItems === rec(ownerListRow?._count).lineItems, "列表的总额、标题、行数与负责人看到的相同");
      if (w.canView) ok(String(row.profitMargin) === "23.45" && !("costHidden" in list.body), "列表带利润率 23.45，没有 costHidden", row);
      else ok(rows.every((r) => r.profitMargin === null) && list.body.costHidden === true, "列表每份报价 profitMargin 为 null、带 costHidden: true", { costHidden: list.body.costHidden, margins: rows.map((r) => r.profitMargin) });

      // 详情
      const one = await call(oneRoute.GET as never, `/api/projects/${P}/quotes/${QL.id}`, w.u, { id: P, quoteId: QL.id });
      texts.push(one.text);
      const lines = arr(one.body.lineItems);
      ok(one.status === 200 && pick(one.body, HEADER_KEYS) === pick(ownerDetail.body, HEADER_KEYS) && JSON.stringify(lines.map((l) => pick(l, LINE_PUBLIC))) === JSON.stringify(arr(ownerDetail.body.lineItems).map((l) => pick(l, LINE_PUBLIC))), "详情的报价头与行项（品名、数量、单价、合计）与负责人看到的相同", { status: one.status });
      ok(!["summaryJson", "engineJson", "pricingRate", "pricingMethod", "customerJson", "termsJson", "orgId", "quoteType"].some((k) => k in one.body) && lines.every((l) => !("sourceJson" in l)), "详情里没有报价引擎字段（summaryJson / engineJson / pricingRate 等）与行项 sourceJson", Object.keys(one.body));
      const oc = rec(one.body.capabilities);
      ok(oc.canViewInternal === w.canView && oc.canEdit === w.canEdit, "详情 capabilities 与列表相同", oc);
      if (w.canView) {
        ok(String(one.body.internalCost) === "91234.56" && String(one.body.profitMargin) === "23.45" && one.body.internalNotes === RARE_NOTE && String(lines[0]?.costPrice) === "17.31" && typeof one.body.aiDraftJson === "string" && !("costHidden" in one.body), "详情带内部成本、利润率、内部备注、AI 草稿、成本价，没有 costHidden");
      } else {
        ok(["internalCost", "profitMargin", "internalNotes", "aiDraftJson", "aiReviewJson"].every((k) => k in one.body && one.body[k] === null) && lines.every((l) => "costPrice" in l && l.costPrice === null) && one.body.costHidden === true, "详情的内部成本、利润率、内部备注、AI 草稿与审查原文、每行成本价都是 null，带 costHidden: true", { keys: Object.keys(one.body), costHidden: one.body.costHidden });
      }

      // AI 审查
      let before = received.length;
      replies.push(REVIEW_REPLY);
      const rv = await call(reviewRoute.POST as never, `/api/projects/${P}/quotes/${QL.id}/ai/review`, w.u, { id: P, quoteId: QL.id }, { method: "POST" });
      texts.push(rv.text);
      if (w.canView) {
        ok(rv.status === 200 && received.length - before === 1 && rec(rv.body.review).summary === "fixture 审查", "AI 审查：200，假模型服务收到一次", { status: rv.status, calls: received.length - before });
      } else {
        ok(rv.status === 403 && rv.body.error === S_REVIEW && received.length === before, "AI 审查：403 与那句话，假模型服务没收到请求", { status: rv.status, body: rv.text.slice(0, 300), calls: received.length - before });
        replies.length = 0;
      }

      // AI 起草
      before = received.length;
      replies.push(JSON.stringify({ title: "AI 草稿", lineItems: [] }));
      const dr = await call(draftRoute.POST as never, `/api/projects/${P}/quotes/ai/generate-draft`, w.u, { id: P }, { method: "POST", body: { templateType: "export_standard" } });
      texts.push(dr.text);
      if (w.canEdit) ok(dr.status === 200 && received.length - before === 1, "AI 起草：200，假模型服务收到一次", { status: dr.status, calls: received.length - before });
      else {
        ok(dr.status === 403 && dr.body.error === S_DRAFT && received.length === before, "AI 起草：403 与那句话，假模型服务没收到请求", { status: dr.status, body: dr.text.slice(0, 300), calls: received.length - before });
        replies.length = 0;
      }

      // 新建
      const countBefore = await quoteCount();
      const created = await call(listRoute.POST as never, `/api/projects/${P}/quotes`, w.u, { id: P }, { method: "POST", body: { title: `by ${w.label}` } });
      if (w.canEdit) ok(created.status === 201 && (await quoteCount()) === countBefore + 1, "新建报价单：201", { status: created.status });
      else ok(created.status === 403 && created.body.error === S_WRITE && (await quoteCount()) === countBefore, "新建报价单：403 与那句话，报价份数不变", { status: created.status, body: created.text.slice(0, 300) });

      // 修改并确认
      const editBefore = await snap(QL_EDIT.id);
      const patchBody = w.canEdit ? { header: { title: `edited by ${w.label}` } } : { header: { title: "hijack", status: "confirmed" }, lineItems: [{ sortOrder: 0, category: "product", itemName: "Roller blind", specification: "", unit: "", quantity: 100, unitPrice: 1, totalPrice: 100, remarks: "", costPrice: 0.5, isInternal: false }] };
      const patched = await call(oneRoute.PATCH as never, `/api/projects/${P}/quotes/${QL_EDIT.id}`, w.u, { id: P, quoteId: QL_EDIT.id }, { method: "PATCH", body: patchBody });
      if (w.canEdit) ok(patched.status === 200 && patched.body.title === `edited by ${w.label}`, "修改表头：200", { status: patched.status });
      else ok(patched.status === 403 && patched.body.error === S_WRITE && (await snap(QL_EDIT.id)) === editBefore, "改单价并确认：403 与那句话，行项、成本列与状态都不变", { status: patched.status, body: patched.text.slice(0, 300) });

      // 删除草稿 / 保存 AI 草稿（能编辑的人最后由负责人做）
      if (!w.canEdit) {
        const del = await call(oneRoute.DELETE as never, `/api/projects/${P}/quotes/${QL_DEL.id}`, w.u, { id: P, quoteId: QL_DEL.id }, { method: "DELETE" });
        ok(del.status === 403 && del.body.error === S_WRITE && !!(await db.projectQuote.findUnique({ where: { id: QL_DEL.id } })), "删除草稿：403 与那句话，草稿还在", { status: del.status, body: del.text.slice(0, 300) });
        const c0 = await quoteCount();
        const sv = await call(saveDraftRoute.POST as never, `/api/projects/${P}/quotes/save-ai-draft`, w.u, { id: P }, { method: "POST", body: { draft: { header: { title: "x" }, lines: [{ itemName: "y", unitPrice: 1 }] } } });
        ok(sv.status === 403 && sv.body.error === S_WRITE && (await quoteCount()) === c0, "保存 AI 草稿：403 与那句话，报价份数不变", { status: sv.status, body: sv.text.slice(0, 300) });
      }

      if (!w.canView) {
        const found = texts.flatMap((t) => leaks(t));
        ok(found.length === 0, "列表、详情、AI 审查与 AI 起草的响应里搜不到 17.31 / 91234.56 / 23.45 / 87654.32 与内部备注、AI 草稿、审查原文", found);
      }
    }

    /* ---------- 有资格的人：模型输入与改动前相同 ---------- */
    console.log("\n[负责人：模型输入]");
    const expectedReview = getQuoteReviewPrompt({
      templateType: "export_standard",
      header: { currency: "CAD", tradeTerms: "FOB", paymentTerms: "T/T 30/70", deliveryDays: 21, validUntil: "2027-02-01", moq: 50, originCountry: "China" },
      lineItems: [{ category: "product", itemName: "Roller blind", quantity: 100, unitPrice: 18, totalPrice: 1800, costPrice: COST_PRICE }],
      totals: { subtotal: 119175, internalCost: INTERNAL_COST, profitMargin: MARGIN },
      projectDescription: projectData.description,
      supplierQuoteCount: 0,
    });
    let b0 = received.length;
    replies.push(REVIEW_REPLY);
    const ownerReview = await call(reviewRoute.POST as never, `/api/projects/${P}/quotes/${QL.id}/ai/review`, OWNER, { id: P, quoteId: QL.id }, { method: "POST" });
    ok(ownerReview.status === 200 && received.length - b0 === 1 && received[b0]?.user === expectedReview && received[b0]?.system.includes("你是青砚报价审查引擎"), "AI 审查：负责人那次请求正文与改动前相同（同一份提示词）", { status: ownerReview.status, got: received[b0]?.user.slice(0, 200) });
    const expectedDraft = getQuoteDraftPrompt({
      project: { ...projectData, closeDate: "2027-01-15" },
      supplierQuotes: [],
      templateType: "export_standard",
      inquiryScope: null,
      memory: buildMemoryBlock(await getProjectAiMemory(P)),
    });
    b0 = received.length;
    replies.push(JSON.stringify({ title: "AI 草稿", lineItems: [] }));
    const ownerDraft = await call(draftRoute.POST as never, `/api/projects/${P}/quotes/ai/generate-draft`, OWNER, { id: P }, { method: "POST", body: { templateType: "export_standard" } });
    ok(ownerDraft.status === 200 && received.length - b0 === 1 && received[b0]?.user === expectedDraft && rec(ownerDraft.body.draft).title === "AI 草稿", "AI 起草：负责人那次请求正文与改动前相同、返回草稿", { status: ownerDraft.status, got: received[b0]?.user.slice(0, 200) });

    /* ---------- 负责人照常修改；请求里标内部行，库里与返回都是否 ---------- */
    console.log("\n[负责人修改并确认]");
    const ownerPatch = await call(oneRoute.PATCH as never, `/api/projects/${P}/quotes/${QL_EDIT.id}`, OWNER, { id: P, quoteId: QL_EDIT.id }, {
      method: "PATCH",
      body: {
        header: { ...legacyHeader, validUntil: "2027-02-01", title: "Owner Edited", internalNotes: "", status: "confirmed" },
        lineItems: [
          { sortOrder: 0, category: "product", itemName: "Line A", specification: "s", unit: "pc", quantity: 10, unitPrice: 30, totalPrice: 300, remarks: "", costPrice: 20, isInternal: true },
          { sortOrder: 1, category: "shipping", itemName: "Line B", specification: "", unit: "lot", quantity: 2, unitPrice: 50, totalPrice: 100, remarks: "r", costPrice: 40, isInternal: false },
        ],
      },
    });
    const dbLines = await db.quoteLineItem.findMany({ where: { quoteId: QL_EDIT.id }, orderBy: { sortOrder: "asc" } });
    const pl = arr(ownerPatch.body.lineItems);
    ok(ownerPatch.status === 200 && ownerPatch.body.status === "confirmed" && String(ownerPatch.body.subtotal) === "400" && String(ownerPatch.body.internalCost) === "280" && String(ownerPatch.body.profitMargin) === "30" && !("costHidden" in ownerPatch.body), "200、已确认，内部成本与利润率按新行项重算（280 / 30），返回带成本、没有 costHidden", { status: ownerPatch.status, body: ownerPatch.text.slice(0, 400) });
    ok(dbLines.length === 2 && dbLines.every((l) => l.isInternal === false) && pl.length === 2 && pl.every((l) => l.isInternal === false), "请求里一行标了内部行：库里与返回里两行都是否", { db: dbLines.map((l) => l.isInternal), resp: pl.map((l) => l.isInternal) });
    ok(dbLines[0]?.itemName === "Line A" && Number(dbLines[0]?.costPrice) === 20 && Number(dbLines[1]?.quantity) === 2 && dbLines[1]?.remarks === "r" && dbLines[1]?.category === "shipping", "其余行项字段照请求保存", dbLines.map((l) => [l.itemName, String(l.costPrice), String(l.quantity), l.remarks, l.category]));

    console.log("\n[负责人删除草稿、保存 AI 草稿]");
    const ownerDel = await call(oneRoute.DELETE as never, `/api/projects/${P}/quotes/${QL_DEL.id}`, OWNER, { id: P, quoteId: QL_DEL.id }, { method: "DELETE" });
    ok(ownerDel.status === 200 && !(await db.projectQuote.findUnique({ where: { id: QL_DEL.id } })), "负责人删除草稿：200", { status: ownerDel.status });
    const notDraftDel = await call(oneRoute.DELETE as never, `/api/projects/${P}/quotes/${QL_EDIT.id}`, OWNER, { id: P, quoteId: QL_EDIT.id }, { method: "DELETE" });
    ok(notDraftDel.status === 400 && notDraftDel.body.error === "只能删除草稿报价", "负责人删已确认的报价单：仍是 400「只能删除草稿报价」", { status: notDraftDel.status });
    const ownerSave = await call(saveDraftRoute.POST as never, `/api/projects/${P}/quotes/save-ai-draft`, OWNER, { id: P }, { method: "POST", body: { draft: { header: { title: "Owner AI Draft" }, lines: [{ itemName: "y", unitPrice: 1 }] } } });
    ok(ownerSave.status === 201 && typeof ownerSave.body.quoteId === "string", "负责人保存 AI 草稿：201", { status: ownerSave.status });

    /* ---------- 旧接口不处理报价引擎的报价 ---------- */
    console.log("\n[旧接口与报价引擎的报价]");
    for (const [label, qid] of [["报价引擎", QE.id], ["逐行报价", QLINE.id], ["只报总价", QLUMP.id]] as const) {
      const before = await snap(qid);
      const b = received.length;
      const href = `/projects/${P}/quote-engine/${qid}`;
      const g = await call(oneRoute.GET as never, `/api/projects/${P}/quotes/${qid}`, OWNER, { id: P, quoteId: qid });
      const pt = await call(oneRoute.PATCH as never, `/api/projects/${P}/quotes/${qid}`, OWNER, { id: P, quoteId: qid }, { method: "PATCH", body: { header: { status: "approved" }, lineItems: [{ sortOrder: 0, category: "product", itemName: "hijack", specification: "", unit: "", quantity: 1, unitPrice: 1, totalPrice: 1, remarks: "", costPrice: 1, isInternal: false }] } });
      const dl = await call(oneRoute.DELETE as never, `/api/projects/${P}/quotes/${qid}`, OWNER, { id: P, quoteId: qid }, { method: "DELETE" });
      replies.push(REVIEW_REPLY);
      const rv = await call(reviewRoute.POST as never, `/api/projects/${P}/quotes/${qid}/ai/review`, OWNER, { id: P, quoteId: qid }, { method: "POST" });
      replies.length = 0;
      const all = [g, pt, dl, rv];
      ok(all.every((r) => r.status === 409 && r.body.error === S_ENGINE && r.body.href === href), `${label}：负责人调旧接口的详情 / PATCH / DELETE / AI 审查都是 409 与那句话、带 href`, all.map((r) => [r.status, r.text.slice(0, 160)]));
      ok(!("pricingRate" in g.body) && leaks(g.text, ["27.13", "87654.32", "87,654.32"]).length === 0, `${label}：详情 409 的响应里没有定价比例与目标毛利`, g.text.slice(0, 300));
      ok((await snap(qid)) === before && received.length === b, `${label}：行项、状态、成本列与定价比例与请求前相同；假模型服务没收到请求`, { calls: received.length - b });
    }
    const vEngine = await call(oneRoute.GET as never, `/api/projects/${P}/quotes/${QE.id}`, VIEWER, { id: P, quoteId: QE.id });
    ok(vEngine.status === 409 && leaks(vEngine.text).length === 0, "只读成员读引擎报价的旧接口详情：409，搜不到估算成本", { status: vEngine.status });
    const mEngine = await call(oneRoute.GET as never, `/api/projects/${P}/quotes/${QE.id}`, MEMBER, { id: P, quoteId: QE.id });
    ok(mEngine.status === 403 && mEngine.body.error === "无权查看该项目", "不是项目成员的普通组织成员：先判项目读权限（403），不先说 409", { status: mEngine.status, body: mEngine.text });
    const missing = await call(oneRoute.GET as never, `/api/projects/${P}/quotes/nope_${stamp}`, OWNER, { id: P, quoteId: `nope_${stamp}` });
    ok(missing.status === 404 && missing.body.error === "报价单不存在", "报价不存在：404", { status: missing.status });
    const cross = await call(oneRoute.GET as never, `/api/projects/${P}/quotes/${QL_OTHER.id}`, OWNER, { id: P, quoteId: QL_OTHER.id });
    ok(cross.status === 404, "别的项目的报价单：404", { status: cross.status });

    /* ---------- 智能体报价技能（问青砚 project_bid_quote） ---------- */
    console.log("\n[问青砚 project_bid_quote]");
    const b1 = received.length;
    const vr = await tool("project_bid_quote", VIEWER, { projectId: P, action: "review", quoteId: QL.id });
    const vrData = rec(vr.r.data);
    const vrChecks = arr(vrData.ruleChecks);
    ok(vr.r.success === true && vrData.aiReview === null && vrData.costHidden === true && vrChecks.length > 0 && !vrChecks.some((c) => ["low_margin", "margin_warning", "high_margin"].includes(String(c.id))) && received.length === b1, "只读成员审查本项目报价：成功、没有 AI 审查、规则检查里没有利润率、带 costHidden；假模型服务没收到请求", { data: vr.text.slice(0, 400), calls: received.length - b1 });
    ok(leaks(vr.text).length === 0 && !vr.text.includes("3.83"), "只读成员的审查结果里搜不到成本价、内部成本、利润率", leaks(vr.text));
    const vx = await tool("project_bid_quote", VIEWER, { projectId: P, action: "review", quoteId: QL_OTHER.id });
    ok(vx.r.success === false && rec(vx.r.data).summary === "报价单不存在" && leaks(vx.text).length === 0 && received.length === b1, "只读成员审查另一个项目的报价 ID：「报价单不存在」", vx.text.slice(0, 300));
    const ox = await tool("project_bid_quote", OWNER, { projectId: P, action: "review", quoteId: QL_OTHER.id });
    ok(ox.r.success === false && rec(ox.r.data).summary === "报价单不存在" && received.length === b1, "负责人审查另一个项目的报价 ID：同样「报价单不存在」（不跨项目取报价）", ox.text.slice(0, 300));
    const vd = await tool("project_bid_quote", VIEWER, { projectId: P, action: "draft" });
    ok(vd.r.success === false && rec(vd.r.data).summary === S_SKILL_DRAFT && received.length === b1, "只读成员起草：失败与那句话，假模型服务没收到请求", vd.text.slice(0, 300));
    const md = await tool("project_bid_quote", MEMBER, { projectId: P, action: "review", quoteId: QL.id });
    ok(md.r.success === false && JSON.stringify(md.r).includes("项目不存在或不属于当前组织") && leaks(md.text).length === 0 && received.length === b1, "不是项目成员的普通组织成员：「项目不存在或不属于当前组织」，不读报价、不调模型", md.text.slice(0, 300));
    replies.push(REVIEW_REPLY);
    const orv = await tool("project_bid_quote", OWNER, { projectId: P, action: "review", quoteId: QL.id });
    const orChecks = arr(rec(orv.r.data).ruleChecks);
    ok(orv.r.success === true && received.length - b1 === 1 && orChecks.some((c) => c.id === "low_margin") && rec(orv.r.data).aiReview !== null && !("costHidden" in rec(orv.r.data)), "负责人审查：假模型服务收到一次、结果里有利润率检查、没有 costHidden", { calls: received.length - b1, ids: orChecks.map((c) => c.id) });
    replies.length = 0;

    /* ---------- 问青砚 project_get_project_quotes ---------- */
    console.log("\n[问青砚 project_get_project_quotes]");
    const mq = await tool("project_get_project_quotes", MEMBER, { projectId: P });
    ok(mq.r.success === false && JSON.stringify(mq.r).includes("项目不存在或不属于当前组织") && leaks(mq.text).length === 0, "不是项目成员的普通组织成员：「项目不存在或不属于当前组织」", mq.text.slice(0, 300));
    const vq = await tool("project_get_project_quotes", VIEWER, { projectId: P, limit: 50 });
    const vqRows = arr(rec(vq.r.data).quotes);
    const vqQL = vqRows.find((q) => q.id === QL.id);
    ok(vq.r.success === true && !!vqQL && String(vqQL.totalAmount) === "119175" && vqRows.every((q) => q.profitMargin === null) && rec(vq.r.data).costHidden === true, "只读成员：拿到总额、profitMargin 为 null、带 costHidden", vq.text.slice(0, 400));
    ok(leaks(vq.text, ["23.45", "23.7", "87654.32"]).length === 0, "只读成员的工具结果里搜不到利润率与引擎毛利率", leaks(vq.text, ["23.45", "23.7", "87654.32"]));
    const oq = await tool("project_get_project_quotes", OWNER, { projectId: P, limit: 50 });
    const oqQL = arr(rec(oq.r.data).quotes).find((q) => q.id === QL.id);
    ok(oq.r.success === true && String(oqQL?.profitMargin) === "23.45" && !("costHidden" in rec(oq.r.data)), "负责人：拿到利润率 23.45，没有 costHidden", oqQL);

    /* ---------- 审计日志详情 ---------- */
    console.log("\n[审计日志详情]");
    const legacyAudit = await db.auditLog.create({ data: { userId: OWNER, orgId: ORG, projectId: P, action: "quote_version_created", targetType: "project_quote", targetId: QE.id, beforeData: JSON.stringify({ sourceQuoteId: QE.id, sourceVersion: 1, sourceSellingPrice: SELLING, sourceCost: ENGINE_COST, sourceMargin: ENGINE_MARGIN }), afterData: JSON.stringify({ version: 2, reason: "fixture", lines: [{ itemName: "x", costPrice: COST_PRICE, unitPrice: 18 }] }) } });
    const readAudit = (u: string, aid: string) => call(auditRoute.GET as never, `/api/audit-logs/${aid}`, u, { id: aid });
    for (const [u, label] of [[PADMIN, "不是负责人也没有财务键的项目管理员"], [ADMIN, "组织管理员（没有财务键）"]] as const) {
      const a = await readAudit(u, legacyAudit.id);
      const bd = rec(rec(a.body.log).beforeData);
      const ad = rec(rec(a.body.log).afterData);
      ok(a.status === 200 && bd.sourceCost === null && bd.sourceMargin === null && bd.sourceSellingPrice === SELLING && bd.sourceVersion === 1 && a.body.costHidden === true, `${label}：200，原版估算成本与毛利率为 null、卖价照旧、带 costHidden`, { status: a.status, bd, costHidden: a.body.costHidden });
      ok(arr(ad.lines)[0]?.costPrice === null && arr(ad.lines)[0]?.unitPrice === 18 && JSON.stringify(a.body.redactedPaths) === JSON.stringify(["beforeData.sourceCost", "beforeData.sourceMargin", "afterData.lines[0].costPrice"]), `${label}：数组里嵌套的成本价也置空，带被置空的键路径`, { ad, paths: a.body.redactedPaths });
      ok(leaks(a.text, ["87654.32", "17.31", "23.7"]).length === 0 && rec(a.body.log).action === "quote_version_created" && rec(rec(a.body.log).user).id === OWNER, `${label}：搜不到估算成本、成本价与毛利率；动作与操作人照旧`, leaks(a.text, ["87654.32", "17.31", "23.7"]));
    }
    for (const [u, label] of [[OWNER, "项目负责人"], [ADMIN_ACC, "组织管理员 + 组织范围 project.finance.read"], [SUPER, "平台超级管理员"]] as const) {
      const a = await readAudit(u, legacyAudit.id);
      const bd = rec(rec(a.body.log).beforeData);
      ok(a.status === 200 && bd.sourceCost === ENGINE_COST && bd.sourceMargin === ENGINE_MARGIN && !("costHidden" in a.body) && !("redactedPaths" in a.body) && Object.keys(a.body).join() === "log", `${label}：读到原值、没有 costHidden（响应形状与改动前相同）`, { status: a.status, bd, keys: Object.keys(a.body) });
    }
    const va = await readAudit(VIEWER, legacyAudit.id);
    ok(va.status === 403 && leaks(va.text).length === 0, "只读成员读审计详情：仍 403", { status: va.status });

    // 另起新版：新写的那条审计不再记原版估算成本与毛利率
    await reviseQuote({ quoteId: QE.id, projectId: P, userId: OWNER, orgId: ORG, reason: "fixture revise" });
    const newAudit = await db.auditLog.findFirst({ where: { projectId: P, action: "quote_version_created", id: { not: legacyAudit.id } }, orderBy: { createdAt: "desc" } });
    const nb = rec(JSON.parse(newAudit?.beforeData ?? "{}"));
    ok(!!newAudit && nb.sourceQuoteId === QE.id && nb.sourceVersion === 1 && nb.sourceSellingPrice === SELLING && !("sourceCost" in nb) && !("sourceMargin" in nb), "负责人另起新版：新写的那条审计 beforeData 只有原版 id、版本号与卖价", nb);
    if (newAudit) {
      const pa = await readAudit(PADMIN, newAudit.id);
      ok(pa.status === 200 && leaks(pa.text, ["87654.32", "23.7"]).length === 0, "项目管理员读新写的审计：200，搜不到估算成本与毛利率", { status: pa.status, text: pa.text.slice(0, 300) });
    }

    /* ---------- 负责人是导入用的系统账号的项目 ---------- */
    console.log("\n[负责人是系统账号]");
    const sysExisting = await db.user.findFirst({ where: { email: "system@qingyan.internal" }, select: { id: true } });
    const SYS = sysExisting?.id ?? (createdSystemUser = (await db.user.create({ data: { email: "system@qingyan.internal", name: "System (API)", role: "user", status: "active", passwordHash: "" } })).id);
    await db.project.create({ data: { id: PSYS, name: `Fixture Imported ${stamp}`, orgId: ORG, ownerId: SYS, workDomain: "tender", intakeStatus: "dispatched", status: "active" } as never });
    await db.projectMember.create({ data: { projectId: PSYS, userId: VIEWER, role: "viewer", status: "active" } });
    const sl = await call(listRoute.GET as never, `/api/projects/${PSYS}/quotes`, VIEWER, { id: PSYS });
    ok(sl.status === 200 && rec(sl.body.capabilities).hintReason === "no_owner" && rec(sl.body.capabilities).canEdit === false, "只读成员：列表 capabilities 带 hintReason = no_owner", sl.body.capabilities);
    const sc = await call(listRoute.POST as never, `/api/projects/${PSYS}/quotes`, VIEWER, { id: PSYS }, { method: "POST", body: {} });
    ok(sc.status === 403 && sc.body.error === S_WRITE_NO_OWNER && (await db.projectQuote.count({ where: { projectId: PSYS } })) === 0, "只读成员新建：403，后一句换成找组织管理员", { status: sc.status, body: sc.text });
  } finally {
    if (prevEnv.base === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = prevEnv.base;
    if (prevEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevEnv.key;
    await db.project.updateMany({ where: { id: { in: PIDS } }, data: { bidQuoteId: null } as never }).catch(() => undefined);
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: users } }, { projectId: { in: PIDS } }] } });
    await db.projectEvent.deleteMany({ where: { projectId: { in: PIDS } } }).catch(() => undefined);
    await db.projectQuote.deleteMany({ where: { projectId: { in: PIDS } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: PIDS } } });
    await db.project.deleteMany({ where: { id: { in: PIDS } } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: createdSystemUser ? [...users, createdSystemUser] : users } } });
    await db.$disconnect();
    server.close();
  }

  console.log(`\nFIX-26 legacy quote finance view DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
