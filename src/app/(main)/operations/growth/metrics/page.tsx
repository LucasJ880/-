"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { parseMarketingCsv } from "@/lib/marketing/csv-import";

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

interface ChannelAccount {
  id: string;
  name: string;
  provider: string;
  externalAccountId: string | null;
  status: string;
  lastSyncedAt: string | null;
}

interface ProviderOption {
  key: string;
  label: string;
}

interface Snapshot {
  id: string;
  source: string;
  capturedAt: string;
  spend: number;
  otherMarketingCost: number;
  qualifiedLeads: number;
  leads: number;
  clicks: number;
  impressions: number;
  currency: string;
  channelAccount?: { id: string; name: string; provider: string } | null;
}

interface CrmAttributionResult {
  scannedCount: number;
  matchedCount: number;
  createdCount: number;
  refreshedCount: number;
  skippedManualCount: number;
  truncated: boolean;
  dryRun: boolean;
  byProvider: Array<{
    provider: string;
    label: string;
    matched: number;
    created: number;
    refreshed: number;
    attributedRevenue: number;
  }>;
}

const SYNC_PROVIDERS = [
  { key: "google_ads", label: "同步 Google Ads" },
  { key: "meta", label: "同步 Meta" },
  { key: "xiaohongshu", label: "同步小红书" },
  { key: "ga4", label: "同步 GA4" },
] as const;

