"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Megaphone,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

type Task = {
  slug: string;
  title: string;
  description: string;
  skillId: string | null;
  available: boolean;
};

type Pending = {
  id: string;
  type: string;
  title: string;
  preview: string;
  status: string;
  createdAt: string;
};

type Dashboard = {
  org: { id: string; name: string; code: string } | null;
  completeness: { score: number; missing: string[]; present: string[] };
  contextStatus?: string;
  missingInformation: string[];
  summary: {
    activeCampaigns: number;
    pendingApprovals: number;
    runningExperiments: number;
    completenessScore: number;
  };
  pendingActions: Pending[];
  recentExecutions: Array<{
    id: string;
    success: boolean;
    createdAt: string;
    durationMs: number | null;
    skill: { slug: string; name: string };
  }>;
  tasks: Task[];
};

type RunResult = {
  slug: string;
  title: string;
  result: {
    executionId: string;
    success: boolean;
    content: string;
    parsed?: unknown;
    pendingActions: Array<{
      id: string;
      type: string;
      title: string;
      preview: string;
    }>;
    durationMs: number;
  };
};

export default function MarketingEmployeePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [runningSlug, setRunningSlug] = useState<string | null>(null);
  const [objective, setObjective] = useState("");
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [decideId, setDecideId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/marketing/employee");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "加载失败");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runTask(task: Task) {
    if (!task.available) {
      setError("该任务技能尚未导入当前组织，请先 Seed 营销 Phase 2 技能");
      return;
    }
    setRunningSlug(task.slug);
    setError("");
    setLastRun(null);
    try {
      const res = await apiFetch("/api/marketing/employee", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: task.slug,
          objective: objective.trim() || task.title,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "执行失败");
      setLastRun(body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "执行失败");
    } finally {
      setRunningSlug(null);
    }
  }

  async function decide(actionId: string, decision: "approve" | "reject") {
    setDecideId(actionId);
    try {
      const res = await apiFetch(`/api/ai/pending-actions/${actionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "操作失败");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setDecideId(null);
    }
  }

  const score = data?.summary.completenessScore ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            <Link href="/operations/growth" className="text-accent">
              ← 增长中心
            </Link>
          </p>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold">
            <Megaphone className="text-accent" size={26} />
            营销数字员工
          </h1>
          <p className="mt-1 text-sm text-muted">
            {data?.org
              ? `当前组织：${data.org.name}`
              : "按当前组织隔离的产品营销上下文与任务"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm"
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="animate-spin" size={16} /> 加载中…
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="产品档案完整度"
              value={`${score}/100`}
              warn={score < 60}
            />
            <Stat
              label="进行中活动"
              value={String(data?.summary.activeCampaigns ?? 0)}
            />
            <Stat
              label="待审批草稿"
              value={String(data?.summary.pendingApprovals ?? 0)}
              warn={(data?.summary.pendingApprovals ?? 0) > 0}
            />
            <Stat
              label="运行中实验"
              value={String(data?.summary.runningExperiments ?? 0)}
            />
          </section>

          {(data?.missingInformation?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle size={18} /> 本周主要机会：补齐营销上下文
              </div>
              <ul className="mt-2 list-inside list-disc text-sm">
                {data!.missingInformation.slice(0, 6).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <section className="rounded-xl border border-border bg-card-bg p-4">
            <label className="text-sm font-medium">本次目标（可选）</label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={2}
              placeholder="例如：完善 Sunny 商业窗帘定位；研究 Select Blinds；规划 Google Ads 但不要上线"
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <Sparkles size={18} /> 快捷任务
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(data?.tasks ?? []).map((task) => (
                <div
                  key={task.slug}
                  className="flex flex-col rounded-xl border border-border bg-card-bg p-4"
                >
                  <div className="font-medium">{task.title}</div>
                  <p className="mt-1 flex-1 text-sm text-muted">
                    {task.description}
                  </p>
                  {!task.available && (
                    <p className="mt-2 text-xs text-amber-700">技能未导入</p>
                  )}
                  <button
                    type="button"
                    disabled={!task.available || runningSlug === task.slug}
                    onClick={() => void runTask(task)}
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {runningSlug === task.slug ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    开始
                  </button>
                </div>
              ))}
            </div>
          </section>

          {lastRun && (
            <section className="rounded-xl border border-border bg-card-bg p-4">
              <h2 className="font-semibold">最近结果 · {lastRun.title}</h2>
              <p className="mt-1 text-xs text-muted">
                执行 ID：{lastRun.result.executionId} ·{" "}
                {lastRun.result.durationMs}ms
              </p>
              {(lastRun.result.pendingActions?.length ?? 0) > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                  已生成待审批：
                  {lastRun.result.pendingActions.map((p) => (
                    <div key={p.id} className="mt-1">
                      {p.title}（{p.type}）
                    </div>
                  ))}
                </div>
              )}
              <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-background p-3 text-xs whitespace-pre-wrap">
                {typeof lastRun.result.parsed === "object" &&
                lastRun.result.parsed
                  ? JSON.stringify(lastRun.result.parsed, null, 2)
                  : lastRun.result.content}
              </pre>
            </section>
          )}

          <section className="rounded-xl border border-border bg-card-bg p-4">
            <h2 className="font-semibold">待审批草稿</h2>
            {(data?.pendingActions?.length ?? 0) === 0 ? (
              <p className="mt-2 text-sm text-muted">暂无待审批</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data!.pendingActions.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <div className="font-medium">{p.title}</div>
                    <p className="mt-1 text-sm text-muted">{p.preview}</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={decideId === p.id}
                        onClick={() => void decide(p.id, "approve")}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                      >
                        {decideId === p.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={12} />
                        )}
                        批准
                      </button>
                      <button
                        type="button"
                        disabled={decideId === p.id}
                        onClick={() => void decide(p.id, "reject")}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        拒绝
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card-bg p-4">
            <h2 className="font-semibold">历史执行</h2>
            {(data?.recentExecutions?.length ?? 0) === 0 ? (
              <p className="mt-2 text-sm text-muted">暂无记录</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {data!.recentExecutions.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>
                      {e.skill.name}{" "}
                      <span className="text-muted">
                        {e.success ? "成功" : "失败"}
                      </span>
                    </span>
                    <span className="text-xs text-muted">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        warn
          ? "border-amber-300 bg-amber-50"
          : "border-border bg-card-bg"
      }`}
    >
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
