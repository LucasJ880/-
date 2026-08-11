"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Plus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderKanban,
  CheckSquare,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { isSuperAdmin } from "@/lib/permissions-client";
import {
  FolderImportZone,
  type PendingImportFile,
} from "@/components/project-create/folder-import-zone";
import { enqueuePendingFolderImport } from "@/lib/projects/pending-folder-import";
import {
  projectLifecycleLabel,
  type ProjectLifecycleFilter,
} from "@/lib/projects/lifecycle";
import {
  BID_LIST_FILTERS,
  bidPhaseLabel,
  goDecisionLabel,
  type BidListFilterKey,
} from "@/lib/bid-workflow/labels";
import { formatCountdown } from "@/lib/tender/stage";

interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  abandonedAt?: string | null;
  orgId: string | null;
  createdAt: string;
  updatedAt?: string;
  intakeStatus?: string;
  sourceSystem?: string | null;
  solicitationNumber?: string | null;
  clientOrganization?: string | null;
  closeDate?: string | null;
  bidPhaseStatus?: string | null;
  /** false = 当前环境尚未 migrate / 投标智能不可用 */
  intelligenceAvailable?: boolean;
  owner: { id: string; name: string };
  _count: { tasks: number; environments?: number };
  intelligenceRoom?: {
    id: string;
    goDecision: string | null;
    summaryStatus: string | null;
    summaryJson: unknown;
    updatedAt: string;
  } | null;
}

function extractMajorBlockers(summaryJson: unknown): string[] {
  if (!summaryJson || typeof summaryJson !== "object") return [];
  const blockers = (summaryJson as { majorBlockers?: unknown }).majorBlockers;
  if (!Array.isArray(blockers)) return [];
  return blockers.filter((b): b is string => typeof b === "string").slice(0, 2);
}

const LIFECYCLE_OPTIONS: { value: ProjectLifecycleFilter; label: string }[] = [
  { value: "active", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "archived", label: "已归档" },
  { value: "abandoned", label: "已放弃" },
  { value: "all", label: "全部历史" },
];

interface OrgOption {
  id: string;
  name: string;
  code: string;
  status: string;
}

const PROJECT_COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
];

