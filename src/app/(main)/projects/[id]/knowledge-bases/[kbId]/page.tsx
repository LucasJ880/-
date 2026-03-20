"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, BookOpen } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

interface DocRow {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  status: string;
  sortOrder: number;
  updatedAt: string;
  activeSnapshot: {
    id: string;
    version: number;
    content: string;
    summary: string | null;
    note: string | null;
  } | null;
}

export default function KnowledgeBaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const kbId = params.kbId as string;

  const [canManage, setCanManage] = useState(false);
  const [kb, setKb] = useState<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    status: string;
    environment: { id: string; code: string; name: string };
    activeVersion: {
      id: string;
      version: number;
      note: string | null;
      createdAt: string;
    } | null;
  } | null>(null);
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [versions, setVersions] = useState<
    { id: string; version: number; note: string | null; createdAt: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasProd, setHasProd] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [kbName, setKbName] = useState("");
  const [kbDesc, setKbDesc] = useState("");
  const [kbSaving, setKbSaving] = useState(false);

  const [showDocForm, setShowDocForm] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState("manual");
  const [docUrl, setDocUrl] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docSummary, setDocSummary] = useState("");
  const [docNote, setDocNote] = useState("");
  const [docSaving, setDocSaving] = useState(false);

  const [editDocId, setEditDocId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editNote, setEditNote] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/projects/${projectId}`).then((r) => r.json()),
      apiFetch(`/api/projects/${projectId}/knowledge-bases/${kbId}`).then((r) =>
        r.json()
      ),
      apiFetch(`/api/projects/${projectId}/knowledge-bases/${kbId}/versions`).then(
        (r) => r.json()
      ),
      apiFetch(`/api/projects/${projectId}/environments`).then((r) => r.json()),
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
          setKb(null);
        } else {
          setKb(detail.knowledgeBase);
          setDocuments(detail.documents ?? []);
          setKbName(detail.knowledgeBase.name);
          setKbDesc(detail.knowledgeBase.description ?? "");
          setError("");
        }
        setVersions(vers.versions ?? []);
      })
      .finally(() => setLoading(false));
  }, [projectId, kbId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveKbMeta(e: React.FormEvent) {
    e.preventDefault();
    setKbSaving(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/knowledge-bases/${kbId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: kbName,
            description: kbDesc.trim() || null,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setKbSaving(false);
    }
  }

  async function createDoc(e: React.FormEvent) {
    e.preventDefault();
    setDocSaving(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/knowledge-bases/${kbId}/documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: docTitle,
            sourceType: docType,
            sourceUrl: docUrl.trim() || undefined,
            content: docContent,
            summary: docSummary.trim() || undefined,
            note: docNote.trim() || undefined,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "创建失败");
      setShowDocForm(false);
      setDocTitle("");
      setDocUrl("");
      setDocContent("");
      setDocSummary("");
      setDocNote("");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败");
    } finally {
      setDocSaving(false);
    }
  }

  async function saveDoc(docId: string) {
    setDocSaving(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/knowledge-bases/${kbId}/documents/${docId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: editContent,
            summary: editSummary.trim() || null,
            note: editNote.trim() || undefined,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      setEditDocId(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setDocSaving(false);
    }
  }

  async function archiveDoc(docId: string) {
    if (!confirm("归档后将从当前生效列表中隐藏，并生成新版本快照。确定？"))
      return;
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/knowledge-bases/${kbId}/documents/${docId}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "归档失败");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "归档失败");
    }
  }

  async function handlePublish() {
    if (!confirm("将 test 当前知识库快照发布到 prod？")) return;
    setPublishing(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/knowledge-bases/${kbId}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetEnvironmentCode: "prod" }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "发布失败");
      alert(
        `已发布：prod KB v${data.targetKbVersion?.version}（源 test v${data.sourceKbVersion?.version}）`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (error || !kb) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectId}/knowledge-bases`)}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted"
        >
          <ArrowLeft size={14} /> 返回
        </button>
        <p className="text-red-600">{error || "未找到知识库"}</p>
      </div>
    );
  }

  const isTest = kb.environment.code === "test";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <button
        type="button"
        onClick={() => router.push(`/projects/${projectId}/knowledge-bases`)}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 知识库列表
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <BookOpen className="mt-1 text-muted" size={24} />
          <div>
            <h1 className="text-xl font-bold">{kb.name}</h1>
            <p className="text-sm text-muted">
              {kb.key} · 环境 {kb.environment.name} ({kb.environment.code}) ·
              当前版本 v{kb.activeVersion?.version ?? "—"}
            </p>
            {kb.description && (
              <p className="mt-2 text-sm text-muted">{kb.description}</p>
            )}
          </div>
        </div>
        {canManage && isTest && hasProd && (
          <button
            type="button"
            disabled={publishing}
            onClick={handlePublish}
            className="rounded-lg border border-primary bg-primary/10 px-3 py-2 text-sm font-medium text-primary disabled:opacity-50"
          >
            {publishing ? "发布中…" : "发布到 prod"}
          </button>
        )}
      </div>

      {canManage && (
        <form
          onSubmit={saveKbMeta}
          className="space-y-2 rounded-xl border border-border bg-card-bg p-4"
        >
          <h2 className="text-sm font-semibold">知识库信息</h2>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={kbName}
            onChange={(e) => setKbName(e.target.value)}
          />
          <textarea
            className="min-h-[60px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={kbDesc}
            onChange={(e) => setKbDesc(e.target.value)}
            placeholder="描述（可选）"
          />
          <button
            type="submit"
            disabled={kbSaving}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {kbSaving ? "保存中…" : "保存信息"}
          </button>
        </form>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-semibold">文档</h2>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowDocForm((v) => !v)}
            className="text-sm font-medium text-primary"
          >
            {showDocForm ? "取消新建" : "+ 新建文档"}
          </button>
        )}
      </div>

      {showDocForm && canManage && (
        <form
          onSubmit={createDoc}
          className="space-y-2 rounded-xl border border-border bg-card-bg p-4"
        >
          <input
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="标题"
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
          />
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
          >
            <option value="manual">manual（手动文本）</option>
            <option value="link">link（外链）</option>
            <option value="file_stub">file_stub（文件占位）</option>
          </select>
          {docType === "link" && (
            <input
              required
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="https://..."
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
            />
          )}
          <textarea
            className="min-h-[120px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
            placeholder="正文 / 说明（纯文本）"
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="摘要（可选）"
            value={docSummary}
            onChange={(e) => setDocSummary(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="版本说明（可选）"
            value={docNote}
            onChange={(e) => setDocNote(e.target.value)}
          />
          <button
            type="submit"
            disabled={docSaving}
            className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {docSaving ? "创建中…" : "创建文档"}
          </button>
        </form>
      )}

      <ul className="space-y-4">
        {documents.length === 0 ? (
          <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted">
            暂无文档
          </li>
        ) : (
          documents.map((d) => (
            <li
              key={d.id}
              className="rounded-xl border border-border bg-card-bg p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{d.title}</div>
                  <div className="text-xs text-muted">
                    {d.sourceType}
                    {d.sourceUrl ? ` · ${d.sourceUrl}` : ""} · 文档版本 v
                    {d.activeSnapshot?.version ?? "—"} · {d.status}
                  </div>
                </div>
                {canManage && d.status === "active" && (
                  <div className="flex gap-2">
                    {editDocId === d.id ? (
                      <button
                        type="button"
                        className="text-xs text-muted"
                        onClick={() => setEditDocId(null)}
                      >
                        取消
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="text-xs text-primary"
                          onClick={() => {
                            setEditDocId(d.id);
                            setEditContent(d.activeSnapshot?.content ?? "");
                            setEditSummary(d.activeSnapshot?.summary ?? "");
                            setEditNote("");
                          }}
                        >
                          编辑内容
                        </button>
                        <button
                          type="button"
                          className="text-xs text-red-600"
                          onClick={() => archiveDoc(d.id)}
                        >
                          归档
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {editDocId === d.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="min-h-[140px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder="摘要"
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                  />
                  <input
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder="版本说明（可选）"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={docSaving}
                    onClick={() => saveDoc(d.id)}
                    className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                  >
                    保存为新版本
                  </button>
                </div>
              ) : (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-background/80 p-3 text-xs">
                  {d.activeSnapshot?.content || "（无正文）"}
                </pre>
              )}
            </li>
          ))
        )}
      </ul>

      <div>
        <h2 className="mb-2 font-semibold">KB 版本历史</h2>
        <ul className="space-y-1 text-sm">
          {versions.map((v) => (
            <li key={v.id}>
              <Link
                href={`/projects/${projectId}/knowledge-bases/${kbId}/versions/${v.id}`}
                className="text-primary hover:underline"
              >
                v{v.version}
              </Link>
              <span className="text-muted">
                {" "}
                · {new Date(v.createdAt).toLocaleString()}
                {v.note ? ` · ${v.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
