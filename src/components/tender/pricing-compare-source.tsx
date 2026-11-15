/**
 * FLOW-H2 报价表助手里的「来自比价矩阵」一行（纯呈现）
 *
 * 只建议：按钮只把数字填进「我方成本」输入框（onFill），保存由卡片上原来的「保存并重算」完成。
 */

import {
  FILL_BUTTON_ZH,
  breakdownLinesZh,
  gstNoteZh,
  markupHintZh,
  laterRoundsZh,
  money2,
  quantityBasisZh,
  type CompareCostView,
} from "@/lib/tender-pricing/compare-cost-source";

export function CompareCostSourceBlock({
  view,
  canManage,
  onFill,
}: {
  view: CompareCostView;
  canManage: boolean;
  onFill: () => void;
}) {
  const s = view.suggestion;
  const src = view.source;
  return (
    <div className="mt-3 rounded-lg border border-border/60 px-3 py-2 text-xs" data-testid="pricing-compare-source">
      <p className="font-medium">来自比价矩阵</p>
      {s.status === "none_selected" || s.status === "unavailable" ? (
        <p className="mt-1 text-muted">{s.messageZh}</p>
      ) : s.status === "unconvertible" ? (
        <p className="mt-1 text-muted" data-testid="pricing-compare-unconvertible">
          {s.supplierName} 第 {s.roundNumber} 轮（已选定）换算不出落地价：{s.reasons.join("；")}
        </p>
      ) : (
        <>
          <p className="mt-1 text-foreground/85">
            {s.supplierName} · 第 {s.roundNumber} 轮（已选定）· 落地价 <b className="font-mono">{money2(s.landedCadTotal)}</b> CAD ·{" "}
            {quantityBasisZh(s.quantityBasis)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted" data-testid="pricing-compare-breakdown">
            {breakdownLinesZh(s.breakdown).join(" · ")} · {gstNoteZh(s.breakdown)}
          </p>
          {s.assumptions.length > 0 ? (
            <p className="mt-0.5 text-[10px] text-muted" data-testid="pricing-compare-assumptions">
              换算依据：{s.assumptions.join("；")}
            </p>
          ) : null}
          {s.warnings.length > 0 ? <p className="mt-0.5 text-[10px] text-amber-700">{s.warnings.join("；")}</p> : null}
          {canManage ? (
            <button
              type="button"
              data-testid="pricing-compare-fill"
              onClick={onFill}
              className="mt-1.5 rounded border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent/5"
            >
              {FILL_BUTTON_ZH}
            </button>
          ) : null}
          {canManage ? <span className="ml-2 text-[10px] text-muted">只填进输入框；点「保存并重算」才生效，手填可覆盖</span> : null}
        </>
      )}
      {(s.status === "ok" || s.status === "unconvertible") && laterRoundsZh(s.laterUnselectedRounds) ? (
        <p className="mt-0.5 text-[10px] text-muted">{laterRoundsZh(s.laterUnselectedRounds)}</p>
      ) : null}
      {src ? (
        <p className="mt-1 text-[10px] text-muted" data-testid="pricing-cost-source">
          已保存的我方成本：
          {src.kind === "rfq_compare"
            ? `来自比价矩阵（${src.supplierName} 第 ${src.roundNumber} 轮，${quantityBasisZh(src.quantityBasis)}）`
            : "手填"}
        </p>
      ) : null}
      {view.staleNoteZh ? (
        <p className="mt-1 rounded border border-amber-200/70 bg-amber-50/40 px-2 py-1 text-[11px]" data-testid="pricing-compare-stale">
          {view.staleNoteZh}
        </p>
      ) : null}
    </div>
  );
}

/** 目标毛利旁的成本加成换算；开关关闭（enabled = false）时不显示，卡片与原来相同 */
export function MarkupHint({ enabled, margin }: { enabled: boolean; margin: string }) {
  if (!enabled) return null;
  const n = margin.trim() === "" ? null : Number(margin);
  const hint = markupHintZh(n);
  return hint ? (
    <p className="mt-1 text-[10px] text-muted" data-testid="pricing-markup-hint">
      {hint}
    </p>
  ) : null;
}
