/**
 * FIX-26：旧报价单（`ProjectQuote` 里所属组织为空的行）的财务查看裁剪、详情白名单、是否报价引擎的报价与固定句子。
 * 纯模块：不 import next/server 与数据库，客户端组件（编辑器、报价管理区块）也 import 这里的句子。
 *
 * 判定（谁能看、谁能编辑）不在这里：服务端由 legacy-access.ts 按 CHAIN-2e 的 resolveFinanceViewSafe +
 * resolveQuoteCapabilities 算出 LegacyQuoteCaps，再交给这里的纯函数裁剪。
 * - 能看（canViewInternal）= 平台超级管理员、持组织范围 project.finance.manage / project.finance.read 的人、项目负责人
 * - 能编辑（canEdit）= 能看 且（上述特权之一，或项目角色带成本写权限）
 * 有财务查看权时这里的函数对输入逐字段原样返回（测试用 JSON.stringify 比）。
 */
import { financeHiddenHintZh, NO_OWNER_NEXT_STEP_ZH, UNCONFIRMED_HINT_ZH } from "@/lib/project-finance/view-hint";
import { QUOTE_EDIT_HIDDEN_HINT_ZH } from "@/lib/quote-engine/finance-hint";

/** 接口 capabilities 里的 hintReason：默认（没有权限、有真人负责人）时不带 */
export type LegacyQuoteHintReason = "no_owner" | "unconfirmed";
export type LegacyQuoteCaps = { canViewInternal: boolean; canEdit: boolean; hintReason?: LegacyQuoteHintReason };

/* ------------------------------------------------------------------ 句子 */

/** 「要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。」——取自报价引擎同一句的后半句 */
const ASSIGN_OWNER_ZH = `${QUOTE_EDIT_HIDDEN_HINT_ZH.split("。")[1]}。`;
const NOT_OWNER_EDIT_ZH = "你不是本项目负责人，不能新建、修改、确认或删除报价单。";
const NOT_OWNER_AI_DRAFT_ZH = "你不是本项目负责人，不能用 AI 起草报价单。";

function notOwnerHint(lead: string, reason?: LegacyQuoteHintReason): string {
  if (reason === "unconfirmed") return UNCONFIRMED_HINT_ZH;
  return `${lead}${reason === "no_owner" ? NO_OWNER_NEXT_STEP_ZH : ASSIGN_OWNER_ZH}`;
}

/** 不能编辑时（编辑器顶部、报价管理区块；不带「没有改动：」）。canEdit = false 的人一定不是负责人（负责人是特权） */
export function legacyQuoteEditHintZh(reason?: LegacyQuoteHintReason): string {
  return notOwnerHint(NOT_OWNER_EDIT_ZH, reason);
}

/** 新建 / 修改 / 确认 / 删除 / 保存 AI 草稿被拒（403） */
export function legacyQuoteWriteForbiddenZh(reason?: LegacyQuoteHintReason): string {
  return `没有改动：${legacyQuoteEditHintZh(reason)}`;
}

/** AI 起草被拒（403） */
export function legacyQuoteAiDraftForbiddenZh(reason?: LegacyQuoteHintReason): string {
  return `没有生成：${notOwnerHint(NOT_OWNER_AI_DRAFT_ZH, reason)}`;
}

/** AI 审查被拒（403）：审查要把成本与利润率交给模型 */
export function legacyQuoteAiReviewForbiddenZh(reason?: LegacyQuoteHintReason): string {
  return financeHiddenHintZh("AI 审查用到的成本和利润率", reason ?? "no_access");
}

/** 编辑器顶部：看不到内部成本与利润率时 */
export function legacyQuoteCostHiddenHintZh(reason?: LegacyQuoteHintReason): string {
  return financeHiddenHintZh("报价单的内部成本和利润率", reason ?? "no_access");
}

/** 旧接口遇到报价引擎 / 逐行报价 / 只报总价的报价（409） */
export const LEGACY_QUOTE_ENGINE_CONFLICT_ZH = "这份报价是在报价页里做的，旧报价单不能打开或修改它；请到报价页查看和修改。";
export function engineQuoteHref(projectId: string, quoteId: string): string {
  return `/projects/${projectId}/quote-engine/${quoteId}`;
}

/** 智能体报价技能起草被拒 */
export const AGENT_QUOTE_DRAFT_HIDDEN_ZH = "没有起草：起草报价草稿要看供应商报价并填成本价，只给项目负责人和有全企业「查看项目结算」权限的人用。";

/** 编辑器读取失败 */
export const QUOTE_SHEET_LOAD_FAILED_PREFIX_ZH = "打不开这个报价单：";
export const GO_TO_QUOTE_PAGE_ZH = "去报价页";

/** 导出菜单 */
export const EXPORT_CUSTOMER_PDF_LABEL_ZH = "导出客户报价单（PDF）";
export const EXPORT_INTERNAL_EXCEL_LABEL_ZH = "导出内部成本表（Excel）";
export const EXPORT_EXCEL_LABEL_ZH = "导出 Excel";
/** 有财务查看权的人导出的 Excel：第一张表首行 */
export const INTERNAL_COST_SHEET_TITLE_ZH = "内部成本表（含成本和利润率，不要发给客户）";

