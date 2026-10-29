"use client";

/**
 * 销售期间面板（KPI-1 · spec sales/period-summary"看板展示"）
 *
 * 数据：GET /api/sales/period-summary（sales.analytics.read）。403 时整块不渲染，首页其余部分不受影响。
 * 期间写在 URL 查询参数 from / to / compare，刷新后保留。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { formatSalesMoney } from "@/lib/sales/home/formatters";
import { addDaysYmd, daysInMonth, monthStartYmd } from "@/lib/sales/period/summary-pure";
import type { PeriodSummaryResponse } from "@/lib/sales/period/load";
import type { PeriodCalendarStats, PeriodTotals } from "@/lib/sales/period/types";
import type { PeriodNarrativeResponse } from "@/lib/sales/period/narrative";
import { SalesCard, SalesCardState } from "./sales-card";
import { cn } from "@/lib/utils";

type PresetKey = "mtd" | "last_month" | "qtd" | "last30" | "custom";

const PRESET_LABELS: Record<PresetKey, string> = {
  mtd: "本月至今",
  last_month: "上月",
  qtd: "本季",
  last30: "最近 30 天",
  custom: "自定义",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** 浏览器当地今天；首屏用它算预设，响应回来后以服务端 period 为准 */
function browserToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function presetRange(key: Exclude<PresetKey, "custom">, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  switch (key) {
    case "mtd":
      return { from: monthStartYmd(today), to: today };
    case "last_month": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(daysInMonth(py, pm))}` };
    }
    case "qtd": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${y}-${pad(qm)}-01`, to: today };
    }
    case "last30":
      return { from: addDaysYmd(today, -29), to: today };
  }
}

function detectPreset(from: string, to: string, today: string): PresetKey {
  for (const key of ["mtd", "last_month", "qtd", "last30"] as const) {
    const r = presetRange(key, today);
    if (r.from === from && r.to === to) return key;
  }
  return "custom";
}

function DeltaLine({ value, label }: { value: number | null | undefined; label: string }) {
  if (value === null || value === undefined) return <p className="mt-1 text-[11px] text-[var(--muted)]">{label}：无可比数据</p>;
  const pct = Math.round(value * 1000) / 10;
  return (
    <p className={cn("mt-1 text-[11px]", pct > 0 ? "text-emerald-600" : pct < 0 ? "text-rose-600" : "text-[var(--muted)]")}>
      较{label} {pct > 0 ? "+" : ""}
      {pct}%
    </p>
  );
}

function Tile({ title, value, sub, delta, cmpLabel }: { title: string; value: string; sub?: string; delta: number | null | undefined; cmpLabel: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
      <p className="text-[12px] text-[var(--muted)]">{title}</p>
      <p className="mt-1 text-[18px] font-semibold tabular-nums text-[var(--foreground)]">{value}</p>
      {sub ? <p className="text-[11px] text-[var(--muted)]">{sub}</p> : null}
      <DeltaLine value={delta} label={cmpLabel} />
    </div>
  );
}

/** 解读与看板用同一期间（服务端回显的 from / to）与对比方式 */
function narrativeQuery(from: string, to: string, compare: string): string {
  const qs = new URLSearchParams({ from, to, compare });
  return qs.toString();
}

const rate = (r: number | null) => (r === null ? "—" : `${Math.round(r * 1000) / 10}%`);

const SOURCE_LABELS = [
  ["qingyan", "青砚"],
  ["member", "成员"],
  ["website", "网站预约"],
  ["unknown", "不明"],
] as const;

const BUCKET_LABELS: Record<string, string> = { management: "管理", sales: "销售", ops: "运营", other: "其他" };

type NarrativeState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; data: PeriodNarrativeResponse }
  | { kind: "limited" }
  | { kind: "error" };

/**
 * KPI-2：AI 解读——只在用户点"生成解读"时请求；回落时不显示模型原文，以确定性洞察为准。
 * 换期间时父组件用 key 重建本组件，结果随之清空（不进 localStorage）。
 */
