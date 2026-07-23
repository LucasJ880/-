"use client";

import {
  Suspense,
  useState,
  useRef,
  useEffect,
  useCallback,
  type ComponentProps,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { extractWorkSuggestion } from "@/lib/ai/parser";
import type { WorkSuggestion } from "@/lib/ai/schemas";
import type { SimpleProject } from "@/components/work-suggestion-card";
import { AiServiceConfigHint } from "@/components/ai-service-config-hint";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { notifyPendingActionsChanged } from "@/lib/hooks/use-pending-approvals-badge";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { ThreadSidebar, type AiThread } from "./thread-list";
import { ChatPanel, type StreamingMsg } from "./chat-panel";
import {
  completeToolResult,
  createThinkStep,
  finalizeSteps,
  markReplying,
  upsertToolStart,
} from "./agent-run-types";
import {
  isAssistantRunStatusDto,
  type AssistantRunStatusDto,
} from "@/lib/assistant/run-status-types";
import { attachRunsToAssistantMessages } from "@/lib/assistant/attach-runs";

// ── 类型 ──────────────────────────────────────────────────────

interface ApiPendingAction {
  id: string;
  type: string;
  title: string;
  preview: string;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  messageId?: string | null;
  expiresAt: string;
  failureReason?: string | null;
  resultRef?: string | null;
}

interface AiMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  workSuggestion?: WorkSuggestion | null;
  createdAt: string;
  pendingActions?: ApiPendingAction[];
}

