"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Plus,
  FileText,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { PromptTypeBadge, PromptEnvStatus } from "@/components/prompt";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

interface EnvRow {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface CrossEnvVersion {
  envCode: string;
  envName: string;
  activeVersion: number | null;
  promptId: string;
}

interface PromptRow {
  id: string;
  key: string;
  name: string;
  type: string;
  status: string;
  environmentId: string;
  environment: { id: string; code: string; name: string };
  updatedAt: string;
  updatedBy: { id: string; name: string } | null;
  activeVersion: { id: string; version: number; createdAt: string } | null;
  crossEnvVersions: CrossEnvVersion[];
}

const TYPES = ["system", "assistant", "workflow"] as const;
const PAGE_SIZE = 20;

export default function ProjectPromptsListPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [projectName, setProjectName] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [environments, setEnvironments] = useState<EnvRow[]>([]);
  const [envId, setEnvId] = useState("");
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("system");
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const activeEnvs = useMemo(
    () => environments.filter((e) => e.status === "active"),
    [environments]
  );

  const loadEnvsAndProject = useCallback(() => {
    return Promise.all([
      apiFetch(`/api/projects/${projectId}`).then((r) => r.json()),
      apiFetch(`/api/projects/${projectId}/environments`).then((r) => r.json()),
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

  const loadPrompts = useCallback(
    (
      selectedEnv: string,
      pg: number = 1,
      kw: string = "",
      tp: string = "",
      st: string = ""
    ) => {
      const qs = new URLSearchParams();
      if (selectedEnv) qs.set("environmentId", selectedEnv);
      if (kw) qs.set("keyword", kw);
      if (tp) qs.set("type", tp);
      if (st) qs.set("status", st);
      qs.set("page", String(pg));
      qs.set("pageSize", String(PAGE_SIZE));

      return apiFetch(
        `/api/projects/${projectId}/prompts?${qs.toString()}`
      )
        .then((r) => r.json())
        .then((d) => {
          if (d.error) {
            setListError(d.error);
            setPrompts([]);
            setTotal(0);
            setTotalPages(1);
          } else {
            setListError("");
            setPrompts(d.prompts ?? []);
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
        return loadPrompts(id0, 1, "", "", "");
      })
      .finally(() => setLoading(false));
  }, [loadEnvsAndProject, loadPrompts]);

  function handleSearch() {
    setPage(1);
    loadPrompts(envId, 1, keyword, typeFilter, statusFilter);
  }

  function handleEnvSwitch(id: string) {
    setEnvId(id);
    setPage(1);
    loadPrompts(id, 1, keyword, typeFilter, statusFilter);
  }

  function handlePageChange(pg: number) {
    setPage(pg);
    loadPrompts(envId, pg, keyword, typeFilter, statusFilter);
  }

  function clearFilters() {
    setKeyword("");
    setTypeFilter("");
    setStatusFilter("");
    setPage(1);
    loadPrompts(envId, 1, "", "", "");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!envId) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environmentId: envId,
          key,
          name,
          type,
          content,
          note: note || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "创建失败");
      setShowNew(false);
      setKey("");
      setName("");
      setContent("");
      setNote("");
      loadPrompts(envId, page, keyword, typeFilter, statusFilter);
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  const hasFilters = keyword || typeFilter || statusFilter;

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (activeEnvs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectId}`)}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} /> 返回项目
        </button>
        <div className="rounded-xl border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] p-4 text-sm text-[#9a6a2f]">
          该项目下还没有可用环境（或环境均已归档）。请先在
          <Link href={`/projects/${projectId}`} className="mx-1 underline">
            项目详情
          </Link>
          中创建 <strong>test</strong> / <strong>prod</strong> 等环境后再管理 Prompt。
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* 返回 + 标题 */}
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={() => router.push(`/projects/${projectId}`)}
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeft size={14} /> {projectName || "项目"}
          </button>
          <h1 className="mt-1 text-xl font-bold">Prompt 管理</h1>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowNew(!showNew)}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
          >
            <Plus size={14} /> 新建 Prompt
          </button>
        )}
      </div>

      {/* 环境切换 */}
      <div className="flex flex-wrap gap-2">
        {activeEnvs.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => handleEnvSwitch(e.id)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              envId === e.id
                ? "border-accent bg-accent/10 font-medium text-accent"
                : "border-border hover:bg-background"
            )}
          >
            {e.name} ({e.code})
          </button>
        ))}
      </div>

      {/* 搜索和筛选 */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="搜索名称或 key..."
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
        </div>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
            loadPrompts(envId, 1, keyword, e.target.value, statusFilter);
          }}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">全部类型</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
            loadPrompts(envId, 1, keyword, typeFilter, e.target.value);
          }}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">全部状态</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
        <button
          type="button"
          onClick={handleSearch}
          className="rounded-lg bg-accent/10 px-3 py-1.5 text-sm text-accent hover:bg-accent/20"
        >
          搜索
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
          >
            <X size={12} /> 清除筛选
          </button>
        )}
      </div>

      {listError && <p className="text-sm text-[#a63d3d]">{listError}</p>}

      {/* 新建表单 */}
      {showNew && canManage && (
        <form
          onSubmit={handleCreate}
          className="space-y-3 rounded-xl border border-border bg-card-bg p-4"
        >
          <h2 className="text-sm font-semibold">
            新建 Prompt（环境：{activeEnvs.find((e) => e.id === envId)?.code ?? "—"}）
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted">key *</label>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                placeholder="system_main"
                required
              />
            </div>
            <div>
              <label className="text-xs text-muted">名称 *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                required
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted">type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted">内容</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted">备注（可选）</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "创建中…" : "创建"}
            </button>
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm"
            >
              取消
            </button>
          </div>
        </form>
      )}

      {/* 列表 */}
      {prompts.length === 0 && !listError ? (
        <EmptyState
          icon={FileText}
          title="暂无 Prompt"
          description={hasFilters ? "没有匹配的 Prompt，尝试调整筛选条件" : "当前环境下暂无 Prompt，点击「新建 Prompt」开始"}
        />
      ) : (
        <div className="space-y-2">
          {prompts.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${projectId}/prompts/${p.id}`}
              className="flex items-center justify-between rounded-xl border border-border bg-card-bg px-4 py-3 transition-colors hover:bg-background"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <FileText size={18} className="shrink-0 text-muted" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{p.name}</p>
                    <PromptTypeBadge type={p.type} />
                    {p.status !== "active" && <StatusBadge status={p.status} />}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <code>{p.key}</code>
                    <span>·</span>
                    <span>v{p.activeVersion?.version ?? "—"}</span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <PromptEnvStatus versions={p.crossEnvVersions} />
                <span className="text-xs text-muted">
                  {new Date(p.updatedAt).toLocaleString("zh-CN")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">共 {total} 个 Prompt</p>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}