function NarrativeBlock({ query }: { query: string }) {
  const [st, setSt] = useState<NarrativeState>({ kind: "idle" });
  const run = async () => {
    setSt({ kind: "loading" });
    try {
      const res = await apiFetch(`/api/sales/period-summary/narrative?${query}`, { method: "POST" });
      if (res.status === 429) return setSt({ kind: "limited" });
      if (!res.ok) return setSt({ kind: "error" });
      setSt({ kind: "done", data: (await res.json()) as PeriodNarrativeResponse });
    } catch {
      setSt({ kind: "error" });
    }
  };
  const n = st.kind === "done" ? st.data.narrative : null;
  return (
    <div className="rounded-xl border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--muted)]">AI 解读（按需生成，数字只来自上方统计）</p>
        <button
          type="button"
          onClick={run}
          disabled={st.kind === "loading"}
          className="rounded-md border border-[var(--accent)] px-3 py-1 text-[12px] text-[var(--accent)] disabled:opacity-60"
        >
          {st.kind === "loading" ? "生成中…" : st.kind === "idle" ? "生成解读" : "重新生成"}
        </button>
      </div>
      {st.kind === "limited" ? <p className="mt-2 text-[13px] text-[var(--muted)]">请求过于频繁，请稍后再试。</p> : null}
      {st.kind === "error" ? <p className="mt-2 text-[13px] text-[var(--muted)]">解读暂不可用，请以上方确定性洞察为准。</p> : null}
      {st.kind === "done" && !n ? <p className="mt-2 text-[13px] text-[var(--muted)]">本次解读未通过核对，已以上方确定性洞察为准。</p> : null}
      {n ? (
        <div className="mt-2 space-y-2 text-[13px]">
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400">AI 解读 · 数字已与看板核对</p>
          <div>
            <p className="text-[12px] font-medium text-[var(--foreground)]">本期结论</p>
            {n.conclusion.map((c, i) => (
              <p key={i} className="text-[var(--foreground)]">{c}</p>
            ))}
          </div>
          {n.reasons.length > 0 ? (
            <div>
              <p className="text-[12px] font-medium text-[var(--foreground)]">原因</p>
              <ul className="list-disc pl-5">
                {n.reasons.map((r, i) => (
                  <li key={i}>{r.text}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {n.nextSteps.length > 0 ? (
            <div>
              <p className="text-[12px] font-medium text-[var(--foreground)]">下一步</p>
              <ul className="space-y-1">
                {n.nextSteps.map((step, i) => (
                  <li key={i}>
                    <span className="mr-1.5 rounded bg-[var(--background)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">{step.label}</span>
                    {step.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** CAL-1：期间内新建日程的来源分布与按成员新建数；calendar 为 null 时不渲染 */
function CalendarSourceBlock({ calendar }: { calendar: PeriodCalendarStats }) {
  const b = calendar.bySource;
  const total = b.qingyan + b.member + b.website + b.unknown;
  return (
    <div className="rounded-xl border border-[var(--border)] p-3">
      <p className="text-[12px] text-[var(--muted)]">日程来源（期间内新建，按 Google 创建时间）· 共 {total} 条</p>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        {SOURCE_LABELS.map(([key, label]) => (
          <div key={key} className="rounded-lg bg-[var(--background)] px-3 py-2">
            <p className="text-[12px] text-[var(--muted)]">{label}</p>
            <p className="text-[16px] font-semibold tabular-nums text-[var(--foreground)]">{b[key]}</p>
          </div>
        ))}
      </div>
      {calendar.byActor && calendar.byActor.length > 0 ? (
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          按成员：
          {calendar.byActor.map((a, i) => (
            <span key={a.userId}>
              {i > 0 ? "、" : ""}
              {a.name}
              {a.bucket ? `（${BUCKET_LABELS[a.bucket] ?? a.bucket}）` : ""} {a.created} 条
            </span>
          ))}
        </p>
      ) : null}
      {calendar.truncated ? <p className="mt-1 text-[12px] text-rose-600">日程账本超过上限，结果不完整，请缩短期间。</p> : null}
    </div>
  );
}

export function SalesPeriodPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";
  const urlCompare = searchParams.get("compare") === "prev_month" ? "prev_month" : "prev_period";

  const [data, setData] = useState<PeriodSummaryResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "hidden">("loading");
  const [draftFrom, setDraftFrom] = useState(urlFrom);
  const [draftTo, setDraftTo] = useState(urlTo);
  const [customOpen, setCustomOpen] = useState(false);

  const load = useCallback(async () => {
    setState((s) => (s === "hidden" ? s : "loading"));
    const qs = new URLSearchParams();
    if (urlFrom && urlTo) {
      qs.set("from", urlFrom);
      qs.set("to", urlTo);
    }
    qs.set("compare", urlCompare);
    try {
      const res = await apiFetch(`/api/sales/period-summary?${qs.toString()}`);
      if (res.status === 403) {
        setState("hidden");
        return;
      }
      if (!res.ok) throw new Error(`period-summary ${res.status}`);
      setData((await res.json()) as PeriodSummaryResponse);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [urlFrom, urlTo, urlCompare]);

  useEffect(() => {
    load();
  }, [load]);

  const writeUrl = useCallback(
    (next: { from?: string; to?: string; compare?: string }) => {
      const qs = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) qs.set(k, v);
        else qs.delete(k);
      }
      router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // 当前期间：服务端回显优先（组织时区），否则用 URL
  const shownFrom = data?.period.from ?? urlFrom;
  const shownTo = data?.period.to ?? urlTo;
  const today = browserToday();
  const active: PresetKey = useMemo(() => {
    if (!urlFrom || !urlTo) return "mtd";
    return detectPreset(urlFrom, urlTo, today);
  }, [urlFrom, urlTo, today]);

  if (state === "hidden") return null;

  const cmpLabel = urlCompare === "prev_month" ? "上月同期" : "上一期";
  const t: PeriodTotals | undefined = data?.totals;
  const d = data?.comparison.delta;
  const insights = [...(data?.insights ?? [])].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));

  const presetButtons = (
    <div className="flex flex-wrap items-center gap-1.5">
      {(["mtd", "last_month", "qtd", "last30"] as const).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => {
            setCustomOpen(false);
            if (key === "mtd") writeUrl({ from: "", to: "" });
            else writeUrl(presetRange(key, today));
          }}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[12px]",
            active === key && !customOpen ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--border)] text-[var(--muted)]",
          )}
        >
          {PRESET_LABELS[key]}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          setDraftFrom(shownFrom);
          setDraftTo(shownTo);
          setCustomOpen((v) => !v);
        }}
        className={cn(
          "rounded-full border px-2.5 py-1 text-[12px]",
          active === "custom" || customOpen ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--border)] text-[var(--muted)]",
        )}
      >
        {PRESET_LABELS.custom}
      </button>
      <select
        value={urlCompare}
        onChange={(e) => writeUrl({ compare: e.target.value === "prev_month" ? "prev_month" : "" })}
        className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-[12px] text-[var(--muted)]"
        aria-label="对比期"
      >
        <option value="prev_period">对比上一期</option>
        <option value="prev_month">对比上月同期</option>
      </select>
    </div>
  );

  return (
    <SalesCard title="期间成单与报价">
      <div className="mb-3">{presetButtons}</div>
      {customOpen ? (
        <form
          className="mb-3 flex flex-wrap items-center gap-2 text-[12px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (draftFrom && draftTo) {
              setCustomOpen(false);
              writeUrl({ from: draftFrom, to: draftTo });
            }
          }}
        >
          <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1" aria-label="开始日期" />
          <span className="text-[var(--muted)]">至</span>
          <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1" aria-label="结束日期" />
          <button type="submit" className="rounded-md bg-[var(--accent)] px-3 py-1 text-[var(--on-accent)]">
            查看
          </button>
        </form>
      ) : null}

      {state === "loading" && !data ? <SalesCardState kind="loading" message="" /> : null}
      {state === "error" ? <p className="py-2 text-[13px] text-[var(--muted)]">期间数据暂不可用（请检查日期：跨度不超过 366 天，结束日不早于开始日）。</p> : null}

      {data && t && state !== "error" ? (
        <div className={cn("space-y-4", state === "loading" && "opacity-60")}>
          <p className="text-[12px] text-[var(--muted)]">
            {data.period.from} 至 {data.period.to}（{data.period.days} 天，{data.period.timezone}）· {data.scope === "own" ? "仅本人报价" : "全企业"} · 成单按客户签字金额（含税）
          </p>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile title="成单数" value={`${t.wonCount} 单`} delta={d?.wonCount} cmpLabel={cmpLabel} />
            <Tile title="成单金额" value={formatSalesMoney(t.wonAmount)} sub={`税前 ${formatSalesMoney(t.wonPreTax)}`} delta={d?.wonAmount} cmpLabel={cmpLabel} />
            <Tile title="报价数" value={`${t.quotedCount} 份`} delta={d?.quotedCount} cmpLabel={cmpLabel} />
            <Tile title="报价金额" value={formatSalesMoney(t.quotedAmount)} delta={d?.quotedAmount} cmpLabel={cmpLabel} />
            <Tile
              title="转化率"
              value={rate(t.conversionRate)}
              sub={t.conversionRate !== null && t.conversionRate > 1 ? "同期口径：含上期发出本期签字或未经发送的签单" : `${t.wonCount} / ${t.quotedCount}`}
              delta={d?.conversionRate}
              cmpLabel={cmpLabel}
            />
            <Tile
              title="在手未签"
              value={`${t.openQuotedCount} 份 · ${formatSalesMoney(t.openQuotedAmount)}`}
              sub={`超 14 天 ${t.staleOpenCount} 份 · ${formatSalesMoney(t.staleOpenAmount)}`}
              delta={d?.openQuotedAmount}
              cmpLabel={cmpLabel}
            />
          </div>

          {data.truncated ? <p className="text-[12px] text-rose-600">数据量超过上限，结果不完整，请缩短期间。</p> : null}
          {t.nonCadExcludedCount > 0 ? <p className="text-[12px] text-[var(--muted)]">另有 {t.nonCadExcludedCount} 份非加元报价未计入。</p> : null}

          {data.calendar ? <CalendarSourceBlock calendar={data.calendar} /> : null}

          {insights.length > 0 ? (
            <ul className="space-y-1.5">
              {insights.map((i) => (
                <li key={i.code} className={cn("rounded-lg px-3 py-2 text-[13px]", i.severity === "warn" ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-sky-500/10 text-sky-800 dark:text-sky-300")}>
                  {i.text}
                </li>
              ))}
            </ul>
          ) : null}

          {data.narrativeEnabled ? (
            <NarrativeBlock key={`${data.period.from}|${data.period.to}|${urlCompare}`} query={narrativeQuery(data.period.from, data.period.to, urlCompare)} />
          ) : null}

          {data.byRep.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-[var(--muted)]">
                    <th className="py-1.5 font-normal">{data.scope === "own" ? "本人" : "销售（报价创建人）"}</th>
                    <th className="py-1.5 text-right font-normal">成单</th>
                    <th className="py-1.5 text-right font-normal">成单金额</th>
                    <th className="py-1.5 text-right font-normal">报价</th>
                    <th className="py-1.5 text-right font-normal">报价金额</th>
                    <th className="py-1.5 text-right font-normal">转化率</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byRep.map((r) => (
                    <tr key={r.userId} className="border-t border-[var(--border)]">
                      <td className="py-1.5">{r.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.wonCount}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatSalesMoney(r.wonAmount)}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.quotedCount}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatSalesMoney(r.quotedAmount)}</td>
                      <td className="py-1.5 text-right tabular-nums">{rate(r.conversionRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </SalesCard>
  );
}
