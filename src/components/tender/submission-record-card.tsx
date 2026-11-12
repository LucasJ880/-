"use client";

/**
 * FLOW-H4a「提交」页签的提交记录
 *
 * 人在门户或线下交完标之后，在这里记下实际提交的时间、方式、回执编号。青砚不代为提交。
 * 接口 404（开关关闭、不是招投标项目）时什么都不渲染——页面与没有本功能时相同。
 */
import { useCallback, useEffect, useState } from "react";
import { FileCheck2, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  RECEIPT_REF_MAX,
  SUBMISSION_CHANNELS,
  SUBMISSION_CHANNEL_ZH,
  SUBMISSION_KIND_ZH,
  SUBMISSION_NOTE_MAX,
  confirmTextZh,
  fromDatetimeLocal,
  openButtonZh,
  parseSubmissionInput,
  statusLineZh,
  toDatetimeLocal,
  type SubmissionChannel,
  type SubmissionRecordView,
} from "@/lib/tender-submission/contract";
import { NEXT_STEP_ANCHORS } from "@/lib/tender-next-step/targets";

type Step = "closed" | "form" | "confirm";

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export function SubmissionRecordCard({
  projectId,
  onAvailable,
  onRecorded,
}: {
  projectId: string;
  /** 接口可用（开关开着）时告诉上层，好把页面上别处过时的提示换掉 */
  onAvailable?: (available: boolean) => void;
  /** 记录成功之后（项目的提交时间与阶段变了，上层重新载入项目） */
  onRecorded?: () => void;
}) {
  const [view, setView] = useState<SubmissionRecordView | null>(null);
  const [step, setStep] = useState<Step>("closed");
  const [when, setWhen] = useState("");
  const [channel, setChannel] = useState<SubmissionChannel>("portal");
  const [receiptRef, setReceiptRef] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/submission-record`);
      const data = res.ok ? ((await res.json().catch(() => null)) as { view?: SubmissionRecordView } | null) : null;
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

  const tz = new Date().getTimezoneOffset();
  const kind = view.nextKind;
  const openForm = () => {
    // 更正时带出现有的值；第一次记录默认填现在
    setWhen(toDatetimeLocal(view.submittedAt ? new Date(view.submittedAt) : new Date(), tz));
    setChannel(view.record?.channel ?? "portal");
    setReceiptRef(view.record?.receiptRef ?? "");
    setNote("");
    setError("");
    setStep("form");
  };
  const submittedIso = fromDatetimeLocal(when, tz);
  // 点「保存」时先用与接口相同的规则校验一遍：不对就留在表单里说明原因，不进确认那一步
  const toConfirm = () => {
    const checked = parseSubmissionInput({ submittedAt: submittedIso, channel, receiptRef, note }, new Date());
    if (!checked.ok) {
      setError(checked.errors.join("；"));
      return;
    }
    setError("");
    setStep("confirm");
  };
  const save = async () => {
    if (!submittedIso) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/submission-record`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submittedAt: submittedIso, channel, receiptRef, note }),
      });
      const data = (await res.json().catch(() => null)) as { view?: SubmissionRecordView; error?: string } | null;
      if (!res.ok || !data?.view) {
        setError(data?.error || "没有保存成功，请稍后再试");
        setStep("form");
        return;
      }
      setView(data.view);
      setStep("closed");
      onRecorded?.();
    } catch {
      setError("没有保存成功，请检查网络后再试");
      setStep("form");
    } finally {
      setSaving(false);
    }
  };

  const input = "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
  return (
    <section id={NEXT_STEP_ANCHORS.submissionRecord} className="scroll-mt-4 rounded-xl border border-border bg-card-bg p-5" data-testid="submission-record">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <FileCheck2 size={16} className="text-accent/60" />
            提交记录
          </h3>
          <p className="mt-1 text-sm" data-testid="submission-record-status">{statusLineZh(view)}</p>
        </div>
        {view.canRecord && kind && step === "closed" ? (
          <button type="button" onClick={openForm} data-testid="submission-record-open" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent)] hover:opacity-90">
            {openButtonZh(kind)}
          </button>
        ) : null}
      </div>

      {view.submittedAt ? (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="submission-record-detail">
          <div>
            <dt className="text-[11px] text-muted">实际提交时间</dt>
            <dd className="mt-0.5 font-medium">{fmt(view.submittedAt)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">提交方式</dt>
            <dd className="mt-0.5 font-medium">{view.record ? SUBMISSION_CHANNEL_ZH[view.record.channel] : "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">回执编号（记录人填写）</dt>
            <dd className="mt-0.5 break-all font-medium">{view.record?.receiptRef ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">记录人 · 记录时间</dt>
            <dd className="mt-0.5 font-medium">{view.record ? `${view.record.recordedByName ?? "—"} · ${fmt(view.record.recordedAt)}` : "—"}</dd>
          </div>
          {view.record?.note ? (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-[11px] text-muted">备注</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{view.record.note}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {view.blockedZh ? <p className="mt-3 text-xs text-muted">{view.blockedZh}</p> : null}
      {!view.canRecord && !view.blockedZh ? <p className="mt-3 text-xs text-muted">记录与更正需要项目负责人、项目管理员或组织管理员来做。</p> : null}

      {step !== "closed" && kind ? (
        <div className="mt-4 rounded-lg border border-border bg-background/60 p-4" data-testid="submission-record-form">
          <p className="text-xs text-muted">
            {SUBMISSION_KIND_ZH[kind]}：这里只记录你已经交完的标，青砚不会替你向任何门户或邮箱提交。不要写金额。
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">
              实际提交的时间
              <input type="datetime-local" value={when} max={toDatetimeLocal(new Date(), tz)} onChange={(e) => setWhen(e.target.value)} disabled={step === "confirm"} className={input} data-testid="submission-record-when" />
            </label>
            <label className="text-xs text-muted">
              提交方式
              <select value={channel} onChange={(e) => setChannel(e.target.value as SubmissionChannel)} disabled={step === "confirm"} className={input} data-testid="submission-record-channel">
                {SUBMISSION_CHANNELS.map((c) => (
                  <option key={c} value={c}>{SUBMISSION_CHANNEL_ZH[c]}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              回执编号（门户确认页或邮件里的编号；没有可以不填）
              <input type="text" value={receiptRef} maxLength={RECEIPT_REF_MAX} onChange={(e) => setReceiptRef(e.target.value)} disabled={step === "confirm"} className={input} data-testid="submission-record-receipt" />
            </label>
            <label className="text-xs text-muted">
              备注（可不填）
              <textarea value={note} maxLength={SUBMISSION_NOTE_MAX} rows={2} onChange={(e) => setNote(e.target.value)} disabled={step === "confirm"} className={input} data-testid="submission-record-note" />
            </label>
          </div>
          {error ? <p className="mt-3 text-sm text-danger-text" data-testid="submission-record-error">{error}</p> : null}
          {step === "form" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={toConfirm} disabled={!submittedIso} data-testid="submission-record-next" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent)] hover:opacity-90 disabled:opacity-50">
                保存
              </button>
              <button type="button" onClick={() => setStep("closed")} className="rounded-lg border border-border px-3 py-1.5 text-sm">
                取消
              </button>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-warning/40 bg-warning-light p-3" data-testid="submission-record-confirm">
              <p className="text-sm text-warning-text">{confirmTextZh(kind)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void save()} disabled={saving} data-testid="submission-record-save" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent)] hover:opacity-90 disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  确认保存
                </button>
                <button type="button" onClick={() => setStep("form")} disabled={saving} className="rounded-lg border border-border px-3 py-1.5 text-sm">
                  返回修改
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
