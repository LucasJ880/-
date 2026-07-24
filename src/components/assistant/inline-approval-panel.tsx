"use client";

/**
 * Runtime V2 — 当前对话内联审批面板（调用既有 /api/ai/pending-actions/:id）
 */

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mail,
  ShieldAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { notifyPendingActionsChanged } from "@/lib/hooks/use-pending-approvals-badge";
import {
  isAssistantRunStatusDto,
  type AssistantRunStatusDto,
} from "@/lib/assistant/run-status-types";
import {
  defaultSelectedActionIds,
  draftTypeLabel,
  extractChangeSummary,
  extractTargetLabel,
  INLINE_ACTION_STATUS_LABEL,
  isEmailDraftType,
  needsCriticalConfirm,
  primaryConfirmLabel,
  riskLevelForAction,
  type InlinePendingAction,
} from "@/lib/assistant/inline-approval-model";

export type { InlinePendingAction };

type Props = {
  actions: InlinePendingAction[];
  runId?: string | null;
  onActionsChange: (next: InlinePendingAction[]) => void;
  onRunUpdate?: (run: AssistantRunStatusDto) => void;
  onScrollToPanel?: () => void;
  className?: string;
  /** 供 Sticky Bar 同步选中态 */
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  busyExternal?: boolean;
  onBusyChange?: (busy: boolean) => void;
};

