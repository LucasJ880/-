"use client";

/**
 * P2-0b — 组织级采购机构（READ-ONLY）。
 * 两个来源并排：canonical 授标事实（谁中过标、采购周期）+ 我方在该机构的招标项目（只统计当前用户可见的项目）。
 * 我方中标在中标方列表里标「我方」；周期只属于 买家×可比范围组，样本不够就写「可比数据不足」。
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import {
  AwardRecordsTable,
  SearchBox,
  matchesQuery,
  useOrgIntelProfiles,
} from "@/components/tender-intel/org-profile-parts";
import type { AgencyProfile, OurBidOutcome } from "@/lib/tender-intel/org-profiles";

const OUTCOME_LABEL: Record<OurBidOutcome, string> = {
  won: "中标",
  lost: "未中标",
  no_bid: "未投",
  cancelled: "取消",
  open: "进行中",
};

function ourBidsLine(b: AgencyProfile["ourBids"]): string {
  if (b.total === 0) return "我方还没有该机构的招标项目";
  const parts = [
    b.won ? `中标 ${b.won}` : null,
    b.lost ? `未中标 ${b.lost}` : null,
    b.noBid ? `未投 ${b.noBid}` : null,
    b.cancelled ? `取消 ${b.cancelled}` : null,
    b.open ? `进行中 ${b.open}` : null,
  ].filter(Boolean);
  return `我方项目 ${b.total} 个（${parts.join(" · ")}）`;
}

function cycleLine(c: AgencyProfile["awards"]["cycle"]): string {
  if (c.medianIntervalDays == null) return "采购周期：可比数据不足";
  return `同类采购间隔中位约 ${Math.round(c.medianIntervalDays)} 天（可比样本 ${c.sampleSize}${c.status === "LOW_CONFIDENCE" ? "·低置信" : ""}）`;
}

export default function IntelAgenciesPage() {
  const { data, busy, err, ambiguous } = useOrgIntelProfiles();
  const [q, setQ] = useState("");
  const list = useMemo(
    () => (data?.agencies ?? []).filter((a) => matchesQuery(a.name, q)),
    [data, q],
  );

  return (
    <IntelHubShell title="采购机构">
      <div className="space-y-4" data-testid="intel-agencies">
        {busy && !data ? (
          <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 size={14} className="animate-spin" /> 加载中…
          </p>
        ) : null}
        {err && <p className="text-sm text-red-500">{err}</p>}
        {ambiguous && (
          <p className="text-sm text-[var(--muted)]">您属于多个组织，请先在组织切换器中选择当前组织。</p>
        )}

        {data && !data.awardsAvailable && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            组织授标情报尚未启用：下面只显示我方项目，中标方与采购周期暂不可用。
          </p>
        )}

        {data && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
            <span>
              共 <b className="text-[var(--foreground)]">{data.agencies.length}</b> 个采购机构
            </span>
            <span>机构名按同一规则合并（大小写、标点、公司后缀不同算同一个）</span>
            {data.projectsTruncated && <span>项目较多，只统计最近更新的 500 个</span>}
          </div>
        )}

        {data && data.agencies.length > 0 && (
          <SearchBox value={q} onChange={setQ} placeholder="按名称筛选机构" />
        )}

        {data && data.agencies.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)] space-y-2">
            <p>还没有采购机构记录。</p>
            <p>招标项目填了「采购方」，或者确认过授标事实之后，机构会出现在这里。</p>
          </div>
        )}

        {list.map((a) => (
          <div key={a.key} className="rounded-xl border border-[var(--border)] p-4 text-sm space-y-2" data-testid="agency-card">
            <b>{a.name}</b>
            <p className="text-xs text-[var(--muted)]">{ourBidsLine(a.ourBids)}</p>
            {data?.awardsAvailable && a.awards.total === 0 && (
              <p className="text-xs text-[var(--muted)]">还没有该机构的授标记录</p>
            )}
            {data?.awardsAvailable && a.awards.total > 0 && (
              <>
                <p className="text-xs text-[var(--muted)]">
                  授标记录 {a.awards.total} 条（已确认 {a.awards.authoritative}
                  {a.awards.leads > 0 ? ` · 线索 ${a.awards.leads}` : ""}）
                  {a.awards.lastAwardDate ? ` · 最近授标 ${a.awards.lastAwardDate}` : ""}
                </p>
                {a.awards.winners.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <span className="text-[var(--muted)]">中标方：</span>
                    {a.awards.winners.map((w) => (
                      <span
                        key={w.name}
                        className={`rounded-full border px-2 py-0.5 ${
                          w.isOwn ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)]"
                        } ${w.confirmed === 0 ? "opacity-70" : ""}`}
                      >
                        {w.isOwn ? "我方 · " : ""}
                        {w.name} {w.count}
                        {w.confirmed === 0 ? "（线索）" : ""}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-[var(--muted)]">{cycleLine(a.awards.cycle)}</p>
              </>
            )}
            {(a.ourBids.recent.length > 0 || a.awards.records.length > 0) && (
              <details>
                <summary className="cursor-pointer text-xs text-[var(--accent)]">查看项目与授标记录</summary>
                <div className="mt-2 space-y-2">
                  {a.ourBids.recent.length > 0 && (
                    <ul className="space-y-1 text-xs">
                      {a.ourBids.recent.map((p) => (
                        <li key={p.id}>
                          <Link href={`/projects/${p.id}`} className="text-[var(--accent)] hover:underline">
                            {p.name}
                          </Link>
                          {p.solicitationNumber ? <span className="text-[var(--muted)]"> · {p.solicitationNumber}</span> : null}
                          <span className="text-[var(--muted)]"> · {OUTCOME_LABEL[p.outcome]}</span>
                        </li>
                      ))}
                      {a.ourBids.total > a.ourBids.recent.length && (
                        <li className="text-[var(--muted)]">另有 {a.ourBids.total - a.ourBids.recent.length} 个较早的项目</li>
                      )}
                    </ul>
                  )}
                  {data?.awardsAvailable && a.awards.total > 0 && <AwardRecordsTable awards={a.awards.records} column="winner" />}
                </div>
              </details>
            )}
          </div>
        ))}

        {data && data.agencies.length > 0 && list.length === 0 && (
          <p className="text-sm text-[var(--muted)]">没有名称包含「{q.trim()}」的机构。</p>
        )}
      </div>
    </IntelHubShell>
  );
}
