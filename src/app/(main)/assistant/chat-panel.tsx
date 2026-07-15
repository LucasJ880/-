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
  PanelLeft,
  ArrowUpRight,
  Paperclip,
  FileText,
  X,
  MessageSquare,
  Mic,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useVoiceInput } from "@/lib/hooks/use-voice-input";
import { useTts } from "@/lib/hooks/use-tts";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { WorkSuggestion } from "@/lib/ai/schemas";
import {
  WorkSuggestionCard,
  type SimpleProject,
} from "@/components/work-suggestion-card";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AiThread } from "./thread-list";
import { ApprovalCard, type PendingApproval } from "./approval-card";
import { PendingInbox } from "./pending-inbox";

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
  /** PR3：当前正在调用的工具状态，如"正在查询销售管道…"；null 表示无 */
  toolStatus?: string | null;
  /** PR4：该消息带出的待审批草稿 */
  pendingApprovals?: PendingApproval[];
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
  /** PR4：审批卡片更新回调 */
  onApprovalChange?: (messageId: string, next: PendingApproval) => void;
  /** PR4.5：PendingInbox 打开对话的回调 */
  onOpenThread?: (threadId: string) => void;
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
  onApprovalChange,
  onOpenThread,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const onFileUploadRef = useRef(onFileUpload);
  useEffect(() => {
    onFileUploadRef.current = onFileUpload;
  }, [onFileUpload]);

  // 语音输入：转写结果追加到输入框，用户确认后发送
  const { error: toastError } = useToast();
  const inputValueRef = useRef(input);
  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);
  // 语音播报：单条点播 + 自动播报开关（localStorage 持久化）
  const { playingId, loadingId, play: playTts, stop: stopTts } = useTts();
  const [autoSpeak, setAutoSpeak] = useState(false);
  useEffect(() => {
    try {
      setAutoSpeak(localStorage.getItem("qy-auto-speak") === "1");
    } catch {}
  }, []);
  const toggleAutoSpeak = () => {
    setAutoSpeak((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("qy-auto-speak", next ? "1" : "0");
      } catch {}
      if (!next) stopTts();
      return next;
    });
  };

  // 自动播报：流式回复完成的那一刻朗读（只播「本次会话中流过」的消息，历史消息不播）
  const streamedIdsRef = useRef<Set<string>>(new Set());
  const autoSpeakRef = useRef(autoSpeak);
  useEffect(() => {
    autoSpeakRef.current = autoSpeak;
  }, [autoSpeak]);
  useEffect(() => {
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      if (msg.isStreaming) {
        streamedIdsRef.current.add(msg.id);
      } else if (streamedIdsRef.current.has(msg.id)) {
        streamedIdsRef.current.delete(msg.id);
        if (autoSpeakRef.current && msg.content && !msg.isError) {
          playTts(msg.id, msg.content);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const {
    state: voiceState,
    supported: voiceSupported,
    toggle: toggleVoice,
  } = useVoiceInput(
    useCallback(
      (text: string) => {
        const current = inputValueRef.current;
        onInputChange(current ? `${current.trimEnd()} ${text}` : text);
        inputRef.current?.focus();
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [onInputChange],
    ),
    useCallback((msg: string) => toastError(msg), [toastError]),
  );

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
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fbfcfc]"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/85 px-5 backdrop-blur-xl">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border border-dashed border-[#2b6055]/35 bg-[#f0f5f3] px-8 py-10 shadow-float">
            <Paperclip size={32} className="text-accent" />
            <p className="text-sm font-medium text-accent">松开以上传文件</p>
            <p className="text-xs text-muted">支持 PDF、Word、Excel、CSV、TXT</p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="z-20 flex min-h-16 items-center gap-3 border-b border-black/[0.06] bg-white/90 px-3 backdrop-blur-xl sm:px-5">
        <button
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[#5f6763] hover:bg-black/[0.04] hover:text-[#171a19] lg:hidden"
          onClick={onShowMobileSidebar}
          title="打开工作对话"
          aria-label="打开工作对话"
        >
          <PanelLeft size={18} />
        </button>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#171a19] text-white shadow-xs">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-normal text-[#171a19]">
            {activeThread?.title || "青砚"}
          </h1>
          <p className="flex items-center gap-1.5 truncate text-[11px] text-[#7c8480]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#3d8a68]" />
            {activeThread?.project
              ? `项目 · ${activeThread.project.name}`
              : "销售协作已就绪"}
          </p>
        </div>
        {/* 语音播报开关：开启后 AI 回复自动朗读 */}
        <button
          onClick={toggleAutoSpeak}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
            autoSpeak
              ? "bg-[#edf3f1] text-[#2b6055]"
              : "text-[#6f7773] hover:bg-black/[0.04] hover:text-[#171a19]"
          )}
          title={autoSpeak ? "语音播报已开启（点击关闭）" : "开启语音播报"}
          aria-label={autoSpeak ? "关闭语音播报" : "开启语音播报"}
        >
          {autoSpeak ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        {/* PR4.5：待我确认 Inbox 入口 */}
        <PendingInbox onOpenThread={onOpenThread} />
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {!activeThreadId && messages.length === 0 && (
          <div className="mx-auto flex min-h-full w-full max-w-[840px] flex-col justify-center px-5 py-10 sm:px-10">
            <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-lg border border-black/[0.06] bg-white text-[#2b6055] shadow-card">
              <Sparkles size={19} />
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-normal text-[#2b6055]">
              Qingyan Intelligence
            </p>
            <h2 className="mb-3 text-2xl font-semibold tracking-normal text-[#171a19] sm:text-[28px]">
              今天要推进什么？
            </h2>
            <p className="mb-7 max-w-xl text-sm leading-6 text-[#68706c]">
              从客户跟进、项目判断到销售内容，直接告诉青砚你的目标。
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onSend(prompt)}
                  disabled={isLoading}
                  className="group flex min-h-12 items-center justify-between gap-3 rounded-lg border border-black/[0.07] bg-white px-3.5 py-2.5 text-left text-xs font-medium text-[#4b524f] shadow-xs transition-colors hover:border-[#2b6055]/25 hover:bg-[#f5f8f7] hover:text-[#171a19] disabled:opacity-50"
                >
                  <span>{prompt}</span>
                  <ArrowUpRight size={14} className="shrink-0 text-[#9aa19e] group-hover:text-[#2b6055]" />
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
          <div className="mx-auto flex min-h-full w-full max-w-[840px] flex-col justify-center px-5 py-10 sm:px-10">
            <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-black/[0.06] bg-white text-[#2b6055] shadow-card">
              <MessageSquare size={17} />
            </div>
            <h2 className="mb-2 text-xl font-semibold tracking-normal text-[#171a19]">开始推进这项工作</h2>
            <p className="mb-6 text-sm text-[#68706c]">
              {activeThread?.project
                ? `已连接「${activeThread.project.name}」的项目上下文`
                : "输入目标，或从下面选择一个常用动作"}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(activeThread?.project ? PROJECT_QUICK_PROMPTS : QUICK_PROMPTS).map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onSend(prompt)}
                  disabled={isLoading}
                  className="group flex min-h-12 items-center justify-between gap-3 rounded-lg border border-black/[0.07] bg-white px-3.5 py-2.5 text-left text-xs font-medium text-[#4b524f] shadow-xs transition-colors hover:border-[#2b6055]/25 hover:bg-[#f5f8f7] hover:text-[#171a19] disabled:opacity-50"
                >
                  <span>{prompt}</span>
                  <ArrowUpRight size={14} className="shrink-0 text-[#9aa19e] group-hover:text-[#2b6055]" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto w-full max-w-[920px] space-y-7 px-4 py-6 sm:px-8 sm:py-8">
          {messages.map((msg) => (
            <div key={msg.id}>
              <div
                className={cn(
                  "flex gap-3 sm:gap-4",
                  msg.role === "user" && "flex-row-reverse"
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
                    msg.role === "assistant"
                      ? "border-black/[0.06] bg-[#171a19] text-white shadow-xs"
                      : "border-black/[0.06] bg-[#eef0ef] text-[#68706c]"
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
                    "min-w-0 text-sm leading-7",
                    msg.role === "assistant"
                      ? "max-w-[calc(100%-44px)] flex-1 py-0.5 text-[#252927]"
                      : "max-w-[82%] rounded-lg bg-[#202422] px-4 py-2.5 text-white shadow-xs",
                    msg.isError &&
                      "rounded-lg border border-[rgba(166,61,61,0.15)] bg-[#fff7f7] px-4 py-2.5 text-[#a63d3d]"
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
                  ) : msg.isStreaming && !msg.toolStatus ? (
                    <div className="flex items-center gap-2 text-[#7c8480]">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-xs">思考中...</span>
                    </div>
                  ) : null}
                  {msg.isStreaming && msg.toolStatus && (
                    <div className="mt-2 flex w-fit items-center gap-1.5 rounded-md border border-[#2b6055]/10 bg-[#edf3f1] px-2.5 py-1 text-[11px] font-medium text-[#2b6055]">
                      <Loader2 size={11} className="animate-spin" />
                      <span>{msg.toolStatus}</span>
                    </div>
                  )}
                  {msg.isStreaming && msg.content && !msg.toolStatus && (
                    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent/60" />
                  )}
                </div>
              </div>

              {/* 单条播报按钮 */}
              {msg.role === "assistant" &&
                !msg.isStreaming &&
                !msg.isError &&
                msg.content && (
                  <div className="ml-11 mt-1 sm:ml-12">
                    <button
                      onClick={() => playTts(msg.id, msg.content)}
                      className={cn(
                        "flex min-h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-colors",
                        playingId === msg.id
                          ? "bg-[#edf3f1] text-[#2b6055]"
                          : "text-[#7c8480] hover:bg-black/[0.04] hover:text-[#171a19]"
                      )}
                      title={playingId === msg.id ? "停止播放" : "朗读这条回复"}
                    >
                      {loadingId === msg.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : playingId === msg.id ? (
                        <Square size={9} fill="currentColor" />
                      ) : (
                        <Volume2 size={11} />
                      )}
                      {playingId === msg.id ? "停止" : loadingId === msg.id ? "合成中" : "朗读"}
                    </button>
                  </div>
                )}

              {msg.workSuggestion && !msg.isStreaming && (
                <div className="ml-11 mt-3 max-w-[calc(100%-44px)] sm:ml-12">
                  <WorkSuggestionCard
                    suggestion={msg.workSuggestion}
                    projects={projects}
                    projectId={activeThread?.projectId || undefined}
                  />
                </div>
              )}

              {msg.pendingApprovals && msg.pendingApprovals.length > 0 && (
                <div className="ml-11 mt-3 flex max-w-[calc(100%-44px)] flex-col gap-2 sm:ml-12">
                  {msg.pendingApprovals.map((pa) => (
                    <ApprovalCard
                      key={pa.actionId}
                      approval={pa}
                      onChange={(next) => onApprovalChange?.(msg.id, next)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-black/[0.06] bg-white/90 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:px-6 sm:pb-4">
        <div className="mx-auto w-full max-w-[920px]">
        {/* Channel selector */}
        <div className="mb-2 flex max-w-full items-center gap-1 overflow-x-auto pb-0.5">
          <span className="mr-1 shrink-0 text-[11px] font-medium text-[#68706c]">输出渠道</span>
          {(["wechat", "xiaohongshu", "facebook", "email"] as const).map(
            (ch) => (
              <button
                key={ch}
                onClick={() =>
                  onChannelModeChange(channelMode === ch ? null : ch)
                }
                className={cn(
                  "min-h-7 shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  channelMode === ch
                    ? "border-[#202422] bg-[#202422] text-white"
                    : "border-black/[0.07] bg-[#f4f5f5] text-[#68706c] hover:bg-[#e9ebea] hover:text-[#171a19]"
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
              className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#7c8480] hover:bg-black/[0.04] hover:text-[#171a19]"
              title="清除渠道"
              aria-label="清除渠道"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {attachedFile && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#2b6055]/15 bg-[#f0f5f3] px-3 py-2">
            <FileText size={14} className="shrink-0 text-accent" />
            <span className="flex-1 truncate text-xs font-medium text-foreground">{attachedFile.name}</span>
            <span className="text-[10px] text-muted">{(attachedFile.text.length / 1000).toFixed(0)}k 字符</span>
            <button onClick={onClearAttachedFile} className="text-muted hover:text-foreground">
              <X size={14} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-1 rounded-lg border border-black/10 bg-white p-2 shadow-float focus-within:border-[#2b6055]/35 focus-within:shadow-card sm:gap-2">
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[#6f7773] transition-colors hover:bg-[#edf3f1] hover:text-[#2b6055] disabled:opacity-40"
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
              voiceState === "recording"
                ? "正在聆听，再点一下麦克风结束..."
                : voiceState === "transcribing"
                  ? "正在识别语音..."
                  : isLoading
                    ? "AI 正在回复..."
                    : attachedFile
                      ? "输入你的问题，如「帮我提炼产品细节」..."
                      : "描述目标、客户情况或需要推进的工作..."
            }
            disabled={isLoading}
            rows={1}
            className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-[#252927] outline-none placeholder:text-[#959c98] disabled:opacity-50"
            style={{ minHeight: "44px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height =
                Math.min(target.scrollHeight, 128) + "px";
            }}
          />
          {voiceSupported && (
            <button
              onClick={toggleVoice}
              disabled={isLoading || voiceState === "transcribing"}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40",
                voiceState === "recording"
                  ? "bg-red-500 text-white animate-pulse"
                  : "text-[#6f7773] hover:bg-[#edf3f1] hover:text-[#2b6055]"
              )}
              title={voiceState === "recording" ? "点击结束录音" : "语音输入"}
              aria-label={voiceState === "recording" ? "结束录音" : "开始语音输入"}
            >
              {voiceState === "transcribing" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : voiceState === "recording" ? (
                <Square size={13} fill="currentColor" />
              ) : (
                <Mic size={15} />
              )}
            </button>
          )}
          <button
            onClick={() => onSend()}
            disabled={!input.trim() || isLoading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#202422] text-white shadow-xs transition-colors hover:bg-[#2b6055] disabled:bg-[#d8dcda] disabled:text-[#8e9591] disabled:shadow-none"
            title="发送"
            aria-label="发送"
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
    </div>
  );
}
