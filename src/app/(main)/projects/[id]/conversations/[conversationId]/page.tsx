"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  Send,
  Pencil,
  Check,
  X,
  Play,
  AlertTriangle,
  Wrench,
  ChevronDown,
  ChevronRight,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import {
  ConversationStatusBadge,
  ChannelBadge,
  ConversationContextCard,
  ConversationStatsCard,
  MessageTimeline,
} from "@/components/conversation";
import {
  FeedbackStatusBadge,
  RatingBadge,
  RatingInput,
  IssueTypeBadge,
  ISSUE_TYPE_OPTIONS,
} from "@/components/feedback";

interface ConvDetail {
  id: string;
  title: string;
  channel: string;
  status: string;
  environment: { id: string; code: string; name: string };
  user: { id: string; name: string | null; email: string } | null;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  avgLatencyMs: number;
  runtimeStatus?: string;
  lastErrorMessage?: string | null;
  runCount?: number;
  agentId?: string | null;
  startedAt: string;
  lastMessageAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MessageItem {
  id: string;
  role: string;
  content: string;
  contentType: string;
  sequence: number;
  modelName: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: string;
  errorMessage: string | null;
  toolName: string | null;
  toolCallId: string | null;
  parentMessageId: string | null;
  metadataJson: string | null;
  createdAt: string;
}

interface ContextData {
  id: string;
  promptKey: string | null;
  knowledgeBaseKey: string | null;
  systemPromptSnapshot: string | null;
  retrievalConfigJson: string | null;
  extraConfigJson: string | null;
  createdAt: string;
}

interface ToolTrace {
  id: string;
  toolKey: string;
  toolName: string;
  toolCallId: string | null;
  inputJson: string | null;
  outputJson: string | null;
  status: string;
  errorMessage: string | null;
  durationMs: number;
  createdAt: string;
}

interface ConvFeedbackItem {
  id: string;
  rating: number;
  scoreAccuracy: number | null;
  scoreHelpfulness: number | null;
  scoreSafety: number | null;
  scoreCompleteness: number | null;
  sentiment: string;
  issueType: string | null;
  note: string | null;
  status: string;
  createdById: string;
  createdAt: string;
  tags: { tag: { id: string; label: string; color: string } }[];
}

interface TagItem {
  id: string;
  key: string;
  label: string;
  category: string;
  color: string;
}

type Tab = "messages" | "context" | "trace" | "feedback";

export default function ConversationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const conversationId = params.conversationId as string;

