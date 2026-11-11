"use client";

/**
 * TI-4b 投标工作区面板（「标书与报价」页签顶部）
 *
 * - 只在读取接口成功返回时渲染；404（开关关闭）时返回 null，页面与没有本面板时相同。
 * - 显示可投标判定、阻断项、三张清单与十三个阶段的决定——没有任何「是否执行」的询问。
 * - 价格表与文件领取方名单：粘贴导入（有项目写权限时）。
 * - TI-4c：价格表每行可展开录入拟投品牌型号、产品尺寸与证书；补遗卡片可新增与删除。
 * - 成本核算：输入只保存在浏览器本地；点「计算」由接口返回核算表，组件不做任何金额运算。
 * - 没有发送、提交、批准之类的对外动作。
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, ClipboardList, FileDiff, Loader2, Pencil, Plus, ShieldAlert, Trash2, Upload, Users } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import type { CostSheetView } from "@/lib/tender-bid-cost/sheet-view";
import { latestAddendumFor } from "@/lib/tender-bid-readiness/staleness";
import type { LineDetail, StoredWorkspace } from "@/lib/tender-bid-workspace/contract";
import {
  buildCostRequest, costDraftStorageKey, currenciesNeedingFx, emptyCostDraft, emptyDraftLine, parseCostDraft,
  type CostDraft, type CostDraftLine,
} from "@/lib/tender-bid-workspace/cost-draft";
import {
  ACCREDITED_ZH, CERT_COVERAGE_ZH, CERT_STATUS_ZH, VERIFIED_IS_MANUAL_ZH, addendumFromDraft, detailFromDraft, draftFromDetail, emptyCertDraft, formatLineNos,
  removeAddendum, upsertAddendum, withLineDetail, type AddendumDraft, type CertDraft, type LineEntryDraft,
} from "@/lib/tender-bid-workspace/line-entry";
import { nowWithOffset, parseHolderNames, parseSchedulePaste, type ParsedSchedule } from "@/lib/tender-bid-workspace/paste-import";
import type { SchedulePrefillResponse } from "@/lib/tender-bid-workspace/schedule-prefill";
import type { WorkspaceView } from "@/lib/tender-bid-workspace/workspace-view";

type Readiness = WorkspaceView["readiness"];

type Loaded = { workspace: StoredWorkspace | null; view: WorkspaceView };
type LoadState = { status: "loading" | "off" | "error" } | { status: "ready"; data: Loaded };

const CARD = "rounded-xl border border-border bg-card-bg p-4 sm:p-5";
const FIELD = "rounded border border-border bg-transparent px-1.5 py-1 text-xs";
const INPUT = `${FIELD} w-full`;
const SELECT = `${FIELD} min-w-[4.75rem]`;
const BTN = "inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs hover:bg-accent/5 disabled:opacity-50";
const BTN_PRIMARY = "inline-flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-[color:var(--on-accent)] disabled:opacity-50";
const TH = "whitespace-nowrap border-b border-border px-2 py-1 text-left font-medium text-muted";
const TD = "border-b border-border/50 px-2 py-1 align-top";

const DECISION_TONE: Record<string, string> = {
  RUN: "border-emerald-300 bg-emerald-50 text-emerald-800",
  WAIT_MATERIAL: "border-amber-300 bg-amber-50 text-amber-800",
  NOT_CONNECTED: "border-slate-300 bg-slate-50 text-slate-700",
  MANUAL_ONLY: "border-slate-300 bg-slate-50 text-slate-700",
  STOP_FOR_APPROVAL: "border-indigo-300 bg-indigo-50 text-indigo-800",
  OFF: "border-border bg-transparent text-muted",
};

export function BidWorkspacePanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // 点「计算」后接口连同核算表一起返回的判定（已计入成本）；保存工作区后作废
  const [costReadiness, setCostReadiness] = useState<Readiness | null>(null);
  const url = `/api/projects/${projectId}/bid-workspace`;

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(url);
      if (res.status === 404) return setState({ status: "off" });
      if (!res.ok) return setState({ status: "error" });
      setState({ status: "ready", data: (await res.json()) as Loaded });
    } catch {
      setState({ status: "error" });
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (body: unknown): Promise<string | null> => {
    const res = await apiFetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as (Loaded & { error?: string }) | null;
    if (!res.ok || !json) return json?.error ?? "保存失败";
    setState({ status: "ready", data: json });
    setCostReadiness(null);
    return null;
  }, [url]);

  // 开关关闭 / 加载中 / 出错：不渲染任何内容，页签与没有本面板时相同
  if (state.status !== "ready") return null;
  const { view, workspace } = state.data;

  return (
    <section className="space-y-4" data-testid="bid-workspace-panel">
      <VerdictCard readiness={costReadiness ?? view.readiness} withCost={costReadiness !== null} />
      <StageCard view={view} />
      <ScheduleCard projectId={projectId} view={view} workspace={workspace} canManage={canManage} onSave={save} />
      <AddendaCard view={view} workspace={workspace} canManage={canManage} onSave={save} />
      <HoldersCard view={view} workspace={workspace} canManage={canManage} onSave={save} />
      <CostCard projectId={projectId} view={view} onReadiness={setCostReadiness} />
    </section>
  );
}

/* ------------------------------ 判定与阻断项 ------------------------------ */

