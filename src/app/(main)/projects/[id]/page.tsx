"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
  MessageSquare,
  Bot,
  Wrench,
  Star,
  BarChart3,
  Tag,
  History,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { ProjectNotificationRuleCard } from "@/components/notification/project-notification-rule-card";
import { ProjectDashboard } from "@/components/project-dashboard/project-dashboard";
import { ProgressComparison } from "@/components/progress/progress-comparison";
import { StageIndicator } from "@/components/progress/stage-indicator";
import type { FormattedActivity } from "@/lib/activity/formatter";
import type { ProjectProgress } from "@/lib/progress/types";

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
  return (
    <Suspense fallback={<div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
      <ProjectDetailContent />
    </Suspense>
  );
}

function ProjectDetailContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const highlightActivityId = searchParams.get("activity") ?? undefined;

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

  const [activities, setActivities] = useState<FormattedActivity[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState("");
  const [progress, setProgress] = useState<ProjectProgress | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      apiFetch(`/api/projects/${id}`).then((r) => r.json()),
      apiFetch(`/api/projects/${id}/members`).then((r) => r.json()),
      apiFetch(`/api/projects/${id}/environments`).then((r) => r.json()),
      apiFetch(`/api/projects/${id}/overview`).then((r) => r.json()).catch(() => null),
    ])
      .then(([p, m, e, ov]) => {
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
        if (ov?.progress) setProgress(ov.progress);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const loadActivity = useCallback(
    (page = 1, targetType = "") => {
      if (!id) return;
      setActivityLoading(true);
      const qs = new URLSearchParams({ page: String(page), pageSize: "15" });
      if (targetType) qs.set("targetType", targetType);
      apiFetch(`/api/projects/${id}/activity?${qs}`)
        .then((r) => r.json())
        .then((res) => {
          if (page === 1) {
            setActivities(res.data ?? []);
          } else {
            setActivities((prev) => [...prev, ...(res.data ?? [])]);
          }
          setActivityTotal(res.total ?? 0);
          setActivityPage(page);
        })
        .finally(() => setActivityLoading(false));
    },
    [id]
  );

  useEffect(() => {
    load();
    loadActivity(1, "");
  }, [load, loadActivity]);

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
        <div className="rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
          {error || "项目不存在或无权访问"}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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
              <Link
                href={`/projects/${id}/conversations`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <MessageSquare size={12} />
                会话管理
              </Link>
              <Link
                href={`/projects/${id}/agents`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <Bot size={12} />
                Agent 管理
              </Link>
              <Link
                href={`/projects/${id}/tools`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <Wrench size={12} />
                工具注册
              </Link>
              <Link
                href={`/projects/${id}/feedbacks`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <Star size={12} />
                评估反馈
              </Link>
              <Link
                href={`/projects/${id}/quality`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <BarChart3 size={12} />
                质量概览
              </Link>
              <Link
                href={`/projects/${id}/feedback-tags`}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/80"
              >
                <Tag size={12} />
                评估标签
              </Link>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-medium",
                  project.status === "active"
                    ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                    : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
                )}
              >
                {project.status === "active" ? "进行中" : project.status}
              </span>
              {project.org ? (
                <Link
                  href={`/organizations/${project.org.id}`}
                  className="rounded-md bg-[rgba(110,125,118,0.08)] px-2 py-0.5 text-[#6e7d76] hover:bg-[rgba(110,125,118,0.12)]"
                >
                  组织：{project.org.name} ({project.org.code})
                </Link>
              ) : (
                <span className="rounded-md bg-[rgba(154,106,47,0.04)] px-2 py-0.5 text-[#9a6a2f]">
                  未绑定组织（历史项目）
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* progress section */}
      {progress && (
        <div className="rounded-xl border border-border bg-card-bg p-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BarChart3 size={16} className="text-accent/60" />
              项目进度
            </h3>
            {progress.stages.length > 0 && (
              <StageIndicator stages={progress.stages} />
            )}
          </div>
          <div className="mt-4">
            <ProgressComparison
              taskProgress={progress.taskProgress}
              timeProgress={progress.timeProgress}
              completedTasks={progress.completedTasks}
              totalTasks={progress.totalTasks}
              daysRemaining={progress.daysRemaining}
              daysTotal={progress.daysTotal}
              isOverdue={progress.isOverdue}
              riskLabel={progress.riskLabel}
            />
          </div>
        </div>
      )}

      <ProjectDashboard projectId={id} />

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
                        className="text-[#a63d3d] hover:text-[#a63d3d] disabled:opacity-50"
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
              className="rounded-[var(--radius-sm)] bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
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
                      ? "bg-[rgba(46,122,86,0.04)] text-[#2e7a56]"
                      : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
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
                    className="text-xs text-[#a63d3d] hover:underline disabled:opacity-50"
                  >
                    归档
                  </button>
                )}
            </li>
          ))}
        </ul>
      </div>

      <ProjectNotificationRuleCard projectId={id} />

      {/* 项目动态时间线 */}
      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <History size={16} className="text-accent/60" />
            项目动态
            {activityTotal > 0 && (
              <span className="text-xs font-normal text-muted">
                共 {activityTotal} 条
              </span>
            )}
          </div>
          <select
            value={activityFilter}
            onChange={(e) => {
              setActivityFilter(e.target.value);
              loadActivity(1, e.target.value);
            }}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-accent"
          >
            <option value="">全部类型</option>
            <option value="project">项目</option>
            <option value="prompt">Prompt</option>
            <option value="knowledge_base">知识库</option>
            <option value="conversation">会话</option>
            <option value="agent">Agent</option>
            <option value="tool">工具</option>
            <option value="runtime">Runtime</option>
            <option value="conversation_feedback">反馈</option>
          </select>
        </div>

        <div className="mt-4">
          <ActivityTimeline activities={activities} loading={activityLoading && activityPage === 1} highlightId={highlightActivityId} />
        </div>

        {activities.length < activityTotal && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              disabled={activityLoading}
              onClick={() => loadActivity(activityPage + 1, activityFilter)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-4 py-2 text-xs font-medium text-muted transition-colors hover:bg-[rgba(43,96,85,0.04)] hover:text-foreground disabled:opacity-50"
            >
              {activityLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <ChevronDown size={12} />
              )}
              加载更多
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
