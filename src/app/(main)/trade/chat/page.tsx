"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Loader2,
  Send,
  MessageCircle,
  Trash2,
  Sparkles,
  Paperclip,
  FileText,
  Image as ImageIcon,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { useRouter } from "next/navigation";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: { content: string; createdAt: string }[];
}

/** 服务端回给浏览器的附件摘要（不带正文） */
type AttachmentKind = "document" | "image";

interface AttachmentSummary {
  name: string;
  kind?: AttachmentKind;
  size: number;
  textLength: number;
}

interface Message {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: AttachmentSummary[];
}

/** 输入框里待发送的附件：先经 /api/ai/upload-file 解析成文本 */
interface PendingAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  size: number;
  status: "parsing" | "ready" | "error";
  text?: string;
  error?: string;
  /** 图片的本地预览（object URL，发送/移除时释放） */
  previewUrl?: string;
}

const DOC_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const ATTACH_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp";
const ATTACH_MAX_FILES = 5;
const DOC_MAX_BYTES = 10 * 1024 * 1024; // 与 /api/ai/upload-file 上限一致
const IMAGE_MAX_BYTES = 6 * 1024 * 1024; // 与 /api/ai/upload-image 上限一致
const ATTACH_HINT = "支持 PDF、Word、Excel、CSV、TXT 和 PNG/JPG/WebP 图片";
const EXT_BY_IMAGE_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** 粘贴的截图有时没有扩展名（或叫 image.png）——按 MIME 补一个，服务端按扩展名校验 */
function ensureImageFileName(file: File): File {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.name.includes(".") && IMAGE_EXTENSIONS.has(ext)) return file;
  const fallbackExt = EXT_BY_IMAGE_MIME[file.type] ?? "png";
  const base = file.name && file.name !== "image" ? file.name.replace(/\.[^.]*$/, "") : "截图";
  return new File([file], `${base}.${fallbackExt}`, { type: file.type });
}

