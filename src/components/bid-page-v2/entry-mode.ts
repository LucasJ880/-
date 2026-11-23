/**
 * BIDPAGE-1 入口分流与页内位置（纯函数，前端用；零依赖）
 *
 * - 汇总接口的响应只有 `{ enabled: true, view: {...} }` 才换新页面；还没进新页面时，404、500、请求失败、字段不对一律留在改版前的页面；
 *   已经在新页面上时，只有明确 404（未启用）才回到改版前的页面，其余出错保留当前这份（金额门不因一次出错放行）。
 * - 地址里的 #位置 落在哪个分区，就展开哪个分区（项目页「下一步」卡跳转用）；它优先于「下一步」指向的分区。
 */
import { BID_PAGE_SECTIONS, type BidPageSection, type BidPageView } from "@/lib/bid-page-v2/next-step";

export type SummaryResult = { ok: true; view: BidPageView } | { ok: false };

/** 汇总接口响应 → 用不用新页面。只认 HTTP 200 且 enabled === true 且 view 形状对得上 */
export function parseSummaryResponse(status: number, body: unknown): SummaryResult {
  if (status !== 200 || !body || typeof body !== "object") return { ok: false };
  const b = body as { enabled?: unknown; view?: unknown };
  if (b.enabled !== true || !isView(b.view)) return { ok: false };
  return { ok: true, view: b.view };
}

/** 一次汇总请求的结果：已开启 / 明确未启用（404）/ 出错（其余一切：500、401、请求失败、不是 JSON、形状不对） */
export type SummaryOutcome = { kind: "enabled"; view: BidPageView } | { kind: "disabled" } | { kind: "error" };

export function classifySummaryResponse(status: number, body: unknown): SummaryOutcome {
  const parsed = parseSummaryResponse(status, body);
  if (parsed.ok) return { kind: "enabled", view: parsed.view };
  return status === 404 ? { kind: "disabled" } : { kind: "error" };
}

type FetchLike = (input: string, init?: { credentials?: "include"; cache?: "no-store" }) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** 请求汇总接口（GET，带 cookie、不缓存）；任何异常都归为「出错」，不抛、不打日志、不跳转 */
export async function fetchSummary(projectId: string, fetchImpl: FetchLike): Promise<SummaryOutcome> {
  try {
    const res = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/bid-page-summary`, { credentials: "include", cache: "no-store" });
    const body: unknown = await res.json().catch(() => null);
    return classifySummaryResponse(res.status, body);
  } catch {
    return { kind: "error" };
  }
}

/**
 * 拿到结果后页面用哪份汇总：
 * - 已开启 → 新的这份；
 * - 明确未启用（404）→ 没有（改版前的页面）；
 * - 出错 → 维持现状：还没进新页面时仍是改版前的页面；已经在新页面上时保留上一份（不退回旧页面）。
 */
export function nextView(prev: BidPageView | null, outcome: SummaryOutcome): BidPageView | null {
  if (outcome.kind === "enabled") return outcome.view;
  if (outcome.kind === "disabled") return null;
  return prev;
}

function isView(v: unknown): v is BidPageView {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<BidPageView>;
  if (typeof x.rule !== "string" || typeof x.headlineZh !== "string") return false;
  if (!x.action || typeof x.action.labelZh !== "string" || !x.action.target) return false;
  if (!x.sections || BID_PAGE_SECTIONS.some((s) => typeof x.sections?.[s]?.statusZh !== "string")) return false;
  if (!(BID_PAGE_SECTIONS as readonly string[]).includes(x.expanded as string)) return false;
  if (!x.viewer || typeof x.viewer.canViewAmounts !== "boolean" || typeof x.viewer.quoteAvailable !== "boolean" || typeof x.viewer.canGenerate !== "boolean") return false;
  return true;
}

/** 页内位置 → 所在分区；不认识的位置为 null */
export function sectionForAnchor(hash: string | null | undefined): BidPageSection | null {
  let id = (hash ?? "").replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    /* 写坏了的 #位置：按原样比 */
  }
  id = id.trim();
  if (!id) return null;
  if (id === "rfq-section" || id.startsWith("rfq-round-") || id === "bid-page-sourcing") return "sourcing";
  if (id === "bid-quote-area" || id === "bid-workspace" || id === "bid-page-quote") return "quote";
  if (id === "bid-page-documents") return "documents";
  return null;
}

/** 分区自己的位置 id（「下一步」按钮滚到这里） */
export const SECTION_ANCHOR: Record<BidPageSection, string> = {
  sourcing: "bid-page-sourcing",
  quote: "bid-page-quote",
  documents: "bid-page-documents",
};
