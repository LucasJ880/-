"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface EnvRow {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface PromptRow {
  id: string;
  key: string;
  name: string;
  type: string;
  status: string;
  updatedAt: string;
  activeVersion: { id: string; version: number; createdAt: string } | null;
}

const TYPES = ["system", "assistant", "workflow"] as const;

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
      fetch(`/api/projects/${projectId}`).then((r) => r.json()),
      fetch(`/api/projects/${projectId}/environments`).then((r) => r.json()),
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
    (selectedEnv: string) => {
      if (!selectedEnv) {
        setPrompts([]);
        return Promise.resolve();
      }
      return fetch(
        `/api/projects/${projectId}/prompts?environmentId=${encodeURIComponent(selectedEnv)}`
      )
        .then((r) => r.json())
        .then((d) => {
          if (d.error) {
            setListError(d.error);
            setPrompts([]);
          } else {
            setListError("");
            setPrompts(d.prompts ?? []);
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
        return id0 ? loadPrompts(id0) : Promise.resolve();
      })
      .finally(() => setLoading(false));
  }, [loadEnvsAndProject, loadPrompts]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!envId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/prompts`, {
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
      loadPrompts(envId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

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
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
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
    <div className="mx-auto max-w-3xl space-y-6">
      <button
        type="button"
        onClick={() => router.push(`/projects/${projectId}`)}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> {projectName || "项目"}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Prompt</h1>
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

      <div className="flex flex-wrap gap-2">
        {activeEnvs.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => {
              setEnvId(e.id);
              loadPrompts(e.id);
            }}
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

      {listError && (
        <p className="text-sm text-red-600">{listError}</p>
      )}

      {showNew && canManage && (
        <form
          onSubmit={handleCreate}
          className="space-y-3 rounded-xl border border-border bg-card-bg p-4"
        >
          <h2 className="text-sm font-semibold">新建 Prompt（当前环境）</h2>
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

      <ul className="space-y-2">
        {prompts.length === 0 && !listError ? (
          <li className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted">
            当前环境下暂无 Prompt
          </li>
        ) : (
          prompts.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${projectId}/prompts/${p.id}`}
                className="flex items-center justify-between rounded-xl border border-border bg-card-bg px-4 py-3 transition-colors hover:bg-background"
              >
                <div className="flex items-center gap-3">
                  <FileText size={18} className="text-muted" />
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted">
                      {p.key} · {p.type} · v
                      {p.activeVersion?.version ?? "—"}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted">
                  {new Date(p.updatedAt).toLocaleString("zh-CN")}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
