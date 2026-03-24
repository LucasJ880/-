"use client";

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Send,
  Bot,
  User,
  Sparkles,
  Loader2,
  AlertCircle,
  Plus,
  Pin,
  PinOff,
  Trash2,
  MessageSquare,
  FolderKanban,
  MoreHorizontal,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { extractWorkSuggestion, type WorkSuggestion } from "@/lib/ai";
import {
  WorkSuggestionCard,
  type SimpleProject,
} from "@/components/work-suggestion-card";
import { AiServiceConfigHint } from "@/components/ai-service-config-hint";
import { apiFetch } from "@/lib/api-fetch";

// ── 类型 ──────────────────────────────────────────────────────

interface AiThread {
  id: string;
  title: string;
  projectId: string | null;
  pinned: boolean;
  lastMessageAt: string;
  createdAt: string;
  project: { id: string; name: string } | null;
  _count: { messages: number };
}

interface AiMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  workSuggestion?: WorkSuggestion | null;
  createdAt: string;
}

interface StreamingMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  workSuggestion?: WorkSuggestion | null;
  isStreaming?: boolean;
  isError?: boolean;
}

const QUICK_PROMPTS = [
  "明天下午两点开产品评审会",
  "这周五之前要完成季度销售报表",
  "提醒我后天给供应商回复报价单",
  "帮我分析当前在手项目的优先级",
];

function cleanStreamingText(raw: string): string {
  for (const marker of ["[WORK_JSON]", "[TASK_JSON]"]) {
    const idx = raw.indexOf(marker);
    if (idx !== -1) return raw.substring(0, idx).trim();
  }
  return raw;
}

// ── 线程列表侧栏 ─────────────────────────────────────────────

function ThreadSidebar({
  threads,
  activeId,
  onSelect,
  onCreate,
  onTogglePin,
  onDelete,
  showMobile,
  onCloseMobile,
}: {
  threads: AiThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (projectId?: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  showMobile: boolean;
  onCloseMobile: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const pinned = threads.filter((t) => t.pinned);
  const projectThreads = threads.filter((t) => !t.pinned && t.projectId);
  const generalThreads = threads.filter((t) => !t.pinned && !t.projectId);

  const renderGroup = (label: string, items: AiThread[], icon?: React.ReactNode) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-3">
        <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
          {icon}
          {label}
        </div>
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "group relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
              t.id === activeId
                ? "bg-accent/10 text-accent font-medium"
                : "text-foreground/80 hover:bg-accent/5"
            )}
            onClick={() => { onSelect(t.id); onCloseMobile(); }}
          >
            {t.project ? (
              <FolderKanban size={14} className="shrink-0 text-muted/60" />
            ) : (
              <MessageSquare size={14} className="shrink-0 text-muted/60" />
            )}
            <span className="flex-1 truncate">{t.title}</span>
            <button
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(menuOpen === t.id ? null : t.id);
              }}
            >
              <MoreHorizontal size={14} className="text-muted" />
            </button>
            {menuOpen === t.id && (
              <div
                className="absolute right-0 top-8 z-50 w-36 rounded-lg border border-border bg-card-bg py-1 shadow-lg"
                onMouseLeave={() => setMenuOpen(null)}
              >
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/5"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(t.id, !t.pinned);
                    setMenuOpen(null);
                  }}
                >
                  {t.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                  {t.pinned ? "取消置顶" : "置顶"}
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(t.id);
                    setMenuOpen(null);
                  }}
                >
                  <Trash2 size={12} />
                  删除
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-3 pb-2">
        <h2 className="text-sm font-semibold">对话列表</h2>
        <button
          onClick={() => onCreate()}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent transition-colors hover:bg-accent/20"
          title="新建对话"
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {threads.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted/60">
            暂无对话，点击 + 开始
          </div>
        )}
        {renderGroup("置顶", pinned, <Pin size={10} />)}
        {renderGroup("项目对话", projectThreads, <FolderKanban size={10} />)}
        {renderGroup("通用对话", generalThreads, <MessageSquare size={10} />)}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden w-60 shrink-0 border-r border-border lg:block">
        {sidebar}
      </div>
      {/* Mobile overlay */}
      {showMobile && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={onCloseMobile}
          />
          <div className="relative w-72 bg-background shadow-xl">
            {sidebar}
          </div>
        </div>
      )}
    </>
  );
}

// ── 主页面 ────────────────────────────────────────────────────

export default function AssistantPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      }
    >
      <AssistantPageInner />
    </Suspense>
  );
}

function AssistantPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialThreadId = searchParams.get("thread");
  const initialProjectId = searchParams.get("project");

  const [threads, setThreads] = useState<AiThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreadId
  );
  const [messages, setMessages] = useState<StreamingMsg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [noApiKey, setNoApiKey] = useState(false);
  const [projects, setProjects] = useState<SimpleProject[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Load threads
  useEffect(() => {
    apiFetch("/api/ai/threads")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setThreads(data);
      })
      .catch(() => {});
  }, []);

  // Load projects for WorkSuggestionCard
  useEffect(() => {
    apiFetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProjects(
            data.map((p: { id: string; name: string }) => ({
              id: p.id,
              name: p.name,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Auto-create thread for project link
  useEffect(() => {
    if (initialProjectId && !initialThreadId) {
      createThread(initialProjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProjectId]);

  // Load messages when active thread changes
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    setLoadingThread(true);
    apiFetch(`/api/ai/threads/${activeThreadId}/messages`)
      .then((r) => r.json())
      .then((data) => {
        if (data.messages) {
          setMessages(
            data.messages.map((m: AiMsg) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              workSuggestion: m.workSuggestion as WorkSuggestion | null | undefined,
            }))
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoadingThread(false));
  }, [activeThreadId]);

  const createThread = async (projectId?: string) => {
    try {
      const res = await apiFetch("/api/ai/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectId || null }),
      });
      const thread = await res.json();
      setThreads((prev) => [thread, ...prev]);
      setActiveThreadId(thread.id);
      router.replace(`/assistant?thread=${thread.id}`);
      setMessages([]);
      return thread.id as string;
    } catch {
      return null;
    }
  };

  const handleTogglePin = async (id: string, pinned: boolean) => {
    await apiFetch(`/api/ai/threads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, pinned } : t))
    );
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/ai/threads/${id}`, { method: "DELETE" });
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThreadId === id) {
      setActiveThreadId(null);
      setMessages([]);
      router.replace("/assistant");
    }
  };

  const handleSend = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;

    let threadId = activeThreadId;

    if (!threadId) {
      threadId = await createThread();
      if (!threadId) return;
    }

    const userMsg: StreamingMsg = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
    };
    const assistantId = `assistant-${Date.now()}`;
    const assistantMsg: StreamingMsg = {
      id: assistantId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await apiFetch(
        `/api/ai/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = String(errData.error || "");
        if (
          res.status === 500 &&
          (errMsg.includes("OPENAI") || errMsg.includes("API 密钥"))
        ) {
          setNoApiKey(true);
          setMessages((prev) =>
            prev.filter((m) => m.id !== assistantId && m.id !== userMsg.id)
          );
          return;
        }
        throw new Error(errData.error || `请求失败 (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          if (parsed.error) throw new Error(parsed.error);

          if (parsed.content) {
            fullText += parsed.content;
            const displayText = cleanStreamingText(fullText);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: displayText, isStreaming: true }
                  : m
              )
            );
          }
        }
      }

      const { cleanText, suggestion } = extractWorkSuggestion(fullText);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: cleanText,
                workSuggestion: suggestion,
                isStreaming: false,
              }
            : m
        )
      );

      // Update thread title in sidebar
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                title: t.title === "新对话" ? content.slice(0, 60) : t.title,
                lastMessageAt: new Date().toISOString(),
                _count: { messages: t._count.messages + 2 },
              }
            : t
        )
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "AI 服务暂时不可用";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: errorMessage, isStreaming: false, isError: true }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  if (noApiKey) return <AiServiceConfigHint variant="full" />;

  const activeThread = threads.find((t) => t.id === activeThreadId);

  return (
    <div className="flex h-full">
      <ThreadSidebar
        threads={threads}
        activeId={activeThreadId}
        onSelect={(id) => {
          setActiveThreadId(id);
          router.replace(`/assistant?thread=${id}`);
        }}
        onCreate={createThread}
        onTogglePin={handleTogglePin}
        onDelete={handleDelete}
        showMobile={showMobileSidebar}
        onCloseMobile={() => setShowMobileSidebar(false)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <button
            className="lg:hidden"
            onClick={() => setShowMobileSidebar(true)}
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
                    onClick={() => handleSend(prompt)}
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
              <p className="text-xs text-muted">
                {activeThread?.project
                  ? `已关联项目「${activeThread.project.name}」，AI 将自动获取项目上下文`
                  : "在下方输入你的问题或工作需求"}
              </p>
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
                      "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                      msg.role === "assistant"
                        ? "bg-background text-foreground"
                        : "bg-accent text-white",
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
                      msg.content.split("\n").map((line, i) => (
                        <p key={i} className={line === "" ? "h-2" : ""}>
                          {line}
                        </p>
                      ))
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
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-card-bg p-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                isLoading
                  ? "AI 正在回复..."
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
              onClick={() => handleSend()}
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
    </div>
  );
}
