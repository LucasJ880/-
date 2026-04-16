"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Bot,
  User,
  Loader2,
  AlertCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { extractWorkSuggestion } from "@/lib/ai/parser";
import type { WorkSuggestion } from "@/lib/ai/schemas";
import {
  WorkSuggestionCard,
  type SimpleProject,
} from "@/components/work-suggestion-card";
import { apiFetch } from "@/lib/api-fetch";

interface StreamingMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  workSuggestion?: WorkSuggestion | null;
  isStreaming?: boolean;
  isError?: boolean;
}

function cleanStreamingText(raw: string): string {
  for (const marker of ["[WORK_JSON]", "[TASK_JSON]"]) {
    const idx = raw.indexOf(marker);
    if (idx !== -1) return raw.substring(0, idx).trim();
  }
  return raw;
}

function dispatchProjectUpdated(projectId: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("qingyan:project-updated", { detail: { projectId } })
    );
  }
}

export function ProjectAiChat({
  projectId,
  projectName,
  onProjectUpdate,
}: {
  projectId: string;
  projectName: string;
  onProjectUpdate?: () => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StreamingMsg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [projects, setProjects] = useState<SimpleProject[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    apiFetch("/api/projects?take=30")
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

  const initThread = useCallback(async () => {
    if (initialized) return threadId;

    try {
      const listRes = await apiFetch(
        `/api/ai/threads?projectId=${projectId}`
      );
      const threads = await listRes.json();
      if (Array.isArray(threads) && threads.length > 0) {
        const existing = threads[0];
        setThreadId(existing.id);

        const msgRes = await apiFetch(
          `/api/ai/threads/${existing.id}/messages`
        );
        const data = await msgRes.json();
        if (data.messages) {
          setMessages(
            data.messages.map(
              (m: {
                id: string;
                role: string;
                content: string;
                workSuggestion?: unknown;
              }) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                workSuggestion: m.workSuggestion as
                  | WorkSuggestion
                  | null
                  | undefined,
              })
            )
          );
        }
        setInitialized(true);
        return existing.id as string;
      }

      const createRes = await apiFetch("/api/ai/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: `${projectName} - AI 讨论`,
        }),
      });
      const newThread = await createRes.json();
      setThreadId(newThread.id);
      setInitialized(true);
      return newThread.id as string;
    } catch {
      return null;
    }
  }, [projectId, projectName, initialized, threadId]);

  const handleExpand = async () => {
    if (!expanded) {
      setExpanded(true);
      await initThread();
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setExpanded(false);
    }
  };

  const handleSend = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;

    let tid = threadId;
    if (!tid) {
      tid = await initThread();
      if (!tid) return;
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
      const res = await apiFetch(`/api/ai/threads/${tid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
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

      const { cleanText, suggestion, parseError } = extractWorkSuggestion(fullText);
      const finalContent = parseError
        ? `${cleanText}\n\n> [AI 建议解析异常] ${parseError.reason}`
        : cleanText;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: finalContent,
                workSuggestion: suggestion,
                isStreaming: false,
              }
            : m
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

  return (
    <div className="rounded-xl border border-border bg-card-bg overflow-hidden">
      {/* Header — 点击展开/收起 */}
      <button
        onClick={handleExpand}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/5"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10">
          <Bot size={17} className="text-accent" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">AI 助手</p>
          <p className="text-xs text-muted">
            与 AI 讨论此项目，对话自动获取项目上下文并永久保存
          </p>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="text-muted" />
        ) : (
          <ChevronDown size={16} className="text-muted" />
        )}
      </button>

      {/* 对话区 */}
      {expanded && (
        <div className="border-t border-border">
          <div
            ref={scrollRef}
            className="max-h-[480px] overflow-y-auto"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                <Sparkles size={20} className="mb-2 text-accent/50" />
                <p className="text-xs text-muted">
                  试试问我关于这个项目的问题，例如：
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {[
                    "分析这个项目的风险",
                    "帮我向业主发一封澄清邮件",
                    "帮我整理关键时间节点",
                    "推荐适合的供应商",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSend(q)}
                      disabled={isLoading}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 p-4">
              {messages.map((msg) => (
                <div key={msg.id}>
                  <div
                    className={cn(
                      "flex gap-2.5",
                      msg.role === "user" && "flex-row-reverse"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                        msg.role === "assistant"
                          ? "bg-gradient-to-br from-[#2b6055] to-[#2b6055] text-white"
                          : "bg-[rgba(110,125,118,0.15)] text-[#6e7d76]"
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <Bot size={14} />
                      ) : (
                        <User size={14} />
                      )}
                    </div>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
                        msg.role === "assistant"
                          ? "bg-background text-foreground"
                          : "bg-accent text-white",
                        msg.isError &&
                          "border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] text-[#a63d3d]"
                      )}
                    >
                      {msg.isError && (
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#a63d3d]">
                          <AlertCircle size={12} />
                          请求失败
                        </div>
                      )}
                      {msg.content ? (
                        msg.content.split("\n").map((line, i) => (
                          <p key={i} className={line === "" ? "h-1.5" : ""}>
                            {line}
                          </p>
                        ))
                      ) : msg.isStreaming ? (
                        <div className="flex items-center gap-2 text-muted">
                          <Loader2 size={13} className="animate-spin" />
                          <span className="text-xs">思考中...</span>
                        </div>
                      ) : null}
                      {msg.isStreaming && msg.content && (
                        <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-accent/60" />
                      )}
                    </div>
                  </div>

                  {msg.workSuggestion && !msg.isStreaming && (
                    <div
                      className={cn(
                        "mt-1.5 max-w-[85%]",
                        msg.role === "user" ? "ml-auto mr-9" : "ml-9"
                      )}
                    >
                      <WorkSuggestionCard
                        suggestion={msg.workSuggestion}
                        projects={projects}
                        projectId={projectId}
                        onCreated={() => {
                          onProjectUpdate?.();
                          dispatchProjectUpdated(projectId);
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 输入区 */}
          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-1.5">
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
                    : "输入消息，Enter 发送..."
                }
                disabled={isLoading}
                rows={1}
                className="max-h-24 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted disabled:opacity-50"
                style={{ minHeight: "32px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height =
                    Math.min(target.scrollHeight, 96) + "px";
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                {isLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
