"use client";

/**
 * CHAIN-2 情报页签「寻源建议」卡：推荐型号 + 价格对照（三栏并排、不合并）。
 * 开关关闭时接口 404 → 卡不显示；其它出错只在卡里写一句，不影响页签其余部分。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import type { AwardColumn, LandedColumn, MarketColumn, ScoreSet, SourcingSuggestionsView } from "@/lib/tender-intel/sourcing-suggestions-pure";

type State = { kind: "loading" } | { kind: "hidden" } | { kind: "error" } | { kind: "ok"; view: SourcingSuggestionsView };

const num = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : String(Math.round(n * 10) / 10));
const money = (n: number) => n.toLocaleString("en-CA", { maximumFractionDigits: 2 });

function Scores({ s }: { s: ScoreSet }) {
  return (
    <span className="text-[11px] text-muted">
      技术 {num(s.technical)} · 商务 {num(s.commercial)} · 可靠性 {num(s.reliability)} · 进口风险 {num(s.importRisk)} · 总分 {num(s.total)}
    </span>
  );
}

function AwardsCol({ c }: { c: AwardColumn }) {
  if (c.status === "missing") return <p className="text-xs text-muted">{c.messageZh}</p>;
  return (
    <ul className="space-y-1 text-xs">
      {c.groups.map((g, i) => (
        <li key={`${g.scope}-${g.currency}-${i}`}>
          <span className="text-foreground">{g.scope}</span>
          <span className="text-muted">
            {" "}· {g.currency} · {g.sampleSize} 个样本：{money(g.min)}–{money(g.max)}（中位 {money(g.median)}）{g.from || g.to ? ` · ${g.from ?? "?"} 至 ${g.to ?? "?"}` : ""}
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
              {b.currency ? ` ${b.currency}` : ""}
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
    <p className="text-xs">
      <span className="text-foreground">CAD {money(c.landedCadTotal)}</span>
      <span className="text-muted">（第 {c.roundNumber} 轮选定：{c.supplierName}）</span>
    </p>
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
        setState({ kind: "ok", view: (await res.json()) as SourcingSuggestionsView });
      })
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (state.kind === "hidden" || state.kind === "loading") return null;

  return (
    <section className="rounded-xl border border-border/70 bg-background/40 p-4" data-testid="sourcing-suggestions-card">
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Compass size={14} className="text-accent" />
        寻源建议
      </h3>
      {state.kind === "error" ? (
        <p className="mt-2 text-xs text-muted">寻源建议暂时读不出来，请稍后刷新。</p>
      ) : (
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-xs font-medium text-foreground">推荐型号（来自已完成的评估）</p>
            {state.view.recommendations.status === "ready" ? (
              <ol className="mt-1.5 space-y-1.5">
                {state.view.recommendations.items.map((r, i) => (
                  <li key={`${r.supplierName}-${r.offeringSku ?? r.offeringName ?? i}`} className="text-xs">
                    <span className="mr-1 rounded border border-border px-1 py-px text-[10px] text-muted">{r.section === "PRIMARY" ? "主选" : "备选"}</span>
                    <span className="text-foreground">{r.supplierName}</span>
                    {r.offeringName ? <span className="text-foreground/80"> · {r.offeringName}{r.offeringSku ? `（${r.offeringSku}）` : ""}</span> : null}
                    <span className="text-muted"> · 强制要求有证据 {r.mandatoryEvidence.withEvidence} / {r.mandatoryEvidence.total} 条</span>
                    <div>
                      <Scores s={r.scores} />
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-xs text-muted">{state.view.recommendations.messageZh}</p>
            )}
            {state.view.recommendations.href ? (
              <Link href={state.view.recommendations.href} className="mt-1 inline-block text-xs text-accent underline-offset-2 hover:underline">
                去供应链页
              </Link>
            ) : null}
          </div>

          <div>
            <p className="text-xs font-medium text-foreground">价格对照</p>
            <p className="mt-0.5 text-[11px] text-muted">{state.view.noteZh}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border/60 p-2">
                <p className="mb-1 text-[11px] font-medium text-foreground/80">可比授标（同采购方、同口径）</p>
                <AwardsCol c={state.view.prices.awards} />
              </div>
              <div className="rounded-md border border-border/60 p-2">
                <p className="mb-1 text-[11px] font-medium text-foreground/80">市场价格基准（原币）</p>
                <MarketCol c={state.view.prices.market} />
              </div>
              {state.view.prices.landed ? (
                <div className="rounded-md border border-border/60 p-2">
                  <p className="mb-1 text-[11px] font-medium text-foreground/80">我方落地价（比价矩阵选定）</p>
                  <LandedCol c={state.view.prices.landed} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
