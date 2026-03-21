"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ToolCategoryBadge, AgentStatusBadge } from "@/components/agent";

interface ToolRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  type: string;
  status: string;
  agentCount: number;
  updatedBy: { id: string; name: string | null } | null;
  updatedAt: string;
}

export default function ToolListPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();

  const [keyword, setKeyword] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [list, setList] = useState<ToolRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cKey, setCKey] = useState("");
  const [cName, setCName] = useState("");
  const [cCategory, setCCategory] = useState("builtin");
  const [cType, setCType] = useState("function");
  const [cDesc, setCDesc] = useState("");

  const loadInit = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}`);
      const data = await res.json();
      setCanManage(data.canManage === true);
    } catch { /* ignore */ }
  }, [projectId]);

  const loadList = useCallback(async (kw: string, cat: string, st: string, pg: number) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (kw) q.set("keyword", kw);
      if (cat) q.set("category", cat);
      if (st) q.set("status", st);
      q.set("page", String(pg));
      q.set("pageSize", "20");
      const res = await apiFetch(`/api/projects/${projectId}/tools?${q}`);
      const data = await res.json();
      setList(data.tools ?? []);
      setTotal(data.total ?? 0);
      setPage(data.page ?? 1);
      setTotalPages(data.totalPages ?? 1);
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadInit(); }, [loadInit]);
  useEffect(() => { loadList(keyword, catFilter, statusFilter, 1); }, [loadList, keyword, catFilter, statusFilter]);

  const hasFilters = keyword || catFilter || statusFilter;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cKey.trim() || !cName.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: cKey.trim(), name: cName.trim(), category: cCategory, type: cType,
          description: cDesc.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/projects/${projectId}/tools/${data.tool.id}`);
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
          <h1 className="text-xl font-bold">工具注册表</h1>
          <p className="text-xs text-muted">管理项目内可选工具定义</p>
        </div>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90">
            <Plus size={14} /> 新建工具
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索工具名称或 key..."
            className="w-full rounded-lg border border-border bg-card-bg py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-accent" />
        </div>
        <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-card-bg px-2 py-1.5 text-xs">
          <option value="">全部类别</option>
          <option value="builtin">内置</option>
          <option value="api">API</option>
          <option value="internal">内部</option>
          <option value="integration">集成</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-card-bg px-2 py-1.5 text-xs">
          <option value="">全部状态</option>
          <option value="active">活跃</option>
          <option value="archived">已归档</option>
        </select>
        {hasFilters && (
          <button type="button" onClick={() => { setKeyword(""); setCatFilter(""); setStatusFilter(""); }} className="text-xs text-muted hover:text-foreground">
            <X size={14} />
          </button>
        )}
      </div>

      {showCreate && (
        <div className="rounded-xl border border-border bg-card-bg p-4">
          <h3 className="mb-3 text-sm font-semibold">新建工具</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted">Key *</label>
                <input value={cKey} onChange={(e) => setCKey(e.target.value)} placeholder="web_search" required
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">名称 *</label>
                <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Web 搜索" required
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted">类别</label>
                <select value={cCategory} onChange={(e) => setCCategory(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm">
                  <option value="builtin">内置</option>
                  <option value="api">API</option>
                  <option value="internal">内部</option>
                  <option value="integration">集成</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">类型</label>
                <select value={cType} onChange={(e) => setCType(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm">
                  <option value="function">Function</option>
                  <option value="http">HTTP</option>
                  <option value="builtin">Builtin</option>
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

      {loading ? (
        <div className="flex justify-center py-12 text-muted"><Loader2 className="animate-spin" /></div>
      ) : list.length === 0 ? (
        hasFilters ? (
          <EmptyState title="没有找到匹配的工具" description="尝试修改搜索条件" />
        ) : (
          <EmptyState title="暂无工具" description={canManage ? "点击「新建工具」开始注册" : "该项目下暂无工具"} />
        )
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted">共 {total} 个工具</p>
          <ul className="space-y-2">
            {list.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/projects/${projectId}/tools/${t.id}`}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card-bg p-4 transition-colors hover:bg-background/50"
                >
                  <Wrench className="mt-0.5 shrink-0 text-muted" size={18} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t.name}</span>
                      <AgentStatusBadge status={t.status} />
                      <ToolCategoryBadge category={t.category} />
                      <code className="rounded bg-card-bg px-1 text-[10px] text-muted">{t.key}</code>
                    </div>
                    {t.description && <p className="mt-0.5 text-xs text-muted line-clamp-1">{t.description}</p>}
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <span>类型: {t.type}</span>
                      {t.agentCount > 0 && <span>{t.agentCount} Agent 使用</span>}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    {new Date(t.updatedAt).toLocaleDateString("zh-CN")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} onPageChange={(pg) => { setPage(pg); loadList(keyword, catFilter, statusFilter, pg); }} />
        </div>
      )}
    </div>
  );
}
