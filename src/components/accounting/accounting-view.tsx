"use client";

/**
 * PERM-5a：会计视图（只读）
 * — 成交与提成：/api/accounting/sales-summary（按人按月，可导出 CSV）
 * — 报价过程：/api/accounting/quotes（折扣、超限审批与审批人、签约时间）
 * — 项目结算：/api/accounting/projects（汇总；与销售成交分开）
 * INSTALL-2b：
 * — 待收尾款：/api/accounting/balance（装完未确认尾款的单 + 确认；见 balance-tab.tsx）
 * — 页签读写 URL `?tab=`；`?order=<工艺单 id>` 展开并高亮该行（通知直达）
 * 接口 403 的页签不显示。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calculator, Download, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { BalanceTab, type BalanceResp } from "./balance-tab";

type Tab = "sales" | "quotes" | "projects" | "balance";
const TABS: Tab[] = ["sales", "quotes", "projects", "balance"];
const TAB_LABEL: Record<Tab, string> = { sales: "成交与提成", quotes: "报价过程", projects: "项目结算", balance: "待收尾款" };
const isTab = (v: string | null): v is Tab => !!v && (TABS as string[]).includes(v);

type SalesRow = {
  salesUserId: string;
  salesName: string;
  quotesSigned: number;
  quotesWithCost: number;
  itemsCosted: number;
  itemsTotal: number;
  signedAmount: number;
  realMargin: number;
  realCommission: number;
};
type SalesSummary = { month: string; commissionRate: number; totals: Omit<SalesRow, "salesUserId" | "salesName">; bySales: SalesRow[] };
type QuoteRow = {
  id: string;
  version: number;
  status: string;
  customerName: string | null;
  salesName: string | null;
  grandTotal: number;
  finalDiscountPct: number | null;
  approval: { status: string; approvedAt: string | null; approvedByName: string | null; rejectedAt: string | null; rejectedByName: string | null };
  signedAt: string | null;
  createdAt: string;
};
type ProjectRow = {
  id: string;
  name: string;
  outcome: string;
  totalCostCad: string;
  contractRevenueCad: string | null;
  outstandingPayablesCad: string | null;
  settlementStatus: string;
  forecastProfitCad: string | null;
  finalProfitCad: string | null;
};
type ProjectsResp = { available: boolean; reason?: string; scope: "ORG" | "ASSIGNED"; projects: ProjectRow[] };

const money = (n: number | string | null | undefined) =>
  n == null || n === "" ? "—" : Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("zh-CN") : "—");
const APPROVAL_LABEL: Record<string, string> = {
  not_required: "无需审批",
  required: "需审批",
  pending: "待审批",
  approved: "已批准",
  rejected: "已驳回",
};

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function AccountingView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab");
  const focusOrderId = searchParams.get("order");
  const [month, setMonth] = useState(thisMonth);
  const [tab, setTabState] = useState<Tab | null>(null);
  const [allowed, setAllowed] = useState<Record<Tab, boolean> | null>(null);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [quotes, setQuotes] = useState<QuoteRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectsResp | null>(null);
  const [balance, setBalance] = useState<BalanceResp | null>(null);

  /** 切页签同步 URL（去掉 order 参数，避免回退时又展开旧行） */
  const setTab = useCallback(
    (t: Tab) => {
      setTabState(t);
      router.replace(`/accounting?tab=${t}`, { scroll: false });
    },
    [router],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, q, p, b] = await Promise.all([
        apiFetch(`/api/accounting/sales-summary?month=${month}`),
        apiFetch(`/api/accounting/quotes?month=${month}`),
        apiFetch(`/api/accounting/projects`),
        apiFetch(`/api/accounting/balance`),
      ]);
      const next = { sales: s.status !== 403, quotes: q.status !== 403, projects: p.status !== 403, balance: b.status !== 403 };
      setAllowed(next);
      setSales(s.ok ? ((await s.json()) as SalesSummary) : null);
      setQuotes(q.ok ? ((await q.json()) as { quotes: QuoteRow[] }).quotes : null);
      setProjects(p.ok ? ((await p.json()) as ProjectsResp) : null);
      setBalance(b.ok ? ((await b.json()) as BalanceResp) : null);
      // 当前页签 → URL 指定的可见页签 → 第一个可见页签
      setTabState((cur) =>
        cur && next[cur] ? cur : isTab(urlTab) && next[urlTab] ? urlTab : TABS.find((t) => next[t]) ?? null,
      );
      if (![s, q, p, b].some((r) => r.ok)) setError("没有会计视图权限");
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [month, urlTab]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs = useMemo(() => (allowed ? TABS.filter((t) => allowed[t]) : []), [allowed]);

  const exportCsv = async () => {
    const res = await apiFetch(`/api/accounting/sales-summary?month=${month}&format=csv`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-summary-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Calculator size={20} className="text-accent" />
            会计视图
          </h1>
          <p className="mt-0.5 text-xs text-muted">成交与提成、报价全过程、项目结算只读（项目与销售分开结算）；装完待收尾款在此确认</p>
        </div>
        {(tab === "sales" || tab === "quotes") && (
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded-lg border border-border bg-card-bg px-2 py-1.5 text-sm text-foreground"
            aria-label="月份"
          />
        )}
      </div>

      {tabs.length > 0 && (
        <div className="flex rounded-lg border border-border bg-card-bg p-0.5 text-sm">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 ${tab === t ? "bg-accent text-[color:var(--on-accent)]" : "text-muted"}`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> 加载中
        </div>
      )}
      {error && !loading && <p className="text-sm text-red-600">{error}</p>}

      {!loading && tab === "sales" && sales && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              {sales.month} · 提成比例 {(sales.commissionRate * 100).toFixed(0)}% · 合计成交 {money(sales.totals.signedAmount)} · 提成{" "}
              {money(sales.totals.realCommission)}
            </span>
            <button type="button" onClick={exportCsv} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-foreground">
              <Download size={14} /> 导出 CSV
            </button>
          </div>
          <table className="w-full overflow-hidden rounded-lg border border-border text-sm">
            <thead className="bg-card-bg text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">销售</th>
                <th className="px-3 py-2 text-right">签约单</th>
                <th className="px-3 py-2 text-right">成交金额</th>
                <th className="px-3 py-2 text-right">真实毛利</th>
                <th className="px-3 py-2 text-right">提成</th>
                <th className="px-3 py-2 text-right">成本覆盖</th>
              </tr>
            </thead>
            <tbody>
              {sales.bySales.map((r) => (
                <tr key={r.salesUserId} className="border-t border-border">
                  <td className="px-3 py-2 text-foreground">{r.salesName}</td>
                  <td className="px-3 py-2 text-right">{r.quotesSigned}</td>
                  <td className="px-3 py-2 text-right">{money(r.signedAmount)}</td>
                  <td className="px-3 py-2 text-right">{money(r.realMargin)}</td>
                  <td className="px-3 py-2 text-right">{money(r.realCommission)}</td>
                  <td className="px-3 py-2 text-right text-xs text-muted">
                    {r.itemsCosted}/{r.itemsTotal} 行
                  </td>
                </tr>
              ))}
              {sales.bySales.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted">
                    本月暂无签约单
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="text-xs text-muted">口径与销售本人业绩页一致：真实毛利只算有成本快照的行；无成本的行如实计入覆盖率。</p>
        </div>
      )}

      {!loading && tab === "quotes" && quotes && (
        <table className="w-full overflow-hidden rounded-lg border border-border text-sm">
          <thead className="bg-card-bg text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">客户</th>
              <th className="px-3 py-2">销售</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2 text-right">总价</th>
              <th className="px-3 py-2 text-right">折扣</th>
              <th className="px-3 py-2">超限审批</th>
              <th className="px-3 py-2">签约</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id} className="border-t border-border">
                <td className="px-3 py-2 text-foreground">
                  {q.customerName ?? "—"} <span className="text-xs text-muted">v{q.version}</span>
                </td>
                <td className="px-3 py-2">{q.salesName ?? "—"}</td>
                <td className="px-3 py-2">{q.status}</td>
                <td className="px-3 py-2 text-right">{money(q.grandTotal)}</td>
                <td className="px-3 py-2 text-right">{q.finalDiscountPct == null ? "—" : `${(q.finalDiscountPct * 100).toFixed(1)}%`}</td>
                <td className="px-3 py-2 text-xs">
                  {APPROVAL_LABEL[q.approval.status] ?? q.approval.status}
                  {q.approval.approvedByName && ` · ${q.approval.approvedByName} ${day(q.approval.approvedAt)}`}
                  {q.approval.rejectedByName && ` · ${q.approval.rejectedByName} ${day(q.approval.rejectedAt)}`}
                </td>
                <td className="px-3 py-2 text-xs">{day(q.signedAt)}</td>
              </tr>
            ))}
            {quotes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-muted">
                  本月暂无报价
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {!loading && tab === "balance" && balance && (
        <BalanceTab data={balance} focusOrderId={focusOrderId} onChanged={() => void load()} />
      )}

      {!loading && tab === "projects" && projects && (
        <div className="space-y-2">
          <p className="text-xs text-muted">{projects.scope === "ORG" ? "全企业项目" : "我参与的项目"} · 只含汇总，不含逐笔费用与收据</p>
          {!projects.available ? (
            <p className="rounded-lg border border-border bg-card-bg px-3 py-6 text-center text-sm text-muted">{projects.reason ?? "项目财务未启用"}</p>
          ) : (
            <table className="w-full overflow-hidden rounded-lg border border-border text-sm">
              <thead className="bg-card-bg text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">项目</th>
                  <th className="px-3 py-2">结果</th>
                  <th className="px-3 py-2 text-right">合同收入</th>
                  <th className="px-3 py-2 text-right">总成本</th>
                  <th className="px-3 py-2 text-right">未结应付</th>
                  <th className="px-3 py-2 text-right">结余</th>
                  <th className="px-3 py-2">结算</th>
                </tr>
              </thead>
              <tbody>
                {projects.projects.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{p.name}</td>
                    <td className="px-3 py-2 text-xs">{p.outcome}</td>
                    <td className="px-3 py-2 text-right">{money(p.contractRevenueCad)}</td>
                    <td className="px-3 py-2 text-right">{money(p.totalCostCad)}</td>
                    <td className="px-3 py-2 text-right">{money(p.outstandingPayablesCad)}</td>
                    <td className="px-3 py-2 text-right">{money(p.finalProfitCad ?? p.forecastProfitCad)}</td>
                    <td className="px-3 py-2 text-xs">{p.settlementStatus}</td>
                  </tr>
                ))}
                {projects.projects.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-xs text-muted">
                      暂无项目
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
