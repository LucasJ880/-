"use client";

/**
 * S4-B「供应商赛马」——项目级当前推荐（PRIMARY / BACKUP 动态派生）+ 赛马表 + 下一步动作。
 *
 * 纪律：
 *   - GET 只读；页面不写任何东西，也不自动询价 / 发消息 / 存记忆；
 *   - 「找厂优先级 P1」永远不显示成 PRIMARY；两套排名分列两列；
 *   - 「待核实」就是待核实，不用 0 分伪装；
 *   - 文案明说：当前推荐按最新完成评估动态计算，历史评估记录不会被改写。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { SCORE_COMPONENT_LABELS, racingStateDisplay, rankingSectionDisplay, rfqStateLabel, gateResultDisplay, originSourceLabel, scoreReasonText } from "@/lib/supplier-intel/evaluation-display";
import { platformDisplay } from "@/lib/supplier-intel/workspace-labels";
import { TONE_CLASS } from "./evidence-sections";
import { ScopeGuard } from "./scope-guard";
import { workspaceFetch, type ProjectRankingPayload, type RankingRowView, type RacingRowView } from "./types";

const SECTIONS: Array<{ key: keyof ProjectRankingPayload["sections"]; label: string }> = [
  { key: "PRIMARY", label: "PRIMARY" },
  { key: "BACKUP", label: "BACKUP" },
  { key: "NEEDS_VERIFICATION", label: "NEEDS VERIFICATION" },
  { key: "HIGH_RISK", label: "HIGH RISK" },
  { key: "NOT_ELIGIBLE", label: "NOT ELIGIBLE" },
];

function Badge({ tone, children, testId, extra }: { tone: string; children: React.ReactNode; testId?: string; extra?: Record<string, string> }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] ${TONE_CLASS[tone] ?? TONE_CLASS.neutral}`} data-testid={testId} {...extra}>{children}</span>;
}
const fmt = (v: number | null) => (v === null ? "待核实" : String(v));

export function RankingPanel({ orgId, projectId }: { orgId: string; projectId: string }) {
  const [view, setView] = useState<ProjectRankingPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardRef = useRef<ScopeGuard | null>(null);
  if (guardRef.current === null) guardRef.current = new ScopeGuard();
  const guard = guardRef.current;
  // FR2：作用域 = org + project；切换时放弃在途请求，旧响应不会串到新项目
  guard.setScope(`${orgId}::${projectId}`);
  const q = `?orgId=${encodeURIComponent(orgId)}`;

  const load = useCallback(async () => {
    const ticket = guard.begin("ranking");
    setLoading(true); setError(null);
    try {
      const r = await workspaceFetch<{ view: ProjectRankingPayload }>(`/api/supplier-intel/projects/${projectId}/ranking${q}`, { signal: ticket.signal });
      if (!ticket.isCurrent()) return;
      setView(r.view);
    } catch (e) {
      if (ticket.isCurrent()) setError(e instanceof Error ? e.message : "读取失败");
    } finally { if (ticket.shouldSettle()) setLoading(false); ticket.done(); }
  }, [guard, projectId, q]);
  useEffect(() => { void load(); }, [load]);

  const evidenceHref = (r: { supplierId: string; runId: string | null }) => `/projects/intelligence/supply-chain/supplier?supplierId=${encodeURIComponent(r.supplierId)}&projectId=${encodeURIComponent(projectId)}${r.runId ? `&evaluationRunId=${encodeURIComponent(r.runId)}` : ""}`;

  return (
    <div className="space-y-3" data-testid="ranking-panel">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">当前项目推荐</p>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50" data-testid="ranking-refresh">
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} 刷新
        </button>
      </div>
      {view ? (
        <p className="rounded-lg bg-[var(--background)] px-3 py-2 text-xs text-[var(--muted)]" data-testid="ranking-disclaimer">{view.disclaimers.ranking} {view.disclaimers.discovery}</p>
      ) : null}
      {error ? <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" data-testid="ranking-error">{error}</div> : null}
      {!view && loading ? <p className="text-xs text-[var(--muted)]">加载中…</p> : null}
      {view ? (
        <>
          {/* 当前推荐分区 */}
          <div className="space-y-2" data-testid="ranking-sections">
            {SECTIONS.map((sec) => {
              const rows = view.sections[sec.key];
              const disp = rankingSectionDisplay(sec.key);
              return (
                <div key={sec.key} className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3" data-testid="ranking-section" data-section={sec.key} data-count={rows.length}>
                  <p className="flex flex-wrap items-center gap-2 text-xs font-medium"><Badge tone={disp.tone}>{disp.label}</Badge><span className="text-[var(--muted)]">{rows.length} 家{disp.hint ? ` · ${disp.hint}` : ""}</span></p>
                  {rows.length === 0 ? <p className="mt-1 text-xs text-[var(--muted)]">—</p> : (
                    <ul className="mt-2 space-y-2">{rows.map((r) => <RankingRow key={r.candidateId} row={r} href={evidenceHref(r)} />)}</ul>
                  )}
                </div>
              );
            })}
          </div>

          {/* 赛马表 */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3" data-testid="racing-table-box">
            <p className="text-sm font-medium">供应商赛马</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">找厂优先级（P1/P2/P3）只安排调研顺序；Current Rank 才是完成证据核验与评分后的项目排名。两者不是一回事。</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs" data-testid="racing-table">
                <thead className="text-[var(--muted)]"><tr><th className="py-1 pr-2">Supplier</th><th className="py-1 pr-2">Source</th><th className="py-1 pr-2">找厂优先级</th><th className="py-1 pr-2">Gate</th><th className="py-1 pr-2">RFQ</th><th className="py-1 pr-2">Score</th><th className="py-1 pr-2">Current Rank</th><th className="py-1 pr-2">下一步</th></tr></thead>
                <tbody>
                  {view.racing.length === 0 ? <tr><td colSpan={8} className="py-2 text-[var(--muted)]">本项目还没有已关联的供应商。</td></tr> : view.racing.map((r) => <RacingRow key={r.key} row={r} href={evidenceHref(r)} />)}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function RankingRow({ row, href }: { row: RankingRowView; href: string }) {
  const gate = gateResultDisplay(row.mandatoryGateResult);
  return (
    <li className="rounded-lg border border-[var(--border)] p-2 text-xs" data-testid="ranking-row" data-candidate-id={row.candidateId} data-supplier-id={row.supplierId} data-rank={row.rank ?? "none"} data-section={row.section}>
      <div className="flex flex-wrap items-center gap-2">
        {row.rank !== null ? <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 font-mono text-[11px] text-[color:var(--on-accent)]" data-testid="ranking-rank">#{row.rank}</span> : null}
        <span className="text-sm font-medium">{row.supplierName}</span>
        <span className="text-[var(--muted)]">{row.offeringName ? `${row.offeringName}${row.offeringSku ? `（${row.offeringSku}）` : ""}` : "未指定产品"} · 来源 {originSourceLabel(row.originSource)}</span>
        <Badge tone={gate.tone}>{gate.label}</Badge>
        <Link href={href} className="text-[var(--accent)] underline" data-testid="ranking-view-evaluation">查看评估</Link>
      </div>
      <p className="mt-1 font-mono" data-testid="ranking-scores">
        总分 {fmt(row.scores.total)} · {SCORE_COMPONENT_LABELS.technical.label} {fmt(row.scores.technical)} · {SCORE_COMPONENT_LABELS.commercial.label} {fmt(row.scores.commercial)} · {SCORE_COMPONENT_LABELS.reliability.label} {fmt(row.scores.reliability)} · {SCORE_COMPONENT_LABELS.importRisk.label} {fmt(row.scores.importRisk)}
      </p>
      <p className="mt-0.5 text-[var(--muted)]" data-testid="ranking-reason">
        {row.eligible ? `排名依据：总分 ↓ 技术 ↓ 商务 ↓ 可靠性 ↓ 进口准备度 ↓（同分按候选 ID）` : row.reasonCodes.length ? row.reasonCodes.map(scoreReasonText).join("；") : row.ineligibleReason ?? ""}
        {" · "}下一步：<span data-testid="ranking-next-action">{row.nextAction.label}</span>
      </p>
    </li>
  );
}

function RacingRow({ row, href }: { row: RacingRowView; href: string }) {
  const st = racingStateDisplay(row.state);
  const gate = row.gate ? gateResultDisplay(row.gate) : null;
  const sec = row.section ? rankingSectionDisplay(row.section) : null;
  return (
    <tr className="border-t border-[var(--border)] align-top" data-testid="racing-row" data-supplier-id={row.supplierId} data-state={row.state} data-bucket={row.discoveryPriority?.bucket ?? "none"} data-section={row.section ?? "none"}>
      <td className="py-1.5 pr-2"><Link href={href} className="text-[var(--accent)] underline">{row.supplierName}</Link>{row.offeringName ? <span className="block text-[var(--muted)]">{row.offeringName}</span> : null}<Badge tone={st.tone} testId="racing-state">{st.label}</Badge></td>
      <td className="py-1.5 pr-2">{row.sourcePlatform ? platformDisplay(row.sourcePlatform).label : row.originSource ? originSourceLabel(row.originSource) : "—"}</td>
      <td className="py-1.5 pr-2" data-testid="racing-priority">{row.discoveryPriority ? `${row.discoveryPriority.bucket} · ${row.discoveryPriority.total}` : "—"}</td>
      <td className="py-1.5 pr-2">{gate ? <Badge tone={gate.tone}>{gate.label.replace("强制项：", "")}</Badge> : "—"}</td>
      <td className="py-1.5 pr-2" data-testid="racing-rfq">{rfqStateLabel(row.rfq)}</td>
      <td className="py-1.5 pr-2 font-mono" data-testid="racing-score">{row.officialTotalScore === null ? "—" : row.officialTotalScore}</td>
      <td className="py-1.5 pr-2" data-testid="racing-rank">{row.currentRank !== null ? `#${row.currentRank} ${sec?.label ?? ""}` : sec ? sec.label : row.evaluationInProgress ? "评估进行中" : "—"}</td>
      <td className="py-1.5 pr-2" data-testid="racing-next-action">{row.nextAction.label}</td>
    </tr>
  );
}
