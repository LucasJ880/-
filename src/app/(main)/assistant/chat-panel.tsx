"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ReactNode, RefObject } from "react";
import {
  Send,
  Bot,
  User,
  Sparkles,
  Loader2,
  AlertCircle,
  ChevronLeft,
  Paperclip,
  FileText,
  X,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkSuggestion } from "@/lib/ai/schemas";
import {
  WorkSuggestionCard,
  type SimpleProject,
} from "@/components/work-suggestion-card";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AiThread } from "./thread-list";

// ── AI Markdown 增强渲染 ─────────────────────────────────────

function transformEmojiBadges(text: string): ReactNode[] {
  const BADGE_MAP: [RegExp, string, string][] = [
    [/✅/g, "badge-pass", "✅"],
    [/✔️?/g, "badge-pass", "✔"],
    [/🟢/g, "badge-pass", "🟢"],
    [/❌/g, "badge-fail", "❌"],
    [/🔴/g, "badge-fail", "🔴"],
    [/❗/g, "badge-warn", "❗"],
    [/⚠️?/g, "badge-warn", "⚠"],
    [/🟡/g, "badge-warn", "🟡"],
    [/🚨/g, "badge-fail", "🚨"],
    [/💡/g, "badge-info", "💡"],
    [/🟠/g, "badge-warn", "🟠"],
  ];

  const allPattern = /[✅✔🟢❌🔴❗⚠🟡🚨💡🟠]️?/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = allPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const emoji = match[0];
    let cls = "badge-info";
    for (const [re, c] of BADGE_MAP) {
      if (re.test(emoji)) { cls = c; re.lastIndex = 0; break; }
    }
    parts.push(
      <span key={match.index} className={cls}>{emoji}</span>
    );
    lastIndex = match.index + emoji.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : [text];
}

function detectBlockquoteType(text: string): "warning" | "tip" | "conclusion" | "default" {
  const lower = text.toLowerCase();
  if (/❌|🔴|🚨|致命|红线|风险|危险|不允许|不接受|禁止/.test(lower)) return "warning";
  if (/💡|建议|策略|推荐|技巧|提示/.test(lower)) return "tip";
  if (/✅|结论|核心判断|最终|拍板|判断/.test(lower)) return "conclusion";
  return "default";
}

const mdComponents: Components = {
  h2({ children }) {
    return <h2>{children}</h2>;
  },
  blockquote({ children }) {
    const text = String(children);
    const type = detectBlockquoteType(text);
    const boxClass = type === "warning" ? "warning-box"
      : type === "tip" ? "tip-box"
      : type === "conclusion" ? "conclusion-box"
      : "";
    return boxClass
      ? <div className={boxClass}>{children}</div>
      : <blockquote>{children}</blockquote>;
  },
  strong({ children }) {
    const text = String(children);
    if (/极高|致命|红线|不允许|禁止|不接受/.test(text)) {
      return <strong className="risk-high">{children}</strong>;
    }
    if (/高风险|注意|关键|重要|必须/.test(text)) {
      return <strong className="risk-medium">{children}</strong>;
    }
    return <strong>{children}</strong>;
  },
  td({ children }) {
    const text = String(children ?? "");
    if (/^[✅✔🟢❌🔴❗⚠🟡🚨💡🟠]/.test(text.trim())) {
      return <td>{typeof children === "string" ? transformEmojiBadges(children) : children}</td>;
    }
    return <td>{children}</td>;
  },
  p({ children }) {
    if (typeof children === "string") {
      return <p>{transformEmojiBadges(children)}</p>;
    }
    return <p>{children}</p>;
  },
  li({ children }) {
    if (typeof children === "string") {
      return <li>{transformEmojiBadges(children)}</li>;
    }
    return <li>{children}</li>;
  },
};

// ── 类型 ──────────────────────────────────────────────────────

export interface StreamingMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  workSuggestion?: WorkSuggestion | null;
  isStreaming?: boolean;
  isError?: boolean;
}

// ── 常量 ──────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  "明天下午两点开产品评审会",
  "这周五之前要完成季度销售报表",
  "提醒我后天给供应商回复报价单",
  "帮我分析当前在手项目的优先级",
];

const PROJECT_QUICK_PROMPTS = [
  "分析这个项目的风险",
  "帮我向业主发一封澄清邮件",
  "帮我整理关键时间节点",
  "推荐适合的供应商",
];

// ── Props ─────────────────────────────────────────────────────

