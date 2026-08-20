"use client";

/**
 * 批次一 · 投标合规矩阵：每条要求标注 已有/可开发/需Partner/需RFI/No-Go。
 * 人工判定为准（AI 不代填）；默认只展开 Mandatory；汇总条给缺口一眼观。
 */

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";

const FIT_OPTIONS = [
  { value: "HAVE", label: "已有" },
  { value: "BUILD", label: "可开发" },
  { value: "PARTNER", label: "需 Partner" },
  { value: "RFI", label: "需 RFI" },
  { value: "NO_GO", label: "No-Go" },
] as const;

type Req = {
  id: string;
  code: string;
  textZh: string;
  mandatory: boolean;
  evidenceRequired: boolean;
};
type Mark = { fit: string; noteZh: string | null };

export function BidFitMatrixCard({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Mark>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    apiJson<{ runId: string | null; requirements: Req[]; matrix: Record<string, Mark> }>(
      `/api/projects/${projectId}/bid-fit`,
    )
      .then((res) => {
        setRunId(res.runId);
        setReqs(res.requirements);
        setMatrix(res.matrix ?? {});
      })
      .catch(() => {});
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!runId || reqs.length === 0) return null;

  const mark = async (requirementId: string, fit: string) => {
    setBusy(requirementId);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/bid-fit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, requirementId, fit }),
      });
      const json = await res.json();
      if (res.ok) setMatrix(json.matrix ?? {});
    } finally {
      setBusy(null);
    }
  };

  const visible = showAll ? reqs : reqs.filter((r) => r.mandatory);
  const counts = FIT_OPTIONS.map((o) => ({
    ...o,
    n: Object.values(matrix).filter((m) => m.fit === o.value).length,
  }));
  const unmarked = visible.filter((r) => !matrix[r.id]).length;

  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="bid-fit-matrix">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardCheck size={16} className="text-accent/60" />
          投标合规矩阵
          <span className="text-[10px] font-normal text-muted">
            人工判定为准 · 未标 {unmarked} 条
          </span>
        </h3>
        <div className="flex items-center gap-2 text-[10px] text-muted">
          {counts.map((c) => (
            <span key={c.value} className={c.value === "NO_GO" && c.n > 0 ? "text-danger" : ""}>
              {c.label} {c.n}
            </span>
          ))}
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-accent underline"
          >
            {showAll ? "只看强制" : `全部 ${reqs.length} 条`}
          </button>
        </div>
      </div>
      <div className="mt-3 max-h-96 space-y-1.5 overflow-auto pr-1">
        {visible.map((r) => {
          const m = matrix[r.id];
          return (
            <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-xs">
              <div className="min-w-0">
                <span className="font-mono text-[10px] text-muted">{r.code}</span>
                {r.mandatory ? (
                  <span className="ml-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[9px] text-amber-700">强制</span>
                ) : null}
                <p className="mt-0.5 leading-5 text-foreground/85">{r.textZh}</p>
              </div>
              {canManage ? (
                busy === r.id ? (
                  <Loader2 size={14} className="mt-1 shrink-0 animate-spin text-muted" />
                ) : (
                  <select
                    value={m?.fit ?? ""}
                    onChange={(e) => e.target.value && void mark(r.id, e.target.value)}
                    className={`shrink-0 rounded border px-1.5 py-1 text-[11px] ${
                      m?.fit === "NO_GO"
                        ? "border-danger text-danger"
                        : m
                          ? "border-border text-foreground"
                          : "border-dashed border-border text-muted"
                    }`}
                  >
                    <option value="">未标</option>
                    {FIT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )
              ) : (
                <span className="shrink-0 text-[11px] text-muted">
                  {FIT_OPTIONS.find((o) => o.value === m?.fit)?.label ?? "未标"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
