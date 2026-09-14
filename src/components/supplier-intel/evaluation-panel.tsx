"use client";

/**
 * S4-A：项目匹配（评估工作台）——挂在供应商证据页的「项目匹配」页签下，只在有项目上下文时出现。
 *
 * 采购同事在这里：选一个具体产品 → 开始项目评估（新的评估运行，不外呼）→ 逐条判定
 * （人工选「满足 / 部分满足 / 不满足 / 资料不足」并挑证据，或采用规则判定）→ 计算强制项 → 完成评估。
 *
 * 顶部明说：这不是最终供应商排名。页面上没有分数、没有 PRIMARY / BACKUP。
 * 只有硬门自带的两个结论会出现：不可进入推荐候选 / 待核实。
 * 谁判的必须可见（人工确认 / AI 辅助判断 / 规则判断）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Plus, RefreshCw } from "lucide-react";
import {
  evaluatedByLabel,
  evaluationRunOutcome,
  gateReasonText,
  gateResultDisplay,
  mandatoryLabel,
  matchVerdictDisplay,
  originSourceLabel,
  recommendationDisplay,
} from "@/lib/supplier-intel/evaluation-display";
import { certificationStatusDisplay, certificationScopeLabel, certificationTypeLabel } from "@/lib/supplier-intel/evidence-display";
import { TONE_CLASS } from "./evidence-sections";
import { ScopeGuard } from "./scope-guard";
import {
  workspaceFetch,
  type EvaluationCandidateView,
  type EvaluationRequirementRowView,
  type EvaluationRunListRow,
  type EvaluationViewPayload,
  type OfferingView,
} from "./types";

const INPUT = "w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm";
const BTN_PRIMARY = "inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1 text-xs text-[color:var(--on-accent)] disabled:opacity-50";
const BTN_GHOST = "inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--background)] disabled:opacity-50";
const VERDICTS = ["PASS", "PARTIAL", "FAIL", "UNKNOWN"] as const;

type Msg = { tone: "ok" | "err"; text: string } | null;
function errText(e: unknown) { return e instanceof Error ? e.message : "请求失败"; }
function Badge({ tone, children, testId }: { tone: string; children: React.ReactNode; testId?: string }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] ${TONE_CLASS[tone] ?? TONE_CLASS.neutral}`} data-testid={testId}>{children}</span>;
}

type EvidenceSel = { kind: "certification"; certificationId: string } | { kind: "signal"; signalId: string } | { kind: "archive"; archiveItemId: string };

export function EvaluationPanel({
  orgId, supplierId, projectId, offerings, canWriteSupplier, initialRunId,
}: { orgId: string; supplierId: string; projectId: string; offerings: OfferingView[]; canWriteSupplier: boolean; initialRunId: string | null }) {
  const [runs, setRuns] = useState<EvaluationRunListRow[] | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);
  const [view, setView] = useState<EvaluationViewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [offeringId, setOfferingId] = useState<string>(offerings[0]?.id ?? "");
  const q = `?orgId=${encodeURIComponent(orgId)}`;

  const guardRef = useRef<ScopeGuard | null>(null);
  if (guardRef.current === null) guardRef.current = new ScopeGuard();
  const guard = guardRef.current;
  guard.setScope(`${orgId}::${projectId}::${supplierId}`);

  const loadRuns = useCallback(async () => {
    const ticket = guard.begin("runs");
    try {
      const r = await workspaceFetch<{ runs: EvaluationRunListRow[] }>(`/api/supplier-intel/projects/${projectId}/evaluations${q}&supplierId=${encodeURIComponent(supplierId)}`, { signal: ticket.signal });
      if (!ticket.isCurrent()) return;
      setRuns(r.runs);
    } catch (e) { if (ticket.isCurrent()) setMsg({ tone: "err", text: errText(e) }); } finally { ticket.done(); }
  }, [guard, projectId, q, supplierId]);

  const loadView = useCallback(async (runId: string) => {
    const ticket = guard.begin("view");
    setLoading(true);
    try {
      const r = await workspaceFetch<{ view: EvaluationViewPayload }>(`/api/supplier-intel/runs/${runId}/evaluation${q}`, { signal: ticket.signal });
      if (!ticket.isCurrent()) return;
      setView(r.view);
    } catch (e) { if (ticket.isCurrent()) setMsg({ tone: "err", text: errText(e) }); } finally { if (ticket.shouldSettle()) setLoading(false); ticket.done(); }
  }, [guard, q]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => { if (selectedRunId) void loadView(selectedRunId); else setView(null); }, [selectedRunId, loadView]);

  const refresh = useCallback(async () => { await loadRuns(); if (selectedRunId) await loadView(selectedRunId); }, [loadRuns, loadView, selectedRunId]);

  const startEvaluation = useCallback(async () => {
    setBusy("start"); setMsg(null);
    try {
      const r = await workspaceFetch<{ run: { id: string }; candidate: { id: string } }>(`/api/supplier-intel/projects/${projectId}/evaluations${q}`, {
        method: "POST", body: JSON.stringify({ supplierId, offeringId: offeringId || null }),
      });
      setMsg({ tone: "ok", text: "已创建评估运行（不搜索新供应商，只评估这家）。" });
      await loadRuns();
      setSelectedRunId(r.run.id);
    } catch (e) { setMsg({ tone: "err", text: errText(e) }); } finally { setBusy(null); }
  }, [loadRuns, offeringId, projectId, q, supplierId]);

  const act = useCallback(async (label: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(label); setMsg(null);
    try { await fn(); setMsg({ tone: "ok", text: okText }); await refresh(); }
    catch (e) { setMsg({ tone: "err", text: errText(e) }); }
    finally { setBusy(null); }
  }, [refresh]);

  const candidate: EvaluationCandidateView | null = view?.candidates.find((c) => c.supplier.id === supplierId) ?? view?.candidates[0] ?? null;
  const terminal = view ? ["COMPLETED", "FAILED", "CANCELLED"].includes(view.run.status) : false;
  const canAct = Boolean(view?.canWrite) && !terminal;

  return (
    <div className="space-y-3" data-testid="evaluation-panel">
      <p className="rounded-lg bg-[var(--background)] px-3 py-2 text-xs text-[var(--muted)]" data-testid="evaluation-disclaimer">
        <span className="font-medium text-[var(--foreground)]">这不是最终供应商排名。</span>
        这里只做逐条要求的匹配与强制项硬门；评分与推荐在后续阶段。评估运行不会搜索新供应商，也不外呼任何来源。
      </p>

      {/* 新建评估 */}
      {canWriteSupplier ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] p-3" data-testid="evaluation-start-box">
          <label className="min-w-[14rem] flex-1 text-xs">
            <span className="mb-0.5 block text-[var(--muted)]">评估哪个具体产品（供应商 ≠ 产品）</span>
            <select className={INPUT} value={offeringId} onChange={(e) => setOfferingId(e.target.value)} data-testid="evaluation-offering">
              <option value="">不指定产品（仅供应商级；产品级要求将无法判定）</option>
              {offerings.map((o) => <option key={o.id} value={o.id}>{o.name}{o.sku ? `（${o.sku}）` : ""}</option>)}
            </select>
          </label>
          <button type="button" className={BTN_PRIMARY} disabled={busy !== null} onClick={() => void startEvaluation()} data-testid="evaluation-start">
            {busy === "start" ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} 开始项目评估
          </button>
        </div>
      ) : null}

      {msg ? (
        <p role="status" data-testid="evaluation-message" className={`rounded-lg px-2 py-1.5 text-xs ${msg.tone === "ok" ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"}`}>{msg.text}</p>
      ) : null}

      {/* 评估运行列表 */}
      <div className="space-y-1" data-testid="evaluation-run-list">
        <p className="text-xs text-[var(--muted)]">本项目对这家供应商的评估运行</p>
        {runs === null ? <p className="text-xs text-[var(--muted)]">加载中…</p> : runs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted)]" data-testid="evaluation-runs-empty">还没有评估运行。</p>
        ) : (
          <ul className="space-y-1">
            {runs.map((r) => {
              const oc = evaluationRunOutcome(r.status);
              const c = r.candidates.find((x) => x.supplierId === supplierId) ?? r.candidates[0];
              const gate = c ? gateResultDisplay(c.mandatoryGateResult) : null;
              const rec = c ? recommendationDisplay(c.recommendation) : null;
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setSelectedRunId(r.id)} data-testid="evaluation-run-row" data-run-id={r.id} data-selected={selectedRunId === r.id ? "true" : "false"}
                    className={`flex w-full flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs ${selectedRunId === r.id ? "border-[var(--accent)]" : "border-[var(--border)]"}`}>
                    <span className="text-[var(--muted)]">{new Date(r.createdAt).toLocaleString("zh-CN")}</span>
                    <Badge tone={oc.tone}>{oc.label}</Badge>
                    {c?.offeringName ? <span>{c.offeringName}{c.offeringSku ? `（${c.offeringSku}）` : ""}</span> : <span className="text-[var(--muted)]">未指定产品</span>}
                    {gate ? <Badge tone={gate.tone} testId="evaluation-run-gate">{gate.label}</Badge> : null}
                    {rec ? <Badge tone={rec.tone} testId="evaluation-run-recommendation">{rec.label}</Badge> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 选中的评估运行 */}
      {selectedRunId && loading && !view ? <p className="flex items-center gap-1 text-xs text-[var(--muted)]"><Loader2 size={12} className="animate-spin" /> 加载评估…</p> : null}
      {view && candidate ? (
        <EvaluationRunDetail view={view} candidate={candidate} canAct={canAct} busy={busy} q={q} onAct={act} onRefresh={() => void refresh()} />
      ) : null}
    </div>
  );
}

function EvaluationRunDetail({ view, candidate, canAct, busy, q, onAct, onRefresh }: {
  view: EvaluationViewPayload; candidate: EvaluationCandidateView; canAct: boolean; busy: string | null; q: string;
  onAct: (label: string, fn: () => Promise<unknown>, okText: string) => Promise<void>; onRefresh: () => void;
}) {
  const oc = evaluationRunOutcome(view.run.status);
  const gate = gateResultDisplay(candidate.mandatoryGateResult);
  const rec = recommendationDisplay(candidate.recommendation);
  const terminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(view.run.status);
  const mandatoryRows = candidate.requirements.filter((r) => r.entry.mandatory === true || r.entry.mandatory === "uncertain");
  const optionalRows = candidate.requirements.filter((r) => r.entry.mandatory === false);
  const pendingMandatory = mandatoryRows.filter((r) => !r.match).length;

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3" data-testid="evaluation-run" data-run-id={view.run.id} data-run-status={view.run.status} data-gate-result={candidate.mandatoryGateResult} data-recommendation={candidate.recommendation ?? ""}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 text-xs">
          <p className="text-sm font-medium">{candidate.supplier.name}<span className="ml-1 font-normal text-[var(--muted)]">· {candidate.offering ? `${candidate.offering.name}${candidate.offering.sku ? `（${candidate.offering.sku}）` : ""}` : "未指定产品"}</span></p>
          <p className="mt-0.5 text-[var(--muted)]">
            项目：{view.project.name ?? view.project.id} · 需求快照 {view.run.requirementSnapshotVersion ? view.run.requirementSnapshotVersion.slice(0, 8) : "—"} · 评估版本 {view.run.evaluationVersion} · 来源：{originSourceLabel(candidate.originSource)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone={oc.tone} testId="evaluation-status">{oc.label}</Badge>
          <button type="button" className={BTN_GHOST} onClick={onRefresh} disabled={busy !== null}><RefreshCw size={11} /> 刷新</button>
        </div>
      </div>
      {view.run.status === "FAILED" ? <p className="text-xs text-[var(--danger)]" data-testid="evaluation-failed">评估未完成，不显示最终结论。</p> : null}

      {/* 硬门 */}
      <div className={`rounded-lg border p-2 text-xs ${TONE_CLASS[gate.tone]}`} data-testid="mandatory-gate-box">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span data-testid="mandatory-gate-label">{gate.label}</span>
          {rec ? <Badge tone={rec.tone} testId="gate-recommendation">{rec.label}</Badge> : null}
          {candidate.mandatoryGateResult === "PASS" ? <span className="font-normal text-[var(--muted)]">（通过硬门 ≠ 最终推荐）</span> : null}
        </p>
        {gate.hint ? <p className="mt-0.5 font-normal">{gate.hint}</p> : null}
        {candidate.mandatoryGate ? (
          <ul className="mt-1 space-y-0.5 font-normal" data-testid="gate-items">
            {candidate.mandatoryGate.items.map((it) => (
              <li key={it.requirementKey} data-testid="gate-item" data-requirement-key={it.requirementKey} data-gate-verdict={it.gateVerdict} data-reason={it.reasonCode}>
                <span className="font-mono">{it.requirementKey}</span>：{it.gateVerdict === "PASS" ? "✓" : it.gateVerdict === "FAIL" ? "✕" : "?"} {gateReasonText(it.reasonCode)}
              </li>
            ))}
          </ul>
        ) : null}
        {canAct ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy !== null} data-testid="compute-gate"
              onClick={() => void onAct("gate", () => workspaceFetch(`/api/supplier-intel/candidates/${candidate.id}/mandatory-gate${q}`, { method: "POST" }), "强制项已计算。")}>
              {busy === "gate" ? <Loader2 size={12} className="animate-spin" /> : null} 计算强制项{pendingMandatory ? `（还有 ${pendingMandatory} 条未判定）` : ""}
            </button>
            <button type="button" className={BTN_GHOST} disabled={busy !== null || candidate.mandatoryGateResult === "PENDING"} data-testid="complete-evaluation"
              title={candidate.mandatoryGateResult === "PENDING" ? "先计算强制项" : "完成后结果冻结，改判需新建评估"}
              onClick={() => void onAct("complete", () => workspaceFetch(`/api/supplier-intel/runs/${view.run.id}/complete${q}`, { method: "POST" }), "评估已完成并冻结。")}>
              完成评估
            </button>
          </div>
        ) : null}
      </div>

      <RequirementGroup title="强制项" rows={mandatoryRows} candidate={candidate} canAct={canAct} busy={busy} q={q} onAct={onAct} />
      <RequirementGroup title="非强制项" rows={optionalRows} candidate={candidate} canAct={canAct} busy={busy} q={q} onAct={onAct} />
      {terminal ? <p className="text-[11px] text-[var(--muted)]">评估已冻结：候选快照、判定与硬门不再变化；改判请新建评估运行。</p> : null}
    </div>
  );
}

