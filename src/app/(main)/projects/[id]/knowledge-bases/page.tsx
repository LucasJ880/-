"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface EnvRow {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface KbRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  updatedAt: string;
  activeVersion: { id: string; version: number } | null;
  documentCount: number;
}

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

  const loadList = useCallback(
    (selectedEnv: string) => {
      if (!selectedEnv) {
        setList([]);
        return Promise.resolve();
      }
      return apiFetch(
        `/api/projects/${projectId}/knowledge-bases?environmentId=${encodeURIComponent(selectedEnv)}`
      )
        .then((r) => r.json())
        .then((d) => {
          if (d.error) {
            setListError(d.error);
            setList([]);
          } else {
            setListError("");
            setList(d.knowledgeBases ?? []);
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
      loadList(envId);
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

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
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
            按环境隔离；文档变更会生成新的 KB 版本快照
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
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
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
                loadList(e.id);
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

      {listError && (
        <p className="text-sm text-red-600">{listError}</p>
      )}

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
        <ul className="space-y-2">
          {list.length === 0 ? (
            <li className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
              当前环境下暂无知识库
            </li>
          ) : (
            list.map((kb) => (
              <li key={kb.id}>
                <Link
                  href={`/projects/${projectId}/knowledge-bases/${kb.id}`}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card-bg p-4 hover:bg-background/50"
                >
                  <BookOpen
                    className="mt-0.5 shrink-0 text-muted"
                    size={20}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{kb.name}</div>
                    <div className="text-xs text-muted">
                      {kb.key} · v{kb.activeVersion?.version ?? "—"} ·{" "}
                      {kb.documentCount} 篇文档
                    </div>
                    {kb.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted">
                        {kb.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs",
                      kb.status === "active"
                        ? "bg-green-100 text-green-800"
                        : "bg-slate-100 text-slate-600"
                    )}
                  >
                    {kb.status}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
