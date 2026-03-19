"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

interface PromptPayload {
  id: string;
  key: string;
  name: string;
  type: string;
  status: string;
  environment: { id: string; code: string; name: string };
  activeVersion: {
    id: string;
    version: number;
    content: string;
    note: string | null;
  } | null;
}

export default function PromptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const promptId = params.promptId as string;

  const [canManage, setCanManage] = useState(false);
  const [prompt, setPrompt] = useState<PromptPayload | null>(null);
  const [allVersions, setAllVersions] = useState<
    { id: string; version: number; note: string | null; createdAt: string; contentPreview: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [type, setType] = useState("system");
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [hasProd, setHasProd] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/projects/${projectId}`).then((r) => r.json()),
      fetch(`/api/projects/${projectId}/prompts/${promptId}`).then((r) =>
        r.json()
      ),
      fetch(`/api/projects/${projectId}/prompts/${promptId}/versions`).then(
        (r) => r.json()
      ),
      fetch(`/api/projects/${projectId}/environments`).then((r) => r.json()),
    ])
      .then(([proj, detail, vers, envs]) => {
        setCanManage(!!proj.canManage);
        const envList = envs.environments ?? [];
        setHasProd(
          envList.some(
            (e: { code: string; status: string }) =>
              e.code === "prod" && e.status === "active"
          )
        );
        if (detail.error) {
          setError(detail.error);
          setPrompt(null);
        } else {
          setPrompt(detail.prompt);
          setName(detail.prompt.name);
          setType(detail.prompt.type);
          setContent(detail.prompt.activeVersion?.content ?? "");
          setNote("");
          setError("");
        }
        setAllVersions(vers.versions ?? []);
      })
      .finally(() => setLoading(false));
  }, [projectId, promptId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/prompts/${promptId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            type,
            content,
            note: note.trim() || undefined,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      setNote("");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!confirm("将当前 test 生效版本发布到 prod？")) return;
    setPublishing(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/prompts/${promptId}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetEnvironmentCode: "prod" }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "发布失败");
      alert(
        `已发布：prod 新版本 v${data.targetVersion?.version}（目标 Prompt ${data.targetPromptId}）`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectId}/prompts`)}
          className="text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="inline" size={14} /> 返回列表
        </button>
        <p className="text-red-600">{error || "未找到"}</p>
      </div>
    );
  }

  const isTest = prompt.environment.code === "test";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/projects/${projectId}/prompts`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> Prompt 列表
      </Link>

      <div className="rounded-xl border border-border bg-card-bg p-5">
        <h1 className="text-xl font-bold">{prompt.name}</h1>
        <p className="mt-1 text-sm text-muted">
          key: <code className="rounded bg-background px-1">{prompt.key}</code>{" "}
          · 环境 {prompt.environment.name} ({prompt.environment.code}) · 当前
          v{prompt.activeVersion?.version ?? "—"}
        </p>
        {canManage && isTest && hasProd && (
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || !prompt.activeVersion}
            className="mt-3 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {publishing ? "发布中…" : "发布到 prod"}
          </button>
        )}
      </div>

      {canManage && (
        <form
          onSubmit={handleSave}
          className="space-y-3 rounded-xl border border-border bg-card-bg p-5"
        >
          <h2 className="text-sm font-semibold">编辑</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted">名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted">type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="system">system</option>
                <option value="assistant">assistant</option>
                <option value="workflow">workflow</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted">内容（保存时若变更会生成新版本）</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted">版本备注（可选）</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </form>
      )}

      {!canManage && prompt.activeVersion && (
        <div className="rounded-xl border border-border bg-card-bg p-5">
          <h2 className="text-sm font-semibold">当前生效内容</h2>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-background p-3 font-mono text-xs">
            {prompt.activeVersion.content}
          </pre>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="text-sm font-semibold">版本历史</h2>
        <p className="text-xs text-muted">按版本号倒序；摘要可点「查看全文」</p>
        <ul className="mt-3 space-y-2 text-sm">
          {allVersions.map((v) => (
            <li
              key={v.id}
              className="flex flex-col gap-1 rounded border border-border/60 px-3 py-2"
            >
              <div className="flex justify-between">
                <span className="font-medium">v{v.version}</span>
                <span className="text-xs text-muted">
                  {new Date(v.createdAt).toLocaleString("zh-CN")}
                </span>
              </div>
              {v.note && (
                <span className="text-xs text-muted">备注：{v.note}</span>
              )}
              <p className="text-xs text-muted line-clamp-2">{v.contentPreview}</p>
              <Link
                href={`/projects/${projectId}/prompts/${promptId}/versions/${v.id}`}
                className="text-xs text-accent hover:underline"
              >
                查看全文
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