export interface ChatPanelProps {
  messages: StreamingMsg[];
  activeThreadId: string | null;
  activeThread?: AiThread;
  isLoading: boolean;
  loadingThread: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (text?: string) => void;
  projects: SimpleProject[];
  attachedFile: { name: string; text: string } | null;
  onClearAttachedFile: () => void;
  onFileUpload: (file: File) => void;
  uploadingFile: boolean;
  channelMode: string | null;
  onChannelModeChange: (mode: string | null) => void;
  onShowMobileSidebar: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

// ── ChatPanel ─────────────────────────────────────────────────

export function ChatPanel({
  messages,
  activeThreadId,
  activeThread,
  isLoading,
  loadingThread,
  input,
  onInputChange,
  onSend,
  projects,
  attachedFile,
  onClearAttachedFile,
  onFileUpload,
  uploadingFile,
  channelMode,
  onChannelModeChange,
  onShowMobileSidebar,
  inputRef,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const onFileUploadRef = useRef(onFileUpload);
  useEffect(() => {
    onFileUploadRef.current = onFileUpload;
  }, [onFileUpload]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (file) onFileUploadRef.current(file);
  }, []);

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent/40 bg-accent/5 px-12 py-10">
            <Paperclip size={32} className="text-accent" />
            <p className="text-sm font-medium text-accent">松开以上传文件</p>
            <p className="text-xs text-muted">支持 PDF、Word、Excel、CSV、TXT</p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <button
          className="lg:hidden"
          onClick={onShowMobileSidebar}
        >
          <ChevronLeft size={18} />
        </button>
        <Bot size={18} className="text-accent" />
        <div className="flex-1">
          <h1 className="text-sm font-semibold">
            {activeThread?.title || "AI 助手"}
          </h1>
          {activeThread?.project && (
            <p className="text-[11px] text-muted">
              关联项目：{activeThread.project.name}
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {!activeThreadId && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
              <Sparkles size={24} className="text-accent" />
            </div>
            <h2 className="mb-2 text-lg font-semibold">青砚 AI 助手</h2>
            <p className="mb-6 max-w-md text-sm text-muted">
              选择左侧已有对话继续，或点击下方开始新对话。
              每个对话独立保存，支持绑定项目获取深度上下文。
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onSend(prompt)}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card-bg px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {loadingThread && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-muted" />
          </div>
        )}

        {!loadingThread && activeThreadId && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
              <MessageSquare size={20} className="text-accent" />
            </div>
            <p className="mb-1 text-sm font-medium">开始对话</p>
            <p className="mb-4 text-xs text-muted">
              {activeThread?.project
                ? `已关联项目「${activeThread.project.name}」，AI 将自动获取项目上下文`
                : "在下方输入你的问题或工作需求"}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {(activeThread?.project ? PROJECT_QUICK_PROMPTS : QUICK_PROMPTS).map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onSend(prompt)}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card-bg px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4 p-4">
          {messages.map((msg) => (
            <div key={msg.id}>
              <div
                className={cn(
                  "flex gap-3",
                  msg.role === "user" && "flex-row-reverse"
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    msg.role === "assistant"
                      ? "bg-gradient-to-br from-[#2b6055] to-[#2b6055] text-white"
                      : "bg-[rgba(110,125,118,0.15)] text-[#6e7d76]"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <Bot size={16} />
                  ) : (
                    <User size={16} />
                  )}
                </div>
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    msg.role === "assistant"
                      ? "max-w-[90%] bg-background text-foreground"
                      : "max-w-[80%] bg-accent text-white",
                    msg.isError &&
                      "border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] text-[#a63d3d]"
                  )}
                >
                  {msg.isError && (
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#a63d3d]">
                      <AlertCircle size={13} />
                      请求失败
                    </div>
                  )}
                  {msg.content ? (
                    msg.role === "assistant" ? (
                      <div className="prose-ai">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      msg.content.split("\n").map((line, i) => (
                        <p key={i} className={line === "" ? "h-2" : ""}>
                          {line}
                        </p>
                      ))
                    )
                  ) : msg.isStreaming ? (
                    <div className="flex items-center gap-2 text-muted">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-xs">思考中...</span>
                    </div>
                  ) : null}
                  {msg.isStreaming && msg.content && (
                    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent/60" />
                  )}
                </div>
              </div>

              {msg.workSuggestion && !msg.isStreaming && (
                <div className="ml-11 mt-2 max-w-[80%]">
                  <WorkSuggestionCard
                    suggestion={msg.workSuggestion}
                    projects={projects}
                    projectId={activeThread?.projectId || undefined}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        {/* Channel selector */}
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-[11px] text-muted mr-1">话术渠道:</span>
          {(["wechat", "xiaohongshu", "facebook", "email"] as const).map(
            (ch) => (
              <button
                key={ch}
                onClick={() =>
                  onChannelModeChange(channelMode === ch ? null : ch)
                }
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors border",
                  channelMode === ch
                    ? ch === "wechat"
                      ? "border-green-300 bg-green-50 text-green-700"
                      : ch === "xiaohongshu"
                      ? "border-red-300 bg-red-50 text-red-700"
                      : ch === "facebook"
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-amber-300 bg-amber-50 text-amber-700"
                    : "border-transparent bg-foreground/5 text-muted hover:text-foreground hover:bg-foreground/10"
                )}
              >
                {ch === "wechat"
                  ? "微信"
                  : ch === "xiaohongshu"
                  ? "小红书"
                  : ch === "facebook"
                  ? "Facebook"
                  : "邮件"}
              </button>
            )
          )}
          {channelMode && (
            <button
              onClick={() => onChannelModeChange(null)}
              className="ml-1 text-[10px] text-muted hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {attachedFile && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-1.5">
            <FileText size={14} className="shrink-0 text-accent" />
            <span className="flex-1 truncate text-xs font-medium text-foreground">{attachedFile.name}</span>
            <span className="text-[10px] text-muted">{(attachedFile.text.length / 1000).toFixed(0)}k 字符</span>
            <button onClick={onClearAttachedFile} className="text-muted hover:text-foreground">
              <X size={14} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card-bg p-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileUploadRef.current(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || uploadingFile}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-40"
            title="上传文件（PDF/Word/Excel/CSV/TXT）"
          >
            {uploadingFile ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Paperclip size={15} />
            )}
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={
              isLoading
                ? "AI 正在回复..."
                : attachedFile
                  ? "输入你的问题，如「帮我提炼产品细节」..."
                  : "输入消息，Enter 发送，Shift+Enter 换行..."
            }
            disabled={isLoading}
            rows={1}
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted disabled:opacity-50"
            style={{ minHeight: "36px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height =
                Math.min(target.scrollHeight, 128) + "px";
            }}
          />
          <button
            onClick={() => onSend()}
            disabled={!input.trim() || isLoading}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {isLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
