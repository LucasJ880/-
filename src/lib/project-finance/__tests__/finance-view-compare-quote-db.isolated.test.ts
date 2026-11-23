/**
 * CHAIN-2e 比价落地价与报价引擎内部数字只给有财务查看权的人——真实 DB（隔离库），调用真实路由
 *
 * 八种身份：只读成员、`bids` 岗位的 operator、没有财务键的组织管理员（不是项目成员）、项目负责人、
 * `accounting` 岗位（项目角色 viewer）、`owner` 岗位（项目角色 viewer）、平台超级管理员、组织管理员 + `accounting` 岗位（不是项目成员）
 * 另有：负责人是导入用的系统账号的项目（提示改为找组织管理员）；解读里冒出落地价时数字校验以裁剪后的输入为准。
 * × 比价矩阵 / AI 报价分析（模型输入）/ 询价追踪页 / 报价列表 / 单个报价 / 「我方报价」/ 新建 / 编辑；少见数字搜索。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目 / 供应商）。
 * 模型端是本机起的 OpenAI 兼容假服务（OPENAI_BASE_URL 指过去），记下每次请求，不打真模型；不发任何邮件。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-2e 比价 / 报价引擎财务查看权 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-2e finance view compare / quote DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const DAY = 86_400_000;

/** 报价引擎里放的少见数字 / 文字（在没有权限的人的响应里搜） */
const COST_LINE_UNIT = 73519.37;
const SUMMARY_COST = 91234.56;
const SUMMARY_MARGIN = 23.97;
const RARE_SUPPLIER = "Rarebird Supply Co";
const RARE_NOTE = "内部备注稀有词-QX93";
const QUOTE_SECRETS = ["73519", "73,519", "91234", "91,234", RARE_SUPPLIER, RARE_NOTE];

