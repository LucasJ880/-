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
      const res = await fetch(url, {
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
                所属组织 <span className="text-red-500">*</span>
              </label>
              {activeOrgs.length === 0 ? (
                <p className="text-sm text-amber-600">
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
              项目名称 <span className="text-red-500">*</span>
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
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
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
  project,
  onEdit,
  onDelete,
}: {
  project: Project;
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
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-500 transition-colors hover:bg-red-50"
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
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const loadProjects = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/organizations")
        .then((r) => r.json())
        .then((d) => d.organizations ?? []),
    ])
      .then(([projs, orgs]) => {
        setProjects(Array.isArray(projs) ? projs : []);
        setOrganizations(Array.isArray(orgs) ? orgs : []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleDelete = async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    loadProjects();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">项目管理</h1>
          <p className="mt-1 text-sm text-muted">
            管理您的工作项目，组织和追踪任务进度
          </p>
        </div>
        <button
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

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border">
          <FolderKanban size={32} className="text-muted" />
          <p className="mt-2 text-sm text-muted">暂无项目</p>
          <button
            onClick={() => {
              setEditing(null);
              setShowModal(true);
            }}
            className="mt-2 text-sm text-accent hover:text-accent-hover"
          >
            点击创建第一个项目
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
                        <span className="ml-1 text-amber-600">· 未绑定组织</span>
                      )}
                    </p>
                  </div>
                </div>
                <ProjectMenu
                  project={project}
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
                      ? "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-600"
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
