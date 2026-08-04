"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { bidPhaseLabel, goDecisionLabel } from "@/lib/bid-workflow/labels";

type Props = {
  projectId: string;
  hasRoom?: boolean;
  goDecision?: string | null;
  bidPhaseStatus?: string | null;
  aiSuggestion?: string | null;
  onChanged?: () => void;
};

export function StartIntelligencePanel({
  projectId,
  hasRoom: initialHasRoom,
  goDecision: initialGo,
  bidPhaseStatus,
  aiSuggestion: initialAiSuggestion,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRoom, setHasRoom] = useState(!!initialHasRoom);
  const [goDecision, setGoDecision] = useState(initialGo ?? null);
  const [phase, setPhase] = useState(bidPhaseStatus ?? null);
  const [note, setNote] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState(initialAiSuggestion ?? null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setHasRoom(!!initialHasRoom);
  }, [initialHasRoom]);
  useEffect(() => {
    setGoDecision(initialGo ?? null);
  }, [initialGo]);
  useEffect(() => {
    setPhase(bidPhaseStatus ?? null);
  }, [bidPhaseStatus]);
  useEffect(() => {
    setAiSuggestion(initialAiSuggestion ?? null);
  }, [initialAiSuggestion]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/bid-intelligence/start`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `启动失败 ${res.status}`);
      }
      setHasRoom(true);
      setPhase(data.bidPhaseStatus || phase || "INTELLIGENCE_IN_PROGRESS");
      setMsg(
        data.created
          ? "已创建调查室并生成八个模块"
          : "调查室已存在（幂等补齐；不会回退人工决定）",
      );
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, onChanged, phase]);

  const decide = useCallback(
    async (decision: "GO" | "HOLD" | "NO_GO") => {
      setBusy(true);
      setError(null);
      try {
        const res = await apiFetch(
          `/api/projects/${projectId}/bid-intelligence/go-decision`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision, note: note.trim() || undefined }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "决定失败");
        const prev = data.previousDecision as string | null | undefined;
        setGoDecision(decision);
        setPhase(decision);
        setMsg(
          prev && prev !== decision
            ? `人工决定已由 ${prev} 变更为 ${decision}`
            : `已记录人工决定：${decision}`,
        );
        onChanged?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [projectId, note, onChanged],
  );

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">投标调查</h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            阶段：{bidPhaseLabel(phase)}
            {goDecision
              ? ` · 人工决定：${goDecisionLabel(goDecision)}`
              : " · 人工决定：未决定"}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            AI 建议（仅供参考）：{aiSuggestion || "暂无"} — 不会自动成为最终决定
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void start()}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {hasRoom ? "再次确认调查（幂等）" : "确认进入投标调查"}
          </button>
          {hasRoom && (
            <Link
              href={`/projects/${projectId}/intelligence-room`}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
            >
              进入项目智能调查室
            </Link>
          )}
          <Link
            href={`/projects/${projectId}?tab=overview#project-suppliers`}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
          >
            查看关联供应商
          </Link>
        </div>
      </div>
      {hasRoom && (
        <div className="space-y-2">
          <label className="block text-xs space-y-1">
            <span>决定备注（可选）</span>
            <textarea
              className="w-full rounded-lg border border-[var(--border)] bg-background px-2 py-1.5 text-sm min-h-[64px]"
              placeholder="例如：等待证书样例确认后再推进…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(["GO", "HOLD", "NO_GO"] as const).map((d) => (
              <button
                key={d}
                type="button"
                disabled={busy}
                onClick={() => void decide(d)}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
              >
                {goDecisionLabel(d)}
              </button>
            ))}
            <span className="text-[11px] text-[var(--muted)] self-center">
              最终决定须人工点击；AI 不会自动批准
            </span>
          </div>
        </div>
      )}
      {msg && <p className="text-xs text-[var(--foreground)]">{msg}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
