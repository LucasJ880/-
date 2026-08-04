"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Plus, Upload, Search, Loader2, BarChart3, X } from "lucide-react";
import Link from "next/link";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import type { Opportunity, Customer, ViewMode, FunnelStatus } from "./types";
import { FUNNEL_STATUS_META } from "./types";
import { StatsCards } from "./stats-cards";
import { AiAlertPanel } from "./ai-alert-panel";
import { PipelineBoard } from "./pipeline-board";
import { CustomerList } from "./customer-list";
import { CsvImportDialog } from "./csv-import-dialog";
import { NewCustomerDialog } from "./new-customer-dialog";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { PendingDepositBanner } from "@/components/sales/pending-deposit-banner";
import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id";
import {
  isSalesOrgCreateBlocked,
  salesOrgCreateBlockedHint,
} from "@/lib/sales/sales-client-org";
import { OrgSelectBanner } from "@/components/org-select-banner";

export default function SalesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      }
    >
      <SalesPageInner />
    </Suspense>
  );
}

function SalesPageInner() {
  const { isMobile } = useIsMobile();
  const { isSuperAdmin } = useCurrentUser();
  const { orgId, ambiguous, loading: orgLoading } = useSalesCurrentOrgId();
  const orgCreateBlocked = isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId);
  const router = useRouter();
  const searchParams = useSearchParams();

  // 从 URL 读取"从交叉表钻取过来"的筛选参数
  const urlCreatedById = searchParams.get("createdById") || "";
  const urlStartDate = searchParams.get("startDate") || "";
  const urlEndDate = searchParams.get("endDate") || "";
  const urlFunnelStatus = (searchParams.get("funnelStatus") || "") as FunnelStatus | "";
  const urlViewMode = searchParams.get("view") as ViewMode | null;
  const urlStage = searchParams.get("stage") || "";
  const urlNew = searchParams.get("new") === "1";
  const urlFollowup = searchParams.get("followup") === "1";
  const hasDrillFilters = Boolean(
    urlCreatedById || urlStartDate || urlEndDate || urlFunnelStatus,
  );

  const [viewMode, setViewMode] = useState<ViewMode>(
    urlViewMode === "customers" || hasDrillFilters
      ? "customers"
      : urlViewMode === "pipeline" || urlStage
        ? "pipeline"
        : "customers",
  );
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [followupHint, setFollowupHint] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  // 被钻取时锁定的销售名字（用于 chip 显示）
  const [lockedRepName, setLockedRepName] = useState<string>("");
  useEffect(() => {
    if (!urlCreatedById || !isSuperAdmin) {
      setLockedRepName("");
      return;
    }
    apiFetch("/api/sales/reps")
      .then((r) => (r.ok ? r.json() : { reps: [] }))
      .then((d: { reps: Array<{ id: string; name: string }> }) => {
        const found = d.reps?.find((r) => r.id === urlCreatedById);
        setLockedRepName(found?.name || "");
      })
      .catch(() => setLockedRepName(""));
  }, [urlCreatedById, isSuperAdmin]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (viewMode === "pipeline") {
        const res = await apiFetch("/api/sales/opportunities");
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.error("Opportunities API error:", res.status, errData);
          throw new Error(
            (errData as { error?: string }).error || `API ${res.status}`,
          );
        }
        const data = await res.json();
        const list = Array.isArray(data?.opportunities)
          ? data.opportunities
          : [];
        setOpportunities(list);
      } else {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (urlCreatedById) params.set("createdById", urlCreatedById);
        if (urlStartDate) params.set("startDate", urlStartDate);
        if (urlEndDate) params.set("endDate", urlEndDate);
        if (urlFunnelStatus) params.set("funnelStatus", urlFunnelStatus);
        params.set("pageSize", "50");
        const qs = params.toString() ? `?${params}` : "";
        const data = await apiJson<{ customers?: Customer[] }>(
          `/api/sales/customers${qs}`,
        );
        const serverCustomers = Array.isArray(data?.customers)
          ? data.customers
          : [];
        setCustomers(serverCustomers);
      }
    } catch (err) {
      console.error("Load sales data failed:", err);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [viewMode, search, urlCreatedById, urlStartDate, urlEndDate, urlFunnelStatus]);

  const clearDrillFilters = useCallback(() => {
    router.replace("/sales?view=customers");
  }, [router]);

  const drillChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];
    if (urlCreatedById) {
      chips.push({
        key: "rep",
        label: `销售：${lockedRepName || urlCreatedById}`,
      });
    }
    if (urlStartDate || urlEndDate) {
      chips.push({
        key: "date",
        label: `时间：${urlStartDate || "不限"} ~ ${urlEndDate || "不限"}`,
      });
    }
    if (urlFunnelStatus) {
      chips.push({
        key: "funnel",
        label: `状态：${FUNNEL_STATUS_META[urlFunnelStatus].label}`,
      });
    }
    return chips;
  }, [urlCreatedById, urlStartDate, urlEndDate, urlFunnelStatus, lockedRepName]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 同步 URL view / stage
  useEffect(() => {
    if (urlViewMode === "customers" || hasDrillFilters) {
      setViewMode("customers");
    } else if (urlViewMode === "pipeline" || urlStage) {
      setViewMode("pipeline");
    }
  }, [urlViewMode, hasDrillFilters, urlStage]);

  // Command Center 快捷入口：?new=1 / ?followup=1
  useEffect(() => {
    if (urlNew) {
      setViewMode("customers");
      setShowNewCustomer(true);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("new");
      if (!next.get("view")) next.set("view", "customers");
      const qs = next.toString();
      router.replace(qs ? `/sales?${qs}` : "/sales?view=customers");
    }
  }, [urlNew, router, searchParams]);

  useEffect(() => {
    if (urlFollowup) {
      setViewMode("customers");
      setFollowupHint(true);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("followup");
      if (!next.get("view")) next.set("view", "customers");
      const qs = next.toString();
      router.replace(qs ? `/sales?${qs}` : "/sales?view=customers");
    }
  }, [urlFollowup, router, searchParams]);

  const visibleOpportunities = useMemo(() => {
    if (!urlStage) return opportunities;
    return opportunities.filter((o) => o.stage === urlStage);
  }, [opportunities, urlStage]);

  return (
    <PullToRefresh onRefresh={loadData} enabled={isMobile} className="space-y-5">
      <PageHeader
        title="客户与商机"
        description="统一管理客户资料、商机阶段、报价与跟进动作"
        actions={
          <div className="flex items-center gap-2">
            {isSuperAdmin && (
              <Link
                href="/sales/analytics"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card-bg/80 px-3 py-1.5 text-[13px] font-medium text-foreground shadow-xs hover:bg-accent-soft hover:border-border-strong transition-all duration-150"
                title="销售 × 时段复盘交叉表"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                复盘分析
              </Link>
            )}
            <button
              onClick={() => setShowImport(true)}
              disabled={orgCreateBlocked}
              title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card-bg/80 px-3 py-1.5 text-[13px] font-medium text-foreground shadow-xs hover:bg-accent-soft hover:border-border-strong transition-all duration-150 disabled:opacity-40"
            >
              <Upload className="h-3.5 w-3.5" />
              CSV 导入
            </button>
            <button
              onClick={() => setShowNewCustomer(true)}
              disabled={orgCreateBlocked}
              title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-foreground px-3 py-1.5 text-[13px] font-medium text-white shadow-xs hover:bg-foreground/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              新客户
            </button>
          </div>
        }
      />

      <OrgSelectBanner />

      <StatsCards opportunities={opportunities} customers={customers} viewMode={viewMode} />

      <PendingDepositBanner />

      <AiAlertPanel />

      <div className="flex items-center justify-between gap-4">
        <div className="inline-flex rounded-[var(--radius-md)] border border-border bg-card-bg/60 p-0.5">
          <button
            className={cn(
              "rounded-[var(--radius-sm)] px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150",
              viewMode === "customers"
                ? "bg-card-bg text-foreground shadow-xs"
                : "text-muted hover:text-foreground"
            )}
            onClick={() => router.replace("/sales?view=customers")}
          >
            客户列表
          </button>
          <button
            className={cn(
              "rounded-[var(--radius-sm)] px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150",
              viewMode === "pipeline"
                ? "bg-card-bg text-foreground shadow-xs"
                : "text-muted hover:text-foreground"
            )}
            onClick={() => router.replace("/sales?view=pipeline")}
          >
            商机看板
          </button>
        </div>

        {viewMode === "customers" && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="搜索客户…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-[var(--radius-md)] border border-border bg-card-bg/80 py-1.5 pl-9 pr-3 text-[13px] placeholder:text-text-quaternary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all duration-150"
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-red-200 bg-red-50/40 py-16 gap-3">
          <p className="text-sm font-medium text-red-700">加载失败: {loadError}</p>
          <button
            onClick={loadData}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[13px] font-medium text-white"
          >
            重试
          </button>
        </div>
      ) : viewMode === "pipeline" ? (
        <>
          {urlStage && (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
              <span>阶段筛选：{urlStage}</span>
              <button
                type="button"
                onClick={() => router.replace("/sales?view=pipeline")}
                className="ml-auto inline-flex items-center gap-1 rounded border border-border bg-card-bg px-2 py-0.5"
              >
                <X className="h-3 w-3" />
                清除
              </button>
            </div>
          )}
          <PipelineBoard
            opportunities={visibleOpportunities}
            onRefresh={loadData}
          />
        </>
      ) : (
        <>
          {followupHint && (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-900">
              <span>请选择一位客户，使用「记录跟进」快捷操作。</span>
              <button
                type="button"
                onClick={() => setFollowupHint(false)}
                className="ml-auto inline-flex items-center gap-1 rounded border border-border bg-card-bg px-2 py-0.5"
              >
                <X className="h-3 w-3" />
                知道了
              </button>
            </div>
          )}
          {drillChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent/5 px-3 py-2">
              <span className="text-xs text-muted">来自复盘分析的筛选：</span>
              {drillChips.map((c) => (
                <span
                  key={c.key}
                  className="inline-flex items-center gap-1 rounded-full bg-card-bg px-2 py-0.5 text-xs border border-border"
                >
                  {c.label}
                </span>
              ))}
              <button
                onClick={clearDrillFilters}
                className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-card-bg px-2 py-0.5 text-xs text-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
                清除筛选
              </button>
            </div>
          )}
          <CustomerList customers={customers} showOwnerColumn={isSuperAdmin} />
        </>
      )}

      <CsvImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        onSuccess={() => {
          setShowImport(false);
          loadData();
        }}
      />

      <NewCustomerDialog
        open={showNewCustomer}
        onOpenChange={setShowNewCustomer}
        onSuccess={() => {
          setShowNewCustomer(false);
          loadData();
        }}
      />
    </PullToRefresh>
  );
}
