"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  SEQUENCE_LABEL_BY_OFFSET,
  isSequenceDayOffset,
} from "@/lib/trade/outreach-sequence-constants";

interface OutreachStepRow {
  id: string;
  dayOffset: number;
  status: string;
  scheduledAt: string;
  subject: string | null;
  lastError: string | null;
}

export function OutreachSequencePanel({
  prospectId,
  orgId,
}: {
  prospectId: string;
  orgId: string;
}) {
  const [steps, setSteps] = useState<OutreachStepRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(
      `/api/trade/prospects/${prospectId}/sequence?orgId=${encodeURIComponent(orgId)}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as { steps?: OutreachStepRow[] };
    setSteps(data.steps ?? []);
  }, [prospectId, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ensure = async () => {
    setBusy("ensure");
    setError(null);
    const res = await apiFetch(`/api/trade/prospects/${prospectId}/sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || "无法创建序列");
    else await load();
    setBusy(null);
  };

  const draft = async (stepId: string) => {
    setBusy(`draft:${stepId}`);
    setError(null);
    const res = await apiFetch(`/api/trade/prospects/${prospectId}/sequence/${stepId}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || "起草失败");
    else await load();
    setBusy(null);
  };

  const send = async (stepId: string, mode: "send" | "mark_sent") => {
    setBusy(`${mode}:${stepId}`);
    setError(null);
    const res = await apiFetch(`/api/trade/prospects/${prospectId}/sequence/${stepId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, mode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || "发送失败");
    else await load();
    setBusy(null);
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card-bg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">1 / 3 / 7 天跟进（人审发出）</h3>
        {steps.length === 0 && (
          <button
            type="button"
            disabled={busy === "ensure"}
            onClick={() => void ensure()}
            className="rounded-lg border border-border px-2 py-1 text-xs disabled:opacity-50"
          >
            {busy === "ensure" ? "创建中…" : "创建序列"}
          </button>
        )}
      </div>
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      {steps.length === 0 ? (
        <p className="text-xs text-muted">还没有跟进序列。创建后 cron 只起草第 3/7 天，不会自动发出。</p>
      ) : (
        <ul className="space-y-2">
          {steps.map((step) => {
            const label = isSequenceDayOffset(step.dayOffset)
              ? SEQUENCE_LABEL_BY_OFFSET[step.dayOffset]
              : `Day ${step.dayOffset}`;
            const drafting = busy === `draft:${step.id}`;
            const sending = busy?.endsWith(step.id) && busy.startsWith("send");
            const marking = busy === `mark_sent:${step.id}`;
            return (
              <li key={step.id} className="rounded-lg border border-border/40 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-foreground">{label}</div>
                    <div className="text-muted">
                      {step.status}
                      {step.subject ? ` · ${step.subject}` : ""}
                    </div>
                    {step.lastError && <div className="text-red-400">{step.lastError}</div>}
                  </div>
                  {step.status !== "sent" && step.status !== "skipped" && (
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void draft(step.id)}
                        className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
                      >
                        {drafting ? "起草中…" : step.subject ? "重写草稿" : "起草"}
                      </button>
                      {step.subject && (
                        <>
                          <button
                            type="button"
                            disabled={!!busy}
                            onClick={() => void send(step.id, "send")}
                            className="rounded-md bg-blue-600 px-2 py-1 text-white disabled:opacity-50"
                          >
                            {sending ? "发送中…" : "发送"}
                          </button>
                          <button
                            type="button"
                            disabled={!!busy}
                            onClick={() => void send(step.id, "mark_sent")}
                            className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
                          >
                            {marking ? "…" : "标记已发送"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
