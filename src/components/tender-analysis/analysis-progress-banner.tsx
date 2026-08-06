"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";

type LatestRun = {
  id: string;
  status: string;
  statusLabel: string;
  runKind: string;
  runKindLabel: string;
  pendingChangeCount?: number;
  errorMessage?: string | null;
};

type Props = {
  projectId: string;
  /** 上传响应里的初始状态 */
  seedStatus?: string | null;
  seedRunId?: string | null;
};

const ACTIVE = new Set([
  "PENDING",
  "EXTRACTING",
  "ANALYZING",
  "REVIEW_REQUIRED",
]);

export function AnalysisProgressBanner({
  projectId,
  seedStatus,
  seedRunId,
}: Props) {
  const [run, setRun] = useState<LatestRun | null>(
    seedRunId
      ? {
          id: seedRunId,
          status: seedStatus || "PENDING",
          statusLabel: "等待分析",
          runKind: "FULL",
          runKindLabel: "完整分析",
        }
      : null,
  );

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/tender-analysis/runs?latest=1`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.run) setRun(data.run);
    } catch {
      // 静默：进度条失败不影响文件管理
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, seedRunId, seedStatus]);

  useEffect(() => {
    if (!run || !ACTIVE.has(run.status)) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [run, load]);

  if (!run) return null;

  const tone =
    run.status === "FAILED"
      ? "bg-red-50 text-red-900 border-red-200"
      : run.status === "APPROVED"
        ? "bg-emerald-50 text-emerald-900 border-emerald-200"
        : run.status === "REVIEW_REQUIRED"
          ? "bg-amber-50 text-amber-950 border-amber-200"
          : "bg-stone-50 text-stone-800 border-stone-200";

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm space-y-1 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className="font-medium">招标文件分析：</span>
          {run.statusLabel}
          {run.runKind === "INCREMENTAL" ? (
            <span className="ml-2 text-xs opacity-80">（增量）</span>
          ) : null}
        </p>
        <Link
          href={`/projects/${projectId}/intelligence-room#tender-analysis`}
          className="text-xs underline"
        >
          查看分析
        </Link>
      </div>
      {run.status === "FAILED" && run.errorMessage ? (
        <p className="text-xs opacity-80">{run.errorMessage}</p>
      ) : null}
      {run.runKind === "INCREMENTAL" &&
      (run.pendingChangeCount ?? 0) > 0 ? (
        <p className="text-xs font-medium">
          增量分析：发现 {run.pendingChangeCount} 项变更待确认
        </p>
      ) : null}
    </div>
  );
}
