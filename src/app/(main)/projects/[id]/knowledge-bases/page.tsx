"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Plus,
  BookOpen,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { KbEnvStatus } from "@/components/knowledge-base";

interface EnvRow {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface CrossEnvVersion {
  envCode: string;
  version: number | null;
  kbId: string;
}

interface KbRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  updatedAt: string;
  updatedBy: { id: string; name: string | null } | null;
  activeVersion: { id: string; version: number } | null;
  documentCount: number;
  crossEnvVersions: CrossEnvVersion[];
}

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "active", label: "活跃" },
  { value: "archived", label: "已归档" },
];

export default function ProjectKnowledgeBasesPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [projectName, setProjectName] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [environments, setEnvironments] = useState<EnvRow[]>([]);
  const [envId, setEnvId] = useState("");
  const [list, setList] = useState<KbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [showNew, setShowNew] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const activeEnvs = useMemo(
    () => environments.filter((e) => e.status === "active"),
    [environments]
  );

  const loadEnvsAndProject = useCallback(() => {
    return Promise.all([
      apiJson(`/api/projects/${projectId}`),
      apiJson(`/api/projects/${projectId}/environments`),
    ]).then(([p, e]: [Record<string, unknown>, Record<string, unknown>]) => {
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
      pg: number = 1
    ) => {
      if (!selectedEnv) {
        setList([]);
        return Promise.resolve();
      }
      const qs = new URLSearchParams({
        environmentId: selectedEnv,
        page: String(pg),
        pageSize: "20",
      });
      if (kw) qs.set("keyword", kw);
      if (status) qs.set("status", status);

      return apiJson<{ error?: string; knowledgeBases?: KbRow[]; total?: number; totalPages?: number }>(
        `/api/projects/${projectId}/knowledge-bases?${qs.toString()}`
      )
        .then((d) => {
          if (d.error) {
            setListError(d.error);
            setList([]);
          } else {
            setListError("");
            setList(d.knowledgeBases ?? []);
            setTotal(d.total ?? 0);
            setTotalPages(d.totalPages ?? 1);
          }
        });
    },
    [projectId]
  );

  useEffect(() => {
    setLoading(true);
    loadEnvsAndProject()
      .then((envs) => {
        const first = envs.find((x: EnvRow) => x.status === "active");
        const id0 = first?.id ?? "";
        setEnvId(id0);
        return id0 ? loadList(id0) : Promise.resolve();
      })
      .finally(() => setLoading(false));
  }, [loadEnvsAndProject, loadList]);

  function handleSearch() {
    setPage(1);
    loadList(envId, keyword, statusFilter, 1);
  }

  function clearFilters() {
    setKeyword("");
    setStatusFilter("");
    setPage(1);
    loadList(envId, "", "", 1);
  }

  function handlePageChange(pg: number) {
    setPage(pg);
    loadList(envId, keyword, statusFilter, pg);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/knowledge-bases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environmentId: envId,
          key,
          name,
          description: description.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "创建失败");
      setShowNew(false);
      setKey("");
      setName("");
      setDescription("");
      setNote("");
      loadList(envId, keyword, statusFilter, page);
      if (data.knowledgeBase?.id) {
        router.push(
          `/projects/${projectId}/knowledge-bases/${data.knowledgeBase.id}`
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  const hasFilters = keyword || statusFilter;

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
          <h1 className="text-xl font-bold">知识库</h1>
          <p className="mt-1 text-sm text-muted">
            按环境隔离管理知识库与文档，支持 test → prod 发布
          </p>
        </div>
        {canManage && envId && (
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus size={16} /> 新建知识库
          </button>
        )}
      </div>

      {activeEnvs.length === 0 ? (
        <div className="rounded-xl border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] p-4 text-sm text-[#9a6a2f]">
          该项目还没有环境。请先在项目详情中创建{" "}
          <strong>test</strong> / <strong>prod</strong> 环境后再管理知识库。
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {activeEnvs.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setEnvId(e.id);
                setPage(1);
                loadList(e.id, keyword, statusFilter, 1);
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

      {envId && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
              placeholder="搜索名称或 key..."
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
              loadList(envId, keyword, e.target.value, 1);
            }}
          >
            {STATUS_OPTIONS.map((o) => (
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
      )}

      {listError && <p className="text-sm text-[#a63d3d]">{listError}</p>}

      {showNew && canManage && envId && (
        <form
          onSubmit={handleCreate}
          className="space-y-3 rounded-xl border border-border bg-card-bg p-4"
        >
          <h2 className="font-semibold">新建知识库</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted">key</span>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="faq_main"
                required
              />
            </label>
            <label className="text-sm">
              <span className="text-muted">名称</span>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-muted">描述（可选）</span>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">首版说明（可选）</span>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
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

      {loading ? (
        <div className="flex justify-center py-12 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : envId ? (
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
                icon={BookOpen}
                title="暂无知识库"
                description="当前环境下暂无知识库，点击「新建知识库」开始"
              />
            )
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                共 {total} 个知识库
              </p>
              <ul className="space-y-2">
                {list.map((kb) => (
                  <li key={kb.id}>
                    <Link
                      href={`/projects/${projectId}/knowledge-bases/${kb.id}`}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card-bg p-4 transition-colors hover:bg-background/50"
                    >
                      <BookOpen
                        className="mt-0.5 shrink-0 text-muted"
                        size={20}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{kb.name}</span>
                          <StatusBadge status={kb.status} />
                        </div>
                        <div className="mt-0.5 text-xs text-muted">
                          {kb.key} · v{kb.activeVersion?.version ?? "—"} ·{" "}
                          {kb.documentCount} 篇文档
                          {kb.updatedBy?.name
                            ? ` · ${kb.updatedBy.name}`
                            : ""}
                        </div>
                        {kb.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted">
                            {kb.description}
                          </p>
                        )}
                        {kb.crossEnvVersions.length > 0 && (
                          <KbEnvStatus
                            versions={kb.crossEnvVersions}
                            className="mt-2"
                          />
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted">
                        {new Date(kb.updatedAt).toLocaleDateString("zh-CN")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
