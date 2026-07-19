"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

const countFields = [
  ["impressions", "展示"],
  ["views", "播放"],
  ["engagements", "互动"],
  ["clicks", "点击"],
  ["leads", "线索"],
  ["qualifiedLeads", "有效线索"],
  ["appointments", "预约"],
  ["quotes", "报价"],
  ["wins", "成交"],
] as const;

interface Snapshot {
  id: string;
  source: string;
  capturedAt: string;
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  revenue: number;
  currency: string;
}

export default function MarketingMetricsPage() {
  const [form, setForm] = useState<Record<string, string>>({
    capturedAt: new Date().toISOString().slice(0, 10),
    source: "manual",
    impressions: "0",
    views: "0",
    engagements: "0",
    clicks: "0",
    leads: "0",
    qualifiedLeads: "0",
    appointments: "0",
    quotes: "0",
    wins: "0",
    spend: "0",
    revenue: "0",
    currency: "CAD",
  });
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const response = await apiFetch("/api/marketing/metrics");
    const body = await response.json();
    if (response.ok) setSnapshots(body.snapshots || []);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const response = await apiFetch("/api/marketing/metrics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "录入失败");
    setMessage("渠道数据已保存，并已计入增长执行力和推广日报。");
    await load();
  }

  async function syncFromProvider() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch("/api/marketing/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowKey: "sync-metrics", data: { provider: "ga4" } }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "同步失败");
      if (body.run?.status === "skipped") {
        setMessage(
          "同步管道已就绪，但尚未配置 Activepieces 的 sync-metrics Webhook。请到「智能自动流」查看接入状态；也可继续手动录入。",
        );
      } else {
        setMessage("已请求 GA4/渠道同步（经 Activepieces）。完成后刷新下方最近快照。");
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/operations/growth" className="text-sm text-accent">
            ← 返回增长中心
          </Link>
          <h1 className="mt-2 text-2xl font-bold">渠道数据</h1>
          <p className="mt-1 text-sm text-muted">
            支持手动录入，或触发 Activepieces 同步（已内置 GA4 字段映射）。Webhook 未配置时不会误连外部。
          </p>
        </div>
        <button
          type="button"
          onClick={syncFromProvider}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card-bg px-4 py-2 text-sm hover:bg-background disabled:opacity-50"
        >
          {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          同步 GA4 / 渠道
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <form onSubmit={submit} className="space-y-5 rounded-xl border border-border bg-card-bg p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted">数据日期</span>
            <input
              type="date"
              value={form.capturedAt}
              onChange={(e) => setForm({ ...form, capturedAt: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">来源</span>
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            >
              <option value="manual">手动录入</option>
              <option value="csv">CSV 导入</option>
              <option value="ga4">GA4（手工补录）</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {countFields.map(([key, label]) => (
            <label key={key} className="text-sm">
              <span className="mb-1 block text-muted">{label}</span>
              <input
                type="number"
                min={0}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">广告花费</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.spend}
              onChange={(e) => setForm({ ...form, spend: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">成交贡献</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.revenue}
              onChange={(e) => setForm({ ...form, revenue: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">币种</span>
            <input
              value={form.currency}
              maxLength={3}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>
        </div>
        <button className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white">
          保存渠道快照
        </button>
      </form>

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">最近快照</h2>
        <div className="mt-3 space-y-2">
          {snapshots.length === 0 ? (
            <p className="text-sm text-muted">暂无快照。</p>
          ) : (
            snapshots.slice(0, 12).map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-3 py-2 text-sm"
              >
                <span>
                  {row.capturedAt.slice(0, 10)} ·{" "}
                  <span className="text-muted">{row.source}</span>
                </span>
                <span className="text-xs text-muted">
                  展示 {row.impressions} · 点击 {row.clicks} · 线索 {row.leads} · 花费{" "}
                  {row.spend} {row.currency}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
