"use client";

import { Suspense, useState, useRef, useEffect, type ComponentProps } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { extractWorkSuggestion } from "@/lib/ai/parser";
import type { WorkSuggestion } from "@/lib/ai/schemas";
import type { SimpleProject } from "@/components/work-suggestion-card";
import { AiServiceConfigHint } from "@/components/ai-service-config-hint";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { ThreadSidebar, type AiThread } from "./thread-list";
import { ChatPanel, type StreamingMsg } from "./chat-panel";

// ── 类型 ──────────────────────────────────────────────────────

interface AiMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  workSuggestion?: WorkSuggestion | null;
  createdAt: string;
}

function cleanStreamingText(raw: string): string {
  for (const marker of ["[WORK_JSON]", "[TASK_JSON]"]) {
    const idx = raw.indexOf(marker);
    if (idx !== -1) return raw.substring(0, idx).trim();
  }
  return raw;
}

const CHANNEL_LABELS: Record<string, string> = {
  wechat: "微信",
  xiaohongshu: "小红书",
  facebook: "Facebook",
  email: "邮件",
};

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
  const [attachedFile, setAttachedFile] = useState<{ name: string; text: string } | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [channelMode, setChannelMode] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProjectId]);

  // Load messages when active thread changes
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    setLoadingThread(true);
    apiJson<{ messages?: AiMsg[] }>(`/api/ai/threads/${activeThreadId}/messages`)
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

  const handleSend = async (text?: string) => {
    let content = (text || input).trim();
    if (!content || isLoading) return;

    if (channelMode) {
      const chLabel = CHANNEL_LABELS[channelMode] || channelMode;
      content = `[渠道: ${chLabel}] ${content}\n\n请按${chLabel}渠道风格生成话术。`;
    }

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
    setAttachedFile(null);
    setIsLoading(true);

    try {
      const payload: Record<string, string> = { content };
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
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, toolStatus: `正在${label}…`, isStreaming: true }
                  : m
              )
            );
            continue;
          }

          if (parsed.type === "tool_result") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, toolStatus: null, isStreaming: true }
                  : m
              )
            );
            continue;
          }

          if (parsed.type === "done") {
            if (typeof window !== "undefined") {
              // 开发时方便观察 —— 生产也无伤
              console.debug("[ai.operator.done]", parsed);
            }
            continue;
          }

          if (parsed.type === "mode") continue;

          // PR4：AI 生成了待审批草稿 → 挂到当前 assistant 消息下
          if (parsed.type === "approval_required" && parsed.actionId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const existing = m.pendingApprovals ?? [];
                if (existing.some((p) => p.actionId === parsed.actionId)) return m;
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
                };
              })
            );
            continue;
          }

          if (parsed.content) {
            fullText += parsed.content;
            const displayText = cleanStreamingText(fullText);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: displayText, isStreaming: true, toolStatus: null }
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
        channelMode={channelMode}
        onChannelModeChange={setChannelMode}
        onShowMobileSidebar={() => setShowMobileSidebar(true)}
        inputRef={inputRef}
        onApprovalChange={handleApprovalChange}
      />
    </div>
  );
}
