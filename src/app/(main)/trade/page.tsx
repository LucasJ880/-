"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Loader2,
  Target,
  Users,
  Mail,
  Search,
  Sparkles,
  MoreVertical,
  Pause,
  Play,
  Trash2,
  ArrowRight,
  Clock,
  AlertTriangle,
  ChevronRight,
  TrendingUp,
  FileText,
  Trophy,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";

// ── Types ───────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  productDesc: string;
  targetMarket: string;
  status: string;
  scoreThreshold: number;
  totalProspects: number;
  qualified: number;
  contacted: number;
  searchKeywords: string[] | null;
  createdAt: string;
  _count: { prospects: number };
}

interface FollowUpItem {
  id: string;
  companyName: string;
  contactName: string | null;
  stage: string;
  nextFollowUpAt: string | null;
  isOverdue: boolean;
  daysUntilFollowUp: number | null;
  followUpCount: number;
  campaign: { name: string };
  messages: { content: string; intent: string | null; createdAt: string }[];
}

interface DashboardData {
  overview: {
    totalCampaigns: number;
    activeCampaigns: number;
    totalProspects: number;
    qualified: number;
    contacted: number;
    replied: number;
    won: number;
  };
  funnel: { stage: string; label: string; count: number }[];
  trend: { date: string; discovered: number; contacted: number; replied: number }[];
  topProspects: {
    id: string;
    companyName: string;
    contactName: string | null;
    country: string | null;
    score: number | null;
    stage: string;
    campaign: { name: string };
  }[];
  sourceDistribution: { source: string; count: number }[];
  quoteStats: {
    total: number;
    totalAmount: number;
    draft: number;
    sent: number;
    accepted: number;
    rejected: number;
  };
}

// ── Helpers ─────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  paused: "bg-amber-500/15 text-amber-400",
  completed: "bg-zinc-500/15 text-zinc-400",
};

const STAGE_LABELS: Record<string, string> = {
  new: "新发现",
  researched: "已研究",
  qualified: "合格",
  outreach_ready: "待外联",
  outreach_sent: "已联系",
  interested: "有意向",
  negotiating: "谈判中",
  won: "成交",
  lost: "流失",
  no_response: "无回复",
  unqualified: "不合格",
};

// ── Main Page ───────────────────────────────────────────────

