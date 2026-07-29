"use client";

import { useMemo, useState } from "react";
import { formatSalesMoney } from "@/lib/sales/home";

export function SalesMiniTrend({
  points,
}: {
  points: Array<{ date: string; signedAmount: number }>;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const { path, area, max } = useMemo(() => {
    if (!points.length) {
      return { path: "", area: "", max: 0 };
    }
    const values = points.map((p) => p.signedAmount);
    const maxVal = Math.max(...values, 1);
    const w = 280;
    const h = 56;
    const step = points.length > 1 ? w / (points.length - 1) : w;
    const coords = points.map((p, i) => {
      const x = i * step;
      const y = h - (p.signedAmount / maxVal) * (h - 4) - 2;
      return { x, y };
    });
    const line = coords
      .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(" ");
    const areaPath = `${line} L${coords[coords.length - 1]!.x},${h} L0,${h} Z`;
    return { path: line, area: areaPath, max: maxVal };
  }, [points]);

  const empty = !points.length || max === 0;

  return (
    <div className="relative mt-4">
      <svg
        viewBox="0 0 280 56"
        className="h-14 w-full text-[var(--accent)]"
        role="img"
        aria-label="近 30 天签约趋势"
      >
        {empty ? (
          <line
            x1="0"
            y1="28"
            x2="280"
            y2="28"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeDasharray="4 4"
          />
        ) : (
          <>
            <path d={area} fill="currentColor" fillOpacity="0.08" />
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="motion-safe:animate-[fadeIn_0.4s_ease]"
            />
            {points.map((p, i) => {
              const x =
                points.length > 1 ? (280 / (points.length - 1)) * i : 140;
              const y = 56 - (p.signedAmount / max) * 52 - 2;
              return (
                <circle
                  key={p.date}
                  cx={x}
                  cy={y}
                  r={hover === i ? 3.5 : 2}
                  fill="currentColor"
                  opacity={hover === i ? 1 : 0}
                  className="transition-opacity"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
            {/* invisible hit areas */}
            {points.map((p, i) => {
              const x =
                points.length > 1 ? (280 / (points.length - 1)) * i : 140;
              return (
                <rect
                  key={`hit-${p.date}`}
                  x={x - 4}
                  y={0}
                  width={8}
                  height={56}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </>
        )}
      </svg>
      {hover != null && points[hover] && (
        <div className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px] shadow-sm">
          {points[hover].date.slice(5)} ·{" "}
          {formatSalesMoney(points[hover].signedAmount)}
        </div>
      )}
      <p className="mt-1 text-[11px] text-[var(--muted)]">近 30 天签约趋势</p>
    </div>
  );
}
