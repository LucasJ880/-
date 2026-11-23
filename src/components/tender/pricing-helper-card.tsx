"use client";

/**
 * 报价表助手卡（工作台）：评分模型（自动推导，可人工改权重/得分率）+ 对手价假设
 * （现任线索/联邦合同价格带预填）+ 我方成本/目标毛利 → 情景表与打平价。
 * 结果是假设驱动的情景，不是报价决定；AI 只负责把文件里的评分规则结构化。
 * CHAIN-2b / FIX-25：读取结果带 costHidden（没有财务查看权）时，我方成本与目标毛利两格都换成一句话，
 * 不显示毛利一栏与成本加成提示，保存只带对手价（带成本或目标毛利会被 403）。
 * FIX-25 审查 T7：保存的请求体由纯函数 buildPricingSaveBody 给出，展示部分是纯组件 PricingHelperCardView，
 * 两者都由测试直接断言（不只靠源码字符串）。
 */

import { useCallback, useEffect, useState } from "react";
import { Calculator, Loader2, RefreshCw } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import type {
  PricingInputs,
  PricingResult,
  ScoringModel,
} from "@/lib/tender-pricing/calc";
import {
  MARGIN_ON_PRICE_ZH,
  TARGET_MARGIN_ON_PRICE_ZH,
  fillFromSuggestion,
  type CompareCostView,
  type OurCostSourceClaim,
} from "@/lib/tender-pricing/compare-cost-source";
import { CompareCostSourceBlock, MarkupHint } from "./pricing-compare-source";
import {
  COST_ACCESS_HINT_ZH,
  COST_HIDDEN_FIELD_ZH,
  COST_HIDDEN_NOTE_ZH,
  TARGET_MARGIN_HIDDEN_FIELD_ZH,
  buildPricingSaveBody,
  type PricingFormValues,
} from "@/lib/tender-pricing/finance-view";

export type PricingHelperPayload = {
  runId: string | null;
  model: ScoringModel | null;
  modelOrigin: "HUMAN" | "AI_INFERRED" | "HEURISTIC" | "NONE";
  benchmark: {
    vendor: string | null;
    low: number | null;
    high: number | null;
    median: number | null;
    sampleSize: number | null;
    noteZh: string | null;
    source: string | null;
  };
  inputs: PricingInputs;
  result: PricingResult | null;
  note: string | null;
  /** FLOW-H2：开关开启时才有 */
  compareCost?: CompareCostView;
  /** CHAIN-2b / FIX-25：没有财务查看权时为 true（我方成本与目标毛利都为 null、情景按没有成本算） */
  costHidden?: boolean;
  /** CHAIN-2b：没有财务查看权、开关开着时为 true（不带成本建议） */
  compareCostHidden?: boolean;
};

const ORIGIN_LABEL: Record<PricingHelperPayload["modelOrigin"], string> = {
  HUMAN: "人工确认",
  AI_INFERRED: "AI 推导 · 待核",
  HEURISTIC: "规则抓取 · 待核",
  NONE: "未知",
};
const FORMULA_LABEL: Record<ScoringModel["costFormula"], string> = {
  lowest_over_bid: "最低价满分，其余 = 满分 × 最低价/本标价",
  linear_gap: "按高于最低价的百分比线性扣分",
  unknown: "文件未明确（按最低价/本标价假设）",
};

const cad = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-CA")}`;

