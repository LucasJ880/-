"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

type VariantDef = { key: string; name: string };

interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  primaryMetric: string;
  status: string;
  variantsJson: VariantDef[] | unknown;
  winnerVariantKey: string | null;
  learningSummary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  campaign: { id: string; name: string };
}

interface ReviewRow {
  experimentId: string;
  name: string;
  primaryMetric: string;
  evidenceStatus: string;
  leadingVariantKey: string | null;
  warning: string;
  variants: Array<{
    variantKey: string;
    primary: number;
    impressions: number;
    views: number;
    qualifiedLeads: number;
    revenue: number;
    publications: number;
  }>;
}

function asVariants(value: unknown): VariantDef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row, index) => {
      if (typeof row === "string") {
        const key = row.trim() || `v${index + 1}`;
        return { key, name: key };
      }
      if (row && typeof row === "object") {
        const record = row as Record<string, unknown>;
        const key = String(record.key || record.name || `v${index + 1}`).trim();
        const name = String(record.name || key).trim();
        return { key, name };
      }
      return null;
    })
    .filter((row): row is VariantDef => Boolean(row));
}

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  running: "运行中",
  completed: "已完成",
  stopped: "已停止",
};

export default function MarketingExperimentsPage() {
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewRow>>({});
  const [form, setForm] = useState({
    campaignId: "",
    name: "",
    hypothesis: "",
    primaryMetric: "qualified_lead",
    variantA: "A",
    variantB: "B",
  });
  const [confirmDraft, setConfirmDraft] = useState<Record<string, { winner: string; summary: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, eRes] = await Promise.all([
        apiFetch("/api/marketing/campaigns"),
        apiFetch("/api/marketing/experiments"),
      ]);
      const [cBody, eBody] = await Promise.all([cRes.json(), eRes.json()]);
      if (!cRes.ok) throw new Error(cBody.error || "活动加载失败");
      if (!eRes.ok) throw new Error(eBody.error || "实验加载失败");
      const list = (cBody.campaigns || []) as Array<{ id: string; name: string; status: string }>;
      setCampaigns(list.map((row) => ({ id: row.id, name: row.name, status: row.status })));
      setExperiments(eBody.experiments || []);
      setForm((prev) => ({
        ...prev,
        campaignId: prev.campaignId || list[0]?.id || "",
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => setError("加载失败"));
  }, [load]);

  async function createExperiment(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    setMessage(null);
    const variants = [
      { key: form.variantA.trim() || "A", name: form.variantA.trim() || "A" },
      { key: form.variantB.trim() || "B", name: form.variantB.trim() || "B" },
    ];
    const response = await apiFetch("/api/marketing/experiments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaignId: form.campaignId,
        name: form.name,
        hypothesis: form.hypothesis,
        primaryMetric: form.primaryMetric,
        variants,
        status: "draft",
      }),
    });
    const body = await response.json();
    setBusy(null);
    if (!response.ok) return setError(body.error || "创建实验失败");
    setMessage("实验草稿已创建。绑定带 variantKey 的内容资产与发布后，再启动运行。");
    setForm((prev) => ({ ...prev, name: "", hypothesis: "" }));
    await load();
  }

  async function patchExperiment(id: string, payload: Record<string, unknown>, okMsg: string) {
    setBusy(id);
    setError(null);
    setMessage(null);
    const response = await apiFetch(`/api/marketing/experiments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    setBusy(null);
    if (!response.ok) return setError(body.error || "更新失败");
    setMessage(okMsg);
    await load();
  }

  async function startExperiment(experiment: Experiment) {
    if (!window.confirm(`确认启动实验「${experiment.name}」？`)) return;
    await patchExperiment(
      experiment.id,
      { status: "running", startsAt: new Date().toISOString() },
      "实验已标记为运行中。",
    );
  }

  async function stopExperiment(experiment: Experiment) {
    if (!window.confirm(`确认停止实验「${experiment.name}」？`)) return;
    await patchExperiment(
      experiment.id,
      { status: "stopped", endsAt: new Date().toISOString() },
      "实验已停止。",
    );
  }

  async function reviewExperiment(experimentId: string) {
    setBusy(`review:${experimentId}`);
    setError(null);
    setMessage(null);
    const response = await apiFetch("/api/marketing/experiments/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ experimentId }),
    });
    const body = await response.json();
    setBusy(null);
    if (!response.ok) return setError(body.error || "复盘失败");
    const row = (body.experiments || [])[0] as ReviewRow | undefined;
    if (!row) return setError("未找到可复盘的实验数据");
    setReviews((prev) => ({ ...prev, [experimentId]: row }));
    setConfirmDraft((prev) => ({
      ...prev,
      [experimentId]: {
        winner: row.leadingVariantKey || prev[experimentId]?.winner || "",
        summary: prev[experimentId]?.summary || "",
      },
    }));
    setMessage(
      row.evidenceStatus === "directional_signal"
        ? "已生成方向性信号，请人工确认胜者。"
        : "样本量不足，仅供参考；仍可由你强制确认胜者。",
    );
  }

  async function confirmWinner(experiment: Experiment) {
    const draft = confirmDraft[experiment.id];
    if (!draft?.winner) {
      setError("请先选择胜出变体");
      return;
    }
    if (
      !window.confirm(
        `确认将变体「${draft.winner}」记为胜者并完成实验「${experiment.name}」？\n不会自动改预算或发布。`,
      )
    ) {
      return;
    }
    await patchExperiment(
      experiment.id,
      {
        status: "completed",
        winnerVariantKey: draft.winner,
        learningSummary: draft.summary || null,
        endsAt: new Date().toISOString(),
      },
      "已确认胜者并完成实验。",
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/operations/growth" className="text-sm text-accent">
            ← 返回增长中心
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold">
            <FlaskConical size={24} />
            赛马实验
          </h1>
          <p className="mt-1 text-sm text-muted">
            创建 → 运行 → 复盘方向性信号 → 人工确认胜者。复盘不会自动写 winner。
          </p>
        </div>
        <button type="button" onClick={load} className="rounded-lg border border-border p-2">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <form onSubmit={createExperiment} className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">新建实验</h2>
        <p className="mt-1 text-xs text-muted">
          需先有营销活动。内容资产请在活动侧挂上 variantKey（与下方变体 key 一致）。
        </p>
        {campaigns.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            暂无活动，请先到{" "}
            <Link href="/operations/growth/campaigns" className="text-accent">
              活动页
            </Link>{" "}
            创建。
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-muted">所属活动</span>
              <select
                required
                value={form.campaignId}
                onChange={(e) => setForm({ ...form, campaignId: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              >
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}（{campaign.status}）
                  </option>
                ))}
              </select>
            </label>
            <input
              required
              placeholder="实验名称"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2"
            />
            <select
              value={form.primaryMetric}
              onChange={(e) => setForm({ ...form, primaryMetric: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2"
            >
              <option value="qualified_lead">有效线索</option>
              <option value="appointment">预约</option>
              <option value="quote">报价</option>
              <option value="won_revenue">成交金额</option>
              <option value="views">播放/浏览</option>
            </select>
            <textarea
              required
              placeholder="假设（例如：短标题比长标题更能带来有效线索）"
              value={form.hypothesis}
              onChange={(e) => setForm({ ...form, hypothesis: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2 sm:col-span-2"
              rows={3}
            />
            <input
              required
              placeholder="变体 A key"
              value={form.variantA}
              onChange={(e) => setForm({ ...form, variantA: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2"
            />
            <input
              required
              placeholder="变体 B key"
              value={form.variantB}
              onChange={(e) => setForm({ ...form, variantB: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2"
            />
            <button
              type="submit"
              disabled={busy === "create"}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:col-span-2"
            >
              {busy === "create" ? "创建中…" : "创建草稿"}
            </button>
          </div>
        )}
      </form>

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">实验列表</h2>
        <div className="mt-3 space-y-4">
          {loading ? (
            <Loader2 className="animate-spin text-muted" />
          ) : experiments.length === 0 ? (
            <p className="text-sm text-muted">暂无实验。</p>
          ) : (
            experiments.map((experiment) => {
              const variants = asVariants(experiment.variantsJson);
              const review = reviews[experiment.id];
              const draft = confirmDraft[experiment.id] || {
                winner: experiment.winnerVariantKey || "",
                summary: experiment.learningSummary || "",
              };
              return (
                <div key={experiment.id} className="rounded-lg bg-background p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{experiment.name}</div>
                      <div className="mt-1 text-xs text-muted">
                        {experiment.campaign.name} · 主指标 {experiment.primaryMetric} · 变体{" "}
                        {variants.map((v) => v.key).join(" / ") || "—"}
                      </div>
                      <p className="mt-2 text-sm text-muted">{experiment.hypothesis}</p>
                      {experiment.winnerVariantKey && (
                        <p className="mt-2 text-sm text-emerald-700">
                          胜者：{experiment.winnerVariantKey}
                          {experiment.learningSummary ? ` · ${experiment.learningSummary}` : ""}
                        </p>
                      )}
                    </div>
                    <span className="rounded-full border border-border px-2 py-1 text-xs">
                      {STATUS_LABEL[experiment.status] || experiment.status}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {experiment.status === "draft" && (
                      <button
                        type="button"
                        disabled={busy === experiment.id}
                        onClick={() => startExperiment(experiment)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs"
                      >
                        启动运行
                      </button>
                    )}
                    {experiment.status === "running" && (
                      <>
                        <button
                          type="button"
                          disabled={busy === `review:${experiment.id}`}
                          onClick={() => reviewExperiment(experiment.id)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs"
                        >
                          {busy === `review:${experiment.id}` ? "复盘中…" : "复盘信号"}
                        </button>
                        <button
                          type="button"
                          disabled={busy === experiment.id}
                          onClick={() => stopExperiment(experiment)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs"
                        >
                          停止
                        </button>
                      </>
                    )}
                    {(experiment.status === "running" || experiment.status === "stopped") &&
                      !experiment.winnerVariantKey && (
                        <span className="self-center text-[11px] text-muted">
                          确认胜者下方填写后提交
                        </span>
                      )}
                  </div>

                  {review && (
                    <div className="mt-3 rounded border border-border p-3 text-xs">
                      <div className="font-medium">
                        复盘：{review.evidenceStatus}
                        {review.leadingVariantKey ? ` · 领先 ${review.leadingVariantKey}` : ""}
                      </div>
                      <p className="mt-1 text-muted">{review.warning}</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {review.variants.map((row) => (
                          <div key={row.variantKey} className="rounded bg-card-bg p-2">
                            <strong>{row.variantKey}</strong>
                            <div className="mt-1 text-muted">
                              主指标 {row.primary} · 曝光 {row.impressions} · 浏览 {row.views} ·
                              发布 {row.publications}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(experiment.status === "running" ||
                    experiment.status === "stopped" ||
                    experiment.status === "completed") && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <select
                        value={draft.winner}
                        disabled={Boolean(experiment.winnerVariantKey)}
                        onChange={(e) =>
                          setConfirmDraft((prev) => ({
                            ...prev,
                            [experiment.id]: { ...draft, winner: e.target.value },
                          }))
                        }
                        className="rounded-lg border border-border bg-card-bg px-3 py-2 text-sm"
                      >
                        <option value="">选择胜出变体</option>
                        {variants.map((variant) => (
                          <option key={variant.key} value={variant.key}>
                            {variant.name}
                          </option>
                        ))}
                      </select>
                      <input
                        placeholder="学习摘要（可选）"
                        value={draft.summary}
                        disabled={Boolean(experiment.winnerVariantKey)}
                        onChange={(e) =>
                          setConfirmDraft((prev) => ({
                            ...prev,
                            [experiment.id]: { ...draft, summary: e.target.value },
                          }))
                        }
                        className="rounded-lg border border-border bg-card-bg px-3 py-2 text-sm"
                      />
                      {!experiment.winnerVariantKey && (
                        <button
                          type="button"
                          disabled={busy === experiment.id}
                          onClick={() => confirmWinner(experiment)}
                          className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50 sm:col-span-2"
                        >
                          确认胜者并完成
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
