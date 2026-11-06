"use client";

/**
 * P2-0b — 组织级竞争对手（READ-ONLY）。
 * 来源 = canonical 授标事实：项目里人工确认的上一轮中标方 + 标记「未中标」时填写的中标方。
 * 已确认与线索分开；我方中标不在这里；不出现合计金额或中标概率。
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import {
  AwardRecordsTable,
  SearchBox,
  matchesQuery,
  useOrgIntelProfiles,
} from "@/components/tender-intel/org-profile-parts";

export default function IntelCompetitorsPage() {
  const { data, busy, err, ambiguous } = useOrgIntelProfiles();
  const [q, setQ] = useState("");
  const list = useMemo(
    () => (data?.competitors ?? []).filter((c) => matchesQuery(c.name, q)),
    [data, q],
  );

  if (data && !data.awardsAvailable) {
    return (
      <IntelHubShell title="竞争对手">
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)] space-y-2">
          <p>组织授标情报尚未启用，暂时没有竞争对手数据。</p>
          <p>项目内的「历史授标检索」与人工确认照常可用；数据层启用后这里会自动显示。</p>
        </div>
      </IntelHubShell>
    );
  }

  const confirmed = data?.competitors.filter((c) => c.status === "CONFIRMED").length ?? 0;
  const leadsOnly = (data?.competitors.length ?? 0) - confirmed;

  return (
    <IntelHubShell title="竞争对手">
      <div className="space-y-4" data-testid="intel-competitors">
        {busy && !data ? (
          <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 size={14} className="animate-spin" /> 加载中…
          </p>
        ) : null}
        {err && <p className="text-sm text-red-500">{err}</p>}
        {ambiguous && (
          <p className="text-sm text-[var(--muted)]">您属于多个组织，请先在组织切换器中选择当前组织。</p>
        )}

        {data && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
            <span>
              共 <b className="text-[var(--foreground)]">{data.competitors.length}</b> 家对手
            </span>
            <span>已确认 {confirmed}</span>
            <span>只有线索 {leadsOnly}</span>
            {data.ownAwardCount > 0 && <span>已排除我方自己的中标记录 {data.ownAwardCount} 条</span>}
            <span className="w-full">已确认 = 人工确认或权威公开来源；线索（AI 提取 / 疑似重复）不作为事实，金额不显示。</span>
          </div>
        )}

        {data && data.competitors.length > 0 && (
          <SearchBox value={q} onChange={setQ} placeholder="按名称筛选对手" />
        )}

        {data && data.competitors.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)] space-y-2">
            <p>还没有竞争对手记录。下面两种操作会产生：</p>
            <p>① 在招标项目的「历史授标检索」里人工确认上一轮中标方；</p>
            <p>② 标记招标结果为「未中标」时，填写中标方（选填）。</p>
          </div>
        )}

        {list.map((c) => (
          <div key={c.key} className="rounded-xl border border-[var(--border)] p-4 text-sm space-y-2" data-testid="competitor-card">
            <div className="flex flex-wrap items-center gap-2">
              <b>{c.name}</b>
              {c.status === "CONFIRMED" ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">已确认</span>
              ) : (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">线索·未确认</span>
              )}
            </div>
            <p className="text-xs text-[var(--muted)]">
              已确认中标 {c.confirmedAwards} 次
              {c.leadAwards > 0 ? ` · 线索 ${c.leadAwards} 条` : ""}
              {c.lastAwardDate ? ` · 最近 ${c.lastAwardDate}` : ""}
            </p>
            {c.buyers.length > 0 && (
              <p className="text-xs text-[var(--muted)]">
                中过标的采购机构：
                {c.buyers
                  .slice(0, 3)
                  .map((b) => `${b.name}（${b.count}）`)
                  .join("、")}
                {c.buyers.length > 3 ? ` 等 ${c.buyers.length} 个` : ""}
              </p>
            )}
            <details>
              <summary className="cursor-pointer text-xs text-[var(--accent)]">查看 {c.awards.length} 条授标记录</summary>
              <div className="mt-2">
                <AwardRecordsTable awards={c.awards} column="buyer" />
              </div>
            </details>
          </div>
        ))}

        {data && data.competitors.length > 0 && list.length === 0 && (
          <p className="text-sm text-[var(--muted)]">没有名称包含「{q.trim()}」的对手。</p>
        )}
      </div>
    </IntelHubShell>
  );
}