export function PricingHelperCard({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [data, setData] = useState<PricingHelperPayload | null>(null);
  const [busy, setBusy] = useState<"save" | "derive" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgIsError, setMsgIsError] = useState(false);
  const [form, setForm] = useState<PricingFormValues>({
    competitor: "",
    cost: "",
    margin: "",
  });
  // FLOW-H2：按钮填入之后、人改动成本之前，保存时声明用的是哪一条报价（服务端会重新核对）
  const [costClaim, setCostClaim] = useState<OurCostSourceClaim | null>(null);

  const load = useCallback(() => {
    apiJson<PricingHelperPayload>(`/api/projects/${projectId}/pricing-helper`)
      .then((res) => {
        setData(res);
        setForm({
          competitor: res.inputs.competitorPriceCad?.toString() ?? "",
          cost: res.inputs.ourCostCad?.toString() ?? "",
          margin: res.inputs.targetMarginPct?.toString() ?? "",
        });
        setCostClaim(null);
      })
      .catch(() => setData(null));
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!data || !data.runId) return null;

  const post = async (body: Record<string, unknown>, kind: "save" | "derive") => {
    setBusy(kind);
    setMsg(null);
    setMsgIsError(false);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/pricing-helper`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string; via?: string; keptHumanOverride?: boolean };
      if (!res.ok) {
        setMsg(json.error ?? "操作失败");
        setMsgIsError(true);
        // CHAIN-2b：成本不能改（403）时保留表单里刚填的值，不重新读取
        if (res.status === 403) return;
      }
      else if (kind === "derive")
        setMsg(
          json.keptHumanOverride
            ? "已推导，但保留了你的人工模型（人工覆盖优先）"
            : `模型已重新推导（${json.via === "AI_INFERRED" ? "AI" : json.via === "HEURISTIC" ? "规则" : "未抓到"}）`,
        );
      load();
    } catch {
      setMsg("操作失败");
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    // CHAIN-2b / FIX-25：没有财务查看权时不带我方成本与目标毛利（带了会被 403）；请求体由纯函数给出
    void post(buildPricingSaveBody(form, data.costHidden === true, costClaim), "save");
  };

  const cc = data.compareCost;
  // 按钮只填输入框，不保存
  const fill = () => {
    if (!cc) return;
    const filled = fillFromSuggestion(form, cc.suggestion);
    if (!filled) return;
    setForm(filled.form);
    setCostClaim(filled.claim);
  };

  return (
    <PricingHelperCardView
      data={data}
      form={form}
      canManage={canManage}
      busy={busy}
      msg={msg}
      msgIsError={msgIsError}
      onFieldChange={(k, value) => {
        setForm((f) => ({ ...f, [k]: value }));
        if (k === "cost") setCostClaim(null);
      }}
      onSave={save}
      onDerive={() => void post({ action: "derive" }, "derive")}
      onFill={fill}
    />
  );
}

export type PricingHelperCardViewProps = {
  data: PricingHelperPayload;
  form: PricingFormValues;
  canManage: boolean;
  busy: "save" | "derive" | null;
  msg: string | null;
  msgIsError: boolean;
  onFieldChange: (k: keyof PricingFormValues, value: string) => void;
  onSave: () => void;
  onDerive: () => void;
  onFill: () => void;
};

/** 卡片的展示部分：只由 props 决定（FIX-25 审查 T7：测试用 renderToStaticMarkup 直接断言没有财务查看权时的样子） */
export function PricingHelperCardView({ data, form, canManage, busy, msg, msgIsError, onFieldChange, onSave, onDerive, onFill }: PricingHelperCardViewProps) {
  const m = data.model;
  const r = data.result;
  const cc = data.compareCost;
  const costHidden = data.costHidden === true;
  // 目标毛利写法只由目标毛利算出：开关开着时（有建议，或没有财务查看权而只带 compareCostHidden）都按「按售价」写；成本加成提示没有财务查看权时不渲染
  const compareOn = !!cc || data.compareCostHidden === true;

  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="pricing-helper">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Calculator size={16} className="text-accent/60" />
          报价表助手
          <span className="text-[10px] font-normal text-muted">
            情景推演 · 假设驱动 · 不是报价决定
          </span>
        </h3>
        {canManage ? (
          <button
            type="button"
            data-testid="pricing-derive"
            disabled={busy != null}
            onClick={onDerive}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent/5"
          >
            {busy === "derive" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            从文件重新推导评分模型
          </button>
        ) : null}
      </div>

      {/* 评分模型 */}
      <div className="mt-3 rounded-lg border border-border/60 px-3 py-2 text-xs">
        {m ? (
          <>
            <p className="font-medium">
              评分模型 <span className="ml-1 rounded-full border border-border px-1.5 text-[9px] text-muted">{ORIGIN_LABEL[data.modelOrigin]}</span>
            </p>
            <p className="mt-1 text-foreground/85">
              价格权重 <b>{m.priceWeightPct}%</b> · 成本公式：{FORMULA_LABEL[m.costFormula]}
            </p>
            {m.otherCriteria.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
                {m.otherCriteria.map((c) => (
                  <li key={c.key}>
                    {c.nameZh} {c.weightPct}% — 我方预期 {c.ourPct ?? "?"}% / 对手 {c.competitorPct ?? "?"}%
                    {c.basisZh ? `（${c.basisZh}）` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-muted">未抓到非价格项权重——总分对比只含价格项，请核对文件。</p>
            )}
          </>
        ) : (
          <p className="text-muted">{data.note ?? "未能推导评分模型"}</p>
        )}
      </div>

      {/* 价格带 + 输入 */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 px-3 py-2 text-xs">
          <p className="font-medium">对手 / 现任价格带</p>
          {data.benchmark.low != null || data.benchmark.median != null ? (
            <p className="mt-1 text-foreground/85">
              {data.benchmark.vendor ? `${data.benchmark.vendor} · ` : ""}
              {cad(data.benchmark.low)} – {cad(data.benchmark.high)}
              {data.benchmark.median != null ? ` · 中位 ${cad(data.benchmark.median)}` : ""}
              {data.benchmark.sampleSize ? ` · 样本 ${data.benchmark.sampleSize}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-muted">暂无价格带——记录现任线索或等待联邦合同对标后自动出现</p>
          )}
          {data.benchmark.noteZh ? <p className="mt-1 text-[10px] text-muted">{data.benchmark.noteZh}</p> : null}
        </div>
        <div className="rounded-lg border border-border/60 px-3 py-2 text-xs">
          <p className="font-medium">我方假设（CAD）</p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(
              [
                ["competitor", "对手价"],
                ["cost", "我方成本"],
                ["margin", compareOn ? TARGET_MARGIN_ON_PRICE_ZH : "目标毛利 %"],
              ] as const
            ).map(([k, label]) => k === "cost" && costHidden ? (
              <p key={k} className="text-[10px] text-muted" data-testid="pricing-cost-hidden">
                我方成本
                <span className="mt-0.5 block text-[11px] text-foreground/80">{COST_HIDDEN_FIELD_ZH}</span>
              </p>
            ) : k === "margin" && costHidden ? (
              <p key={k} className="text-[10px] text-muted" data-testid="pricing-margin-hidden">
                目标毛利
                <span className="mt-0.5 block text-[11px] text-foreground/80">{TARGET_MARGIN_HIDDEN_FIELD_ZH}</span>
              </p>
            ) : (
              <label key={k} className="text-[10px] text-muted">
                {label}
                <input
                  type="number"
                  min={0}
                  value={form[k]}
                  disabled={!canManage}
                  onChange={(e) => onFieldChange(k, e.target.value)}
                  className="mt-0.5 w-full rounded border border-border bg-transparent px-1.5 py-1 text-[11px] text-foreground"
                />
              </label>
            ))}
          </div>
          {/* FIX-25：成本加成提示由目标毛利算出，没有财务查看权时不渲染 */}
          <MarkupHint enabled={compareOn && !costHidden} margin={form.margin} />
          {canManage ? (
            <button
              type="button"
              data-testid="pricing-save"
              disabled={busy != null}
              onClick={onSave}
              className="mt-2 rounded border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent/5"
            >
              {busy === "save" ? "保存中…" : "保存并重算"}
            </button>
          ) : null}
          {msg ? (
            <span className={`ml-2 text-[10px] ${msgIsError ? "text-danger" : "text-muted"}`} role="status" aria-live="polite">
              {msg}
            </span>
          ) : null}
        </div>
      </div>

      {cc ? <CompareCostSourceBlock view={cc} canManage={canManage} onFill={onFill} /> : null}

      {/* CHAIN-2b：没有财务查看权时，情景表上方说明少了什么、找谁 */}
      {costHidden && r ? (
        <p className="mt-3 text-[11px] text-muted" data-testid="pricing-cost-hidden-note">
          {COST_HIDDEN_NOTE_ZH}
          {COST_ACCESS_HINT_ZH}
        </p>
      ) : null}

      {/* 情景表 */}
      {r && r.scenarios.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          {r.breakEvenPriceCad != null ? (
            <p className="mb-2 rounded-lg border border-amber-200/70 bg-amber-50/40 px-3 py-2 text-xs">
              <b>打平价 {cad(r.breakEvenPriceCad)}</b>：{r.breakEvenNoteZh}（我方非价格项 {r.ourOtherPts} 分 vs 对手 {r.competitorOtherPts} 分）
            </p>
          ) : (
            <p className="mb-2 text-[11px] text-muted">{r.breakEvenNoteZh}</p>
          )}
          <table className="w-full text-[11px]">
            <thead className="text-muted">
              <tr className="text-left">
                <th className="py-1 pr-2">情景</th>
                <th className="py-1 pr-2">我方价</th>
                <th className="py-1 pr-2">价格分 我/对</th>
                <th className="py-1 pr-2">总分 我/对</th>
                <th className="py-1 pr-2">差</th>
                {costHidden ? null : <th className="py-1 pr-2">{cc ? MARGIN_ON_PRICE_ZH : "毛利"}</th>}
              </tr>
            </thead>
            <tbody>
              {r.scenarios.map((s) => (
                <tr key={s.key} className="border-t border-border/40" title={s.noteZh}>
                  <td className="py-1 pr-2">{s.labelZh}</td>
                  <td className="py-1 pr-2 font-mono">{cad(s.priceCad)}</td>
                  <td className="py-1 pr-2 font-mono">{s.ourPriceScore} / {s.competitorPriceScore}</td>
                  <td className="py-1 pr-2 font-mono">{s.ourTotal} / {s.competitorTotal}</td>
                  <td className={`py-1 pr-2 font-mono ${s.deltaPts > 0 ? "text-emerald-700" : s.deltaPts < 0 ? "text-danger" : ""}`}>
                    {s.deltaPts > 0 ? "+" : ""}{s.deltaPts}
                  </td>
                  {costHidden ? null : (
                    <td className={`py-1 pr-2 font-mono ${s.marginPct != null && s.marginPct < 0 ? "text-danger" : ""}`}>
                      {s.marginPct == null ? "—" : `${s.marginPct}%`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : r ? (
        <p className="mt-3 text-[11px] text-muted">{r.breakEvenNoteZh}</p>
      ) : null}

      {/* CHAIN-2b：没有财务查看权时那句已经写在情景表上方，假设说明里不再重复 */}
      {r && r.assumptionsZh.filter((a) => !(costHidden && a === COST_HIDDEN_NOTE_ZH)).length > 0 ? (
        <ul className="mt-2 list-disc pl-4 text-[10px] text-muted">
          {r.assumptionsZh
            .filter((a) => !(costHidden && a === COST_HIDDEN_NOTE_ZH))
            .map((a, i) => (
              <li key={i}>{a}</li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
