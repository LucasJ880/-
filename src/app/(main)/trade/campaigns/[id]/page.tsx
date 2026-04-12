"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Sparkles,
  User,
  Globe,
  Mail,
  Star,
  ChevronRight,
  Search,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

// ── Types ───────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  productDesc: string;
  targetMarket: string;
  status: string;
  scoreThreshold: number;
  searchKeywords: string[] | null;
}

interface Prospect {
  id: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactTitle: string | null;
  website: string | null;
  country: string | null;
  source: string;
  score: number | null;
  scoreReason: string | null;
  stage: string;
  outreachSentAt: string | null;
  followUpCount: number;
  createdAt: string;
}

const STAGE_LABELS: Record<string, string> = {
  new: "新线索",
  researched: "已研究",
  qualified: "合格",
  unqualified: "不合格",
  outreach_draft: "邮件草稿",
  outreach_sent: "已发送",
  replied: "已回复",
  interested: "感兴趣",
  negotiating: "谈判中",
  won: "成交",
  lost: "丢失",
  no_response: "未回复",
};

const STAGE_COLORS: Record<string, string> = {
  new: "bg-zinc-500/15 text-zinc-400",
  researched: "bg-blue-500/15 text-blue-400",
  qualified: "bg-emerald-500/15 text-emerald-400",
  unqualified: "bg-red-500/15 text-red-400",
  outreach_draft: "bg-amber-500/15 text-amber-400",
  outreach_sent: "bg-violet-500/15 text-violet-400",
  replied: "bg-cyan-500/15 text-cyan-400",
  interested: "bg-emerald-500/15 text-emerald-400",
  negotiating: "bg-orange-500/15 text-orange-400",
  won: "bg-emerald-600/20 text-emerald-300",
  lost: "bg-red-600/20 text-red-300",
  no_response: "bg-zinc-500/15 text-zinc-500",
};

