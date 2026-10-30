/**
 * 组织驾驶舱首页 — 岗位视图（A-3，openspec change org-cockpit-home，只读展示）
 *
 * 无 hooks：数据与回调都由 OrgCockpitHome 传入，便于服务端静态渲染测试。
 * 只展示 /api/cockpit/posts 与 /api/cockpit/timeline 的响应（已脱敏），不提供任何改变数据的操作。
 */

import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  HandHelping,
  History,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldAlert,
  UserX,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { hidesWholePage, type PostsState, type TimelineState } from "@/lib/cockpit/home-state";
import type { PostCardView, PostsCockpitResponse } from "@/lib/cockpit/posts-read-model";
import {
  KPI_STATUS_LABELS,
  abnormalAutomations,
  actorLabel,
  formatCount,
  formatKpiValue,
  formatRelativeTime,
  healthPresentation,
  kpiWindowLabel,
  postName,
  waitingCountLabel,
  type CockpitLoadError,
} from "@/lib/cockpit/presentation";
import { cn } from "@/lib/utils";

export type { CockpitLoadError, PostsState, TimelineState };

export interface OrgCockpitViewProps {
  now: Date;
  posts: PostsState;
  timeline: TimelineState;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** 只重试岗位总览，不影响已加载的时间线 */
  onRetry?: () => void;
  /** 只重试时间线，不影响已加载的岗位卡片 */
  onRetryTimeline?: () => void;
  onLoadMore?: () => void;
  /** 卡片与 company.log 之间的区块（A-4 工作量，自带点击加载） */
  workloadSlot?: ReactNode;
}

const WAITING_PREVIEW = 5;

