"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type Metric =
  | { available: true; value: number }
  | { available: false; reason: "DATA NOT AVAILABLE YET" };

type Overview = {
  phase: string;
  mode: string;
  autoOptimization: string;
  autoDeployment: string;
  aiEvaluator: string;
  monitorAgent: string;
  metrics: {
    runCountToday: Metric;
    runCountLast7Days: Metric;
    toolFailureCountLast7Days: Metric;
    avgLatencyMsLast7Days: Metric;
    taskSuccessRate: Metric;
    p95Latency: Metric;
  };
};

function MetricValue({ metric }: { metric: Metric | undefined }) {
  if (!metric) return <span className="text-muted">DATA NOT AVAILABLE YET</span>;
  if (!metric.available) {
    return <span className="text-muted">{metric.reason}</span>;
  }
  return <span className="font-medium text-foreground">{metric.value}</span>;
}

export default function AutopilotOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await apiFetch("/api/autopilot/overview");
      if (cancelled) return;
      if (res.status === 403 || res.status === 401) {
        setError("无权访问 Autopilot");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("加载失败");
        setLoading(false);
        return;
      }
      setData((await res.json()) as Overview);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Qingyan Autopilot"
        description="观察青砚 AI 在真实业务中的表现。A0 仅基础设施，不含自动优化或部署。"
      />

      {loading ? <p className="text-sm text-muted">加载中…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-lg border border-border bg-background p-4 text-sm">
            <h2 className="mb-3 font-medium">System Status</h2>
            <dl className="space-y-2">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Autopilot Phase</dt>
                <dd>{data.phase}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Mode</dt>
                <dd>{data.mode}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Auto Optimization</dt>
                <dd>{data.autoOptimization}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Auto Deployment</dt>
                <dd>{data.autoDeployment}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">AI Evaluator</dt>
                <dd>{data.aiEvaluator}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Monitor Agent</dt>
                <dd>{data.monitorAgent}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-border bg-background p-4 text-sm">
            <h2 className="mb-3 font-medium">Observation</h2>
            <dl className="space-y-2">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Agent Runs Today</dt>
                <dd>
                  <MetricValue metric={data.metrics.runCountToday} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Runs Last 7 Days</dt>
                <dd>
                  <MetricValue metric={data.metrics.runCountLast7Days} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Tool Failures (7d)</dt>
                <dd>
                  <MetricValue metric={data.metrics.toolFailureCountLast7Days} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Average Latency (7d)</dt>
                <dd>
                  <MetricValue metric={data.metrics.avgLatencyMsLast7Days} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Task Success Rate</dt>
                <dd>
                  <MetricValue metric={data.metrics.taskSuccessRate} />
                </dd>
              </div>
            </dl>
          </section>
        </div>
      ) : null}

      <p className="text-sm">
        <Link className="text-primary underline" href="/ai/autopilot/runs">
          查看 Runs
        </Link>
      </p>
    </div>
  );
}
