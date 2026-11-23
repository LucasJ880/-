/**
 * FIX-26 旧报价单的财务查看裁剪：纯函数、句子、判定兜底、规则检查、Excel 两种内容、编辑器与报价管理区块的静态渲染、接线源码断言
 * （openspec change legacy-quote-finance-gate，spec projects/legacy-quote-finance-view；无 DB / 无模型 / 无浏览器）
 * 运行：npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts
 *
 * 每一组都在 section() 里动态 import 被测模块：在改动前的代码上跑时，缺的模块只让那一组记一条失败，其余组照常跑完
 * （用来记「改动前失败条数」）。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : ""); }
}
async function section(title: string, fn: () => Promise<void>) {
  console.log(`\n${title}`);
  try { await fn(); }
  catch (e) { fail++; console.error(`  ✗ 这一组没跑完：${e instanceof Error ? e.message.split("\n")[0] : String(e)}`); }
}
type Rec = Record<string, unknown>;
const h = React.createElement;
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/* 规格里的句子（写死，不从实现取） */
const S = {
  write: "没有改动：你不是本项目负责人，不能新建、修改、确认或删除报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。",
  writeNoOwner: "没有改动：你不是本项目负责人，不能新建、修改、确认或删除报价单。这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人。",
  writeUnconfirmed: "没有改动：暂时无法确认你的查看权限，请稍后刷新。",
  draft: "没有生成：你不是本项目负责人，不能用 AI 起草报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。",
  draftNoOwner: "没有生成：你不是本项目负责人，不能用 AI 起草报价单。这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人。",
  review: "AI 审查用到的成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。",
  engine: "这份报价是在报价页里做的，旧报价单不能打开或修改它；请到报价页查看和修改。",
  costHidden: "报价单的内部成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。",
  edit: "你不是本项目负责人，不能新建、修改、确认或删除报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。",
  skillDraft: "没有起草：起草报价草稿要看供应商报价并填成本价，只给项目负责人和有全企业「查看项目结算」权限的人用。",
  internalSheet: "内部成本表（含成本和利润率，不要发给客户）",
};

/* 一份「整行」报价（含报价引擎写进同一张表的字段），用来核对白名单 */
const FULL_ROW: Rec = {
  id: "q1", projectId: "p1", templateType: "export_standard", version: 3, status: "draft", title: "Fixture", currency: "CAD",
  tradeTerms: "FOB", paymentTerms: "T/T 30/70", deliveryDays: 21, validUntil: "2027-02-01T00:00:00.000Z", moq: 50, originCountry: "China",
  subtotal: "119175", totalAmount: "119175", internalCost: "91234.56", profitMargin: "23.45", internalNotes: "内部备注-LQ47",
  aiGenerated: true, aiDraftJson: "{\"costPrice\":17.31}", aiReviewJson: "{\"summary\":\"x\"}", inquiryId: null, createdById: "u1",
  createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z",
  orgId: null, quoteType: "CUSTOM", quoteNumber: "Q-1", name: "n", sourceQuoteId: null, revisionReason: null, pricingMethod: "MARKUP_ON_COST",
  pricingRate: "27.13", engineJson: { a: 1 }, summaryJson: { estimatedCost: 87654.32 }, calcVersion: "v1", submittedAt: null, approvedById: null,
  approvedAt: null, supersededAt: null, awardedAt: null, cancelledAt: null, customerJson: { clientName: "c" }, termsJson: { payment: "p" },
  lineItems: [
    { id: "l1", quoteId: "q1", sortOrder: 0, category: "product", itemName: "Roller", specification: "1.2m", unit: "pc", quantity: "100", unitPrice: "18", totalPrice: "1800", remarks: "r", costPrice: "17.31", isInternal: false, section: "A", optional: false, allowance: false, taxable: true, sourceJson: { costLineIds: ["c1"] }, createdAt: "x", updatedAt: "y" },
  ],
};
const HEADER_FIELDS = ["id", "projectId", "templateType", "version", "status", "title", "currency", "tradeTerms", "paymentTerms", "deliveryDays", "validUntil", "moq", "originCountry", "subtotal", "totalAmount", "internalCost", "profitMargin", "internalNotes", "aiGenerated", "aiDraftJson", "aiReviewJson", "inquiryId", "createdById", "createdAt", "updatedAt"];
const LINE_FIELDS = ["id", "sortOrder", "category", "itemName", "specification", "unit", "quantity", "unitPrice", "totalPrice", "remarks", "costPrice", "isInternal"];
const ENGINE_KEYS = ["orgId", "quoteType", "quoteNumber", "name", "sourceQuoteId", "revisionReason", "pricingMethod", "pricingRate", "engineJson", "summaryJson", "calcVersion", "submittedAt", "approvedById", "approvedAt", "supersededAt", "awardedAt", "cancelledAt", "customerJson", "termsJson"];

