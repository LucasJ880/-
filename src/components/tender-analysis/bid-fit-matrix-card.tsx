"use client";

/**
 * 投标合规矩阵（矩阵可用性批次重构 → 例外优先视图）：
 * - 默认全部组折叠成计数行（用户实测：RFQ 条款基本都是普通合规，不需逐条看）
 * - 顶部「例外区」单独列出真正要拍板的：需证据 / 已标为非「已有」的条目
 * - 按业务组展开核对（程序类带「常规条款」标）
 * - 「未标全部设为已有」/「本组全部已有」批量标注（人工动作，AI 仍不代填）
 * - 检测到英文条目时提供「翻译成中文」（调补翻端点，写回后刷新）
 * 五态语义不变：已有/可开发/需 Partner/需 RFI/No-Go。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardCheck, Languages, Loader2 } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import {
  BID_FIT_GROUPS,
  bidFitGroupOf,
  type BidFitGroupKey,
} from "@/lib/tender-auto-analysis/bid-fit-groups";
import { needsChineseTranslation } from "@/lib/tender-auto-analysis/requirement-lang";

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
  category: string | null;
  textZh: string;
  mandatory: boolean;
  evidenceRequired: boolean;
};
type Mark = {
  fit: string;
  noteZh: string | null;
  provenance?: { via?: string; kind?: string; score?: number; sourceProjectName?: string | null; sourceRequirementCode?: string | null } | null;
};
type Suggestion = {
  requirementId: string;
  kind: "exact" | "fuzzy";
  score: number;
  fit: string;
  noteZh: string | null;
  sourceProjectName: string | null;
  sourceRequirementCode: string | null;
};

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
  const [collapsed, setCollapsed] = useState<Record<BidFitGroupKey, boolean>>(
    () =>
      // 例外优先：默认全部折叠（defaultCollapsed 仅用于「常规条款」标注）
      Object.fromEntries(
        BID_FIT_GROUPS.map((g) => [g.key, true]),
      ) as Record<BidFitGroupKey, boolean>,
  );
  const [translating, setTranslating] = useState(false);
  const [translateNote, setTranslateNote] = useState<string | null>(null);
  // 合规记忆（B）：历史确认建议；exact 自动带入一次，fuzzy 一键采纳
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [memoryNote, setMemoryNote] = useState<string | null>(null);
  const autoAppliedRef = useRef(false);

  const load = useCallback(() => {
    apiJson<{ runId: string | null; requirements: Req[]; matrix: Record<string, Mark>; suggestions?: Suggestion[] }>(
      `/api/projects/${projectId}/bid-fit`,
    )
      .then((res) => {
        setRunId(res.runId);
        setReqs(res.requirements);
        setMatrix(res.matrix ?? {});
        setSuggestions(res.suggestions ?? []);
      })
      .catch(() => {});
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => (showAll ? reqs : reqs.filter((r) => r.mandatory)),
    [reqs, showAll],
  );
  const groups = useMemo(() => {
    const by = new Map<BidFitGroupKey, Req[]>();
    for (const r of visible) {
      const k = bidFitGroupOf(r.category);
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    // 组内：需证据的置顶（其余保持服务端 mandatory/code 序）
    for (const [k, list] of by) {
      by.set(
        k,
        [...list].sort(
          (a, b) => Number(b.evidenceRequired) - Number(a.evidenceRequired),
        ),
      );
    }
    return BID_FIT_GROUPS.map((g) => ({ ...g, items: by.get(g.key) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [visible]);

  const englishCount = useMemo(
    () => visible.filter((r) => needsChineseTranslation(r.textZh)).length,
    [visible],
  );
  // 例外 = 要拍板的：需证据，或已被人工标为非「已有」（可开发/需 Partner/需 RFI/No-Go）
  const exceptions = useMemo(
    () =>
      visible.filter((r) => {
        const m = matrix[r.id];
        return r.evidenceRequired || (m != null && m.fit !== "HAVE");
      }),
    [visible, matrix],
  );
  const allCollapsed = BID_FIT_GROUPS.every((g) => collapsed[g.key]);

  const applyMemory = async (mode: "exact" | "all") => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/bid-fit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, action: "apply-memory", mode }),
      });
      const json = (await res.json().catch(() => ({}))) as { applied?: number; error?: string };
      if (res.ok) {
        setMemoryNote(`已带入历史确认 ${json.applied ?? 0} 条（标注可改）`);
        load();
      } else {
        setMemoryNote(json.error ?? "带入失败");
      }
    } catch {
      setMemoryNote("带入失败");
    }
  };
  const exactPending = suggestions.filter((s) => s.kind === "exact").length;
  const fuzzyPending = suggestions.filter((s) => s.kind === "fuzzy").length;
  useEffect(() => {
    // 指纹一致的历史确认自动带入一次（幂等：只填未标）
    if (canManage && runId && exactPending > 0 && !autoAppliedRef.current) {
      autoAppliedRef.current = true;
      void applyMemory("exact");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, runId, exactPending]);

  if (!runId || reqs.length === 0) return null;

  const markMany = async (requirementIds: string[], fit: string, busyKey: string) => {
    if (requirementIds.length === 0) return;
    setBusy(busyKey);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/bid-fit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          requirementIds.length === 1
            ? { runId, requirementId: requirementIds[0], fit }
            : { runId, requirementIds, fit },
        ),
      });
      const json = await res.json();
      if (res.ok) setMatrix(json.matrix ?? {});
    } finally {
      setBusy(null);
    }
  };

  const translate = async () => {
    setTranslating(true);
    setTranslateNote(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/bid-fit/translate`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        translated?: number;
        failed?: number;
        error?: string;
      };
      if (res.ok) {
        setTranslateNote(
          `已翻译 ${json.translated ?? 0} 条${(json.failed ?? 0) > 0 ? `，${json.failed} 条保留原文` : ""}`,
        );
        load();
      } else {
        setTranslateNote(json.error ?? "翻译失败，请稍后重试");
      }
    } catch {
      setTranslateNote("翻译失败，请稍后重试");
    } finally {
      setTranslating(false);
    }
  };

  const unmarkedVisible = visible.filter((r) => !matrix[r.id]);
  const counts = FIT_OPTIONS.map((o) => ({
    ...o,
    n: Object.values(matrix).filter((m) => m.fit === o.value).length,
  }));

  const suggestionFor = (id: string) => suggestions.find((s) => s.requirementId === id) ?? null;
  const row = (r: Req) => (
    <div
      key={r.id}
      className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-xs"
    >
      <div className="min-w-0">
        <span className="font-mono text-[10px] text-muted">{r.code}</span>
        {r.mandatory ? (
          <span className="ml-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[9px] text-amber-700">强制</span>
        ) : null}
        {r.evidenceRequired ? (
          <span className="ml-1 rounded-full border border-sky-300 bg-sky-50 px-1.5 text-[9px] text-sky-700">需证据</span>
        ) : null}
        {matrix[r.id]?.provenance?.via === "memory" ? (
          <span className="ml-1 rounded-full border border-violet-300 bg-violet-50 px-1.5 text-[9px] text-violet-700" title={`来源：${matrix[r.id]?.provenance?.sourceProjectName ?? "历史项目"} ${matrix[r.id]?.provenance?.sourceRequirementCode ?? ""}`}>
            历史确认{matrix[r.id]?.provenance?.kind === "fuzzy" ? `（相似 ${matrix[r.id]?.provenance?.score ?? ""}）` : ""}
          </span>
        ) : null}
        <p className="mt-0.5 leading-5 text-foreground/85">{r.textZh}</p>
        {!matrix[r.id] && suggestionFor(r.id) ? (
          <p className="mt-0.5 text-[10px] text-violet-700">
            建议：{FIT_OPTIONS.find((o) => o.value === suggestionFor(r.id)!.fit)?.label ?? suggestionFor(r.id)!.fit}
            （来自 {suggestionFor(r.id)!.sourceProjectName ?? "历史项目"}，相似 {suggestionFor(r.id)!.score}）
          </p>
        ) : null}
      </div>
      {fitSelect(r)}
    </div>
  );

  const fitSelect = (r: Req) => {
    const m = matrix[r.id];
    return canManage ? (
      busy === r.id ? (
        <Loader2 size={14} className="mt-1 shrink-0 animate-spin text-muted" />
      ) : (
        <select
          value={m?.fit ?? ""}
          onChange={(e) => e.target.value && void markMany([r.id], e.target.value, r.id)}
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
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="bid-fit-matrix">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardCheck size={16} className="text-accent/60" />
          投标合规矩阵
          <span className="text-[10px] font-normal text-muted">
            人工判定为准 · 未标 {unmarkedVisible.length} 条
          </span>
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
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
          <button
            type="button"
            data-testid="bid-fit-toggle-groups"
            onClick={() =>
              setCollapsed(
                Object.fromEntries(
                  BID_FIT_GROUPS.map((g) => [g.key, !allCollapsed]),
                ) as Record<BidFitGroupKey, boolean>,
              )
            }
            className="text-accent underline"
          >
            {allCollapsed ? "展开全部组" : "收起全部组"}
          </button>
        </div>
      </div>

      {suggestions.length > 0 || memoryNote ? (
        <div className="mt-2 rounded-lg border border-violet-200/70 bg-violet-50/40 px-3 py-2 text-[11px]" data-testid="bid-fit-memory">
          合规记忆：
          {exactPending > 0 ? `${exactPending} 条与历史确认逐字一致（自动带入中）` : ""}
          {exactPending > 0 && fuzzyPending > 0 ? "；" : ""}
          {fuzzyPending > 0 ? `${fuzzyPending} 条相似可复用` : ""}
          {canManage && fuzzyPending > 0 ? (
            <button
              type="button"
              data-testid="bid-fit-apply-memory"
              onClick={() => void applyMemory("all")}
              className="ml-2 rounded border border-violet-300 px-1.5 py-0.5 text-[10px] text-violet-800 hover:bg-violet-100"
            >
              采纳全部历史建议（{fuzzyPending}）
            </button>
          ) : null}
          {memoryNote ? <span className="ml-2 text-muted">{memoryNote}</span> : null}
        </div>
      ) : null}

      {canManage ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {unmarkedVisible.length > 0 ? (
            <button
              type="button"
              data-testid="bid-fit-mark-all-have"
              disabled={busy != null}
              onClick={() => {
                if (
                  window.confirm(
                    `把当前可见的 ${unmarkedVisible.length} 条未标要求全部标为「已有」？已标条目不受影响。`,
                  )
                ) {
                  void markMany(unmarkedVisible.map((r) => r.id), "HAVE", "__all__");
                }
              }}
              className="rounded border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent/5"
            >
              {busy === "__all__" ? "标注中…" : `未标 ${unmarkedVisible.length} 条全部设为已有`}
            </button>
          ) : null}
          {englishCount > 0 ? (
            <button
              type="button"
              data-testid="bid-fit-translate"
              disabled={translating}
              onClick={() => void translate()}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent/5"
            >
              {translating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Languages size={12} />
              )}
              翻译成中文（{englishCount} 条英文）
            </button>
          ) : null}
          {translateNote ? (
            <span className="text-[10px] text-muted">{translateNote}</span>
          ) : null}
        </div>
      ) : null}

      <div
        data-testid="bid-fit-exceptions"
        className="mt-3 rounded-lg border border-amber-200/70 bg-amber-50/40 px-3 py-2"
      >
        <p className="text-xs font-medium text-foreground/90">
          需要拍板的例外 {exceptions.length} 条
          <span className="ml-2 font-normal text-[10px] text-muted">
            需证据 · 或已标为可开发/需 Partner/需 RFI/No-Go
          </span>
        </p>
        {exceptions.length === 0 ? (
          <p className="mt-1 text-[11px] text-muted">
            暂无例外——其余均为常规合规条款，可用「全部设为已有」一键处理，或展开某组逐条核对。
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">{exceptions.map(row)}</div>
        )}
      </div>

      <div className="mt-3 max-h-[32rem] space-y-2 overflow-auto pr-1">
        {groups.map((g) => {
          const isCollapsed = collapsed[g.key];
          const unmarkedInGroup = g.items.filter((r) => !matrix[r.id]);
          return (
            <div key={g.key} className="rounded-lg border border-border/60">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))
                  }
                  className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground/90"
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  {g.labelZh}
                  <span className="font-normal text-[10px] text-muted">
                    {g.items.length} 条{unmarkedInGroup.length > 0 ? ` · 未标 ${unmarkedInGroup.length}` : " · 已全标"}
                    {g.defaultCollapsed ? " · 常规条款" : ""}
                  </span>
                </button>
                {canManage && unmarkedInGroup.length > 0 ? (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() =>
                      void markMany(
                        unmarkedInGroup.map((r) => r.id),
                        "HAVE",
                        `__group_${g.key}__`,
                      )
                    }
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-accent/5"
                  >
                    {busy === `__group_${g.key}__` ? "…" : "本组全部已有"}
                  </button>
                ) : null}
              </div>
              {!isCollapsed ? (
                <div className="space-y-1.5 border-t border-border/40 px-2 py-2">
                  {g.items.map(row)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
