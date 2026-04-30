"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ExternalLink,
  FlaskConical,
  Mail,
  FileText,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import {
  TRADE_PROSPECT_STAGE_OPTIONS,
  getTradeProspectStageTone,
  normalizeTradeProspectStage,
} from "@/lib/trade/stage";

interface CampaignOption {
  id: string;
  name: string;
}

interface ProspectRow {
  id: string;
  campaignId: string;
  campaign: { id: string; name: string };
  companyName: string;
  website: string | null;
  country: string | null;
  score: number | null;
  scoreReason: string | null;
  stage: string;
  source?: string | null;
  researchStatus: string | null;
  researchStatusDisplay: string;
  researchStatusInferred: string;
  websiteConfidence: number | null;
  researchWarnings: string[] | null;
  needsWebsiteConfirm: boolean;
  emailStatusInferred: string;
  hasQuote: boolean;
  quoteCount: number;
  lastActivityAt: string;
  createdAt: string;
}

const RESEARCH_STATUS_LABELS: Record<string, string> = {
  pending: "待研究",
  scored: "已打分",
  unscored: "未打分",
  researched: "已研究",
  researched_with_warnings: "已研究（有告警）",
  legacy_researched: "已研究（历史）",
  research_pending: "待研究",
  researching: "研究中",
  website_needed: "需补充官网",
  website_candidates_found: "待确认官网",
  website_confirmed: "官网已确认",
  low_confidence: "官网低置信",
  failed: "研究失败",
  new: "新建",
  unknown: "未知",
};

const EMAIL_STATUS_LABELS: Record<string, string> = {
  sent: "已发",
  draft: "草稿",
  none: "无",
};

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "score_desc", label: "分数 ↓" },
  { value: "score_asc", label: "分数 ↑" },
  { value: "updated_desc", label: "更新 ↓" },
  { value: "updated_asc", label: "更新 ↑" },
  { value: "created_desc", label: "创建 ↓" },
  { value: "created_asc", label: "创建 ↑" },
  { value: "last_activity_desc", label: "最近动态 ↓" },
  { value: "next_follow_up_asc", label: "下次跟进 ↑" },
];

function formatShortDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function TradeProspectsListPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();

  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [items, setItems] = useState<ProspectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stage, setStage] = useState("");
  const [country, setCountry] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [researchStatus, setResearchStatus] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [quoteStatus, setQuoteStatus] = useState("");
  const [sort, setSort] = useState("score_desc");

  const [actionBusy, setActionBusy] = useState<Record<string, string>>({});
  const [rowActionError, setRowActionError] = useState<Record<string, string>>({});
  const [optimisticStage, setOptimisticStage] = useState<Record<string, string>>({});
  const [stageRowHint, setStageRowHint] = useState<Record<string, string>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadCampaigns = useCallback(async () => {
    if (!orgId || ambiguous) return;
    const res = await apiFetch(`/api/trade/campaigns?orgId=${encodeURIComponent(orgId)}`);
    if (res.ok) {
      const data = (await res.json()) as { id: string; name: string }[];
      setCampaigns(data.map((c) => ({ id: c.id, name: c.name })));
    } else {
      setCampaigns([]);
    }
  }, [orgId, ambiguous]);

  const queryString = useMemo(() => {
    if (!orgId) return "";
    const sp = new URLSearchParams();
    sp.set("orgId", orgId);
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    sp.set("sort", sort);
    if (debouncedSearch) sp.set("search", debouncedSearch);
    if (stage) sp.set("stage", stage);
    if (country.trim()) sp.set("country", country.trim());
    if (campaignId) sp.set("campaignId", campaignId);
    const minN = minScore.trim() === "" ? null : Number(minScore);
    const maxN = maxScore.trim() === "" ? null : Number(maxScore);
    if (minN != null && Number.isFinite(minN)) sp.set("minScore", String(minN));
    if (maxN != null && Number.isFinite(maxN)) sp.set("maxScore", String(maxN));
    if (researchStatus) sp.set("researchStatus", researchStatus);
    if (emailStatus) sp.set("emailStatus", emailStatus);
    if (quoteStatus) sp.set("quoteStatus", quoteStatus);
    return sp.toString();
  }, [
    orgId,
    page,
    pageSize,
    sort,
    debouncedSearch,
    stage,
    country,
    campaignId,
    minScore,
    maxScore,
    researchStatus,
    emailStatus,
    quoteStatus,
  ]);

  const loadProspects = useCallback(async () => {
    if (!orgId || ambiguous) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/trade/prospects?${queryString}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? `请求失败 (${res.status})`);
        setItems([]);
        setTotal(0);
        return;
      }
      const data = (await res.json()) as {
        items: ProspectRow[];
        total: number;
      };
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [orgId, ambiguous, queryString]);

  useEffect(() => {
    if (orgLoading) return;
    if (!orgId || ambiguous) return;
    void loadCampaigns();
  }, [loadCampaigns, orgId, ambiguous, orgLoading]);

  useEffect(() => {
    if (orgLoading) return;
    if (!orgId || ambiguous) {
      setLoading(false);
      return;
    }
    void loadProspects();
  }, [loadProspects, orgId, ambiguous, orgLoading]);

  const setBusy = (id: string, key: string | null) => {
    setActionBusy((prev) => {
      const next = { ...prev };
      if (key == null) delete next[id];
      else next[id] = key;
      return next;
    });
  };

  const runResearch = async (id: string) => {
    if (!orgId) return;
    setBusy(id, "research");
    setRowActionError((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await apiFetch(
        `/api/trade/prospects/${id}/research?orgId=${encodeURIComponent(orgId)}`,
        { method: "POST" },
      );
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        researchBundle?: unknown;
      };
      if (res.ok && j.researchBundle) {
        await loadProspects();
        return;
      }
      if (res.ok && (j.code === "website_confirmation_needed" || j.code === "website_needed")) {
        await loadProspects();
        setRowActionError((prev) => ({
          ...prev,
          [id]: j.error ?? "请在线索详情中确认官网或补充官网后再研究",
        }));
        return;
      }
      setRowActionError((prev) => ({
        ...prev,
        [id]: j.error ?? `研究失败（${res.status}）`,
      }));
      if (res.ok) await loadProspects();
    } catch (e) {
      setRowActionError((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : "网络错误",
      }));
    } finally {
      setBusy(id, null);
    }
  };

  const generateOutreach = async (id: string) => {
    if (!orgId) return;
    setBusy(id, "outreach");
    setRowActionError((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await apiFetch(`/api/trade/prospects/${id}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) {
        await loadProspects();
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setRowActionError((prev) => ({
          ...prev,
          [id]: j.error ?? `生成开发信失败（${res.status}）`,
        }));
      }
    } catch (e) {
      setRowActionError((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : "网络错误",
      }));
    } finally {
      setBusy(id, null);
    }
  };

  const patchStage = async (id: string, previousStage: string, nextStage: string) => {
    if (!orgId) return;
    const prevN = normalizeTradeProspectStage(previousStage);
    if (nextStage === prevN) return;
    setOptimisticStage((s) => ({ ...s, [id]: nextStage }));
    setRowActionError((prev) => ({ ...prev, [id]: "" }));
    setStageRowHint((h) => ({ ...h, [id]: "保存中…" }));
    setBusy(id, "stage");
    try {
      const res = await apiFetch(`/api/trade/prospects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, stage: nextStage }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setOptimisticStage((s) => {
          const n = { ...s };
          delete n[id];
          return n;
        });
        setStageRowHint((h) => {
          const n = { ...h };
          delete n[id];
          return n;
        });
        setRowActionError((prev) => ({
          ...prev,
          [id]: j.error ?? `阶段更新失败（${res.status}）`,
        }));
        return;
      }
      setStageRowHint((h) => ({ ...h, [id]: "已保存" }));
      await loadProspects();
      setOptimisticStage((s) => {
        const n = { ...s };
        delete n[id];
        return n;
      });
      window.setTimeout(() => {
        setStageRowHint((h) => {
          const n = { ...h };
          if (n[id] === "已保存") delete n[id];
          return n;
        });
      }, 2000);
    } catch (e) {
      setOptimisticStage((s) => {
        const n = { ...s };
        delete n[id];
        return n;
      });
      setStageRowHint((h) => {
        const n = { ...h };
        delete n[id];
        return n;
      });
      setRowActionError((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : "网络错误",
      }));
    } finally {
      setBusy(id, null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">
          当前无法确定组织：多组织账号请先在侧栏选择当前组织，或从组织页进入后再查看全部线索。
        </p>
        <button
          type="button"
          onClick={() => router.push("/organizations")}
          className="text-sm text-accent underline-offset-2 hover:underline"
        >
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="外贸全部线索"
          description="按公司、国家、活动与分数筛选线索，进入详情执行研究、外联与报价。"
        />
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/trade/import"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-card-bg px-3 py-2 text-xs font-medium text-foreground transition hover:border-blue-500/40"
          >
            导入线索
          </Link>
          <Link
            href="/trade"
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500"
          >
            在看板中新建
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card-bg p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">搜索</label>
            <input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              placeholder="公司名或网站"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">阶段</label>
            <select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground focus:outline-none"
            >
              <option value="">全部阶段</option>
              {TRADE_PROSPECT_STAGE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">活动</label>
            <select
              value={campaignId}
              onChange={(e) => {
                setCampaignId(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground focus:outline-none"
            >
              <option value="">全部活动</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">国家</label>
            <input
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setPage(1);
              }}
              placeholder="模糊匹配"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">排序</label>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground focus:outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">研究状态</label>
            <select
              value={researchStatus}
              onChange={(e) => {
                setResearchStatus(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground focus:outline-none"
            >
              <option value="">不限</option>
              <option value="pending">待研究（旧推断）</option>
              <option value="scored">已打分（旧推断）</option>
              <option value="unscored">未打分（旧推断）</option>
              <option value="website_needed">需补充官网</option>
              <option value="website_candidates_found">待确认官网</option>
              <option value="low_confidence">官网低置信</option>
              <option value="researched">已研究</option>
              <option value="researched_with_warnings">已研究（有告警）</option>
              <option value="researching">研究中</option>
              <option value="failed">研究失败</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">邮件状态</label>
            <select
              value={emailStatus}
              onChange={(e) => {
                setEmailStatus(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground focus:outline-none"
            >
              <option value="">不限</option>
              <option value="sent">已发送</option>
              <option value="draft">有草稿</option>
              <option value="none">无</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">报价</label>
            <select
              value={quoteStatus}
              onChange={(e) => {
                setQuoteStatus(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground focus:outline-none"
            >
              <option value="">不限</option>
              <option value="has_quote">已有报价</option>
              <option value="no_quote">无报价</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">分数区间</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={minScore}
                onChange={(e) => {
                  setMinScore(e.target.value);
                  setPage(1);
                }}
                placeholder="最低"
                className="w-full min-w-0 rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
              />
              <span className="text-muted">—</span>
              <input
                type="number"
                step="0.1"
                value={maxScore}
                onChange={(e) => {
                  setMaxScore(e.target.value);
                  setPage(1);
                }}
                placeholder="最高"
                className="w-full min-w-0 rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
        <p className="mt-3 text-[10px] text-muted">
          负责人 ownerId 筛选后端暂未建模，已忽略。转销售 CRM 将于后续版本提供。
        </p>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadProspects()}
            className="inline-flex items-center gap-1 text-xs text-red-200 hover:underline"
          >
            <RefreshCw size={12} />
            重试
          </button>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          共 <span className="font-medium text-foreground">{total}</span> 条
        </span>
        <button
          type="button"
          onClick={() => void loadProspects()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 transition hover:bg-border/20 disabled:opacity-50"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} />
          刷新
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card-bg px-6 py-16 text-center">
            <p className="text-sm text-muted">暂无符合条件的线索。</p>
            <p className="mt-3 text-xs text-muted">你可以从以下入口开始：</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
              <Link
                href="/trade/import"
                className="rounded-lg border border-border px-3 py-1.5 text-foreground transition hover:border-blue-500/40"
              >
                导入线索
              </Link>
              <Link
                href="/trade"
                className="rounded-lg border border-border px-3 py-1.5 text-foreground transition hover:border-blue-500/40"
              >
                新建活动 / 发现线索
              </Link>
              <Link
                href="/trade/cockpit"
                className="rounded-lg border border-border px-3 py-1.5 text-foreground transition hover:border-blue-500/40"
              >
                外贸驾驶舱
              </Link>
            </div>
            <p className="mt-4 text-[10px] text-muted">调整上方筛选条件，或确认当前组织下是否已有数据。</p>
          </div>
        ) : (
          <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-background/80 text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">公司</th>
                <th className="px-3 py-2 font-medium">网站</th>
                <th className="px-3 py-2 font-medium">国家</th>
                <th className="px-3 py-2 font-medium">活动</th>
                <th className="px-3 py-2 font-medium">分数</th>
                <th className="px-3 py-2 font-medium">打分摘要</th>
                <th className="px-3 py-2 font-medium">阶段</th>
                <th className="px-3 py-2 font-medium">研究状态</th>
                <th className="px-3 py-2 font-medium">官网置信</th>
                <th className="px-3 py-2 font-medium">告警</th>
                <th className="px-3 py-2 font-medium">邮件</th>
                <th className="px-3 py-2 font-medium">报价</th>
                <th className="px-3 py-2 font-medium">最近动态</th>
                <th className="px-3 py-2 font-medium">创建</th>
                <th className="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const busy = actionBusy[row.id];
                return (
                  <tr key={row.id} className="border-b border-border/40 transition hover:bg-border/10">
                    <td className="max-w-[140px] px-3 py-2 font-medium text-foreground">
                      <div className="flex flex-wrap items-center gap-1">
                        {row.source === "trade_intelligence" && (
                          <span
                            className="shrink-0 rounded bg-violet-500/20 px-1 py-0.5 text-[9px] font-medium text-violet-200"
                            title="来自竞品溯源"
                          >
                            溯源
                          </span>
                        )}
                        <span className="line-clamp-2">{row.companyName}</span>
                      </div>
                    </td>
                    <td className="max-w-[120px] px-3 py-2 text-muted">
                      {row.website ? (
                        <a
                          href={row.website.startsWith("http") ? row.website : `https://${row.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="line-clamp-1 text-blue-400 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.website}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{row.country ?? "—"}</td>
                    <td className="max-w-[100px] px-3 py-2 text-muted">
                      <span className="line-clamp-2">{row.campaign.name}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {row.score != null ? (
                        <span className={row.score >= 7 ? "font-medium text-amber-400" : "text-foreground"}>
                          {row.score.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="max-w-[160px] px-3 py-2 text-muted">
                      <span className="line-clamp-2" title={row.scoreReason ?? ""}>
                        {row.scoreReason ?? "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top">
                      <div className="flex flex-col gap-0.5">
                        <select
                          value={normalizeTradeProspectStage(optimisticStage[row.id] ?? row.stage)}
                          disabled={!!busy}
                          onChange={(e) =>
                            void patchStage(row.id, optimisticStage[row.id] ?? row.stage, e.target.value)
                          }
                          className={cn(
                            "max-w-[120px] rounded-md border border-border bg-background px-1 py-0.5 text-[10px] focus:outline-none",
                            getTradeProspectStageTone(optimisticStage[row.id] ?? row.stage),
                          )}
                        >
                          {TRADE_PROSPECT_STAGE_OPTIONS.map(({ value, label }) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {stageRowHint[row.id] && (
                          <span className="text-[9px] text-muted">{stageRowHint[row.id]}</span>
                        )}
                      </div>
                    </td>
                    <td className="max-w-[120px] px-3 py-2 align-top text-muted">
                      <div className="flex flex-col gap-0.5">
                        <span>
                          {RESEARCH_STATUS_LABELS[row.researchStatusDisplay] ?? row.researchStatusDisplay}
                        </span>
                        {row.needsWebsiteConfirm && (
                          <Link
                            href={`/trade/prospects/${row.id}`}
                            className="text-[10px] text-amber-400 hover:underline"
                          >
                            确认官网
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">
                      {row.websiteConfidence != null ? `${(row.websiteConfidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="max-w-[100px] px-3 py-2 text-muted">
                      {row.researchWarnings?.length ? (
                        <span className="inline-flex items-center gap-0.5 text-amber-400" title={row.researchWarnings.join(", ")}>
                          <AlertTriangle size={12} />
                          <span className="line-clamp-2 text-[10px]">{row.researchWarnings.join(" · ")}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">
                      {EMAIL_STATUS_LABELS[row.emailStatusInferred] ?? row.emailStatusInferred}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {row.hasQuote ? (
                        <span className="text-emerald-400">有 ({row.quoteCount})</span>
                      ) : (
                        <span className="text-muted">无</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{formatShortDate(row.lastActivityAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{formatShortDate(row.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <Link
                          href={`/trade/prospects/${row.id}`}
                          className="inline-flex items-center gap-0.5 text-blue-400 hover:underline"
                        >
                          详情 <ExternalLink size={10} />
                        </Link>
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void runResearch(row.id)}
                          className="inline-flex items-center gap-0.5 text-left text-foreground hover:text-blue-400 disabled:opacity-50"
                        >
                          {busy === "research" ? <Loader2 size={10} className="animate-spin" /> : <FlaskConical size={10} />}
                          研究
                        </button>
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void generateOutreach(row.id)}
                          className="inline-flex items-center gap-0.5 text-left text-foreground hover:text-blue-400 disabled:opacity-50"
                        >
                          {busy === "outreach" ? <Loader2 size={10} className="animate-spin" /> : <Mail size={10} />}
                          开发信
                        </button>
                        <Link
                          href={`/trade/quotes/new?prospectId=${encodeURIComponent(row.id)}&campaignId=${encodeURIComponent(row.campaignId)}&companyName=${encodeURIComponent(row.companyName)}`}
                          className="inline-flex items-center gap-0.5 text-foreground hover:text-blue-400"
                        >
                          <FileText size={10} />
                          报价
                        </Link>
                        <button
                          type="button"
                          disabled
                          className="text-left text-[10px] text-muted line-through opacity-60"
                          title="后续版本"
                        >
                          转销售 CRM
                        </button>
                        {rowActionError[row.id] && (
                          <p className="text-[9px] leading-tight text-red-400">{rowActionError[row.id]}</p>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-xs">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 transition hover:bg-border/20 disabled:opacity-40"
          >
            <ChevronLeft size={14} />
            上一页
          </button>
          <span className="text-muted">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 transition hover:bg-border/20 disabled:opacity-40"
          >
            下一页
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
