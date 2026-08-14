"use client";

/**
 * T4 — 组织历史授标（READ-ONLY 组织级 canonical 情报）。
 * 数据源 = AwardRecord（人工确认/权威公开来源沉淀），不是项目级调查室草稿。
 * P0 是数据是真的：每行带 verificationStatus 分层 + 来源可核验；不做花哨 dashboard。
 */

import { useCallback, useEffect, useState } from "react";
import { Landmark, Loader2 } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";
import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

type AwardRow = {
  id: string;
  buyerName: string | null;
  winnerName: string;
  solicitationNumber: string | null;
  awardDate: string | null;
  contractAmount: number | null;
  currency: string | null;
  scopeSummary: string | null;
  verificationStatus: string;
  status: string;
  projectId: string | null;
};

type Intelligence = {
  basis: { totalRecords: number; authoritative: number; aiOnly: number; needsReview: number };
  buyerPattern: {
    buyers: Array<{
      buyerName: string;
      totalAwards: number;
      authoritative: number;
      cycle: {
        status: string;
        reason: string | null;
        sampleSize: number;
        medianIntervalDays: number | null;
      };
    }>;
  };
  historicalValues: {
    label: string;
    comparability: string;
    byCurrency: Array<{ currency: string; sampleSize: number; min: number; max: number; median: number }>;
  };
  comparablePricing: {
    status: string;
    reason: string | null;
    groups: Array<{
      buyerName: string;
      comparableScopeKey: string;
      currency: string;
      sampleSize: number;
      min: number;
      max: number;
      median: number;
    }>;
  };
  competitorSignals: {
    confirmed: Array<{ name: string; awardCount: number; lastAwardDate: string | null }>;
    signals: Array<{ name: string; mentionCount: number }>;
  };
};

const VERIFICATION_LABEL: Record<string, { text: string; cls: string }> = {
  HUMAN_CONFIRMED: { text: "人工确认", cls: "bg-emerald-500/10 text-emerald-600" },
  SYSTEM_VERIFIED: { text: "权威公开来源", cls: "bg-sky-500/10 text-sky-600" },
  AI_EXTRACTED: { text: "AI 提取·待确认", cls: "bg-amber-500/10 text-amber-600" },
  NEEDS_REVIEW: { text: "待人工复核", cls: "bg-orange-500/10 text-orange-600" },
};

function fmtAmount(v: number | null, currency: string | null): string {
  if (v == null) return "—";
  return `${currency ?? ""} ${v.toLocaleString()}`.trim();
}

