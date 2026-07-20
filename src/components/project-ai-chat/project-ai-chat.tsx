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
  Zap,
  GitBranch,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { extractWorkSuggestion } from "@/lib/ai/parser";
import type { WorkSuggestion } from "@/lib/ai/schemas";
import {
  WorkSuggestionCard,
  type SimpleProject,
} from "@/components/work-suggestion-card";
import { apiFetch } from "@/lib/api-fetch";
import {
  ASSISTANT_MODE_META,
  type AssistantMode,
} from "@/lib/ai/assistant-modes";
import { AgentRunPanel } from "@/app/(main)/assistant/agent-run-panel";
import {
  ApprovalCard,
  type PendingApproval,
} from "@/app/(main)/assistant/approval-card";
import {
  completeToolResult,
  createThinkStep,
  finalizeSteps,
  markReplying,
  upsertToolStart,
  type AgentStep,
} from "@/app/(main)/assistant/agent-run-types";

interface StreamingMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  workSuggestion?: WorkSuggestion | null;
  isStreaming?: boolean;
  isError?: boolean;
  agentSteps?: AgentStep[];
  pendingApprovals?: PendingApproval[];
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

const MODE_ICONS: Record<AssistantMode, typeof Zap> = {
  fast: Zap,
  agent: GitBranch,
  project_expert: Briefcase,
};

const MODE_ORDER: AssistantMode[] = ["fast", "agent", "project_expert"];

