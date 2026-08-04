"use client";

import { useEffect, useState } from "react";
import { Activity, Clock3, Loader2, Target, Trophy } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";

type Group = {
  key: string;
  name?: string;
  created: number;
  completed: number;
  completionRate: number | null;
  assistedWins: number;
  assistedWinRate: number | null;
  medianResponseHours: number | null;
};

type Effectiveness = {
  days: number;
  scope: "own" | "organization";
  overview: {
    created: number;
    active: number;
    overdue: number;
    completed: number;
    autoResolved: number;
    completionRate: number | null;
    medianResponseHours: number | null;
    assistedWins: number;
  };
  signals: Group[];
  team: Group[];
};

const SIGNAL_LABELS: Record<string, string> = {
  overdue_followup: "跟进到期",
  viewed_not_signed: "已查看未签约",
  quote_pending: "报价未回复",
  new_lead_stale: "新线索未联系",
  stale_opportunity: "商机长期无互动",
};

function rate(value: number | null) {
  return value == null ? "—" : `${value}%`;
}

export function SalesActionEffectivenessCard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Effectiveness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    apiJson<Effectiveness>(`/api/sales/actions/effectiveness?days=${days}`)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <section className="rounded-xl border border-border bg-card-bg/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Activity size={16} className="text-accent" />数字员工行动效果
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            衡量响应、处理与商机推进，不把自动收口计入人工完成率
          </p>
        </div>
        <div className="flex rounded-lg border border-border p-0.5 text-xs">
          {[7, 30, 90].map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => setDays(value)}
              className={`rounded-md px-2.5 py-1 ${days === value ? "bg-accent text-white" : "text-muted-foreground"}`}
            >
              {value}天
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          行动效果暂时无法加载，请稍后重试。
        </p>
      ) : loading || !data ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-muted-foreground" size={20} />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "行动完成率", value: rate(data.overview.completionRate), detail: `${data.overview.completed} 项已完成`, icon: Target },
              { label: "中位响应时间", value: data.overview.medianResponseHours == null ? "—" : `${data.overview.medianResponseHours}h`, detail: "从创建到开始处理", icon: Clock3 },
              { label: "辅助签约", value: data.overview.assistedWins, detail: "有行动记录的签约商机", icon: Trophy },
              { label: "当前逾期", value: data.overview.overdue, detail: `${data.overview.active} 项仍在处理`, icon: Activity },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-background/50 p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <item.icon size={13} />{item.label}
                </div>
                <div className="mt-1 text-xl font-bold">{item.value}</div>
                <div className="text-[10px] text-muted-foreground">{item.detail}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-semibold">信号效果</h4>
              <div className="space-y-2">
                {data.signals.length === 0 && (
                  <p className="rounded-lg bg-background/50 px-3 py-5 text-center text-xs text-muted-foreground">
                    当前周期还没有行动数据
                  </p>
                )}
                {data.signals.slice(0, 6).map((row) => (
                  <div key={row.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg bg-background/50 px-3 py-2 text-xs">
                    <span>{SIGNAL_LABELS[row.key] ?? row.key}</span>
                    <span className="text-muted-foreground">完成 {rate(row.completionRate)}</span>
                    <span className="font-medium text-emerald-700">签约 {row.assistedWins}</span>
                  </div>
                ))}
              </div>
            </div>
            {data.scope === "organization" && (
              <div>
                <h4 className="mb-2 text-xs font-semibold">团队响应</h4>
                <div className="space-y-2">
                  {data.team.length === 0 && (
                    <p className="rounded-lg bg-background/50 px-3 py-5 text-center text-xs text-muted-foreground">
                      当前周期还没有团队行动数据
                    </p>
                  )}
                  {data.team.slice(0, 6).map((row) => (
                    <div key={row.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg bg-background/50 px-3 py-2 text-xs">
                      <span>{row.name}</span>
                      <span className="text-muted-foreground">
                        响应 {row.medianResponseHours == null ? "—" : `${row.medianResponseHours}h`}
                      </span>
                      <span className="font-medium">完成 {rate(row.completionRate)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
