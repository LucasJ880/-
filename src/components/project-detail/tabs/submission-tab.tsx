"use client";

/**
 * Tab 5「提交」— 提交就绪 / 提交记录 / Outcome（T1A）。
 * 复用既有能力：投标清单、分析交付物与任务、tender-result 标记 API、
 * 复盘卡、转执行 / 放弃（含既有 Dialog 与业务规则）。不新建第二套提交流程。
 */

import { useState } from "react";
import Link from "next/link";
import { Ban, CheckSquare, ClipboardList, Flag, Loader2, Send } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { BidChecklist } from "@/components/project-checklist/bid-checklist";
import { TenderAnalysisPanel } from "@/components/tender-analysis/analysis-panel";
import { ProjectReviewCard } from "@/components/project-review/project-review-card";
import { AbandonProjectDialog } from "@/components/tender/abandon-project-dialog";
import { HandoffDialog } from "@/components/projects/handoff-dialog";
import { getProjectStage } from "@/lib/tender/stage";
import { TENDER_STATUS_LABELS } from "@/lib/domain/labels";
import {
  buildTenderProps,
  type ProjectDetail,
  type ProjectHandoffInfo,
} from "@/components/project-detail/project-detail-types";
import { TENDER_RESULTS, type TenderResult } from "@/lib/projects/tender-result";

const RESULT_LABELS: Record<TenderResult, string> = {
  won: "中标",
  lost: "未中标",
  no_bid: "未投标",
  cancelled: "已取消",
};

function tenderStatusText(status: string | null | undefined): string {
  if (!status) return "未标记";
  return RESULT_LABELS[status as TenderResult] ?? TENDER_STATUS_LABELS[status] ?? status;
}

const ABANDON_STAGE_LABELS: Record<string, string> = {
  initiation: "立项",
  distribution: "项目分发",
  interpretation: "项目解读",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  submission: "项目提交",
};

interface SubmissionTabProps {
  projectId: string;
  project: ProjectDetail;
  canManage: boolean;
  handoffInfo: ProjectHandoffInfo | null;
  onReload: () => void;
  onReviewConfirmed: () => void;
}

