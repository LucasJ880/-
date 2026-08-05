"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api-fetch";

type Brief = {
  id: string;
  userId: string;
  roleHint: string | null;
  briefMarkdown: string;
  createdAt: string;
};

export function ProjectJoinBriefs({
  projectId,
  currentUserId,
}: {
  projectId: string;
  currentUserId: string | null;
}) {
  const [mine, setMine] = useState<Brief | null>(null);
  const [all, setAll] = useState<Brief[] | null>(null);
  const [canViewAll, setCanViewAll] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const loadMine = useCallback(async () => {
    try {
      const data = await apiJson<{
        brief?: Brief | null;
        canViewAll?: boolean;
        unavailable?: boolean;
      }>(`/api/projects/${projectId}/join-brief`);
      if (data.unavailable) {
        setUnavailable(true);
        return;
      }
      setMine(data.brief ?? null);
      setCanViewAll(!!data.canViewAll);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载简报失败");
    }
  }, [projectId]);

  const loadAll = useCallback(async () => {
    try {
      const data = await apiJson<{
        briefs?: Brief[];
        canViewAll?: boolean;
      }>(`/api/projects/${projectId}/join-brief?all=1`);
      setAll(Array.isArray(data.briefs) ? data.briefs : []);
      setCanViewAll(!!data.canViewAll);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载全部简报失败");
    }
  }, [projectId]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const generateMine = async () => {
    if (!currentUserId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/join-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "生成失败");
      await loadMine();
      if (showAll) await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id="project-join-briefs"
      className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">成员加入简报</h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            仅内部成员可见；外部供应商无此入口
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || unavailable}
            onClick={() => void generateMine()}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {mine ? "刷新我的简报" : "生成我的简报"}
          </button>
          {canViewAll && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const next = !showAll;
                setShowAll(next);
                if (next) void loadAll();
              }}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs"
            >
              {showAll ? "只看我的" : "查看全部成员简报"}
            </button>
          )}
        </div>
      </div>

      {unavailable && (
        <p className="text-xs text-[var(--muted)]">
          简报表暂不可用（可能尚未迁移）。
        </p>
      )}

      {!showAll && (
        <div className="rounded-lg border border-[var(--border)] p-3">
          {mine ? (
            <pre className="whitespace-pre-wrap text-xs leading-relaxed font-sans">
              {mine.briefMarkdown}
            </pre>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              尚无加入简报。加入项目后可自动生成；也可点击上方按钮生成。
            </p>
          )}
        </div>
      )}

      {showAll && (
        <ul className="space-y-3">
          {(all || []).length === 0 ? (
            <li className="text-xs text-[var(--muted)]">暂无成员简报</li>
          ) : (
            (all || []).map((b) => (
              <li
                key={b.id}
                className="rounded-lg border border-[var(--border)] p-3 space-y-1"
              >
                <p className="text-[11px] text-[var(--muted)]">
                  成员 {b.userId.slice(0, 8)}… · {b.roleHint || "成员"} ·{" "}
                  {new Date(b.createdAt).toLocaleString("zh-CN")}
                </p>
                <pre className="whitespace-pre-wrap text-xs leading-relaxed font-sans">
                  {b.briefMarkdown}
                </pre>
              </li>
            ))
          )}
        </ul>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
