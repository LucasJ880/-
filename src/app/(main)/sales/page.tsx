"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Upload, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import type { Opportunity, Customer, ViewMode } from "./types";
import { StatsCards } from "./stats-cards";
import { AiAlertPanel } from "./ai-alert-panel";
import { PipelineBoard } from "./pipeline-board";
import { CustomerList } from "./customer-list";
import { CsvImportDialog } from "./csv-import-dialog";
import { NewCustomerDialog } from "./new-customer-dialog";
import { offlineDb } from "@/lib/offline/db";
import { useOnlineStatus } from "@/lib/offline/hooks";

export default function SalesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("pipeline");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const isOnline = useOnlineStatus();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (viewMode === "pipeline") {
        if (isOnline) {
          const res = await apiFetch("/api/sales/opportunities");
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            console.error("Opportunities API error:", res.status, errData);
            throw new Error(errData.error || `API ${res.status}`);
          }
          const data = await res.json();
          setOpportunities(data.opportunities || []);
        }
      } else {
        let serverCustomers: Customer[] = [];
        if (isOnline) {
          const qs = search ? `?search=${encodeURIComponent(search)}` : "";
          const res = await apiFetch(`/api/sales/customers${qs}`);
          const data = await res.json();
          serverCustomers = data.customers || [];
        }

        const offlineCustomers = await offlineDb.customers
          .where("syncStatus")
          .equals("pending")
          .toArray();

        const pendingAsCustomers: Customer[] = offlineCustomers.map((c) => ({
          id: c.localId,
          name: c.name,
          phone: c.phone ?? null,
          email: c.email ?? null,
          address: c.address ?? null,
          source: c.source ?? null,
          status: "active",
          tags: c.tags ?? null,
          notes: c.notes ?? null,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          _offlinePending: true,
        } as Customer & { _offlinePending?: boolean }));

        setCustomers([...pendingAsCustomers, ...serverCustomers]);
      }
    } catch (err) {
      console.error("Load sales data failed:", err);
      if (viewMode === "customers") {
        const offlineCustomers = await offlineDb.customers.orderBy("updatedAt").reverse().toArray();
        setCustomers(offlineCustomers.map((c) => ({
          id: c.serverId || c.localId,
          name: c.name,
          phone: c.phone ?? null,
          email: c.email ?? null,
          address: c.address ?? null,
          source: c.source ?? null,
          status: "active",
          tags: c.tags ?? null,
          notes: c.notes ?? null,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          _offlinePending: c.syncStatus === "pending",
        } as Customer & { _offlinePending?: boolean })));
      }
    } finally {
      setLoading(false);
    }
  }, [viewMode, search, isOnline]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="销售管理"
        description="Sunny Shutter 销售 Pipeline · 客户 · 报价"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-white/80 px-3 py-1.5 text-[13px] font-medium text-foreground shadow-xs hover:bg-white hover:border-border-strong transition-all duration-150"
            >
              <Upload className="h-3.5 w-3.5" />
              CSV 导入
            </button>
            <button
              onClick={() => setShowNewCustomer(true)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-foreground px-3 py-1.5 text-[13px] font-medium text-white shadow-xs hover:bg-foreground/90 active:scale-[0.98] transition-all duration-150"
            >
              <Plus className="h-3.5 w-3.5" />
              新客户
            </button>
          </div>
        }
      />

      <StatsCards opportunities={opportunities} customers={customers} viewMode={viewMode} />

      <AiAlertPanel />

      <div className="flex items-center justify-between gap-4">
        <div className="inline-flex rounded-[var(--radius-md)] border border-border bg-card-bg/60 p-0.5">
          <button
            className={cn(
              "rounded-[var(--radius-sm)] px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150",
              viewMode === "pipeline"
                ? "bg-white text-foreground shadow-xs"
                : "text-muted hover:text-foreground"
            )}
            onClick={() => setViewMode("pipeline")}
          >
            Pipeline 看板
          </button>
          <button
            className={cn(
              "rounded-[var(--radius-sm)] px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150",
              viewMode === "customers"
                ? "bg-white text-foreground shadow-xs"
                : "text-muted hover:text-foreground"
            )}
            onClick={() => setViewMode("customers")}
          >
            客户列表
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
              className="rounded-[var(--radius-md)] border border-border bg-white/80 py-1.5 pl-9 pr-3 text-[13px] placeholder:text-text-quaternary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all duration-150"
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      ) : viewMode === "pipeline" ? (
        <PipelineBoard opportunities={opportunities} onRefresh={loadData} />
      ) : (
        <CustomerList customers={customers} />
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
    </div>
  );
}