export default function TradeDashboardPage() {
  const { user } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const orgId = "default";

  const loadAll = useCallback(async () => {
    try {
      const [campRes, fuRes, dbRes] = await Promise.all([
        apiFetch(`/api/trade/campaigns?orgId=${orgId}`),
        apiFetch(`/api/trade/follow-ups?orgId=${orgId}&days=7`),
        apiFetch(`/api/trade/dashboard?orgId=${orgId}`),
      ]);
      if (campRes.ok) setCampaigns(await campRes.json());
      if (fuRes.ok) {
        const data = await fuRes.json();
        setFollowUps(data.items ?? []);
      }
      if (dbRes.ok) setDashboard(await dbRes.json());
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const d = dashboard;

  return (
    <div className="space-y-6">
      <PageHeader
        title="外贸获客"
        description="AI 驱动的海外买家发现、研究和外联自动化"
      />

      {/* ── Overview Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <OverviewCard icon={Target} label="活动" value={d?.overview.activeCampaigns ?? 0} sub={`/ ${d?.overview.totalCampaigns ?? 0}`} />
        <OverviewCard icon={Users} label="总线索" value={d?.overview.totalProspects ?? 0} color="blue" />
        <OverviewCard icon={Search} label="合格" value={d?.overview.qualified ?? 0} color="violet" />
        <OverviewCard icon={Mail} label="已联系" value={d?.overview.contacted ?? 0} color="cyan" />
        <OverviewCard icon={TrendingUp} label="已回复" value={d?.overview.replied ?? 0} color="emerald" />
        <OverviewCard icon={Trophy} label="成交" value={d?.overview.won ?? 0} color="amber" />
        <OverviewCard icon={Clock} label="待跟进" value={followUps.length} highlight={followUps.some((f) => f.isOverdue)} />
      </div>

      {/* ── Row: Trend + Funnel ── */}
      {d && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <TrendChart data={d.trend} />
          </div>
          <div className="lg:col-span-2">
            <FunnelChart data={d.funnel} />
          </div>
        </div>
      )}

      {/* ── Row: Source + Quote Stats + Top Prospects ── */}
      {d && (
        <div className="grid gap-4 lg:grid-cols-3">
          <SourceDistribution data={d.sourceDistribution} total={d.overview.totalProspects} />
          <QuoteStatsCard stats={d.quoteStats} />
          <TopProspectsCard prospects={d.topProspects} />
        </div>
      )}

      {/* ── Follow-up Reminders ── */}
      {followUps.length > 0 && <FollowUpSection items={followUps} />}

      {/* ── Campaign List ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted">获客活动</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
        >
          <Plus size={14} />
          新建活动
        </button>
      </div>
      {campaigns.length === 0 ? (
        <EmptyState onCreateClick={() => setShowCreate(true)} />
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              menuOpen={menuOpen === c.id}
              onToggleMenu={() => setMenuOpen(menuOpen === c.id ? null : c.id)}
              onRefresh={loadAll}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCampaignModal
          orgId={orgId}
          userId={user?.id ?? ""}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadAll(); }}
        />
      )}
    </div>
  );
}

// ── Overview Card ────────────────────────────────────────────

function OverviewCard({ icon: Icon, label, value, sub, color, highlight }: {
  icon: typeof Target; label: string; value: number; sub?: string; color?: string; highlight?: boolean;
}) {
  const colorMap: Record<string, string> = {
    blue: "text-blue-400",
    violet: "text-violet-400",
    cyan: "text-cyan-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
  };
  const c = highlight ? "text-amber-400" : colorMap[color ?? ""] ?? "text-muted";
  return (
    <div className={cn("rounded-xl border bg-card-bg px-4 py-3", highlight ? "border-amber-500/40" : "border-border/60")}>
      <div className={cn("flex items-center gap-2", c)}>
        <Icon size={14} />
        <span className="text-xs">{label}</span>
      </div>
      <p className={cn("mt-1 text-xl font-semibold", highlight ? "text-amber-400" : "text-foreground")}>
        {value}
        {sub && <span className="ml-1 text-xs text-muted">{sub}</span>}
      </p>
    </div>
  );
}

// ── Trend Chart (SVG Line Chart) ────────────────────────────

function TrendChart({ data }: { data: DashboardData["trend"] }) {
  const maxVal = Math.max(...data.map((d) => Math.max(d.discovered, d.contacted, d.replied)), 1);
  const w = 100;
  const h = 40;

  function toPoints(key: "discovered" | "contacted" | "replied") {
    return data.map((d, i) => `${(i / (data.length - 1)) * w},${h - (d[key] / maxVal) * h}`).join(" ");
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card-bg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">14 天趋势</h3>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded-full bg-blue-400" />发现</span>
          <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded-full bg-cyan-400" />联系</span>
          <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded-full bg-emerald-400" />回复</span>
        </div>
      </div>
      <svg viewBox={`-2 -2 ${w + 4} ${h + 14}`} className="w-full" preserveAspectRatio="none">
        <polyline points={toPoints("discovered")} fill="none" stroke="#60a5fa" strokeWidth="1" strokeLinejoin="round" />
        <polyline points={toPoints("contacted")} fill="none" stroke="#22d3ee" strokeWidth="1" strokeLinejoin="round" />
        <polyline points={toPoints("replied")} fill="none" stroke="#34d399" strokeWidth="1" strokeLinejoin="round" />
        {data.map((d, i) => {
          const x = (i / (data.length - 1)) * w;
          return i % 3 === 0 ? (
            <text key={i} x={x} y={h + 10} textAnchor="middle" fill="currentColor" className="text-muted" fontSize="3">
              {d.date.slice(5)}
            </text>
          ) : null;
        })}
      </svg>
    </div>
  );
}

// ── Funnel Chart ────────────────────────────────────────────

function FunnelChart({ data }: { data: DashboardData["funnel"] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const colors = ["bg-blue-500/70", "bg-blue-500/55", "bg-violet-500/55", "bg-cyan-500/55", "bg-emerald-500/55", "bg-amber-500/60"];

  return (
    <div className="rounded-xl border border-border/60 bg-card-bg p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground">转化漏斗</h3>
      <div className="space-y-2">
        {data.map((item, i) => {
          const pct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
          const convRate = i > 0 && data[i - 1].count > 0
            ? ((item.count / data[i - 1].count) * 100).toFixed(0)
            : null;
          return (
            <div key={item.stage}>
              <div className="mb-0.5 flex items-center justify-between text-xs">
                <span className="text-foreground">{item.label}</span>
                <span className="text-muted">
                  {item.count}
                  {convRate && <span className="ml-1 text-[10px] text-muted">({convRate}%)</span>}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-border/30">
                <div className={cn("h-full rounded-full transition-all", colors[i % colors.length])} style={{ width: `${Math.max(pct, 2)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Source Distribution ─────────────────────────────────────

function SourceDistribution({ data, total }: { data: DashboardData["sourceDistribution"]; total: number }) {
  const SOURCE_LABELS: Record<string, string> = {
    google_search: "Google 搜索",
    exhibition: "展会",
    linkedin: "LinkedIn",
    referral: "转介绍",
    import: "导入",
    manual: "手动添加",
    unknown: "未知",
  };
  const colors = ["bg-blue-400", "bg-violet-400", "bg-cyan-400", "bg-amber-400", "bg-emerald-400", "bg-rose-400"];

  return (
    <div className="rounded-xl border border-border/60 bg-card-bg p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground">线索来源</h3>
      {data.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted">暂无数据</p>
      ) : (
        <div className="space-y-2">
          {data.slice(0, 6).map((item, i) => {
            const pct = total > 0 ? ((item.count / total) * 100).toFixed(0) : "0";
            return (
              <div key={item.source} className="flex items-center gap-2">
                <div className={cn("h-2 w-2 shrink-0 rounded-full", colors[i % colors.length])} />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{SOURCE_LABELS[item.source] ?? item.source}</span>
                <span className="text-xs text-muted">{item.count}</span>
                <span className="w-8 text-right text-[10px] text-muted">{pct}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Quote Stats Card ────────────────────────────────────────

function QuoteStatsCard({ stats }: { stats: DashboardData["quoteStats"] }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card-bg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">报价统计</h3>
        <Link href="/trade/quotes" className="text-[10px] text-blue-400 hover:text-blue-300">查看全部</Link>
      </div>
      <div className="mb-3 text-center">
        <p className="text-2xl font-bold text-foreground">
          ${stats.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </p>
        <p className="text-[10px] text-muted">{stats.total} 份报价总金额</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg bg-background px-2 py-1.5">
          <p className="text-sm font-semibold text-foreground">{stats.draft}</p>
          <p className="text-[10px] text-muted">草稿</p>
        </div>
        <div className="rounded-lg bg-background px-2 py-1.5">
          <p className="text-sm font-semibold text-blue-400">{stats.sent}</p>
          <p className="text-[10px] text-muted">已发送</p>
        </div>
        <div className="rounded-lg bg-background px-2 py-1.5">
          <p className="text-sm font-semibold text-emerald-400">{stats.accepted}</p>
          <p className="text-[10px] text-muted">已接受</p>
        </div>
        <div className="rounded-lg bg-background px-2 py-1.5">
          <p className="text-sm font-semibold text-red-400">{stats.rejected}</p>
          <p className="text-[10px] text-muted">已拒绝</p>
        </div>
      </div>
    </div>
  );
}

// ── Top Prospects Card ──────────────────────────────────────

function TopProspectsCard({ prospects }: { prospects: DashboardData["topProspects"] }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card-bg p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground">Top 10 线索</h3>
      {prospects.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted">暂无评分线索</p>
      ) : (
        <div className="space-y-1.5">
          {prospects.slice(0, 8).map((p, i) => (
            <a key={p.id} href={`/trade/prospects/${p.id}`} className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-border/20">
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                i < 3 ? "bg-amber-500/20 text-amber-400" : "bg-border/40 text-muted"
              )}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs text-foreground">{p.companyName}</span>
                <span className="text-[10px] text-muted">{p.country ?? ""} · {STAGE_LABELS[p.stage] ?? p.stage}</span>
              </div>
              <span className="text-xs font-semibold text-foreground">{p.score?.toFixed(1)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Follow-up Section ───────────────────────────────────────

function FollowUpSection({ items }: { items: FollowUpItem[] }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Clock size={14} className="text-amber-400" />
        <h3 className="text-sm font-medium text-foreground">
          待跟进（{items.filter((f) => f.isOverdue).length} 已逾期 / {items.length} 总计）
        </h3>
      </div>
      <div className="space-y-1.5">
        {items.slice(0, 5).map((f) => (
          <a key={f.id} href={`/trade/prospects/${f.id}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-amber-500/10">
            {f.isOverdue ? <AlertTriangle size={12} className="shrink-0 text-red-400" /> : <Clock size={12} className="shrink-0 text-amber-400" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium text-foreground">{f.companyName}</span>
                <span className="text-[10px] text-muted">{f.campaign.name}</span>
              </div>
              {f.messages[0] && (
                <p className="mt-0.5 truncate text-[10px] text-muted">最近: {f.messages[0].content.slice(0, 60)}...</p>
              )}
            </div>
            <span className={cn("shrink-0 text-[10px] font-medium", f.isOverdue ? "text-red-400" : "text-amber-400")}>
              {f.isOverdue ? `逾期 ${Math.abs(f.daysUntilFollowUp ?? 0)} 天` : f.daysUntilFollowUp === 0 ? "今天" : `${f.daysUntilFollowUp} 天后`}
            </span>
            <ChevronRight size={12} className="shrink-0 text-muted" />
          </a>
        ))}
        {items.length > 5 && <p className="pt-1 text-center text-[10px] text-muted">还有 {items.length - 5} 条待跟进</p>}
      </div>
    </div>
  );
}

// ── Campaign Card ───────────────────────────────────────────

function CampaignCard({ campaign: c, menuOpen, onToggleMenu, onRefresh }: {
  campaign: Campaign; menuOpen: boolean; onToggleMenu: () => void; onRefresh: () => void;
}) {
  const [genLoading, setGenLoading] = useState(false);

  const handleGenerateKeywords = async () => {
    setGenLoading(true);
    try {
      await apiFetch(`/api/trade/campaigns/${c.id}/generate-keywords`, { method: "POST" });
      onRefresh();
    } finally {
      setGenLoading(false);
    }
  };

  const handleToggleStatus = async () => {
    const newStatus = c.status === "active" ? "paused" : "active";
    await apiFetch(`/api/trade/campaigns/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    onRefresh();
    onToggleMenu();
  };

  const handleDelete = async () => {
    if (!confirm("确定删除该活动？所有线索数据也会被删除。")) return;
    await apiFetch(`/api/trade/campaigns/${c.id}`, { method: "DELETE" });
    onRefresh();
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card-bg p-4 transition hover:border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{c.name}</h3>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_COLORS[c.status])}>
              {STATUS_LABELS[c.status] ?? c.status}
            </span>
          </div>
          <p className="mt-1 line-clamp-1 text-xs text-muted">{c.targetMarket}</p>
        </div>
        <div className="relative">
          <button onClick={onToggleMenu} className="rounded-lg p-1.5 text-muted transition hover:bg-border/40">
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-36 rounded-lg border border-border bg-card-bg py-1 shadow-lg">
              <button onClick={handleToggleStatus} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-border/30">
                {c.status === "active" ? <Pause size={12} /> : <Play size={12} />}
                {c.status === "active" ? "暂停" : "恢复"}
              </button>
              <button onClick={handleDelete} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-border/30">
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-muted">
        <span>{c._count.prospects} 线索</span>
        <span>{c.qualified} 合格</span>
        <span>{c.contacted} 已联系</span>
        <span>门槛 ≥{c.scoreThreshold}</span>
      </div>
      <div className="mt-3">
        {c.searchKeywords && Array.isArray(c.searchKeywords) && c.searchKeywords.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {(c.searchKeywords as string[]).slice(0, 6).map((kw, i) => (
              <span key={i} className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">{kw}</span>
            ))}
            {(c.searchKeywords as string[]).length > 6 && (
              <span className="rounded-md bg-zinc-500/10 px-2 py-0.5 text-[10px] text-muted">+{(c.searchKeywords as string[]).length - 6}</span>
            )}
          </div>
        ) : (
          <button onClick={handleGenerateKeywords} disabled={genLoading} className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted transition hover:border-blue-500/50 hover:text-blue-400">
            {genLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {genLoading ? "AI 生成中..." : "生成搜索关键词"}
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center justify-end">
        <a href={`/trade/campaigns/${c.id}`} className="flex items-center gap-1 text-xs text-blue-400 transition hover:text-blue-300">
          查看线索 <ArrowRight size={12} />
        </a>
      </div>
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────────

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-card-bg px-8 py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10">
        <Target className="h-8 w-8 text-blue-400" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">开始第一个获客活动</h2>
      <p className="mt-2 max-w-md text-sm text-muted">
        描述你的产品和目标市场，AI 会自动生成搜索关键词、发现潜在买家、生成研究报告和个性化开发信。
      </p>
      <button onClick={onCreateClick} className="mt-6 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
        <Plus size={16} /> 新建获客活动
      </button>
    </div>
  );
}

// ── Create Modal ────────────────────────────────────────────

function CreateCampaignModal({ orgId, userId, onClose, onCreated }: {
  orgId: string; userId: string; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [targetMarket, setTargetMarket] = useState("");
  const [scoreThreshold, setScoreThreshold] = useState(7);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !productDesc.trim() || !targetMarket.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/trade/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, name, productDesc, targetMarket, scoreThreshold }),
      });
      if (res.ok) onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card-bg p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-foreground">新建获客活动</h2>
        <p className="mt-1 text-xs text-muted">描述你的产品和理想客户，AI 会帮你找到海外买家</p>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">活动名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：2026 Q2 欧洲窗饰买家开发" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">产品描述<span className="ml-1 text-muted">（AI 会基于此生成搜索词和开发信）</span></label>
            <textarea value={productDesc} onChange={(e) => setProductDesc(e.target.value)} rows={3} placeholder="例：我们是中国绍兴的窗帘面料工厂..." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">目标市场 / 理想客户画像（ICP）</label>
            <textarea value={targetMarket} onChange={(e) => setTargetMarket(e.target.value)} rows={3} placeholder="例：目标欧美窗饰品牌商和进口商..." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">合格分数门槛（0-10）</label>
            <input type="number" min={0} max={10} step={0.5} value={scoreThreshold} onChange={(e) => setScoreThreshold(Number(e.target.value))} className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none" />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted transition hover:text-foreground">取消</button>
            <button type="submit" disabled={saving || !name.trim() || !productDesc.trim() || !targetMarket.trim()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />}
              创建活动
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
