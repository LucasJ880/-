"use client";

/**
 * 报价表助手卡（工作台）：评分模型（自动推导，可人工改权重/得分率）+ 对手价假设
 * （现任线索/联邦合同价格带预填）+ 我方成本/目标毛利 → 情景表与打平价。
 * 结果是假设驱动的情景，不是报价决定；AI 只负责把文件里的评分规则结构化。
 */

import { useCallback, useEffect, useState } from "react";
import { Calculator, Loader2, RefreshCw } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import type {
  PricingInputs,
  PricingResult,
  ScoringModel,
} from "@/lib/tender-pricing/calc";

type Payload = {
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
};

const ORIGIN_LABEL: Record<Payload["modelOrigin"], string> = {
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
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<"save" | "derive" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<{ competitor: string; cost: string; margin: string }>({
    competitor: "",
    cost: "",
    margin: "",
  });

  const load = useCallback(() => {
    apiJson<Payload>(`/api/projects/${projectId}/pricing-helper`)
      .then((res) => {
        setData(res);
        setForm({
          competitor: res.inputs.competitorPriceCad?.toString() ?? "",
          cost: res.inputs.ourCostCad?.toString() ?? "",
          margin: res.inputs.targetMarginPct?.toString() ?? "",
        });
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
    try {
      const res = await apiFetch(`/api/projects/${projectId}/pricing-helper`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string; via?: string; keptHumanOverride?: boolean };
      if (!res.ok) setMsg(json.error ?? "操作失败");
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
    const n = (s: string) => (s.trim() === "" ? null : Number(s));
    void post(
      {
        action: "save",
        inputs: {
          competitorPriceCad: n(form.competitor),
          ourCostCad: n(form.cost),
          targetMarginPct: n(form.margin),
        },
      },
      "save",
    );
  };

  const m = data.model;
  const r = data.result;

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
            onClick={() => void post({ action: "derive" }, "derive")}
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
                ["margin", "目标毛利 %"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="text-[10px] text-muted">
                {label}
                <input
                  type="number"
                  min={0}
                  value={form[k]}
                  disabled={!canManage}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-border bg-transparent px-1.5 py-1 text-[11px] text-foreground"
                />
              </label>
            ))}
          </div>
          {canManage ? (
            <button
              type="button"
              data-testid="pricing-save"
              disabled={busy != null}
              onClick={save}
              className="mt-2 rounded border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent/5"
            >
              {busy === "save" ? "保存中…" : "保存并重算"}
            </button>
          ) : null}
          {msg ? <span className="ml-2 text-[10px] text-muted">{msg}</span> : null}
        </div>
      </div>

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
                <th className="py-1 pr-2">毛利</th>
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
                  <td className={`py-1 pr-2 font-mono ${s.marginPct != null && s.marginPct < 0 ? "text-danger" : ""}`}>
                    {s.marginPct == null ? "—" : `${s.marginPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : r ? (
        <p className="mt-3 text-[11px] text-muted">{r.breakEvenNoteZh}</p>
      ) : null}

      {r && r.assumptionsZh.length > 0 ? (
        <ul className="mt-2 list-disc pl-4 text-[10px] text-muted">
          {r.assumptionsZh.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
