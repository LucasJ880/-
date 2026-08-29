"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  formatSalesMoney,
  type SalesHomeResponse,
} from "@/lib/sales/home";
import { SalesCard, SalesCardState } from "@/components/sales-command-center/sales-card";
import { SalesMiniTrend } from "@/components/sales-command-center/sales-mini-trend";
import { SalesTargetProgress } from "@/components/sales-command-center/sales-target-progress";
import { SalesFunnelSummary } from "@/components/sales-command-center/sales-funnel-summary";
import { SalesHomeSkeleton } from "@/components/sales-command-center/sales-home-skeleton";
import { SalesActionEffectivenessCard } from "../cockpit/sales-action-effectiveness-card";

export default function SalesPerformancePage() {
  const [data, setData] = useState<SalesHomeResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  // 就地设目标（此前只有一个跳回首页的链接）
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);
  // 提成估算参数（驾驶舱配置；毛利率为 0 = 未配置，不显示提成卡）
  const [commission, setCommission] = useState<{
    marginRate: number;
    rate: number;
  } | null>(null);

  useEffect(() => {
    apiFetch("/api/sales/quote-settings/discounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { commissionMarginRate?: number; commissionRate?: number } | null) => {
        if (
          d &&
          typeof d.commissionMarginRate === "number" &&
          typeof d.commissionRate === "number"
        ) {
          setCommission({ marginRate: d.commissionMarginRate, rate: d.commissionRate });
        }
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await apiFetch("/api/sales/home");
      if (!res.ok) throw new Error("load failed");
      setData((await res.json()) as SalesHomeResponse);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveTarget = useCallback(async () => {
    const n = Number(targetDraft);
    if (!Number.isFinite(n) || n < 0) return;
    setSavingTarget(true);
    try {
      const res = await apiFetch("/api/sales/home", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAmount: n }),
      });
      if (res.ok) {
        setEditingTarget(false);
        await load();
      }
    } finally {
      setSavingTarget(false);
    }
  }, [targetDraft, load]);

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-[1440px]">
        <SalesHomeSkeleton />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="mx-auto max-w-[1440px] py-12">
        <SalesCardState
          kind="error"
          message="我的业绩暂时无法加载"
          onRetry={load}
        />
      </div>
    );
  }

  const p = data.performance;
  const c = data.conversion;
  const maxSource = Math.max(
    ...data.sourceDistribution.map((s) => s.count),
    1,
  );
  const maxMonth = Math.max(
    ...data.monthlyCompare.map((m) => m.signedAmount),
    1,
  );

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 pb-8">
      <header className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Sales Command Center
        </p>
        <h1 className="text-[26px] font-semibold tracking-tight">我的业绩</h1>
        <p className="text-[14px] text-[var(--muted)]">
          仅展示你授权范围内的个人销售数据，不含团队排行与管理配置。
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <SalesCard title="本月目标">
          <p className="text-[32px] font-semibold tracking-tight">
            {formatSalesMoney(p.signedAmount)}
          </p>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            {p.targetAmount != null
              ? `目标 ${formatSalesMoney(p.targetAmount)}`
              : "尚未设置销售目标"}
          </p>
          <SalesTargetProgress rate={p.completionRate} className="mt-3" />
          {editingTarget ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[13px] text-[var(--muted)]">$</span>
              <input
                type="number"
                min={0}
                value={targetDraft}
                onChange={(e) => setTargetDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveTarget();
                  if (e.key === "Escape") setEditingTarget(false);
                }}
                autoFocus
                className="w-32 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-[13px]"
              />
              <button
                type="button"
                onClick={() => void saveTarget()}
                disabled={savingTarget}
                className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[12px] font-medium text-[var(--on-accent)] disabled:opacity-50"
              >
                {savingTarget ? "保存中…" : "保存"}
              </button>
              <button
                type="button"
                onClick={() => setEditingTarget(false)}
                className="text-[12px] text-[var(--muted)]"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setTargetDraft(
                  p.targetAmount != null ? String(Math.round(p.targetAmount)) : "",
                );
                setEditingTarget(true);
              }}
              className="mt-3 inline-block text-[12px] text-[var(--accent)] hover:underline"
            >
              {p.targetAmount != null ? "修改目标" : "设置目标"}
            </button>
          )}
        </SalesCard>

        <SalesCard title="关键指标">
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            {[
              ["签单数量", `${p.signedCount} 单`],
              ["平均订单金额", formatSalesMoney(p.averageOrderValue)],
              [
                "报价转化率",
                c.quoteToSignRate != null ? `${c.quoteToSignRate}%` : "–",
              ],
              [
                "平均成交周期",
                c.avgCycleDays != null ? `${c.avgCycleDays} 天` : "–",
              ],
              ["本周新增", formatSalesMoney(p.weeklySignedAmount)],
              ["活跃商机", String(data.activity.activeOpportunities)],
            ].map(([k, v]) => (
              <div
                key={k}
                className="rounded-xl border border-[var(--border)]/70 px-3 py-2"
              >
                <dt className="text-[11px] text-[var(--muted)]">{k}</dt>
                <dd className="mt-0.5 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            本月报价 {c.quotesSent} 份 · 签约 {c.quotesSigned} 份
          </p>
          <SalesMiniTrend points={data.trend} />
        </SalesCard>
      </div>

      {/* 预计提成（估算口径）—— 毛利率系数未配置时整卡隐藏，避免拍脑袋数字 */}
      {commission && commission.marginRate > 0 && (
        <SalesCard title="预计提成">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-[32px] font-semibold tracking-tight">
              {formatSalesMoney(
                p.signedAmount * commission.marginRate * commission.rate,
              )}
            </p>
            <span className="rounded-full bg-[var(--muted)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
              估算
            </span>
          </div>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            本月签约 {formatSalesMoney(p.signedAmount)} × 估算毛利率{" "}
            {Math.round(commission.marginRate * 100)}% × 提成比例{" "}
            {Math.round(commission.rate * 100)}%
          </p>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            按公司统一估算参数计算，非工资单口径；实际提成以财务核算为准。
          </p>
        </SalesCard>
      )}

      {/* 我的行动效果 —— 与驾驶舱同一张卡；销售身份下 API 自动只回本人数据、隐藏团队区 */}
      <SalesActionEffectivenessCard />

      <div className="grid gap-4 md:grid-cols-2">
        <SalesCard title="近三个月对比">
          <ul className="space-y-3">
            {data.monthlyCompare.map((m) => (
              <li key={m.yearMonth}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="font-medium">{m.label}</span>
                  <span className="text-[var(--muted)]">
                    {m.signedCount} 单 · {formatSalesMoney(m.signedAmount)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]/15">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]/70"
                    style={{
                      width: `${Math.max(4, (m.signedAmount / maxMonth) * 100)}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </SalesCard>

        <SalesCard title="客户来源分布">
          {data.sourceDistribution.length === 0 ? (
            <p className="py-6 text-[13px] text-[var(--muted)]">
              暂无来源数据，可在客户资料中补充来源。
            </p>
          ) : (
            <ul className="space-y-2.5">
              {data.sourceDistribution.map((s) => (
                <li key={s.source}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="font-medium">{s.source}</span>
                    <span className="text-[var(--muted)]">{s.count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]/15">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]/60"
                      style={{
                        width: `${Math.max(4, (s.count / maxSource) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SalesCard>
      </div>

      <SalesFunnelSummary
        funnel={data.funnel}
        status={data.funnel.every((f) => f.count === 0) ? "empty" : "ready"}
        onRetry={load}
      />
    </div>
  );
}
