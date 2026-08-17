"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ObserveEmpty } from "@/components/autopilot/observe-empty";
import { StatusPill, type ObservePillTone } from "@/components/autopilot/status-pill";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTimeToronto } from "@/lib/time";

type RunItem = {
  runId: string;
  startedAt: string;
  runType: string;
  model: string | null;
  agent: string | null;
  domain: string | null;
  status: string;
  durationMs: number | null;
  eventCount: number;
  toolCalls: number;
  modelCalls: number;
  retrievals: number;
  humanEditCount: number;
  humanOverrideCount: number;
  reAskCount: number;
  health: "HEALTHY" | "GAP" | "ORPHAN" | "UNKNOWN";
};

type RunsResponse = {
  active?: boolean;
  observeState?: string;
  message?: string;
  items?: RunItem[];
  nextCursor?: string | null;
};

const STATUSES = ["", "running", "completed", "failed", "cancelled", "queued"];

function healthTone(health: RunItem["health"]): ObservePillTone {
  if (health === "HEALTHY") return "ok";
  if (health === "GAP" || health === "ORPHAN") return "warn";
  return "unknown";
}

function statusTone(status: string): ObservePillTone {
  if (status === "failed") return "warn";
  if (status === "running" || status === "queued") return "info";
  return "neutral";
}

export default function AutopilotRunsPage() {
  const [items, setItems] = useState<RunItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [inactive, setInactive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("7d");
  const [status, setStatus] = useState("");
  const [hasHumanSignal, setHasHumanSignal] = useState(false);
  const [hasToolFailure, setHasToolFailure] = useState(false);
  const [hasObservabilityGap, setHasObservabilityGap] = useState(false);

  const buildUrl = useCallback(
    (cursor?: string | null) => {
      const sp = new URLSearchParams();
      sp.set("range", range);
      sp.set("limit", "25");
      if (status) sp.set("status", status);
      if (hasHumanSignal) sp.set("hasHumanSignal", "true");
      if (hasToolFailure) sp.set("hasToolFailure", "true");
      if (hasObservabilityGap) sp.set("hasObservabilityGap", "true");
      if (cursor) sp.set("cursor", cursor);
      return `/api/autopilot/runs?${sp.toString()}`;
    },
    [range, status, hasHumanSignal, hasToolFailure, hasObservabilityGap],
  );

  const load = useCallback(
    async (cursor?: string | null, append = false) => {
      setLoading(true);
      setError(null);
      const res = await apiFetch(buildUrl(cursor));
      if (res.status === 403 || res.status === 401) {
        setError("无权访问 Autopilot Runs");
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
        setError("加载 Runs 失败");
        setLoading(false);
        return;
      }
      const data = (await res.json()) as RunsResponse;
      if (data.observeState === "NOT_ACTIVE") {
        setInactive(
          data.message ?? "Autopilot Observe is not active in this environment.",
        );
        setItems([]);
        setNextCursor(null);
        setLoading(false);
        return;
      }
      setInactive(null);
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
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Autopilot Runs"
        description="查找某一个 AI Run 发生了什么。Health 只代表 observability integrity，不是 AI 质量。"
        breadcrumbs={
          <Link href="/ai/autopilot" className="hover:underline">
            Autopilot
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2 text-xs">
        {(["24h", "7d", "30d"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setRange(item)}
            className={`rounded-full border px-3 py-1 ${
              range === item
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted"
            }`}
          >
            {item}
          </button>
        ))}
        <select
          className="rounded-full border border-border bg-background px-3 py-1"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Run status"
        >
          {STATUSES.map((item) => (
            <option key={item || "all"} value={item}>
              {item || "All statuses"}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={hasHumanSignal}
            onChange={(e) => setHasHumanSignal(e.target.checked)}
          />
          Has human signal
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={hasToolFailure}
            onChange={(e) => setHasToolFailure(e.target.checked)}
          />
          Has tool failure
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={hasObservabilityGap}
            onChange={(e) => setHasObservabilityGap(e.target.checked)}
          />
          Has observability gap
        </label>
      </div>

      {loading && items.length === 0 ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {inactive ? (
        <ObserveEmpty
          title="Autopilot Observe is not active in this environment."
          body="Production telemetry is not active. This is not a claim that Qingyan AI had no runs."
        />
      ) : null}

      {!inactive && !loading && items.length === 0 ? (
        <ObserveEmpty
          title="No observed runs in this time range."
          body="Try a different window or clear filters."
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">Run ID</th>
                  <th className="px-3 py-2 font-medium">Agent / Domain</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Events</th>
                  <th className="px-3 py-2 font-medium">Tool / Model / Retrieval</th>
                  <th className="px-3 py-2 font-medium">Human signals</th>
                  <th className="px-3 py-2 font-medium">Health</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.runId} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDateTimeToronto(row.startedAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        className="text-primary underline"
                        href={`/ai/autopilot/runs/${row.runId}`}
                      >
                        {row.runId}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {row.agent ?? "—"} / {row.domain ?? "—"}
                    </td>
                    <td className="px-3 py-2">{row.runType}</td>
                    <td className="px-3 py-2">
                      <StatusPill
                        label={row.status}
                        tone={statusTone(row.status)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {row.durationMs == null ? "—" : `${row.durationMs}ms`}
                    </td>
                    <td className="px-3 py-2">{row.eventCount}</td>
                    <td className="px-3 py-2">
                      {row.toolCalls} / {row.modelCalls} / {row.retrievals}
                    </td>
                    <td className="px-3 py-2">
                      <span className="mr-1">EDIT {row.humanEditCount}</span>
                      <span className="mr-1">OVERRIDE {row.humanOverrideCount}</span>
                      <span>RE-ASK {row.reAskCount}</span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill
                        label={row.health}
                        tone={healthTone(row.health)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {items.map((row) => (
              <li key={row.runId}>
                <Link
                  href={`/ai/autopilot/runs/${row.runId}`}
                  className="block rounded-lg border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{row.runId}</span>
                    <StatusPill label={row.status} tone={statusTone(row.status)} />
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {formatDateTimeToronto(row.startedAt)} · {row.agent ?? "—"} /{" "}
                    {row.domain ?? "—"}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                    <StatusPill
                      label={`EDIT ${row.humanEditCount}`}
                      tone="neutral"
                    />
                    <StatusPill
                      label={`OVERRIDE ${row.humanOverrideCount}`}
                      tone="neutral"
                    />
                    <StatusPill
                      label={`RE-ASK ${row.reAskCount}`}
                      tone="neutral"
                    />
                    <StatusPill label={row.health} tone={healthTone(row.health)} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {nextCursor ? (
        <button
          type="button"
          className="rounded-full border border-border px-4 py-2 text-sm"
          onClick={() => void load(nextCursor, true)}
        >
          Load next page
        </button>
      ) : null}
    </div>
  );
}
