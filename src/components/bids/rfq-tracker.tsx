"use client";

/**
 * T-2 询价追踪页：一页看清所有在途询价
 *
 * 取数：GET /api/org/tender-rfq/tracker（组织由服务端按登录者解析；apiFetch 对 /api/org/ 自动带 orgId）。
 * 原地操作：待批催单卡用 W-1 的 RfqApprovalPanel（variant="chase"，调审批中心既有接口，同步执行）；
 * 「全部批准」前端逐张顺序调用同一个 approve 接口；「现在就催」调 POST /api/projects/[id]/tender-rfq/chase（只起草审批卡）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RfqApprovalPanel, type RfqDecisionOutcome } from "@/components/inquiry/rfq-approval-panel";
import { apiFetch } from "@/lib/api-fetch";
import { notifyPendingActionsChanged } from "@/lib/hooks/use-pending-approvals-badge";
import type { TrackerCard, TrackerPayload, TrackerRow } from "@/lib/tender-rfq/tracker";
import { EMPTY_TRACKER_ZH, TRACKER_TABS, approvableCards, filterTrackerGroups, firstTabWithRows, type TrackerTab } from "@/lib/tender-rfq/tracker-view";
import { chaseOutcomeFromMessage, chaseErrorText, friendlyExecutionError } from "@/lib/tender-rfq/web-entry-pure";
import { cn } from "@/lib/utils";

type ChaseNowResponse = {
  drafted?: Array<{ itemId: string; actionId: string; chaseKind: TrackerCard["chaseKind"]; chaseIndex: number; approval: TrackerCard["approval"] | null; emails: TrackerCard["emails"] }>;
  skipped?: Array<{ itemId: string; reasonZh: string }>;
  failed?: Array<{ itemId: string; reasonZh: string }>;
  error?: string;
};

export function RfqTracker() {
  const search = useSearchParams();
  const project = search.get("project");
  const [data, setData] = useState<TrackerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TrackerTab>("needs");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [extraCards, setExtraCards] = useState<Record<string, TrackerCard[]>>({});
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [busyRound, setBusyRound] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const tabChosen = useRef(false);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    apiFetch(`/api/org/tender-rfq/tracker${project ? `?project=${encodeURIComponent(project)}` : ""}`)
      .then(async (res) => {
        if (seq !== loadSeq.current) return; // 只认最后一次读取（审查 L5）
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error || "询价追踪读取失败，请刷新重试。");
          return;
        }
        const payload = (await res.json()) as TrackerPayload;
        if (seq !== loadSeq.current) return;
        setError(null);
        setData(payload);
        setExtraCards({});
        // 从首页建议按项目进来：默认停在第一个有内容的页签（审查 M5）
        if (project && !tabChosen.current) {
          tabChosen.current = true;
          setTab(firstTabWithRows(payload.groups));
        }
      })
      .catch(() => seq === loadSeq.current && setError("询价追踪读取失败，请刷新重试。"));
  }, [project]);
  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => (data ? filterTrackerGroups(data.groups, tab) : []), [data, tab]);
  const note = (itemId: string, text: string) => setNotes((n) => ({ ...n, [itemId]: text }));

  async function chaseNow(projectId: string, inquiryId: string, row: TrackerRow) {
    setBusyRow(row.itemId);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tender-rfq/chase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inquiryId, itemIds: [row.itemId] }),
      });
      const j = (await res.json().catch(() => ({}))) as ChaseNowResponse;
      if (!res.ok) return note(row.itemId, j.error || "起草催单没有成功，请重试。");
      const mine = (j.drafted ?? []).filter((d) => d.itemId === row.itemId && d.approval);
      if (mine.length) {
        setExtraCards((x) => ({
          ...x,
          [row.itemId]: mine.map((d) => ({ actionId: d.actionId, approval: d.approval!, emails: d.emails, chaseKind: d.chaseKind, chaseIndex: d.chaseIndex })),
        }));
        notifyPendingActionsChanged();
        note(row.itemId, "已起草一张催单卡，批准后才会发出。");
      } else {
        const why = (j.skipped ?? []).find((s) => s.itemId === row.itemId)?.reasonZh ?? (j.failed ?? []).find((f) => f.itemId === row.itemId)?.reasonZh;
        note(row.itemId, why ? `没有起草：${why}` : "没有起草催单。");
      }
    } catch {
      note(row.itemId, "网络出错了，请重试。");
    } finally {
      setBusyRow(null);
    }
  }

  async function approveAll(inquiryId: string, cards: Array<TrackerCard & { itemId: string }>) {
    setBusyRound(inquiryId);
    // 逐张顺序调用既有 approve 接口；一张失败不影响其它
    for (const c of cards) {
      try {
        const res = await apiFetch(`/api/capabilities/approvals/${encodeURIComponent(c.approval.approvalId)}/approve?orgId=${encodeURIComponent(c.approval.orgId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: `approve:${c.approval.approvalId}:${Date.now()}`, expectedPayloadHash: c.approval.payloadHash ?? undefined }),
        });
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
        note(c.itemId, d.ok ? chaseOutcomeFromMessage(d.message).text : friendlyExecutionError(chaseErrorText(d.error || d.message || "")));
      } catch {
        note(c.itemId, "网络出错了，不确定是否已发出：先刷新看状态再操作。");
      }
    }
    notifyPendingActionsChanged();
    setBusyRound(null);
    load();
  }

  // 已经有数据时读取失败：保留页面与结果文字，只在上面提示（审查 L5）
  if (error && !data) return <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger" data-testid="rfq-tracker-error">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Loader2 size={14} className="animate-spin" /> 正在读取在途询价…
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="rfq-tracker">
      {error ? <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger" data-testid="rfq-tracker-error">{error}</p> : null}
      {project ? (
        <p className="flex items-center gap-2 text-[11px] text-muted" data-testid="rfq-tracker-project-filter">
          只看这个项目
          <Link href="/bids/rfq" className="text-accent hover:underline">
            看全部
          </Link>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2" role="tablist">
        {TRACKER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            data-testid={`rfq-tracker-tab-${t.key}`}
            onClick={() => {
              tabChosen.current = true;
              setTab(t.key);
            }}
            className={cn("rounded-full border px-3 py-1 text-xs", tab === t.key ? "border-accent bg-accent/10 text-accent" : "border-border text-foreground/80 hover:bg-accent/5")}
          >
            {t.label} <span className="font-mono">{t.count(data.summary)}</span>
          </button>
        ))}
      </div>
      {data.truncated ? <p className="text-[11px] text-amber-700">在途询价太多，只列了一部分（需要我处理的优先）。可以从首页建议或项目里按项目查看。</p> : null}

      {groups.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-xs text-muted" data-testid="rfq-tracker-empty">
          {data.groups.length === 0 ? EMPTY_TRACKER_ZH : "这一类现在没有。"}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.project.id} className="rounded-xl border border-border bg-card-bg p-4" data-testid="rfq-tracker-project">
            <h2 className="text-sm font-semibold text-foreground">{g.project.name}</h2>
            {g.rounds.map((r) => {
              const allCards = r.rows.map((row) => ({ row, cards: [...row.cards, ...(extraCards[row.itemId] ?? [])] }));
              const batch = approvableCards(allCards.map((x) => ({ cards: x.cards.map((c) => ({ ...c, itemId: x.row.itemId })) })));
              return (
                <div key={r.inquiryId} className="mt-3 border-t border-border/50 pt-3" id={`rfq-round-${r.inquiryId}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">第 {r.roundNumber} 轮</span>
                    {r.replyByText ? <span className="text-muted">{r.replyByText}</span> : null}
                    <Link href={r.projectHref} className="text-accent hover:underline">
                      打开项目
                    </Link>
                    {batch.length >= 2 ? (
                      <Button size="sm" variant="accent" loading={busyRound === r.inquiryId} loadingText="正在逐张发出…" disabled={busyRound !== null} onClick={() => void approveAll(r.inquiryId, batch)} data-testid="rfq-tracker-approve-all">
                        全部批准（{batch.length} 封）
                      </Button>
                    ) : null}
                  </div>
                  <ul className="mt-2 space-y-2">
                    {allCards.map(({ row, cards }) => (
                      <li key={row.itemId} className="rounded-lg border border-border/60 px-3 py-2 text-xs" data-testid="rfq-tracker-row">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{row.supplierName}</span>
                          <span className="rounded-full border border-border px-1.5 text-[10px] text-muted">{row.view.statusLabel}</span>
                          {row.needsActionLabel ? <span className="rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-800" data-testid="rfq-tracker-needs">{row.needsActionLabel}</span> : null}
                        </div>
                        <p className="mt-1 text-foreground/80">
                          {[row.view.sentText, row.view.chasedText, row.view.outlookText, row.view.missingText, row.view.replyByText].filter(Boolean).join(" · ")}
                        </p>
                        {row.quote ? (
                          <p className="mt-1 text-foreground/85" data-testid="rfq-tracker-quote">
                            {row.quote.quoteText}
                            {row.quote.landedText ? <span className="ml-2 font-medium">{row.quote.landedText}</span> : null}
                            {row.quote.cheapest ? <span className="ml-2 rounded-full bg-emerald-100 px-1.5 text-[10px] text-emerald-800">最便宜</span> : null}
                            {row.quote.needsCompareLink ? (
                              <Link href={r.compareHref} className="ml-2 text-accent hover:underline">
                                去比价
                              </Link>
                            ) : null}
                          </p>
                        ) : null}
                        {busyRound === r.inquiryId && cards.length ? <p className="mt-2 text-[11px] text-muted">正在逐张发出这一轮的催单卡…</p> : null}
                        {busyRound === r.inquiryId ? null : cards.map((c) => (
                          <RfqApprovalPanel
                            key={c.actionId}
                            className="mt-2"
                            projectId={g.project.id}
                            inquiryId={r.inquiryId}
                            roundNumber={r.roundNumber}
                            approval={c.approval}
                            emails={c.emails}
                            variant="chase"
                            chase={{ kind: c.chaseKind, chaseIndex: c.chaseIndex, supplierName: row.supplierName }}
                            onDone={(o: RfqDecisionOutcome) => {
                              note(row.itemId, o.text);
                              load();
                            }}
                          />
                        ))}
                        {row.canChaseNow && cards.length === 0 ? (
                          <Button size="sm" className="mt-2" loading={busyRow === row.itemId} loadingText="正在起草…" disabled={busyRow !== null} onClick={() => void chaseNow(g.project.id, r.inquiryId, row)} data-testid="rfq-tracker-chase-now">
                            现在就催
                          </Button>
                        ) : null}
                        {notes[row.itemId] ? <p className="mt-1 text-[11px] text-muted" data-testid="rfq-tracker-note">{notes[row.itemId]}</p> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
