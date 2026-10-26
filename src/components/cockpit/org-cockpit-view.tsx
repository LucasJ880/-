/**
 * 组织驾驶舱首页 — 岗位视图（A-3，openspec change org-cockpit-home，只读展示）
 *
 * 无 hooks：数据与回调都由 OrgCockpitHome 传入，便于服务端静态渲染测试。
 * 只展示 /api/cockpit/posts 与 /api/cockpit/timeline 的响应（已脱敏），不提供任何改变数据的操作。
 */

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
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import type { PostCardView, PostsCockpitResponse } from "@/lib/cockpit/posts-read-model";
import {
  KPI_STATUS_LABELS,
  abnormalAutomations,
  actorLabel,
  formatKpiValue,
  formatRelativeTime,
  healthPresentation,
  kpiWindowLabel,
  postName,
  waitingCountLabel,
} from "@/lib/cockpit/presentation";
import type { TimelineEntry } from "@/lib/cockpit/timeline";
import { cn } from "@/lib/utils";

export type CockpitLoadError = "org_selection" | "forbidden" | "server";

export type PostsState =
  | { status: "loading" }
  | { status: "error"; error: CockpitLoadError }
  | { status: "ready"; data: PostsCockpitResponse };

export type TimelineState =
  | { status: "loading" }
  | { status: "error"; error: CockpitLoadError }
  | { status: "ready"; items: TimelineEntry[]; nextCursor: string | null; loadingMore?: boolean };

export interface OrgCockpitViewProps {
  now: Date;
  posts: PostsState;
  timeline: TimelineState;
  refreshing?: boolean;
  onRefresh?: () => void;
  onRetry?: () => void;
  onLoadMore?: () => void;
}

const WAITING_PREVIEW = 5;

export function OrgCockpitView({ now, posts, timeline, refreshing, onRefresh, onRetry, onLoadMore }: OrgCockpitViewProps) {
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
              <span>心跳为平台级</span>
            </>
          ) : null
        }
        actions={
          onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={posts.status === "loading" || refreshing}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted transition-colors hover:bg-muted/5 hover:text-foreground disabled:opacity-50 sm:min-h-0 sm:py-1.5"
            >
              <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
              刷新
            </button>
          ) : null
        }
      />

      {posts.status === "error" ? (
        <div className="mt-6">
          <CockpitErrorState error={posts.error} onRetry={onRetry} />
        </div>
      ) : (
        <>
          {data?.quotaHit ? (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger" role="status">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>今日 AI 运行配额已满：新的 AI 任务会被拦下，相关岗位标为「配额已满」。</span>
            </div>
          ) : null}

          <div className="mt-5">{data ? <WaitingBanner data={data} now={now} /> : <BannerSkeleton />}</div>

          <section aria-label="岗位" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data ? data.posts.map((post) => <PostCard key={post.key} post={post} now={now} />) : <CardsSkeleton />}
          </section>

          <section aria-label="company.log" className="mt-8">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">company.log</h2>
              <span className="text-xs text-muted">最近 7 天 · 系统、AI 与成员的动作</span>
            </div>
            <div className="mt-3">
              <CompanyLog timeline={timeline} now={now} onRetry={onRetry} onLoadMore={onLoadMore} />
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
          <span className="text-3xl font-semibold tracking-[-0.5px] text-foreground" data-testid="waiting-count">
            {waitingCountLabel(waiting.total, waiting.truncated)}
          </span>
          <span className="text-sm text-muted">件</span>
        </div>
        <Link
          href={waiting.href}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
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
              <Link href={item.href} className="flex min-h-[44px] items-center gap-3 py-2 text-sm hover:text-accent">
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
  const actions = post.actions7d.agentRuns + post.actions7d.automationRuns;
  return (
    <Link
      href={post.nav}
      data-post={post.key}
      className="group flex min-h-[44px] flex-col rounded-xl border border-border/60 bg-card p-4 transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-[0_1px_0_rgba(26,36,32,0.03),0_6px_24px_rgba(26,36,32,0.06)]"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-[-0.1px] text-foreground">{post.name}</h3>
        <StatusBadge status={post.health} label={health.label} tone={health.tone} showDot />
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
                  <dt className="truncate text-[11px] text-muted">{metric.label}</dt>
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
          待审批 {post.pendingApprovals}
        </span>
        <span className={cn("rounded-full px-2 py-0.5", post.needsYou > 0 ? "bg-warning-bg text-warning" : "bg-foreground/[0.05] text-muted")}>
          需要你 {post.needsYou}
        </span>
        <span className="rounded-full bg-foreground/[0.05] px-2 py-0.5 text-muted">7 天 {actions} 次动作</span>
      </div>

      {abnormal.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-border/60 pt-2 text-xs">
          {abnormal.map((a) => (
            <li key={a.name} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-foreground/90">{a.name}</span>
              <span className={a.health === "failed" ? "text-danger" : "text-warning"}>{healthPresentation(a.health).label}</span>
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
        <span>时间线加载失败</span>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="min-h-[44px] rounded-lg border border-border px-3 text-xs hover:bg-muted/5 sm:min-h-0 sm:py-1.5">
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
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-4 text-sm text-muted hover:bg-muted/5 disabled:opacity-50"
          >
            {timeline.loadingMore ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />}
            加载更多
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── 状态 ──────────────────────────────────────────────────────

const ERROR_COPY: Record<CockpitLoadError, { title: string; description: string }> = {
  org_selection: { title: "请先选择工作组织", description: "你可使用多个组织，请先在左上角切换到要查看的组织，再刷新本页。" },
  forbidden: { title: "暂无权限查看岗位视图", description: "岗位视图只对组织管理员开放；如需开通请联系组织负责人。" },
  server: { title: "岗位视图加载失败", description: "请稍后重试；若持续失败，请把时间点告诉管理员排查。" },
};

export function CockpitErrorState({ error, onRetry }: { error: CockpitLoadError; onRetry?: () => void }) {
  const copy = ERROR_COPY[error];
  const Icon = error === "org_selection" ? Building2 : error === "forbidden" ? ShieldAlert : AlertTriangle;
  return (
    <EmptyState
      icon={Icon}
      title={copy.title}
      description={copy.description}
      action={
        error === "server" && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
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