function VerdictCard({ readiness, withCost }: { readiness: Readiness; withCost: boolean }) {
  const ready = readiness.state === "READY_FOR_OWNER_DECISION";
  return (
    <div className={CARD} data-testid="bw-verdict">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldAlert size={16} className="text-accent/60" />
          投标工作区
        </h3>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${ready ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-700"}`}>
          {readiness.stateZh}
        </span>
        <span className="text-xs text-muted">{readiness.summaryZh}</span>
        <span className="text-[11px] text-muted" data-testid="bw-verdict-basis">{withCost ? "已计入本次成本核算" : "尚未计入成本核算（在下方点「计算」后更新）"}</span>
      </div>
      {readiness.blockers.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs" data-testid="bw-blockers">
          {readiness.blockers.map((b, i) => (
            <li key={`${b.code}-${b.lineNo ?? "x"}-${i}`} className="flex gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
              <span className="text-foreground/90">{b.messageZh}</span>
            </li>
          ))}
        </ul>
      )}
      {readiness.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-amber-800">
          {readiness.warnings.map((w) => <li key={w.code}>提示：{w.messageZh}</li>)}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------ 阶段与三张清单 ------------------------------ */

function StageCard({ view }: { view: WorkspaceView }) {
  if (!view.stages.ok) return null;
  const { stages, lists } = view.stages;
  return (
    <div className={CARD} data-testid="bw-stages">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ClipboardList size={16} className="text-accent/60" />
        各阶段现在该不该做
      </h3>
      <p className="mt-1 text-xs text-muted">只读的阶段材料齐备就直接做；只有对外发送、付费、提交和需要 Owner 决定的才停下。</p>
      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
        <ListBlock title="缺的材料" empty="不缺" items={lists.missingMaterials.map((m) => `${m.stageZh}：${m.materials.join("、")}`)} />
        <ListBlock title="未接通的来源" empty="没有" items={lists.notConnected.map((n) => `${n.stageZh}：${n.sourceZh}（${n.stateZh}）`)} />
        <ListBlock title="等批准的动作" empty="没有" items={lists.awaitingApproval.map((a) => a.stageZh)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {stages.map((s) => (
          <span key={s.key} title={s.detailZh} className={`rounded-full border px-2 py-0.5 text-[11px] ${DECISION_TONE[s.decision] ?? ""}`}>
            {s.labelZh} · {s.decisionZh}
          </span>
        ))}
      </div>
    </div>
  );
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2">
      <p className="font-medium text-foreground">{title}</p>
      {items.length === 0 ? <p className="mt-1 text-muted">{empty}</p> : (
        <ul className="mt-1 space-y-0.5 text-foreground/85">{items.map((t) => <li key={t}>{t}</li>)}</ul>
      )}
    </div>
  );
}

/* ------------------------------ 价格表 ------------------------------ */

function ScheduleCard({ projectId, view, workspace, canManage, onSave }: { projectId: string; view: WorkspaceView; workspace: StoredWorkspace | null; canManage: boolean; onSave: (body: unknown) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // FIX-2：从招标分析带入。只把生成的文本填进粘贴框——不保存；保存仍由人点下面的按钮
  const [prefill, setPrefill] = useState<SchedulePrefillResponse | null>(null);
  const [prefillBusy, setPrefillBusy] = useState(false);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const loadPrefill = async () => {
    setPrefillBusy(true);
    setPrefillError(null);
    setConfirmReplace(false);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/bid-workspace/schedule-candidates`);
      const data = (await res.json().catch(() => null)) as (SchedulePrefillResponse & { error?: string }) | null;
      if (!res.ok || !data || typeof data.state !== "string") {
        setPrefillError(data?.error ?? "没有取到招标分析里的数量，请重试。");
        return;
      }
      setPrefill(data);
      if (data.state === "ready" && data.rows.length > 0) setText(data.text);
    } catch {
      setPrefillError("网络出错了，请重试。");
    } finally {
      setPrefillBusy(false);
    }
  };
  // 粘贴框里已经有内容：先确认再替换
  const askPrefill = () => (text.trim() ? setConfirmReplace(true) : void loadPrefill());
  const parsed: ParsedSchedule | null = useMemo(() => (text.trim() ? parseSchedulePaste(text) : null), [text]);
  const lines = view.schedule.lines;
  const parsedCount = parsed ? parsed.lines.length : 0;

  const submit = async () => {
    if (!parsed || parsed.lines.length === 0) return;
    setBusy(true);
    const err = await onSave({ priceSchedule: { lines: parsed.lines } });
    setBusy(false);
    setError(err);
    if (!err) { setOpen(false); setText(""); setPrefill(null); }
  };

  return (
    <div className={CARD} data-testid="bw-schedule">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">价格表行项 <span className="ml-1 text-xs font-normal text-muted">{lines.length} 行</span></h3>
        {canManage && (
          <button type="button" className={BTN} onClick={() => setOpen((v) => !v)} data-testid="bw-schedule-import-toggle">
            <Upload size={12} /> 粘贴导入
          </button>
        )}
      </div>
      {!view.schedule.validation.valid && view.schedule.validation.issues.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-red-700">{view.schedule.validation.issues.slice(0, 6).map((i, k) => <li key={k}>{i.messageZh}</li>)}</ul>
      )}
      {open && canManage && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">从发标方的价格表里复制整块粘贴。列序：行号、说明、数量、单位、包装数、尺寸、最小尺寸、认证要求。单位与数量按原文保存，不做换算。保存会替换现有的全部行项。</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN} disabled={prefillBusy} onClick={askPrefill} data-testid="bw-schedule-prefill">
              {prefillBusy ? <Loader2 size={12} className="animate-spin" /> : <ClipboardList size={12} />} 从招标分析带入
            </button>
            <span className="text-xs text-muted">把招标分析抽到的数量与单位填进下面的框里，核对后再保存。</span>
          </div>
          {confirmReplace && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-amber-800" data-testid="bw-schedule-prefill-confirm">
              下面的框里已经有内容，带入会把它换掉。
              <button type="button" className={BTN} onClick={() => void loadPrefill()}>确定替换</button>
              <button type="button" className="text-muted underline" onClick={() => setConfirmReplace(false)}>先不带入</button>
            </p>
          )}
          {prefillError && <p className="text-xs text-red-700">{prefillError}</p>}
          {prefill && <p className="text-xs text-foreground" data-testid="bw-schedule-prefill-message">{prefill.messageZh}</p>}
          <textarea className={`${INPUT} h-32 font-mono`} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1\tTwin Mattress Cover\t2367\tEach\t\t39 x 77.5 x 9-15"} data-testid="bw-schedule-paste" />
          {prefill && prefill.rows.length > 0 && (
            <details className="text-xs text-muted" open data-testid="bw-schedule-prefill-rows">
              <summary className="cursor-pointer">带入的 {prefill.rows.length} 行各自的原文（对照招标文件核对）</summary>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {prefill.rows.map((r) => (
                  <li key={r.lineNo}>
                    第 {r.lineNo} 行：数量原文「{r.quantityText}」{r.unitText ? `，单位原文「${r.unitText}」` : "，原文没有单位"}{r.page ? ` · 第 ${r.page} 页` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {prefill && prefill.skipped.length > 0 && (
            <details className="text-xs text-amber-800" open data-testid="bw-schedule-prefill-skipped">
              <summary className="cursor-pointer">没有带入的 {prefill.skipped.length} 条（数量看不准，要你自己填）</summary>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                {prefill.skipped.map((k, i) => (
                  <li key={i}>
                    {k.description}：{k.reasonZh}{k.quantityText ? `（原文「${k.quantityText}」）` : ""}{k.page ? ` · 第 ${k.page} 页` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {parsed && (
            <p className="text-xs text-muted">
              解析出 {parsed.lines.length} 行{parsed.skippedHeader ? "（已跳过表头）" : ""}{parsed.issues.length > 0 ? `，${parsed.issues.length} 行有问题` : ""}
            </p>
          )}
          {parsed && parsed.issues.length > 0 && <ul className="space-y-0.5 text-xs text-red-700">{parsed.issues.slice(0, 8).map((i) => <li key={i.row}>{i.messageZh}</li>)}</ul>}
          {error && <p className="text-xs text-red-700">{error}</p>}
          <button type="button" className={BTN_PRIMARY} disabled={busy || !parsed || parsed.lines.length === 0} onClick={submit} data-testid="bw-schedule-save">
            {busy && <Loader2 size={12} className="animate-spin" />} 保存 {parsedCount} 行
          </button>
        </div>
      )}
      {lines.length === 0 ? <p className="mt-3 text-xs text-muted">还没有价格表行项。</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead><tr>{["行", "说明", "数量", "单位", "包装数", "尺寸", "认证", "拟投产品", "核对", ""].map((h, i) => <th key={i} className={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {lines.map((l) => {
                const check = view.lineChecks.find((c) => c.lineNo === l.lineNo);
                const cert = check?.certification.verdict;
                const dim = check?.dimension?.verdict;
                const detail = workspace?.lineDetails[String(l.lineNo)];
                const product = [detail?.product?.make, detail?.product?.model].filter(Boolean).join(" ");
                const latest = latestAddendumFor(l.lineNo, view.addenda);
                const needsReview = !!detail && latest > (detail.basedOnAddendum ?? 0);
                return (
                  <Fragment key={l.lineNo}>
                  <tr>
                    <td className={TD}>{l.lineNo}</td>
                    <td className={TD}>{l.description}</td>
                    <td className={`${TD} text-right tabular-nums`}>{String(l.quantity)}</td>
                    <td className={TD}>{l.uom}</td>
                    <td className={`${TD} text-right tabular-nums`}>{l.packCount ?? ""}</td>
                    <td className={TD}>{l.dimensions ?? (l.minimumDimensions ? `≥ ${l.minimumDimensions}` : "")}</td>
                    <td className={TD}>{l.certificationGate ? "须整机认证" : ""}</td>
                    <td className={TD}>
                      {product && <span className="block">{product}</span>}
                      {detail?.offeredDimensions && <span className="block text-muted">{detail.offeredDimensions}</span>}
                    </td>
                    <td className={TD}>
                      {cert === "BLOCKED" && <span className="text-red-700">认证未过 </span>}
                      {cert === "PASS" && <span className="text-emerald-700">认证通过 </span>}
                      {dim === "MISMATCH" && <span className="text-red-700">尺寸不符</span>}
                      {dim === "MATCH" && <span className="text-emerald-700">尺寸相符</span>}
                      {dim === "UNKNOWN" && <span className="text-amber-700">尺寸无法判断</span>}
                      {needsReview && <span className="block text-amber-700">第 {latest} 号补遗后待复核</span>}
                    </td>
                    <td className={`${TD} text-right`}>
                      {canManage && (
                        <button type="button" data-testid={`bw-line-edit-${l.lineNo}`} className={BTN} onClick={() => setEditing(editing === l.lineNo ? null : l.lineNo)}>
                          <Pencil size={11} /> 录入
                        </button>
                      )}
                    </td>
                  </tr>
                  {editing === l.lineNo && canManage && (
                    <tr>
                      <td colSpan={10} className="border-b border-border bg-accent/5 px-3 py-3">
                        <LineEditor
                          key={l.lineNo}
                          lineNo={l.lineNo}
                          required={l.dimensions ?? (l.minimumDimensions ? `≥ ${l.minimumDimensions}` : null)}
                          certificationGate={l.certificationGate ?? null}
                          detail={detail}
                          latestAddendum={latest}
                          reasons={cert === "BLOCKED" ? check?.certification.reasons.map((r) => r.messageZh) ?? [] : []}
                          onCancel={() => setEditing(null)}
                          onSave={async (draft) => {
                            const r = detailFromDraft(draft, { basedOnAddendum: latestAddendumFor(l.lineNo, view.addenda) });
                            if (!r.ok) return r.issuesZh.join("；");
                            const err = await onSave({ lineDetails: withLineDetail(workspace?.lineDetails, l.lineNo, r.detail) });
                            if (!err) setEditing(null);
                            return err;
                          }}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ 行录入（TI-4c） ------------------------------ */

function LineEditor({ lineNo, required, certificationGate, detail, latestAddendum, reasons, onSave, onCancel }: {
  lineNo: number; required: string | null; certificationGate: string | null; detail: LineDetail | undefined; latestAddendum: number;
  reasons: string[]; onSave: (draft: LineEntryDraft) => Promise<string | null>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<LineEntryDraft>(() => draftFromDetail(detail));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setCert = (i: number, patch: Partial<CertDraft>) => setDraft((d) => ({ ...d, certificates: d.certificates.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
  const submit = async () => {
    setBusy(true);
    const err = await onSave(draft);
    setBusy(false);
    setError(err);
  };
  return (
    <div className="space-y-3 text-xs" data-testid={`bw-line-editor-${lineNo}`}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1"><span className="block text-muted">拟投品牌</span><input className={`${FIELD} w-40`} value={draft.make} onChange={(e) => setDraft((d) => ({ ...d, make: e.target.value }))} data-testid="bw-line-make" /></label>
        <label className="space-y-1"><span className="block text-muted">型号</span><input className={`${FIELD} w-40`} value={draft.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} data-testid="bw-line-model" /></label>
        <label className="space-y-1">
          <span className="block text-muted">产品尺寸{required ? `（要求 ${required}）` : "（本行没有尺寸要求）"}</span>
          <input className={`${FIELD} w-52`} value={draft.offeredDimensions} placeholder="如 39 x 77.5 x 12" onChange={(e) => setDraft((d) => ({ ...d, offeredDimensions: e.target.value }))} data-testid="bw-line-dims" />
        </label>
      </div>

      {certificationGate && (
        <div className="space-y-2">
          <p className="font-medium text-foreground">证书 <span className="font-normal text-muted">（本行要求：{certificationGate}）</span></p>
          <p className="text-amber-800">{VERIFIED_IS_MANUAL_ZH}</p>
          {reasons.length > 0 && <p className="text-red-700">目前未过：{reasons.join("；")}</p>}
          {draft.certificates.map((c, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 bg-card-bg px-2 py-2" data-testid={`bw-cert-${i}`}>
              <label className="space-y-1"><span className="block text-muted">编号</span><input className={`${FIELD} w-36`} value={c.id} onChange={(e) => setCert(i, { id: e.target.value })} data-testid={`bw-cert-id-${i}`} /></label>
              <label className="space-y-1"><span className="block text-muted">状态</span>
                <select className={SELECT} value={c.status} onChange={(e) => setCert(i, { status: e.target.value as CertDraft["status"] })} data-testid={`bw-cert-status-${i}`}>
                  {(Object.keys(CERT_STATUS_ZH) as CertDraft["status"][]).map((k) => <option key={k} value={k}>{CERT_STATUS_ZH[k]}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="block text-muted">覆盖范围</span>
                <select className={SELECT} value={c.coverage} onChange={(e) => setCert(i, { coverage: e.target.value as CertDraft["coverage"] })} data-testid={`bw-cert-coverage-${i}`}>
                  {(Object.keys(CERT_COVERAGE_ZH) as CertDraft["coverage"][]).map((k) => <option key={k} value={k}>{CERT_COVERAGE_ZH[k]}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="block text-muted">发证机构</span><input className={`${FIELD} w-32`} value={c.issuer} onChange={(e) => setCert(i, { issuer: e.target.value })} data-testid={`bw-cert-issuer-${i}`} /></label>
              <label className="space-y-1"><span className="block text-muted">在加拿大受认可</span>
                <select className={SELECT} value={c.accredited} onChange={(e) => setCert(i, { accredited: e.target.value as CertDraft["accredited"] })} data-testid={`bw-cert-accredited-${i}`}>
                  {(Object.keys(ACCREDITED_ZH) as CertDraft["accredited"][]).map((k) => <option key={k} value={k}>{ACCREDITED_ZH[k]}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="block text-muted">所列型号（逗号分隔）</span><input className={`${FIELD} w-40`} value={c.coveredModels} onChange={(e) => setCert(i, { coveredModels: e.target.value })} data-testid={`bw-cert-models-${i}`} /></label>
              <label className="space-y-1"><span className="block text-muted">到期日</span><input className={`${FIELD} w-28`} placeholder="YYYY-MM-DD" value={c.expiresAt} onChange={(e) => setCert(i, { expiresAt: e.target.value })} data-testid={`bw-cert-expires-${i}`} /></label>
              <label className="space-y-1"><span className="block text-muted">出处（文件名、链接或查询记录）</span><input className={`${FIELD} w-64`} value={c.evidenceRef} onChange={(e) => setCert(i, { evidenceRef: e.target.value })} data-testid={`bw-cert-evidence-${i}`} /></label>
              <button type="button" className={BTN} onClick={() => setDraft((d) => ({ ...d, certificates: d.certificates.filter((_, k) => k !== i) }))}><Trash2 size={11} /> 移除</button>
            </div>
          ))}
          <button type="button" className={BTN} onClick={() => setDraft((d) => ({ ...d, certificates: [...d.certificates, emptyCertDraft()] }))} data-testid="bw-cert-add"><Plus size={11} /> 加一张证书</button>
        </div>
      )}

      {latestAddendum > 0 && <p className="text-muted">第 {latestAddendum} 号补遗影响本行：保存即表示已按它核对过这一行。</p>}
      {error && <p className="text-red-700" data-testid="bw-line-error">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={submit} data-testid="bw-line-save">{busy && <Loader2 size={12} className="animate-spin" />} 保存第 {lineNo} 行</button>
        <button type="button" className={BTN} onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

/* ------------------------------ 补遗（TI-4c） ------------------------------ */

function AddendaCard({ view, workspace, canManage, onSave }: { view: WorkspaceView; workspace: StoredWorkspace | null; canManage: boolean; onSave: (body: unknown) => Promise<string | null> }) {
  const addenda = workspace?.addenda ?? [];
  const [error, setError] = useState<string | null>(null);
  if (view.schedule.lines.length === 0) return null;
  const remove = async (number: number) => setError(await onSave({ addenda: removeAddendum(addenda, number) }));
  return (
    <div className={CARD} data-testid="bw-addenda">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><FileDiff size={16} className="text-accent/60" /> 补遗 <span className="text-xs font-normal text-muted">{addenda.length} 份</span></h3>
      <p className="mt-1 text-xs text-muted">补遗影响到的行，如果之前已经录入过尺寸或证书，会被标为待复核，重新保存该行后消除。系统不解析补遗正文，影响哪些行由人填。</p>
      {addenda.length === 0 ? <p className="mt-2 text-xs text-muted">还没有补遗。</p> : (
        <ul className="mt-2 space-y-1 text-xs">
          {addenda.map((a) => (
            <li key={a.number} className="flex flex-wrap items-center gap-2 border-b border-border/40 py-1 last:border-0">
              <span className="font-medium">第 {a.number} 号</span>
              {a.issuedOn && <span className="text-muted">{a.issuedOn}</span>}
              <span>{a.affectedLineNos.length > 0 ? `影响第 ${formatLineNos(a.affectedLineNos)} 行` : "不影响价格表行"}</span>
              {a.effect && <span className="text-foreground/85">{a.effect}</span>}
              {canManage && <button type="button" className={`${BTN} ml-auto`} onClick={() => void remove(a.number)}><Trash2 size={11} /> 删除</button>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {canManage && <AddendumForm validLineNos={view.schedule.lines.map((l) => l.lineNo)} onAdd={(a) => onSave({ addenda: upsertAddendum(addenda, a) })} />}
    </div>
  );
}

function AddendumForm({ validLineNos, onAdd }: { validLineNos: number[]; onAdd: (a: StoredWorkspace["addenda"][number]) => Promise<string | null> }) {
  const empty: AddendumDraft = { number: "", issuedOn: "", affected: "", effect: "" };
  const [draft, setDraft] = useState<AddendumDraft>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const r = addendumFromDraft(draft, validLineNos);
    if (!r.ok) return setError(r.issuesZh.join("；"));
    setBusy(true);
    const err = await onAdd(r.addendum);
    setBusy(false);
    setError(err);
    if (!err) setDraft(empty);
  };
  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1"><span className="block text-muted">补遗号</span><input className={`${FIELD} w-16`} inputMode="numeric" value={draft.number} onChange={(e) => setDraft((d) => ({ ...d, number: e.target.value }))} data-testid="bw-addendum-number" /></label>
        <label className="space-y-1"><span className="block text-muted">日期</span><input className={`${FIELD} w-28`} placeholder="YYYY-MM-DD" value={draft.issuedOn} onChange={(e) => setDraft((d) => ({ ...d, issuedOn: e.target.value }))} data-testid="bw-addendum-date" /></label>
        <label className="space-y-1"><span className="block text-muted">影响的行（如 13-15, 18）</span><input className={`${FIELD} w-40`} value={draft.affected} onChange={(e) => setDraft((d) => ({ ...d, affected: e.target.value }))} data-testid="bw-addendum-lines" /></label>
        <label className="space-y-1"><span className="block text-muted">说明</span><input className={`${FIELD} w-72`} value={draft.effect} onChange={(e) => setDraft((d) => ({ ...d, effect: e.target.value }))} data-testid="bw-addendum-effect" /></label>
        <button type="button" className={BTN_PRIMARY} disabled={busy || !draft.number.trim()} onClick={submit} data-testid="bw-addendum-save">{busy && <Loader2 size={12} className="animate-spin" />} 保存补遗</button>
      </div>
      {error && <p className="text-red-700" data-testid="bw-addendum-error">{error}</p>}
    </div>
  );
}

/* ------------------------------ 文件领取方 ------------------------------ */

function HoldersCard({ view, workspace, canManage, onSave }: { view: WorkspaceView; workspace: StoredWorkspace | null; canManage: boolean; onSave: (body: unknown) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState("");
  const [portal, setPortal] = useState(workspace?.documentHolders?.portal ?? "MERX");
  const [solicitationId, setSolicitationId] = useState(workspace?.documentHolders?.solicitationId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = view.documentHolders && view.documentHolders.ok ? view.documentHolders : null;
  const entries = parseHolderNames(names);

  const submit = async () => {
    setBusy(true);
    const err = await onSave({ documentHolders: { solicitationId: solicitationId.trim(), portal: portal.trim(), sourceKind: "USER_UPLOAD_TABLE", capturedAt: nowWithOffset(), entries } });
    setBusy(false);
    setError(err);
    if (!err) { setOpen(false); setNames(""); }
  };

  return (
    <div className={CARD} data-testid="bw-holders">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Users size={16} className="text-accent/60" /> 文件领取方</h3>
        {canManage && <button type="button" className={BTN} onClick={() => setOpen((v) => !v)}><Upload size={12} /> 粘贴名单</button>}
      </div>
      <p className="mt-1 text-xs text-amber-800">领取文件不等于投标：这是下载过招标文件的名单，不是投标人名单，也不预示谁会投标。</p>
      {summary ? (
        <>
          <div className="mt-2 flex flex-wrap gap-4 text-xs">
            <span>领取方 <b className="tabular-nums">{summary.documentHolderCount}</b></span>
            <span>其中竞争对手 <b className="tabular-nums">{summary.competitorHolderCount}</b></span>
            <span>投标人数 <b>{summary.bidderCount === null ? "未知" : summary.bidderCount}</b></span>
            <span className="text-muted">来源：{summary.portal} · 采集于 {summary.capturedAt}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary.entries.map((e, i) => (
              <span key={`${e.normalizedName}-${i}`} className={`rounded-full border px-2 py-0.5 text-[11px] ${e.isOwn ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-border text-foreground/85"}`}>
                {e.name}{e.isOwn ? "（我方）" : ""}
              </span>
            ))}
          </div>
        </>
      ) : <p className="mt-2 text-xs text-muted">还没有领取方名单。</p>}
      {open && canManage && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input className={`${INPUT} max-w-[10rem]`} value={portal} onChange={(e) => setPortal(e.target.value)} placeholder="门户，如 MERX" />
            <input className={`${INPUT} max-w-[14rem]`} value={solicitationId} onChange={(e) => setSolicitationId(e.target.value)} placeholder="招标编号" />
          </div>
          <textarea className={`${INPUT} h-28`} value={names} onChange={(e) => setNames(e.target.value)} placeholder="一行一个公司名" />
          {error && <p className="text-xs text-red-700">{error}</p>}
          <button type="button" className={BTN_PRIMARY} disabled={busy || entries.length === 0 || !portal.trim() || !solicitationId.trim()} onClick={submit}>
            {busy && <Loader2 size={12} className="animate-spin" />} 保存 {entries.length} 家
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ 成本核算 ------------------------------ */

function CostCard({ projectId, view, onReadiness }: { projectId: string; view: WorkspaceView; onReadiness: (r: Readiness | null) => void }) {
  const storageKey = costDraftStorageKey(projectId);
  const [draft, setDraft] = useState<CostDraft>(emptyCostDraft);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<CostSheetView | null>(null);
  const lines = view.schedule.lines;

  useEffect(() => {
    try { setDraft(parseCostDraft(window.localStorage.getItem(storageKey))); } catch { /* 本地存储不可用：用空草稿 */ }
    setHydrated(true);
  }, [storageKey]);
  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* 忽略 */ }
  }, [draft, hydrated, storageKey]);

  const setLine = (lineNo: number, patch: Partial<CostDraftLine>) =>
    setDraft((d) => ({ ...d, lines: { ...d.lines, [String(lineNo)]: { ...(d.lines[String(lineNo)] ?? emptyDraftLine()), ...patch } } }));
  const setFx = (currency: string, patch: Partial<{ rate: string; source: string; asOf: string }>) =>
    setDraft((d) => ({ ...d, fx: { ...d.fx, [currency]: { ...(d.fx[currency] ?? { rate: "", source: "", asOf: "" }), ...patch } } }));
  const fxCurrencies = currenciesNeedingFx(draft);

  const calculate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/bid-workspace/cost-sheet`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(buildCostRequest(draft, lines.map((l) => l.lineNo))),
      });
      const json = (await res.json().catch(() => null)) as { view?: CostSheetView; readiness?: Readiness; error?: string } | null;
      if (res.status === 403) { setSheet(null); onReadiness(null); setError("需要财务查看权才能看成本核算。"); }
      else if (!res.ok || !json?.view) { setSheet(null); onReadiness(null); setError(json?.error ?? "计算失败"); }
      else { setSheet(json.view); onReadiness(json.readiness ?? null); }
    } catch { setError("计算失败"); }
    setBusy(false);
  };

  const exportDraft = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }));
    a.download = `cost-draft-${projectId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importDraft = async (file: File | undefined) => {
    if (!file) return;
    setDraft(parseCostDraft(await file.text()));
  };

  if (lines.length === 0) return null;
  return (
    <div className={CARD} data-testid="bw-cost">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Calculator size={16} className="text-accent/60" /> 成本核算</h3>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={BTN} onClick={exportDraft}>导出输入</button>
          <label className={`${BTN} cursor-pointer`}>导入输入<input type="file" accept="application/json" className="hidden" onChange={(e) => void importDraft(e.target.files?.[0])} /></label>
          <button type="button" className={BTN} onClick={() => { setDraft(emptyCostDraft()); setSheet(null); onReadiness(null); }}>清空</button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">成本输入只保存在这台设备的浏览器里，不会上传保存；换设备请先导出。核算结果须有财务查看权才能看。</p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead><tr>{["行", "说明", "采购", "报价", "报价方式", "币种", "证据", "关税率 %", "运费（加元）", "本地配送（加元）"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
          <tbody>
            {lines.map((l) => {
              const d = draft.lines[String(l.lineNo)] ?? emptyDraftLine();
              return (
                <tr key={l.lineNo}>
                  <td className={TD}>{l.lineNo}</td>
                  <td className={`${TD} max-w-[14rem] truncate`} title={l.description}>{l.description}</td>
                  <td className={TD}>
                    <select className={SELECT} value={d.sourcing} onChange={(e) => setLine(l.lineNo, { sourcing: e.target.value as CostDraftLine["sourcing"] })}>
                      <option value="IMPORT">进口</option><option value="DOMESTIC">本地</option>
                    </select>
                  </td>
                  <td className={TD}><input className={`${FIELD} w-20 text-right`} inputMode="decimal" value={d.unitPrice} onChange={(e) => setLine(l.lineNo, { unitPrice: e.target.value })} data-testid={`bw-cost-price-${l.lineNo}`} /></td>
                  <td className={TD}>
                    <select className={SELECT} value={d.basis} onChange={(e) => setLine(l.lineNo, { basis: e.target.value as CostDraftLine["basis"] })}>
                      <option value="PER_PIECE">按件</option><option value="PER_TENDER_UOM">按 {l.uom}</option>
                    </select>
                  </td>
                  <td className={TD}><input className={`${FIELD} w-14 uppercase`} value={d.currency} onChange={(e) => setLine(l.lineNo, { currency: e.target.value })} /></td>
                  <td className={TD}>
                    <select className={SELECT} value={d.evidenceKind} onChange={(e) => setLine(l.lineNo, { evidenceKind: e.target.value as CostDraftLine["evidenceKind"] })}>
                      <option value="SIGNED_QUOTE">已签报价</option><option value="PLATFORM_LISTED">平台标价</option><option value="RETAIL_PRICE">零售价</option><option value="ESTIMATE">估计</option>
                    </select>
                  </td>
                  <td className={TD}><input className={`${FIELD} w-16 text-right`} inputMode="decimal" disabled={d.sourcing === "DOMESTIC"} value={d.sourcing === "DOMESTIC" ? "" : d.dutyRatePct} onChange={(e) => setLine(l.lineNo, { dutyRatePct: e.target.value })} /></td>
                  <td className={TD}><input className={`${FIELD} w-20 text-right`} inputMode="decimal" value={d.freightCad} onChange={(e) => setLine(l.lineNo, { freightCad: e.target.value })} /></td>
                  <td className={TD}><input className={`${FIELD} w-20 text-right`} inputMode="decimal" value={d.localDeliveryCad} onChange={(e) => setLine(l.lineNo, { localDeliveryCad: e.target.value })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border/60 px-3 py-2">
          <p className="font-medium text-foreground">汇率（1 单位外币 = 多少加元；来源与日期必填）</p>
          {fxCurrencies.length === 0 ? <p className="text-muted">目前没有外币报价。</p> : fxCurrencies.map((c) => (
            <div key={c} className="flex flex-wrap items-center gap-2">
              <span className="w-10 font-medium">{c}</span>
              <input className={`${FIELD} w-24 text-right`} inputMode="decimal" placeholder="汇率" value={draft.fx[c]?.rate ?? ""} onChange={(e) => setFx(c, { rate: e.target.value })} data-testid={`bw-cost-fx-${c}`} />
              <input className={`${FIELD} w-28`} placeholder="来源" value={draft.fx[c]?.source ?? ""} onChange={(e) => setFx(c, { source: e.target.value })} />
              <input className={`${FIELD} w-32`} placeholder="日期 YYYY-MM-DD" value={draft.fx[c]?.asOf ?? ""} onChange={(e) => setFx(c, { asOf: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border border-border/60 px-3 py-2">
          <p className="font-medium text-foreground">税、定价与预备金</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">进口 GST %<input className={`${FIELD} w-14 text-right`} inputMode="decimal" value={draft.importGstRatePct} onChange={(e) => setDraft((d) => ({ ...d, importGstRatePct: e.target.value }))} /></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={draft.importGstItcEligible} onChange={(e) => setDraft((d) => ({ ...d, importGstItcEligible: e.target.checked }))} />可抵扣（只进现金流）</label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${FIELD} w-36`} value={draft.pricingMethod} onChange={(e) => setDraft((d) => ({ ...d, pricingMethod: e.target.value as CostDraft["pricingMethod"] }))}>
              <option value="MARGIN_ON_PRICE">按售价毛利率</option><option value="MARKUP_ON_COST">成本加成</option>
            </select>
            <label className="flex items-center gap-1">比率 %<input className={`${FIELD} w-14 text-right`} inputMode="decimal" value={draft.pricingRatePct} onChange={(e) => setDraft((d) => ({ ...d, pricingRatePct: e.target.value }))} /></label>
            <label className="flex items-center gap-1">按售价留预备金 %<input className={`${FIELD} w-14 text-right`} inputMode="decimal" value={draft.reserveOnSalePct} onChange={(e) => setDraft((d) => ({ ...d, reserveOnSalePct: e.target.value }))} /></label>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={calculate} data-testid="bw-cost-calc">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Calculator size={12} />} 计算
        </button>
        {error && <span className="text-xs text-red-700" data-testid="bw-cost-error">{error}</span>}
      </div>

      {sheet && <CostSheet sheet={sheet} />}
    </div>
  );
}

const SHEET_HEAD = ["行", "说明", "数量", "供应商报价 / 证据", "货值", "关税", "运费", "本地配送", "其它", "直接成本", "单位成本", "单位报价", "行合计", "利润", "毛利率"];

function CostSheet({ sheet }: { sheet: CostSheetView }) {
  const t = sheet.totals;
  // 核算表列多：单元格收窄、数字不换行，放不下时横向滚动
  const TD = "whitespace-nowrap border-b border-border/50 px-1 py-1 align-top";
  const TH = "whitespace-nowrap border-b border-border px-1 py-1 text-left font-medium text-muted";
  const num = `${TD} text-right tabular-nums`;
  return (
    <div className="mt-4 space-y-4" data-testid="bw-cost-sheet">
      <p className="text-xs text-muted">金额单位：加元。报价{t.taxNote}。</p>
      {sheet.groups.map((g) => (
        <div key={g.key} className="overflow-x-auto">
          <p className="mb-1 text-xs font-medium text-foreground">{g.labelZh}</p>
          <table className="w-full border-collapse text-[11px]">
            <thead><tr>{SHEET_HEAD.map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.lineNo}>
                  <td className={TD}>{r.lineNo}</td>
                  <td className={`${TD} max-w-[10.5rem]`} title={r.description}>
                    <span className="block truncate">{r.description}</span>
                    {r.marks.length > 0 && <span className="block whitespace-normal text-[10px] text-amber-800">{r.marks.join("；")}</span>}
                  </td>
                  <td className={TD}>{r.quantity}</td>
                  <td className={TD}>{r.quote}<span className="block text-[10px] text-muted">{r.evidence}</span></td>
                  <td className={num}>{r.goods}</td><td className={num}>{r.duty}</td><td className={num}>{r.freight}</td>
                  <td className={num}>{r.localDelivery}</td><td className={num}>{r.other}</td>
                  <td className={`${num} font-medium`}>{r.directCost}</td><td className={num}>{r.unitCost}</td>
                  <td className={`${num} font-medium`}>{r.unitBid}</td><td className={`${num} font-medium`}>{r.extended}</td>
                  <td className={num}>{r.profit}</td><td className={num}>{r.grossMarginPct}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className={TD} colSpan={4}>{g.labelZh}小计</td>
                <td className={num}>{g.subtotal.goods}</td><td className={num}>{g.subtotal.duty}</td><td className={num}>{g.subtotal.freight}</td>
                <td className={num}>{g.subtotal.localDelivery}</td><td className={num}>{g.subtotal.other}</td>
                <td className={num}>{g.subtotal.directCost}</td><td className={TD} /><td className={TD} />
                <td className={num}>{g.subtotal.extended}</td><td className={num}>{g.subtotal.profit}</td><td className={TD} />
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 px-3 py-2 text-xs" data-testid="bw-cost-totals">
          <p className="mb-1 font-medium text-foreground">合计</p>
          {[
            ["直接成本", t.directCost], [`报价（${t.taxNote}）`, t.bidExclHst], ["利润（扣按售价预备金后）", t.profit],
            ["毛利率（（价 − 成本）÷ 价）", t.grossMarginPct], ["加成率（（价 − 成本）÷ 成本）", t.markupPct], ["扣按售价预备金后的利润率", t.netMarginPct],
            ["预备金（按售价留）", t.reserveOnSale], ["预备金（计入成本）", t.reserveInCost], ["不可抵扣的进口环节税（已在成本内）", t.nonRecoverableTax], ["进口 GST 现金流（先垫付）", t.importGstCash],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-border/40 py-0.5 last:border-0"><span className="text-foreground/85">{k}</span><span className="tabular-nums font-medium">{v}</span></div>
          ))}
          {t.marks.length > 0 && <p className="mt-2 text-amber-800">标记：{t.marks.join("；")}</p>}
        </div>
        <div className="rounded-lg border border-border/60 px-3 py-2 text-xs">
          <p className="mb-1 font-medium text-foreground">阻断与提示</p>
          {sheet.blockers.length === 0 && sheet.notices.length === 0 ? <p className="text-muted">无。</p> : (
            <ul className="space-y-0.5">
              {sheet.blockers.map((b) => <li key={b.lineNo} className="text-red-700">第 {b.lineNo} 行（{b.description}）：{b.reasons.join("、")}</li>)}
              {sheet.notices.map((n) => <li key={n} className="text-amber-800">{n}</li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <p className="mb-1 text-xs font-medium text-foreground">假设与出处</p>
        <table className="w-full border-collapse text-xs">
          <thead><tr>{["项", "取值", "依据", "来源", "日期"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
          <tbody>
            {sheet.assumptions.map((a, i) => (
              <tr key={`${a.item}-${i}`}><td className={TD}>{a.item}</td><td className={TD}>{a.value}</td><td className={TD}>{a.basisKind}</td><td className={TD}>{a.sourceRef ?? "未提供"}</td><td className={TD}>{a.asOf ?? "未提供"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
