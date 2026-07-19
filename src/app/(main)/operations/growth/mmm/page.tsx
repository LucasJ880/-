"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { BrainCircuit, Loader2, Play, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { formatAllocations } from "@/lib/marketing/mmm-scenario";

interface Dataset {
  id: string;
  name: string;
  status: string;
  weekCount: number;
  targetKpi: string;
  qualityIssues: string[];
  createdAt: string;
  _count: { modelRuns: number };
}

interface Scenario {
  id: string;
  name: string;
  totalBudget: number;
  currency: string;
  allocationsJson: unknown;
  expectedKpi: number | null;
  confidenceLow: number | null;
  confidenceHigh: number | null;
  status: string;
}

interface ModelRun {
  id: string;
  status: string;
  modelVersion: string | null;
  error: string | null;
  createdAt: string;
  datasetVersion: { name: string; weekCount: number; targetKpi: string };
  contributions: Array<{ channel: string; contributionShare: number; roi: number | null }>;
  scenarios: Scenario[];
}

const SCENARIO_LABEL: Record<string, string> = {
  draft: "草稿",
  pending_approval: "待审批",
  approved: "已批准",
  rejected: "已退回",
};

export default function MarketingMmmPage() {
  const now = new Date();
  const prior = new Date(now.getTime() - 730 * 86400000);
  const [form, setForm] = useState({
    periodStart: prior.toISOString().slice(0, 10),
    periodEnd: now.toISOString().slice(0, 10),
    targetKpi: "qualifiedLeads",
    currency: "CAD",
  });
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<ModelRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, b] = await Promise.all([
      apiFetch("/api/marketing/mmm/datasets"),
      apiFetch("/api/marketing/mmm/runs"),
    ]);
    const [ad, bd] = await Promise.all([a.json(), b.json()]);
    if (a.ok) setDatasets(ad.datasets);
    else setError(ad.error || "数据集加载失败");
    if (b.ok) setRuns(bd.runs);
    else setError(bd.error || "模型运行加载失败");
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setError("MMM 加载失败"));
  }, [load]);

  async function createDataset(e: FormEvent) {
    e.preventDefault();
    setBusy("dataset");
    setError(null);
    setMessage(null);
    const r = await apiFetch("/api/marketing/mmm/datasets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await r.json();
    if (!r.ok) setError(body.error || "数据集生成失败");
    else {
      setMessage(
        body.dataset.status === "ready"
          ? "周级 MMM 数据集已准备好。"
          : "数据集已生成，但历史长度或数据质量不足；可以验证管道，不能据此调整预算。",
      );
    }
    setBusy(null);
    await load();
  }

  async function start(dataset: Dataset) {
    setBusy(dataset.id);
    setError(null);
    setMessage(null);
    const exploratory = dataset.status !== "ready";
    const r = await apiFetch("/api/marketing/mmm/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ datasetVersionId: dataset.id, exploratory }),
    });
    const body = await r.json();
    if (!r.ok) setError(body.error || "Meridian 启动失败");
    else {
      setMessage(
        exploratory
          ? "已提交探索性 Meridian 运行；结果只用于验证技术管道。"
          : "已提交正式 Meridian 运行。",
      );
    }
    setBusy(null);
    await load();
  }

  async function updateScenario(id: string, name: string, status: string) {
    const actionLabel =
      status === "pending_approval"
        ? "提交审批"
        : status === "approved"
          ? "批准"
          : status === "rejected"
            ? "退回"
            : status;
    if (
      !window.confirm(
        `确认对预算情景「${name}」执行「${actionLabel}」？\n批准后仍需人工到广告后台改预算，青砚不会自动投放。`,
      )
    ) {
      return;
    }
    setBusy(id);
    setError(null);
    setMessage(null);
    const r = await apiFetch(`/api/marketing/mmm/scenarios/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await r.json();
    setBusy(null);
    if (!r.ok) return setError(body.error || "情景状态更新失败");
    setMessage(body.note || `情景已更新为 ${SCENARIO_LABEL[status] || status}`);
    await load();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/operations/growth" className="text-sm text-accent">
            ← 返回增长中心
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold">
            <BrainCircuit size={24} />
            Meridian MMM
          </h1>
          <p className="mt-1 text-sm text-muted">
            先生成不可变周级数据集，再由独立 Meridian Worker 建模。预算情景可提交审批；批准后仍需人工到广告后台执行。
          </p>
        </div>
        <button type="button" onClick={load} className="rounded-lg border border-border p-2">
          <RefreshCw size={16} />
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

      <form onSubmit={createDataset} className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">生成周级数据集</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <input
            type="date"
            value={form.periodStart}
            onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
            className="rounded-lg border border-border bg-background px-3 py-2"
          />
          <input
            type="date"
            value={form.periodEnd}
            onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
            className="rounded-lg border border-border bg-background px-3 py-2"
          />
          <select
            value={form.targetKpi}
            onChange={(e) => setForm({ ...form, targetKpi: e.target.value })}
            className="rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="qualifiedLeads">有效线索</option>
            <option value="wins">成交数</option>
            <option value="revenue">成交收入</option>
          </select>
          <button
            type="submit"
            disabled={busy === "dataset"}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy === "dataset" ? "生成中…" : "生成数据集"}
          </button>
        </div>
      </form>

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">数据集版本</h2>
        <div className="mt-3 space-y-3">
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : datasets.length === 0 ? (
            <p className="text-sm text-muted">暂无数据集。</p>
          ) : (
            datasets.map((d) => (
              <div key={d.id} className="rounded-lg bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{d.name}</div>
                    <div className="mt-1 text-xs text-muted">
                      {d.weekCount} 周 · {d.targetKpi} · {d._count.modelRuns} 次运行
                    </div>
                    {d.qualityIssues?.length > 0 && (
                      <ul className="mt-2 list-disc pl-4 text-xs text-amber-700">
                        {d.qualityIssues.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border px-2 py-1 text-xs">
                      {d.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => start(d)}
                      disabled={busy === d.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs"
                    >
                      <Play size={12} />
                      {d.status === "ready" ? "运行 Meridian" : "验证管道"}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="font-semibold">模型运行与预算情景</h2>
        <div className="mt-3 space-y-3">
          {runs.length === 0 ? (
            <p className="text-sm text-muted">暂无模型运行。</p>
          ) : (
            runs.map((r) => (
              <div key={r.id} className="rounded-lg bg-background p-4">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="font-medium">{r.datasetVersion.name}</div>
                    <div className="mt-1 text-xs text-muted">
                      {r.modelVersion || "等待模型版本"} ·{" "}
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span className="h-fit rounded-full border border-border px-2 py-1 text-xs">
                    {r.status}
                  </span>
                </div>
                {r.error && <p className="mt-2 text-xs text-amber-700">{r.error}</p>}
                {r.contributions.length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {r.contributions.map((c) => (
                      <div key={c.channel} className="rounded border border-border p-2 text-xs">
                        <strong>{c.channel}</strong>
                        <div className="mt-1 text-muted">
                          贡献 {(c.contributionShare * 100).toFixed(1)}% · ROI{" "}
                          {c.roi?.toFixed(2) ?? "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4">
                  <h3 className="text-sm font-medium">预算情景</h3>
                  {r.scenarios.length === 0 ? (
                    <p className="mt-2 text-xs text-muted">
                      尚无情景。Worker 回调写入 scenarios 后会显示在这里。
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {r.scenarios.map((scenario) => {
                        const allocations = formatAllocations(scenario.allocationsJson);
                        return (
                          <div
                            key={scenario.id}
                            className="rounded border border-border p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="font-medium">{scenario.name}</div>
                                <div className="mt-1 text-xs text-muted">
                                  总预算 {scenario.totalBudget} {scenario.currency}
                                  {scenario.expectedKpi != null
                                    ? ` · 预期 KPI ${scenario.expectedKpi}`
                                    : ""}
                                  {scenario.confidenceLow != null &&
                                  scenario.confidenceHigh != null
                                    ? ` · 区间 ${scenario.confidenceLow}–${scenario.confidenceHigh}`
                                    : ""}
                                </div>
                              </div>
                              <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">
                                {SCENARIO_LABEL[scenario.status] || scenario.status}
                              </span>
                            </div>
                            {allocations.length > 0 && (
                              <ul className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
                                {allocations.map((row) => (
                                  <li key={row.channel}>
                                    {row.channel}：{row.amount} {scenario.currency}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                              {scenario.status === "draft" && (
                                <button
                                  type="button"
                                  disabled={busy === scenario.id}
                                  onClick={() =>
                                    updateScenario(
                                      scenario.id,
                                      scenario.name,
                                      "pending_approval",
                                    )
                                  }
                                  className="rounded border border-border px-2 py-1 text-xs"
                                >
                                  提交审批
                                </button>
                              )}
                              {scenario.status === "pending_approval" && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy === scenario.id}
                                    onClick={() =>
                                      updateScenario(scenario.id, scenario.name, "approved")
                                    }
                                    className="rounded bg-accent px-2 py-1 text-xs text-white"
                                  >
                                    批准
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy === scenario.id}
                                    onClick={() =>
                                      updateScenario(scenario.id, scenario.name, "rejected")
                                    }
                                    className="rounded border border-border px-2 py-1 text-xs"
                                  >
                                    退回
                                  </button>
                                </>
                              )}
                              {scenario.status === "approved" && (
                                <span className="text-[11px] text-emerald-700">
                                  已批准 · 请人工执行预算调整
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
