"use client";

import { useState, useRef, useEffect } from "react";
import { TrendingUp, ShieldCheck, Download, FileText, FileSpreadsheet, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuoteTotals } from "@/lib/quote/calculate";

interface Props {
  totals: QuoteTotals;
  currency: string;
  status: string;
  onConfirm?: () => void;
  onSave?: () => void;
  saving?: boolean;
  onExportPdf?: () => void;
  onExportExcel?: () => void;
}

function fmt(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function QuoteSummaryBar({ totals, currency, status, onConfirm, onSave, saving, onExportPdf, onExportExcel }: Props) {
  const [showExport, setShowExport] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showExport) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExport(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showExport]);

  const marginColor =
    totals.profitMargin == null ? "text-muted" :
    totals.profitMargin < 5 ? "text-[#a63d3d]" :
    totals.profitMargin < 10 ? "text-[#9a6a2f]" :
    "text-[#2e7a56]";

  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <div className="text-[11px] font-medium text-muted">报价总额</div>
          <div className="text-lg font-bold tabular-nums">{fmt(totals.totalAmount, currency)}</div>
        </div>

        <div className="h-8 w-px bg-border/60" />

        <div>
          <div className="flex items-center gap-1 text-[11px] font-medium text-accent/70">
            <ShieldCheck size={10} />
            内部成本
          </div>
          <div className="text-sm font-medium tabular-nums text-accent/80">
            {fmt(totals.internalCost, currency)}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1 text-[11px] font-medium text-muted">
            <TrendingUp size={10} />
            利润率
          </div>
          <div className={cn("text-sm font-bold tabular-nums", marginColor)}>
            {totals.profitMargin != null ? `${totals.profitMargin}%` : "—"}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Export dropdown */}
          {(onExportPdf || onExportExcel) && (
            <div ref={exportRef} className="relative">
              <button
                type="button"
                onClick={() => setShowExport(!showExport)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/10"
              >
                <Download size={12} />
                导出
                <ChevronDown size={10} />
              </button>
              {showExport && (
                <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg border border-border bg-card shadow-lg">
                  {onExportPdf && (
                    <button
                      type="button"
                      onClick={() => { onExportPdf(); setShowExport(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted/10 rounded-t-lg"
                    >
                      <FileText size={13} className="text-red-500" />
                      导出 PDF
                    </button>
                  )}
                  {onExportExcel && (
                    <button
                      type="button"
                      onClick={() => { onExportExcel(); setShowExport(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted/10 rounded-b-lg"
                    >
                      <FileSpreadsheet size={13} className="text-green-600" />
                      导出 Excel
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:bg-muted/10 disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存草稿"}
            </button>
          )}
          {onConfirm && status === "draft" && (
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
            >
              确认报价
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
