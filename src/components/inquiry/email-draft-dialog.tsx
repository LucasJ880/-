"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  Loader2,
  X,
  Send,
  RefreshCw,
  Mail,
  AlertCircle,
  CheckCircle2,
  Edit3,
} from "lucide-react";

interface Props {
  projectId: string;
  inquiryId: string;
  itemId: string;
  supplierName: string;
  onClose: () => void;
  onSent: () => void;
}

interface DraftData {
  emailId: string;
  subject: string;
  body: string;
  toEmail: string;
  toName: string | null;
  supplierName: string;
}

type Phase = "generating" | "preview" | "editing" | "sending" | "sent" | "error";

export function EmailDraftDialog({
  projectId,
  inquiryId,
  itemId,
  supplierName,
  onClose,
  onSent,
}: Props) {
  const [phase, setPhase] = useState<Phase>("generating");
  const [draft, setDraft] = useState<DraftData | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [error, setError] = useState("");
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);

  const base = `/api/projects/${projectId}/inquiries/${inquiryId}/items/${itemId}/email`;

  useEffect(() => {
    apiFetch("/api/auth/google-email/status")
      .then((r) => r.json())
      .then((d) => setGmailConnected(d.connected))
      .catch(() => setGmailConnected(false));
  }, []);

  const generate = useCallback(async () => {
    setPhase("generating");
    setError("");
    try {
      const res = await apiFetch(`${base}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "生成失败");
      }
      const data: DraftData = await res.json();
      setDraft(data);
      setEditSubject(data.subject);
      setEditBody(data.body);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
      setPhase("error");
    }
  }, [base]);

  useEffect(() => {
    generate();
  }, [generate]);

  async function handleSend() {
    if (!draft) return;
    setPhase("sending");
    setError("");
    try {
      const res = await apiFetch(`${base}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId: draft.emailId,
          subject: editSubject,
          body: editBody,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "发送失败");
      }
      setPhase("sent");
      setTimeout(() => onSent(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
      setPhase("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card-bg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-accent" />
            <h3 className="text-sm font-semibold">
              {phase === "generating"
                ? "AI 正在生成邮件草稿…"
                : phase === "sent"
                  ? "邮件已发送"
                  : `发送邮件给「${supplierName}」`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === "generating" && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 size={24} className="animate-spin text-accent" />
              <p className="text-sm text-muted">
                正在根据项目和供应商信息生成询价邮件…
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-4 py-6">
              <div className="flex items-center gap-2 rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
                <AlertCircle size={16} />
                {error}
              </div>
              <button
                type="button"
                onClick={generate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-background/80"
              >
                <RefreshCw size={12} />
                重新生成
              </button>
            </div>
          )}

          {phase === "sent" && (
            <div className="flex flex-col items-center gap-3 py-12">
              <CheckCircle2 size={32} className="text-[#2e7a56]" />
              <p className="text-sm font-medium text-[#2e7a56]">
                邮件已成功发送到 {draft?.toEmail}
              </p>
            </div>
          )}

          {(phase === "preview" || phase === "editing" || phase === "sending") &&
            draft && (
              <div className="space-y-4">
                {/* Recipients */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted">收件人：</span>
                  <span className="font-medium">
                    {draft.toName ? `${draft.toName} ` : ""}
                    &lt;{draft.toEmail}&gt;
                  </span>
                </div>

                {/* Subject */}
                <div className="space-y-1">
                  <label className="text-xs text-muted">主题</label>
                  {phase === "editing" ? (
                    <input
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
                    />
                  ) : (
                    <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm">
                      {editSubject}
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="space-y-1">
                  <label className="text-xs text-muted">正文</label>
                  {phase === "editing" ? (
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={12}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent"
                    />
                  ) : (
                    <div
                      className="max-h-80 overflow-y-auto rounded-lg border border-border/60 bg-background/50 px-4 py-3 text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: editBody }}
                    />
                  )}
                </div>

                {/* Gmail binding warning */}
                {gmailConnected === false && (
                  <div className="flex items-center gap-2 rounded-lg border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] px-4 py-3 text-sm text-[#9a6a2f]">
                    <AlertCircle size={16} />
                    <div>
                      你尚未绑定 Gmail 邮件服务。
                      <a
                        href="/settings"
                        className="ml-1 font-medium underline"
                      >
                        去设置页绑定
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>

        {/* Footer actions */}
        {(phase === "preview" || phase === "editing" || phase === "sending") && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={generate}
                disabled={phase === "sending"}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-background/80 disabled:opacity-50"
              >
                <RefreshCw size={12} />
                重新生成
              </button>
              {phase !== "editing" ? (
                <button
                  type="button"
                  onClick={() => setPhase("editing")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-background/80"
                >
                  <Edit3 size={12} />
                  编辑
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPhase("preview")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-background/80"
                >
                  预览
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={phase === "sending" || gmailConnected === false}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {phase === "sending" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Send size={12} />
              )}
              {phase === "sending" ? "发送中…" : "确认发送"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