/** 编辑器顶部该出哪几句：不能编辑那句、看不到成本那句；同一句只出一次（暂时无法确认时两句相同） */
export function legacyQuoteHintLinesZh(caps: LegacyQuoteCaps): Array<{ kind: "edit" | "cost"; text: string }> {
  const out: Array<{ kind: "edit" | "cost"; text: string }> = [];
  if (!caps.canEdit) out.push({ kind: "edit", text: legacyQuoteEditHintZh(caps.hintReason) });
  if (!caps.canViewInternal) out.push({ kind: "cost", text: legacyQuoteCostHiddenHintZh(caps.hintReason) });
  return out.filter((l, i) => out.findIndex((x) => x.text === l.text) === i);
}

/* ------------------------------------------------------------------ 判别与裁剪 */

/** 所属组织不为空 = 报价引擎、逐行报价（BIDPAGE-3）或只报总价（BIDPAGE-4）建的报价；旧路由建报价从不写所属组织 */
export function isEngineQuote(row: { orgId?: string | null }): boolean {
  return row.orgId != null;
}

/** 响应里的 capabilities：默认那句时不带 hintReason */
export function capabilitiesField(caps: LegacyQuoteCaps): LegacyQuoteCaps {
  return { canViewInternal: caps.canViewInternal, canEdit: caps.canEdit, ...(caps.hintReason ? { hintReason: caps.hintReason } : {}) };
}

/** 列表行：看不到时只把 profitMargin 置 null（总额照旧） */
export function legacyQuoteListRow<T extends { profitMargin?: unknown }>(row: T, canViewInternal: boolean): T {
  return canViewInternal ? row : ({ ...row, profitMargin: null } as T);
}

/** 列表响应：{ quotes, capabilities }，看不到时另带 costHidden: true */
export function legacyQuoteListBody<T extends { profitMargin?: unknown }>(rows: T[], caps: LegacyQuoteCaps): Record<string, unknown> {
  return {
    quotes: rows.map((r) => legacyQuoteListRow(r, caps.canViewInternal)),
    capabilities: capabilitiesField(caps),
    ...(caps.canViewInternal ? {} : { costHidden: true }),
  };
}

/** 详情白名单：报价头、合计、内部数字、AI 原文、关联与创建信息——编辑器只读这些（quote-editor.tsx） */
export const LEGACY_QUOTE_DETAIL_FIELDS = [
  "id", "projectId", "templateType", "version", "status", "title", "currency", "tradeTerms", "paymentTerms", "deliveryDays",
  "validUntil", "moq", "originCountry", "subtotal", "totalAmount", "internalCost", "profitMargin", "internalNotes",
  "aiGenerated", "aiDraftJson", "aiReviewJson", "inquiryId", "createdById", "createdAt", "updatedAt",
] as const;
/** 行项白名单（不含报价引擎的分组、可选项、暂定金额、应税与内部溯源） */
export const LEGACY_QUOTE_LINE_FIELDS = [
  "id", "sortOrder", "category", "itemName", "specification", "unit", "quantity", "unitPrice", "totalPrice", "remarks", "costPrice", "isInternal",
] as const;
/** 没有财务查看权时置 null 的报价头字段（另：每行 costPrice） */
export const LEGACY_QUOTE_HIDDEN_FIELDS = ["internalCost", "profitMargin", "internalNotes", "aiDraftJson", "aiReviewJson"] as const;

function pick(src: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in src) out[k] = src[k];
  return out;
}

/** 详情 / 修改成功的返回：只给旧报价单字段；看不到时内部数字置 null 并带 costHidden；都带 capabilities */
export function legacyQuoteDetailView(quote: Record<string, unknown>, caps: LegacyQuoteCaps): Record<string, unknown> {
  const head = pick(quote, LEGACY_QUOTE_DETAIL_FIELDS);
  const lines = (Array.isArray(quote.lineItems) ? (quote.lineItems as Array<Record<string, unknown>>) : []).map((l) => {
    const line = pick(l, LEGACY_QUOTE_LINE_FIELDS);
    return caps.canViewInternal ? line : { ...line, costPrice: null };
  });
  if (!caps.canViewInternal) for (const k of LEGACY_QUOTE_HIDDEN_FIELDS) head[k] = null;
  return {
    ...head,
    lineItems: lines,
    capabilities: capabilitiesField(caps),
    ...(caps.canViewInternal ? {} : { costHidden: true }),
  };
}

/** 编辑器读取失败：「打不开这个报价单：」+ 接口给的原因；409（报价引擎的报价）另给报价页地址 */
export function legacyQuoteLoadError(status: number, body: unknown): { message: string; href?: string } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const reason = typeof b.error === "string" && b.error.trim() ? b.error : `请求失败（${status}）`;
  const href = status === 409 && typeof b.href === "string" && b.href.startsWith("/projects/") ? b.href : undefined;
  return { message: `${QUOTE_SHEET_LOAD_FAILED_PREFIX_ZH}${reason}`, ...(href ? { href } : {}) };
}
