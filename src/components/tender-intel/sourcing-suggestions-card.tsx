"use client";

/**
 * CHAIN-2 情报页签「寻源建议」卡：推荐型号 + 价格对照（三栏并排、不合并）。
 * 开关关闭时接口 404 → 卡不显示；其它出错只在卡里写一句，不影响页签其余部分。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { SCORE_COMPONENT_LABELS } from "@/lib/supplier-intel/evaluation-display";
import type { AwardColumn, LandedColumn, MarketColumn, ScoreSet, SourcingSuggestionsView } from "@/lib/tender-intel/sourcing-suggestions-pure";

type State = { kind: "loading" } | { kind: "hidden" } | { kind: "error" } | { kind: "ok"; view: SourcingSuggestionsView };

export const SOURCING_CARD_ERROR_ZH = "寻源建议暂时读不出来，请稍后刷新。";
/** 三栏标题：与栏里的说明同一个名称，括号里写口径 */
export const SOURCING_COLUMN_TITLES_ZH = {
  awards: "可比授标（同一采购方的中标金额，不含我方）",
  market: "市场价格基准（网上公开报价，原文照录）",
  landed: "我方落地价（加元，比价矩阵选定）",
} as const;

/** 起止日期：两头都有写「a 至 b」，只有一头写那一头，都没有不写 */
const dateRange = (from: string | null, to: string | null) => (from && to ? ` · ${from} 至 ${to}` : from || to ? ` · ${from ?? to}` : "");

const score = (n: number | null) => (n === null || !Number.isFinite(n) ? "待核实" : String(Math.round(n * 10) / 10));
const money = (n: number) => n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Scores({ s }: { s: ScoreSet }) {
  const parts = (["technical", "commercial", "reliability", "importRisk"] as const).map((k) => `${SCORE_COMPONENT_LABELS[k].label} ${score(s[k])}`);
  return (
    <span className="text-[11px] text-muted">
      {parts.join(" · ")} · 总分 {s.total === null ? "待核实" : `${score(s.total)} / 100`}
    </span>
  );
}

function AwardsCol({ c }: { c: AwardColumn }) {
  if (c.status === "missing") return <p className="text-xs text-muted">{c.messageZh}</p>;
  return (
    <ul className="space-y-1 text-xs">
      {c.groups.map((g) => (
        <li key={`${g.scope}-${g.currency}`}>
          <span className="text-foreground">范围：{g.scope}</span>
          <span className="text-muted">
            {" "}· {g.sampleSize} 笔：{g.currency} {money(g.min)} 至 {money(g.max)}（中位 {money(g.median)}）{dateRange(g.from, g.to)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MarketCol({ c }: { c: MarketColumn }) {
  if (c.status === "missing") return <p className="text-xs text-muted">{c.messageZh}</p>;
  return (
    <div className="space-y-1 text-xs">
      <ul className="space-y-1">
        {c.items.map((b, i) => (
          <li key={`${b.productName}-${i}`}>
            <span className="text-foreground">{b.productName}</span>
            <span className="text-muted">
              {b.vendor ? ` · ${b.vendor}` : ""} · {b.priceRaw}
              {/* 原文价格里已写了币种时不再重复 */}
              {b.currency && !b.priceRaw.toUpperCase().includes(b.currency.toUpperCase()) ? ` ${b.currency}` : ""}
              {b.unit ? ` / ${b.unit}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted">{c.fxNoteZh}</p>
    </div>
  );
}

function LandedCol({ c }: { c: LandedColumn }) {
  if (c.status === "missing") return <p className="text-xs text-muted">{c.messageZh}</p>;
  return (
    <div className="space-y-0.5 text-xs">
      <p>
        <span className="text-foreground">CAD {money(c.landedCadTotal)}</span>
        <span className="text-muted">（第 {c.roundNumber} 轮选定：{c.supplierName}）</span>
      </p>
      <p className="text-[11px] text-muted">到目的地，含关税；{c.taxNoteZh}。{c.basisZh}。</p>
      {c.warnings.map((w, i) => (
        <p key={i} className="text-[11px] text-amber-700">
          {w}
        </p>
      ))}
    </div>
  );
}

export function SourcingSuggestionsCard({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/projects/${encodeURIComponent(projectId)}/tender-intel/sourcing`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) return setState({ kind: "hidden" });
        if (!res.ok) return setState({ kind: "error" });
        const view = (await res.json()) as SourcingSuggestionsView;
        if (!cancelled) setState({ kind: "ok", view });
      })
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (state.kind === "hidden") return null;

  const rec = state.kind === "ok" ? state.view.recommendations : null;
  const landed = state.kind === "ok" ? state.view.prices.landed : undefined;

  return (
    <section className="rounded-xl border border-border/70 bg-background/40 p-4" data-testid="sourcing-suggestions-card">
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Compass size={14} className="text-accent" />
        寻源建议
      </h3>
      {state.kind === "loading" ? (
        <p className="mt-2 text-xs text-muted">正在读取…</p>
      ) : state.kind === "error" ? (
        <p className="mt-2 text-xs text-muted">{SOURCING_CARD_ERROR_ZH}</p>
      ) : (
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-xs font-medium text-foreground">推荐型号（来自已完成的评估）</p>
            {rec?.status === "ready" ? (
              <ol className="mt-1.5 space-y-1.5">
                {rec.items.map((r) => (
                  <li key={r.candidateId} className="text-xs">
                    {r.rank !== null ? <span className="mr-1 text-muted">第 {r.rank} 名</span> : null}
                    <span className="mr-1 rounded border border-border px-1 py-px text-[10px] text-muted">{r.section === "PRIMARY" ? "首选" : "备选"}</span>
                    <span className="text-foreground">{r.supplierName}</span>
                    <span className="text-foreground/80">
                      {" "}
                      · {r.offeringName ?? "未指定产品"}
                      {r.offeringSku ? `（${r.offeringSku}）` : ""}
                    </span>
                    <span className="text-muted"> · {r.mandatoryZh}</span>
                    <div>
                      <Scores s={r.scores} />
                    </div>
                  </li>
                ))}
              </ol>
            ) : rec ? (
              <p className="mt-1 text-xs text-muted">{rec.messageZh}</p>
            ) : null}
            {rec?.poolNoteZh ? <p className="mt-1 text-[11px] text-muted">{rec.poolNoteZh}</p> : null}
            {rec?.href && rec.hrefLabelZh ? (
              <Link href={rec.href} className="mt-1 inline-block text-xs text-accent underline-offset-2 hover:underline">
                {rec.hrefLabelZh}
              </Link>
            ) : null}
          </div>

          {state.kind === "ok" ? (
            <div>
              <p className="text-xs font-medium text-foreground">价格对照</p>
              <p className="mt-0.5 text-[11px] text-muted">{state.view.noteZh}</p>
              <div className={`mt-2 grid gap-3 ${landed ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                <div className="rounded-md border border-border/60 p-2">
                  <p className="mb-1 text-[11px] font-medium text-foreground/80">{SOURCING_COLUMN_TITLES_ZH.awards}</p>
                  <AwardsCol c={state.view.prices.awards} />
                </div>
                <div className="rounded-md border border-border/60 p-2">
                  <p className="mb-1 text-[11px] font-medium text-foreground/80">{SOURCING_COLUMN_TITLES_ZH.market}</p>
                  <MarketCol c={state.view.prices.market} />
                </div>
                {landed ? (
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="mb-1 text-[11px] font-medium text-foreground/80">{SOURCING_COLUMN_TITLES_ZH.landed}</p>
                    <LandedCol c={landed} />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