const QUICK_COMMANDS = [
  { label: "总览", text: "给我看一下外贸业务总览" },
  { label: "待跟进", text: "有哪些线索需要跟进？" },
  { label: "建议", text: "给我一些下一步行动建议" },
  { label: "活动列表", text: "列出所有获客活动" },
  { label: "列待研究", text: "请列出阶段为 new 的外贸线索，每条给出 prospectId、公司名、国家、所属活动名" },
  { label: "报价统计", text: "目前报价单情况怎么样？" },
  { label: "高分线索", text: "评分最高的线索有哪些？" },
];

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatChars(n: number): string {
  if (n < 1000) return `${n} 字符`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k 字符`;
}

export default function TradeChatPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const draftAppliedRef = useRef(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** pending 的同步镜像：连续拖入/粘贴时上限判断不等下一次渲染 */
  const pendingRef = useRef<PendingAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /** 线索详情「对话里研究」等入口：/trade/chat?draft=... */
  useEffect(() => {
    if (typeof window === "undefined" || draftAppliedRef.current) return;
    const raw = new URLSearchParams(window.location.search).get("draft");
    if (!raw?.trim()) return;
    draftAppliedRef.current = true;
    try {
      setInput(decodeURIComponent(raw));
    } catch {
      setInput(raw);
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!attachNotice) return;
    const t = setTimeout(() => setAttachNotice(null), 4000);
    return () => clearTimeout(t);
  }, [attachNotice]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const loadSessions = useCallback(async () => {
    if (!orgId || ambiguous) {
      setSessions([]);
      setLoadingSessions(false);
      return;
    }
    const res = await apiFetch(`/api/trade/chat?orgId=${encodeURIComponent(orgId)}`);
    if (res.ok) setSessions(await res.json());
    else setSessions([]);
    setLoadingSessions(false);
  }, [orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    void loadSessions();
  }, [loadSessions, orgLoading]);

  const loadSession = async (sessionId: string) => {
    if (!orgId || ambiguous) return;
    setActiveId(sessionId);
    const res = await apiFetch(`/api/trade/chat/${sessionId}?orgId=${encodeURIComponent(orgId)}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(
        data.messages.map((m: Message) => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments?.length ? m.attachments : undefined,
        })),
      );
    }
  };

  const createSession = async () => {
    if (!orgId || ambiguous) return;
    const res = await apiFetch("/api/trade/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    if (res.ok) {
      const session = await res.json();
      setActiveId(session.id);
      setMessages([]);
      loadSessions();
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!orgId || ambiguous) return;
    await apiFetch(`/api/trade/chat/${sessionId}?orgId=${encodeURIComponent(orgId)}`, { method: "DELETE" });
    if (activeId === sessionId) {
      setActiveId(null);
      setMessages([]);
    }
    loadSessions();
  };

  // ── 附件：选择/拖入/粘贴 → 解析成文本 ─────────────────────────

  const updatePending = (id: string, patch: Partial<PendingAttachment>) => {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const parseFile = async (id: string, file: File, kind: AttachmentKind) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const endpoint = kind === "image" ? "/api/ai/upload-image" : "/api/ai/upload-file";
      const res = await apiFetch(endpoint, { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        updatePending(id, { status: "error", error: data.error || (kind === "image" ? "识别失败" : "解析失败") });
        return;
      }
      const text = typeof data.text === "string" ? data.text : "";
      if (!text.trim()) {
        updatePending(id, {
          status: "error",
          error: kind === "image" ? "图片里没有识别出可用内容" : "没有可提取的文字（扫描件请先转成文字或直接传图片）",
        });
        return;
      }
      updatePending(id, { status: "ready", text });
    } catch {
      updatePending(id, { status: "error", error: "网络错误，请重试" });
    }
  };

  // 注意：解析请求等副作用放在 setState 更新函数之外——
  // React 开发模式（StrictMode）会把更新函数调用两次，放在里面会重复上传。
  const addFiles = (files: FileList | File[] | null | undefined) => {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files);
    const current = pendingRef.current;
    const slots = ATTACH_MAX_FILES - current.filter((p) => p.status !== "error").length;
    if (slots <= 0) {
      setAttachNotice(`一条消息最多附 ${ATTACH_MAX_FILES} 个文件`);
      return;
    }
    const accepted = incoming.slice(0, slots);
    if (accepted.length < incoming.length) {
      setAttachNotice(`一条消息最多附 ${ATTACH_MAX_FILES} 个文件，已忽略多余的 ${incoming.length - accepted.length} 个`);
    }
    const toParse: { id: string; file: File; kind: AttachmentKind }[] = [];
    const added: PendingAttachment[] = accepted.map((raw) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const isImage = raw.type.startsWith("image/") || IMAGE_EXTENSIONS.has(raw.name.split(".").pop()?.toLowerCase() ?? "");
      const file = isImage ? ensureImageFileName(raw) : raw;
      const kind: AttachmentKind = isImage ? "image" : "document";
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (isImage ? !IMAGE_EXTENSIONS.has(ext) : !DOC_EXTENSIONS.has(ext)) {
        return { id, kind, name: file.name, size: file.size, status: "error", error: `不支持的格式（${ATTACH_HINT}）` };
      }
      const maxBytes = isImage ? IMAGE_MAX_BYTES : DOC_MAX_BYTES;
      if (file.size > maxBytes) {
        return { id, kind, name: file.name, size: file.size, status: "error", error: `文件过大（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）` };
      }
      toParse.push({ id, file, kind });
      return {
        id,
        kind,
        name: file.name,
        size: file.size,
        status: "parsing",
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      };
    });
    pendingRef.current = [...current, ...added];
    setPending((prev) => [...prev, ...added]);
    for (const { id, file, kind } of toParse) void parseFile(id, file, kind);
  };

  const removePending = (id: string) => {
    const target = pendingRef.current.find((p) => p.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    setPending((prev) => prev.filter((p) => p.id !== id));
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const readyAttachments = pending.filter((p) => p.status === "ready");
  const parsingCount = pending.filter((p) => p.status === "parsing").length;
  const canSend = !sending && parsingCount === 0 && (input.trim().length > 0 || readyAttachments.length > 0);

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim();
    const attachments = readyAttachments.map((p) => ({ name: p.name, kind: p.kind, size: p.size, text: p.text ?? "" }));
    if (sending || !orgId || ambiguous) return;
    if (!content && attachments.length === 0) return;
    if (parsingCount > 0) {
      setAttachNotice("附件还在解析，稍等一下再发送");
      return;
    }

    let sessionId = activeId;

    if (!sessionId) {
      const res = await apiFetch("/api/trade/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) return;
      const session = await res.json();
      sessionId = session.id;
      setActiveId(sessionId);
    }

    setInput("");
    for (const p of pendingRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    setPending([]);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content,
        attachments: attachments.length
          ? attachments.map((a) => ({ name: a.name, kind: a.kind, size: a.size, textLength: a.text.length }))
          : undefined,
      },
    ]);
    setSending(true);

    try {
      const res = await apiFetch(`/api/trade/chat/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, orgId, attachments }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: "assistant", content: data.assistantMessage.content }]);
      } else {
        const data = await res.json().catch(() => ({}));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data?.error ? `请求失败：${data.error}` : "请求失败，请重试" },
        ]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "网络错误，请重试" }]);
    } finally {
      setSending(false);
      loadSessions();
    }
  };

  if (orgLoading) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织后再使用外贸 AI 对话。</p>
        <button type="button" onClick={() => router.push("/organizations")} className="text-sm text-accent underline-offset-2 hover:underline">
          前往组织
        </button>
      </div>
    );
  }

  if (loadingSessions) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Session List */}
      <div className="hidden w-56 shrink-0 flex-col rounded-xl border border-border/60 bg-card-bg lg:flex">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <span className="text-xs font-medium text-foreground">对话</span>
          <button onClick={createSession} className="rounded-lg p-1 text-muted transition hover:text-blue-400">
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {sessions.length === 0 ? (
            <p className="py-8 text-center text-[10px] text-muted">暂无对话</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => loadSession(s.id)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition",
                  activeId === s.id ? "bg-blue-500/10 text-blue-400" : "text-foreground hover:bg-border/20",
                )}
              >
                <MessageCircle size={12} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{s.title}</p>
                  <p className="text-[10px] text-muted">{new Date(s.updatedAt).toLocaleDateString("zh-CN")}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  className="shrink-0 rounded p-0.5 text-muted opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div
        className="relative flex min-w-0 flex-1 flex-col rounded-xl border border-border/60 bg-card-bg"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-card-bg/85 px-5 backdrop-blur-sm">
            <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed border-blue-500/40 bg-card-bg px-8 py-10">
              <Paperclip size={28} className="text-blue-400" />
              <p className="text-sm font-medium text-blue-400">松开以添加附件</p>
              <p className="text-xs text-muted">{ATTACH_HINT}</p>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <EmptyChat onQuickCommand={sendMessage} onPickFile={() => fileInputRef.current?.click()} />
          ) : (
            <div className="space-y-4">
              {messages.filter((m) => m.role !== "system").map((m, i) => (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5",
                    m.role === "user"
                      ? "rounded-br-md bg-blue-600 text-white"
                      : "rounded-bl-md bg-background text-foreground",
                  )}>
                    {m.attachments && m.attachments.length > 0 && (
                      <div className={cn("flex flex-wrap gap-1.5", m.content ? "mb-2" : "")}>
                        {m.attachments.map((a, j) => (
                          <span
                            key={`${a.name}-${j}`}
                            title={`${a.name}${a.size ? ` · ${formatBytes(a.size)}` : ""} · ${formatChars(a.textLength)}`}
                            className="inline-flex max-w-full items-center gap-1 rounded-lg bg-white/15 px-2 py-1 text-[11px]"
                          >
                            {a.kind === "image" ? <ImageIcon size={12} className="shrink-0" /> : <FileText size={12} className="shrink-0" />}
                            <span className="truncate">{a.name}</span>
                            <span className="shrink-0 opacity-70">{formatChars(a.textLength)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {m.content && (m.role === "assistant" ? (
                      <div className="prose-ai">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
                    ))}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-background px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <Sparkles size={14} className="animate-pulse text-blue-400" />
                      AI 思考中...
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border/60 p-3">
          {messages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_COMMANDS.slice(0, 4).map((cmd) => (
                <button
                  key={cmd.label}
                  onClick={() => sendMessage(cmd.text)}
                  disabled={sending}
                  className="rounded-full border border-border/60 px-2.5 py-0.5 text-[10px] text-muted transition hover:border-blue-500/40 hover:text-blue-400 disabled:opacity-50"
                >
                  {cmd.label}
                </button>
              ))}
            </div>
          )}
          {pending.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5" data-testid="pending-attachments">
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
                    <Loader2 size={12} className="shrink-0 animate-spin text-blue-400" />
                  ) : p.kind === "image" ? (
                    <ImageIcon size={12} className={cn("shrink-0", p.status === "ready" && "text-blue-400")} />
                  ) : (
                    <FileText size={12} className={cn("shrink-0", p.status === "ready" && "text-blue-400")} />
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
                    onClick={() => removePending(p.id)}
                    className="shrink-0 rounded p-0.5 text-muted transition hover:text-foreground"
                    aria-label={`移除附件 ${p.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachNotice && (
            <p className="mb-2 text-[11px] text-amber-500">{attachNotice}</p>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACH_ACCEPT}
              className="hidden"
              data-testid="trade-chat-file-input"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="上传附件（文档或图片）让 AI 分析"
              aria-label="上传附件"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted transition hover:border-blue-500/40 hover:text-blue-400 disabled:opacity-40"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              onPaste={(e) => {
                const files = e.clipboardData?.files;
                if (files && files.length > 0) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
              placeholder={
                readyAttachments.length > 0
                  ? "想让 AI 怎么分析这份附件？留空直接发送也可以"
                  : "输入消息，或拖入/粘贴文件、截图让 AI 分析... (Enter 发送, Shift+Enter 换行)"
              }
              rows={1}
              className="min-h-[36px] max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={() => sendMessage()}
              disabled={!canSend}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-500 disabled:opacity-40"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyChat({
  onQuickCommand,
  onPickFile,
}: {
  onQuickCommand: (text: string) => void;
  onPickFile: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10">
        <Sparkles className="h-8 w-8 text-blue-400" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">海外业务协同</h2>
      <p className="mt-2 max-w-md text-center text-sm text-muted">
        用自然语言管理外贸流程 — 查询线索、跟进状态、报价管理、获取行动建议
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {QUICK_COMMANDS.map((cmd) => (
          <button
            key={cmd.label}
            onClick={() => onQuickCommand(cmd.text)}
            className="rounded-xl border border-border/60 bg-background px-4 py-2 text-xs text-foreground transition hover:border-blue-500/40 hover:bg-blue-500/5"
          >
            {cmd.text}
          </button>
        ))}
        <button
          type="button"
          onClick={onPickFile}
          className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-blue-500/40 bg-blue-500/5 px-4 py-2 text-xs text-blue-400 transition hover:bg-blue-500/10"
        >
          <Paperclip size={12} />
          上传询盘 / 报价单 / 产品图片让 AI 分析
        </button>
      </div>
      <p className="mt-3 text-[11px] text-muted">也可以把文件或截图直接拖进 / 粘贴到对话框（{ATTACH_HINT.replace("支持 ", "")}）</p>
    </div>
  );
}
