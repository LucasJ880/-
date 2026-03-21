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
  X,
  Layers,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/page-header";

interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  orgId: string | null;
  createdAt: string;
  owner: { id: string; name: string };
  _count: { tasks: number; environments?: number };
}

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
  onClose,
  onSaved,
  editing,
  organizations,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: Project | null;
  organizations: OrgOption[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const [orgId, setOrgId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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
    } else {
      setName("");
      setDescription("");
      setColor("#3B82F6");
      const first = organizations.find((o) => o.status === "active");
      setOrgId(first?.id ?? "");
    }
  }, [editing, open, organizations]);

  if (!open) return null;

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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `保存失败 (${res.status})`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border border-border bg-card-bg p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {editing ? "编辑项目" : "新建项目"}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-background"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editing && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                所属组织 <span className="text-[#a63d3d]">*</span>
              </label>
              {activeOrgs.length === 0 ? (
                <p className="text-sm text-[#9a6a2f]">
                  暂无可用组织，请先到「组织」页面创建并加入组织。
                </p>
              ) : (
                <select
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
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
            <label className="mb-1 block text-sm font-medium">
              项目名称 <span className="text-[#a63d3d]">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入项目名称..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目描述（可选）..."
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">颜色标识</label>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-8 w-8 rounded-full transition-all",
                    color === c
                      ? "ring-2 ring-accent ring-offset-2"
                      : "hover:scale-110"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          {saveError && (
            <p className="rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-3 py-2 text-sm text-[#a63d3d]">
              {saveError}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-background"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving || (!editing && activeOrgs.length === 0)}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editing ? "保存修改" : "创建项目"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProjectMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="rounded p-1.5 text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-background hover:text-foreground"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-border bg-card-bg py-1 shadow-lg">
            <button
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
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[#a63d3d] transition-colors hover:bg-[rgba(166,61,61,0.04)]"
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const loadProjects = useCallback(() => {
    setLoading(true);
    setLoadError("");
    Promise.all([
      apiFetch("/api/projects").then((r) => r.json()),
      apiFetch("/api/organizations")
        .then((r) => r.json())
        .then((d) => d.organizations ?? []),
    ])
      .then(([projs, orgs]) => {
        setProjects(Array.isArray(projs) ? projs : []);
        setOrganizations(Array.isArray(orgs) ? orgs : []);
      })
      .catch(() => {
        setLoadError("加载失败，请检查网络或稍后重试。");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
    loadProjects();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="项目管理"
        description="项目归属在组织之下，用于承载任务、环境与知识资源。"
        actions={
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowModal(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus size={16} />
            新建项目
          </button>
        }
      />

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
        <div className="flex flex-col items-start gap-3 rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
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
            <p className="text-sm font-medium text-foreground">还没有项目</p>
            <p className="mt-1 text-sm text-muted">
              需先有所属组织；若无组织请先到「组织」页面创建。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowModal(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus size={16} />
            新建项目
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
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
                      {project.orgId == null && (
                        <span className="ml-1 text-[#9a6a2f]">· 未绑定组织</span>
                      )}
                    </p>
                  </div>
                </div>
                <ProjectMenu
                  onEdit={() => {
                    setEditing(project);
                    setShowModal(true);
                  }}
                  onDelete={() => handleDelete(project.id)}
                />
              </div>
              {project.description && (
                <p className="mt-3 text-sm text-muted line-clamp-2">
                  {project.description}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <CheckSquare size={13} />
                  <span>{project._count.tasks} 个任务</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <Layers size={13} />
                  <span>{project._count.environments ?? 0} 个环境</span>
                </div>
                <Link
                  href={`/projects/${project.id}`}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  详情
                </Link>
                <span
                  className={cn(
                    "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium",
                    project.status === "active"
                      ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                      : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
                  )}
                >
                  {project.status === "active" ? "进行中" : "已归档"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProjectModal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          setEditing(null);
        }}
        onSaved={loadProjects}
        editing={editing}
        organizations={organizations}
      />
    </div>
  );
}
