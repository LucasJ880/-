"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  BookOpen,
  Plus,
  FileText,
  Clock,
  Settings,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { KbEnvStatus, KbPublishDialog, KbDocStatusBadge } from "@/components/knowledge-base";

interface KbDetail {
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
  createdAt: string;
  updatedAt: string;
}

interface DocRow {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  status: string;
  sortOrder: number;
  updatedAt: string;
  updatedBy: { id: string; name: string | null } | null;
  activeSnapshot: {
    id: string;
    version: number;
    contentPreview: string;
  } | null;
}

interface KbVersionRow {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
}

type Tab = "documents" | "versions" | "settings";

export default function KnowledgeBaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const kbId = params.kbId as string;

  const [canManage, setCanManage] = useState(false);
  const [kb, setKb] = useState<KbDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // cross-env
  const [crossEnvVersions, setCrossEnvVersions] = useState<
    { envCode: string; version: number | null; kbId: string }[]
  >([]);
  const [hasProd, setHasProd] = useState(false);

  // tabs
  const [activeTab, setActiveTab] = useState<Tab>("documents");

  // documents tab
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [docTotal, setDocTotal] = useState(0);
  const [docPage, setDocPage] = useState(1);
  const [docTotalPages, setDocTotalPages] = useState(1);
  const [docKeyword, setDocKeyword] = useState("");
  const [docStatusFilter, setDocStatusFilter] = useState("");

  // versions tab
  const [versions, setVersions] = useState<KbVersionRow[]>([]);

  // settings tab
  const [kbName, setKbName] = useState("");
  const [kbDesc, setKbDesc] = useState("");
  const [kbSaving, setKbSaving] = useState(false);

  // new doc form
  const [showDocForm, setShowDocForm] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState("manual");
  const [docUrl, setDocUrl] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docNote, setDocNote] = useState("");
  const [docSaving, setDocSaving] = useState(false);

  // publish
  const [publishOpen, setPublishOpen] = useState(false);

  const loadDetail = useCallback(() => {
    return apiJson<{
      error?: string;
      knowledgeBase?: KbDetail;
      recentKbVersions?: KbVersionRow[];
    }>(`/api/projects/${projectId}/knowledge-bases/${kbId}`)
      .then((d) => {
        if (d.error) {
          setError(d.error);
          setKb(null);
        } else {
          setKb(d.knowledgeBase ?? null);
          setVersions(d.recentKbVersions ?? []);
          setKbName(d.knowledgeBase?.name ?? "");
          setKbDesc(d.knowledgeBase?.description ?? "");
          setError("");
        }
      });
  }, [projectId, kbId]);

  const loadDocuments = useCallback(
    (kw: string = "", status: string = "", pg: number = 1) => {
      const qs = new URLSearchParams({ page: String(pg), pageSize: "20" });
      if (kw) qs.set("keyword", kw);
      if (status) qs.set("status", status);

      return apiJson<{ documents?: DocRow[]; total?: number; totalPages?: number }>(
        `/api/projects/${projectId}/knowledge-bases/${kbId}/documents?${qs.toString()}`
      )
        .then((d) => {
          setDocuments(d.documents ?? []);
          setDocTotal(d.total ?? 0);
          setDocTotalPages(d.totalPages ?? 1);
        });
    },
    [projectId, kbId]
  );

  const loadCrossEnv = useCallback(() => {
    return apiJson<{ environments?: { id: string; code: string; status: string }[] }>(`/api/projects/${projectId}/environments`)
      .then(async (envData) => {
        const envList: { id: string; code: string; status: string }[] =
          envData.environments ?? [];
        setHasProd(
          envList.some((e) => e.code === "prod" && e.status === "active")
        );

        const kbData = await apiJson<{ knowledgeBase?: { key: string } }>(
          `/api/projects/${projectId}/knowledge-bases/${kbId}`
        );

        if (!kbData.knowledgeBase) return;
        const kbKey = kbData.knowledgeBase.key;

        const results: { envCode: string; version: number | null; kbId: string }[] = [];
        for (const env of envList.filter((e) => e.status === "active")) {
          const listData = await apiJson<{ knowledgeBases?: { key: string; id: string; activeVersion?: { version: number } }[] }>(
            `/api/projects/${projectId}/knowledge-bases?environmentId=${env.id}&keyword=${encodeURIComponent(kbKey)}&pageSize=100`
          );
          const match = (listData.knowledgeBases ?? []).find(
            (b: { key: string }) => b.key === kbKey
          );
          results.push({
            envCode: env.code,
            version: match?.activeVersion?.version ?? null,
            kbId: match?.id ?? "",
          });
        }
        setCrossEnvVersions(results);
      });
  }, [projectId, kbId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiJson<{ canManage?: boolean }>(`/api/projects/${projectId}`),
      loadDetail(),
      loadDocuments(),
      loadCrossEnv(),
    ])
      .then(([proj]) => {
        setCanManage(!!proj.canManage);
      })
      .finally(() => setLoading(false));
  }, [projectId, loadDetail, loadDocuments, loadCrossEnv]);

  function handleDocSearch() {
    setDocPage(1);
    loadDocuments(docKeyword, docStatusFilter, 1);
  }

  function clearDocFilters() {
    setDocKeyword("");
    setDocStatusFilter("");
    setDocPage(1);
    loadDocuments("", "", 1);
  }

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
      loadDetail();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setKbSaving(false);
    }
  }

  async function toggleArchive() {
    if (!kb) return;
    const newStatus = kb.status === "archived" ? "active" : "archived";
    const msg =
      newStatus === "archived"
        ? "归档后知识库将不可编辑，确定？"
        : "确定恢复该知识库？";
    if (!confirm(msg)) return;
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/knowledge-bases/${kbId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "操作失败");
      }
      loadDetail();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
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
      setDocNote("");
      loadDocuments(docKeyword, docStatusFilter, docPage);
      loadDetail();
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败");
    } finally {
      setDocSaving(false);
    }
  }

  async function handlePublish(remark: string) {
    const res = await apiFetch(
      `/api/projects/${projectId}/knowledge-bases/${kbId}/publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetEnvironmentCode: "prod",
          note: remark || undefined,
        }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "发布失败");
    loadDetail();
    loadCrossEnv();
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
      <div className="mx-auto max-w-4xl p-4">
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectId}/knowledge-bases`)}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted"
        >
          <ArrowLeft size={14} /> 返回
        </button>
        <p className="text-[#a63d3d]">{error || "未找到知识库"}</p>
      </div>
    );
  }

  const isTest = kb.environment.code === "test";
  const canPublish = canManage && isTest && hasProd && kb.activeVersion != null;

  const tabs: { key: Tab; label: string; icon: typeof FileText }[] = [
    { key: "documents", label: "文档管理", icon: FileText },
    { key: "versions", label: "KB 版本历史", icon: Clock },
    { key: "settings", label: "知识库设置", icon: Settings },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <button
        type="button"
        onClick={() => router.push(`/projects/${projectId}/knowledge-bases`)}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 知识库列表
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <BookOpen className="mt-1 shrink-0 text-muted" size={24} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{kb.name}</h1>
              <StatusBadge status={kb.status} />
            </div>
            <p className="text-sm text-muted">
              {kb.key} · {kb.environment.name} ({kb.environment.code}) · KB v
              {kb.activeVersion?.version ?? "—"}
            </p>
            {kb.description && (
              <p className="mt-1 text-sm text-muted">{kb.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={toggleArchive}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                kb.status === "archived"
                  ? "border-[rgba(46,122,86,0.15)] text-[#2e7a56] hover:bg-[rgba(46,122,86,0.04)]"
                  : "border-border text-muted hover:text-foreground"
              )}
            >
              {kb.status === "archived" ? "恢复" : "归档"}
            </button>
          )}
          {canPublish && (
            <button
              type="button"
              onClick={() => setPublishOpen(true)}
              className="rounded-lg border border-primary bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
            >
              发布到 prod
            </button>
          )}
        </div>
      </div>

      {/* Cross-env panel */}
      {crossEnvVersions.length > 0 && (
        <div className="rounded-xl border border-border bg-card-bg p-4">
          <h3 className="mb-2 text-sm font-semibold text-muted">
            跨环境版本状态
          </h3>
          <KbEnvStatus versions={crossEnvVersions} />
        </div>
      )}

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
          </button>
        ))}
      </div>

      {/* Documents tab */}
      {activeTab === "documents" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
                placeholder="搜索文档标题..."
                value={docKeyword}
                onChange={(e) => setDocKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleDocSearch()}
              />
            </div>
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={docStatusFilter}
              onChange={(e) => {
                setDocStatusFilter(e.target.value);
                setDocPage(1);
                loadDocuments(docKeyword, e.target.value, 1);
              }}
            >
              <option value="">全部状态</option>
              <option value="active">活跃</option>
              <option value="archived">已归档</option>
            </select>
            {(docKeyword || docStatusFilter) && (
              <button
                type="button"
                onClick={clearDocFilters}
                className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
              >
                <X size={14} /> 清除
              </button>
            )}
            {canManage && kb.status === "active" && (
              <button
                type="button"
                onClick={() => setShowDocForm((v) => !v)}
                className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              >
                <Plus size={14} />
                {showDocForm ? "取消" : "新建文档"}
              </button>
            )}
          </div>

          {showDocForm && canManage && (
            <form
              onSubmit={createDoc}
              className="space-y-3 rounded-xl border border-border bg-card-bg p-4"
            >
              <h3 className="font-semibold">新建文档</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="text-muted">标题</span>
                  <input
                    required
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted">类型</span>
                  <select
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                  >
                    <option value="manual">手动文本</option>
                    <option value="link">外链</option>
                    <option value="file_stub">文件占位</option>
                  </select>
                </label>
              </div>
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
                placeholder="正文内容（纯文本 / Markdown）"
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
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
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {docSaving ? "创建中…" : "创建文档"}
              </button>
            </form>
          )}

          <p className="text-xs text-muted">共 {docTotal} 篇文档</p>

          {documents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="暂无文档"
              description={
                canManage
                  ? "点击「新建文档」添加第一篇文档"
                  : "该知识库暂无文档"
              }
            />
          ) : (
            <ul className="space-y-2">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/projects/${projectId}/knowledge-bases/${kbId}/documents/${d.id}`}
                    className="flex items-start gap-3 rounded-xl border border-border bg-card-bg p-4 transition-colors hover:bg-background/50"
                  >
                    <FileText
                      className="mt-0.5 shrink-0 text-muted"
                      size={18}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{d.title}</span>
                        <KbDocStatusBadge status={d.status} />
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {d.sourceType}
                        {d.sourceUrl ? ` · ${d.sourceUrl}` : ""} · v
                        {d.activeSnapshot?.version ?? "—"}
                        {d.updatedBy?.name ? ` · ${d.updatedBy.name}` : ""}
                      </div>
                      {d.activeSnapshot?.contentPreview && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted">
                          {d.activeSnapshot.contentPreview}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted">
                      {new Date(d.updatedAt).toLocaleDateString("zh-CN")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Pagination
            page={docPage}
            totalPages={docTotalPages}
            onPageChange={(pg) => {
              setDocPage(pg);
              loadDocuments(docKeyword, docStatusFilter, pg);
            }}
          />
        </div>
      )}

      {/* Versions tab */}
      {activeTab === "versions" && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted">
            KB 版本历史（最近）
          </h3>
          {versions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">暂无版本</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => {
                const isCurrent = v.id === kb.activeVersion?.id;
                return (
                  <li
                    key={v.id}
                    className={cn(
                      "rounded-lg border px-4 py-3 transition-colors",
                      isCurrent
                        ? "border-accent/40 bg-accent/5"
                        : "border-border/60"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">
                          v{v.version}
                        </span>
                        {isCurrent && (
                          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                            当前生效
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted">
                        {new Date(v.createdAt).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    {v.note && (
                      <p className="mt-1 text-xs text-muted">{v.note}</p>
                    )}
                    <Link
                      href={`/projects/${projectId}/knowledge-bases/${kbId}/versions/${v.id}`}
                      className="mt-1 inline-block text-xs text-accent hover:underline"
                    >
                      查看快照详情
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Settings tab */}
      {activeTab === "settings" && canManage && (
        <form
          onSubmit={saveKbMeta}
          className="space-y-4 rounded-xl border border-border bg-card-bg p-4"
        >
          <h3 className="font-semibold">知识库信息</h3>
          <label className="block text-sm">
            <span className="text-muted">名称</span>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={kbName}
              onChange={(e) => setKbName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">描述</span>
            <textarea
              className="mt-1 min-h-[80px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={kbDesc}
              onChange={(e) => setKbDesc(e.target.value)}
              placeholder="（可选）"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={kbSaving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {kbSaving ? "保存中…" : "保存"}
            </button>
          </div>

          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-semibold text-muted">元信息</h4>
            <dl className="mt-2 space-y-1 text-xs text-muted">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0">Key:</dt>
                <dd className="font-mono">{kb.key}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0">环境:</dt>
                <dd>
                  {kb.environment.name} ({kb.environment.code})
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0">创建时间:</dt>
                <dd>{new Date(kb.createdAt).toLocaleString("zh-CN")}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0">更新时间:</dt>
                <dd>{new Date(kb.updatedAt).toLocaleString("zh-CN")}</dd>
              </div>
            </dl>
          </div>
        </form>
      )}

      {activeTab === "settings" && !canManage && (
        <div className="rounded-xl border border-border bg-card-bg p-4">
          <h3 className="font-semibold">知识库信息</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted">名称:</dt>
              <dd>{kb.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted">Key:</dt>
              <dd className="font-mono">{kb.key}</dd>
            </div>
            {kb.description && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted">描述:</dt>
                <dd>{kb.description}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted">环境:</dt>
              <dd>
                {kb.environment.name} ({kb.environment.code})
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* Publish dialog */}
      <KbPublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        onConfirm={handlePublish}
        kbName={kb.name}
        kbKey={kb.key}
        versionNumber={kb.activeVersion?.version ?? null}
        documentCount={docTotal}
        targetEnv="prod"
      />
    </div>
  );
}
