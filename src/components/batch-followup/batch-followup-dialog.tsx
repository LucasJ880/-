"use client";

import { useState } from "react";
import {
  X,
  Loader2,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Send,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { sanitizeHtml } from "@/lib/common/sanitize";

interface Draft {
  supplierId: string;
  supplierName: string;
  contactEmail: string;
  subject: string;
  body: string;
  daysSinceContact: number;
  inquiryItemId: string;
  inquiryId: string;
}

interface DraftError {
  supplierName: string;
  error: string;
}

interface Props {
  projectId: string;
  onClose: () => void;
  onSent?: () => void;
}

export function BatchFollowupDialog({ projectId, onClose, onSent }: Props) {
  const [step, setStep] = useState<"generating" | "review" | "sending" | "done">("generating");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [errors, setErrors] = useState<DraftError[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [sendResults, setSendResults] = useState<Array<{ name: string; ok: boolean; error?: string }>>([]);
  const [genError, setGenError] = useState("");

  useState(() => {
    apiFetch(`/api/projects/${projectId}/inquiries/batch-followup`, { method: "POST" })
      .then((r) => r.json())
      .then((res) => {
        if (res.error) {
          setGenError(res.error);
          setStep("review");
          return;
        }
        setDrafts(res.drafts ?? []);
        setErrors(res.errors ?? []);
        setSelected(new Set((res.drafts ?? []).map((d: Draft) => d.supplierId)));
        setStep("review");
      })
      .catch(() => {
        setGenError("生成失败，请重试");
        setStep("review");
      });
  });

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === drafts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(drafts.map((d) => d.supplierId)));
    }
  }

  async function sendAll() {
    const toSend = drafts.filter((d) => selected.has(d.supplierId));
    if (toSend.length === 0) return;
    setStep("sending");

    const results: Array<{ name: string; ok: boolean; error?: string }> = [];

    for (const draft of toSend) {
      try {
        const res = await apiFetch(
          `/api/projects/${projectId}/inquiries/${draft.inquiryId}/items/${draft.inquiryItemId}/email/send`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject: draft.subject,
              body: draft.body,
            }),
          }
        );
        const data = await res.json();
        results.push({
          name: draft.supplierName,
          ok: res.ok,
          error: data.error,
        });
      } catch {
        results.push({ name: draft.supplierName, ok: false, error: "网络错误" });
      }
    }

    setSendResults(results);
    setStep("done");
    if (results.some((r) => r.ok)) onSent?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-2xl rounded-xl border border-border bg-card-bg shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">批量催促供应商</h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {step === "generating" && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 size={28} className="animate-spin text-accent/50" />
              <p className="text-sm text-muted">AI 正在识别未回复供应商并生成催促邮件...</p>
              <p className="text-xs text-muted/60">这可能需要一会儿</p>
            </div>
          )}

          {step === "review" && genError && (
            <div className="rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
              {genError}
            </div>
          )}

          {step === "review" && !genError && drafts.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 size={24} className="text-accent/30" />
              <p className="text-sm font-medium text-muted">没有需要催促的供应商</p>
              <p className="text-xs text-muted/60">所有供应商均已在 3 天内联系过或已回复</p>
            </div>
          )}

          {step === "review" && drafts.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">
                  AI 为 <strong className="text-foreground">{drafts.length}</strong> 家供应商生成了催促邮件
                  {errors.length > 0 && (
                    <span className="text-[#a63d3d]">（{errors.length} 家生成失败）</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs text-accent hover:underline"
                >
                  {selected.size === drafts.length ? "取消全选" : "全选"}
                </button>
              </div>

              {drafts.map((draft) => {
                const isExpanded = expandedDraft === draft.supplierId;
                const isSelected = selected.has(draft.supplierId);

                return (
                  <div
                    key={draft.supplierId}
                    className={cn(
                      "rounded-lg border transition-colors",
                      isSelected ? "border-accent/30 bg-accent/5" : "border-border"
                    )}
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(draft.supplierId)}
                        className="h-4 w-4 rounded border-border accent-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{draft.supplierName}</span>
                          <span className="flex items-center gap-1 rounded-full bg-[rgba(154,106,47,0.1)] px-1.5 py-0.5 text-[10px] font-medium text-[#9a6a2f]">
                            <Clock size={9} />
                            {draft.daysSinceContact} 天未回复
                          </span>
                        </div>
                        <p className="text-xs text-muted">{draft.contactEmail}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedDraft(isExpanded ? null : draft.supplierId)}
                        className="text-muted hover:text-foreground"
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-border/60 px-4 py-3">
                        <p className="text-xs font-medium text-muted">主题</p>
                        <p className="mt-1 text-sm">{draft.subject}</p>
                        <p className="mt-3 text-xs font-medium text-muted">正文预览</p>
                        <div
                          className="mt-1 max-h-40 overflow-y-auto rounded-md bg-background p-3 text-xs leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(draft.body) }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {errors.length > 0 && (
                <div className="rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3">
                  <p className="text-xs font-medium text-[#a63d3d]">生成失败</p>
                  {errors.map((e, i) => (
                    <p key={i} className="mt-1 text-xs text-[#a63d3d]">
                      {e.supplierName}：{e.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "sending" && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 size={28} className="animate-spin text-accent/50" />
              <p className="text-sm text-muted">正在发送催促邮件...</p>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-3">
              <div className="flex flex-col items-center gap-2 py-4">
                <Sparkles size={24} className="text-accent" />
                <p className="text-sm font-semibold">批量催促完成</p>
              </div>
              {sendResults.map((r, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-4 py-2 text-sm",
                    r.ok ? "bg-[rgba(46,122,86,0.06)]" : "bg-[rgba(166,61,61,0.06)]"
                  )}
                >
                  {r.ok ? (
                    <CheckCircle2 size={14} className="text-[#2e7a56]" />
                  ) : (
                    <AlertTriangle size={14} className="text-[#a63d3d]" />
                  )}
                  <span>{r.name}</span>
                  {r.ok ? (
                    <span className="text-xs text-[#2e7a56]">已发送</span>
                  ) : (
                    <span className="text-xs text-[#a63d3d]">{r.error || "发送失败"}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          {step === "review" && drafts.length > 0 && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-foreground hover:bg-background/80"
              >
                取消
              </button>
              <button
                type="button"
                onClick={sendAll}
                disabled={selected.size === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                <Send size={12} />
                发送 {selected.size} 封催促邮件
              </button>
            </>
          )}
          {(step === "done" || (step === "review" && drafts.length === 0)) && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover"
            >
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