// ── 本机 OpenAI 兼容假服务：按队列回复，记录每次请求 ──
const replies: string[] = [];
const received: Array<{ system: string; user: string }> = [];
const INTERPRETATION = JSON.stringify({ priceAnalysis: "Alder Supply 排第一。", deliveryAnalysis: "交期都在截止前。", risks: "Cedar NoFx 缺汇率。", recommendation: "按推荐选 Alder Supply。" });
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}") as { model?: string; messages?: Array<{ role: string; content: string }> };
    const msgs = parsed.messages ?? [];
    received.push({ system: msgs.find((m) => m.role !== "user")?.content ?? "", user: msgs.find((m) => m.role === "user")?.content ?? "" });
    const content = replies.shift() ?? INTERPRETATION;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "chatcmpl-test", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: parsed.model ?? "test-model", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
  });
});

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const prevEnv = { base: process.env.OPENAI_BASE_URL, key: process.env.OPENAI_API_KEY, qe: process.env.TENDER_QUOTE_ENGINE_ENABLED };
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.OPENAI_API_KEY = "test-key";
  process.env.TENDER_QUOTE_ENGINE_ENABLED = "1";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { loadCompareMatrix } = await import("@/lib/tender-rfq/compare-service");
  const { buildMatrixInterpretationPrompt } = await import("@/lib/tender-rfq/compare");
  const { createEngineQuote } = await import("@/lib/quote-engine/service");
  const matrixRoute = await import("@/app/api/projects/[id]/inquiries/[inquiryId]/compare/matrix/route");
  const analysisRoute = await import("@/app/api/projects/[id]/inquiries/[inquiryId]/compare/analysis/route");
  const trackerRoute = await import("@/app/api/org/tender-rfq/tracker/route");
  const listRoute = await import("@/app/api/projects/[id]/quote-engine/route");
  const oneRoute = await import("@/app/api/projects/[id]/quote-engine/[quoteId]/route");
  const bidRoute = await import("@/app/api/projects/[id]/quote-engine/tender-bid/route");
  const analyzeRoute = await import("@/app/api/projects/[id]/quote-engine/[quoteId]/analyze/route");
  const importsRoute = await import("@/app/api/projects/[id]/quote-engine/[quoteId]/imports/route");
  const customerQuoteRoute = await import("@/app/api/projects/[id]/quote-engine/[quoteId]/customer-quote/route");

  console.log("CHAIN-2e finance view (compare / tracker / quote engine) — isolated DB");
  const stamp = Date.now().toString(36);
  const id = (k: string) => `fv${k}_${stamp}`;
  const ORG_OWNER = id("orgowner"), OWNER = id("owner"), VIEWER = id("viewer"), BIDS = id("bids"), ADMIN = id("admin"), ACC = id("acc"), BOSS = id("boss"), SUPER = id("super"), ADMIN_ACC = id("adminacc");
  const users = [ORG_OWNER, OWNER, VIEWER, BIDS, ADMIN, ACC, BOSS, SUPER, ADMIN_ACC];
  const ORG = id("org");
  const P = `fvproj_${stamp}`;
  const PSYS = `fvsys_${stamp}`;
  const PIDS = [P, PSYS];
  let createdSystemUser: string | null = null;
  const email = (u: string) => `${u}@fixture.test`;
  const now = new Date();
  const supplierIds: string[] = [];

  const cookieOf = async (u: string) => `qy_session=${await createSession({ sub: u, email: email(u), role: u === SUPER ? "super_admin" : "user" })}`;
  const call = async (handler: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, url: string, u: string, params: Record<string, string>, init: { method?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { cookie: await cookieOf(u) };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const res = await handler(new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) }), { params: Promise.resolve(params) });
    const text = await res.text();
    let body: Rec = {};
    try { body = rec(JSON.parse(text || "null")); } catch { body = {}; }
    return { status: res.status, text, body };
  };

  try {
    /* ---------- fixture ---------- */
    for (const u of users) await db.user.create({ data: { id: u, email: email(u), name: `Fixture ${u}`, role: u === SUPER ? "super_admin" : "user" } });
    await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `fv-${stamp}`, ownerId: ORG_OWNER, industryPackId: "window_covering_services_v1", settingsJson: { tenderRfq: { landedCost: { fxRates: { USD: 1.36 }, fxAsOf: now.toISOString().slice(0, 10), fxSource: "MANUAL", freightEstimate: { mode: "per_unit", value: 6 }, insurancePct: 1, clearanceFlatCad: 150, projects: { [P]: { dutyRatePct: 6.5 } } } } } as never } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: ORG_OWNER, role: "org_owner", status: "active" } });
    for (const u of [OWNER, VIEWER, BIDS, ACC, BOSS]) await db.organizationMember.create({ data: { orgId: ORG, userId: u, role: "org_member", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN_ACC, role: "org_admin", status: "active" } });
    await seedOrgAuthorizationProfiles(ORG);
    const bind = async (userId: string, key: string) => {
      const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
      if (!profile) throw new Error(`缺少岗位模板 ${key}`);
      await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
    };
    await bind(BIDS, "bids"); // project.finance.read 只在 ASSIGNED 范围
    await bind(ACC, "accounting"); // project.finance.read 在 ORG 范围
    await bind(BOSS, "owner"); // project.finance.manage 在 ORG 范围
    await bind(ADMIN_ACC, "accounting"); // 组织管理员（能读项目）+ 组织范围 project.finance.read，不是项目成员

    await db.project.create({ data: { id: P, name: `Fixture Tender ${stamp}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active", closeDate: new Date(now.getTime() + 30 * DAY) } as never });
    for (const [u, role] of [[OWNER, "project_admin"], [VIEWER, "viewer"], [BIDS, "operator"], [ACC, "viewer"], [BOSS, "viewer"]] as const) {
      await db.projectMember.create({ data: { projectId: P, userId: u, role, status: "active" } });
    }

    // 一轮询价：Alder（USD DDP，落地价 = 原价 × 汇率）、Birch（USD FOB，有运费 / 保险 / 关税逐项金额）、Cedar（CNY，没有汇率 → 换算不出）
    const inquiry = await db.projectInquiry.create({ data: { projectId: P, roundNumber: 1, status: "in_progress", dueDate: new Date(now.getTime() + 10 * DAY), createdById: OWNER } });
    await db.pendingAction.create({ data: { type: "tender.send_rfq", title: "第 1 轮询价", preview: "fixture", payload: { inquiryId: inquiry.id, projectId: P, roundNumber: 1, items: [{ body: "- 数量：1500 件\n" }] }, status: "executed", createdById: OWNER, orgId: ORG, projectId: P, decidedById: OWNER, decidedAt: now, executedAt: now, expiresAt: new Date(now.getTime() + 3 * DAY), idempotencyKey: `fv-${stamp}-rfq` } });
    const autoNotes = (facts: string) => `[auto ${new Date(now.getTime() - DAY).toISOString()} msg=m-${facts.length}] ${facts}`;
    const mkQuoted = async (name: string, o: Rec) => {
      const s = await db.supplier.create({ data: { orgId: ORG, name, contactEmail: `${name.replace(/\W/g, "").toLowerCase()}_${stamp}@supplier-fixture.test`, status: "active", createdById: OWNER } as never });
      supplierIds.push(s.id);
      await db.inquiryItem.create({ data: { inquiryId: inquiry.id, supplierId: s.id, createdById: OWNER, status: "quoted", sentAt: new Date(now.getTime() - 3 * DAY), repliedAt: new Date(now.getTime() - DAY), deliveryDays: 10, validUntil: new Date(now.getTime() + 60 * DAY), contactNotes: `threadId=thr-${name}`, ...o } as never });
    };
    await mkQuoted("Alder Supply", { totalPrice: 23456.78, currency: "USD", quoteNotes: autoNotes("总价=23456.78；贸易条款=DDP") });
    await mkQuoted("Birch Trading", { unitPrice: 61.73, currency: "USD", quoteNotes: autoNotes("单价=61.73；贸易条款=FOB") });
    await mkQuoted("Cedar NoFx", { unitPrice: 333, currency: "CNY", quoteNotes: autoNotes("单价=333；贸易条款=DDP") });

    const full = await loadCompareMatrix({ projectId: P, inquiryId: inquiry.id });
    if (!full.ok) throw new Error(`比价矩阵算不出：${full.message}`);
    const FM = full.matrix;
    const rowOf = (name: string) => FM.rows.find((r) => r.supplierName === name)!;
    const tokensOf = (n: number) => [...new Set([String(n), n.toFixed(2), Math.round(n).toLocaleString("en-US"), String(Math.round(n))])].filter((t) => t.replace(/\D/g, "").length >= 4);
    // 系统算出的、与供应商原价不同的数（落地价、换算说明里的逐项金额与汇率）——没有权限的人的响应里都不该有
    const derived = [
      ...FM.rows.flatMap((r) => [r.landedCad.total !== r.quoted.totalPrice ? r.landedCad.total : null, r.landedCad.unit !== r.quoted.unitPrice ? r.landedCad.unit : null]).filter((n): n is number => n != null).flatMap(tokensOf),
      ...FM.rows.flatMap((r) => r.assumptions).flatMap((a) => a.match(/\d[\d,]*\.\d+|\d{1,3}(?:,\d{3})+/g) ?? []),
    ];
    // 搜「少见数字」时去掉时间戳（generatedAt 等的秒与毫秒可能恰好拼出「6.5」这类数）
    const hay = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>");
    const allLanded = FM.rows.flatMap((r) => [r.landedCad.total, r.landedCad.unit]).filter((n): n is number => n != null).flatMap(tokensOf);
    ok(rowOf("Alder Supply").landedCad.total != null && rowOf("Birch Trading").assumptions.some((a) => /关税|保险/.test(a)) && rowOf("Cedar NoFx").flags.includes("not_normalized") && FM.recommendedItemId === rowOf("Alder Supply").itemId && FM.summaryZh.includes(Math.round(rowOf("Alder Supply").landedCad.total!).toLocaleString("en-US")), "前提：Alder 推荐且最便宜，Birch 有逐项金额，Cedar 换算不出；完整结论里有落地价", { summary: FM.summaryZh, derived });
    const ctx = { projectName: full.projectName, roundNumber: full.roundNumber, closeDate: full.closeDate };
    const fullPrompt = buildMatrixInterpretationPrompt(FM, ctx);

    // 报价引擎：Q1 已批准、选为我方报价；Q2 草稿（编辑用）
    const q1 = await createEngineQuote({ projectId: P, orgId: ORG, userId: OWNER, quoteType: "PROJECT_SUPPLY_INSTALL", demo: "A" });
    await db.quoteCostLine.create({ data: { quoteId: q1.id, orgId: ORG, sortOrder: 999, category: "MATERIAL", description: "fixture rare line", quantity: 1, unitCost: COST_LINE_UNIT, sourceCurrency: "CAD", calculationType: "FIXED", supplierName: RARE_SUPPLIER, notes: RARE_NOTE, included: true } });
    await db.projectQuote.update({ where: { id: q1.id }, data: { status: "approved", approvedAt: now, approvedById: OWNER, internalNotes: RARE_NOTE, summaryJson: { sellingPrice: 150000, estimatedCost: SUMMARY_COST, grossProfit: 58765.44, grossMarginPct: SUMMARY_MARGIN, markupPct: 31.4 } as never } });
    await db.project.update({ where: { id: P }, data: { bidQuoteId: q1.id } as never });
    const q2 = await createEngineQuote({ projectId: P, orgId: ORG, userId: OWNER, quoteType: "SUPPLY_ONLY" });

    /* ---------- 七种身份 ---------- */
    const who: Array<{ u: string; label: string; canView: boolean; canEdit: boolean }> = [
      { u: VIEWER, label: "只读成员（viewer，没有岗位）", canView: false, canEdit: false },
      { u: BIDS, label: "bids 岗位、项目角色 operator", canView: false, canEdit: false },
      { u: ADMIN, label: "组织管理员（没有财务键、不是项目成员）", canView: false, canEdit: false },
      { u: OWNER, label: "项目负责人", canView: true, canEdit: true },
      { u: ACC, label: "accounting 岗位、项目角色 viewer", canView: true, canEdit: false },
      { u: BOSS, label: "owner 岗位、项目角色 viewer", canView: true, canEdit: true },
      { u: SUPER, label: "平台超级管理员", canView: true, canEdit: true },
      { u: ADMIN_ACC, label: "组织管理员 + accounting 岗位（不是项目成员）", canView: true, canEdit: false },
    ];
    const withoutTime = (m: unknown) => JSON.stringify({ ...rec(m), generatedAt: null });

    for (const w of who) {
      console.log(`\n[${w.label}]`);
      // 比价矩阵
      const mx = await call(matrixRoute.GET as never, `/api/projects/${P}/inquiries/${inquiry.id}/compare/matrix`, w.u, { id: P, inquiryId: inquiry.id });
      const m = rec(mx.body.matrix);
      const mRows = (m.rows as Rec[] | undefined) ?? [];
      if (w.canView) {
        ok(mx.status === 200 && withoutTime(m) === withoutTime(FM) && !("costHidden" in mx.body) && !("costHidden" in m), "比价矩阵与改动前逐字段相同（不带 costHidden）", { status: mx.status });
      } else {
        ok(mx.status === 200 && mx.body.costHidden === true && m.costHidden === true, "比价矩阵带 costHidden: true（矩阵与响应顶层）", { status: mx.status, top: mx.body.costHidden });
        ok(derived.length >= 5 && derived.every((t) => !hay(mx.text).includes(t)), "比价矩阵里搜不到落地价与逐项金额 / 汇率", derived.filter((t) => hay(mx.text).includes(t)));
        const checkNotes = (itemId: unknown) => FM.rows.find((r) => r.itemId === itemId)!.assumptions.filter((a) => !/CAD|汇率|%/.test(a));
        ok(mRows.every((r) => rec(r.landedCad).total === null && rec(r.landedCad).unit === null && JSON.stringify(r.assumptions) === JSON.stringify(checkNotes(r.itemId))) && mRows.some((r) => (r.assumptions as string[]).some((a) => a.startsWith("未设交付截止"))), "每行落地价为 null；换算说明只留检查说明（未设交付截止…），带金额 / 汇率的去掉", mRows.map((r) => r.assumptions));
        ok(!("hintReason" in mx.body), "有真人负责人：不带 hintReason（界面用默认那句）");
        ok(m.recommendedItemId === FM.recommendedItemId && m.cheapestItemId === FM.cheapestItemId && JSON.stringify(mRows.map((r) => [r.itemId, r.flags, r.blockers, r.quoted])) === JSON.stringify(FM.rows.map((r) => [r.itemId, r.flags, r.blockers, r.quoted])), "排序、推荐、最低价、标记、换算不出的原因、供应商原价照常");
        const summary = String(m.summaryZh ?? "");
        ok(allLanded.every((t) => !summary.includes(t)) && !summary.includes("%") && summary.includes("推荐 Alder Supply") && summary.includes("Cedar NoFx 未能换算落地价"), "一句话结论没有金额与「%」，写推荐谁、谁换算不出", summary);
      }

      // AI 报价分析：同一次模型调用，看模型拿到的输入
      const before = received.length;
      const an = await call(analysisRoute.POST as never, `/api/projects/${P}/inquiries/${inquiry.id}/compare/analysis`, w.u, { id: P, inquiryId: inquiry.id }, { method: "POST" });
      const sent = received.slice(before);
      ok(an.status === 200 && sent.length === 1, "AI 报价分析：200，只调一次模型", { status: an.status, calls: sent.length, body: an.text.slice(0, 300) });
      if (w.canView) {
        ok(sent[0]?.user === fullPrompt.userPrompt && sent[0]?.system === fullPrompt.systemPrompt && !("costHidden" in an.body), "模型输入与改动前逐字相同", { got: sent[0]?.user.slice(0, 200) });
      } else {
        ok(!!sent[0] && allLanded.every((t) => !sent[0].user.includes(t)) && derived.every((t) => !sent[0].user.includes(t)), "模型输入里搜不到任何一家的落地价", allLanded.filter((t) => sent[0]?.user.includes(t)));
        ok(!!sent[0] && sent[0].system.includes("本次不提供落地价") && sent[0].system.includes("不得估算或给出任何金额") && rec(JSON.parse(sent[0].user)).costHidden === true, "提示词写明不提供落地价、不得估算金额；输入带 costHidden");
        ok(an.body.costHidden === true && derived.every((t) => !hay(an.text).includes(t)) && allLanded.every((t) => !String(rec(an.body.analysis).summary).includes(t)), "分析响应带 costHidden，搜不到落地价与逐项金额", derived.filter((t) => hay(an.text).includes(t)));
      }

      // 询价追踪页
      const tr = await call(trackerRoute.GET as never, `/api/org/tender-rfq/tracker?orgId=${ORG}`, w.u, {});
      const trRows = ((tr.body.groups as Rec[]) ?? []).flatMap((g) => ((g.rounds as Rec[]) ?? []).flatMap((r) => (r.rows as Rec[]) ?? []));
      const alder = trRows.find((r) => r.supplierName === "Alder Supply");
      const cedar = trRows.find((r) => r.supplierName === "Cedar NoFx");
      const alderLanded = `落地价 CAD ${Math.round(rowOf("Alder Supply").landedCad.total!).toLocaleString("en-US")}`;
      ok(tr.status === 200 && !!alder && String(rec(cedar?.quote).landedText).startsWith("落地价未换算（") && rec(alder.quote).cheapest === true, "追踪页：看得到这一轮；换算不出的原因与「最便宜」照常", { status: tr.status, alder: alder?.quote, cedar: cedar?.quote });
      if (w.canView) ok(rec(alder?.quote).landedText === alderLanded, "追踪页显示落地价", alder?.quote);
      else ok(rec(alder?.quote).landedText === "落地价只给有财务查看权的人看" && derived.every((t) => !hay(tr.text).includes(t)), "追踪页那一格写「落地价只给有财务查看权的人看」，搜不到落地价", { cell: alder?.quote, found: derived.filter((t) => hay(tr.text).includes(t)) });

      // 报价列表
      const list = await call(listRoute.GET as never, `/api/projects/${P}/quote-engine`, w.u, { id: P });
      const caps = rec(list.body.capabilities);
      const qRows = (list.body.quotes as Rec[] | undefined) ?? [];
      ok(!("hintReason" in caps), "有真人负责人：capabilities 不带 hintReason（界面用默认那句）", caps);
      ok(list.status === 200 && caps.canViewInternal === w.canView && caps.canEdit === w.canEdit && qRows.length >= 2, `报价列表：canViewInternal=${w.canView}、canEdit=${w.canEdit}`, { status: list.status, caps });
      if (w.canView) ok(qRows.some((r) => r.estimatedCost === SUMMARY_COST && r.grossMarginPct === SUMMARY_MARGIN), "列表带估算成本与毛利率");
      else ok(qRows.every((r) => !("estimatedCost" in r) && !("grossMarginPct" in r)) && QUOTE_SECRETS.every((t) => !list.text.includes(t)) && caps.canApprove === false, "列表没有 estimatedCost / grossMarginPct 键，搜不到少见金额", QUOTE_SECRETS.filter((t) => list.text.includes(t)));

      // 单个报价
      const one = await call(oneRoute.GET as never, `/api/projects/${P}/quote-engine/${q1.id}`, w.u, { id: P, quoteId: q1.id });
      if (w.canView) {
        const lines = (rec(one.body.quote).costLines as Rec[] | undefined) ?? [];
        ok(one.status === 200 && lines.some((l) => l.unitCost === COST_LINE_UNIT && l.supplierName === RARE_SUPPLIER) && rec(one.body.capabilities).canViewInternal === true && rec(one.body.capabilities).canEdit === w.canEdit, "单个报价：内部视图（成本行、供应商）", { status: one.status, caps: one.body.capabilities });
      } else {
        const oc = rec(one.body.capabilities);
        ok(one.status === 200 && Object.keys(one.body).sort().join() === "capabilities,customerView" && oc.canViewInternal === false && oc.canEdit === false && oc.canApprove === false, "单个报价：只返回客户视图，三个权限位都为 false", { status: one.status, keys: Object.keys(one.body) });
        ok(QUOTE_SECRETS.every((t) => !one.text.includes(t)), "单个报价里搜不到成本行金额、供应商、内部备注、估算成本", QUOTE_SECRETS.filter((t) => one.text.includes(t)));
      }

      // 内部分析、成本导入、客户报价编辑视图（internal_cost 级别）
      const internalStatuses: Array<[string, number, boolean]> = [];
      for (const [label, handler, path] of [["内部分析", analyzeRoute.GET, "analyze"], ["成本导入", importsRoute.GET, "imports"], ["客户报价编辑视图", customerQuoteRoute.GET, "customer-quote"]] as const) {
        const r = await call(handler as never, `/api/projects/${P}/quote-engine/${q1.id}/${path}`, w.u, { id: P, quoteId: q1.id });
        internalStatuses.push([label, r.status, QUOTE_SECRETS.some((t) => r.text.includes(t))]);
      }
      ok(internalStatuses.every(([, st, leak]) => (w.canView ? st === 200 : st === 403 && !leak)), `内部分析 / 成本导入 / 客户报价编辑视图：${w.canView ? "200" : "403，返回里没有内部数字"}`, internalStatuses);

      // 「我方报价」
      const bid = await call(bidRoute.GET as never, `/api/projects/${P}/quote-engine/tender-bid`, w.u, { id: P });
      const bq = rec(rec(bid.body.bid).quote);
      ok(bid.status === 200 && bq.id === q1.id && bq.sellingPrice != null, "「我方报价」：200，权威报价与卖价照常", { status: bid.status });
      if (w.canView) ok(bq.estimatedCost != null && bq.grossMarginPct != null, "「我方报价」带估算成本与毛利率", bq);
      else ok(bq.estimatedCost === null && bq.grossProfit === null && bq.grossMarginPct === null && bq.markupPct === null && bq.pricingRate === null && QUOTE_SECRETS.every((t) => !bid.text.includes(t)) && rec(bid.body.capabilities).canViewInternal === false, "「我方报价」估算成本 / 毛利 / 毛利率 / 加价 / 定价比例为 null，搜不到少见金额", bq);

      // 新建、编辑
      const created = await call(listRoute.POST as never, `/api/projects/${P}/quote-engine`, w.u, { id: P }, { method: "POST", body: { quoteType: "SUPPLY_ONLY" } });
      ok(created.status === (w.canEdit ? 201 : 403), `新建报价：${w.canEdit ? "201" : "403"}`, { status: created.status, body: created.text.slice(0, 200) });
      const edited = await call(oneRoute.PUT as never, `/api/projects/${P}/quote-engine/${q2.id}`, w.u, { id: P, quoteId: q2.id }, { method: "PUT", body: { header: { name: `edited by ${w.label}` } } });
      ok(edited.status === (w.canEdit ? 200 : 403), `编辑草稿报价：${w.canEdit ? "200" : "403"}`, { status: edited.status, body: edited.text.slice(0, 200) });
      if (!w.canEdit) ok(QUOTE_SECRETS.every((t) => !edited.text.includes(t)) && QUOTE_SECRETS.every((t) => !created.text.includes(t)), "403 的返回里没有内部数字");
    }

    /* ---------- 解读格式异常的 502：也只带裁剪后的矩阵 ---------- */
    console.log("\n[解读格式异常]");
    replies.push("not json at all");
    const bad = await call(analysisRoute.POST as never, `/api/projects/${P}/inquiries/${inquiry.id}/compare/analysis`, VIEWER, { id: P, inquiryId: inquiry.id }, { method: "POST" });
    ok(bad.status === 502 && bad.body.costHidden === true && rec(bad.body.matrix).costHidden === true && derived.every((t) => !hay(bad.text).includes(t)) && allLanded.every((t) => !String(rec(bad.body.matrix).summaryZh).includes(t)), "只读成员遇到 502：矩阵已裁剪、带 costHidden、搜不到落地价", { status: bad.status, found: derived.filter((t) => hay(bad.text).includes(t)) });
    replies.push("still not json");
    const badOwner = await call(analysisRoute.POST as never, `/api/projects/${P}/inquiries/${inquiry.id}/compare/analysis`, OWNER, { id: P, inquiryId: inquiry.id }, { method: "POST" });
    ok(badOwner.status === 502 && withoutTime(badOwner.body.matrix) === withoutTime(FM) && !("costHidden" in badOwner.body), "负责人遇到 502：矩阵与改动前相同");

    /* ---------- 数字校验以裁剪后的输入为准 ---------- */
    console.log("\n[解读里冒出落地价]");
    const alderLandedStr = Math.round(rowOf("Alder Supply").landedCad.total!).toLocaleString("en-US");
    const leakyReply = JSON.stringify({ priceAnalysis: `Alder Supply 落地价 ${alderLandedStr} CAD。`, deliveryAnalysis: "交期都在截止前。", risks: "无。", recommendation: "选 Alder Supply。" });
    replies.push(leakyReply);
    const leakV = await call(analysisRoute.POST as never, `/api/projects/${P}/inquiries/${inquiry.id}/compare/analysis`, VIEWER, { id: P, inquiryId: inquiry.id }, { method: "POST" });
    const ncV = rec(leakV.body.numberCheck);
    ok(leakV.status === 200 && ncV.ok === false && JSON.stringify(ncV.unverified).includes(alderLandedStr) && String(rec(leakV.body.analysis).priceAnalysis).includes("［矩阵中无此数］"), "只读成员：模型凭空写出落地价 → 数字校验标出（输入里没有落地价）", ncV);
    replies.push(leakyReply);
    const leakO = await call(analysisRoute.POST as never, `/api/projects/${P}/inquiries/${inquiry.id}/compare/analysis`, OWNER, { id: P, inquiryId: inquiry.id }, { method: "POST" });
    ok(leakO.status === 200 && rec(leakO.body.numberCheck).ok === true, "负责人：同一句解读里的落地价有出处，照常通过", leakO.body.numberCheck);

    /* ---------- 负责人是导入用的系统账号的项目 ---------- */
    console.log("\n[负责人是系统账号]");
    const sysExisting = await db.user.findFirst({ where: { email: "system@qingyan.internal" }, select: { id: true } });
    const SYS = sysExisting?.id ?? (createdSystemUser = (await db.user.create({ data: { email: "system@qingyan.internal", name: "System (API)", role: "user", status: "active", passwordHash: "" } })).id);
    await db.project.create({ data: { id: PSYS, name: `Fixture Imported ${stamp}`, orgId: ORG, ownerId: SYS, workDomain: "tender", intakeStatus: "dispatched", status: "active", closeDate: new Date(now.getTime() + 30 * DAY) } as never });
    await db.projectMember.create({ data: { projectId: PSYS, userId: VIEWER, role: "viewer", status: "active" } });
    await db.projectMember.create({ data: { projectId: PSYS, userId: BIDS, role: "operator", status: "active" } });
    const sysInquiry = await db.projectInquiry.create({ data: { projectId: PSYS, roundNumber: 1, status: "in_progress", dueDate: new Date(now.getTime() + 10 * DAY), createdById: OWNER } });
    await db.pendingAction.create({ data: { type: "tender.send_rfq", title: "第 1 轮询价", preview: "fixture", payload: { inquiryId: sysInquiry.id, projectId: PSYS, roundNumber: 1, items: [{ body: "- 数量：1500 件\n" }] }, status: "executed", createdById: OWNER, orgId: ORG, projectId: PSYS, decidedById: OWNER, decidedAt: now, executedAt: now, expiresAt: new Date(now.getTime() + 3 * DAY), idempotencyKey: `fv-${stamp}-rfq-sys` } });
    const sysSupplier = await db.supplier.create({ data: { orgId: ORG, name: "Dogwood Imported", contactEmail: `dogwood_${stamp}@supplier-fixture.test`, status: "active", createdById: OWNER } as never });
    supplierIds.push(sysSupplier.id);
    await db.inquiryItem.create({ data: { inquiryId: sysInquiry.id, supplierId: sysSupplier.id, createdById: OWNER, status: "quoted", sentAt: new Date(now.getTime() - 3 * DAY), repliedAt: new Date(now.getTime() - DAY), deliveryDays: 10, validUntil: new Date(now.getTime() + 60 * DAY), contactNotes: "threadId=thr-dogwood", totalPrice: 34567.89, currency: "USD", quoteNotes: autoNotes("总价=34567.89；贸易条款=DDP") } as never });
    const sysQuote = await createEngineQuote({ projectId: PSYS, orgId: ORG, userId: OWNER, quoteType: "SUPPLY_ONLY" });
    for (const [u, label] of [[VIEWER, "只读成员"], [BIDS, "bids 岗位 operator"]] as const) {
      const sl = await call(listRoute.GET as never, `/api/projects/${PSYS}/quote-engine`, u, { id: PSYS });
      ok(sl.status === 200 && rec(sl.body.capabilities).hintReason === "no_owner" && rec(sl.body.capabilities).canEdit === false, `${label}：报价列表 capabilities 带 hintReason = no_owner`, sl.body.capabilities);
      const so = await call(oneRoute.GET as never, `/api/projects/${PSYS}/quote-engine/${sysQuote.id}`, u, { id: PSYS, quoteId: sysQuote.id });
      ok(so.status === 200 && "customerView" in so.body && rec(so.body.capabilities).hintReason === "no_owner", `${label}：单个报价（客户视图）capabilities 带 hintReason = no_owner`, so.body.capabilities);
      const sm = await call(matrixRoute.GET as never, `/api/projects/${PSYS}/inquiries/${sysInquiry.id}/compare/matrix`, u, { id: PSYS, inquiryId: sysInquiry.id });
      ok(sm.status === 200 && sm.body.costHidden === true && sm.body.hintReason === "no_owner", `${label}：比价矩阵带 costHidden 与 hintReason = no_owner`, { costHidden: sm.body.costHidden, hintReason: sm.body.hintReason });
    }
    const sa = await call(analysisRoute.POST as never, `/api/projects/${PSYS}/inquiries/${sysInquiry.id}/compare/analysis`, VIEWER, { id: PSYS, inquiryId: sysInquiry.id }, { method: "POST" });
    ok(sa.status === 200 && sa.body.costHidden === true && sa.body.hintReason === "no_owner", "只读成员：AI 报价分析带 hintReason = no_owner", { status: sa.status, hintReason: sa.body.hintReason });
    const st = await call(trackerRoute.GET as never, `/api/org/tender-rfq/tracker?orgId=${ORG}`, VIEWER, {});
    ok(st.status === 200 && st.body.landedHidden === true && st.body.hintReason === "mixed", "只读成员看追踪页（一个项目有负责人、一个是系统账号）：提示原因 mixed", { landedHidden: st.body.landedHidden, hintReason: st.body.hintReason });
    const sAcc = await call(matrixRoute.GET as never, `/api/projects/${PSYS}/inquiries/${sysInquiry.id}/compare/matrix`, ADMIN_ACC, { id: PSYS, inquiryId: sysInquiry.id });
    ok(sAcc.status === 200 && !("costHidden" in sAcc.body) && !("hintReason" in sAcc.body), "有财务查看权的人看系统账号负责的项目：照常，不带提示", sAcc.body.costHidden);
  } finally {
    if (prevEnv.base === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = prevEnv.base;
    if (prevEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevEnv.key;
    if (prevEnv.qe === undefined) delete process.env.TENDER_QUOTE_ENGINE_ENABLED; else process.env.TENDER_QUOTE_ENGINE_ENABLED = prevEnv.qe;
    await db.project.updateMany({ where: { id: { in: PIDS } }, data: { bidQuoteId: null } as never }).catch(() => undefined);
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: users } }, { projectId: { in: PIDS } }] } });
    await db.projectEvent.deleteMany({ where: { projectId: { in: PIDS } } }).catch(() => undefined);
    await db.projectQuote.deleteMany({ where: { projectId: { in: PIDS } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: PIDS } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: PIDS } } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: PIDS } } });
    await db.project.deleteMany({ where: { id: { in: PIDS } } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: createdSystemUser ? [...users, createdSystemUser] : users } } });
    await db.$disconnect();
    server.close();
  }

  console.log(`\nCHAIN-2e finance view compare / quote DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