export function ProjectAiChat({
  projectId,
  projectName,
  orgId,
  onProjectUpdate,
}: {
  projectId: string;
  projectName: string;
  orgId?: string | null;
  onProjectUpdate?: () => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StreamingMsg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [projects, setProjects] = useState<SimpleProject[]>([]);
  const [assistantMode, setAssistantMode] =
    useState<AssistantMode>("project_expert");

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadIdRef = useRef<string | null>(null);
  const initPromiseRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

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

  const initThread = useCallback(async (): Promise<string | null> => {
    if (threadIdRef.current) return threadIdRef.current;
    if (initialized && threadId) return threadId;

    try {
      const listRes = await apiFetch(
        `/api/ai/threads?projectId=${projectId}`
      );
      const threads = await listRes.json();
      if (Array.isArray(threads) && threads.length > 0) {
        const existing = threads[0];
        setThreadId(existing.id);
        threadIdRef.current = existing.id;

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
                pendingActions?: Array<{
                  id: string;
                  type: string;
                  title: string;
                  preview: string;
                  status: PendingApproval["status"];
                  failureReason?: string | null;
                }>;
              }) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                workSuggestion: (m.workSuggestion as WorkSuggestion) ?? null,
                pendingApprovals: (m.pendingActions ?? []).map((pa) => ({
                  actionId: pa.id,
                  draftType: pa.type,
                  title: pa.title,
                  preview: pa.preview,
                  status: pa.status,
                  failureReason: pa.failureReason ?? null,
                })),
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
          title: `项目：${projectName}`,
          projectId,
        }),
      });
      const created = await createRes.json();
      if (created?.id) {
        setThreadId(created.id);
        threadIdRef.current = created.id;
        setInitialized(true);
        return created.id as string;
      }
      return null;
    } catch {
      return null;
    }
  }, [projectId, projectName, initialized, threadId]);

  // 进页预热线程，避免首条消息串行等待
  useEffect(() => {
    if (!initPromiseRef.current) {
      initPromiseRef.current = initThread();
    }
  }, [initThread]);

  const ensureThread = useCallback(async () => {
    if (threadIdRef.current) return threadIdRef.current;
    if (!initPromiseRef.current) {
      initPromiseRef.current = initThread();
    }
    return initPromiseRef.current;
  }, [initThread]);

  const handleExpand = async () => {
    if (!expanded) {
      setExpanded(true);
      if (!threadIdRef.current) {
        await ensureThread();
      }
      setTimeout(() => inputRef.current?.focus(), 80);
    } else {
      setExpanded(false);
    }
  };

  const handleSend = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;

    const tid = await ensureThread();
    if (!tid) return;

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
      agentSteps: [createThinkStep()],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsLoading(true);
    if (!expanded) setExpanded(true);

    try {
      const res = await apiFetch(`/api/ai/threads/${tid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          orgId: orgId || undefined,
          assistantMode,
        }),
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

          if (parsed.type === "tool_start") {
            const label: string = parsed.label || "处理中";
            const toolName: string = parsed.name || "";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      isStreaming: true,
                      agentSteps: upsertToolStart(
                        m.agentSteps ?? [createThinkStep()],
                        toolName,
                        label
                      ),
                    }
                  : m
              )
            );
            continue;
          }

          if (parsed.type === "tool_result") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      isStreaming: true,
                      agentSteps: completeToolResult(
                        m.agentSteps ?? [],
                        parsed.name || "",
                        parsed.ok !== false
                      ),
                    }
                  : m
              )
            );
            continue;
          }

          if (parsed.type === "approval_required" && parsed.actionId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const existing = m.pendingApprovals ?? [];
                if (existing.some((p) => p.actionId === parsed.actionId)) {
                  return m;
                }
                return {
                  ...m,
                  pendingApprovals: [
                    ...existing,
                    {
                      actionId: String(parsed.actionId),
                      draftType: String(parsed.draftType ?? ""),
                      title: String(parsed.title ?? "待确认动作"),
                      preview: String(parsed.preview ?? ""),
                      status: "pending" as const,
                    },
                  ],
                  agentSteps: [
                    ...(m.agentSteps ?? []).map((s) =>
                      s.status === "running"
                        ? {
                            ...s,
                            status: "done" as const,
                            endedAt: Date.now(),
                          }
                        : s
                    ),
                    {
                      id: `approve-${parsed.actionId}`,
                      kind: "approve" as const,
                      label: String(parsed.title ?? "等待你确认"),
                      status: "done" as const,
                      detail: String(parsed.actionId),
                      startedAt: Date.now(),
                      endedAt: Date.now(),
                    },
                  ],
                };
              })
            );
            continue;
          }

          if (parsed.type === "mode" || parsed.type === "done") continue;

          const textDelta =
            typeof parsed.content === "string"
              ? parsed.content
              : parsed.type === "text" && typeof parsed.delta === "string"
                ? parsed.delta
                : "";

          if (textDelta) {
            fullText += textDelta;
            const displayText = cleanStreamingText(fullText);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: displayText,
                      isStreaming: true,
                      agentSteps: markReplying(m.agentSteps ?? []),
                    }
                  : m
              )
            );
          }
        }
      }

      const { cleanText, suggestion, parseError } =
        extractWorkSuggestion(fullText);
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
                agentSteps: finalizeSteps(m.agentSteps ?? []),
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
            ? {
                ...m,
                content: errorMessage,
                isStreaming: false,
                isError: true,
                agentSteps: finalizeSteps(m.agentSteps ?? []),
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
      <button
        type="button"
        onClick={handleExpand}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/5"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10">
          <Bot size={17} className="text-accent" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">项目 AI 助手</p>
          <p className="text-xs text-muted">
            {ASSISTANT_MODE_META[assistantMode].label} ·{" "}
            {ASSISTANT_MODE_META[assistantMode].hint}
          </p>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="text-muted" />
        ) : (
          <ChevronDown size={16} className="text-muted" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* 助手模式选择 */}
          <div className="flex gap-1.5 overflow-x-auto border-b border-border/70 px-3 py-2">
            {MODE_ORDER.map((mode) => {
              const Icon = MODE_ICONS[mode];
              const active = assistantMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAssistantMode(mode)}
                  disabled={isLoading}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                    active
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border bg-background text-muted hover:border-accent/25 hover:text-foreground"
                  )}
                  title={ASSISTANT_MODE_META[mode].hint}
                >
                  <Icon size={12} />
                  {ASSISTANT_MODE_META[mode].label}
                </button>
              );
            })}
          </div>

          <div ref={scrollRef} className="max-h-[520px] overflow-y-auto">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                <Sparkles size={20} className="mb-2 text-accent/50" />
                <p className="text-xs text-muted">
                  当前模式：{ASSISTANT_MODE_META[assistantMode].label}
                  （可随时切换）
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {(assistantMode === "fast"
                    ? [
                        "用三句话概括这个项目",
                        "截标前我最该盯什么？",
                        "把关键日期列成清单",
                      ]
                    : [
                        "分析这个项目的风险",
                        "帮我向业主发一封澄清邮件",
                        "帮我整理关键时间节点",
                        "推荐适合的供应商",
                      ]
                  ).map((q) => (
                    <button
                      key={q}
                      type="button"
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
                        "max-w-[88%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
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
                      {msg.role === "assistant" &&
                        msg.agentSteps &&
                        msg.agentSteps.length > 0 && (
                          <AgentRunPanel
                            steps={msg.agentSteps}
                            isStreaming={msg.isStreaming}
                            className={msg.content ? "mb-2.5" : undefined}
                          />
                        )}
                      {msg.content ? (
                        msg.content.split("\n").map((line, i) => (
                          <p key={i} className={line === "" ? "h-1.5" : ""}>
                            {line}
                          </p>
                        ))
                      ) : msg.isStreaming &&
                        !(msg.agentSteps && msg.agentSteps.length > 0) ? (
                        <div className="flex items-center gap-2 text-muted">
                          <Loader2 size={13} className="animate-spin" />
                          <span className="text-xs">接入中…</span>
                        </div>
                      ) : null}
                      {msg.isStreaming && msg.content && (
                        <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-accent/60" />
                      )}
                    </div>
                  </div>

                  {msg.pendingApprovals && msg.pendingApprovals.length > 0 && (
                    <div className="ml-9 mt-2 flex max-w-[88%] flex-col gap-2">
                      {msg.pendingApprovals.map((pa) => (
                        <ApprovalCard
                          key={pa.actionId}
                          approval={pa}
                          onChange={(next) => {
                            setMessages((prev) =>
                              prev.map((m) =>
                                m.id === msg.id
                                  ? {
                                      ...m,
                                      pendingApprovals: (
                                        m.pendingApprovals ?? []
                                      ).map((p) =>
                                        p.actionId === next.actionId
                                          ? next
                                          : p
                                      ),
                                    }
                                  : m
                              )
                            );
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {msg.workSuggestion && !msg.isStreaming && (
                    <div
                      className={cn(
                        "mt-1.5 max-w-[88%]",
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
                    ? "AI 正在处理..."
                    : assistantMode === "fast"
                      ? "快速提问…"
                      : "描述目标，Enter 发送…"
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
                type="button"
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
