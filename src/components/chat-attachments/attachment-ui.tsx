"use client";

/**
 * AI 对话附件 — 公共 UI 片段
 * - AttachButton：回形针按钮 + 隐藏的文件选择框
 * - PendingAttachmentChips：待发送芯片（解析中 / 字符数 / 错误 / 缩略图 / 移除）
 * - MessageAttachments：消息气泡里的附件（图片缩略图 + 名称芯片）
 * - DropOverlay：拖入时的遮罩
 */

import { useRef, type ReactNode } from "react";
import { FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ATTACH_ACCEPT,
  ATTACH_HINT,
  formatBytes,
  formatChars,
  type AttachmentSummary,
  type PendingAttachment,
} from "./types";

export { ATTACH_ACCEPT, ATTACH_HINT } from "./types";

export function AttachButton({
  onFiles,
  disabled,
  className,
  title = "上传附件（文档或图片）让 AI 分析",
  size = 16,
  testId = "chat-file-input",
  children,
}: {
  onFiles: (files: FileList | null) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  size?: number;
  testId?: string;
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACH_ACCEPT}
        className="hidden"
        data-testid={testId}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title={title}
        aria-label="上传附件"
        className={className}
      >
        {children ?? <Paperclip size={size} />}
      </button>
    </>
  );
}

export function PendingAttachmentChips({
  pending,
  notice,
  onRemove,
  className,
}: {
  pending: PendingAttachment[];
  notice?: string | null;
  onRemove: (id: string) => void;
  className?: string;
}) {
  if (pending.length === 0 && !notice) return null;
  return (
    <div className={cn("mb-2", className)}>
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="pending-attachments">
          {pending.map((p) => (
            <div
              key={p.id}
              className={cn(
                "flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]",
                p.status === "error"
                  ? "border-red-500/40 text-red-400"
                  : "border-border/60 bg-background text-foreground",
              )}
            >
              {p.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.previewUrl} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
              ) : p.status === "parsing" ? (
                <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
              ) : p.kind === "image" ? (
                <ImageIcon size={12} className={cn("shrink-0", p.status === "ready" && "text-accent")} />
              ) : (
                <FileText size={12} className={cn("shrink-0", p.status === "ready" && "text-accent")} />
              )}
              <span className="max-w-[200px] truncate" title={p.name}>{p.name}</span>
              <span className={cn("shrink-0", p.status === "error" ? "" : "text-muted")}>
                {p.status === "parsing"
                  ? (p.kind === "image" ? "识别中…" : "解析中…")
                  : p.status === "error"
                    ? p.error
                    : `${formatBytes(p.size)} · ${formatChars(p.text?.length ?? 0)}`}
              </span>
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                className="shrink-0 rounded p-0.5 text-muted transition hover:text-foreground"
                aria-label={`移除附件 ${p.name}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {notice && <p className="mt-1 text-[11px] text-amber-500">{notice}</p>}
    </div>
  );
}

/** 消息气泡里的附件。tone=onAccent 用于深色（用户）气泡，onSurface 用于浅色气泡 */
export function MessageAttachments({
  attachments,
  tone = "onSurface",
  className,
}: {
  attachments?: AttachmentSummary[] | null;
  tone?: "onAccent" | "onSurface";
  className?: string;
}) {
  if (!attachments || attachments.length === 0) return null;
  const images = attachments.filter((a) => a.kind === "image" && a.fileUrl);
  const chipClass =
    tone === "onAccent"
      ? "bg-white/15 text-inherit"
      : "border border-border/60 bg-background text-foreground";
  const chipMeta = tone === "onAccent" ? "opacity-70" : "text-muted";
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a, j) => (
            <a
              key={`${a.fileUrl}-${j}`}
              href={a.fileUrl}
              target="_blank"
              rel="noreferrer"
              title={`${a.name}（点击查看原图）`}
              className={cn(
                "block overflow-hidden rounded-lg",
                tone === "onAccent" ? "border border-white/20 bg-white/10" : "border border-border/60 bg-background",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.fileUrl} alt={a.name} className="h-24 max-w-[220px] object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {attachments.map((a, j) => (
          <span
            key={`${a.name}-${j}`}
            title={`${a.name}${a.size ? ` · ${formatBytes(a.size)}` : ""} · ${formatChars(a.textLength)}`}
            className={cn("inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 text-[11px]", chipClass)}
          >
            {a.kind === "image" ? <ImageIcon size={12} className="shrink-0" /> : <FileText size={12} className="shrink-0" />}
            <span className="truncate">{a.name}</span>
            <span className={cn("shrink-0", chipMeta)}>{formatChars(a.textLength)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function DropOverlay({ active, className }: { active: boolean; className?: string }) {
  if (!active) return null;
  return (
    <div className={cn("absolute inset-0 z-30 flex items-center justify-center bg-card-bg/85 px-5 backdrop-blur-sm", className)}>
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed border-accent/40 bg-card-bg px-8 py-10">
        <Paperclip size={28} className="text-accent" />
        <p className="text-sm font-medium text-accent">松开以添加附件</p>
        <p className="text-xs text-muted">{ATTACH_HINT}</p>
      </div>
    </div>
  );
}
