"use client";

/**
 * 情报阶段1 — 七个情报槽位接 T4 组织级授标情报投影（/api/org/tender-awards）。
 *
 * 之前是静态「建设中」占位；现在五个域渲染真实确定性投影
 * （历史中标 / 采购机构画像 / 竞争对手 / 可比价格 / 采购周期），
 * 带证据分级徽标（CONFIRMED/SUPPORTED/INFERRED/UNKNOWN）与「为什么没数据」
 * 的诚实原因——投影层铁律（样本不足=UNKNOWN、币种不合并、NEEDS_REVIEW 不进数字）
 * 由 deriveAwardIntelligence 保证，本组件绝不二次计算数字。
 * 供应链 / AI 投标策略两槽保留建设中，注明依赖（M3 海关数据源 / ≥4 域有数据）。
 */

import { useEffect, useState } from "react";
import { Radar } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";

type DomainStatus = "CONFIRMED" | "SUPPORTED" | "INFERRED" | "UNKNOWN";

type Intelligence = {
  basis: { totalRecords: number; authoritative: number; aiOnly: number; needsReview: number };
  historicalAwards: {
    status: DomainStatus;
    records: Array<{
      id: string;
      buyerName: string | null;
      winnerName: string;
      awardDate: string | null;
      contractAmount: number | null;
      currency: string | null;
      verificationStatus: string;
    }>;
  };
  buyerPattern: {
    status: DomainStatus;
    buyers: Array<{
      buyerName: string;
      totalAwards: number;
      authoritative: number;
      winners: string[];
      firstAwardDate: string | null;
      lastAwardDate: string | null;
      cycle: {
        status: DomainStatus;
        reason?: string | null;
        comparableScopeKey: string | null;
        sampleSize: number;
        medianIntervalDays: number | null;
      };
    }>;
  };
  competitorSignals: {
    status: DomainStatus;
    confirmed: Array<{ name: string; awardCount: number; lastAwardDate: string | null }>;
    signals: Array<{ name: string; mentionCount: number }>;
  };
  historicalValues: {
    status: DomainStatus;
    reason: string | null;
    byCurrency: Array<{ currency: string; sampleSize: number; min: number; max: number; median: number }>;
  };
  comparablePricing: {
    status: DomainStatus;
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
  supplyChain: { status: DomainStatus; reason?: string | null };
};

const STATUS_STYLE: Record<DomainStatus, string> = {
  CONFIRMED: "border-emerald-300 bg-emerald-50 text-emerald-700",
  SUPPORTED: "border-sky-300 bg-sky-50 text-sky-700",
  INFERRED: "border-amber-300 bg-amber-50 text-amber-700",
  UNKNOWN: "border-border bg-background/60 text-muted",
};
const STATUS_LABEL: Record<DomainStatus, string> = {
  CONFIRMED: "已确认",
  SUPPORTED: "有依据",
  INFERRED: "AI 推断",
  UNKNOWN: "暂无数据",
};

function StatusBadge({ status }: { status: DomainStatus }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] ${STATUS_STYLE[status]}`}
      data-status={status}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function money(n: number, currency: string): string {
  return `${currency === "UNSPECIFIED" ? "" : `${currency} `}${n.toLocaleString()}`;
}

function Slot({
  slotKey,
  title,
  status,
  children,
}: {
  slotKey: string;
  title: string;
  status: DomainStatus | null;
  children: React.ReactNode;
}) {
  return (
    <div
      data-intel-slot={slotKey}
      className="rounded-xl border border-border/70 bg-background/40 p-4"
    >
      <p className="flex items-center justify-between gap-2 text-sm font-medium text-foreground/80">
        {title}
        {status ? <StatusBadge status={status} /> : null}
      </p>
      <div className="mt-1.5 space-y-1 text-xs text-muted">{children}</div>
    </div>
  );
}

type BidStrategyAuto = {
  strategyZh: string;
  keyPoints: Array<{ pointZh: string; basedOn: string }>;
  dataGapsZh: string;
  label: string;
  generatedAt: string;
};

/** 与 corporate-memory/normalize 同源的轻量归一（客户端相关性分层用） */
function normBuyer(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function OrgAwardIntelSlots({
  orgId,
  projectId,
  buyerName,
}: {
  orgId: string | null;
  projectId?: string | null;
  /** 本项目采购方（相关性分层：同买家记录优先，其余折叠为组织库存） */
  buyerName?: string | null;
}) {
  const [intel, setIntel] = useState<Intelligence | null>(null);
  const [failed, setFailed] = useState(false);
  const [strategy, setStrategy] = useState<BidStrategyAuto | null>(null);

  useEffect(() => {
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    apiJson<{ available?: boolean; intelligence?: Intelligence }>(
      `/api/org/tender-awards${qs}`,
    )
      .then((res) => {
        if (res.available && res.intelligence) setIntel(res.intelligence);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [orgId]);

  // 情报自动流（包6）：项目级 AI 策略草案（分析完成后自动生成，AI_INFERRED）
  useEffect(() => {
    if (!projectId) return;
    apiJson<{ bidStrategyAuto?: BidStrategyAuto | null }>(
      `/api/projects/${projectId}/external-intel/award-history`,
    )
      .then((res) => setStrategy(res.bidStrategyAuto ?? null))
      .catch(() => {});
  }, [projectId]);

  const empty = (hint: string) => <p>{hint}</p>;
  const basisNote =
    intel && intel.basis.totalRecords > 0
      ? `基于 ${intel.basis.totalRecords} 条授标记录（权威 ${intel.basis.authoritative} 条）`
      : "尚无授标记录——在外部情报面板确认候选、或标记我方投标结果后，这里开始积累";

  return (
    <section className="space-y-3" data-testid="intel-future-slots">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Radar size={16} className="text-accent/60" />
        企业历史情报
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-normal text-muted">
          组织级 · 跨项目累积
        </span>
      </h3>
      <p className="text-xs text-muted">
        {failed ? "组织级授标情报暂不可用（T4 未启用或加载失败）" : basisNote}
        ；权威公开数据（带编号的政府披露）自动入库，人工确认可将候选升级为「已确认」；所有统计数字仅来自权威记录（人工确认/系统核验），样本不足时如实显示暂无。
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Slot
          slotKey="historical_awards"
          title="历史中标"
          status={intel?.historicalAwards.status ?? null}
        >
          {(() => {
            const records = intel?.historicalAwards.records ?? [];
            if (records.length === 0)
              return empty("确认外部候选或标记我方中标后出现");
            // 相关性分层：同买家（本项目采购方）优先，其余折叠为组织库存
            const projNorm = normBuyer(buyerName);
            const related = projNorm
              ? records.filter((r) => normBuyer(r.buyerName) === projNorm)
              : [];
            const rest = records.filter((r) => !related.includes(r));
            const row = (r: (typeof records)[number]) => (
              <p key={r.id} className="truncate">
                <b className="text-foreground/70">{r.winnerName}</b>
                {` ← ${r.buyerName ?? "买家未知"}`}
                {r.contractAmount != null
                  ? ` · ${money(r.contractAmount, r.currency ?? "UNSPECIFIED")}`
                  : ""}
                {r.awardDate ? ` · ${r.awardDate}` : ""}
                <span className="ml-1 rounded-full border border-border px-1.5 text-[9px] text-muted">
                  {r.verificationStatus === "HUMAN_CONFIRMED"
                    ? "已确认"
                    : r.verificationStatus === "SYSTEM_VERIFIED"
                      ? "系统核验"
                      : "待核"}
                </span>
              </p>
            );
            return (
              <>
                {related.slice(0, 4).map(row)}
                {related.length === 0 ? (
                  <p className="text-muted/80">本项目采购方暂无相关历史授标</p>
                ) : null}
                {rest.length > 0 ? (
                  <details>
                    <summary className="cursor-pointer text-muted/80">
                      组织授标库另有 {rest.length} 条（其它买家/项目）
                    </summary>
                    <div className="mt-1 space-y-1">{rest.slice(0, 4).map(row)}</div>
                  </details>
                ) : null}
              </>
            );
          })()}
        </Slot>

        <Slot
          slotKey="buyer_history"
          title="采购机构画像"
          status={intel?.buyerPattern.status ?? null}
        >
          {intel && intel.buyerPattern.buyers.length > 0
            ? intel.buyerPattern.buyers.slice(0, 3).map((b) => (
                <p key={b.buyerName} className="truncate">
                  <b className="text-foreground/70">{b.buyerName}</b> · {b.totalAwards} 次授标
                  {b.winners.length > 0 ? ` · 中标方 ${b.winners.slice(0, 2).join("、")}` : ""}
                </p>
              ))
            : empty("授标记录带买家信息后自动聚合")}
        </Slot>

        <Slot
          slotKey="comparable_prices"
          title="可比价格"
          status={intel?.comparablePricing.status ?? null}
        >
          {intel && intel.comparablePricing.groups.length > 0 ? (
            intel.comparablePricing.groups.slice(0, 2).map((g) => (
              <p key={`${g.buyerName}-${g.comparableScopeKey}`} className="truncate">
                {g.buyerName}「{g.comparableScopeKey}」：{money(g.min, g.currency)} –{" "}
                {money(g.max, g.currency)}（中位 {money(g.median, g.currency)}，n={g.sampleSize}）
              </p>
            ))
          ) : intel && intel.historicalValues.byCurrency.length > 0 ? (
            <>
              {intel.historicalValues.byCurrency.slice(0, 2).map((c) => (
                <p key={c.currency}>
                  历史金额（仅记录汇总，不可直接对标）：{money(c.min, c.currency)} –{" "}
                  {money(c.max, c.currency)}（n={c.sampleSize}）
                </p>
              ))}
              <p>{intel.comparablePricing.reason}</p>
            </>
          ) : (
            empty(intel?.comparablePricing.reason ?? "带金额的权威授标记录积累后出现")
          )}
        </Slot>

        <Slot
          slotKey="competitors"
          title="竞争对手"
          status={intel?.competitorSignals.status ?? null}
        >
          {intel &&
          (intel.competitorSignals.confirmed.length > 0 ||
            intel.competitorSignals.signals.length > 0) ? (
            <>
              {intel.competitorSignals.confirmed.slice(0, 3).map((c) => (
                <p key={c.name} className="truncate">
                  <b className="text-foreground/70">{c.name}</b> · 中标 {c.awardCount} 次
                  {c.lastAwardDate ? ` · 最近 ${c.lastAwardDate}` : ""}
                </p>
              ))}
              {intel.competitorSignals.signals.slice(0, 2).map((s) => (
                <p key={s.name} className="truncate">
                  线索：{s.name}（{s.mentionCount} 次提及，未确认）
                </p>
              ))}
            </>
          ) : (
            empty("确认历史授标中标方后建立对手档案")
          )}
        </Slot>

        <Slot
          slotKey="procurement_cycle"
          title="采购周期"
          status={
            intel
              ? (intel.buyerPattern.buyers.find((b) => b.cycle.status !== "UNKNOWN")
                  ?.cycle.status ?? "UNKNOWN")
              : null
          }
        >
          {intel &&
          intel.buyerPattern.buyers.some((b) => b.cycle.status !== "UNKNOWN")
            ? intel.buyerPattern.buyers
                .filter((b) => b.cycle.status !== "UNKNOWN")
                .slice(0, 2)
                .map((b) => (
                  <p key={b.buyerName} className="truncate">
                    {b.buyerName}「{b.cycle.comparableScopeKey}」：约每{" "}
                    {b.cycle.medianIntervalDays} 天（n={b.cycle.sampleSize}）
                  </p>
                ))
            : empty(
                "周期只按「同一买家 × 同类采购范围」推算，样本 ≥3 才给出——绝不输出假周期",
              )}
        </Slot>

        <Slot slotKey="supply_chain" title="供应链情报" status={intel?.supplyChain.status ?? null}>
          {empty("规划中：M3 海关数据源（Trade 域证据只读引用）接入后启用")}
        </Slot>

        <Slot
          slotKey="bid_strategy"
          title="AI 投标策略"
          status={strategy ? "INFERRED" : null}
        >
          {strategy ? (
            <>
              <p className="text-foreground/70">{strategy.strategyZh}</p>
              {strategy.keyPoints.slice(0, 4).map((k, i) => (
                <p key={i} className="truncate">
                  · {k.pointZh}
                  <span className="text-muted/70">（依据：{k.basedOn}）</span>
                </p>
              ))}
              {strategy.dataGapsZh ? (
                <p className="text-muted/80">数据缺口：{strategy.dataGapsZh}</p>
              ) : null}
              <p className="text-[10px] text-muted/60">
                AI 推断草案，仅供人工评审——不构成 GO/NO-GO 决定
              </p>
            </>
          ) : (
            empty("分析完成后自动生成策略草案（AI 推断，人审语义）")
          )}
        </Slot>
      </div>
    </section>
  );
}
