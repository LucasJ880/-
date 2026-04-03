"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Save,
  Rocket,
  GitCompare,
  X,
  Archive,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { PROMPT_TYPE_LABELS, label } from "@/lib/i18n/labels";
import { PromptTypeBadge } from "@/components/prompt";
import { PromptVersionList } from "@/components/prompt/prompt-version-list";
import { PromptDiffViewer } from "@/components/prompt/prompt-diff-viewer";
import { PromptPublishDialog } from "@/components/prompt/prompt-publish-dialog";
import { StatusBadge } from "@/components/ui/status-badge";

interface EnvInfo {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface VersionItem {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
  createdById: string;
  contentPreview?: string;
}

interface PromptPayload {
  id: string;
  key: string;
  name: string;
  type: string;
  status: string;
  projectId: string;
  environmentId: string;
  environment: { id: string; code: string; name: string };
  activeVersionId: string | null;
  activeVersion: {
    id: string;
    version: number;
    content: string;
    note: string | null;
    createdAt: string;
    createdById: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface CrossEnvVersion {
  envCode: string;
  envName: string;
  activeVersion: number | null;
  promptId: string;
}

type TabId = "editor" | "versions" | "diff";

export default function PromptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const promptId = params.promptId as string;

  const [canManage, setCanManage] = useState(false);
  const [prompt, setPrompt] = useState<PromptPayload | null>(null);
  const [allVersions, setAllVersions] = useState<VersionItem[]>([]);
  const [environments, setEnvironments] = useState<EnvInfo[]>([]);
  const [crossEnvVersions, setCrossEnvVersions] = useState<CrossEnvVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState<TabId>("editor");

  // Editor state
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("system");
  const [editContent, setEditContent] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Publish dialog
  const [showPublish, setShowPublish] = useState(false);

  // Diff state
  const [diffFromId, setDiffFromId] = useState<string | null>(null);
  const [diffToId, setDiffToId] = useState<string | null>(null);
  const [diffFrom, setDiffFrom] = useState<{ version: number; content: string; note: string | null } | null>(null);
  const [diffTo, setDiffTo] = useState<{ version: number; content: string; note: string | null } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Version detail drawer
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const [viewVersion, setViewVersion] = useState<{
    version: number;
    content: string;
    note: string | null;
    createdAt: string;
  } | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // Status update
  const [statusUpdating, setStatusUpdating] = useState(false);

  const hasProd = environments.some(
    (e) => e.code === "prod" && e.status === "active"
  );
  const isTest = prompt?.environment.code === "test";

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/projects/${projectId}`).then((r) => r.json()),
      apiFetch(`/api/projects/${projectId}/prompts/${promptId}`).then((r) =>
        r.json()
      ),
      apiFetch(
        `/api/projects/${projectId}/prompts/${promptId}/versions`
      ).then((r) => r.json()),
      apiFetch(`/api/projects/${projectId}/environments`).then((r) => r.json()),
    ])
      .then(([proj, detail, vers, envs]) => {
        setCanManage(!!proj.canManage);
        const envList: EnvInfo[] = envs.environments ?? [];
        setEnvironments(envList);
        if (detail.error) {
          setError(detail.error);
          setPrompt(null);
        } else {
          const p = detail.prompt as PromptPayload;
          setPrompt(p);
          setEditName(p.name);
          setEditType(p.type);
          setEditContent(p.activeVersion?.content ?? "");
          setChangeNote("");
          setError("");

          loadCrossEnvVersions(p.key);
        }
        setAllVersions(vers.versions ?? []);
      })
      .finally(() => setLoading(false));
  }, [projectId, promptId]);

  function loadCrossEnvVersions(key: string) {
    apiFetch(
      `/api/projects/${projectId}/prompts?keyword=${encodeURIComponent(key)}&pageSize=100`
    )
      .then((r) => r.json())
      .then((d) => {
        const matching = (d.prompts ?? []).filter(
          (p: { key: string }) => p.key === key
        );
        if (matching.length > 0 && matching[0].crossEnvVersions) {
          setCrossEnvVersions(matching[0].crossEnvVersions);
        }
      });
  }

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt) return;
    setSaving(true);
    try {
      const hasContentChange =
        editContent !== (prompt.activeVersion?.content ?? "");
      if (hasContentChange) {
        const res = await apiFetch(
          `/api/projects/${projectId}/prompts/${promptId}/versions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: editContent,
              changeNote: changeNote.trim() || undefined,
              updateTest: true,
            }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "保存失败");
      }

      const hasMetaChange =
        editName !== prompt.name || editType !== prompt.type;
      if (hasMetaChange) {
        const res = await apiFetch(
          `/api/projects/${projectId}/prompts/${promptId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: editName, type: editType }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "保存失败");
      }

      if (!hasContentChange && !hasMetaChange) {
        alert("没有变更");
        setSaving(false);
        return;
      }

      setChangeNote("");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(remark: string) {
    const res = await apiFetch(
      `/api/projects/${projectId}/prompts/${promptId}/publish`,
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
    load();
  }

  async function handleStatusToggle() {
    if (!prompt) return;
    const newStatus = prompt.status === "active" ? "archived" : "active";
    if (
      !confirm(
        newStatus === "archived"
          ? "确定要归档此 Prompt 吗？"
          : "确定要恢复此 Prompt 吗？"
      )
    )
      return;
    setStatusUpdating(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/prompts/${promptId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "操作失败");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setStatusUpdating(false);
    }
  }

  function handleVersionSelect(id: string) {
    if (diffFromId === id) {
      setDiffFromId(null);
      return;
    }
    if (diffToId === id) {
      setDiffToId(null);
      return;
    }
    if (!diffFromId) {
      setDiffFromId(id);
    } else if (!diffToId) {
      setDiffToId(id);
    } else {
      setDiffFromId(diffToId);
      setDiffToId(id);
    }
  }

  async function handleCompare() {
    if (!diffFromId || !diffToId) return;
    setDiffLoading(true);
    setActiveTab("diff");
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/prompts/${promptId}/compare?fromVersionId=${diffFromId}&toVersionId=${diffToId}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDiffFrom({
        version: data.from.version,
        content: data.from.content,
        note: data.from.note,
      });
      setDiffTo({
        version: data.to.version,
        content: data.to.content,
        note: data.to.note,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "对比失败");
    } finally {
      setDiffLoading(false);
    }
  }

  async function handleViewVersion(id: string) {
    setViewVersionId(id);
    setViewLoading(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/prompts/${promptId}/versions/${id}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setViewVersion({
        version: data.version.version,
        content: data.version.content,
        note: data.version.note,
        createdAt: data.version.createdAt,
      });
    } catch {
      setViewVersion(null);
    } finally {
      setViewLoading(false);
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
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} /> 返回列表
        </button>
        <p className="text-[#a63d3d]">{error || "未找到"}</p>
      </div>
    );
  }

  const selectedIds = [diffFromId, diffToId].filter(Boolean) as string[];

  const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "editor", label: "编辑器", icon: null },
    { id: "versions", label: `版本历史 (${allVersions.length})`, icon: null },
    { id: "diff", label: "版本对比", icon: <GitCompare size={14} /> },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/projects/${projectId}/prompts`}
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeft size={14} /> Prompt 列表
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-bold">{prompt.name}</h1>
            <PromptTypeBadge type={prompt.type} />
            <StatusBadge status={prompt.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted">
            key:{" "}
            <code className="rounded bg-background px-1">{prompt.key}</code>
            {" · "}环境{" "}
            <span className="font-medium">
              {prompt.environment.name} ({prompt.environment.code})
            </span>
            {" · "}当前 v{prompt.activeVersion?.version ?? "—"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManage && prompt.status === "active" && (
            <button
              type="button"
              onClick={handleStatusToggle}
              disabled={statusUpdating}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-background"
            >
              <Archive size={14} /> 归档
            </button>
          )}
          {canManage && prompt.status === "archived" && (
            <button
              type="button"
              onClick={handleStatusToggle}
              disabled={statusUpdating}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-background"
            >
              <RotateCcw size={14} /> 恢复
            </button>
          )}
          {canManage && isTest && hasProd && prompt.activeVersion && (
            <button
              type="button"
              onClick={() => setShowPublish(true)}
              className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
            >
              <Rocket size={14} /> 发布到 prod
            </button>
          )}
        </div>
      </div>

      {/* Environment status panel */}
      {crossEnvVersions.length > 0 && (
        <div className="rounded-xl border border-border bg-card-bg px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted">
            跨环境版本状态
          </p>
          <div className="flex items-center gap-3">
            {[...crossEnvVersions]
              .sort((a, b) => {
                const order = ["test", "prod"];
                return order.indexOf(a.envCode) - order.indexOf(b.envCode);
              })
              .map((v) => (
                <div
                  key={v.envCode}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2",
                    v.envCode === "prod"
                      ? "border-[rgba(46,122,86,0.15)] bg-[rgba(46,122,86,0.04)]"
                      : "border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)]"
                  )}
                >
                  <span className="text-xs font-medium uppercase">
                    {v.envCode}
                  </span>
                  <span className="font-mono text-sm font-bold">
                    {v.activeVersion != null ? `v${v.activeVersion}` : "—"}
                  </span>
                  {v.promptId !== promptId && (
                    <Link
                      href={`/projects/${projectId}/prompts/${v.promptId}`}
                      className="text-xs text-accent hover:underline"
                    >
                      查看
                    </Link>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm transition-colors",
              activeTab === tab.id
                ? "border-accent font-medium text-accent"
                : "border-transparent text-muted hover:text-foreground"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Editor */}
      {activeTab === "editor" && (
        <div>
          {canManage && prompt.status === "active" ? (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-muted">名称</label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted">类型</label>
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="system">{label(PROMPT_TYPE_LABELS, "system")}</option>
                    <option value="assistant">{label(PROMPT_TYPE_LABELS, "assistant")}</option>
                    <option value="workflow">{label(PROMPT_TYPE_LABELS, "workflow")}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted">
                  内容（保存时若内容有变更会自动生成新版本）
                </label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={16}
                  className="mt-0.5 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm leading-relaxed"
                />
              </div>
              <div>
                <label className="text-xs text-muted">
                  版本备注（可选，描述本次变更）
                </label>
                <input
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="例如：调整了角色设定的措辞..."
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Save size={14} />
                      保存
                    </>
                  )}
                </button>
                <span className="text-xs text-muted">
                  内容变更会生成新版本，不会覆盖历史
                </span>
              </div>
            </form>
          ) : (
            <div className="rounded-xl border border-border bg-card-bg p-5">
              <h2 className="mb-2 text-sm font-semibold">
                当前生效内容{" "}
                {prompt.activeVersion && (
                  <span className="font-mono font-normal text-muted">
                    v{prompt.activeVersion.version}
                  </span>
                )}
              </h2>
              {prompt.activeVersion ? (
                <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap rounded-lg bg-background p-4 font-mono text-sm">
                  {prompt.activeVersion.content}
                </pre>
              ) : (
                <p className="text-sm text-muted">暂无内容</p>
              )}
              {!canManage && (
                <p className="mt-2 text-xs text-muted">
                  当前为只读模式，需要编辑权限才能修改
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab: Versions */}
      {activeTab === "versions" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              选中两个版本后可进行差异对比
            </p>
            {selectedIds.length === 2 && (
              <button
                type="button"
                onClick={handleCompare}
                className="flex items-center gap-1 rounded-lg bg-accent/10 px-3 py-1.5 text-sm text-accent hover:bg-accent/20"
              >
                <GitCompare size={14} />
                对比选中的版本
              </button>
            )}
          </div>
          <PromptVersionList
            versions={allVersions}
            activeVersionId={prompt.activeVersionId}
            selectedIds={selectedIds}
            onSelect={handleVersionSelect}
            onView={handleViewVersion}
          />
        </div>
      )}

      {/* Tab: Diff */}
      {activeTab === "diff" && (
        <div className="space-y-3">
          {diffLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
            </div>
          ) : diffFrom && diffTo ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">对比：</span>
                <span className="font-mono font-medium">
                  v{diffFrom.version}
                </span>
                <span className="text-muted">→</span>
                <span className="font-mono font-medium">
                  v{diffTo.version}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDiffFrom(null);
                    setDiffTo(null);
                    setDiffFromId(null);
                    setDiffToId(null);
                  }}
                  className="ml-2 text-xs text-muted hover:text-foreground"
                >
                  清除
                </button>
              </div>
              <PromptDiffViewer
                oldContent={diffFrom.content}
                newContent={diffTo.content}
                oldLabel={`v${diffFrom.version}${diffFrom.note ? ` — ${diffFrom.note}` : ""}`}
                newLabel={`v${diffTo.version}${diffTo.note ? ` — ${diffTo.note}` : ""}`}
              />
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border py-12 text-center">
              <GitCompare size={24} className="mx-auto mb-2 text-muted" />
              <p className="text-sm text-muted">
                请在"版本历史"中选中两个版本后点击"对比"
              </p>
            </div>
          )}
        </div>
      )}

      {/* Version detail drawer */}
      {viewVersionId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
          <div className="h-full w-full max-w-2xl overflow-auto border-l border-border bg-card-bg p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">
                {viewVersion
                  ? `版本 v${viewVersion.version}`
                  : "加载中..."}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setViewVersionId(null);
                  setViewVersion(null);
                }}
                className="rounded p-1 hover:bg-background"
              >
                <X size={18} />
              </button>
            </div>
            {viewLoading ? (
              <div className="mt-8 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
              </div>
            ) : viewVersion ? (
              <div className="mt-4 space-y-3">
                {viewVersion.note && (
                  <p className="text-sm text-muted">
                    备注：{viewVersion.note}
                  </p>
                )}
                <p className="text-xs text-muted">
                  创建于{" "}
                  {new Date(viewVersion.createdAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
                </p>
                <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-4 font-mono text-sm">
                  {viewVersion.content}
                </pre>
              </div>
            ) : (
              <p className="mt-4 text-[#a63d3d]">加载失败</p>
            )}
          </div>
        </div>
      )}

      {/* Publish dialog */}
      <PromptPublishDialog
        open={showPublish}
        onClose={() => setShowPublish(false)}
        onConfirm={handlePublish}
        promptName={prompt.name}
        promptKey={prompt.key}
        versionNumber={prompt.activeVersion?.version ?? null}
        targetEnv="prod"
      />
    </div>
  );
}
