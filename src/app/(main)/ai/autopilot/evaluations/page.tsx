"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/autopilot/metric-card";
import { ObserveEmpty } from "@/components/autopilot/observe-empty";
import { StatusPill, type ObservePillTone } from "@/components/autopilot/status-pill";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTimeToronto } from "@/lib/time";

type EvaluateItem = {
  evaluationId: string;
  runId: string;
  evaluatedAt: string;
  startedAt: string | null;
  runType: string;
  model: string | null;
  agent: string | null;
  domain: string | null;
  runtimeStatus: string;
  outcome: string;
  failureType: string | null;
  failureSource: string | null;
  judged: boolean;
  ruleId: string;
  evaluatorKind: string;
  evaluatorVersion: string;
  llmOutcome?: string | null;
  llmFailureType?: string | null;
  llmJudged?: boolean | null;
  llmRuleId?: string | null;
};

type EvaluationsResponse = {
  evaluateState?: string;
  observeState?: string;
  message?: string;
  range?: string;
  evaluatedRuns?: number;
  unknownCount?: number;
  failureCount?: number;
  humanOverrideOutcomeCount?: number;
  abandonedCount?: number;
  taskSuccessCount?: number;
  partialSuccessCount?: number;
  judgedCount?: number;
  llmJudge?: string;
  llmJudgedCount?: number;
  llmTaskSuccessCount?: number;
  llmPartialSuccessCount?: number;
  llmFailureCount?: number;
  aiEvaluator?: string;
  items?: EvaluateItem[];
  nextCursor?: string | null;
};

const OUTCOMES = ["", "UNKNOWN", "FAILURE", "HUMAN_OVERRIDE", "ABANDONED"];

function outcomeTone(outcome: string): ObservePillTone {
  if (outcome === "FAILURE") return "warn";
  if (outcome === "TASK_SUCCESS") return "ok";
  if (outcome === "PARTIAL_SUCCESS") return "info";
  if (outcome === "HUMAN_OVERRIDE") return "info";
  if (outcome === "ABANDONED") return "neutral";
  return "unknown";
}

function judgedTone(judged: boolean): ObservePillTone {
  return judged ? "ok" : "unknown";
}