async function main() {
  console.log("FIX-26 legacy quote finance view — pure");

  await section("[句子]", async () => {
    const fv = await import("@/lib/quote/finance-view");
    const { QUOTE_EDIT_HIDDEN_HINT_ZH } = await import("@/lib/quote-engine/finance-hint");
    ok(fv.legacyQuoteWriteForbiddenZh() === S.write && fv.legacyQuoteWriteForbiddenZh("no_owner") === S.writeNoOwner && fv.legacyQuoteWriteForbiddenZh("unconfirmed") === S.writeUnconfirmed, "写被拒的三种句子与规格逐字相同", [fv.legacyQuoteWriteForbiddenZh(), fv.legacyQuoteWriteForbiddenZh("no_owner"), fv.legacyQuoteWriteForbiddenZh("unconfirmed")]);
    ok(fv.legacyQuoteAiDraftForbiddenZh() === S.draft && fv.legacyQuoteAiDraftForbiddenZh("no_owner") === S.draftNoOwner && fv.legacyQuoteAiDraftForbiddenZh("unconfirmed") === "没有生成：暂时无法确认你的查看权限，请稍后刷新。", "AI 起草被拒的句子（后一句按原因换）");
    ok(fv.legacyQuoteAiReviewForbiddenZh() === S.review && fv.legacyQuoteAiReviewForbiddenZh("unconfirmed") === "暂时无法确认你的查看权限，请稍后刷新。", "AI 审查被拒的句子（由 financeHiddenHintZh 拼成）");
    ok(fv.LEGACY_QUOTE_ENGINE_CONFLICT_ZH === S.engine && fv.engineQuoteHref("p1", "q9") === "/projects/p1/quote-engine/q9", "409 那句与报价页地址");
    ok(fv.legacyQuoteCostHiddenHintZh() === S.costHidden && fv.legacyQuoteEditHintZh() === S.edit && fv.AGENT_QUOTE_DRAFT_HIDDEN_ZH === S.skillDraft, "编辑器两句与智能体起草那句");
    ok(S.edit === QUOTE_EDIT_HIDDEN_HINT_ZH.replace("新建、修改或批准报价", "新建、修改、确认或删除报价单"), "不能编辑那句与报价引擎同一句式，只换了做的事");
    ok(fv.QUOTE_SHEET_LOAD_FAILED_PREFIX_ZH === "打不开这个报价单：" && fv.EXPORT_CUSTOMER_PDF_LABEL_ZH === "导出客户报价单（PDF）" && fv.EXPORT_INTERNAL_EXCEL_LABEL_ZH === "导出内部成本表（Excel）" && fv.EXPORT_EXCEL_LABEL_ZH === "导出 Excel" && fv.INTERNAL_COST_SHEET_TITLE_ZH === S.internalSheet, "读取失败前缀、导出菜单与内部成本表首行");
    const both = fv.legacyQuoteHintLinesZh({ canViewInternal: false, canEdit: false });
    ok(both.length === 2 && both.some((l) => l.text === S.costHidden) && both.some((l) => l.text === S.edit), "看不到也不能编辑：两句各出一次", both);
    ok(fv.legacyQuoteHintLinesZh({ canViewInternal: false, canEdit: false, hintReason: "unconfirmed" }).length === 1, "暂时无法确认：两句相同，只出一次");
    ok(JSON.stringify(fv.legacyQuoteHintLinesZh({ canViewInternal: true, canEdit: false })) === JSON.stringify([{ kind: "edit", text: S.edit }]) && fv.legacyQuoteHintLinesZh({ canViewInternal: true, canEdit: true }).length === 0, "能看不能编辑：只出不能编辑那句；都能：不出");
  });

  await section("[判定：八种身份、出错兜底、没有组织、没有真人负责人]", async () => {
    const { resolveLegacyQuoteCaps } = await import("@/lib/quote/legacy-access");
    const user = (id: string, role = "user") => ({ id, email: `${id}@x.test`, name: id, nickname: null, avatar: null, role, status: "active", canEditCustomers: true });
    const project = (o: Rec = {}) => ({ id: "p1", orgId: "org1", ownerId: "owner", ...o }) as never;
    const keys: Record<string, { manage: boolean; read: boolean }> = { acc: { manage: false, read: true }, boss: { manage: true, read: true } };
    const calls: string[] = [];
    const resolve = async (u: { id: string; role: string }, orgId: string, ownerId: string | null) => {
      calls.push(u.id);
      const k = keys[u.id] ?? { manage: false, read: false };
      const privileged = u.role === "super_admin" || k.manage || (!!ownerId && ownerId === u.id);
      return { privileged, canReadAll: privileged || k.read };
    };
    const deps = { resolve: resolve as never, ownerAssigned: async () => true };
    const cases: Array<[string, string, string | null, string, boolean, boolean]> = [
      ["只读成员", "viewer", "viewer", "user", false, false],
      ["不是负责人的项目管理员", "padmin", "project_admin", "user", false, false],
      ["operator", "oper", "operator", "user", false, false],
      ["组织管理员（不是成员）", "admin", null, "user", false, false],
      ["bids（只在分配范围）", "bids", "operator", "user", false, false],
      ["accounting + viewer", "acc", "viewer", "user", true, false],
      ["项目负责人", "owner", "project_admin", "user", true, true],
      ["平台超级管理员", "super", "project_admin", "super_admin", true, true],
    ];
    for (const [label, uid, role, prole, view, edit] of cases) {
      const c = await resolveLegacyQuoteCaps({ user: user(uid, prole), project: project(), projectRole: role } as never, deps);
      ok(c.canViewInternal === view && c.canEdit === edit && !("hintReason" in c), `${label}：canViewInternal=${view}、canEdit=${edit}`, c);
    }
    const throwing = async () => { throw new Error("authorize down"); };
    const prevErr = console.error;
    console.error = () => undefined;
    try {
      const o = await resolveLegacyQuoteCaps({ user: user("owner"), project: project(), projectRole: "project_admin" } as never, { resolve: throwing as never, ownerAssigned: async () => true });
      const s = await resolveLegacyQuoteCaps({ user: user("super", "super_admin"), project: project(), projectRole: null } as never, { resolve: throwing as never, ownerAssigned: async () => true });
      const a = await resolveLegacyQuoteCaps({ user: user("acc"), project: project(), projectRole: "viewer" } as never, { resolve: throwing as never, ownerAssigned: async () => true });
      const v = await resolveLegacyQuoteCaps({ user: user("viewer"), project: project(), projectRole: "viewer" } as never, { resolve: throwing as never, ownerAssigned: async () => true });
      ok(o.canViewInternal && o.canEdit && s.canViewInternal && s.canEdit, "授权查询出错：负责人与平台超级管理员仍能看、能编辑", { o, s });
      ok(!a.canViewInternal && !a.canEdit && a.hintReason === "unconfirmed" && !v.canViewInternal && v.hintReason === "unconfirmed", "授权查询出错：持财务键的人与只读成员都不能，带 hintReason: unconfirmed", { a, v });
    } finally { console.error = prevErr; }
    calls.length = 0;
    const noOrgOwner = await resolveLegacyQuoteCaps({ user: user("owner"), project: project({ orgId: null }), projectRole: null } as never, deps);
    const noOrgAcc = await resolveLegacyQuoteCaps({ user: user("acc"), project: project({ orgId: null }), projectRole: "viewer" } as never, deps);
    ok(noOrgOwner.canEdit && !noOrgAcc.canViewInternal && calls.length === 0, "项目没有组织：只剩负责人与平台超级管理员，不调用授权查询", { noOrgOwner, noOrgAcc, calls });
    const sys = await resolveLegacyQuoteCaps({ user: user("viewer"), project: project({ ownerId: "system" }), projectRole: "viewer" } as never, { resolve: resolve as never, ownerAssigned: async () => false });
    ok(sys.hintReason === "no_owner" && !sys.canEdit, "负责人是导入用的系统账号：hintReason = no_owner", sys);
  });

  await section("[列表行与详情白名单]", async () => {
    const fv = await import("@/lib/quote/finance-view");
    const row = { id: "q1", templateType: "export_standard", version: 1, status: "draft", title: "T", currency: "CAD", totalAmount: "119175", profitMargin: "23.45", aiGenerated: false, createdAt: "c", updatedAt: "u", _count: { lineItems: 1 } };
    ok(JSON.stringify(fv.legacyQuoteListRow(row, true)) === JSON.stringify(row), "有财务查看权：列表行与输入逐字段相同");
    const hid = fv.legacyQuoteListRow(row, false) as Rec;
    ok(hid.profitMargin === null && JSON.stringify({ ...hid, profitMargin: row.profitMargin }) === JSON.stringify(row), "没有：只把 profitMargin 置 null，其它字段照旧", hid);
    const bodyV = fv.legacyQuoteListBody([row], { canViewInternal: true, canEdit: true }) as Rec;
    const bodyH = fv.legacyQuoteListBody([row], { canViewInternal: false, canEdit: false, hintReason: "no_owner" }) as Rec;
    ok(JSON.stringify(Object.keys(bodyV)) === JSON.stringify(["quotes", "capabilities"]) && JSON.stringify(bodyV.capabilities) === JSON.stringify({ canViewInternal: true, canEdit: true }), "列表响应：quotes + capabilities（能看的人不带 costHidden / hintReason）", bodyV);
    ok(bodyH.costHidden === true && JSON.stringify(bodyH.capabilities) === JSON.stringify({ canViewInternal: false, canEdit: false, hintReason: "no_owner" }), "看不到：带 costHidden 与 hintReason", bodyH);

    const v = fv.legacyQuoteDetailView(FULL_ROW, { canViewInternal: true, canEdit: true }) as Rec;
    ok(HEADER_FIELDS.every((k) => JSON.stringify(v[k]) === JSON.stringify(FULL_ROW[k])) && Object.keys(v).sort().join() === [...HEADER_FIELDS, "lineItems", "capabilities"].sort().join(), "有财务查看权：详情 = 白名单字段，与输入逐字段相同，另加 capabilities", Object.keys(v));
    const vl = (v.lineItems as Rec[])[0];
    ok(LINE_FIELDS.every((k) => JSON.stringify(vl[k]) === JSON.stringify((FULL_ROW.lineItems as Rec[])[0][k])) && Object.keys(vl).sort().join() === [...LINE_FIELDS].sort().join(), "行项：白名单字段逐字段相同，没有 sourceJson / section / optional 等", Object.keys(vl));
    ok(ENGINE_KEYS.every((k) => !(k in v)) && !JSON.stringify(v).includes("87654.32") && !JSON.stringify(v).includes("27.13"), "详情白名单不含任何报价引擎字段（估算成本、定价比例、快照、抬头、条款）");
    const hv = fv.legacyQuoteDetailView(FULL_ROW, { canViewInternal: false, canEdit: false }) as Rec;
    ok(["internalCost", "profitMargin", "internalNotes", "aiDraftJson", "aiReviewJson"].every((k) => k in hv && hv[k] === null) && (hv.lineItems as Rec[]).every((l) => "costPrice" in l && l.costPrice === null) && hv.costHidden === true, "没有财务查看权：内部成本、利润率、内部备注、AI 草稿与审查原文、每行成本价逐个为 null，带 costHidden", hv);
    ok(["title", "totalAmount", "subtotal", "tradeTerms", "status", "version"].every((k) => hv[k] === FULL_ROW[k]) && (hv.lineItems as Rec[])[0].unitPrice === "18" && !["17.31", "91234.56", "23.45", "LQ47"].some((t) => JSON.stringify(hv).includes(t)), "其余字段照旧；整个详情里搜不到成本价、内部成本、利润率、内部备注");
    ok(fv.isEngineQuote({ orgId: "org1" }) && !fv.isEngineQuote({ orgId: null }), "所属组织不为空 = 报价引擎的报价");
    const e403 = fv.legacyQuoteLoadError(403, { error: "无权查看该项目" });
    const e409 = fv.legacyQuoteLoadError(409, { error: S.engine, href: "/projects/p1/quote-engine/q1" });
    const e500 = fv.legacyQuoteLoadError(500, null);
    ok(e403.message === "打不开这个报价单：无权查看该项目" && !e403.href && e409.message === `打不开这个报价单：${S.engine}` && e409.href === "/projects/p1/quote-engine/q1" && e500.message === "打不开这个报价单：请求失败（500）", "读取失败：前缀 + 接口给的原因；409 带报价页地址", [e403, e409, e500]);
  });

  await section("[规则检查]", async () => {
    const { runQuoteChecks } = await import("@/lib/quote/rules");
    const H = { title: "T", templateType: "export_standard" as const, currency: "CAD", tradeTerms: "FOB", paymentTerms: "T/T 30/70", deliveryDays: 21, validUntil: "2027-02-01", moq: 50, originCountry: "China", internalNotes: "" };
    const line = (o: Rec) => ({ sortOrder: 0, category: "product" as const, itemName: "A", specification: "", unit: "pc", quantity: 100, unitPrice: 18, totalPrice: 1800, remarks: "", costPrice: 17.31, isInternal: false, ...o });
    const cases: Array<[string, typeof H, unknown[], string]> = [
      ["low", H, [line({})], "430c9dd89356ffa9"],
      ["warn", H, [line({ costPrice: 16.5 })], "a1f09eb154b8c792"],
      ["high", H, [line({ costPrice: 5 })], "9b9f5c19d5718a31"],
      ["ok", H, [line({ costPrice: 14 })], "af53adfc78fa6e5b"],
      ["gov", { ...H, templateType: "gov_procurement" as never }, [line({ quantity: null })], "1b00e10f093d1829"],
      ["empty", { ...H, tradeTerms: "", originCountry: "" }, [], "3e56a6ddc54ff271"],
    ];
    const MARGIN_IDS = ["low_margin", "margin_warning", "high_margin"];
    for (const [label, hdr, lines, hash] of cases) {
      const def = runQuoteChecks(hdr, lines as never);
      ok(sha(JSON.stringify(def)) === hash, `${label}：默认调用与改动前 JSON.stringify 相同`, sha(JSON.stringify(def)));
      const hidden = runQuoteChecks(hdr, lines as never, undefined, { costHidden: true });
      ok(!hidden.some((c) => MARGIN_IDS.includes(c.id)) && JSON.stringify(hidden) === JSON.stringify(def.filter((c) => !MARGIN_IDS.includes(c.id))) && !JSON.stringify(hidden).includes("利润率"), `${label}：「看不到成本」时没有利润率检查项，其余与默认相同`, hidden.map((c) => c.id));
    }
  });

  await section("[Excel 两种内容]", async () => {
    const { buildQuoteExcelContent } = await import("@/lib/quote/export-excel");
    const header = { title: "T", templateType: "export_standard" as const, currency: "CAD", tradeTerms: "FOB", paymentTerms: "T/T", deliveryDays: 21, validUntil: "2027-02-01", moq: 50, originCountry: "China", internalNotes: "" };
    const lines = [{ sortOrder: 0, category: "product" as const, itemName: "A", specification: "s", unit: "pc", quantity: 100, unitPrice: 18, totalPrice: 1800, remarks: "r", costPrice: 17.31, isInternal: false }];
    const totals = { subtotal: 1800, internalCost: 1731, totalAmount: 1800, profitMargin: 3.83, lineCount: 1 };
    const base = { header, lines, totals, projectName: "Fixture", quoteVersion: 2 };
    const vis = buildQuoteExcelContent({ ...base, costVisible: true });
    const hid = buildQuoteExcelContent({ ...base, costVisible: false });
    const label = (rows: unknown[][]) => rows.map((r) => r[0]);
    ok(vis.infoRows[0][0] === S.internalSheet && label(vis.infoRows).includes("内部成本") && label(vis.infoRows).includes("利润率") && vis.lineRows[0].includes("成本价（内部）") && vis.lineRows[1].includes(17.31), "能看成本：首行是内部成本表那句，有内部成本、利润率两行与成本价一列", vis);
    ok(hid.infoRows[0][0] === "报价单信息" && !label(hid.infoRows).includes("内部成本") && !label(hid.infoRows).includes("利润率") && !hid.lineRows[0].includes("成本价（内部）") && !JSON.stringify(hid).includes("17.31") && !JSON.stringify(hid).includes("1731") && !JSON.stringify(hid).includes("3.83"), "看不到成本：首行「报价单信息」，没有内部成本、利润率与成本价", hid);
    const visRest = vis.infoRows.slice(1).filter((r) => r[0] !== "内部成本" && r[0] !== "利润率");
    ok(JSON.stringify(visRest) === JSON.stringify(hid.infoRows.slice(1)) && JSON.stringify(vis.lineRows.map((r) => r.slice(0, 9))) === JSON.stringify(hid.lineRows) && vis.filename === hid.filename && vis.lineRows[0].length === 10, "其余单元格与文件名两者相同（内部版只多那三样）");
    const src = code("src/lib/quote/export-excel.ts");
    ok(/costVisible: boolean/.test(src) && !/costVisible\?:/.test(src), "导出参数里能不能看成本是必填（漏传编译不过）");
  });

  await section("[编辑器四种状态与各组件]", async () => {
    const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
    const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
    const render = (el: React.ReactElement) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, el));
    const prevErr = console.error;
    console.error = (...a: unknown[]) => { if (!String(a[0]).includes("non-boolean attribute")) prevErr(...a); };
    try {
      const ed = await import("@/components/quote/quote-editor");
      const detail = (caps: Rec, hidden: boolean) => ({ ...FULL_ROW, ...(hidden ? { internalCost: null, profitMargin: null, internalNotes: null, aiDraftJson: null, aiReviewJson: null, costHidden: true, lineItems: (FULL_ROW.lineItems as Rec[]).map((l) => ({ ...l, costPrice: null })) } : {}), capabilities: caps });
      const noBoth = render(h(ed.QuoteEditorView, { projectId: "p1", projectName: "P", quoteId: "q1", detail: detail({ canViewInternal: false, canEdit: false }, true) as never }));
      const noHints = (html: string) => html.split(S.costHidden).join("").split(S.edit).join("");
      ok(noBoth.includes(S.costHidden) && noBoth.includes(S.edit) && !noHints(noBoth).includes("成本价") && !noHints(noBoth).includes("内部成本") && !noHints(noBoth).includes("利润率") && !noBoth.includes("保存草稿") && !noBoth.includes("确认报价"), "看不到且不能编辑：两句话；没有成本价一栏、内部成本、利润率、保存与确认", noBoth.slice(0, 600));
      ok(!noBoth.includes("AI 草稿生成") && !noBoth.includes("AI 深度审查") && !noBoth.includes("一键生成完整报价") && !noBoth.includes("添加行") && /<input[^>]*disabled/.test(noBoth) && !/<input(?![^>]*disabled)[^>]*>/.test(noBoth), "不能编辑：没有 AI 起草、AI 审查、AI 自动流、添加行；输入框全是只读");
      ok(noBoth.includes("导出客户报价单（PDF）") || noBoth.includes("导出"), "仍可导出（客户报价单）");
      const viewOnly = render(h(ed.QuoteEditorView, { projectId: "p1", projectName: "P", quoteId: "q1", detail: detail({ canViewInternal: true, canEdit: false }, false) as never }));
      ok(viewOnly.includes("内部成本") && viewOnly.includes("成本价") && viewOnly.includes(S.edit) && !viewOnly.includes(S.costHidden) && !viewOnly.includes("保存草稿") && !viewOnly.includes("AI 深度审查"), "能看不能编辑：有成本，只有不能编辑那句，没有保存与 AI 审查", viewOnly.slice(0, 600));
      const full = render(h(ed.QuoteEditorView, { projectId: "p1", projectName: "P", quoteId: "q1", detail: detail({ canViewInternal: true, canEdit: true }, false) as never }));
      ok(full.includes("保存草稿") && full.includes("确认报价") && full.includes("成本价") && full.includes("利润率") && full.includes("AI 深度审查") && !full.includes(S.edit) && !full.includes(S.costHidden), "能看能编辑：与改动前一样有保存、确认、成本价、利润率、AI 审查，不出两句话");
      const missingCaps = render(h(ed.QuoteEditorView, { projectId: "p1", projectName: "P", quoteId: "q1", detail: { ...FULL_ROW } as never }));
      ok(!missingCaps.includes("保存草稿") && !noHints(missingCaps).includes("内部成本") && missingCaps.includes(S.costHidden), "接口没带 capabilities 时按看不到、不能编辑处理（不放开）");
      const f403 = render(h(ed.QuoteLoadFailed, { message: "打不开这个报价单：无权查看该项目" }));
      ok(f403.includes("打不开这个报价单：无权查看该项目") && !f403.includes("<input") && !f403.includes("去报价页"), "403：只写「打不开这个报价单：无权查看该项目」，没有空白表单", f403);
      const f409 = render(h(ed.QuoteLoadFailed, { message: `打不开这个报价单：${S.engine}`, href: "/projects/p1/quote-engine/q1" }));
      ok(f409.includes(S.engine) && f409.includes("href=\"/projects/p1/quote-engine/q1\"") && f409.includes("去报价页") && !f409.includes("<input"), "409：写那句并有去报价页的链接，没有空白表单", f409);

      const { QuoteSummaryBar } = await import("@/components/quote/quote-summary-bar");
      const totals = { subtotal: 1800, internalCost: 1731, totalAmount: 1800, profitMargin: 3.83, lineCount: 1 };
      const sbH = render(h(QuoteSummaryBar, { totals, currency: "CAD", status: "draft", showCost: false } as never));
      const sbV = render(h(QuoteSummaryBar, { totals, currency: "CAD", status: "draft", showCost: true } as never));
      ok(sbH.includes("报价总额") && !sbH.includes("内部成本") && !sbH.includes("利润率") && !sbH.includes("1,731") && !sbH.includes("3.83"), "合计条看不到成本：只有报价总额", sbH);
      ok(sbV.includes("内部成本") && sbV.includes("1,731.00") && sbV.includes("3.83%"), "合计条能看：内部成本与利润率照旧");
      const sbSrc = code("src/components/quote/quote-summary-bar.tsx");
      ok(/EXPORT_CUSTOMER_PDF_LABEL_ZH/.test(sbSrc) && /EXPORT_INTERNAL_EXCEL_LABEL_ZH/.test(sbSrc) && /EXPORT_EXCEL_LABEL_ZH/.test(sbSrc) && !/导出 PDF/.test(sbSrc), "导出菜单：PDF 写「导出客户报价单（PDF）」，Excel 按能不能看成本写两种");

      const { QuoteLineTable } = await import("@/components/quote/quote-line-table");
      const lt = [{ sortOrder: 0, category: "product", itemName: "A", specification: "", unit: "", quantity: 1, unitPrice: 2, totalPrice: 2, remarks: "", costPrice: 1.5, isInternal: false }];
      const ltH = render(h(QuoteLineTable, { lines: lt, onChange: () => undefined, disabled: true, showCost: false } as never));
      const ltV = render(h(QuoteLineTable, { lines: lt, onChange: () => undefined, disabled: false, showCost: true } as never));
      ok(!ltH.includes("成本价") && !ltH.includes("value=\"1.5\"") && ltV.includes("成本价") && ltV.includes("value=\"1.5\""), "行项表：看不到成本时没有成本价一栏", { ltH: ltH.slice(0, 300) });

      const { QuoteTopSummary } = await import("@/components/quote/quote-top-summary");
      const tsH = render(h(QuoteTopSummary, { templateType: "export_standard", checks: [], profitMargin: null, status: "confirmed", lineCount: 1, showCost: false, canEdit: false } as never));
      ok(!tsH.includes("利润率") && !tsH.includes("内部版"), "顶部摘要看不到成本：不显示利润率、不提内部版", tsH);

      const { QuoteAiPanel } = await import("@/components/quote/quote-ai-panel");
      const header = { title: "T", templateType: "export_standard", currency: "CAD", tradeTerms: "", paymentTerms: "", deliveryDays: null, validUntil: "", moq: null, originCountry: "", internalNotes: "" };
      const apNo = render(h(QuoteAiPanel, { projectId: "p1", quoteId: "q1", header, lines: [], checks: [], onTemplateChange: () => undefined, onApplyCheckAction: () => undefined, onApplyDraft: () => undefined, status: "draft", canEdit: false, showCost: false } as never));
      ok(!apNo.includes("一键生成完整报价") && !apNo.includes("AI 草稿生成") && !apNo.includes("AI 深度审查"), "AI 面板不能编辑：没有 AI 自动流、AI 起草、AI 审查", apNo.slice(0, 400));
      const apConf = render(h(QuoteAiPanel, { projectId: "p1", quoteId: "q1", header, lines: lt, checks: [], onTemplateChange: () => undefined, onApplyCheckAction: () => undefined, onApplyDraft: () => undefined, status: "confirmed", canEdit: true, showCost: false } as never));
      const apConfV = render(h(QuoteAiPanel, { projectId: "p1", quoteId: "q1", header, lines: lt, checks: [], onTemplateChange: () => undefined, onApplyCheckAction: () => undefined, onApplyDraft: () => undefined, status: "confirmed", canEdit: true, showCost: true } as never));
      const apEdit = render(h(QuoteAiPanel, { projectId: "p1", quoteId: "q1", header, lines: [], checks: [], onTemplateChange: () => undefined, onApplyCheckAction: () => undefined, onApplyDraft: () => undefined, status: "draft", canEdit: true, showCost: true } as never));
      ok(apEdit.includes("一键生成完整报价") && apEdit.includes("AI 草稿生成") && apEdit.includes("AI 深度审查"), "AI 面板能编辑：与改动前一样");
      ok(apConfV.includes("输出版本") && read("src/components/quote/quote-ai-panel.tsx").includes("内部成本表") && !apConf.includes("内部成本表") && /showCost &&[\s\S]{0,80}内部成本表/.test(code("src/components/quote/quote-ai-panel.tsx")), "AI 面板「输出版本」：看不到成本时不出「内部成本表」");

      const sec = await import("@/components/quote/project-quote-section");
      const q = { id: "q1", templateType: "export_standard", version: 1, status: "draft", title: "T", currency: "CAD", totalAmount: "1800", profitMargin: null, aiGenerated: false, createdAt: "c", updatedAt: "u", _count: { lineItems: 1 } };
      const sNo = render(h(sec.ProjectQuoteSectionView, { quotes: [q], capabilities: { canViewInternal: false, canEdit: false }, loading: false, creating: false, onCreate: () => undefined, onOpen: () => undefined } as never));
      const sYes = render(h(sec.ProjectQuoteSectionView, { quotes: [q], capabilities: { canViewInternal: true, canEdit: true }, loading: false, creating: false, onCreate: () => undefined, onOpen: () => undefined } as never));
      const sNoOwner = render(h(sec.ProjectQuoteSectionView, { quotes: [], capabilities: { canViewInternal: false, canEdit: false, hintReason: "no_owner" }, loading: false, creating: false, onCreate: () => undefined, onOpen: () => undefined } as never));
      ok(!sNo.includes("新建报价") && sNo.includes(S.edit) && sNo.includes("CAD 1,800.00") && sYes.includes("新建报价") && !sYes.includes(S.edit), "报价管理区块：不能编辑时不出「新建报价」、写那句；列表照旧显示总额", { sNo: sNo.slice(0, 400) });
      ok(sNoOwner.includes("这个项目还没有指定负责人") && !sNoOwner.includes("新建报价") && !sNoOwner.includes("创建报价单"), "报价管理区块：没有真人负责人时换句，空列表不再引人去创建", sNoOwner);
    } finally { console.error = prevErr; }
  });

  await section("[接线源码断言]", async () => {
    const list = code("src/app/api/projects/[id]/quotes/route.ts");
    ok(/orgId: null/.test(list) && /legacyQuoteListBody\(/.test(list) && /resolveLegacyQuoteCaps\(access\)/.test(list) && /legacyQuoteWriteForbiddenZh\(/.test(list), "列表只取 orgId 为空的旧报价单、按能力裁剪；新建要能编辑");
    const one = code("src/app/api/projects/[id]/quotes/[quoteId]/route.ts");
    ok((one.match(/isEngineQuote\(/g) ?? []).length === 3 && /isInternal: false/.test(one) && !/item\.isInternal/.test(one) && (one.match(/legacyQuoteDetailView\(/g) ?? []).length === 2, "详情 / 修改 / 删除都先判报价引擎的报价；修改时每行一律存非内部行；详情与修改返回都走白名单");
    const rv = code("src/app/api/projects/[id]/quotes/[quoteId]/ai/review/route.ts");
    ok(/isEngineQuote\(/.test(rv) && /caps\.canViewInternal/.test(rv) && rv.indexOf("caps.canViewInternal") < rv.indexOf("createCompletion("), "AI 审查：先判引擎报价与财务查看权，再调模型");
    const gd = code("src/app/api/projects/[id]/quotes/ai/generate-draft/route.ts");
    ok(/caps\.canEdit/.test(gd) && gd.indexOf("caps.canEdit") < gd.indexOf("request.json()"), "AI 起草：先判能不能编辑，再读请求体");
    const sv = code("src/app/api/projects/[id]/quotes/save-ai-draft/route.ts");
    ok(/caps\.canEdit/.test(sv) && sv.indexOf("caps.canEdit") < sv.indexOf("request.json()"), "保存 AI 草稿：先判能不能编辑，再读请求体");
    const ed = code("src/components/quote/quote-editor.tsx");
    ok(/costHidden: !costVisible/.test(ed) && /costVisible,?\s*\}/.test(ed) && /legacyQuoteLoadError\(/.test(ed) && !/if \(!res\.ok\) return;/.test(ed), "编辑器：规则检查按「看不到成本」跑、Excel 按能不能看成本导、读取失败写原因（不再静默留空白表单）");
    const skill = code("src/lib/agent/skills/quote.ts");
    ok(/resolveLegacyQuoteCapsForUser\(ctx\.userId, ctx\.projectId\)/.test(skill) && /projectId: ctx\.projectId/.test(skill.slice(skill.indexOf("async function executeReview"))), "智能体报价技能：按执行的人判，审查只取本项目的报价");
    const ps = code("src/lib/agent-core/tools/project-skills.ts");
    ok(/probeProjectAccess\(/.test(ps) && (ps.match(/probeProjectAccess\(/g) ?? []).length === 1, "project-skills.ts 只对 project_bid_quote 加项目读权限检查");
    const ro = code("src/lib/agent-core/tools/enterprise-readonly.ts");
    const sec = ro.split("registry.register").find((s) => s.includes('name: "project_get_project_quotes"')) ?? "";
    ok(/probeProjectAccess\(/.test(sec) && /costHidden: true/.test(sec) && /profitMargin: null/.test(sec), "project_get_project_quotes：先查项目读权限，没有财务查看权时 profitMargin 为 null、带 costHidden");
    const svc = code("src/lib/quote-engine/service.ts");
    ok(!/sourceCost/.test(svc) && !/sourceMargin/.test(svc) && /sourceSellingPrice/.test(svc), "另起新版的审计不再写 sourceCost / sourceMargin（卖价照旧）");
    ok(!code("src/lib/quote/finance-view.ts").includes("next/server") && !code("src/lib/quote/finance-view.ts").includes("@/lib/db"), "finance-view.ts 是纯模块（不 import next/server 与数据库）");
  });

  console.log(`\nFIX-26 legacy quote finance view: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
