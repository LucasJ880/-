"use client";

import { useState } from "react";
import { formatSalesMoney } from "@/lib/sales/home";
import type { SalesHomeResponse } from "@/lib/sales/home";
import { apiFetch } from "@/lib/api-fetch";
import { SalesCard } from "./sales-card";
import { SalesMiniTrend } from "./sales-mini-trend";
import { SalesTargetProgress } from "./sales-target-progress";

export function SalesPerformanceHero({
  data,
  onTargetSaved,
}: {
  data: SalesHomeResponse;
  onTargetSaved: () => void;
}) {
  const { performance: p, activity: a, trend } = data;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    p.targetAmount != null ? String(Math.round(p.targetAmount)) : "",
  );
  const [saving, setSaving] = useState(false);

  const saveTarget = async () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/sales/home", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAmount: n }),
      });
      if (res.ok) {
        setEditing(false);
        onTargetSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  const stats = [
    { label: "本月签单", value: `${p.signedCount} 单` },
    { label: "本周新增销售额", value: formatSalesMoney(p.weeklySignedAmount) },
    { label: "活跃商机", value: String(a.activeOpportunities) },
    { label: "待跟进", value: String(a.followupsDue) },
    { label: "今日预约", value: String(a.todayAppointments) },
    { label: "平均订单金额", value: formatSalesMoney(p.averageOrderValue) },
  ];

  return (
    <SalesCard className="overflow-hidden">
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="text-[12px] font-medium text-[var(--muted)]">
            本月已签
          </p>
          <p className="mt-1 text-[32px] font-semibold tracking-tight text-[var(--foreground)] md:text-[36px]">
            {formatSalesMoney(p.signedAmount)}
          </p>

          {p.targetAmount != null ? (
            <div className="mt-3 space-y-1 text-[13px] text-[var(--muted)]">
              <p>
                目标 {formatSalesMoney(p.targetAmount)}
                {p.remainingAmount != null && p.remainingAmount > 0
                  ? ` · 还差 ${formatSalesMoney(p.remainingAmount)}`
                  : " · 已达成"}
              </p>
              <SalesTargetProgress rate={p.completionRate} />
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-[13px] text-[var(--muted)]">尚未设置销售目标</p>
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg bg-[var(--accent-soft)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent)] hover:opacity-90"
                >
                  设置目标
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="例如 80000"
                    className="h-10 w-36 rounded-lg border border-[var(--border)] bg-transparent px-3 text-[13px]"
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={saveTarget}
                    className="h-10 rounded-lg bg-[var(--accent)] px-3 text-[13px] text-[var(--on-accent)] disabled:opacity-60"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="h-10 px-2 text-[13px] text-[var(--muted)]"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          )}

          {p.targetAmount != null && (
            <button
              type="button"
              onClick={() => {
                setValue(String(Math.round(p.targetAmount!)));
                setEditing(true);
              }}
              className="mt-2 text-[12px] text-[var(--muted)] underline-offset-2 hover:underline"
            >
              调整目标
            </button>
          )}
          {editing && p.targetAmount != null && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-10 w-36 rounded-lg border border-[var(--border)] bg-transparent px-3 text-[13px]"
              />
              <button
                type="button"
                disabled={saving}
                onClick={saveTarget}
                className="h-10 rounded-lg bg-[var(--accent)] px-3 text-[13px] text-[var(--on-accent)]"
              >
                保存
              </button>
            </div>
          )}

          <SalesMiniTrend points={trend} />
        </div>

        <div className="grid grid-cols-2 gap-3 content-start">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-[var(--border)]/80 bg-[var(--background)]/40 px-3 py-2.5"
            >
              <p className="text-[11px] text-[var(--muted)]">{s.label}</p>
              <p className="mt-0.5 text-[15px] font-semibold text-[var(--foreground)]">
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SalesCard>
  );
}
