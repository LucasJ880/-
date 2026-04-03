"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  FileText,
  Save,
  Clock,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { KbDocStatusBadge, KbDocVersionList } from "@/components/knowledge-base";

interface DocDetail {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: { id: string; name: string | null } | null;
  knowledgeBase: {
    id: string;
    key: string;
    name: string;
    projectId: string;
    activeVersionId: string | null;
    environment: { id: string; code: string; name: string };
  };
}

interface SnapshotData {
  id: string;
  version: number;
  content: string;
  summary: string | null;
  note: string | null;
  createdAt: string;
}

interface DocVersionItem {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
  createdById: string;
  knowledgeBaseVersionId: string;
}

type Tab = "editor" | "versions";

export default function KnowledgeDocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const kbId = params.kbId as string;
  const docId = params.docId as string;

  const [canManage, setCanManage] = useState(false);
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [versions, setVersions] = useState<DocVersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState<Tab>("editor");

  // editor state
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editNote, setEditNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // version drawer
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const [viewVersionData, setViewVersionData] = useState<{
    version: number;
    content: string;
    summary: string | null;
    note: string | null;
    createdAt: string;
  } | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const loadDoc = useCallback(() => {
    return apiFetch(
      `/api/projects/${projectId}/knowledge-bases/${kbId}/documents/${docId}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          setDoc(null);
        } else {
          setDoc(d.document);
          setSnapshot(d.activeSnapshot ?? null);
          setVersions(d.recentVersions ?? []);
          setEditTitle(d.document.title);
          setEditContent(d.activeSnapshot?.content ?? "");
          setEditNote("");
          setHasChanges(false);
          setError("");
        }
      });
  }, [projectId, kbId, docId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/projects/${projectId}`).then((r) => r.json()),
      loadDoc(),
    ])
      .then(([proj]) => {
        setCanManage(!!proj.canManage);
      })
      .finally(() => setLoading(false));
  }, [projectId, loadDoc]);

  function handleContentChange(val: string) {
    setEditContent(val);
    setHasChanges(
      val !== (snapshot?.content ?? "") || editTitle !== doc?.title
    );
  }

  function handleTitleChange(val: string) {
    setEditTitle(val);
    setHasChanges(
      editContent !== (snapshot?.content ?? "") || val !== doc?.title
    );
  }

  async function saveNewVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!hasChanges) return;
    setSaving(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/knowledge-bases/${kbId}/documents/${docId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editTitle,
            content: editContent,
            note: editNote.trim() || undefined,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      await loadDoc();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!doc) return;
    const newStatus = doc.status === "archived" ? "active" : "archived";
    if (
      newStatus === "archived" &&
      !confirm("归档后文档将从当前活跃列表中隐藏，确定？")
    )
      return;

    try {
      if (newStatus === "archived") {
        const res = await apiFetch(
          `/api/projects/${projectId}/knowledge-bases/${kbId}/documents/${docId}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "归档失败");
        }
      } else {
        const res = await apiFetch(
          `/api/projects/${projectId}/knowledge-bases/${kbId}/documents/${docId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "active" }),
          }
        );
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "操作失败");
        }
      }
      loadDoc();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleViewVersion(versionId: string) {
    setViewVersionId(versionId);
    setViewLoading(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/knowledge-bases/${kbId}/documents/${docId}/versions/${versionId}`
      );
      const data = await res.json();
      if (data.version) {
        setViewVersionData({
          version: data.version.version,
          content: data.version.content,
          summary: data.version.summary,
          note: data.version.note,
          createdAt: data.version.createdAt,
        });
      }
    } catch {
      setViewVersionData(null);
    } finally {
      setViewLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <button
          type="button"
          onClick={() =>
            router.push(`/projects/${projectId}/knowledge-bases/${kbId}`)
          }
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted"
        >
          <ArrowLeft size={14} /> 返回
        </button>
        <p className="text-[#a63d3d]">{error || "未找到文档"}</p>
      </div>
    );
  }

  const isActive = doc.status === "active";
  const canEdit = canManage && isActive;

  const tabs: { key: Tab; label: string; icon: typeof FileText }[] = [
    { key: "editor", label: "编辑器", icon: FileText },
    { key: "versions", label: "版本历史", icon: Clock },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <button
        type="button"
        onClick={() =>
          router.push(`/projects/${projectId}/knowledge-bases/${kbId}`)
        }
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> {doc.knowledgeBase.name}
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <FileText className="mt-1 shrink-0 text-muted" size={24} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{doc.title}</h1>
              <KbDocStatusBadge status={doc.status} />
            </div>
            <p className="text-sm text-muted">
              {doc.sourceType}
              {doc.sourceUrl ? ` · ${doc.sourceUrl}` : ""} ·{" "}
              {doc.knowledgeBase.environment.name} (
              {doc.knowledgeBase.environment.code}) · 文档 v
              {snapshot?.version ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={handleArchive}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                isActive
                  ? "border-border text-muted hover:text-foreground"
                  : "border-[rgba(46,122,86,0.15)] text-[#2e7a56] hover:bg-[rgba(46,122,86,0.04)]"
              )}
            >
              {isActive ? "归档" : "恢复"}
            </button>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        <span>知识库: {doc.knowledgeBase.name} ({doc.knowledgeBase.key})</span>
        <span>
          更新: {new Date(doc.updatedAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
          {doc.updatedBy?.name ? ` · ${doc.updatedBy.name}` : ""}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            )}
          >
            <t.icon size={14} />
            {t.label}
            {t.key === "versions" && (
              <span className="ml-1 rounded-full bg-card-bg px-1.5 text-[10px]">
                {versions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Editor tab */}
      {activeTab === "editor" && (
        <form onSubmit={saveNewVersion} className="space-y-4">
          <div>
            <label className="text-sm text-muted">标题</label>
            {canEdit ? (
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={editTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
              />
            ) : (
              <p className="mt-1 text-sm font-medium">{doc.title}</p>
            )}
          </div>

          <div>
            <label className="text-sm text-muted">正文内容</label>
            {canEdit ? (
              <textarea
                className="mt-1 min-h-[320px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono leading-relaxed"
                value={editContent}
                onChange={(e) => handleContentChange(e.target.value)}
              />
            ) : (
              <pre className="mt-1 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background/80 p-3 text-sm">
                {snapshot?.content || "（无正文）"}
              </pre>
            )}
          </div>

          {canEdit && (
            <>
              <div>
                <label className="text-sm text-muted">变更说明</label>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="简述本次修改内容（可选）"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!hasChanges || saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Save size={14} />
                  {saving ? "保存中…" : "保存为新版本"}
                </button>
                {hasChanges && (
                  <span className="text-xs text-[#9a6a2f]">有未保存的修改</span>
                )}
              </div>
            </>
          )}
        </form>
      )}

      {/* Versions tab */}
      {activeTab === "versions" && (
        <div className="space-y-4">
          <KbDocVersionList
            versions={versions}
            currentKbVersionId={doc.knowledgeBase.activeVersionId}
            onView={handleViewVersion}
          />
        </div>
      )}

      {/* Version content drawer */}
      {viewVersionId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
          <div className="flex h-full w-full max-w-xl flex-col bg-card-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="font-semibold">
                版本 v{viewVersionData?.version ?? "…"} 快照
              </h3>
              <button
                type="button"
                onClick={() => {
                  setViewVersionId(null);
                  setViewVersionData(null);
                }}
                className="rounded p-1 hover:bg-background"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {viewLoading ? (
                <div className="flex justify-center py-12 text-muted">
                  <Loader2 className="animate-spin" />
                </div>
              ) : viewVersionData ? (
                <div className="space-y-4">
                  <div className="flex gap-4 text-xs text-muted">
                    <span>
                      {new Date(viewVersionData.createdAt).toLocaleString(
                        "zh-CN",
                        { timeZone: "America/Toronto" }
                      )}
                    </span>
                    {viewVersionData.note && (
                      <span>说明: {viewVersionData.note}</span>
                    )}
                  </div>
                  {viewVersionData.summary && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted">摘要</h4>
                      <p className="mt-1 text-sm">{viewVersionData.summary}</p>
                    </div>
                  )}
                  <div>
                    <h4 className="text-xs font-semibold text-muted">正文</h4>
                    <pre className="mt-1 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm">
                      {viewVersionData.content || "（空）"}
                    </pre>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[#a63d3d]">加载失败</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