export function SubmissionTab({
  projectId,
  project,
  canManage,
  handoffInfo,
  onReload,
  onReviewConfirmed,
}: SubmissionTabProps) {
  const [showAbandonDialog, setShowAbandonDialog] = useState(false);
  const [showHandoffDialog, setShowHandoffDialog] = useState(false);
  const stage = getProjectStage(buildTenderProps(project));
  const canAbandon =
    project.status !== "abandoned" &&
    canManage &&
    ["interpretation", "supplier_inquiry", "supplier_quote", "submission"].includes(stage);
  const canHandoff =
    project.status !== "abandoned" &&
    canManage &&
    project.tenderStatus === "won" &&
    handoffInfo?.status !== "completed";

  return (
    <div className="space-y-6">
      {/* 提交记录（真实字段投影；缺失显示「暂无」，不伪造） */}
      <section className="rounded-xl border border-border bg-card-bg p-5" data-testid="submission-status">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Send size={16} className="text-accent/60" />
          提交状态
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] text-muted">截标时间</dt>
            <dd className="mt-0.5 font-medium">
              {project.closeDate ? project.closeDate.slice(0, 10) : "暂无"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">提交时间</dt>
            <dd className="mt-0.5 font-medium">
              {project.submittedAt ? project.submittedAt.slice(0, 10) : "尚未提交"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">开标日</dt>
            <dd className="mt-0.5 font-medium">
              {project.openDate ? project.openDate.slice(0, 10) : "暂无"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">招标结果</dt>
            <dd className="mt-0.5 font-medium">{tenderStatusText(project.tenderStatus)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-muted">
          提交/开标日期在工作台「项目进度 · 关键日期」维护；最终标书文档在「标书与报价」生成，源文件见资料抽屉。
        </p>
      </section>

      {/* 提交就绪：投标清单 + 分析交付物与任务 */}
      <section className="rounded-xl border border-border bg-card-bg p-5 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <CheckSquare size={16} className="text-accent/60" />
          提交就绪
        </h3>
        <BidChecklist projectId={projectId} />
        <div className="rounded-lg border border-border/60 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted">
            <ClipboardList size={14} />
            交付物与跟进任务（来自招标文件分析）
          </h4>
          <TenderAnalysisPanel
            projectId={projectId}
            sections={["deliverables", "tasks"]}
            initialTab="deliverables"
            showRunControls={false}
            quietEmpty
          />
        </div>
      </section>

      {/* Outcome 区 */}
      <section className="rounded-xl border border-border bg-card-bg p-5 space-y-4" data-testid="submission-outcome">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Flag size={16} className="text-accent/60" />
          结果与后续
        </h3>

        {project.status === "abandoned" && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-danger-bg px-4 py-3">
            <Ban size={18} className="shrink-0 text-danger" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-danger">该项目已放弃</p>
              <p className="mt-0.5 text-xs text-muted">
                放弃阶段：{ABANDON_STAGE_LABELS[project.abandonedStage ?? ""] ?? project.abandonedStage ?? "未知"}
                {project.abandonedReason && ` · 原因：${project.abandonedReason}`}
              </p>
            </div>
          </div>
        )}

        {handoffInfo?.status === "completed" && handoffInfo.targetDeliveryProjectId ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">已转为执行项目</p>
              <p className="mt-0.5 text-xs text-muted">原投标项目保留不变，交付请在执行项目中跟进</p>
            </div>
            <Link
              href={`/ops/projects/${handoffInfo.targetDeliveryProjectId}`}
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)]"
            >
              打开执行项目
            </Link>
          </div>
        ) : null}

        {canManage && project.status !== "abandoned" ? (
          <TenderResultForm
            projectId={projectId}
            currentStatus={project.tenderStatus ?? null}
            currency={project.currency ?? null}
            onSaved={onReload}
          />
        ) : null}

        {(canHandoff || canAbandon) && (
          <div className="flex flex-wrap gap-2">
            {canHandoff ? (
              <button
                type="button"
                onClick={() => setShowHandoffDialog(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] shadow-sm"
              >
                转为执行项目
              </button>
            ) : null}
            {canAbandon ? (
              <button
                type="button"
                onClick={() => setShowAbandonDialog(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card-bg px-4 py-2 text-sm font-medium text-danger shadow-sm hover:bg-danger-bg transition-colors"
              >
                <Ban size={14} />
                放弃项目
              </button>
            ) : null}
          </div>
        )}

        <ProjectReviewCard projectId={projectId} onConfirmed={onReviewConfirmed} />
      </section>

      <HandoffDialog
        projectId={projectId}
        open={showHandoffDialog}
        onClose={() => {
          setShowHandoffDialog(false);
          onReload();
        }}
        tenderStatus={project.tenderStatus ?? null}
      />
      <AbandonProjectDialog
        open={showAbandonDialog}
        onOpenChange={setShowAbandonDialog}
        projectId={projectId}
        projectName={project.name}
        currentStage={stage}
        onSuccess={() => {
          setShowAbandonDialog(false);
          onReload();
        }}
      />
    </div>
  );
}

/**
 * 结果标记表单：调用既有 POST /api/projects/[id]/tender-result（写 tenderStatus 终态的唯一产品入口），
 * 成功后由服务端自动生成复盘草稿（人工确认前仅为 draft）。
 */
function TenderResultForm({
  projectId,
  currentStatus,
  currency,
  onSaved,
}: {
  projectId: string;
  currentStatus: string | null;
  currency: string | null;
  onSaved: () => void;
}) {
  const [result, setResult] = useState<TenderResult | "">("");
  const [ourBidPrice, setOurBidPrice] = useState("");
  const [winningBidPrice, setWinningBidPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tender-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result,
          ourBidPrice: ourBidPrice.trim() === "" ? undefined : ourBidPrice.trim(),
          winningBidPrice: winningBidPrice.trim() === "" ? undefined : winningBidPrice.trim(),
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "标记失败");
      setResult("");
      setOurBidPrice("");
      setWinningBidPrice("");
      setNote("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "标记失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-4" data-testid="tender-result-form">
      <p className="text-xs font-semibold text-muted">标记招标结果</p>
      <p className="mt-1 text-[11px] text-muted">
        当前：{tenderStatusText(currentStatus)}。标记后将自动生成复盘草稿，需人工确认后才会沉淀为企业经验。
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs space-y-1">
          <span>结果</span>
          <select
            value={result}
            onChange={(e) => setResult(e.target.value as TenderResult | "")}
            className="block rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">选择结果…</option>
            {TENDER_RESULTS.map((r) => (
              <option key={r} value={r}>{RESULT_LABELS[r]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs space-y-1">
          <span>我方报价{currency ? `（${currency}）` : ""}（可选）</span>
          <input
            value={ourBidPrice}
            onChange={(e) => setOurBidPrice(e.target.value)}
            inputMode="decimal"
            placeholder="例如 125000"
            className="block w-36 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs space-y-1">
          <span>中标价（可选）</span>
          <input
            value={winningBidPrice}
            onChange={(e) => setWinningBidPrice(e.target.value)}
            inputMode="decimal"
            placeholder="例如 118000"
            className="block w-36 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs space-y-1 flex-1 min-w-[180px]">
          <span>备注（可选）</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：价格差距过大"
            className="block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={busy || !result}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-[color:var(--on-accent)] disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : null}
          确认标记
        </button>
      </div>
      {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