export function InlineApprovalPanel({
  actions,
  runId,
  onActionsChange,
  onRunUpdate,
  className,
  selectedIds: controlledSelected,
  onSelectedIdsChange,
  busyExternal,
  onBusyChange,
}: Props) {
  const pending = useMemo(
    () => actions.filter((a) => a.status === "pending"),
    [actions],
  );
  const [internalSelected, setInternalSelected] = useState<string[]>([]);
  const selectedIds = controlledSelected ?? internalSelected;
  const setSelectedIds = (ids: string[]) => {
    if (onSelectedIdsChange) onSelectedIdsChange(ids);
    else setInternalSelected(ids);
  };

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState<string | null>(null);
  const [criticalOpen, setCriticalOpen] = useState(false);

  const isBusy = busyExternal || busy;

  useEffect(() => {
    // 刷新 / 新动作到达：默认勾选全部可安全审批的 pending
    const defaults = defaultSelectedActionIds(pending);
    setSelectedIds(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 pending id 集合变化时重置
  }, [pending.map((p) => p.actionId).join("|")]);

  if (actions.length === 0) return null;

  const allPendingSelected =
    pending.length > 0 && pending.every((p) => selectedIds.includes(p.actionId));

  const toggle = (id: string) => {
    if (isBusy) return;
    setSelectedIds(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  };

  const selectAll = () => setSelectedIds(pending.map((p) => p.actionId));
  const clearAll = () => setSelectedIds([]);

  const patchLocal = (
    id: string,
    patch: Partial<InlinePendingAction>,
  ) => {
    onActionsChange(
      actions.map((a) => (a.actionId === id ? { ...a, ...patch } : a)),
    );
  };

  const decideOne = async (
    action: InlinePendingAction,
    decision: "approve" | "reject",
  ) => {
    if (decision === "approve") {
      patchLocal(action.actionId, { status: "approved" });
      patchLocal(action.actionId, { status: "executing" });
    }
    const res = await apiFetch(`/api/ai/pending-actions/${action.actionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.run && isAssistantRunStatusDto(data.run)) {
      onRunUpdate?.(data.run);
    }
    if (!res.ok || data.ok === false) {
      patchLocal(action.actionId, {
        status: "failed",
        failureReason: data.error ?? "操作失败",
      });
      return false;
    }
    patchLocal(action.actionId, {
      status: decision === "approve" ? "executed" : "rejected",
    });
    return true;
  };

  const runBatch = async (decision: "approve" | "reject", ids: string[]) => {
    if (isBusy || ids.length === 0) return;
    const targets = actions.filter(
      (a) => ids.includes(a.actionId) && a.status === "pending",
    );
    if (targets.length === 0) return;

    if (decision === "approve" && needsCriticalConfirm(targets)) {
      setCriticalOpen(true);
      return;
    }

    setBusy(true);
    onBusyChange?.(true);
    setPhaseLabel(
      decision === "approve" ? "正在执行已确认动作…" : "正在拒绝所选动作…",
    );
    try {
      for (const action of targets) {
        await decideOne(action, decision);
      }
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      setPhaseLabel(null);
      notifyPendingActionsChanged();
      setSelectedIds([]);
    }
  };

  const selectedPendingCount = pending.filter((p) =>
    selectedIds.includes(p.actionId),
  ).length;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-amber-300/70 bg-amber-50/90 text-amber-950 shadow-xs",
        className,
      )}
      data-testid="inline-approval-panel"
      data-run-id={runId ?? undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/80 px-3 py-2.5 sm:px-3.5">
        <div>
          <p className="text-[13px] font-semibold tracking-tight">
            待你确认的动作
          </p>
          <p className="mt-0.5 text-[11px] text-amber-900/80">
            {pending.length > 0
              ? `${pending.length} 项可在本对话直接确认，无需离开当前任务`
              : "本轮动作已处理完毕"}
          </p>
        </div>
        {pending.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={selectAll}
              disabled={isBusy || allPendingSelected}
              className="rounded-md border border-amber-300/80 bg-white/70 px-2 py-1 font-medium disabled:opacity-40"
            >
              全选
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={isBusy || selectedIds.length === 0}
              className="rounded-md border border-amber-300/80 bg-white/70 px-2 py-1 font-medium disabled:opacity-40"
            >
              取消全选
            </button>
          </div>
        ) : null}
      </div>

      {phaseLabel ? (
        <div className="flex items-center gap-2 border-b border-amber-200/60 bg-white/50 px-3 py-2 text-[12px] text-[#2b6055] sm:px-3.5">
          <Loader2 size={14} className="animate-spin" />
          {phaseLabel}
        </div>
      ) : null}

      <ul className="divide-y divide-amber-200/60">
        {actions.map((action) => {
          const risk = riskLevelForAction(action);
          const change = extractChangeSummary(action);
          const target = extractTargetLabel(action);
          const open = expandedId === action.actionId;
          const canSelect = action.status === "pending";
          return (
            <li
              key={action.actionId}
              className="bg-white/40 px-3 py-2.5 sm:px-3.5"
              data-testid="inline-approval-item"
              data-action-id={action.actionId}
              data-status={action.status}
            >
              <div className="flex items-start gap-2.5">
                {canSelect ? (
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[#2b6055]"
                    checked={selectedIds.includes(action.actionId)}
                    disabled={isBusy}
                    onChange={() => toggle(action.actionId)}
                    aria-label={`选择 ${action.title}`}
                  />
                ) : (
                  <span className="mt-1 h-4 w-4" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[12px] font-semibold text-[#171a19]">
                      {draftTypeLabel(action.draftType)}
                    </span>
                    <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-[#4a524e]">
                      {INLINE_ACTION_STATUS_LABEL[action.status] ?? action.status}
                    </span>
                    <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-[#68706c]">
                      风险 {risk}
                    </span>
                    {isEmailDraftType(action.draftType) ? (
                      <span className="inline-flex items-center gap-1 rounded bg-[#edf3f1] px-1.5 py-0.5 text-[10px] font-medium text-[#2b6055]">
                        <Mail size={10} />
                        不会自动发送
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[13px] font-medium text-[#252927]">
                    {target}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-5 text-[#4a524e]">
                    {change.summary}
                  </p>
                  {(change.before || change.after) && (
                    <p className="mt-1 text-[11px] leading-4 text-[#68706c]">
                      {change.before != null ? (
                        <>
                          <span className="text-[#9aa19e]">前 </span>
                          {change.before}
                          <span className="mx-1.5 text-[#c5cac7]">→</span>
                        </>
                      ) : null}
                      {change.after != null ? (
                        <>
                          <span className="text-[#9aa19e]">后 </span>
                          {change.after}
                        </>
                      ) : null}
                    </p>
                  )}
                  {action.failureReason ? (
                    <p className="mt-1 text-[11px] text-[#a63d3d]">
                      {action.failureReason}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#2b6055]"
                    onClick={() =>
                      setExpandedId(open ? null : action.actionId)
                    }
                  >
                    {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {open ? "收起详情" : "查看详情"}
                  </button>
                  {open ? (
                    <div className="mt-1.5 rounded-lg border border-black/[0.06] bg-white/80 px-2.5 py-2 text-[11px] leading-5 text-[#4a524e]">
                      <p>标题：{action.title}</p>
                      <p>类型：{action.draftType}</p>
                      <p>预览：{action.preview}</p>
                      {isEmailDraftType(action.draftType) ? (
                        <p className="mt-1 font-medium text-[#2b6055]">
                          仅创建 Gmail 草稿，不会自动发送给客户。
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {pending.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-amber-200/80 bg-white/55 px-3 py-3 sm:flex-row sm:px-3.5">
          <button
            type="button"
            data-testid="inline-approve-selected"
            disabled={isBusy || selectedPendingCount === 0}
            onClick={() => void runBatch("approve", selectedIds)}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#2b6055] px-3 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {isBusy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Check size={15} />
            )}
            {isBusy ? "处理中…" : primaryConfirmLabel(selectedPendingCount)}
          </button>
          <button
            type="button"
            data-testid="inline-reject-selected"
            disabled={isBusy || selectedPendingCount === 0}
            onClick={() => void runBatch("reject", selectedIds)}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-[13px] font-medium text-[#4a524e] disabled:opacity-50"
          >
            <X size={15} />
            拒绝所选
          </button>
          <button
            type="button"
            data-testid="inline-reject-all"
            disabled={isBusy || pending.length === 0}
            onClick={() => void runBatch("reject", pending.map((p) => p.actionId))}
            className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-[13px] font-medium text-[#68706c] disabled:opacity-50 sm:px-4"
          >
            拒绝全部
          </button>
        </div>
      ) : null}

      {criticalOpen ? (
        <div className="border-t border-[rgba(166,61,61,0.25)] bg-[#fff7f7] px-3 py-3 sm:px-3.5">
          <div className="mb-2 flex items-start gap-2 text-[12px] text-[#a63d3d]">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <p>所选动作含 CRITICAL 风险，请再次确认后继续。</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg bg-[#a63d3d] text-[13px] font-semibold text-white"
              onClick={() => {
                setCriticalOpen(false);
                void (async () => {
                  setBusy(true);
                  onBusyChange?.(true);
                  setPhaseLabel("正在执行已确认动作…");
                  try {
                    for (const action of actions.filter(
                      (a) =>
                        selectedIds.includes(a.actionId) &&
                        a.status === "pending",
                    )) {
                      await decideOne(action, "approve");
                    }
                  } finally {
                    setBusy(false);
                    onBusyChange?.(false);
                    setPhaseLabel(null);
                    notifyPendingActionsChanged();
                    setSelectedIds([]);
                  }
                })();
              }}
            >
              确认高风险动作
            </button>
            <button
              type="button"
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg border border-black/10 bg-white text-[13px]"
              onClick={() => setCriticalOpen(false)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
