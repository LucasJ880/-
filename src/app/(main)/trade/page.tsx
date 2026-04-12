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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
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

// ── Main Page ───────────────────────────────────────────────

export default function TradeDashboardPage() {
  const { user } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const orgId = "default";

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/trade/campaigns?orgId=${orgId}`);
      if (res.ok) setCampaigns(await res.json());
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="外贸获客"
        description="AI 驱动的海外买家发现、研究和外联自动化"
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Target} label="活动" value={campaigns.filter((c) => c.status === "active").length} />
        <StatCard icon={Users} label="总线索" value={campaigns.reduce((s, c) => s + c._count.prospects, 0)} />
        <StatCard icon={Search} label="已研究" value={campaigns.reduce((s, c) => s + c.qualified, 0)} />
        <StatCard icon={Mail} label="已联系" value={campaigns.reduce((s, c) => s + c.contacted, 0)} />
      </div>

      {/* Actions */}
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

      {/* Campaign List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState onCreateClick={() => setShowCreate(true)} />
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              menuOpen={menuOpen === c.id}
              onToggleMenu={() => setMenuOpen(menuOpen === c.id ? null : c.id)}
              onRefresh={loadCampaigns}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateCampaignModal
          orgId={orgId}
          userId={user?.id ?? ""}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadCampaigns();
          }}
        />
      )}
    </div>
  );
}

// ── Components ──────────────────────────────────────────────

function StatCard({ icon: Icon, label, value }: { icon: typeof Target; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card-bg px-4 py-3">
      <div className="flex items-center gap-2 text-muted">
        <Icon size={14} />
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

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
      <button
        onClick={onCreateClick}
        className="mt-6 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
      >
        <Plus size={16} />
        新建获客活动
      </button>
    </div>
  );
}

function CampaignCard({
  campaign: c,
  menuOpen,
  onToggleMenu,
  onRefresh,
}: {
  campaign: Campaign;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onRefresh: () => void;
}) {
  const [genLoading, setGenLoading] = useState(false);

  const handleGenerateKeywords = async () => {
    setGenLoading(true);
    try {
      await apiFetch(`/api/trade/campaigns/${c.id}/generate-keywords`, {
        method: "POST",
      });
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
              <button
                onClick={handleToggleStatus}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-border/30"
              >
                {c.status === "active" ? <Pause size={12} /> : <Play size={12} />}
                {c.status === "active" ? "暂停" : "恢复"}
              </button>
              <button
                onClick={handleDelete}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-border/30"
              >
                <Trash2 size={12} />
                删除
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="mt-3 flex items-center gap-4 text-xs text-muted">
        <span>{c._count.prospects} 线索</span>
        <span>{c.qualified} 合格</span>
        <span>{c.contacted} 已联系</span>
        <span>门槛 ≥{c.scoreThreshold}</span>
      </div>

      {/* Keywords */}
      <div className="mt-3">
        {c.searchKeywords && Array.isArray(c.searchKeywords) && c.searchKeywords.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {(c.searchKeywords as string[]).slice(0, 6).map((kw, i) => (
              <span key={i} className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
                {kw}
              </span>
            ))}
            {(c.searchKeywords as string[]).length > 6 && (
              <span className="rounded-md bg-zinc-500/10 px-2 py-0.5 text-[10px] text-muted">
                +{(c.searchKeywords as string[]).length - 6}
              </span>
            )}
          </div>
        ) : (
          <button
            onClick={handleGenerateKeywords}
            disabled={genLoading}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted transition hover:border-blue-500/50 hover:text-blue-400"
          >
            {genLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {genLoading ? "AI 生成中..." : "生成搜索关键词"}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center justify-end">
        <a
          href={`/trade/campaigns/${c.id}`}
          className="flex items-center gap-1 text-xs text-blue-400 transition hover:text-blue-300"
        >
          查看线索
          <ArrowRight size={12} />
        </a>
      </div>
    </div>
  );
}

// ── Create Modal ────────────────────────────────────────────

function CreateCampaignModal({
  orgId,
  userId,
  onClose,
  onCreated,
}: {
  orgId: string;
  userId: string;
  onClose: () => void;
  onCreated: () => void;
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
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：2026 Q2 欧洲窗饰买家开发"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              产品描述
              <span className="ml-1 text-muted">（AI 会基于此生成搜索词和开发信）</span>
            </label>
            <textarea
              value={productDesc}
              onChange={(e) => setProductDesc(e.target.value)}
              rows={3}
              placeholder="例：我们是中国绍兴的窗帘面料工厂，主营斑马帘面料、卷帘面料和阻燃窗帘面料，年产能 500 万米，支持 OEM/ODM，有 NFPA 和 OEKO-TEX 认证..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              目标市场 / 理想客户画像（ICP）
            </label>
            <textarea
              value={targetMarket}
              onChange={(e) => setTargetMarket(e.target.value)}
              rows={3}
              placeholder="例：目标欧美窗饰品牌商和进口商，年采购额 50 万美元以上，有自己的销售渠道（线上或线下门店），对阻燃和环保认证有要求..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              合格分数门槛（0-10，≥ 此分数才进入外联流程）
            </label>
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={scoreThreshold}
              onChange={(e) => setScoreThreshold(Number(e.target.value))}
              className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted transition hover:text-foreground"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !productDesc.trim() || !targetMarket.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              创建活动
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
