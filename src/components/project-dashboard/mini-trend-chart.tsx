"use client";

import { cn } from "@/lib/utils";
import type { TrendPoint } from "@/lib/project-dashboard/types";

interface MiniTrendChartProps {
  data: TrendPoint[];
  title: string;
  color?: string;
  height?: number;
  type?: "line" | "bar";
  valueLabel?: string;
}

export function MiniTrendChart({
  data,
  title,
  color = "var(--color-accent)",
  height = 120,
  type = "line",
  valueLabel,
}: MiniTrendChartProps) {
  if (!data.length) {
    return (
      <div className="rounded-xl border border-border bg-card-bg p-4">
        <h4 className="text-xs font-medium text-muted">{title}</h4>
        <div
          className="mt-2 flex items-center justify-center text-xs text-muted"
          style={{ height }}
        >
          暂无数据
        </div>
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const maxVal = Math.max(...values, 1);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || 1;

  const total = values.reduce((s, v) => s + v, 0);
  const avg = data.length > 0 ? Math.round((total / data.length) * 10) / 10 : 0;

  const W = 100;
  const H = 100;
  const padT = 8;
  const padB = 4;
  const usableH = H - padT - padB;

  function toY(v: number): number {
    return padT + usableH - ((v - minVal) / range) * usableH;
  }

  if (type === "bar") {
    const barW = W / data.length;
    const gap = barW * 0.2;
    return (
      <div className="rounded-xl border border-border bg-card-bg p-4">
        <div className="flex items-baseline justify-between">
          <h4 className="text-xs font-medium text-muted">{title}</h4>
          <span className="text-xs text-muted">
            合计 <span className="font-semibold text-foreground">{total}</span>
            {valueLabel && ` ${valueLabel}`}
          </span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="mt-2 w-full"
          style={{ height }}
        >
          {data.map((d, i) => {
            const bh = maxVal > 0 ? ((d.value / maxVal) * usableH) : 0;
            const x = i * barW + gap / 2;
            const y = padT + usableH - bh;
            return (
              <g key={d.date}>
                <rect
                  x={x}
                  y={y}
                  width={barW - gap}
                  height={bh}
                  rx={1}
                  fill={color}
                  opacity={0.7}
                  className="transition-opacity hover:opacity-100"
                />
              </g>
            );
          })}
          <line
            x1={0} y1={padT + usableH}
            x2={W} y2={padT + usableH}
            stroke="var(--color-border)" strokeWidth={0.5}
          />
        </svg>
        <div className="mt-1 flex justify-between text-[10px] text-muted/60">
          <span>{formatLabel(data[0]?.date)}</span>
          <span>{formatLabel(data[data.length - 1]?.date)}</span>
        </div>
      </div>
    );
  }

  const points = data.map((d, i) => {
    const x = data.length > 1 ? (i / (data.length - 1)) * W : W / 2;
    const y = toY(d.value);
    return `${x},${y}`;
  });
  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${W},${padT + usableH} L0,${padT + usableH} Z`;

  return (
    <div className="rounded-xl border border-border bg-card-bg p-4">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-medium text-muted">{title}</h4>
        <span className="text-xs text-muted">
          均值 <span className="font-semibold text-foreground">{avg}</span>
          {valueLabel && ` ${valueLabel}`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-2 w-full"
        style={{ height }}
      >
        <defs>
          <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.15} />
            <stop offset="100%" stopColor={color} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#grad-${title})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => {
          const x = data.length > 1 ? (i / (data.length - 1)) * W : W / 2;
          const y = toY(d.value);
          return (
            <circle
              key={d.date}
              cx={x} cy={y} r={1.5}
              fill="var(--color-background)" stroke={color} strokeWidth={1}
              className={cn("opacity-0 transition-opacity", data.length <= 10 && "opacity-100")}
            />
          );
        })}
        <line
          x1={0} y1={padT + usableH}
          x2={W} y2={padT + usableH}
          stroke="var(--color-border)" strokeWidth={0.5}
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted/60">
        <span>{formatLabel(data[0]?.date)}</span>
        <span>{formatLabel(data[data.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

function formatLabel(dateStr?: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  return `${parts[1]}/${parts[2]}`;
}