function ProjectModal({
  open,
  onOpenChange,
  onSaved,
  editing,
  organizations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editing: Project | null;
  organizations: OrgOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const [orgId, setOrgId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingImportFile[]>([]);
  const [nameFromFolder, setNameFromFolder] = useState<string | null>(null);

  const activeOrgs = useMemo(
    () => organizations.filter((o) => o.status === "active"),
    [organizations]
  );

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setDescription(editing.description || "");
      setColor(editing.color);
      setOrgId("");
      setPendingFiles([]);
      setNameFromFolder(null);
    } else {
      setName("");
      setDescription("");
      setColor("#3B82F6");
      const first = organizations.find((o) => o.status === "active");
      setOrgId(first?.id ?? "");
      setPendingFiles([]);
      setNameFromFolder(null);
    }
    setSaveError("");
  }, [editing, open, organizations]);

  const handleFolderFiles = useCallback(
    (files: PendingImportFile[], folderName: string | null) => {
      setPendingFiles(files);
      if (!folderName) return;
      // 仅在名称为空，或仍是上一次文件夹自动填入时，才用新文件夹名覆盖
      setName((prev) => {
        if (!prev.trim() || prev === nameFromFolder) {
          setNameFromFolder(folderName);
          return folderName;
        }
        return prev;
      });
    },
    [nameFromFolder],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setSaveError("");

    try {
      const url = editing ? `/api/projects/${editing.id}` : "/api/projects";
      const method = editing ? "PATCH" : "POST";
      const body: Record<string, unknown> = {
        name: name.trim(),
        description,
        color,
      };
      if (!editing) {
        if (!orgId) {
          setSaveError("请选择所属组织");
          setSaving(false);
          return;
        }
        body.orgId = orgId;
      }
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const created = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(created.error || `保存失败 (${res.status})`);
      }

      // 方案 B：创建后立刻进详情；文件夹交给详情页后台上传/解析
      if (!editing && created.id && pendingFiles.length > 0) {
        enqueuePendingFolderImport(created.id, pendingFiles);
      }

      onSaved();
      onOpenChange(false);
      if (!editing && created.id) {
        router.push(`/projects/${created.id}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className={cn(
          "!flex max-h-[min(90vh,880px)] flex-col gap-0 overflow-hidden p-0",
          editing ? "max-w-md" : "max-w-lg",
        )}
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pr-12">
          <DialogTitle>{editing ? "编辑项目" : "新建项目"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "修改项目名称、描述与颜色标识。"
              : "可先选择招标文件夹预填名称；确认创建后立刻进入项目页，上传与 AI 扫描在后台进行。"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4">
            {!editing && (
              <FolderImportZone
                files={pendingFiles}
                disabled={saving}
                onFiles={handleFolderFiles}
                onClear={() => {
                  setPendingFiles([]);
                  if (name === nameFromFolder) {
                    setName("");
                  }
                  setNameFromFolder(null);
                }}
              />
            )}
            {!editing && (
              <div>
                <Label className="mb-1.5 block text-sm font-medium text-foreground">
                  所属组织 <span className="text-danger">*</span>
                </Label>
                {activeOrgs.length === 0 ? (
                  <p className="text-sm text-[#9a6a2f]">
                    暂无可用组织，请先到「组织」页面创建并加入组织。
                  </p>
                ) : (
                  <select
                    value={orgId}
                    onChange={(e) => setOrgId(e.target.value)}
                    disabled={saving}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    {activeOrgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.code})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="project-name" className="mb-1.5 block text-sm font-medium text-foreground">
                项目名称 <span className="text-danger">*</span>
              </Label>
              <Input
                id="project-name"
                type="text"
                value={name}
                disabled={saving}
                onChange={(e) => {
                  setNameFromFolder(null);
                  setName(e.target.value);
                }}
                placeholder="输入项目名称，或从文件夹自动预填…"
                autoFocus
              />
              {!editing && nameFromFolder && name === nameFromFolder ? (
                <p className="mt-1 text-[11px] text-muted">
                  已从文件夹名预填，可修改；需点击下方确认后才会创建。
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="project-description" className="mb-1.5 block text-sm font-medium text-foreground">
                描述
              </Label>
              <textarea
                id="project-description"
                value={description}
                disabled={saving}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="项目描述（可选；AI 扫描后也可能自动补全）..."
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm font-medium text-foreground">颜色标识</Label>
              <div className="flex gap-2">
                {PROJECT_COLORS.map((c) => (
                  <Button
                    key={c}
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={saving}
                    onClick={() => setColor(c)}
                    className={cn(
                      "h-8 w-8 min-w-8 rounded-full p-0 transition-all hover:bg-transparent hover:opacity-90",
                      color === c
                        ? "ring-2 ring-accent ring-offset-2"
                        : "hover:scale-110"
                    )}
                    style={{ backgroundColor: c }}
                    aria-label={`选择颜色 ${c}`}
                  />
                ))}
              </div>
            </div>
            {saveError && (
              <p className="rounded-lg border border-border bg-danger-bg px-3 py-2 text-sm text-danger">
                {saveError}
              </p>
            )}
          </div>
          <DialogFooter className="shrink-0 gap-3 border-t border-border px-6 py-4 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="accent"
              disabled={!name.trim() || saving || (!editing && activeOrgs.length === 0)}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editing
                ? "保存修改"
                : pendingFiles.length > 0
                  ? "确认创建（后台导入）"
                  : "确认创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectMenu({
  onEdit,
  onDelete,
  disabled,
}: {
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="rounded p-1.5 text-muted opacity-100 transition-all hover:bg-background hover:text-foreground disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100"
      >
        {disabled ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <MoreHorizontal size={16} />
        )}
      </button>
      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-border bg-card-bg py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-background"
            >
              <Pencil size={14} />
              编辑
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger-bg"
            >
              <Trash2 size={14} />
              删除
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  const { user } = useCurrentUser();
  const isAdmin = isSuperAdmin(user?.role);
  const [projects, setProjects] = useState<Project[]>([]);
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [intakeFilter, setIntakeFilter] = useState("all");
  const [lifecycleFilter, setLifecycleFilter] =
    useState<ProjectLifecycleFilter>("active");
  const [bidListFilter, setBidListFilter] = useState<BidListFilterKey>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const loadProjects = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setLoadError("");
    const params = new URLSearchParams();
    params.set("lifecycle", lifecycleFilter);
    if (bidListFilter !== "all") {
      params.set("bidListFilter", bidListFilter);
    }
    if (isAdmin && intakeFilter !== "all") {
      params.set("intakeStatus", intakeFilter);
    }
    const qs = params.toString() ? `?${params}` : "";
    return Promise.all([
      apiJson<Project[]>(`/api/projects${qs}`),
      apiJson<{ organizations?: OrgOption[] }>("/api/organizations")
        .then((d) => d.organizations ?? []),
    ])
      .then(([projs, orgs]) => {
        setProjects(Array.isArray(projs) ? projs : []);
        setOrganizations(Array.isArray(orgs) ? orgs : []);
      })
      .catch(() => {
        setLoadError("加载失败，请检查网络或稍后重试。");
      })
      .finally(() => {
        if (!opts?.silent) setLoading(false);
      });
  }, [isAdmin, intakeFilter, lifecycleFilter, bidListFilter]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleDelete = async (id: string, name: string) => {
    if (
      !confirm(
        `确定删除项目「${name}」？\n\n项目将被永久删除；其下任务会解除项目关联，不会随项目一起删除。`,
      )
    ) {
      return;
    }
    setActionError("");
    setDeletingId(id);
    try {
      const res = await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(j.error ?? "删除失败，请重试");
        return;
      }
      // 乐观移除，避免「成功但列表看似没变」
      setProjects((prev) => prev.filter((p) => p.id !== id));
      void loadProjects({ silent: true });
    } catch {
      setActionError("删除失败，请检查网络后重试");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="项目"
        description="投标与执行项目推进；调查室、供应商关联挂在同一 Project 主对象下。"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/projects/intelligence"
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted/30"
            >
              项目智能
            </Link>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setShowModal(true);
              }}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] transition-colors hover:bg-accent-hover"
            >
              <Plus size={16} />
              新建项目
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {BID_LIST_FILTERS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setBidListFilter(opt.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 font-medium transition-colors",
              bidListFilter === opt.key
                ? "bg-accent/15 text-accent"
                : "text-muted hover:bg-card-hover"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {projects.some((p) => p.intelligenceAvailable === false) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          当前环境尚未启用投标智能（数据库未完成迁移）。项目列表仍可使用；投标阶段筛选与调查室暂不可用。
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {LIFECYCLE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setLifecycleFilter(opt.value)}
            className={cn(
              "rounded-lg px-3 py-1.5 font-medium transition-colors",
              lifecycleFilter === opt.value
                ? "bg-primary/10 text-primary"
                : "text-muted hover:bg-card-hover"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isAdmin && (
        <div className="flex items-center gap-1.5 text-sm">
          {[
            { value: "all", label: "全部分发态" },
            { value: "dispatched", label: "已分发" },
            { value: "pending_dispatch", label: "待分发" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setIntakeFilter(opt.value);
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 font-medium transition-colors",
                intakeFilter === opt.value
                  ? "bg-primary/10 text-primary"
                  : "text-muted hover:bg-card-hover"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-border bg-card-bg p-5"
            >
              <div className="flex gap-3">
                <div className="h-10 w-10 shrink-0 rounded-lg bg-[rgba(110,125,118,0.15)]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-[rgba(110,125,118,0.15)]" />
                  <div className="h-3 w-1/2 rounded bg-[rgba(110,125,118,0.08)]" />
                </div>
              </div>
              <div className="mt-4 h-3 w-full rounded bg-[rgba(110,125,118,0.08)]" />
              <div className="mt-3 flex gap-2 border-t border-border pt-3">
                <div className="h-3 w-16 rounded bg-[rgba(110,125,118,0.08)]" />
                <div className="h-3 w-16 rounded bg-[rgba(110,125,118,0.08)]" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-danger-bg px-4 py-3 text-sm text-danger">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => loadProjects()}
            className="text-sm font-medium text-accent hover:underline"
          >
            重试
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(110,125,118,0.08)]">
            <FolderKanban size={28} className="text-[#8a9590]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              {lifecycleFilter === "active" ? "还没有进行中的项目" : "当前筛选下没有项目"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {lifecycleFilter === "active"
                ? "需先有所属组织；若无组织请先到「组织」页面创建。历史项目可切换上方筛选查看。"
                : "可切换「进行中」或「全部历史」查看其他项目。"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowModal(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] transition-colors hover:bg-accent-hover"
          >
            <Plus size={16} />
            新建项目
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const countdown = project.closeDate
              ? formatCountdown(new Date(project.closeDate))
              : null;
            const blockers = extractMajorBlockers(
              project.intelligenceRoom?.summaryJson,
            );
            const go =
              project.intelligenceRoom?.goDecision ||
              (project.bidPhaseStatus === "GO" ||
              project.bidPhaseStatus === "HOLD" ||
              project.bidPhaseStatus === "NO_GO"
                ? project.bidPhaseStatus
                : null);
            return (
            <div
              key={project.id}
              className="group rounded-xl border border-border bg-card-bg p-5 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-white"
                    style={{ backgroundColor: project.color }}
                  >
                    <FolderKanban size={20} />
                  </div>
                  <div>
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-semibold hover:text-accent"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {project.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {project.owner.name}
                      {project.solicitationNumber && (
                        <span className="ml-1">· {project.solicitationNumber}</span>
                      )}
                      {project.orgId == null && (
                        <span className="ml-1 text-[#9a6a2f]">· 未绑定组织</span>
                      )}
                    </p>
                  </div>
                </div>
                <ProjectMenu
                  disabled={deletingId === project.id}
                  onEdit={() => {
                    setEditing(project);
                    setShowModal(true);
                  }}
                  onDelete={() => handleDelete(project.id, project.name)}
                />
              </div>
              {project.clientOrganization && (
                <p className="mt-2 text-xs text-muted line-clamp-1">
                  采购机构：{project.clientOrganization}
                </p>
              )}
              {project.description && (
                <p className="mt-2 text-sm text-muted line-clamp-2">
                  {project.description}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-[rgba(79,124,120,0.1)] px-2 py-0.5 text-[10px] font-medium text-primary">
                  {bidPhaseLabel(project.bidPhaseStatus)}
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted">
                  {goDecisionLabel(go)}
                </span>
                {countdown && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      countdown.isOverdue
                        ? "bg-danger-bg text-danger"
                        : countdown.isDueSoon
                          ? "bg-[rgba(181,137,47,0.1)] text-[#b5892f]"
                          : "bg-[rgba(110,125,118,0.08)] text-muted",
                    )}
                  >
                    {countdown.text}
                  </span>
                )}
              </div>
              {blockers.length > 0 && (
                <p className="mt-2 text-[11px] text-[#9a6a2f] line-clamp-2">
                  阻塞：{blockers.join("；")}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <CheckSquare size={13} />
                  <span>{project._count.tasks} 个任务</span>
                </div>
                <Link
                  href={`/projects/${project.id}`}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  详情
                </Link>
                {project.intelligenceRoom && (
                  <Link
                    href={`/projects/${project.id}?tab=intel`}
                    className="text-xs text-accent hover:text-accent-hover"
                  >
                    情报
                  </Link>
                )}
                {project.intakeStatus === "pending_dispatch" && (
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-[rgba(181,137,47,0.1)] text-[#b5892f]">
                    待分发
                  </span>
                )}
                <span
                  className={cn(
                    "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium",
                    project.status === "active" && !project.abandonedAt
                      ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                      : "bg-[rgba(110,125,118,0.08)] text-muted"
                  )}
                >
                  {projectLifecycleLabel(project.status, project.abandonedAt)}
                </span>
              </div>
              {project.updatedAt && (
                <p className="mt-2 text-[10px] text-muted">
                  更新 {new Date(project.updatedAt).toLocaleString("zh-CN")}
                </p>
              )}
            </div>
            );
          })}
        </div>
      )}

      <ProjectModal
        open={showModal}
        onOpenChange={(nextOpen) => {
          setShowModal(nextOpen);
          if (!nextOpen) setEditing(null);
        }}
        onSaved={loadProjects}
        editing={editing}
        organizations={organizations}
      />
    </div>
  );
}