export default function AutopilotEvaluationsPage() {
  const [items, setItems] = useState<EvaluateItem[]>([]);
  const [summary, setSummary] = useState<EvaluationsResponse | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [inactive, setInactive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("7d");
  const [outcome, setOutcome] = useState("");

  const buildUrl = useCallback(
    (cursor?: string | null) => {
      const sp = new URLSearchParams();
      sp.set("range", range);
      sp.set("limit", "25");
      if (outcome) sp.set("outcome", outcome);
      if (cursor) sp.set("cursor", cursor);
      return `/api/autopilot/evaluations?${sp.toString()}`;
    },
    [range, outcome],
  );

  const load = useCallback(
    async (cursor?: string | null, append = false) => {
      setLoading(true);
      setError(null);
      const res = await apiFetch(buildUrl(cursor));
      if (res.status === 403 || res.status === 401) {
        setError("无权访问 Autopilot Evaluations");
        setItems([]);
        setLoading(false);
        return;
      }
      if (res.status === 400) {
        setError("查询参数无效");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("加载 Evaluations 失败");
        setLoading(false);
        return;
      }
      const data = (await res.json()) as EvaluationsResponse;
      if (data.evaluateState === "NOT_ACTIVE" || data.observeState === "NOT_ACTIVE") {
        setInactive(
          data.message ?? "Autopilot Evaluate is not active in this environment.",
        );
        setSummary(data);
        setItems([]);
        setNextCursor(null);
        setLoading(false);
        return;
      }
      setInactive(null);
      setSummary(data);
      setItems((prev) => (append ? [...prev, ...(data.items ?? [])] : data.items ?? []));
      setNextCursor(data.nextCursor ?? null);
      setLoading(false);
    },
    [buildUrl],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Autopilot Evaluations"
        description="确定性评估：这轮好不好。Completed 不是成功。Human override 不是 AI_WRONG。"
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-muted">
          Range{" "}
          <select
            className="rounded border border-border bg-background px-2 py-1"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="24h">24h</option>
            <option value="7d">7d</option>
            <option value="30d">30d</option>
          </select>
        </label>
        <label className="text-muted">
          Outcome{" "}
          <select
            className="rounded border border-border bg-background px-2 py-1"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            <option value="">All</option>
            {OUTCOMES.filter(Boolean).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="text-sm text-warning">{error}</p> : null}
      {loading && items.length === 0 && !inactive ? (
        <p className="text-sm text-muted">Loading evaluations…</p>
      ) : null}

      {inactive ? (
        <ObserveEmpty title="Evaluate is not active" body={inactive} />
      ) : (
        <>
          <p className="text-[11px] text-muted">
            Deterministic evaluator first. AI Evaluator{" "}
            {summary?.aiEvaluator ?? "DISABLED"}. LLM Judge{" "}
            {summary?.llmJudge ?? "OFF"}. Human override is not AI_WRONG. Completed
            is not automatically TASK_SUCCESS. Semantic failures like HALLUCINATION
            are not assigned without source text.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Evaluated runs"
              value={summary?.evaluatedRuns ?? 0}
              hint="Evaluation rows, not success"
            />
            <MetricCard
              label="Not judged"
              value={summary?.unknownCount ?? 0}
              hint="UNKNOWN ≠ failure"
            />
            <MetricCard
              label="Failure outcomes"
              value={summary?.failureCount ?? 0}
              hint="Runtime failed only"
            />
            <MetricCard
              label="Override outcomes"
              value={summary?.humanOverrideOutcomeCount ?? 0}
              hint="Not AI_WRONG"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <MetricCard
              label="Abandoned"
              value={summary?.abandonedCount ?? 0}
              hint="Cancelled runtime"
            />
            <MetricCard
              label="TASK_SUCCESS"
              value={summary?.taskSuccessCount ?? 0}
              hint="Deterministic never assigns this"
            />
            <MetricCard
              label="PARTIAL_SUCCESS"
              value={summary?.partialSuccessCount ?? 0}
              hint="Deterministic never assigns this"
            />
            <MetricCard
              label="LLM judged"
              value={summary?.llmJudgedCount ?? 0}
              hint="Optional structural judge, not a score"
            />
          </div>

          {items.length === 0 && !loading ? (
            <ObserveEmpty
              title="No evaluations in this window"
              body="Processor must project a run before a deterministic evaluation exists."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-border text-[11px] text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Evaluated</th>
                    <th className="px-3 py-2 font-medium">Agent</th>
                    <th className="px-3 py-2 font-medium">Domain</th>
                    <th className="px-3 py-2 font-medium">Runtime</th>
                    <th className="px-3 py-2 font-medium">Outcome</th>
                    <th className="px-3 py-2 font-medium">LLM</th>
                    <th className="px-3 py-2 font-medium">Failure</th>
                    <th className="px-3 py-2 font-medium">Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.evaluationId} className="border-b border-border/70">
                      <td className="px-3 py-2 tabular-nums text-[12px]">
                        <Link
                          className="text-primary underline"
                          href={`/ai/autopilot/runs/${item.runId}`}
                        >
                          {formatDateTimeToronto(item.evaluatedAt)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{item.agent ?? "n/a"}</td>
                      <td className="px-3 py-2">{item.domain ?? "n/a"}</td>
                      <td className="px-3 py-2">
                        <StatusPill label={item.runtimeStatus} tone="neutral" />
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill
                          label={item.outcome}
                          tone={outcomeTone(item.outcome)}
                        />{" "}
                        <StatusPill
                          label={item.judged ? "judged" : "not judged"}
                          tone={judgedTone(item.judged)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {item.llmOutcome ? (
                          <>
                            <StatusPill
                              label={item.llmOutcome}
                              tone={outcomeTone(item.llmOutcome)}
                            />
                            {item.llmRuleId ? (
                              <span className="ml-1 text-[11px] text-muted">
                                {item.llmRuleId}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[12px] text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[12px]">
                        {item.failureType ?? item.llmFailureType ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-muted">
                        {item.ruleId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {nextCursor ? (
            <button
              type="button"
              className="text-sm text-primary underline"
              onClick={() => void load(nextCursor, true)}
            >
              Load more
            </button>
          ) : null}
        </>
      )}

      <p className="text-sm">
        <Link className="text-primary underline" href="/ai/autopilot">
          Overview
        </Link>
        <span className="px-2 text-muted">·</span>
        <Link className="text-primary underline" href="/ai/autopilot/runs">
          Runs
        </Link>
      </p>
    </div>
  );
}
