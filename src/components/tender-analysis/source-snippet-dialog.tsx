"use client";

type Source = {
  id: string;
  documentId: string;
  documentTitle?: string | null;
  pageNumber: number | null;
  locationLabel?: string | null;
  sectionLabel: string | null;
  snippet: string;
  methodLabel?: string;
};

type Props = {
  open: boolean;
  source: Source | null;
  onClose: () => void;
};

export function SourceSnippetDialog({ open, source, onClose }: Props) {
  if (!open || !source) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-lg space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">来源摘录</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {source.locationLabel
                ? source.locationLabel
                : source.documentTitle && source.pageNumber != null
                  ? `${source.documentTitle} · p.${source.pageNumber}`
                  : source.documentTitle
                    ? source.documentTitle
                    : source.pageNumber != null
                      ? `第 ${source.pageNumber} 页`
                      : "页码未知"}
              {source.sectionLabel &&
              !source.locationLabel?.includes(source.sectionLabel)
                ? ` · ${source.sectionLabel}`
                : ""}
              {source.methodLabel ? ` · ${source.methodLabel}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--muted)] underline"
          >
            关闭
          </button>
        </div>
        <blockquote className="rounded-lg border border-[var(--border)] bg-stone-50 px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] whitespace-pre-wrap">
          {source.snippet || "（无摘录）"}
        </blockquote>
      </div>
    </div>
  );
}
