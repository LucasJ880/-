"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
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
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sanitizeHtml } from "@/lib/common/sanitize";

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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
  prefill?: QuestionPrefill;
}

const textareaClass =
  "flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:border-accent/30 disabled:cursor-not-allowed disabled:opacity-50";

// ── 组件 ──────────────────────────────────────────────────

export function ProjectQuestionDialog({
  projectId,
  open,
  onOpenChange,
  onSent,
  prefill,
}: Props) {
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

  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      setPhase("form");
      setError("");
      setQuestion(null);
      setEditSubject("");
      setEditBody("");
      setEditTo("");
      setEditCc("");
      setTitle("");
      setDescription("");
      setLocationRef("");
      setClarification("");
      setImpactNote("");
      setToRecipients("");
      setCcRecipients("");
    }
    if (!wasOpenRef.current && open) {
      setTitle(prefill?.title || "");
      setDescription(prefill?.description || "");
      setLocationRef(prefill?.locationOrReference || "");
      setClarification(prefill?.clarificationNeeded || "");
      setImpactNote(prefill?.impactNote || "");
      setToRecipients(prefill?.toRecipients || "");
      setCcRecipients("");
    }
    wasOpenRef.current = open;
  }, [open, prefill]);

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
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：2F 窗户尺寸与图纸不一致"
          />
        </Field>

        {/* Description */}
        <Field label="问题描述" required>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="详细描述发现的问题、现场情况与图纸的差异等"
            className={cn(textareaClass, "resize-none")}
          />
        </Field>

        {/* Location / Reference */}
        <Field label="涉及区域 / 图纸编号">
          <Input
            value={locationRef}
            onChange={(e) => setLocationRef(e.target.value)}
            placeholder="例：Drawing A2.1, Room 201, Window W-03"
          />
        </Field>

        {/* Clarification needed */}
        <Field label="希望业主确认的事项">
          <textarea
            value={clarification}
            onChange={(e) => setClarification(e.target.value)}
            rows={2}
            placeholder="例：请确认窗户开启方式为左开还是右开"
            className={cn(textareaClass, "resize-none")}
          />
        </Field>

        {/* Impact */}
        <Field label="潜在影响（可选）">
          <Input
            value={impactNote}
            onChange={(e) => setImpactNote(e.target.value)}
            placeholder="例：如不确认，可能影响生产排期和报价"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="收件人 (To)">
            <Input
              value={toRecipients}
              onChange={(e) => setToRecipients(e.target.value)}
              placeholder="owner@example.com"
            />
          </Field>
          <Field label="抄送 (Cc)">
            <Input
              value={ccRecipients}
              onChange={(e) => setCcRecipients(e.target.value)}
              placeholder="pm@example.com"
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
            <Input
              value={editTo}
              onChange={(e) => setEditTo(e.target.value)}
              readOnly={!isEditing}
              className={cn(!isEditing && "bg-muted/30")}
            />
          </Field>
          <Field label="抄送 (Cc)">
            <Input
              value={editCc}
              onChange={(e) => setEditCc(e.target.value)}
              readOnly={!isEditing}
              className={cn(!isEditing && "bg-muted/30")}
            />
          </Field>
        </div>

        {/* Subject */}
        <Field label="邮件主题">
          {isEditing ? (
            <Input
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
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
              className={cn(textareaClass, "resize-none font-mono text-[13px]")}
            />
          ) : (
            <div
              className="max-h-80 overflow-y-auto rounded-lg border border-border/60 bg-background px-4 py-3 text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(editBody) }}
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

  const headerDescription = {
    form: "填写问题信息与收件人，生成澄清邮件草稿。",
    generating: "正在根据你的描述生成正式澄清邮件。",
    preview: "确认收件人与正文后发送。",
    editing: "修改主题或正文后返回预览确认。",
    sending: "正在通过已绑定的邮箱发送。",
    sent: "邮件已成功发出。",
    error: "请检查表单或重试生成。",
  }[phase];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl",
          "[&>button]:text-muted [&>button]:hover:text-foreground"
        )}
      >
        <DialogHeader className="space-y-1 border-b border-border px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold leading-snug">
            <FileQuestion size={16} className="text-accent shrink-0" />
            {headerTitle}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {headerDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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

        {phase === "form" && (
          <div className="flex items-center justify-end border-t border-border px-5 py-3">
            <Button type="button" variant="accent" size="sm" onClick={generate}>
              <Mail className="h-3 w-3" />
              生成邮件草稿
            </Button>
          </div>
        )}

        {phase === "error" && (
          <div className="flex items-center justify-end border-t border-border px-5 py-3">
            <Button type="button" variant="outline" size="sm" onClick={generate}>
              <RefreshCw className="h-3 w-3" />
              重新生成
            </Button>
          </div>
        )}

        {(phase === "preview" || phase === "editing" || phase === "sending") && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setPhase("form");
                  setQuestion(null);
                }}
                disabled={phase === "sending"}
              >
                <RefreshCw className="h-3 w-3" />
                重新填写
              </Button>
              {phase !== "editing" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPhase("editing")}
                >
                  <Edit3 className="h-3 w-3" />
                  编辑
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPhase("preview")}
                >
                  预览
                </Button>
              )}
            </div>
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={handleSend}
              disabled={phase === "sending" || gmailConnected === false || !editTo.trim()}
            >
              {phase === "sending" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              {phase === "sending" ? "发送中…" : "确认发送"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