function RequirementGroup({ title, rows, candidate, canAct, busy, q, onAct }: {
  title: string; rows: EvaluationRequirementRowView[]; candidate: EvaluationCandidateView; canAct: boolean; busy: string | null; q: string;
  onAct: (label: string, fn: () => Promise<unknown>, okText: string) => Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">{title}（{rows.length}）</p>
      <ul className="space-y-2">
        {rows.map((r) => <RequirementRow key={r.entry.code} row={r} candidate={candidate} canAct={canAct} busy={busy} q={q} onAct={onAct} />)}
      </ul>
    </div>
  );
}

function RequirementRow({ row, candidate, canAct, busy, q, onAct }: {
  row: EvaluationRequirementRowView; candidate: EvaluationCandidateView; canAct: boolean; busy: string | null; q: string;
  onAct: (label: string, fn: () => Promise<unknown>, okText: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<(typeof VERDICTS)[number]>("UNKNOWN");
  const [selected, setSelected] = useState<EvidenceSel[]>([]);
  const [explanation, setExplanation] = useState("");
  const ml = mandatoryLabel(row.entry.mandatory);
  const mv = row.match ? matchVerdictDisplay(row.match.verdict) : null;
  const gateItem = candidate.mandatoryGate?.items.find((i) => i.requirementKey === row.entry.code) ?? null;
  const evidenceList = Array.isArray(row.match?.evidence) ? (row.match!.evidence as Array<Record<string, unknown>>) : [];
  const toggle = (sel: EvidenceSel) => setSelected((p) => {
    const key = JSON.stringify(sel);
    return p.some((x) => JSON.stringify(x) === key) ? p.filter((x) => JSON.stringify(x) !== key) : [...p, sel];
  });
  const needsEvidence = verdict !== "UNKNOWN";
  const canSubmit = !needsEvidence || selected.length > 0;

  return (
    <li className="rounded-lg border border-[var(--border)] p-2 text-xs" data-testid="requirement-row" data-requirement-key={row.entry.code} data-verdict={row.match?.verdict ?? ""} data-evaluated-by={row.match?.evaluatedBy ?? ""}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="font-mono text-[11px] text-[var(--muted)]">{row.entry.code}</span>
        <Badge tone={ml.tone} testId="requirement-mandatory">{ml.label}</Badge>
        {mv ? <Badge tone={mv.tone} testId="requirement-verdict">{mv.label}</Badge> : <Badge tone="neutral" testId="requirement-verdict">未判定</Badge>}
        {row.match ? <span className="text-[var(--muted)]" data-testid="requirement-evaluated-by">· {evaluatedByLabel(row.match.evaluatedBy)}</span> : null}
        {gateItem ? <span className="text-[var(--muted)]" data-testid="requirement-gate-reason">· 硬门：{gateReasonText(gateItem.reasonCode)}</span> : null}
      </div>
      <p className="mt-1 text-sm" data-testid="requirement-text-en">{row.entry.text}</p>
      {row.display?.textZh && row.display.textZhIsChinese ? <p className="text-[var(--muted)]" data-testid="requirement-text-zh">{row.display.textZh}</p> : null}
      {row.display && row.display.sources.length > 0 ? (
        <p className="mt-0.5 text-[11px] text-[var(--muted)]" data-testid="requirement-sources">
          来源：{row.display.sources.slice(0, 3).map((s, i) => <span key={i} className="mr-2">{s.documentTitle ?? "文档"}{s.locationLabel ? ` · ${s.locationLabel}` : ""}</span>)}
        </p>
      ) : <p className="mt-0.5 text-[11px] text-[var(--muted)]">来源：需求快照（冻结于评估运行创建时）</p>}

      {row.match ? (
        <div className="mt-1 rounded bg-[var(--background)] p-2" data-testid="requirement-match">
          {row.match.explanation ? <p className="whitespace-pre-wrap">{row.match.explanation}</p> : null}
          <p className="text-[11px] text-[var(--muted)]" data-testid="requirement-evidence">
            证据：{evidenceList.length === 0 ? "无（资料待补）" : evidenceList.map((e, i) => <span key={i} className="mr-2">{String(e.kind)}{e.certificationType ? ` ${String(e.certificationType)}（评估时 ${String(e.statusAtEvaluation)}）` : ""}</span>)}
          </p>
        </div>
      ) : null}

      {!row.match && row.suggestion ? (
        <div className="mt-1 rounded border border-dashed border-[var(--border)] p-2" data-testid="requirement-suggestion" data-suggestion-verdict={row.suggestion.verdict}>
          <p><span className="font-medium">规则建议：</span>{matchVerdictDisplay(row.suggestion.verdict).label}<span className="text-[var(--muted)]">（{row.suggestion.ruleId}）</span></p>
          <p className="text-[11px] text-[var(--muted)]">{row.suggestion.explanation}</p>
          {canAct ? (
            <button type="button" className={`${BTN_GHOST} mt-1`} disabled={busy !== null} data-testid="apply-suggestion"
              onClick={() => void onAct(`det:${row.entry.code}`, () => workspaceFetch(`/api/supplier-intel/candidates/${candidate.id}/matches${q}`, { method: "POST", body: JSON.stringify({ requirementKey: row.entry.code, applyDeterministic: true }) }), "已按规则判定并记录。")}>
              采用规则判定（记为「规则判断」）
            </button>
          ) : null}
        </div>
      ) : null}

      {!row.match && canAct ? (
        <div className="mt-1">
          {!open ? <button type="button" className={BTN_GHOST} onClick={() => setOpen(true)} data-testid="open-adjudicate">人工判定…</button> : (
            <div className="space-y-2 rounded border border-[var(--border)] p-2" data-testid="adjudicate-form">
              <div className="flex flex-wrap gap-1">
                {VERDICTS.map((v) => { const d = matchVerdictDisplay(v); return (
                  <button key={v} type="button" onClick={() => setVerdict(v)} data-testid={`verdict-${v}`} aria-pressed={verdict === v}
                    className={`rounded-full border px-2 py-0.5 ${verdict === v ? "border-transparent bg-[var(--accent)] text-[color:var(--on-accent)]" : "border-[var(--border)]"}`}>{d.label}</button>
                ); })}
              </div>
              <p className="text-[11px] text-[var(--muted)]">{needsEvidence ? "满足 / 部分满足 / 不满足 必须附证据；硬门只认已核验证书或项目档案。" : "资料不足可不附证据，记为资料待补。"}</p>
              <EvidencePicker candidate={candidate} selected={selected} onToggle={toggle} />
              <input className={INPUT} placeholder="说明（可选）" value={explanation} onChange={(e) => setExplanation(e.target.value)} data-testid="adjudicate-explanation" />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_PRIMARY} disabled={busy !== null || !canSubmit} data-testid="adjudicate-submit"
                  onClick={() => void onAct(`match:${row.entry.code}`, () => workspaceFetch(`/api/supplier-intel/candidates/${candidate.id}/matches${q}`, { method: "POST", body: JSON.stringify({ requirementKey: row.entry.code, verdict, evidence: selected, explanation: explanation.trim() || null }) }), "判定已记录（人工确认）。")}>
                  记录判定
                </button>
                <button type="button" className={BTN_GHOST} onClick={() => setOpen(false)} disabled={busy !== null}>取消</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function EvidencePicker({ candidate, selected, onToggle }: { candidate: EvaluationCandidateView; selected: EvidenceSel[]; onToggle: (s: EvidenceSel) => void }) {
  const has = (s: EvidenceSel) => selected.some((x) => JSON.stringify(x) === JSON.stringify(s));
  const { certifications, signals, archives } = candidate.evidenceOptions;
  return (
    <div className="space-y-1 text-[11px]" data-testid="evidence-picker">
      <p className="font-medium">证据（勾选）</p>
      {certifications.length ? (
        <ul className="space-y-0.5">
          {certifications.map((c) => { const st = certificationStatusDisplay(c.status, c.expiredByDate); return (
            <li key={c.id}><label className="inline-flex items-start gap-1">
              <input type="checkbox" checked={has({ kind: "certification", certificationId: c.id })} onChange={() => onToggle({ kind: "certification", certificationId: c.id })} data-testid="evidence-cert" data-cert-id={c.id} />
              <span>{certificationTypeLabel(c.certificationType)} · {certificationScopeLabel(c.scope)}{c.scope !== "SUPPLIER" ? (c.scopeCompatible ? "（对应本产品）" : "（对应其它产品，不可采信）") : ""} · <Badge tone={st.tone}>{st.label}</Badge>{c.expiresAt ? ` · 有效至 ${new Date(c.expiresAt).toLocaleDateString("zh-CN")}` : ""}</span>
            </label></li>
          ); })}
        </ul>
      ) : <p className="text-[var(--muted)]">该供应商没有登记证书</p>}
      {signals.length ? (
        <ul className="space-y-0.5">
          {signals.map((s) => (
            <li key={s.id}><label className="inline-flex items-start gap-1">
              <input type="checkbox" checked={has({ kind: "signal", signalId: s.id })} onChange={() => onToggle({ kind: "signal", signalId: s.id })} data-testid="evidence-signal" data-signal-id={s.id} />
              <span>线索：{s.title}<span className="text-[var(--muted)]">（{s.platform}；单独不构成硬门证据）</span></span>
            </label></li>
          ))}
        </ul>
      ) : null}
      {archives.length ? (
        <ul className="space-y-0.5">
          {archives.map((a) => (
            <li key={a.id}><label className="inline-flex items-start gap-1">
              <input type="checkbox" checked={has({ kind: "archive", archiveItemId: a.id })} onChange={() => onToggle({ kind: "archive", archiveItemId: a.id })} data-testid="evidence-archive" data-archive-id={a.id} />
              <span>项目档案：{a.kind} · {a.mimeType} · {new Date(a.capturedAt).toLocaleDateString("zh-CN")}</span>
            </label></li>
          ))}
        </ul>
      ) : null}
      {!certifications.length && !signals.length && !archives.length ? <p className="flex items-center gap-1 text-[var(--warning)]"><AlertTriangle size={11} /> 没有可用证据；只能记为「资料不足」。</p> : null}
    </div>
  );
}
