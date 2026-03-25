"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { AGENT_TYPE_LABELS, label } from "@/lib/i18n/labels";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { AgentStatusBadge, AgentTypeBadge } from "@/components/agent";

interface EnvRow { id: string; name: string; code: string; status: string }

interface AgentRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  environment: { id: string; code: string; name: string };
  modelProvider: string;
  modelName: string;
  activeVersion: { id: string; version: number } | null;
  toolCount: number;
  prompt: { id: string; key: string; name: string } | null;
  knowledgeBase: { id: string; key: string; name: string } | null;
  updatedBy: { id: string; name: string | null } | null;
  updatedAt: string;
}

export default function AgentListPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();

  const [envs, setEnvs] = useState<EnvRow[]>([]);
  const [envId, setEnvId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [list, setList] = useState<AgentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cKey, setCKey] = useState("");
  const [cName, setCName] = useState("");
  const [cType, setCType] = useState("chat");
  const [cDesc, setCDesc] = useState("");

  const activeEnvs = useMemo(() => envs.filter((e) => e.status === "active"), [envs]);

  const loadInit = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}`);
      const data = await res.json();
      setCanManage(data.canManage === true);
      const envRes = await apiFetch(`/api/projects/${projectId}/environments`);
      const envData = await envRes.json();
      const envList: EnvRow[] = envData.environments ?? [];
      setEnvs(envList);
      const active = envList.filter((e) => e.status === "active");
      const testEnv = active.find((e) => e.code === "test") ?? active[0];
      if (testEnv) setEnvId(testEnv.id);
    } catch { /* ignore */ }
  }, [projectId]);

  const loadList = useCallback(async (eid: string, kw: string, tp: string, st: string, pg: number) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (eid) q.set("environmentId", eid);
      if (kw) q.set("keyword", kw);
      if (tp) q.set("type", tp);
      if (st) q.set("status", st);
      q.set("page", String(pg));
      q.set("pageSize", "20");
      const res = await apiFetch(`/api/projects/${projectId}/agents?${q}`);
      const data = await res.json();
      setList(data.agents ?? []);
      setTotal(data.total ?? 0);
      setPage(data.page ?? 1);
      setTotalPages(data.totalPages ?? 1);
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadInit(); }, [loadInit]);
  useEffect(() => {
    if (envId) loadList(envId, keyword, typeFilter, statusFilter, 1);
  }, [envId, loadList, keyword, typeFilter, statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadList(envId, keyword, typeFilter, statusFilter, 1);
  };

  const clearFilters = () => {
    setKeyword(""); setTypeFilter(""); setStatusFilter("");
  };

  const hasFilters = keyword || typeFilter || statusFilter;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cKey.trim() || !cName.trim() || !envId) return;
    setCreating(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environmentId: envId,
          key: cKey.trim(),
          name: cName.trim(),
          type: cType,
          description: cDesc.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/projects/${projectId}/agents/${data.agent.id}`);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "创建失败");
      }
    } catch { alert("网络错误"); }
    setCreating(false);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="flex items-center gap-3">
        <Link href={`/projects/${projectId}`} className="text-muted hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Agent 管理</h1>
          <p className="text-xs text-muted">配置与管理 AI 智能体</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus size={14} /> 新建 Agent
          </button>
        )}
      </div>

      {/* Environment switcher */}
      {activeEnvs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeEnvs.map((e) => (
            <button
              key={e.id}
              onClick={() => { setEnvId(e.id); setPage(1); }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                envId === e.id
                  ? "bg-accent text-white"
                  : "bg-card-bg text-muted hover:bg-background"
              }`}
            >
              {e.name} ({e.code})
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索 Agent 名称或 key..."
            className="w-full rounded-lg border border-border bg-card-bg py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-card-bg px-2 py-1.5 text-xs"
        >
          <option value="">全部类型</option>
          {Object.entries(AGENT_TYPE_LABELS).map(([val, lbl]) => (
            <option key={val} value={val}>{lbl}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-card-bg px-2 py-1.5 text-xs"
        >
          <option value="">全部状态</option>
          <option value="active">活跃</option>
          <option value="draft">草稿</option>
          <option value="archived">已归档</option>
        </select>
        {hasFilters && (
          <button type="button" onClick={clearFilters} className="text-xs text-muted hover:text-foreground">
            <X size={14} />
          </button>
        )}
      </form>

      {/* Create Dialog */}
      {showCreate && (
        <div className="rounded-xl border border-border bg-card-bg p-4">
          <h3 className="mb-3 text-sm font-semibold">新建 Agent</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted">标识 Key *</label>
                <input value={cKey} onChange={(e) => setCKey(e.target.value)} placeholder="如 my-agent" required
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">名称 *</label>
                <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="客服助手" required
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted">类型</label>
                <select value={cType} onChange={(e) => setCType(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm">
                  {Object.entries(AGENT_TYPE_LABELS).map(([val, lbl]) => (
                    <option key={val} value={val}>{lbl}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">描述</label>
                <input value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="可选"
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs">取消</button>
              <button type="submit" disabled={creating} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50">
                {creating ? "创建中..." : "创建"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12 text-muted"><Loader2 className="animate-spin" /></div>
      ) : list.length === 0 ? (
        hasFilters ? (
          <EmptyState title="没有找到匹配的 Agent" description="尝试修改搜索条件" />
        ) : (
          <EmptyState title="暂无 Agent" description={canManage ? "点击「新建 Agent」开始创建" : "该环境下暂无 Agent"} />
        )
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted">共 {total} 个 Agent</p>
          <ul className="space-y-2">
            {list.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/projects/${projectId}/agents/${a.id}`}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card-bg p-4 transition-colors hover:bg-background/50"
                >
                  <Bot className="mt-0.5 shrink-0 text-muted" size={18} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.name}</span>
                      <AgentStatusBadge status={a.status} />
                      <AgentTypeBadge type={a.type} />
                      <code className="rounded bg-card-bg px-1 text-[10px] text-muted">{a.key}</code>
                    </div>
                    {a.description && <p className="mt-0.5 text-xs text-muted line-clamp-1">{a.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{a.modelProvider}/{a.modelName}</span>
                      {a.activeVersion && <span>v{a.activeVersion.version}</span>}
                      {a.toolCount > 0 && <span>{a.toolCount} 工具</span>}
                    </div>
                    {(a.prompt || a.knowledgeBase) && (
                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted">
                        {a.prompt && (
                          <span className="rounded bg-[rgba(128,80,120,0.08)] px-1.5 py-0.5 text-[#805078]">
                            模板: {a.prompt.key}
                          </span>
                        )}
                        {a.knowledgeBase && (
                          <span className="rounded bg-[rgba(45,106,122,0.08)] px-1.5 py-0.5 text-[#2d6a7a]">
                            知识库: {a.knowledgeBase.key}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    {new Date(a.updatedAt).toLocaleDateString("zh-CN")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} onPageChange={(pg) => { setPage(pg); loadList(envId, keyword, typeFilter, statusFilter, pg); }} />
        </div>
      )}
    </div>
  );
}
