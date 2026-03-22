"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Plus,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import {
  ConversationStatusBadge,
  ChannelBadge,
} from "@/components/conversation";

interface EnvRow {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface ConvRow {
  id: string;
  title: string;
  channel: string;
  status: string;
  environment: { id: string; code: string; name: string };
  user: { id: string; name: string | null } | null;
  messageCount: number;
  totalTokens: number;
  estimatedCost: number;
  startedAt: string;
  lastMessageAt: string | null;
  prompt: { id: string; key: string; name: string } | null;
  knowledgeBase: { id: string; key: string; name: string } | null;
}

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "active", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "archived", label: "已归档" },
];

const CHANNEL_OPTIONS = [
  { value: "", label: "全部渠道" },
  { value: "web", label: "Web" },
  { value: "internal", label: "内部" },
  { value: "api", label: "API" },
  { value: "demo", label: "Demo" },
];

export default function ProjectConversationsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [projectName, setProjectName] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [environments, setEnvironments] = useState<EnvRow[]>([]);
  const [envId, setEnvId] = useState("");
  const [list, setList] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // new conversation form
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newPromptId, setNewPromptId] = useState("");
  const [newKbId, setNewKbId] = useState("");
  const [saving, setSaving] = useState(false);
  const [prompts, setPrompts] = useState<
    { id: string; name: string; key: string }[]
  >([]);
  const [kbs, setKbs] = useState<
    { id: string; name: string; key: string }[]
  >([]);

  const activeEnvs = useMemo(
    () => environments.filter((e) => e.status === "active"),
    [environments]
  );

  const loadInit = useCallback(() => {
    return Promise.all([
      apiFetch(`/api/projects/${projectId}`).then((r) => r.json()),
      apiFetch(`/api/projects/${projectId}/environments`).then((r) =>
        r.json()
      ),
    ]).then(([p, e]) => {
      if (p.project) {
        setProjectName(p.project.name);
        setCanManage(!!p.canManage);
      }
      const envs = e.environments ?? [];
      setEnvironments(envs);
      return envs as EnvRow[];
    });
  }, [projectId]);

  const loadList = useCallback(
    (
      selectedEnv: string,
      kw: string = "",
      status: string = "",
      channel: string = "",
      pg: number = 1
    ) => {
      const qs = new URLSearchParams({
        page: String(pg),
        pageSize: "20",
      });
      if (selectedEnv) qs.set("environmentId", selectedEnv);
      if (kw) qs.set("keyword", kw);
      if (status) qs.set("status", status);
      if (channel) qs.set("channel", channel);

      return apiFetch(
        `/api/projects/${projectId}/conversations?${qs.toString()}`
      )
        .then((r) => r.json())
        .then((d) => {
          setList(d.conversations ?? []);
          setTotal(d.total ?? 0);
          setTotalPages(d.totalPages ?? 1);
        });
    },
    [projectId]
  );

  const loadContextOptions = useCallback(
    (envIdVal: string) => {
      if (!envIdVal) return;
      apiFetch(
        `/api/projects/${projectId}/prompts?environmentId=${envIdVal}&pageSize=100`
      )
        .then((r) => r.json())
        .then((d) =>
          setPrompts(
            (d.prompts ?? []).map(
              (p: { id: string; name: string; key: string }) => ({
                id: p.id,
                name: p.name,
                key: p.key,
              })
            )
          )
        )
        .catch(() => setPrompts([]));

      apiFetch(
        `/api/projects/${projectId}/knowledge-bases?environmentId=${envIdVal}&pageSize=100`
      )
        .then((r) => r.json())
        .then((d) =>
          setKbs(
            (d.knowledgeBases ?? []).map(
              (k: { id: string; name: string; key: string }) => ({
                id: k.id,
                name: k.name,
                key: k.key,
              })
            )
          )
        )
        .catch(() => setKbs([]));
    },
    [projectId]
  );

  useEffect(() => {
    setLoading(true);
    loadInit()
      .then((envs) => {
        const first = envs.find((x: EnvRow) => x.status === "active");
        const id0 = first?.id ?? "";
        setEnvId(id0);
        return loadList(id0);
      })
      .finally(() => setLoading(false));
  }, [loadInit, loadList]);

  function handleSearch() {
    setPage(1);
    loadList(envId, keyword, statusFilter, channelFilter, 1);
  }

  function clearFilters() {
    setKeyword("");
    setStatusFilter("");
    setChannelFilter("");
    setPage(1);
    loadList(envId, "", "", "", 1);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!envId) return;
    setSaving(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            environmentId: envId,
            title: newTitle.trim() || undefined,
            initialMessage: newMessage.trim() || undefined,
            promptId: newPromptId || undefined,
            knowledgeBaseId: newKbId || undefined,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "创建失败");
      setShowNew(false);
      setNewTitle("");
      setNewMessage("");
      setNewPromptId("");
      setNewKbId("");
      if (data.conversation?.id) {
        router.push(
          `/projects/${projectId}/conversations/${data.conversation.id}`
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  const hasFilters = keyword || statusFilter || channelFilter;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <button
        type="button"
        onClick={() => router.push(`/projects/${projectId}`)}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> {projectName || "项目"}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">会话管理</h1>
          <p className="mt-1 text-sm text-muted">
            查看和管理项目下的对话记录，追踪上下文与消息历史
          </p>
        </div>
        {canManage && envId && (
          <button
            type="button"
            onClick={() => {
              setShowNew((v) => !v);
              if (!showNew) loadContextOptions(envId);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus size={16} /> 新建测试会话
          </button>
        )}
      </div>

      {/* Environment switcher */}
      {activeEnvs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setEnvId("");
              setPage(1);
              loadList("", keyword, statusFilter, channelFilter, 1);
            }}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium",
              !envId
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card-bg text-muted hover:text-foreground"
            )}
          >
            全部环境
          </button>
          {activeEnvs.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setEnvId(e.id);
                setPage(1);
                loadList(e.id, keyword, statusFilter, channelFilter, 1);
              }}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm font-medium",
                envId === e.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card-bg text-muted hover:text-foreground"
              )}
            >
              {e.name}{" "}
              <span className="text-xs opacity-70">({e.code})</span>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
            placeholder="搜索会话标题..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>
        <select
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
            loadList(envId, keyword, e.target.value, channelFilter, 1);
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={channelFilter}
          onChange={(e) => {
            setChannelFilter(e.target.value);
            setPage(1);
            loadList(envId, keyword, statusFilter, e.target.value, 1);
          }}
        >
          {CHANNEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSearch}
          className="rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
        >
          搜索
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            <X size={14} /> 清除
          </button>
        )}
      </div>

      {/* New conversation form */}
      {showNew && canManage && envId && (
        <form
          onSubmit={handleCreate}
          className="space-y-3 rounded-xl border border-border bg-card-bg p-4"
        >
          <h2 className="font-semibold">新建测试会话</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted">标题</span>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="新会话"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted">Prompt（可选）</span>
              <select
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={newPromptId}
                onChange={(e) => setNewPromptId(e.target.value)}
              >
                <option value="">不绑定</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-muted">知识库（可选）</span>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={newKbId}
              onChange={(e) => setNewKbId(e.target.value)}
            >
              <option value="">不绑定</option>
              {kbs.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.key})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted">初始消息（可选）</span>
            <textarea
              className="mt-1 min-h-[80px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="输入第一条用户消息..."
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "创建中…" : "创建"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm"
              onClick={() => setShowNew(false)}
            >
              取消
            </button>
          </div>
        </form>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <>
          {list.length === 0 ? (
            hasFilters ? (
              <EmptyState
                icon={Search}
                title="无匹配结果"
                description="尝试调整搜索条件或清除筛选"
                action={
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-background"
                  >
                    清除筛选
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={MessageSquare}
                title="暂无会话"
                description={
                  canManage
                    ? "点击「新建测试会话」创建第一个会话记录"
                    : "当前项目下暂无会话记录"
                }
              />
            )
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted">共 {total} 个会话</p>
              <ul className="space-y-2">
                {list.map((conv) => (
                  <li key={conv.id}>
                    <Link
                      href={`/projects/${projectId}/conversations/${conv.id}`}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card-bg p-4 transition-colors hover:bg-background/50"
                    >
                      <MessageSquare
                        className="mt-0.5 shrink-0 text-muted"
                        size={18}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {conv.title || "无标题"}
                          </span>
                          <ConversationStatusBadge status={conv.status} />
                          <ChannelBadge channel={conv.channel} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span>
                            {conv.environment.name} ({conv.environment.code})
                          </span>
                          <span>{conv.messageCount} 条消息</span>
                          {conv.totalTokens > 0 && (
                            <span>
                              {conv.totalTokens.toLocaleString()} tokens
                            </span>
                          )}
                          {conv.user?.name && (
                            <span>{conv.user.name}</span>
                          )}
                        </div>
                        {(conv.prompt || conv.knowledgeBase) && (
                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted">
                            {conv.prompt && (
                              <span className="rounded bg-[rgba(128,80,120,0.08)] px-1.5 py-0.5 text-[#805078]">
                                Prompt: {conv.prompt.key}
                              </span>
                            )}
                            {conv.knowledgeBase && (
                              <span className="rounded bg-[rgba(45,106,122,0.08)] px-1.5 py-0.5 text-[#2d6a7a]">
                                KB: {conv.knowledgeBase.key}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted">
                        {conv.lastMessageAt
                          ? new Date(conv.lastMessageAt).toLocaleString(
                              "zh-CN",
                              { timeZone: "America/Toronto" }
                            )
                          : new Date(conv.startedAt).toLocaleDateString(
                              "zh-CN",
                              { timeZone: "America/Toronto" }
                            )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={(pg) => {
                  setPage(pg);
                  loadList(envId, keyword, statusFilter, channelFilter, pg);
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
