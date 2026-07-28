export function SalesHomeSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-3">
        <div className="h-7 w-48 rounded-lg bg-[var(--muted)]/25" />
        <div className="h-4 w-80 max-w-full rounded bg-[var(--muted)]/20" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 w-28 rounded-xl bg-[var(--muted)]/20" />
          ))}
        </div>
      </div>
      <div className="h-56 rounded-2xl border border-[var(--border)] bg-[var(--card)]" />
      <div className="grid gap-4 lg:grid-cols-[2fr_1.2fr_1.2fr]">
        <div className="h-72 rounded-2xl border border-[var(--border)] bg-[var(--card)]" />
        <div className="h-72 rounded-2xl border border-[var(--border)] bg-[var(--card)]" />
        <div className="h-72 rounded-2xl border border-[var(--border)] bg-[var(--card)]" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-48 rounded-2xl border border-[var(--border)] bg-[var(--card)]"
          />
        ))}
      </div>
    </div>
  );
}
