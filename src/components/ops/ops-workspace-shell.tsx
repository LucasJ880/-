"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import type {
  OpsDashboardData,
  OpsDashboardItem,
  OpsPendingActionSummary,
  OpsRelatedProjectSummary,
  OpsTaskSummary,
} from "@/lib/operations/dashboard";
import { OpsSubnav } from "@/components/ops/ops-subnav";

type LoadState = "loading" | "ready" | "error" | "unauthorized";

function statusTone(label: string): string {
  if (label.includes("逾期")) return "text-red-700";
  if (label.includes("今天") || label.includes("等待")) return "text-amber-700";
  if (label.includes("进行")) return "text-[var(--accent)]";
  return "text-[var(--muted)]";
}

function ItemRow({ item }: { item: OpsDashboardItem }) {
  return (
    <li className="border-b border-[var(--border)] py-3 last:border-b-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-[14px] font-medium text-[var(--foreground)]">
            {item.title}
          </p>
          <p className="text-[12px] text-[var(--muted)]">
            {item.projectName ? `项目：${item.projectName}` : "项目：—"}
            {" · "}
            <span className={statusTone(item.statusLabel)}>{item.statusLabel}</span>
            {item.assigneeName ? ` · 负责人：${item.assigneeName}` : ""}
            {item.dueAt
              ? ` · 截止：${new Date(item.dueAt).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
            {` · 来源：${item.sourceLabel}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href={item.href}
            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--foreground)] hover:bg-[var(--background)]"
          >
            打开
          </Link>
          {item.secondaryHref ? (
            <Link
              href={item.secondaryHref}
              className="rounded-md px-2.5 py-1 text-[12px] text-[var(--accent)] hover:underline"
            >
              打开项目
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function TaskRow({ task }: { task: OpsTaskSummary }) {
  return (
    <li className="border-b border-[var(--border)] py-2.5 last:border-b-0">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">
            <span className="mr-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">
              {task.priority}
            </span>
            {task.title}
          </p>
          <p className="text-[12px] text-[var(--muted)]">
            {task.projectName ?? "无项目"}
            {" · "}
            {task.status}
            {task.assigneeName ? ` · ${task.assigneeName}` : ""}
            {task.dueAt
              ? ` · ${new Date(task.dueAt).toLocaleDateString("zh-CN")}`
              : ""}
            {` · ${task.sourceLabel}`}
          </p>
        </div>
        <Link
          href={`/tasks?focus=${task.id}`}
          className="shrink-0 text-[12px] text-[var(--accent)] hover:underline"
        >
          打开任务
        </Link>
      </div>
    </li>
  );
}

function PendingRow({ item }: { item: OpsPendingActionSummary }) {
  return (
    <li className="border-b border-[var(--border)] py-2.5 last:border-b-0">
      <p className="text-[13px] font-medium">{item.title}</p>
      <p className="mt-0.5 text-[12px] text-[var(--muted)]">
        {item.type}
        {item.projectName ? ` · ${item.projectName}` : ""}
        {" · "}
        {new Date(item.createdAt).toLocaleString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
        {item.agentRunId ? " · AgentRun" : ""}
      </p>
      {item.reasonPreview ? (
        <p className="mt-1 text-[12px] text-[var(--muted)] line-clamp-2">
          {item.reasonPreview}
        </p>
      ) : null}
      <Link
        href={item.href}
        className="mt-1 inline-block text-[12px] text-[var(--accent)] hover:underline"
      >
        打开审批
      </Link>
    </li>
  );
}

function ProjectRow({ project }: { project: OpsRelatedProjectSummary }) {
  const href = project.href || `/ops/projects/${project.id}`;
  return (
    <li className="border-b border-[var(--border)] py-2.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{project.name}</p>
          <p className="text-[12px] text-[var(--muted)]">
            {project.deliveryStageLabel || "未设阶段"}
            {project.healthLabel ? ` · ${project.healthLabel}` : ""}
            {project.ownerName ? ` · ${project.ownerName}` : ""}
            {project.plannedCompletionDate
              ? ` · 计划 ${new Date(project.plannedCompletionDate).toLocaleDateString("zh-CN")}`
              : ""}
            {project.primaryRisk ? ` · ${project.primaryRisk}` : ""}
          </p>
        </div>
        <Link
          href={href}
          className="shrink-0 text-[12px] text-[var(--accent)] hover:underline"
        >
          打开执行项目
        </Link>
      </div>
    </li>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
        <h2 className="text-[15px] font-semibold text-[var(--foreground)]">
          {title}
        </h2>
        {typeof count === "number" ? (
          <span className="text-[12px] tabular-nums text-[var(--muted)]">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function OpsWorkspaceShell() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [data, setData] = useState<OpsDashboardData | null>(null);
  const [view, setView] = useState<"mine" | "team">("mine");

  const load = useCallback(async (nextView: "mine" | "team") => {
    setLoadState("loading");
    try {
      const res = await apiFetch(`/api/ops/home?view=${nextView}`);
      if (res.status === 403) {
        setData(null);
        setLoadState("unauthorized");
        return;
      }
      if (!res.ok) throw new Error(`ops home ${res.status}`);
      const json = (await res.json()) as OpsDashboardData;
      setData(json);
      setView(json.viewMode);
      setLoadState("ready");
    } catch {
      setData(null);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load("mine");
  }, [load]);

  if (loadState === "unauthorized") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-xl font-semibold">无权访问运营中心</h1>
        <p className="mt-2 text-[14px] text-[var(--muted)]">
          如需开通，请联系组织管理员。
        </p>
        <Link href="/" className="mt-4 inline-block text-[var(--accent)]">
          返回首页
        </Link>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-16">
        <h1 className="text-xl font-semibold">运营中心暂时无法加载</h1>
        <p className="text-[14px] text-[var(--muted)]">请稍后重试。</p>
        <button
          type="button"
          onClick={() => void load(view)}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[13px] text-[var(--on-accent)]"
        >
          重新加载
        </button>
      </div>
    );
  }

  if (loadState === "loading" && !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <p className="text-[14px] text-[var(--muted)]">正在加载今日运营工作台…</p>
      </div>
    );
  }

  if (!data) return null;

  const focusProjects =
    data.focusDeliveryProjects ?? data.relatedProjects ?? [];

  const emptyAll =
    data.urgentItems.length === 0 &&
    data.todayTasks.length === 0 &&
    data.waitingItems.length === 0 &&
    data.pendingActions.length === 0 &&
    focusProjects.length === 0;

  return (
    <div>
      <OpsSubnav />
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <header className="flex flex-col gap-4 border-b border-[var(--border)] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-[12px] font-medium text-[var(--muted)]">运营中心</p>
          <h1 className="text-2xl font-semibold tracking-tight">今日运营工作台</h1>
          <p className="text-[13px] text-[var(--muted)]">
            {data.dateLabel}
            {data.userName ? ` · ${data.userName}` : ""}
            {" · "}
            优先处理可行动事项，而非统计卡片
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.canToggleTeamView ? (
            <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => void load("mine")}
                className={`rounded-md px-3 py-1.5 ${
                  view === "mine"
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "text-[var(--muted)]"
                }`}
              >
                我的工作
              </button>
              <button
                type="button"
                onClick={() => void load("team")}
                className={`rounded-md px-3 py-1.5 ${
                  view === "team"
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "text-[var(--muted)]"
                }`}
              >
                团队工作
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void load(view)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px]"
          >
            刷新
          </button>
          <Link
            href="/assistant"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px]"
          >
            数字员工
          </Link>
          <Link
            href="/tasks"
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--on-accent)]"
          >
            查看我的全部工作
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 border-b border-[var(--border)] pb-4 sm:grid-cols-4">
        {[
          {
            label: "已逾期",
            value: data.counts.overdue,
            href: "/tasks?due=overdue",
          },
          {
            label: "今天到期",
            value: data.counts.dueToday,
            href: "/tasks?due=today",
          },
          {
            label: "进行中",
            value: data.counts.inProgress,
            href: "/tasks?bucket=open",
          },
          {
            label: "待审批",
            value: data.counts.pendingApproval,
            href: "/capabilities/approvals",
          },
        ].map((c) => (
          <Link key={c.label} href={c.href} className="px-1 py-1 hover:opacity-80">
            <p className="text-[11px] text-[var(--muted)]">{c.label}</p>
            <p className="text-xl font-semibold tabular-nums">{c.value}</p>
          </Link>
        ))}
      </div>

      {emptyAll ? (
        <div className="rounded-xl border border-[var(--border)] px-4 py-8">
          <p className="text-[14px]">当前还没有可展示的运营事项。</p>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            运营任务、执行项目和 AI 建议将在有真实数据后出现，不会填充演示内容。
          </p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-8">
            <Section title="必须立即处理" count={data.urgentItems.length}>
              {data.urgentItems.length ? (
                <ul>
                  {data.urgentItems.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-[13px] text-[var(--muted)]">
                  暂无需要立即处理的事项
                </p>
              )}
            </Section>

            <Section title="今日工作队列" count={data.todayTasks.length}>
              {data.todayTasks.length ? (
                <>
                  <ul>
                    {data.todayTasks.map((t) => (
                      <TaskRow key={t.id} task={t} />
                    ))}
                  </ul>
                  <Link
                    href="/tasks"
                    className="mt-2 inline-block text-[12px] text-[var(--accent)] hover:underline"
                  >
                    查看全部任务
                  </Link>
                </>
              ) : (
                <p className="py-4 text-[13px] text-[var(--muted)]">今日暂无任务</p>
              )}
            </Section>

            <Section title="等待中的事项" count={data.waitingItems.length}>
              {data.waitingItems.length ? (
                <ul>
                  {data.waitingItems.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-[13px] text-[var(--muted)]">
                  暂无有依据的等待事项（不会猜测客户/厂家回复）
                </p>
              )}
            </Section>

            <Section title="重点执行项目" count={focusProjects.length}>
              <p className="text-[12px] text-[var(--muted)]">
                仅展示 workDomain=delivery 的正式执行项目；招投标项目不会出现在此。
              </p>
              {focusProjects.length ? (
                <ul>
                  {focusProjects.map((p) => (
                    <ProjectRow key={p.id} project={p} />
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-[13px] text-[var(--muted)]">
                  当前还没有执行项目。可在「执行项目」中手动创建；中标自动交接将在后续阶段开放。
                </p>
              )}
              <Link
                href="/ops/projects"
                className="mt-2 inline-block text-[12px] text-[var(--accent)] hover:underline"
              >
                查看全部执行项目
              </Link>
            </Section>
          </div>

          <aside className="min-w-0 space-y-6 lg:border-l lg:border-[var(--border)] lg:pl-6">
            <Section title="AI 已准备行动" count={data.pendingActions.length}>
              {data.pendingActions.length ? (
                <ul>
                  {data.pendingActions.map((a) => (
                    <PendingRow key={a.id} item={a} />
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-[13px] text-[var(--muted)]">
                  暂无待确认的 AI 行动
                </p>
              )}
              <Link
                href="/capabilities/approvals"
                className="mt-2 inline-block text-[12px] text-[var(--accent)] hover:underline"
              >
                进入审批中心
              </Link>
            </Section>
          </aside>
        </div>
      )}
    </div>
    </div>
  );
}
