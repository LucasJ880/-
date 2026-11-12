"use client";

/**
 * FLOW-H4b「提交」页签的交付前检查清单
 *
 * 清单由已确认的强制提交类要求确定性生成（接口现算），每条能回到原文；人逐条标「备好了 / 不适用」。
 * 系统不替人判断某一条是否真的备好了。接口 404（开关关闭、不是招投标项目）时什么都不渲染。
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  CHECKLIST_STATUS_ZH,
  checklistSummaryZh,
  type ChecklistItemStatus,
  type ChecklistLine,
  type SubmissionChecklistView,
} from "@/lib/tender-submission-checklist/contract";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }) : "暂无");

function Source({ line }: { line: ChecklistLine }) {
  return (
    <span className="text-[11px] text-muted">
      {line.requirementCode} · {line.categoryZh}
      {line.sourcePage ? ` · 第 ${line.sourcePage} 页` : " · 没有页码"}
    </span>
  );
}

/** 只管呈现：给什么画什么。标状态时调 onSet；busyKey 是正在保存的那一条 */
export function SubmissionChecklistBody({
  view,
  busyKey,
  error,
  onSet,
  onGoConfirm,
}: {
  view: SubmissionChecklistView;
  busyKey?: string | null;
  error?: string;
  onSet?: (key: string, status: ChecklistItemStatus) => void;
  /** 去确认要求（切到「招标要求」页签）；不给就不显示这个入口 */
  onGoConfirm?: () => void;
}) {
  const options: ChecklistItemStatus[] = ["DONE", "WAIVED", "PENDING"];
  return (
    <section className="rounded-xl border border-border bg-card-bg p-5" data-testid="submission-checklist">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ClipboardCheck size={16} className="text-accent/60" />
        交付前检查清单
      </h3>
      <p className="mt-1 text-sm" data-testid="submission-checklist-summary">{checklistSummaryZh(view)}</p>
      <p className="mt-1 text-[11px] text-muted">
        清单取自招标分析里已确认的强制提交类要求，每条可对照原文。状态由你来标，系统不会自己打勾。
        {view.hasAnalysis && !view.analysisApproved ? "这份分析还在等审核，批准前内容可能会变。" : ""}
      </p>
      {error ? <p role="alert" className="mt-2 text-sm text-danger-text" data-testid="submission-checklist-error">{error}</p> : null}

      {view.risks.length > 0 ? (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger-light p-3" data-testid="submission-checklist-risks">
          <p className="flex items-center gap-1.5 text-sm font-medium text-danger-text">
            <AlertTriangle size={14} />
            废标风险：{view.risks.length} 项强制要求当前判为不满足
          </p>
          <ul className="mt-2 space-y-1.5">
            {view.risks.map((r) => (
              <li key={`${r.key}:${r.requirementCode}`} className="text-sm">
                {r.textZh} <Source line={r} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.toPrepare.length > 0 ? (
        <ul className="mt-4 space-y-2" data-testid="submission-checklist-items">
          {view.toPrepare.map((item) => (
            <li key={`${item.key}:${item.requirementCode}`} className="rounded-lg border border-border px-3 py-2" data-item={item.key} data-status={item.status}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{item.textZh}</p>
                  {item.originalText && item.originalText !== item.textZh ? <p className="mt-0.5 text-xs text-muted">{item.originalText}</p> : null}
                  <Source line={item} />
                </div>
                {view.canEdit && item.tickable && onSet ? (
                  <div className="flex shrink-0 gap-1" role="group" aria-label={`${item.requirementCode} 的状态`}>
                    {options.map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={item.status === s}
                        disabled={busyKey === item.key || item.status === s}
                        onClick={() => onSet(item.key, s)}
                        data-testid={`submission-checklist-set-${s}`}
                        className={item.status === s ? "rounded-md bg-accent px-2 py-1 text-xs font-medium text-[color:var(--on-accent)]" : "rounded-md border border-border px-2 py-1 text-xs hover:bg-background"}
                      >
                        {CHECKLIST_STATUS_ZH[s]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="shrink-0 text-xs text-muted" data-testid="submission-checklist-status">
                    {CHECKLIST_STATUS_ZH[item.status]}
                    {!item.tickable ? "（与上一条编号相近，请在上一条上标）" : ""}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {view.unconfirmed.length > 0 ? (
        <div className="mt-4" data-testid="submission-checklist-unconfirmed">
          <p className="text-xs font-medium text-muted">
            还没确认的 {view.unconfirmed.length} 项（模型抽出来的，还没人看过；确认之后才进上面的清单）
            {onGoConfirm ? (
              <button type="button" onClick={onGoConfirm} className="ml-2 text-accent underline-offset-2 hover:underline">
                去确认
              </button>
            ) : null}
          </p>
          <ul className="mt-1.5 space-y-1">
            {view.unconfirmed.map((u) => (
              <li key={`${u.key}:${u.requirementCode}`} className="text-sm text-muted">
                {u.textZh} <Source line={u} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.hasAnalysis ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2" data-testid="submission-checklist-conditions">
          <div>
            <dt className="text-[11px] text-muted">截标时间（项目上填的）</dt>
            <dd className="mt-0.5 font-medium">{day(view.closesAt)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">提问截止（项目上填的）</dt>
            <dd className="mt-0.5 font-medium">{day(view.questionCloseAt)}</dd>
          </div>
          {view.conditions.map((c) => (
            <div key={c.slot}>
              <dt className="text-[11px] text-muted">{c.labelZh}</dt>
              <dd className={c.found ? "mt-0.5" : "mt-0.5 text-muted"}>{c.textZh}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

export function SubmissionChecklistCard({
  projectId,
  onAvailable,
  onGoConfirm,
}: {
  projectId: string;
  /** 接口可用（开关开着）时告诉上层：这时不再显示模型生成的那份清单 */
  onAvailable?: (available: boolean) => void;
  onGoConfirm?: () => void;
}) {
  const [view, setView] = useState<SubmissionChecklistView | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/submission-checklist`);
      const data = res.ok ? ((await res.json().catch(() => null)) as { view?: SubmissionChecklistView } | null) : null;
      setView(data?.view ?? null);
      onAvailable?.(!!data?.view);
    } catch {
      setView(null);
      onAvailable?.(false);
    }
  }, [projectId, onAvailable]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return null;

  const onSet = async (key: string, status: ChecklistItemStatus) => {
    setBusyKey(key);
    setError("");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/submission-checklist/items/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => null)) as { view?: SubmissionChecklistView; error?: string } | null;
      if (!res.ok || !data?.view) {
        setError(data?.error || "没有保存成功，请稍后再试");
        // 清单可能刚变了（比如这条要求被驳回）：重新取一次
        void load();
        return;
      }
      setView(data.view);
    } catch {
      setError("没有保存成功，请检查网络后再试");
    } finally {
      setBusyKey(null);
    }
  };

  return <SubmissionChecklistBody view={view} busyKey={busyKey} error={error} onSet={(k, s) => void onSet(k, s)} onGoConfirm={onGoConfirm} />;
}
