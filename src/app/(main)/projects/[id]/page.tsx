"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  FolderKanban,
  Layers,
  Users,
  Trash2,
  FileText,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

const PROJECT_ROLES = [
  "project_admin",
  "operator",
  "tester",
  "viewer",
] as const;

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  orgId: string | null;
  owner: { id: string; name: string; email: string };
  org: {
    id: string;
    name: string;
    code: string;
    status: string;
  } | null;
  _count: { tasks: number; environments: number; members: number };
}

interface MemberRow {
  id: string;
  userId: string;
  role: string;
  status: string;
  orgRole: string | null;
  user: { id: string; email: string; name: string };
}

interface EnvRow {
  id: string;
  name: string;
  code: string;
  status: string;
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [environments, setEnvironments] = useState<EnvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<string>("viewer");
  const [envName, setEnvName] = useState("");
  const [envCode, setEnvCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      apiFetch(`/api/projects/${id}`).then((r) => r.json()),
      apiFetch(`/api/projects/${id}/members`).then((r) => r.json()),
      apiFetch(`/api/projects/${id}/environments`).then((r) => r.json()),
    ])
      .then(([p, m, e]) => {
        if (p.error) {
          setError(p.error);
          setProject(null);
        } else {
          setProject(p.project);
          setCanManage(!!p.canManage);
          setError("");
        }
        setMembers(m.members ?? []);
        setEnvironments(e.environments ?? []);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const uid = addUserId.trim();
    if (!uid) return;
    setBusy("member");
    try {
      const res = await apiFetch(`/api/projects/${id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid, role: addRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "添加失败");
      setAddUserId("");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "添加失败");
    } finally {
      setBusy(null);
    }
  }

  async function patchMember(memberId: string, role: string) {
    setBusy(memberId);
    try {
      const res = await apiFetch(`/api/projects/${id}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "更新失败");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新失败");
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm("从项目移除此成员？")) return;
    setBusy(memberId);
    try {
      const res = await apiFetch(`/api/projects/${id}/members/${memberId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "移除失败");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "移除失败");
    } finally {
      setBusy(null);
    }
  }

  async function addEnv(e: React.FormEvent) {
    e.preventDefault();
    const n = envName.trim();
    if (!n) return;
    setBusy("env");
    try {
      const res = await apiFetch(`/api/projects/${id}/environments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: n,
          ...(envCode.trim() ? { code: envCode.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "创建失败");
      setEnvName("");
      setEnvCode("");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(null);
    }
  }

  async function archiveEnv(env: EnvRow) {
    if (env.code === "test" || env.code === "prod") {
      alert("系统默认环境不可归档");
      return;
    }
    if (!confirm(`归档环境「${env.name}」？`)) return;
    setBusy(env.id);
    try {
      const res = await apiFetch(`/api/projects/${id}/environments/${env.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "归档失败");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "归档失败");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <button
          type="button"
          onClick={() => router.push("/projects")}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} /> 返回项目列表
        </button>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error || "项目不存在或无权访问"}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button
        type="button"
        onClick={() => router.push("/projects")}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 项目列表
      </button>

      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-start gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ backgroundColor: project.color }}
          >
            <FolderKanban size={28} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">{project.name}</h1>
            <p className="mt-1 text-sm text-muted">
              负责人 {project.owner.name} · {project._count.tasks} 任务 ·{" "}
              {project._count.members} 成员 · {project._count.environments} 环境
            </p>
            {project.description && (
              <p className="mt-2 text-sm text-muted">{project.description}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Link
                href={`/projects/${id}/prompts`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <FileText size={12} />
                Prompt 管理
              </Link>
              <Link
                href={`/projects/${id}/knowledge-bases`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <BookOpen size={12} />
                知识库
              </Link>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-medium",
                  project.status === "active"
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-100 text-slate-600"
                )}
              >
                {project.status === "active" ? "进行中" : project.status}
              </span>
              {project.org ? (
                <Link
                  href={`/organizations/${project.org.id}`}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-slate-200"
                >
                  组织：{project.org.name} ({project.org.code})
                </Link>
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                  未绑定组织（历史项目）
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users size={16} />
          项目成员
        </div>
        {canManage && (
          <form onSubmit={addMember} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <input
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              placeholder="用户 ID（须已加入所属组织）"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy === "member"}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              添加
            </button>
          </form>
        )}
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="pb-2">用户</th>
              <th className="pb-2">邮箱</th>
              <th className="pb-2">项目角色</th>
              <th className="pb-2">组织角色</th>
              <th className="pb-2">状态</th>
              {canManage && <th className="pb-2 w-10" />}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-border/60">
                <td className="py-2">{m.user.name}</td>
                <td className="py-2 text-muted">{m.user.email}</td>
                <td className="py-2">
                  {canManage && m.status === "active" ? (
                    <select
                      value={m.role}
                      disabled={busy === m.id}
                      onChange={(e) => patchMember(m.id, e.target.value)}
                      className="rounded border border-border bg-background px-2 py-1 text-xs"
                    >
                      {PROJECT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    m.role
                  )}
                </td>
                <td className="py-2 text-muted">{m.orgRole ?? "—"}</td>
                <td className="py-2">{m.status}</td>
                {canManage && (
                  <td className="py-2">
                    {m.status === "active" && (
                      <button
                        type="button"
                        onClick={() => removeMember(m.id)}
                        disabled={busy === m.id}
                        className="text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Layers size={16} />
          环境
        </div>
        <p className="mt-1 text-xs text-muted">
          新建项目会自动创建 test / prod；自定义环境请使用未占用的 code（如 staging）。
        </p>
        {canManage && (
          <form onSubmit={addEnv} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <input
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
              placeholder="环境名称"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <input
              value={envCode}
              onChange={(e) => setEnvCode(e.target.value)}
              placeholder="code（可选，默认从名称生成）"
              className="w-full sm:w-48 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy === "env"}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-900 disabled:opacity-50"
            >
              新增环境
            </button>
          </form>
        )}
        <ul className="mt-4 space-y-2">
          {environments.map((env) => (
            <li
              key={env.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">{env.name}</span>
                <span className="ml-2 text-xs text-muted">({env.code})</span>
                <span
                  className={cn(
                    "ml-2 rounded px-1.5 py-0.5 text-[10px]",
                    env.status === "active"
                      ? "bg-green-50 text-green-700"
                      : "bg-slate-100 text-slate-600"
                  )}
                >
                  {env.status}
                </span>
              </div>
              {canManage &&
                env.status === "active" &&
                env.code !== "test" &&
                env.code !== "prod" && (
                  <button
                    type="button"
                    onClick={() => archiveEnv(env)}
                    disabled={busy === env.id}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    归档
                  </button>
                )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
