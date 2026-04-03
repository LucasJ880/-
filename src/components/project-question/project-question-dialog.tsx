"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Loader2,
  Send,
  RefreshCw,
  Edit3,
  AlertCircle,
  CheckCircle2,
  FileQuestion,
  Mail,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

// ── 类型 ──────────────────────────────────────────────────

interface QuestionData {
  id: string;
  generatedSubject: string | null;
  generatedBody: string | null;
  toRecipients: string | null;
  ccRecipients: string | null;
  status: string;
}

type Phase =
  | "form"
  | "generating"
  | "preview"
  | "editing"
  | "sending"
  | "sent"
  | "error";

export interface QuestionPrefill {
  title?: string;
  description?: string;
  locationOrReference?: string;
  clarificationNeeded?: string;
  impactNote?: string;
  toRecipients?: string;
}

interface Props {
  projectId: string;
  onClose: () => void;
  onSent?: () => void;
  prefill?: QuestionPrefill;
}

// ── 组件 ──────────────────────────────────────────────────

export function ProjectQuestionDialog({ projectId, onClose, onSent, prefill }: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");

  // Form fields
  const [title, setTitle] = useState(prefill?.title || "");
  const [description, setDescription] = useState(prefill?.description || "");
  const [locationRef, setLocationRef] = useState(prefill?.locationOrReference || "");
  const [clarification, setClarification] = useState(prefill?.clarificationNeeded || "");
  const [impactNote, setImpactNote] = useState(prefill?.impactNote || "");
  const [toRecipients, setToRecipients] = useState(prefill?.toRecipients || "");
  const [ccRecipients, setCcRecipients] = useState("");

  // Generated result
  const [question, setQuestion] = useState<QuestionData | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editTo, setEditTo] = useState("");
  const [editCc, setEditCc] = useState("");

  // Gmail status
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);

  useEffect(() => {
    apiFetch("/api/auth/google-email/status")
      .then((r) => r.json())
      .then((d) => setGmailConnected(d.connected))
      .catch(() => setGmailConnected(false));
  }, []);

  const generate = useCallback(async () => {
    if (!title.trim() || !description.trim()) {
      setError("问题标题和描述不能为空");
      return;
    }
    setPhase("generating");
    setError("");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          locationOrReference: locationRef.trim() || undefined,
          clarificationNeeded: clarification.trim() || undefined,
          impactNote: impactNote.trim() || undefined,
          toRecipients: toRecipients.trim() || undefined,
          ccRecipients: ccRecipients.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "生成失败");
      }
      const data: QuestionData = await res.json();
      setQuestion(data);
      setEditSubject(data.generatedSubject || "");
      setEditBody(data.generatedBody || "");
      setEditTo(data.toRecipients || toRecipients);
      setEditCc(data.ccRecipients || ccRecipients);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
      setPhase("error");
    }
  }, [projectId, title, description, locationRef, clarification, impactNote, toRecipients, ccRecipients]);

  async function handleSend() {
    if (!question) return;
    if (!editTo.trim()) {
      setError("收件人不能为空");
      return;
    }
    setPhase("sending");
    setError("");
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/questions/${question.id}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: editSubject,
            body: editBody,
            toRecipients: editTo.trim(),
            ccRecipients: editCc.trim() || undefined,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "发送失败");
      }
      setPhase("sent");
      setTimeout(() => onSent?.(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
      setPhase("error");
    }
  }

  // ── 表单阶段 ──────────────────────────────────────────────

  function renderForm() {
    return (
      <div className="space-y-4">
        {/* Title */}
        <Field label="问题标题" required>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：2F 窗户尺寸与图纸不一致"
            className="input-field"
          />
        </Field>

        {/* Description */}
        <Field label="问题描述" required>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="详细描述发现的问题、现场情况与图纸的差异等"
            className="input-field resize-none"
          />
        </Field>

        {/* Location / Reference */}
        <Field label="涉及区域 / 图纸编号">
          <input
            value={locationRef}
            onChange={(e) => setLocationRef(e.target.value)}
            placeholder="例：Drawing A2.1, Room 201, Window W-03"
            className="input-field"
          />
        </Field>

        {/* Clarification needed */}
        <Field label="希望业主确认的事项">
          <textarea
            value={clarification}
            onChange={(e) => setClarification(e.target.value)}
            rows={2}
            placeholder="例：请确认窗户开启方式为左开还是右开"
            className="input-field resize-none"
          />
        </Field>

        {/* Impact */}
        <Field label="潜在影响（可选）">
          <input
            value={impactNote}
            onChange={(e) => setImpactNote(e.target.value)}
            placeholder="例：如不确认，可能影响生产排期和报价"
            className="input-field"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="收件人 (To)">
            <input
              value={toRecipients}
              onChange={(e) => setToRecipients(e.target.value)}
              placeholder="owner@example.com"
              className="input-field"
            />
          </Field>
          <Field label="抄送 (Cc)">
            <input
              value={ccRecipients}
              onChange={(e) => setCcRecipients(e.target.value)}
              placeholder="pm@example.com"
              className="input-field"
            />
          </Field>
        </div>

        {error && (
          <p className="text-sm text-[#a63d3d]">{error}</p>
        )}
      </div>
    );
  }

  // ── 预览/编辑阶段 ────────────────────────────────────────

  function renderPreview() {
    const isEditing = phase === "editing";

    return (
      <div className="space-y-4">
        {/* Recipients */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="收件人 (To)">
            <input
              value={editTo}
              onChange={(e) => setEditTo(e.target.value)}
              className="input-field"
              readOnly={!isEditing}
            />
          </Field>
          <Field label="抄送 (Cc)">
            <input
              value={editCc}
              onChange={(e) => setEditCc(e.target.value)}
              className="input-field"
              readOnly={!isEditing}
            />
          </Field>
        </div>

        {/* Subject */}
        <Field label="邮件主题">
          {isEditing ? (
            <input
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              className="input-field"
            />
          ) : (
            <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm">
              {editSubject}
            </div>
          )}
        </Field>

        {/* Body */}
        <Field label="邮件正文">
          {isEditing ? (
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={14}
              className="input-field resize-none font-mono text-[13px]"
            />
          ) : (
            <div
              className="max-h-80 overflow-y-auto rounded-lg border border-border/60 bg-background px-4 py-3 text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: editBody }}
            />
          )}
        </Field>

        {gmailConnected === false && (
          <div className="flex items-center gap-2 rounded-lg border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] px-4 py-3 text-sm text-[#9a6a2f]">
            <AlertCircle size={16} />
            <div>
              你尚未绑定 Gmail 邮件服务。
              <a href="/settings" className="ml-1 font-medium underline">
                去设置页绑定
              </a>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── 渲染 ──────────────────────────────────────────────────

  const headerTitle = {
    form: "向业主提问",
    generating: "AI 正在生成邮件草稿…",
    preview: "审核邮件草稿",
    editing: "编辑邮件",
    sending: "发送中…",
    sent: "邮件已发送",
    error: "向业主提问",
  }[phase];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card-bg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <FileQuestion size={16} className="text-accent" />
            <h3 className="text-sm font-semibold">{headerTitle}</h3>
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
          {phase === "form" && renderForm()}

          {phase === "generating" && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 size={24} className="animate-spin text-accent" />
              <p className="text-sm text-muted">
                正在根据问题描述生成正式澄清邮件…
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-4 py-4">
              {renderForm()}
              <div className="flex items-center gap-2 rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
                <AlertCircle size={16} />
                {error}
              </div>
            </div>
          )}

          {(phase === "preview" || phase === "editing" || phase === "sending") &&
            renderPreview()}

          {phase === "sent" && (
            <div className="flex flex-col items-center gap-3 py-12">
              <CheckCircle2 size={32} className="text-[#2e7a56]" />
              <p className="text-sm font-medium text-[#2e7a56]">
                邮件已成功发送到 {editTo}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === "form" && (
          <div className="flex items-center justify-end border-t border-border px-5 py-3">
            <button
              type="button"
              onClick={generate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
            >
              <Mail size={12} />
              生成邮件草稿
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className="flex items-center justify-end border-t border-border px-5 py-3">
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

        {(phase === "preview" || phase === "editing" || phase === "sending") && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPhase("form");
                  setQuestion(null);
                }}
                disabled={phase === "sending"}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-background/80 disabled:opacity-50"
              >
                <RefreshCw size={12} />
                重新填写
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
              disabled={phase === "sending" || gmailConnected === false || !editTo.trim()}
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

      <style jsx>{`
        .input-field {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid var(--border);
          background: var(--background);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
        }
        .input-field:focus {
          border-color: var(--accent);
        }
        .input-field[readonly] {
          background: color-mix(in srgb, var(--background) 50%, transparent);
        }
      `}</style>
    </div>
  );
}

// ── Field wrapper ─────────────────────────────────────────

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">
        {label}
        {required && <span className="ml-0.5 text-[#a63d3d]">*</span>}
      </span>
      {children}
    </label>
  );
}
