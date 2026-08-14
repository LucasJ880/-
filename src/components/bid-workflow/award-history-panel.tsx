"use client";

/**
 * M1 — 历史授标检索面板（外部情报）
 * 检索加拿大政府合同披露 → 展示待确认 findings（含来源）→ 人工确认写入调查室
 * → 「上一轮中标方 / 历史合同金额 / 周期采购可能」变 READY → 可再喂历史对标。
 */

import { useEffect, useState } from "react";
import { Landmark, Loader2, Search } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";

type Finding = {
  vendorName: string;
  descriptionEn: string | null;
  contractValue: number | null;
  contractDate: string | null;
  buyerName: string | null;
  ownerOrg: string | null;
  referenceNumber: string | null;
  sourceUrl: string;
};

type AutoCandidate = {
  vendorName: string;
  hitQueries: string[];
  score: number;
  totalMatches: number;
  bestFinding: Finding;
};

type AutoBlock = {
  queries: string[];
  candidates: AutoCandidate[];
  fetchedAt: string;
} | null;

type WebCandidate = {
  domain: string;
  hitQueries: string[];
  findings: Array<{ title: string; url: string; snippet: string }>;
};

type WebBlock = {
  queries: string[];
  candidates: WebCandidate[];
} | null;

export function AwardHistoryPanel({
  projectId,
  defaultQuery,
  onConfirmed,
}: {
  projectId: string;
  defaultQuery?: string | null;
  onConfirmed?: () => void;
}) {
  const [q, setQ] = useState(defaultQuery ?? "");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [auto, setAuto] = useState<AutoBlock>(null);
  const [enabled, setEnabled] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const [web, setWeb] = useState<WebBlock>(null);

  // M1.1/M2：加载分析完成时自动生成的多线交叉验证候选（授标 + Web）
  useEffect(() => {
    apiJson<{ enabled: boolean; auto?: AutoBlock; webIntel?: WebBlock }>(
      `/api/projects/${projectId}/external-intel/award-history`,
    )
      .then((res) => {
        setEnabled(res.enabled);
        setAuto(res.auto ?? null);
        setWeb(res.webIntel ?? null);
      })
      .catch(() => {});
  }, [projectId]);

  const confirmCompetitor = async (name: string, url: string | null) => {
    setConfirming(name);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/external-intel/award-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "competitor", vendorName: name, sourceUrl: url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "确认失败");
      setNote(`已将 ${name} 记入竞争对手线索`);
      onConfirmed?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    setConfirming(null);
  };

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await apiJson<{
        enabled: boolean;
        ok?: boolean;
        findings?: Finding[];
        note?: string | null;
        total?: number;
      }>(`/api/projects/${projectId}/external-intel/award-history?q=${encodeURIComponent(q.trim())}`);
      setEnabled(res.enabled);
      setFindings(res.findings ?? []);
      setNote(
        !res.enabled
          ? "外部情报开关未启用（管理员在环境中开启后可用）"
          : res.note ??
              ((res.findings ?? []).length === 0 ? "未找到匹配的历史授标记录，可换关键词（如产品英文名/采购机构）再试" : null),
      );
    } catch {
      setNote("检索失败，请稍后重试");
    }
    setBusy(false);
  };

  const confirm = async (f: Finding) => {
    setConfirming(f.vendorName);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/external-intel/award-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName: f.vendorName,
          contractValue: f.contractValue,
          contractDate: f.contractDate,
          sourceUrl: f.sourceUrl,
          possiblyRecurring: true,
          // T4：结构化上下文直通组织级 canonical AwardRecord（不再折叠成展示字符串）
          buyerName: f.buyerName ?? f.ownerOrg ?? null,
          referenceNumber: f.referenceNumber ?? null,
          evidenceSnippet: f.descriptionEn ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "确认失败");
      setNote(`已确认：${f.vendorName} 写入调查结论，并已沉淀为组织授标情报`);
      onConfirmed?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    setConfirming(null);
  };

  return (
    <div className="rounded-xl border border-[var(--border)] p-4" data-testid="award-history-panel">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Landmark size={15} className="text-[var(--accent)]" />
        历史授标检索（加拿大政府合同披露）
      </h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        查同类采购历史上谁中标、金额多少；<b>人工确认后</b>才会写入调查结论并可用于目标价对标。
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="关键词（产品英文名 / 采购机构，如 mattress / Solicitor General）"
          className="min-w-[240px] flex-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs"
        />
        <button
          type="button"
          disabled={busy || !q.trim()}
          onClick={() => void search()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          检索
        </button>
      </div>
      {note ? <p className="mt-2 text-xs text-[var(--muted)]">{note}</p> : null}

      {/* 自动候选（分析完成时多线检索 + 交叉验证；命中线越多置信越高） */}
      {enabled && auto && auto.candidates.length > 0 ? (
        <div className="mt-3 space-y-1.5" data-testid="auto-award-candidates">
          <p className="text-xs font-semibold text-[var(--muted)]">
            自动检索候选（检索线：{auto.queries.join(" / ")}）
          </p>
          <ul className="space-y-1.5">
            {auto.candidates.slice(0, 5).map((c, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
              >
                <span className="min-w-0">
                  <b>{c.vendorName}</b>
                  {c.bestFinding.contractValue != null
                    ? ` · CAD ${c.bestFinding.contractValue.toLocaleString()}`
                    : ""}
                  {c.bestFinding.contractDate ? ` · ${c.bestFinding.contractDate}` : ""}
                  <span className="block text-[var(--muted)]">
                    交叉验证：命中 {c.hitQueries.length} 条检索线（{c.hitQueries.join("、")}）
                    {c.hitQueries.length >= 2 ? " · 高置信" : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <a
                    href={c.bestFinding.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    来源
                  </a>
                  <button
                    type="button"
                    disabled={confirming !== null}
                    onClick={() => void confirm(c.bestFinding)}
                    className="rounded bg-[var(--accent)] px-2 py-1 text-white disabled:opacity-50"
                  >
                    {confirming === c.bestFinding.vendorName ? "确认中…" : "确认为上轮中标"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* M2：Web 情报（域名跨线交叉验证；确认后记入竞争对手线索） */}
      {enabled && web && web.candidates.length > 0 ? (
        <div className="mt-3 space-y-1.5" data-testid="web-intel-candidates">
          <p className="text-xs font-semibold text-[var(--muted)]">
            网络情报（检索线：{web.queries.join(" / ")}）
          </p>
          <ul className="space-y-1.5">
            {web.candidates.slice(0, 5).map((c, i) => (
              <li key={i} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <b>{c.domain}</b>
                    <span className="ml-2 text-[var(--muted)]">
                      命中 {c.hitQueries.length} 条检索线{c.hitQueries.length >= 2 ? " · 高置信" : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={confirming !== null}
                    onClick={() => void confirmCompetitor(c.domain, c.findings[0]?.url ?? null)}
                    className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50"
                  >
                    记为竞争对手线索
                  </button>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {c.findings.slice(0, 2).map((f, j) => (
                    <li key={j} className="truncate">
                      <a href={f.url} target="_blank" rel="noreferrer" className="underline">
                        {f.title || f.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {enabled && findings.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {findings.slice(0, 8).map((f, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
            >
              <span className="min-w-0">
                <b>{f.vendorName}</b>
                {f.contractValue != null ? ` · CAD ${f.contractValue.toLocaleString()}` : ""}
                {f.contractDate ? ` · ${f.contractDate}` : ""}
                <span className="block text-[var(--muted)]">
                  {(f.descriptionEn ?? "").slice(0, 80)}
                  {f.ownerOrg ? ` · ${f.ownerOrg}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                  来源
                </a>
                <button
                  type="button"
                  disabled={confirming !== null}
                  onClick={() => void confirm(f)}
                  className="rounded bg-[var(--accent)] px-2 py-1 text-white disabled:opacity-50"
                >
                  {confirming === f.vendorName ? "确认中…" : "确认为上轮中标"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