export default function MarketingMetricsPage() {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [accountForm, setAccountForm] = useState({
    provider: "google_ads",
    name: "",
    externalAccountId: "",
  });
  const [form, setForm] = useState<Record<string, string>>({
    channelAccountId: "",
    weekStart: new Date().toISOString().slice(0, 10),
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
    otherMarketingCost: "0",
    revenue: "0",
    currency: "CAD",
  });
  const [bulkText, setBulkText] = useState("");
  const [backfillRange, setBackfillRange] = useState(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 90);
    return { periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10) };
  });
  const [crmRange, setCrmRange] = useState(() => {
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 2);
    return {
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
    };
  });
  const [crmPreview, setCrmPreview] = useState<CrmAttributionResult | null>(null);
  const [economics, setEconomics] = useState({
    defaultGrossMarginPercent: "",
    targetRoas: "",
    targetRoiPercent: "",
    attributionWindowDays: "90",
    currency: "CAD",
    productMargins: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [aRes, mRes, eRes] = await Promise.all([
      apiFetch("/api/marketing/channel-accounts"),
      apiFetch("/api/marketing/metrics"),
      apiFetch("/api/marketing/economics"),
    ]);
    const [aBody, mBody, eBody] = await Promise.all([aRes.json(), mRes.json(), eRes.json()]);
    if (aRes.ok) {
      setAccounts(aBody.accounts || []);
      setProviders(aBody.providers || []);
      setForm((prev) => ({
        ...prev,
        channelAccountId: prev.channelAccountId || aBody.accounts?.[0]?.id || "",
      }));
    } else setError(aBody.error || "渠道账号加载失败");
    if (mRes.ok) setSnapshots(mBody.snapshots || []);
    else setError(mBody.error || "指标加载失败");
    if (eRes.ok) {
      const setting = eBody.setting || {};
      setEconomics({
        defaultGrossMarginPercent: setting.defaultGrossMarginRate == null ? "" : String(setting.defaultGrossMarginRate * 100),
        targetRoas: setting.targetRoas == null ? "" : String(setting.targetRoas),
        targetRoiPercent: setting.targetRoi == null ? "" : String(setting.targetRoi * 100),
        attributionWindowDays: String(setting.attributionWindowDays || 90),
        currency: setting.currency || "CAD",
        productMargins: Array.isArray(setting.productMarginsJson)
          ? setting.productMarginsJson.map((row: { product?: string; grossMarginRate?: number }) => `${row.product || ""},${Number(row.grossMarginRate || 0) * 100}`).join("\n")
          : "",
      });
    } else setError(eBody.error || "经济模型加载失败");
  }, []);

  useEffect(() => {
    load().catch(() => setError("加载失败"));
  }, [load]);

  const selectedAccount = accounts.find((row) => row.id === form.channelAccountId);

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    setBusy("account");
    setError(null);
    setMessage(null);
    const response = await apiFetch("/api/marketing/channel-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: accountForm.provider,
        name: accountForm.name,
        externalAccountId: accountForm.externalAccountId || null,
      }),
    });
    const body = await response.json();
    setBusy(null);
    if (!response.ok) return setError(body.error || "创建账号失败");
    setMessage(`已登记渠道账号：${body.account.name}`);
    setAccountForm({ ...accountForm, name: "", externalAccountId: "" });
    await load();
  }

  async function submitWeek(e: FormEvent) {
    e.preventDefault();
    if (!selectedAccount) return setError("请先选择或登记渠道账号");
    setBusy("week");
    setError(null);
    setMessage(null);
    const response = await apiFetch("/api/marketing/metrics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: selectedAccount.provider,
        source: selectedAccount.provider,
        channelAccountId: selectedAccount.id,
        weekStart: form.weekStart,
        capturedAt: form.weekStart,
        granularity: "weekly",
        spend: Number(form.spend || 0),
        otherMarketingCost: Number(form.otherMarketingCost || 0),
        revenue: Number(form.revenue || 0),
        currency: form.currency,
        impressions: Number(form.impressions || 0),
        views: Number(form.views || 0),
        engagements: Number(form.engagements || 0),
        clicks: Number(form.clicks || 0),
        leads: Number(form.leads || 0),
        qualifiedLeads: Number(form.qualifiedLeads || 0),
        appointments: Number(form.appointments || 0),
        quotes: Number(form.quotes || 0),
        wins: Number(form.wins || 0),
      }),
    });
    const body = await response.json();
    setBusy(null);
    if (!response.ok) return setError(body.error || "录入失败");
    setMessage("周数据已保存（幂等）。可用于 MMM 与增长看板。");
    await load();
  }

  async function saveEconomics(e: FormEvent) {
    e.preventDefault();
    setBusy("economics");
    setError(null);
    setMessage(null);
    const productMargins = economics.productMargins.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
      const [product, percent] = line.split(",");
      return { product: product?.trim(), grossMarginRate: Number(percent || 0) / 100 };
    });
    const response = await apiFetch("/api/marketing/economics", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaultGrossMarginRate: economics.defaultGrossMarginPercent === "" ? null : Number(economics.defaultGrossMarginPercent) / 100,
        targetRoas: economics.targetRoas === "" ? null : Number(economics.targetRoas),
        targetRoi: economics.targetRoiPercent === "" ? null : Number(economics.targetRoiPercent) / 100,
        attributionWindowDays: Number(economics.attributionWindowDays),
        currency: economics.currency,
        productMargins,
      }),
    });
    const body = await response.json();
    setBusy(null);
    if (!response.ok) return setError(body.error || "经济模型保存失败");
    setMessage("营销经济模型已保存，增长中心将自动计算保本 ROAS 与真实 ROI。");
    await load();
  }

  async function loadCsv(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const rows = parseMarketingCsv(await file.text());
      setBulkText(JSON.stringify(rows, null, 2));
      setMessage(`已解析 ${rows.length} 行历史数据，请核对后点击批量写入。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CSV 解析失败");
    }
  }

  async function submitBulk(e: FormEvent) {
    e.preventDefault();
    if (!selectedAccount) return setError("请先选择渠道账号");
    setBusy("bulk");
    setError(null);
    setMessage(null);
    let rows: unknown[];
    try {
      const parsed = JSON.parse(bulkText);
      rows = Array.isArray(parsed) ? parsed : parsed.rows;
      if (!Array.isArray(rows)) throw new Error("需要 JSON 数组或 { rows: [] }");
    } catch (cause) {
      setBusy(null);
      return setError(cause instanceof Error ? cause.message : "JSON 无效");
    }
    const response = await apiFetch("/api/marketing/metrics/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: selectedAccount.provider,
        channelAccountId: selectedAccount.id,
        rows,
      }),
    });
    const body = await response.json();
    setBusy(null);
    if (!response.ok) return setError(body.error || "批量灌数失败");
    setMessage(`批量写入 ${body.written} 条，失败 ${body.failed} 条。`);
    await load();
  }

  async function syncProviders(providers: string[], mode: "incremental" | "backfill" = "incremental") {
    setBusy(`sync:${providers.join(",")}`);
    setError(null);
    setMessage(null);
    const response = await apiFetch("/api/marketing/metrics/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers,
        channelAccountId: providers.length === 1 ? form.channelAccountId || null : null,
        mode,
        lookbackDays: 7,
        ...(mode === "backfill" ? backfillRange : {}),
      }),
    });
    const body = await response.json();
    setBusy(null);
    if (!response.ok) return setError(body.error || "同步失败");
    setMessage(body.note || (mode === "backfill" ? "已请求历史回填" : "已请求同步"));
    await load();
  }

  async function syncCrmFeedback(dryRun: boolean) {
    if (
      !dryRun &&
      !window.confirm(
        "确认按 CRM 中的客户/商机来源归总历史反馈？\n\n人工归因不会被覆盖；系统归因会标记为“来源推断”，后续仍可人工修正。",
      )
    ) {
      return;
    }
    setBusy(dryRun ? "crm-preview" : "crm-sync");
    setError(null);
    setMessage(null);
    const response = await apiFetch("/api/marketing/attributions/backfill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...crmRange, dryRun }),
    });
    const body = await response.json();
    setBusy(null);
    if (!response.ok) return setError(body.error || "CRM 反馈归总失败");
    const result = body.result as CrmAttributionResult;
    setCrmPreview(result);
    setMessage(
      dryRun
        ? `预览完成：扫描 ${result.scannedCount} 个商机，可识别 ${result.matchedCount} 个营销来源。`
        : `CRM 反馈已归总：新增 ${result.createdCount} 条，刷新 ${result.refreshedCount} 条；人工归因保持不变。`,
    );
    if (!dryRun) await load();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div>
        <Link href="/operations/growth" className="text-sm text-accent">
          ← 返回增长中心
        </Link>
        <h1 className="mt-2 text-2xl font-bold">渠道数据接入</h1>
        <p className="mt-1 text-sm text-muted">
          登记 Google Ads / Meta / 小红书账号 → 录入或同步周花费与 KPI。上线后同事可手灌；配置
          Activepieces 后可一键同步；数字员工走同一套 API。
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">1. 登记广告账号</h2>
        <p className="mt-1 text-xs text-muted">
          externalAccountId 填各平台广告户 ID，便于 Activepieces / 数字员工按外部 ID 对齐。
        </p>
        <form onSubmit={createAccount} className="mt-3 grid gap-3 sm:grid-cols-4">
          <select
            value={accountForm.provider}
            onChange={(e) => setAccountForm({ ...accountForm, provider: e.target.value })}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {(providers.length
              ? providers
              : [
                  { key: "google_ads", label: "Google Ads" },
                  { key: "meta", label: "Meta" },
                  { key: "xiaohongshu", label: "小红书" },
                ]
            )
              .filter((row) =>
                ["google_ads", "meta", "xiaohongshu", "ga4", "tiktok"].includes(row.key),
              )
              .map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
          </select>
          <input
            required
            placeholder="账号显示名"
            value={accountForm.name}
            onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            placeholder="外部广告户 ID"
            value={accountForm.externalAccountId}
            onChange={(e) =>
              setAccountForm({ ...accountForm, externalAccountId: e.target.value })
            }
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy === "account"}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-[color:var(--on-accent)] disabled:opacity-50"
          >
            {busy === "account" ? "保存中…" : "登记账号"}
          </button>
        </form>
        <div className="mt-3 space-y-2">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">尚未登记账号。</p>
          ) : (
            accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-wrap justify-between gap-2 rounded-lg bg-background px-3 py-2 text-sm"
              >
                <span>
                  {account.name}{" "}
                  <span className="text-muted">
                    · {account.provider}
                    {account.externalAccountId ? ` · ${account.externalAccountId}` : ""}
                  </span>
                </span>
                <span className="text-xs text-muted">
                  {account.status}
                  {account.lastSyncedAt
                    ? ` · 同步于 ${new Date(account.lastSyncedAt).toLocaleString()}`
                    : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <form onSubmit={saveEconomics} className="space-y-4 rounded-xl border border-border bg-card-bg p-5">
        <div>
          <h2 className="font-semibold">2. 设置 ROI / ROAS 口径</h2>
          <p className="mt-1 text-xs text-muted">毛利率用于计算真实 ROI；不填写时系统只展示 ROAS，不会猜测利润。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm"><span className="mb-1 block text-muted">默认毛利率（%）</span><input type="number" min="0" max="100" step="0.1" value={economics.defaultGrossMarginPercent} onChange={(e) => setEconomics({ ...economics, defaultGrossMarginPercent: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="例如 40" /></label>
          <label className="text-sm"><span className="mb-1 block text-muted">目标 ROAS（倍）</span><input type="number" min="0" step="0.1" value={economics.targetRoas} onChange={(e) => setEconomics({ ...economics, targetRoas: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="例如 3" /></label>
          <label className="text-sm"><span className="mb-1 block text-muted">目标 ROI（%）</span><input type="number" min="0" step="1" value={economics.targetRoiPercent} onChange={(e) => setEconomics({ ...economics, targetRoiPercent: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="例如 50" /></label>
          <label className="text-sm"><span className="mb-1 block text-muted">归因周期（天）</span><input type="number" min="1" max="365" value={economics.attributionWindowDays} onChange={(e) => setEconomics({ ...economics, attributionWindowDays: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-muted">币种</span><input maxLength={3} value={economics.currency} onChange={(e) => setEconomics({ ...economics, currency: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <label className="text-sm sm:col-span-3"><span className="mb-1 block text-muted">产品毛利率（每行：产品,百分比）</span><textarea rows={3} value={economics.productMargins} onChange={(e) => setEconomics({ ...economics, productMargins: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder={"Zebra Blinds,40\nShutters,45"} /></label>
        </div>
        <button type="submit" disabled={busy === "economics"} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-[color:var(--on-accent)] disabled:opacity-50">{busy === "economics" ? "保存中…" : "保存经济模型"}</button>
      </form>

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">3. 触发平台同步（Activepieces）</h2>
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-border p-2"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          需配置 ACTIVEPIECES_MARKETING_SYNC_WEBHOOK_URL。未配置时会提示 skip，可继续手灌。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SYNC_PROVIDERS.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => syncProviders([item.key])}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {busy === `sync:${item.key}` ? (
                <Loader2 size={12} className="animate-spin" />
              ) : null}
              {item.label}
            </button>
          ))}
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => syncProviders(["google_ads", "meta", "xiaohongshu"])}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs text-[color:var(--on-accent)] disabled:opacity-50"
          >
            同步三端付费渠道
          </button>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-background p-3">
          <div className="text-sm font-medium">首次历史回填</div>
          <p className="mt-1 text-xs text-muted">授权完成后按日期拉取旧花费；相同账号与日期重复回填不会重复计数。</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs"><span className="mb-1 block text-muted">开始日期</span><input type="date" value={backfillRange.periodStart} onChange={(e) => setBackfillRange({ ...backfillRange, periodStart: e.target.value })} className="rounded-lg border border-border bg-card-bg px-3 py-2 text-sm" /></label>
            <label className="text-xs"><span className="mb-1 block text-muted">结束日期</span><input type="date" value={backfillRange.periodEnd} onChange={(e) => setBackfillRange({ ...backfillRange, periodEnd: e.target.value })} className="rounded-lg border border-border bg-card-bg px-3 py-2 text-sm" /></label>
            <button type="button" disabled={Boolean(busy)} onClick={() => syncProviders(["google_ads", "meta", "xiaohongshu"], "backfill")} className="rounded-lg border border-accent px-4 py-2 text-sm text-accent disabled:opacity-50">回填三端历史数据</button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">4. 归总 CRM 历史反馈</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          根据销售端已填写的客户/商机来源，识别 Google Ads、Facebook / Instagram 和小红书，
          汇总有效线索与已成交金额。系统每天自动刷新近 {economics.attributionWindowDays || "90"} 天；
          人工归因优先，不会被覆盖。
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="mb-1 block text-muted">开始日期</span>
            <input type="date" value={crmRange.periodStart} onChange={(e) => { setCrmRange({ ...crmRange, periodStart: e.target.value }); setCrmPreview(null); }} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">结束日期</span>
            <input type="date" value={crmRange.periodEnd} onChange={(e) => { setCrmRange({ ...crmRange, periodEnd: e.target.value }); setCrmPreview(null); }} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </label>
          <button type="button" disabled={Boolean(busy)} onClick={() => syncCrmFeedback(true)} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">
            {busy === "crm-preview" ? "分析中…" : "先预览"}
          </button>
          <button type="button" disabled={Boolean(busy) || !crmPreview} onClick={() => syncCrmFeedback(false)} className="rounded-lg bg-accent px-4 py-2 text-sm text-[color:var(--on-accent)] disabled:opacity-50">
            {busy === "crm-sync" ? "归总中…" : "确认归总"}
          </button>
        </div>
        {crmPreview && (
          <div className="mt-4 space-y-2 rounded-lg border border-border bg-background p-3 text-sm">
            {crmPreview.byProvider.length === 0 ? (
              <p className="text-muted">该时间范围内暂未识别到 Google Ads、Meta 或小红书来源。</p>
            ) : (
              crmPreview.byProvider.map((row) => (
                <div key={row.provider} className="flex flex-wrap justify-between gap-2">
                  <strong>{row.label}</strong>
                  <span className="text-muted">
                    商机 {row.matched} · 待新增 {row.created} · 已有 {row.refreshed} · 成交金额 {row.attributedRevenue.toLocaleString()} {economics.currency || "CAD"}
                  </span>
                </div>
              ))
            )}
            {crmPreview.skippedManualCount > 0 && (
              <p className="text-xs text-muted">另有 {crmPreview.skippedManualCount} 个商机已有人工归因，系统已跳过。</p>
            )}
            {crmPreview.truncated && (
              <p className="text-xs text-amber-700">本次达到 5,000 条扫描上限，请缩小日期范围后分批归总。</p>
            )}
          </div>
        )}
      </section>

      <form onSubmit={submitWeek} className="space-y-4 rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">5. 录入单周数据</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-muted">渠道账号</span>
            <select
              required
              value={form.channelAccountId}
              onChange={(e) => setForm({ ...form, channelAccountId: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            >
              <option value="">选择账号</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}（{account.provider}）
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">周起始日（周一）</span>
            <input
              type="date"
              required
              value={form.weekStart}
              onChange={(e) => setForm({ ...form, weekStart: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
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
            <span className="mb-1 block text-muted">其他营销成本</span>
            <input type="number" min={0} step="0.01" value={form.otherMarketingCost} onChange={(e) => setForm({ ...form, otherMarketingCost: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" />
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
        <button
          type="submit"
          disabled={busy === "week"}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-[color:var(--on-accent)] disabled:opacity-50"
        >
          {busy === "week" ? "保存中…" : "保存周快照"}
        </button>
      </form>

      <form onSubmit={submitBulk} className="space-y-3 rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">6. 历史平台数据回填（CSV / JSON）</h2>
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-border px-4 py-2 text-sm">
          选择平台导出的 CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => loadCsv(e.target.files?.[0] || null)} />
        </label>
        <p className="text-xs text-muted">
          使用上方选中的渠道账号。示例：
          <code className="mx-1 rounded bg-background px-1">
            {`[{"weekStart":"2026-01-06","spend":1200,"qualifiedLeads":8,"clicks":400}]`}
          </code>
        </p>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={6}
          placeholder='[{"weekStart":"2026-01-06","spend":1200,"qualifiedLeads":8}]'
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
        />
        <button
          type="submit"
          disabled={busy === "bulk"}
          className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50"
        >
          {busy === "bulk" ? "灌入中…" : "批量写入"}
        </button>
      </form>

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">最近快照</h2>
        <div className="mt-3 space-y-2">
          {snapshots.length === 0 ? (
            <p className="text-sm text-muted">暂无快照。</p>
          ) : (
            snapshots.slice(0, 20).map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-3 py-2 text-sm"
              >
                <span>
                  {row.capturedAt.slice(0, 10)} ·{" "}
                  <span className="text-muted">
                    {row.channelAccount
                      ? `${row.channelAccount.name}(${row.channelAccount.provider})`
                      : row.source}
                  </span>
                </span>
                <span className="text-xs text-muted">
                  花费 {row.spend} {row.currency} · 其他成本 {row.otherMarketingCost || 0} · 有效线索 {row.qualifiedLeads} · 点击{" "}
                  {row.clicks}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