export default function IntelAwardsPage() {
  const { orgId, ambiguous } = useCurrentOrgId();
  const [rows, setRows] = useState<AwardRow[]>([]);
  const [intel, setIntel] = useState<Intelligence | null>(null);
  const [buyer, setBuyer] = useState("");
  const [winner, setWinner] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notEnabled, setNotEnabled] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("orgId", orgId);
      if (buyer.trim()) params.set("buyer", buyer.trim());
      if (winner.trim()) params.set("winner", winner.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      const res = await apiJson<{
        available: boolean;
        reason?: string;
        records: AwardRow[];
        intelligence: Intelligence | null;
      }>(`/api/org/tender-awards${qs ? `?${qs}` : ""}`);
      setNotEnabled(res.available === false);
      setRows(res.records);
      setIntel(res.intelligence);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
    setBusy(false);
  }, [orgId, buyer, winner, from, to]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  if (notEnabled) {
    return (
      <IntelHubShell title="历史中标">
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)] space-y-2">
          <p>组织授标情报尚未启用。</p>
          <p>项目内的「历史授标检索」与人工确认照常可用；组织级沉淀将在数据层启用后自动开放。</p>
        </div>
      </IntelHubShell>
    );
  }

  return (
    <IntelHubShell title="历史中标">
      <div className="space-y-4">
        {/* 统计条：证据基础诚实展示（周期属于买家×可比范围，绝无组织级周期数字） */}
        {intel && (
          <div className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
            <span>
              共 <b className="text-[var(--foreground)]">{intel.basis.totalRecords}</b> 条组织授标记录
            </span>
            <span>已确认/权威 {intel.basis.authoritative}</span>
            <span>AI 待确认 {intel.basis.aiOnly}</span>
            {intel.basis.needsReview > 0 && <span>待复核（不计入统计）{intel.basis.needsReview}</span>}
            {intel.historicalValues.byCurrency.map((g) => (
              <span key={g.currency}>
                {g.currency} 历史合同金额中位 {g.median.toLocaleString()}（{g.sampleSize} 条原始记录·不可直接对标）
              </span>
            ))}
          </div>
        )}

        {/* 基础过滤：买家 / 中标方 / 时间 */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={buyer}
            onChange={(e) => setBuyer(e.target.value)}
            placeholder="按买家筛选"
            className="h-8 rounded-lg border border-[var(--border)] bg-transparent px-2 text-sm"
          />
          <input
            value={winner}
            onChange={(e) => setWinner(e.target.value)}
            placeholder="按中标方筛选"
            className="h-8 rounded-lg border border-[var(--border)] bg-transparent px-2 text-sm"
          />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 rounded-lg border border-[var(--border)] bg-transparent px-2 text-sm"
          />
          <span className="text-xs text-[var(--muted)]">至</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 rounded-lg border border-[var(--border)] bg-transparent px-2 text-sm"
          />
          <button
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--accent)] px-3 text-sm text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Landmark size={14} />}
            筛选
          </button>
        </div>

        {err && <p className="text-sm text-red-500">{err}</p>}
        {ambiguous && (
          <p className="text-sm text-[var(--muted)]">您属于多个组织，请先在组织切换器中选择当前组织。</p>
        )}

        {!busy && rows.length === 0 && !err && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)] space-y-2">
            <p>还没有组织级授标记录。</p>
            <p>
              在招标项目的「历史授标检索」里<b>人工确认</b>外部检索到的中标事实后，会自动沉淀到这里，
              供未来投标复用（买家规律 / 竞争对手 / 历史价格）。
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="px-3 py-2 font-medium">买家</th>
                  <th className="px-3 py-2 font-medium">招标/编号</th>
                  <th className="px-3 py-2 font-medium">中标方</th>
                  <th className="px-3 py-2 font-medium">金额</th>
                  <th className="px-3 py-2 font-medium">授标日期</th>
                  <th className="px-3 py-2 font-medium">可信度</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const badge = VERIFICATION_LABEL[r.verificationStatus] ?? {
                    text: r.verificationStatus,
                    cls: "bg-zinc-500/10 text-zinc-500",
                  };
                  return (
                    <tr key={r.id} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="px-3 py-2">{r.buyerName ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)]">
                        {r.solicitationNumber ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-medium">{r.winnerName}</td>
                      <td className="px-3 py-2">{fmtAmount(r.contractAmount, r.currency)}</td>
                      <td className="px-3 py-2">{r.awardDate ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>
                          {badge.text}
                          {r.status === "NEEDS_REVIEW" ? " · 疑似重复" : ""}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 按买家采购周期：周期只属于 买家×可比范围组；无可比组诚实「数据不足」 */}
        {intel && intel.buyerPattern.buyers.length > 0 && (
          <div className="rounded-xl border border-[var(--border)] p-4 text-sm space-y-1">
            <h3 className="font-semibold">按买家采购规律</h3>
            {intel.buyerPattern.buyers.map((b) => (
              <p key={b.buyerName || "(未知买家)"} className="text-xs text-[var(--muted)]">
                <b className="text-[var(--foreground)]">{b.buyerName || "（买家未知）"}</b>
                ：历史 {b.totalAwards} 条（权威 {b.authoritative}）·{" "}
                {b.cycle.medianIntervalDays != null
                  ? `同类采购间隔中位 ${b.cycle.medianIntervalDays} 天（可比样本 ${b.cycle.sampleSize}${b.cycle.status === "LOW_CONFIDENCE" ? "·低置信" : ""}）`
                  : "采购周期：可比数据不足"}
              </p>
            ))}
          </div>
        )}

        {/* 可比价格：仅 买家×可比范围×币种 组内样本足够才展示；否则诚实说明 */}
        {intel && (
          <div className="rounded-xl border border-[var(--border)] p-4 text-sm space-y-1">
            <h3 className="font-semibold">可比价格参考</h3>
            {intel.comparablePricing.groups.length > 0 ? (
              intel.comparablePricing.groups.map((g) => (
                <p key={`${g.buyerName}-${g.comparableScopeKey}-${g.currency}`} className="text-xs text-[var(--muted)]">
                  <b className="text-[var(--foreground)]">{g.buyerName}</b> · {g.comparableScopeKey}：
                  {g.currency} {g.min.toLocaleString()} ~ {g.max.toLocaleString()}，中位{" "}
                  {g.median.toLocaleString()}（可比样本 {g.sampleSize}）
                </p>
              ))
            ) : (
              <p className="text-xs text-[var(--muted)]">
                暂无可比价格组（不同买家/范围/币种的历史金额不可直接比较）。上方历史合同金额仅为原始记录汇总，不代表当前目标价。
              </p>
            )}
          </div>
        )}

        {/* 竞争对手：confirmed 与线索永不混排 */}
        {intel && (intel.competitorSignals.confirmed.length > 0 || intel.competitorSignals.signals.length > 0) && (
          <div className="rounded-xl border border-[var(--border)] p-4 text-sm">
            <h3 className="font-semibold">竞争对手（来自授标事实）</h3>
            {intel.competitorSignals.confirmed.length > 0 && (
              <p className="mt-2">
                已确认：
                {intel.competitorSignals.confirmed
                  .map((c) => `${c.name}（${c.awardCount} 次中标${c.lastAwardDate ? `，最近 ${c.lastAwardDate}` : ""}）`)
                  .join("、")}
              </p>
            )}
            {intel.competitorSignals.signals.length > 0 && (
              <p className="mt-1 text-xs text-[var(--muted)]">
                线索（未确认，不作为事实）：
                {intel.competitorSignals.signals.map((s) => s.name).join("、")}
              </p>
            )}
          </div>
        )}
      </div>
    </IntelHubShell>
  );
}
