export function TrendBars({
  title,
  series,
  ariaSummary,
}: {
  title: string;
  series: Array<{ label: string; value: number }>;
  ariaSummary: string;
}) {
  const max = Math.max(1, ...series.map((p) => p.value));
  return (
    <section
      className="rounded-lg border border-border bg-background p-4"
      aria-label={`${title}. ${ariaSummary}`}
    >
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      {series.length === 0 ? (
        <p className="text-sm text-muted">No observed points in this range.</p>
      ) : (
        <div className="flex h-28 items-end gap-1">
          {series.map((point) => (
            <div
              key={point.label}
              className="flex min-w-0 flex-1 flex-col items-center justify-end"
              title={`${point.label}: ${point.value}`}
            >
              <div
                className="w-full rounded-sm bg-foreground/70"
                style={{ height: `${Math.max(2, (point.value / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">{ariaSummary}</p>
    </section>
  );
}
