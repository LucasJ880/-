"use client";

import { statementKindLabel } from "@/lib/tender-auto-analysis/display-labels";

const TONE: Record<string, string> = {
  CONFIRMED_FACT: "bg-emerald-50 text-emerald-800 border-emerald-200",
  DOCUMENT_INTERPRETATION: "bg-sky-50 text-sky-800 border-sky-200",
  AI_INFERENCE: "bg-amber-50 text-amber-900 border-amber-200",
  RECOMMENDATION: "bg-stone-100 text-stone-700 border-stone-300",
};

export function StatementKindBadge({ kind }: { kind: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${
        TONE[kind] || "bg-stone-50 text-stone-700 border-stone-200"
      }`}
    >
      {statementKindLabel(kind)}
    </span>
  );
}