  const [canManage, setCanManage] = useState(false);
  const [conv, setConv] = useState<ConvDetail | null>(null);
  const [promptInfo, setPromptInfo] = useState<{
    id: string;
    key: string;
    name: string;
    version: number | null;
  } | null>(null);
  const [kbInfo, setKbInfo] = useState<{
    id: string;
    key: string;
    name: string;
    version: number | null;
  } | null>(null);
  const [contextSnapshot, setContextSnapshot] = useState<ContextData | null>(
    null
  );
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState<Tab>("messages");

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);

  const [newMsgContent, setNewMsgContent] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const [running, setRunning] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const [traces, setTraces] = useState<ToolTrace[]>([]);
  const [tracesLoaded, setTracesLoaded] = useState(false);

  // Feedback state
  const [feedbacks, setFeedbacks] = useState<ConvFeedbackItem[]>([]);
  const [feedbacksLoaded, setFeedbacksLoaded] = useState(false);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [tagsLoaded, setTagsLoaded] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [fbRating, setFbRating] = useState(0);
  const [fbAccuracy, setFbAccuracy] = useState(0);
  const [fbHelpfulness, setFbHelpfulness] = useState(0);
  const [fbSafety, setFbSafety] = useState(0);
  const [fbCompleteness, setFbCompleteness] = useState(0);
  const [fbIssueType, setFbIssueType] = useState("");
  const [fbSentiment, setFbSentiment] = useState("neutral");
  const [fbNote, setFbNote] = useState("");
  const [fbTagIds, setFbTagIds] = useState<string[]>([]);
  const [fbSubmitting, setFbSubmitting] = useState(false);

  // Message feedback dialog
  const [msgFbTarget, setMsgFbTarget] = useState<string | null>(null);
  const [msgFbRating, setMsgFbRating] = useState(0);
  const [msgFbIssueType, setMsgFbIssueType] = useState("");
  const [msgFbNote, setMsgFbNote] = useState("");
  const [msgFbTagIds, setMsgFbTagIds] = useState<string[]>([]);
  const [msgFbSubmitting, setMsgFbSubmitting] = useState(false);

  const loadConversation = useCallback(() => {
    return apiFetch(
      `/api/projects/${projectId}/conversations/${conversationId}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          setConv(null);
        } else {
          setConv(d.conversation);
          setPromptInfo(d.prompt ?? null);
          setKbInfo(d.knowledgeBase ?? null);
          setContextSnapshot(d.contextSnapshot ?? null);
          setError("");
        }
      });
  }, [projectId, conversationId]);

  const loadMessages = useCallback(() => {
    return apiFetch(
      `/api/projects/${projectId}/conversations/${conversationId}/messages?pageSize=200`
    )
      .then((r) => r.json())
      .then((d) => {
        setMessages(d.messages ?? []);
      });
  }, [projectId, conversationId]);

  const loadTraces = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversations/${conversationId}/tool-traces`
      );
      const d = await res.json();
      setTraces(d.traces ?? []);
      setTracesLoaded(true);
    } catch { /* ignore */ }
  }, [projectId, conversationId]);

  const loadFeedbacks = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversation-feedbacks?conversationId=${conversationId}&pageSize=50`
      );
      const d = await res.json();
      setFeedbacks(d.items ?? []);
      setFeedbacksLoaded(true);
    } catch { /* ignore */ }
  }, [projectId, conversationId]);

  const loadTags = useCallback(async () => {
    if (tagsLoaded) return;
    try {
      const res = await apiFetch(`/api/projects/${projectId}/evaluation-tags?status=active`);
      const d = await res.json();
      setTags(d.tags ?? []);
      setTagsLoaded(true);
    } catch { /* ignore */ }
  }, [projectId, tagsLoaded]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/projects/${projectId}`).then((r) => r.json()),
      loadConversation(),
      loadMessages(),
    ])
      .then(([proj]) => {
        setCanManage(!!proj.canManage);
      })
      .finally(() => setLoading(false));
  }, [projectId, loadConversation, loadMessages]);

  async function saveTitle() {
    if (!titleDraft.trim()) return;
    setTitleSaving(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversations/${conversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: titleDraft.trim() }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "保存失败");
      }
      setEditingTitle(false);
      loadConversation();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setTitleSaving(false);
    }
  }

  async function updateStatus(newStatus: string) {
    const msg =
      newStatus === "archived"
        ? "确定归档该会话？"
        : newStatus === "completed"
          ? "确定标记为已完成？"
          : null;
    if (msg && !confirm(msg)) return;
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversations/${conversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "操作失败");
      }
      loadConversation();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function sendAndRun(e: React.FormEvent) {
    e.preventDefault();
    if (!newMsgContent.trim()) return;
    setMsgSending(true);
    setRunning(true);
    setRuntimeError(null);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            content: newMsgContent,
            run: true,
          }),
        }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "发送失败");
      if (d.runtime?.error) {
        setRuntimeError(d.runtime.error);
      }
      setNewMsgContent("");
      await Promise.all([loadConversation(), loadMessages()]);
      if (tracesLoaded) loadTraces();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setMsgSending(false);
      setRunning(false);
    }
  }

  async function sendOnly(e: React.FormEvent) {
    e.preventDefault();
    if (!newMsgContent.trim()) return;
    setMsgSending(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            content: newMsgContent,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "发送失败");
      }
      setNewMsgContent("");
      await Promise.all([loadConversation(), loadMessages()]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "发送失败");
    } finally {
      setMsgSending(false);
    }
  }

  async function triggerRun() {
    setRunning(true);
    setRuntimeError(null);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversations/${conversationId}/run`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "运行失败");
      if (d.result?.error) {
        setRuntimeError(d.result.error);
      }
      await Promise.all([loadConversation(), loadMessages()]);
      if (tracesLoaded) loadTraces();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "运行失败");
    } finally {
      setRunning(false);
    }
  }

  async function submitConvFeedback() {
    if (fbRating < 1) return;
    setFbSubmitting(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversation-feedbacks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            rating: fbRating,
            scoreAccuracy: fbAccuracy || undefined,
            scoreHelpfulness: fbHelpfulness || undefined,
            scoreSafety: fbSafety || undefined,
            scoreCompleteness: fbCompleteness || undefined,
            sentiment: fbSentiment,
            issueType: fbIssueType || undefined,
            note: fbNote || undefined,
            tagIds: fbTagIds.length > 0 ? fbTagIds : undefined,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "提交失败");
      }
      setShowFeedbackForm(false);
      setFbRating(0);
      setFbAccuracy(0);
      setFbHelpfulness(0);
      setFbSafety(0);
      setFbCompleteness(0);
      setFbIssueType("");
      setFbSentiment("neutral");
      setFbNote("");
      setFbTagIds([]);
      loadFeedbacks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "提交失败");
    } finally {
      setFbSubmitting(false);
    }
  }

  async function submitMsgFeedback() {
    if (!msgFbTarget || msgFbRating < 1) return;
    setMsgFbSubmitting(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/message-feedbacks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            messageId: msgFbTarget,
            rating: msgFbRating,
            issueType: msgFbIssueType || undefined,
            note: msgFbNote || undefined,
            tagIds: msgFbTagIds.length > 0 ? msgFbTagIds : undefined,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "提交失败");
      }
      setMsgFbTarget(null);
      setMsgFbRating(0);
      setMsgFbIssueType("");
      setMsgFbNote("");
      setMsgFbTagIds([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "提交失败");
    } finally {
      setMsgFbSubmitting(false);
    }
  }

  function openMsgFeedback(messageId: string) {
    setMsgFbTarget(messageId);
    setMsgFbRating(0);
    setMsgFbIssueType("");
    setMsgFbNote("");
    setMsgFbTagIds([]);
    if (!tagsLoaded) loadTags();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (error || !conv) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <button
          type="button"
          onClick={() =>
            router.push(`/projects/${projectId}/conversations`)
          }
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted"
        >
          <ArrowLeft size={14} /> 返回
        </button>
        <p className="text-danger">{error || "未找到会话"}</p>
      </div>
    );
  }

  const isActive = conv.status === "active";

  const tabs: { key: Tab; label: string; disabled?: boolean }[] = [
    { key: "messages", label: "消息记录" },
    { key: "context", label: "上下文" },
    { key: "trace", label: "工具调用" },
    { key: "feedback", label: "评估反馈" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <button
        type="button"
        onClick={() =>
          router.push(`/projects/${projectId}/conversations`)
        }
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 会话列表
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <MessageSquare className="mt-1 shrink-0 text-muted" size={24} />
          <div>
            <div className="flex items-center gap-2">
              {editingTitle ? (
                <div className="flex items-center gap-1">
                  <input
                    className="rounded border border-border bg-background px-2 py-1 text-lg font-bold"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                    autoFocus
                  />
                  <button type="button" onClick={saveTitle} disabled={titleSaving} className="rounded p-1 text-[#2e7a56] hover:bg-[rgba(46,122,86,0.04)]">
                    <Check size={16} />
                  </button>
                  <button type="button" onClick={() => setEditingTitle(false)} className="rounded p-1 text-muted hover:bg-background">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <h1 className="text-xl font-bold">{conv.title || "无标题"}</h1>
                  {canManage && (
                    <button type="button" onClick={() => { setTitleDraft(conv.title); setEditingTitle(true); }} className="rounded p-1 text-muted hover:bg-background">
                      <Pencil size={14} />
                    </button>
                  )}
                </>
              )}
              <ConversationStatusBadge status={conv.status} />
              <ChannelBadge channel={conv.channel} />
              {conv.runtimeStatus && conv.runtimeStatus !== "idle" && (
                <span className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] font-medium",
                  conv.runtimeStatus === "running" && "bg-[rgba(43,96,85,0.08)] text-[#2b6055] animate-pulse",
                  conv.runtimeStatus === "completed" && "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]",
                  conv.runtimeStatus === "failed" && "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]",
                )}>
                  {conv.runtimeStatus === "running" ? "运行中" : conv.runtimeStatus === "completed" ? "已运行" : "运行失败"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {conv.user?.name ? conv.user.name : ""}
              {conv.runCount ? ` · ${conv.runCount} 次运行` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canManage && isActive && (
            <button
              type="button"
              onClick={triggerRun}
              disabled={running}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? "运行中..." : "运行 Agent"}
            </button>
          )}
          {canManage && isActive && (
            <button type="button" onClick={() => updateStatus("completed")} className="rounded-[var(--radius-sm)] border border-[rgba(46,122,86,0.2)] px-3 py-2 text-sm text-success hover:bg-success-bg">
              标记完成
            </button>
          )}
          {canManage && conv.status !== "archived" && (
            <button type="button" onClick={() => updateStatus("archived")} className="rounded-[var(--radius-sm)] border border-border px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-[rgba(26,36,32,0.03)]">
              归档
            </button>
          )}
          {canManage && conv.status === "archived" && (
            <button type="button" onClick={() => updateStatus("active")} className="rounded-[var(--radius-sm)] border border-[rgba(46,122,86,0.2)] px-3 py-2 text-sm text-success hover:bg-success-bg">
              恢复
            </button>
          )}
        </div>
      </div>

      {/* Runtime error */}
      {(runtimeError || conv.lastErrorMessage) && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
          <div className="text-sm text-danger">
            <p className="font-medium">Runtime 错误</p>
            <p className="mt-0.5 text-xs opacity-80">{runtimeError || conv.lastErrorMessage}</p>
          </div>
          {runtimeError && (
            <button type="button" onClick={() => setRuntimeError(null)} className="ml-auto text-danger/50 hover:text-danger">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Stats */}
      <ConversationStatsCard
        messageCount={conv.messageCount}
        inputTokens={conv.inputTokens}
        outputTokens={conv.outputTokens}
        totalTokens={conv.totalTokens}
        estimatedCost={conv.estimatedCost}
        avgLatencyMs={conv.avgLatencyMs}
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={t.disabled}
            onClick={() => {
              if (t.disabled) return;
              setActiveTab(t.key);
              if (t.key === "trace" && !tracesLoaded) loadTraces();
              if (t.key === "feedback" && !feedbacksLoaded) { loadFeedbacks(); loadTags(); }
            }}
            className={cn(
              "border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground",
              t.disabled && "cursor-not-allowed opacity-40"
            )}
          >
            {t.label}
            {t.disabled && (
              <span className="ml-1 text-[10px] font-normal">(soon)</span>
            )}
          </button>
        ))}
      </div>

      {/* Messages tab */}
      {activeTab === "messages" && (
        <div className="space-y-4">
          <MessageTimeline messages={messages} onFeedback={canManage ? openMsgFeedback : undefined} />

          {canManage && isActive && (
            <div className="rounded-xl border border-border bg-card-bg p-3">
              <textarea
                className="min-h-[48px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                placeholder="输入消息内容... (Ctrl+Enter 发送并运行)"
                value={newMsgContent}
                onChange={(e) => setNewMsgContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    sendAndRun(e);
                  }
                }}
                rows={2}
              />
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[10px] text-muted">
                  Ctrl+Enter = 发送并运行 Agent
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={sendOnly}
                    disabled={msgSending || !newMsgContent.trim()}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-background disabled:opacity-50"
                  >
                    <Send size={12} />
                    仅发送
                  </button>
                  <button
                    type="button"
                    onClick={sendAndRun}
                    disabled={msgSending || running || !newMsgContent.trim()}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                  >
                    {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    {running ? "运行中..." : "发送并运行"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Context tab */}
      {activeTab === "context" && (
        <div className="space-y-4">
          <ConversationContextCard
            environment={null}
            prompt={promptInfo}
            knowledgeBase={kbInfo}
            systemPromptPreview={contextSnapshot?.systemPromptSnapshot}
          />
          {contextSnapshot && (
            <div className="space-y-3 rounded-xl border border-border bg-card-bg p-4">
              <h3 className="text-sm font-semibold text-muted">上下文快照详情</h3>
              <dl className="space-y-2 text-xs">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted">快照时间:</dt>
                  <dd>{new Date(contextSnapshot.createdAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}</dd>
                </div>
                {contextSnapshot.promptKey && (
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted">Prompt Key:</dt>
                    <dd className="font-mono">{contextSnapshot.promptKey}</dd>
                  </div>
                )}
                {contextSnapshot.knowledgeBaseKey && (
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted">KB Key:</dt>
                    <dd className="font-mono">{contextSnapshot.knowledgeBaseKey}</dd>
                  </div>
                )}
                {contextSnapshot.extraConfigJson && (
                  <div>
                    <dt className="mb-1 text-muted">Agent Config:</dt>
                    <pre className="max-h-24 overflow-auto rounded border border-border bg-background p-2 text-[10px]">
                      {formatJson(contextSnapshot.extraConfigJson)}
                    </pre>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      )}

      {/* Trace tab */}
      {activeTab === "trace" && (
        <div className="space-y-3">
          {traces.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">暂无工具调用记录</p>
          ) : (
            traces.map((t) => <TraceCard key={t.id} trace={t} />)
          )}
        </div>
      )}

      {/* Feedback tab */}
      {activeTab === "feedback" && (
        <div className="space-y-4">
          {/* Conversation-level feedback form toggle */}
          {canManage && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { setShowFeedbackForm(!showFeedbackForm); if (!tagsLoaded) loadTags(); }}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
              >
                <Star size={12} />
                提交会话反馈
              </button>
            </div>
          )}

          {/* Conversation feedback form */}
          {showFeedbackForm && (
            <div className="space-y-4 rounded-xl border border-border bg-card-bg p-4">
              <h3 className="text-sm font-semibold">会话级评价</h3>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">总体评分 *</label>
                  <RatingInput value={fbRating} onChange={setFbRating} />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">准确性</label>
                    <RatingInput value={fbAccuracy} onChange={setFbAccuracy} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">帮助性</label>
                    <RatingInput value={fbHelpfulness} onChange={setFbHelpfulness} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">安全性</label>
                    <RatingInput value={fbSafety} onChange={setFbSafety} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">完整性</label>
                    <RatingInput value={fbCompleteness} onChange={setFbCompleteness} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">情感倾向</label>
                    <select
                      value={fbSentiment}
                      onChange={(e) => setFbSentiment(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="positive">正面</option>
                      <option value="neutral">中性</option>
                      <option value="negative">负面</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">问题类型</label>
                    <select
                      value={fbIssueType}
                      onChange={(e) => setFbIssueType(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="">无</option>
                      {ISSUE_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {tags.length > 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">标签</label>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() =>
                            setFbTagIds((prev) =>
                              prev.includes(tag.id)
                                ? prev.filter((id) => id !== tag.id)
                                : [...prev, tag.id]
                            )
                          }
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs transition-colors",
                            fbTagIds.includes(tag.id)
                              ? "border-accent bg-accent/10 text-accent"
                              : "border-border text-muted hover:border-accent/50"
                          )}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">备注</label>
                  <textarea
                    value={fbNote}
                    onChange={(e) => setFbNote(e.target.value)}
                    className="min-h-[60px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                    placeholder="请输入评价备注..."
                    rows={2}
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFeedbackForm(false)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={submitConvFeedback}
                    disabled={fbRating < 1 || fbSubmitting}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                  >
                    {fbSubmitting ? <Loader2 size={12} className="animate-spin" /> : null}
                    提交
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Existing feedbacks list */}
          {!feedbacksLoaded ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted" size={20} /></div>
          ) : feedbacks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">暂无评估反馈</p>
          ) : (
            <div className="space-y-3">
              {feedbacks.map((fb) => (
                <div key={fb.id} className="rounded-xl border border-border bg-card-bg p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <RatingBadge rating={fb.rating} />
                    <FeedbackStatusBadge status={fb.status} />
                    {fb.issueType && <IssueTypeBadge issueType={fb.issueType} />}
                    {fb.tags.map((t) => (
                      <span key={t.tag.id} className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: t.tag.color + "20", color: t.tag.color }}>
                        {t.tag.label}
                      </span>
                    ))}
                    <span className="ml-auto text-[10px] text-muted">
                      {new Date(fb.createdAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
                    </span>
                  </div>
                  {(fb.scoreAccuracy || fb.scoreHelpfulness || fb.scoreSafety || fb.scoreCompleteness) && (
                    <div className="flex gap-4 text-xs text-muted">
                      {fb.scoreAccuracy && <span>准确 {fb.scoreAccuracy}/5</span>}
                      {fb.scoreHelpfulness && <span>帮助 {fb.scoreHelpfulness}/5</span>}
                      {fb.scoreSafety && <span>安全 {fb.scoreSafety}/5</span>}
                      {fb.scoreCompleteness && <span>完整 {fb.scoreCompleteness}/5</span>}
                    </div>
                  )}
                  {fb.note && <p className="text-sm text-foreground/80">{fb.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Message feedback dialog */}
      {msgFbTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMsgFbTarget(null)}>
          <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card-bg p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold">消息级反馈</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">评分 *</label>
                <RatingInput value={msgFbRating} onChange={setMsgFbRating} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">问题类型</label>
                <select
                  value={msgFbIssueType}
                  onChange={(e) => setMsgFbIssueType(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">无</option>
                  {ISSUE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              {tags.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">标签</label>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() =>
                          setMsgFbTagIds((prev) =>
                            prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                          )
                        }
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs transition-colors",
                          msgFbTagIds.includes(tag.id)
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-muted hover:border-accent/50"
                        )}
                      >
                        {tag.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">备注</label>
                <textarea
                  value={msgFbNote}
                  onChange={(e) => setMsgFbNote(e.target.value)}
                  className="min-h-[60px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                  placeholder="描述问题..."
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMsgFbTarget(null)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submitMsgFeedback}
                  disabled={msgFbRating < 1 || msgFbSubmitting}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {msgFbSubmitting ? <Loader2 size={12} className="animate-spin" /> : null}
                  提交
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TraceCard({ trace }: { trace: ToolTrace }) {
  const [open, setOpen] = useState(false);
  const isError = trace.status === "error";
  const isSkipped = trace.status === "skipped";

  return (
    <div className={cn(
      "rounded-[var(--radius-md)] border p-3",
      isError ? "border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.03)]" :
      isSkipped ? "border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.03)]" :
      "border-border bg-card-bg"
    )}>
      <div className="flex items-center gap-2">
        <Wrench size={14} className={isError ? "text-danger" : "text-accent/60"} />
        <span className="font-medium text-sm">{trace.toolName}</span>
        <code className="text-[10px] text-muted">{trace.toolKey}</code>
        <span className={cn(
          "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
          isError ? "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]" : isSkipped ? "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]" : "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
        )}>
          {trace.status}
        </span>
        <span className="text-[10px] text-muted">{trace.durationMs}ms</span>
        <span className="text-[10px] text-muted ml-auto">
          {new Date(trace.createdAt).toLocaleTimeString("zh-CN", { timeZone: "America/Toronto" })}
        </span>
        <button type="button" onClick={() => setOpen(!open)} className="text-muted hover:text-foreground">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>
      {trace.errorMessage && (
        <p className="mt-1 flex items-center gap-1 text-xs text-danger">
          <AlertTriangle size={10} /> {trace.errorMessage}
        </p>
      )}
      {open && (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          {trace.inputJson && (
            <div>
              <p className="mb-0.5 text-[10px] font-semibold text-muted">Input</p>
              <pre className="max-h-32 overflow-auto rounded border border-border bg-background p-2 text-[10px]">
                {formatJson(trace.inputJson)}
              </pre>
            </div>
          )}
          {trace.outputJson && (
            <div>
              <p className="mb-0.5 text-[10px] font-semibold text-muted">Output</p>
              <pre className="max-h-32 overflow-auto rounded border border-border bg-background p-2 text-[10px]">
                {formatJson(trace.outputJson)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}