export function OrgCockpitView({
  now,
  posts,
  timeline,
  refreshing,
  onRefresh,
  onRetry,
  onRetryTimeline,
  onLoadMore,
  workloadSlot,
}: OrgCockpitViewProps) {
  const data = posts.status === "ready" ? posts.data : null;
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="岗位视图"
        description="七个岗位在不在干活、哪里卡住、等你拍板几件"
        meta={
          data ? (
            <>
              <span>更新于 {formatRelativeTime(data.generatedAt, now)}</span>
              <span aria-hidden="true">·</span>
              <span>时区 {data.timezone}</span>
              <span aria-hidden="true">·</span>
              <span>心跳与自动化次数为平台级</span>
            </>
          ) : null
        }
        actions={
          onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={posts.status === "loading" || refreshing}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted transition-colors hover:bg-muted/5 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
              刷新
            </button>
          ) : null
        }
      />

      {posts.status === "error" && hidesWholePage(posts.error) ? (
        <div className="mt-6">
          <CockpitErrorState error={posts.error} onRetry={onRetry} />
        </div>
      ) : (
        <>
          {posts.status === "error" ? (
            <div className="mt-6">
              <CockpitErrorState error={posts.error} onRetry={onRetry} />
            </div>
          ) : null}

          {data?.quotaHit ? (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger" role="status">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>今日 AI 运行配额已满：新的 AI 任务会被拦下，相关岗位标为「配额已满」。</span>
            </div>
          ) : null}

          {posts.status !== "error" ? (
            <>
              <div className="mt-5">{data ? <WaitingBanner data={data} now={now} /> : <BannerSkeleton />}</div>

              {/* 列数按内容区宽度（container query）而不是视口：桌面侧栏 240px 会吃掉一大块宽度 */}
              <section aria-labelledby="cockpit-posts-heading" aria-busy={data ? undefined : true} className="@container mt-5">
                <h2 id="cockpit-posts-heading" className="sr-only">
                  岗位
                </h2>
                <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-[repeat(3,minmax(0,1fr))]">
                  {data ? data.posts.map((post) => <PostCard key={post.key} post={post} now={now} />) : <CardsSkeleton />}
                </div>
              </section>
            </>
          ) : null}

          {workloadSlot}

          <section aria-labelledby="cockpit-log-heading" aria-busy={timeline.status === "loading" ? true : undefined} className="mt-8">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="cockpit-log-heading" className="text-sm font-semibold text-foreground">
                company.log
              </h2>
              <span className="text-xs text-muted">最近 7 天 · 系统、AI 与成员的动作</span>
            </div>
            <div className="mt-3">
              <CompanyLog timeline={timeline} now={now} onRetry={onRetryTimeline} onLoadMore={onLoadMore} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ── 等你 N 件 ──────────────────────────────────────────────────

export function WaitingBanner({ data, now }: { data: PostsCockpitResponse; now: Date }) {
  const waiting = data.waitingForYou;
  const items = waiting.items.slice(0, WAITING_PREVIEW);
  return (
    <section aria-label="等你拍板" className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <HandHelping size={18} className="self-center text-warning" />
          <span className="text-sm text-muted">等你拍板</span>
          <span className="text-3xl font-semibold tracking-[-0.5px] text-foreground" data-waiting-count="">
            {waitingCountLabel(waiting.total, waiting.truncated)}
          </span>
          <span className="text-sm text-muted">件</span>
        </div>
        <Link
          href={waiting.href}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-accent px-4 text-sm font-medium text-[color:var(--on-accent)] transition-colors hover:bg-accent-hover"
        >
          去审批
          <ChevronRight size={14} />
        </Link>
      </div>

      {waiting.total === 0 ? (
        <p className="mt-3 text-sm text-muted">暂无待你处理的事项</p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <Link href={item.href} className="-mx-2 flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/5">
                <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
                <span className="shrink-0 text-xs text-muted">{postName(item.post)}</span>
                <span className="w-20 shrink-0 text-right text-xs text-muted">{formatRelativeTime(item.at, now)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {waiting.unattributed > 0 ? (
        <p className="mt-2 text-xs text-muted">其中 {waiting.unattributed} 件暂无法归到具体岗位</p>
      ) : null}
    </section>
  );
}

// ── 岗位卡片 ──────────────────────────────────────────────────

export function PostCard({ post, now }: { post: PostCardView; now: Date }) {
  const health = healthPresentation(post.health);
  const abnormal = abnormalAutomations(post.automations);
  return (
    <Link
      href={post.nav}
      data-post={post.key}
      className="group flex min-h-[44px] flex-col rounded-xl border border-border/60 bg-card p-4 transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-[0_1px_0_rgba(26,36,32,0.03),0_6px_24px_rgba(26,36,32,0.06)]"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-[-0.1px] text-foreground">{post.name}</h3>
        <StatusBadge status={post.health} label={health.label} tone={health.tone} showDot className="shrink-0 whitespace-nowrap" />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Clock size={11} />
          {post.heartbeat ? `心跳 ${formatRelativeTime(post.heartbeat.startedAt, now)}` : "暂无运行记录"}
        </span>
        {post.nextDueAt ? <span>下次 {formatRelativeTime(post.nextDueAt, now)}</span> : null}
      </div>

      <div className="mt-3 min-h-[64px]">
        {post.kpi.status === "ok" ? (
          <>
            {/* 不用 grid-cols-3：globals.css 在 768–1024px 把 .grid-cols-3 强制改成两列，KPI 必须三列并排 */}
            <dl className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2">
              {post.kpi.metrics.map((metric) => (
                <div key={metric.label} className="min-w-0">
                  <dt className="line-clamp-2 text-[11px] leading-tight text-muted" title={metric.label}>
                    {metric.label}
                  </dt>
                  <dd className="mt-0.5 text-lg font-semibold tracking-[-0.3px] text-foreground">
                    {formatKpiValue(metric.value, metric.format)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-1 text-[11px] text-muted/80">{kpiWindowLabel(post.kpi.window)}</p>
          </>
        ) : (
          <p className="text-xs text-muted" data-kpi-status={post.kpi.status}>
            KPI {KPI_STATUS_LABELS[post.kpi.status]}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className={cn("rounded-full px-2 py-0.5", post.pendingApprovals > 0 ? "bg-warning-bg text-warning" : "bg-foreground/[0.05] text-muted")}>
          待审批 {formatCount(post.pendingApprovals)}
        </span>
        <span className={cn("rounded-full px-2 py-0.5", post.needsYou > 0 ? "bg-warning-bg text-warning" : "bg-foreground/[0.05] text-muted")}>
          需要你 {formatCount(post.needsYou)}
        </span>
        {/* AI 运行按本组织统计；自动化运行是平台级，两者分开写，不相加 */}
        <span className="rounded-full bg-foreground/[0.05] px-2 py-0.5 text-muted">
          7 天 AI {formatCount(post.actions7d.agentRuns)} 次 · 平台自动化 {formatCount(post.actions7d.automationRuns)} 次
        </span>
      </div>

      {abnormal.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-border/60 pt-2 text-xs">
          {abnormal.map((a) => (
            <li key={a.name} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-foreground/90">{a.name}</span>
              <span className={cn("shrink-0 whitespace-nowrap", a.health === "failed" ? "text-danger" : "text-warning")}>
                {healthPresentation(a.health).label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <span className="mt-auto flex items-center justify-end pt-2 text-xs text-muted/70 transition-colors group-hover:text-accent">
        查看
        <ChevronRight size={13} />
      </span>
    </Link>
  );
}

// ── company.log ────────────────────────────────────────────────

export function CompanyLog({
  timeline,
  now,
  onRetry,
  onLoadMore,
}: {
  timeline: TimelineState;
  now: Date;
  onRetry?: () => void;
  onLoadMore?: () => void;
}) {
  if (timeline.status === "loading") return <LogSkeleton />;
  if (timeline.status === "error") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-muted">
        <span>{timeline.error === "server" ? "时间线加载失败" : `时间线：${ERROR_COPY[timeline.error].title}`}</span>
        {timeline.error === "server" && onRetry ? (
          <button type="button" onClick={onRetry} className="min-h-[44px] rounded-lg border border-border px-3 text-xs hover:bg-muted/5">
            重试
          </button>
        ) : null}
      </div>
    );
  }
  if (timeline.items.length === 0) {
    return <EmptyState icon={History} title="最近 7 天暂无记录" size="compact" />;
  }
  return (
    <div>
      <ol className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
        {timeline.items.map((entry) => {
          const row = (
            <div className="flex min-h-[44px] flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-start sm:gap-3">
              {/* 窄屏：时间 / 岗位 / 操作者排一行、摘要另起一行；sm 以上 contents 展开成四列 */}
              <div className="flex gap-2 text-xs text-muted sm:contents">
                <span className="sm:w-20 sm:shrink-0 sm:pt-0.5">{formatRelativeTime(entry.at, now)}</span>
                <span className="sm:w-20 sm:shrink-0 sm:pt-0.5">{postName(entry.post)}</span>
                <span className="sm:w-14 sm:shrink-0 sm:pt-0.5">{actorLabel(entry.actor, entry.actorName)}</span>
              </div>
              <span className="min-w-0 flex-1 break-words text-foreground/90 [overflow-wrap:anywhere]">{entry.summary}</span>
            </div>
          );
          return (
            <li key={entry.id} data-entry={entry.kind}>
              {entry.href ? (
                <Link href={entry.href} className="block hover:bg-muted/5">
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ol>
      {timeline.nextCursor && onLoadMore ? (
        <div className="flex justify-center pt-3">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={timeline.loadingMore}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 text-sm hover:bg-muted/5 disabled:opacity-50",
              timeline.loadMoreFailed ? "border-danger/30 text-danger" : "border-border text-muted",
            )}
          >
            {timeline.loadingMore ? (
              <Loader2 size={14} className="animate-spin" />
            ) : timeline.loadMoreFailed ? (
              <RefreshCw size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
            {timeline.loadMoreFailed && !timeline.loadingMore ? "加载失败，点此重试" : "加载更多"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── 状态 ──────────────────────────────────────────────────────

const ERROR_COPY: Record<CockpitLoadError, { title: string; description: string; icon: typeof AlertTriangle }> = {
  org_selection: {
    title: "请先选择工作组织",
    description: "你可使用多个组织，请先在左上角切换到要查看的组织，再刷新本页。",
    icon: Building2,
  },
  no_org: { title: "你还没有加入任何组织", description: "岗位视图按组织展示；请联系组织负责人邀请你加入。", icon: UserX },
  forbidden: { title: "暂无权限查看岗位视图", description: "岗位视图只对组织管理员开放；如需开通请联系组织负责人。", icon: ShieldAlert },
  account_disabled: { title: "账号已停用", description: "你的账号已被停用；如有疑问请联系组织负责人。", icon: UserX },
  session_expired: { title: "登录已过期", description: "请重新登录后再查看岗位视图。", icon: LogIn },
  server: { title: "岗位视图加载失败", description: "请稍后重试；若持续失败，请把时间点告诉管理员排查。", icon: AlertTriangle },
};

export function CockpitErrorState({ error, onRetry }: { error: CockpitLoadError; onRetry?: () => void }) {
  const copy = ERROR_COPY[error];
  return (
    <EmptyState
      icon={copy.icon}
      title={copy.title}
      description={copy.description}
      action={
        error === "session_expired" ? (
          <Link
            href="/login?next=%2F"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent-hover"
          >
            <LogIn size={14} />
            重新登录
          </Link>
        ) : error === "server" && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent-hover"
          >
            <RefreshCw size={14} />
            重试
          </button>
        ) : undefined
      }
    />
  );
}

function BannerSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-border/60 bg-card p-4" aria-hidden="true">
      <div className="h-8 w-40 rounded bg-foreground/[0.07]" />
      <div className="mt-3 h-3 w-2/3 rounded bg-foreground/[0.05]" />
    </div>
  );
}

function CardsSkeleton() {
  return (
    <>
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="h-[196px] animate-pulse rounded-xl border border-border/60 bg-card p-4" aria-hidden="true">
          <div className="h-4 w-1/3 rounded bg-foreground/[0.07]" />
          <div className="mt-2.5 h-3 w-1/2 rounded bg-foreground/[0.05]" />
          <div className="mt-5 h-8 w-full rounded bg-foreground/[0.05]" />
        </div>
      ))}
    </>
  );
}

function LogSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-11 animate-pulse rounded-lg bg-foreground/[0.04]" />
      ))}
    </div>
  );
}