function cleanStreamingText(raw: string): string {
  for (const marker of ["[WORK_JSON]", "[TASK_JSON]"]) {
    const idx = raw.indexOf(marker);
    if (idx !== -1) return raw.substring(0, idx).trim();
  }
  return raw;
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
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const initialThreadId = searchParams.get("thread");
  const initialProjectId = searchParams.get("project");
  const initialPrompt = searchParams.get("prompt") ?? "";

  const [threads, setThreads] = useState<AiThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreadId
  );
  const [messages, setMessages] = useState<StreamingMsg[]>([]);
  const [input, setInput] = useState(initialPrompt);
  const [isLoading, setIsLoading] = useState(false);
  const [noApiKey, setNoApiKey] = useState(false);
  const [projects, setProjects] = useState<SimpleProject[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; text: string } | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const createThread = useCallback(async (projectId?: string) => {
    try {
      const thread = await apiJson<AiThread>("/api/ai/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectId || null }),
      });
      setThreads((prev) => [thread, ...prev]);
      setActiveThreadId(thread.id);
      router.replace(`/assistant?thread=${thread.id}`);
      setMessages([]);
      return thread.id as string;
    } catch {
      return null;
    }
  }, [router]);

  // Load threads
  useEffect(() => {
    apiJson<AiThread[]>("/api/ai/threads")
      .then((data) => {
        if (Array.isArray(data)) setThreads(data);
      })
      .catch(() => {});
  }, []);

  // Load projects for WorkSuggestionCard
  useEffect(() => {
    apiJson<{ id: string; name: string }[]>("/api/projects")
      .then((data) => {
        if (Array.isArray(data)) {
          setProjects(
            data.map((p) => ({
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
  }, [createThread, initialProjectId, initialThreadId]);

  // Load messages + assistant runs when active thread changes
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    setLoadingThread(true);
    const threadId = activeThreadId;
    Promise.all([
      apiJson<{ messages?: AiMsg[] }>(`/api/ai/threads/${threadId}/messages`),
      apiJson<{ runs?: AssistantRunStatusDto[] }>(
        `/api/ai/threads/${threadId}/runs`,
      ).catch(() => ({ runs: [] as AssistantRunStatusDto[] })),
    ])
      .then(([data, runsData]) => {
        if (!data.messages) return;
        const now = Date.now();
        const mapped: StreamingMsg[] = data.messages.map((m: AiMsg) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          workSuggestion: m.workSuggestion as WorkSuggestion | null | undefined,
          pendingApprovals: (m.pendingActions ?? []).map((a) => {
            const expired =
              a.status === "pending" &&
              new Date(a.expiresAt).getTime() < now;
            return {
              actionId: a.id,
              draftType: a.type,
              title: a.title,
              preview: a.preview,
              status: expired
                ? ("expired" as const)
                : (a.status as
                    | "pending"
                    | "executed"
                    | "rejected"
                    | "failed"
                    | "expired"),
              failureReason: a.failureReason ?? undefined,
            };
          }),
        }));

        // 按 Run.assistantMessageId 精确挂载；禁止 runs[0] → 最后一条 assistant
        setMessages(
          attachRunsToAssistantMessages(mapped, runsData.runs ?? []),
        );
      })
      .catch(() => {})
      .finally(() => setLoadingThread(false));
  }, [activeThreadId]);

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

  const handleFileUpload = async (file: File) => {
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/api/ai/upload-file", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "文件上传失败");
        return;
      }
      const data = await res.json();
      setAttachedFile({ name: data.fileName, text: data.text });
    } catch (err) {
      console.error("File upload error:", err);
      alert("文件解析失败");
    } finally {
      setUploadingFile(false);
    }
  };

  const orgReady = !orgLoading && !!orgId && !ambiguous;
  const orgBlockReason = orgLoading
    ? "正在加载组织信息…"
    : ambiguous
      ? "请先选择当前工作组织，再开始对话"
      : !orgId
        ? "当前账号尚未关联可用组织，请联系管理员或先加入组织"
        : null;

  const handleSend = async (text?: string) => {
    let content = (text || input).trim();
    if (!content || isLoading) return;
    if (!orgReady) return;

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
    let assistantId = `assistant-${Date.now()}`;
    const assistantMsg: StreamingMsg = {
      id: assistantId,
      role: "assistant",
      content: "",
      isStreaming: true,
      agentSteps: [createThinkStep()],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setAttachedFile(null);
    setIsLoading(true);

    try {
      // Phase 3B-A：单一主入口。业务路由由服务端 dispatch 决定，禁止前端 Supervisor→SSE 双路由。
      const payload: Record<string, string> = { content, orgId };
      if (attachedFile) {
        payload.fileText = attachedFile.text;
        payload.fileName = attachedFile.name;
      }

      const res = await apiFetch(
        `/api/ai/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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

          // PR3：新事件协议（type=text/tool_start/tool_result/done/mode）
          // 旧协议兼容：parsed.content 仍然追加
          if (parsed.type === "tool_start") {
            const label: string = parsed.label || "处理中";
            const toolName: string = parsed.name || "";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolStatus: `正在${label}…`,
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
            const toolName: string = parsed.name || "";
            const ok = parsed.ok !== false;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolStatus: null,
                      isStreaming: true,
                      agentSteps: completeToolResult(
                        m.agentSteps ?? [],
                        toolName,
                        ok
                      ),
                    }
                  : m
              )
            );
            continue;
          }

          if (parsed.type === "done") {
            if (typeof window !== "undefined") {
              console.debug("[ai.operator.done]", parsed);
            }
            continue;
          }

          if (parsed.type === "mode") {
            // 将临时消息 ID 对齐为服务端持久化 ID（刷新后可按 assistantMessageId 挂卡）
            const realAssistantId =
              typeof parsed.assistantMessageId === "string"
                ? parsed.assistantMessageId
                : null;
            const realUserId =
              typeof parsed.userMessageId === "string"
                ? parsed.userMessageId
                : null;
            if (realAssistantId || realUserId) {
              const prevAssistantId = assistantId;
              const prevUserId = userMsg.id;
              if (realAssistantId) assistantId = realAssistantId;
              if (realUserId) userMsg.id = realUserId;
              setMessages((prev) =>
                prev.map((m) => {
                  if (realUserId && m.id === prevUserId) {
                    return { ...m, id: realUserId };
                  }
                  if (realAssistantId && m.id === prevAssistantId) {
                    return { ...m, id: realAssistantId };
                  }
                  return m;
                }),
              );
            }
            continue;
          }

          // Phase 3B-A：统一七态卡片（只读 event.run.status）
          if (parsed.type === "run_status") {
            const runPayload = parsed.run;
            if (isAssistantRunStatusDto(runPayload)) {
              const targetId =
                runPayload.assistantMessageId &&
                runPayload.assistantMessageId.length > 0
                  ? runPayload.assistantMessageId
                  : assistantId;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === targetId || m.id === assistantId
                    ? { ...m, id: targetId, assistantRun: runPayload, isStreaming: true }
                    : m,
                ),
              );
            }
            continue;
          }

          // PR4：AI 生成了待审批草稿 → 挂到当前 assistant 消息下
          if (parsed.type === "approval_required" && parsed.actionId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const existing = m.pendingApprovals ?? [];
                if (existing.some((p) => p.actionId === parsed.actionId)) return m;
                const steps = m.agentSteps ?? [];
                const hasApprove = steps.some(
                  (s) =>
                    s.kind === "approve" &&
                    s.detail === String(parsed.actionId)
                );
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
                  agentSteps: hasApprove
                    ? steps
                    : [
                        ...steps.map((s) =>
                          s.status === "running"
                            ? { ...s, status: "done" as const, endedAt: Date.now() }
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
            notifyPendingActionsChanged();
            continue;
          }

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
                      toolStatus: null,
                      agentSteps: markReplying(m.agentSteps ?? []),
                    }
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
                toolStatus: null,
                agentSteps: finalizeSteps(m.agentSteps ?? []),
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

  if (noApiKey) return <AiServiceConfigHint variant="full" />;

  const activeThread = threads.find((t) => t.id === activeThreadId);

  // PR4：审批卡片状态更新（approve / reject 的结果回流）
  const handleApprovalChange: NonNullable<
    ComponentProps<typeof ChatPanel>["onApprovalChange"]
  > = (messageId, next) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              pendingApprovals: (m.pendingApprovals ?? []).map((p) =>
                p.actionId === next.actionId ? next : p,
              ),
            }
          : m,
      ),
    );
  };

  // Commit 6：按 assistantMessageId 精确更新任务卡（禁止挂最后一条）
  const handleRunUpdate = (run: AssistantRunStatusDto) => {
    const targetId = run.assistantMessageId;
    if (!targetId) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === targetId ? { ...m, assistantRun: run } : m,
      ),
    );
  };

  const handleRunRetry = async (run: AssistantRunStatusDto) => {
    if (!activeThreadId || !run.canRetry) return;
    const res = await apiFetch(
      `/api/ai/threads/${activeThreadId}/runs/${run.runId}/retry`,
      { method: "POST" },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "重试失败");
      return;
    }
    // 消费 SSE 后再刷新挂载（按 assistantMessageId）
    const reader = res.body?.getReader();
    if (reader) {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
    const data = await apiJson<{ messages?: AiMsg[] }>(
      `/api/ai/threads/${activeThreadId}/messages`,
    ).catch(() => null);
    const runsData = await apiJson<{ runs?: AssistantRunStatusDto[] }>(
      `/api/ai/threads/${activeThreadId}/runs`,
    ).catch(() => ({ runs: [] as AssistantRunStatusDto[] }));
    if (data?.messages) {
      const now = Date.now();
      const mapped: StreamingMsg[] = data.messages.map((m: AiMsg) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        workSuggestion: m.workSuggestion as WorkSuggestion | null | undefined,
        pendingApprovals: (m.pendingActions ?? []).map((a) => {
          const expired =
            a.status === "pending" &&
            new Date(a.expiresAt).getTime() < now;
          return {
            actionId: a.id,
            draftType: a.type,
            title: a.title,
            preview: a.preview,
            status: expired
              ? ("expired" as const)
              : (a.status as
                  | "pending"
                  | "executed"
                  | "rejected"
                  | "failed"
                  | "expired"),
            failureReason: a.failureReason ?? undefined,
          };
        }),
      }));
      setMessages(
        attachRunsToAssistantMessages(mapped, runsData.runs ?? []),
      );
    }
  };

  return (
    <div className="flex h-full bg-[#f5f6f6] tracking-normal text-[#171a19]">
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

      <div className="flex min-w-0 flex-1 flex-col bg-white/70">
        {ambiguous && (
          <div className="border-b border-black/[0.06] bg-white/90 px-3 py-2 backdrop-blur-xl sm:px-5">
            <OrgSelectBanner
              variant="assistant"
              onSelected={() => inputRef.current?.focus()}
            />
          </div>
        )}
        {!orgLoading && !ambiguous && !orgId && (
          <div className="border-b border-[#b54747]/15 bg-[#fff7f7] px-4 py-2.5 text-xs text-[#9e3e3e]">
            当前账号尚未关联可用组织，请联系管理员添加组织成员关系。
          </div>
        )}
        <ChatPanel
          messages={messages}
          activeThreadId={activeThreadId}
          activeThread={activeThread}
          isLoading={isLoading}
          loadingThread={loadingThread}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          projects={projects}
          attachedFile={attachedFile}
          onClearAttachedFile={() => setAttachedFile(null)}
          onFileUpload={handleFileUpload}
          uploadingFile={uploadingFile}
          onShowMobileSidebar={() => setShowMobileSidebar(true)}
          inputRef={inputRef}
          onApprovalChange={handleApprovalChange}
          onRunUpdate={handleRunUpdate}
          onRunRetry={handleRunRetry}
          onOpenThread={(id) => {
            setActiveThreadId(id);
            router.replace(`/assistant?thread=${id}`);
          }}
          orgReady={orgReady}
          orgBlockReason={orgBlockReason}
        />
      </div>
    </div>
  );
}