// ── Page ────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<string>("");
  const [showAdd, setShowAdd] = useState(false);
  const [stats, setStats] = useState<{ funnel: { key: string; label: string; count: number; rate: number }[]; avgScore: number; replyRate: number } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [batchResearching, setBatchResearching] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [campRes, prospRes, statsRes] = await Promise.all([
      apiFetch(`/api/trade/campaigns/${id}`),
      apiFetch(`/api/trade/prospects?campaignId=${id}${stageFilter ? `&stage=${stageFilter}` : ""}`),
      apiFetch(`/api/trade/campaigns/${id}/stats`),
    ]);
    if (campRes.ok) setCampaign(await campRes.json());
    if (prospRes.ok) {
      const data = await prospRes.json();
      setProspects(data.items ?? []);
      setTotal(data.total ?? 0);
    }
    if (statsRes.ok) setStats(await statsRes.json());
    setLoading(false);
  }, [id, stageFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!campaign) {
    return <div className="py-20 text-center text-muted">活动不存在</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/trade")}
          className="rounded-lg p-1.5 text-muted transition hover:text-foreground"
        >
          <ArrowLeft size={18} />
        </button>
        <PageHeader title={campaign.name} description={campaign.targetMarket} />
      </div>

      {/* Keywords */}
      {campaign.searchKeywords && (campaign.searchKeywords as string[]).length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <h3 className="mb-2 text-xs font-medium text-muted">搜索关键词</h3>
          <div className="flex flex-wrap gap-1.5">
            {(campaign.searchKeywords as string[]).map((kw, i) => (
              <span key={i} className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Conversion Funnel */}
      {stats && stats.funnel[0]?.count > 0 && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted">转化漏斗</h3>
            <div className="flex items-center gap-3 text-[10px] text-muted">
              <span>平均分: <span className="font-medium text-foreground">{stats.avgScore}</span></span>
              <span>回复率: <span className="font-medium text-foreground">{stats.replyRate}%</span></span>
            </div>
          </div>
          <div className="space-y-1.5">
            {stats.funnel.map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-right text-[10px] text-muted">{f.label}</span>
                <div className="flex h-5 flex-1 overflow-hidden rounded-full bg-background">
                  <div
                    className="rounded-full bg-blue-500/30 transition-all duration-500"
                    style={{ width: `${Math.max(f.rate, f.count > 0 ? 3 : 0)}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-[10px] text-foreground">
                  {f.count} <span className="text-muted">({f.rate}%)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={async () => {
            setDiscovering(true);
            setDiscoverResult(null);
            try {
              const res = await apiFetch(`/api/trade/campaigns/${id}/discover`, { method: "POST" });
              if (res.ok) {
                const data = await res.json();
                setDiscoverResult(`发现 ${data.total} 家公司，新增 ${data.created} 条线索`);
                loadData();
              }
            } finally {
              setDiscovering(false);
            }
          }}
          disabled={discovering}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card-bg px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-blue-500/50 disabled:opacity-50"
        >
          {discovering ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          {discovering ? "搜索中..." : "AI 发现客户"}
        </button>
        <button
          onClick={async () => {
            setBatchResearching(true);
            setBatchResult(null);
            try {
              const res = await apiFetch(`/api/trade/campaigns/${id}/batch-research`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ limit: 5 }),
              });
              if (res.ok) {
                const data = await res.json();
                setBatchResult(`研究了 ${data.processed} 条线索，${data.qualified} 条合格`);
                loadData();
              }
            } finally {
              setBatchResearching(false);
            }
          }}
          disabled={batchResearching}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card-bg px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-blue-500/50 disabled:opacity-50"
        >
          {batchResearching ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
          {batchResearching ? "批量研究中..." : "批量 AI 研究"}
        </button>
      </div>

      {/* AI Result Messages */}
      {(discoverResult || batchResult) && (
        <div className="flex flex-wrap gap-2">
          {discoverResult && (
            <span className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400">{discoverResult}</span>
          )}
          {batchResult && (
            <span className="rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs text-blue-400">{batchResult}</span>
          )}
        </div>
      )}

      {/* Filter + Actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">{total} 条线索</span>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
          >
            <option value="">全部阶段</option>
            {Object.entries(STAGE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
        >
          <Plus size={14} />
          添加线索
        </button>
      </div>

      {/* Prospect List */}
      {prospects.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card-bg px-8 py-16 text-center">
          <p className="text-sm text-muted">暂无线索。手动添加或等待 AI 自动发现。</p>
        </div>
      ) : (
        <div className="space-y-2">
          {prospects.map((p) => (
            <ProspectRow key={p.id} prospect={p} />
          ))}
        </div>
      )}

      {/* Add Prospect Modal */}
      {showAdd && campaign && (
        <AddProspectModal
          campaignId={campaign.id}
          orgId="default"
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}

// ── Components ──────────────────────────────────────────────

function ProspectRow({ prospect: p }: { prospect: Prospect }) {
  const router = useRouter();
  return (
    <div
      onClick={() => router.push(`/trade/prospects/${p.id}`)}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-card-bg px-4 py-3 transition hover:border-border">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{p.companyName}</span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", STAGE_COLORS[p.stage] ?? STAGE_COLORS.new)}>
            {STAGE_LABELS[p.stage] ?? p.stage}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
          {p.contactName && (
            <span className="flex items-center gap-1">
              <User size={10} />
              {p.contactName}
            </span>
          )}
          {p.country && (
            <span className="flex items-center gap-1">
              <Globe size={10} />
              {p.country}
            </span>
          )}
          {p.contactEmail && (
            <span className="flex items-center gap-1">
              <Mail size={10} />
              {p.contactEmail}
            </span>
          )}
        </div>
      </div>

      {p.score !== null && (
        <div className="flex items-center gap-1 text-xs">
          <Star size={12} className={p.score >= 7 ? "text-amber-400" : "text-zinc-500"} />
          <span className={p.score >= 7 ? "font-medium text-amber-400" : "text-muted"}>
            {p.score.toFixed(1)}
          </span>
        </div>
      )}

      <ChevronRight size={14} className="text-muted opacity-0 transition group-hover:opacity-100" />
    </div>
  );
}

function AddProspectModal({
  campaignId,
  orgId,
  onClose,
  onCreated,
}: {
  campaignId: string;
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [country, setCountry] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/trade/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          orgId,
          companyName: companyName.trim(),
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          website: website.trim() || undefined,
          country: country.trim() || undefined,
          source: "manual",
        }),
      });
      if (res.ok) onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card-bg p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-foreground">添加线索</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="公司名称 *"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="联系人姓名"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
            <input
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="邮箱"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="官网"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="国家"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground">
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !companyName.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
