"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, FileText } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { calculateTotals, type QuoteTotals } from "@/lib/quote/calculate";
import { runQuoteChecks, type CheckItem } from "@/lib/quote/rules";
import {
  QUOTE_STATUS_LABELS,
  type QuoteHeaderData,
  type QuoteLineItemData,
  type QuoteStatus,
  type TemplateType,
  type LineCategory,
} from "@/lib/quote/types";
import { QuoteTopSummary } from "./quote-top-summary";
import { QuoteHeaderForm } from "./quote-header-form";
import { QuoteLineTable } from "./quote-line-table";
import { QuoteSummaryBar } from "./quote-summary-bar";
import { QuoteAiPanel } from "./quote-ai-panel";
import { exportQuotePdf } from "@/lib/quote/export-pdf";
import { exportQuoteExcel } from "@/lib/quote/export-excel";

interface Props {
  projectId: string;
  projectName: string;
  quoteId: string;
}

const DEFAULT_HEADER: QuoteHeaderData = {
  title: "",
  templateType: "export_standard",
  currency: "CAD",
  tradeTerms: "",
  paymentTerms: "",
  deliveryDays: null,
  validUntil: "",
  moq: null,
  originCountry: "",
  internalNotes: "",
};

const VALID_CATEGORIES = new Set([
  "product", "shipping", "customs", "packaging",
  "labor", "overhead", "tax", "other",
]);

export function QuoteEditor({ projectId, projectName, quoteId }: Props) {
  const [header, setHeader] = useState<QuoteHeaderData>(DEFAULT_HEADER);
  const [lines, setLines] = useState<QuoteLineItemData[]>([]);
  const [status, setStatus] = useState<QuoteStatus>("draft");
  const [version, setVersion] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [aiReviewRisk, setAiReviewRisk] = useState<"low" | "medium" | "high" | null>(null);

  const totals: QuoteTotals = calculateTotals(lines);
  const checks: CheckItem[] = runQuoteChecks(header, lines);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quotes/${quoteId}`);
      if (!res.ok) return;
      const data = await res.json();

      setHeader({
        title: data.title ?? "",
        templateType: (data.templateType ?? "export_standard") as TemplateType,
        currency: data.currency ?? "CAD",
        tradeTerms: data.tradeTerms ?? "",
        paymentTerms: data.paymentTerms ?? "",
        deliveryDays: data.deliveryDays,
        validUntil: data.validUntil ? new Date(data.validUntil).toISOString().slice(0, 10) : "",
        moq: data.moq,
        originCountry: data.originCountry ?? "",
        internalNotes: data.internalNotes ?? "",
      });

      setLines(
        (data.lineItems ?? []).map((item: Record<string, unknown>, idx: number) => ({
          id: item.id as string,
          sortOrder: idx,
          category: (item.category ?? "product") as QuoteLineItemData["category"],
          itemName: (item.itemName as string) ?? "",
          specification: (item.specification as string) ?? "",
          unit: (item.unit as string) ?? "",
          quantity: item.quantity != null ? Number(item.quantity) : null,
          unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
          totalPrice: item.totalPrice != null ? Number(item.totalPrice) : null,
          remarks: (item.remarks as string) ?? "",
          costPrice: item.costPrice != null ? Number(item.costPrice) : null,
          isInternal: (item.isInternal as boolean) ?? false,
        }))
      );

      setStatus((data.status ?? "draft") as QuoteStatus);
      setVersion(data.version ?? 1);
    } finally {
      setLoading(false);
    }
  }, [projectId, quoteId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ header, lineItems: lines }),
      });
      if (res.ok) {
        setLastSaved(new Date().toLocaleTimeString("zh-CN"));
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirm() {
    const urgentChecks = checks.filter((c) => c.severity === "urgent");

    // If AI review not done, suggest it first
    if (!aiReviewRisk && lines.length > 0) {
      const proceed = window.confirm(
        "尚未进行 AI 深度审查。\n\n建议先在右侧面板执行 AI 审查，确认无重大风险后再确认报价。\n\n确定要直接确认吗？"
      );
      if (!proceed) return;
    }

    if (urgentChecks.length > 0) {
      const msg = urgentChecks.map((c) => `• ${c.message}`).join("\n");
      if (!window.confirm(`检测到高风险项：\n\n${msg}\n\n已知晓以上风险，确定要继续确认吗？`)) return;
    }

    setSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          header: { ...header, status: "confirmed" },
          lineItems: lines,
        }),
      });
      if (res.ok) {
        setStatus("confirmed");
        setLastSaved(new Date().toLocaleTimeString("zh-CN"));
      }
    } finally {
      setSaving(false);
    }
  }

  function updateHeader(patch: Partial<QuoteHeaderData>) {
    setHeader((prev) => ({ ...prev, ...patch }));
  }

  function handleApplyCheckAction(check: CheckItem) {
    if (check.actionType === "insert_line" && check.actionPayload) {
      const newLine: QuoteLineItemData = {
        sortOrder: lines.length,
        category: (check.actionPayload.category as QuoteLineItemData["category"]) ?? "other",
        itemName: (check.actionPayload.itemName as string) ?? "",
        specification: "",
        unit: "",
        quantity: null,
        unitPrice: null,
        totalPrice: null,
        remarks: "",
        costPrice: null,
        isInternal: false,
      };
      setLines((prev) => [...prev, newLine]);
    } else if (check.actionType === "set_field" && check.actionPayload) {
      const field = check.actionPayload.field as string;
      const value = check.actionPayload.value;
      updateHeader({ [field]: value });
    }
  }

  function handleApplyDraft(draft: {
    title?: string;
    currency?: string;
    tradeTerms?: string;
    paymentTerms?: string;
    deliveryDays?: number;
    validUntil?: string;
    moq?: number | null;
    originCountry?: string;
    lineItems?: Array<{
      category: string;
      itemName: string;
      specification?: string;
      unit?: string;
      quantity: number | null;
      unitPrice: number | null;
      totalPrice: number | null;
      costPrice: number | null;
      remarks?: string;
    }>;
    internalNotes?: string;
  }) {
    const headerPatch: Partial<QuoteHeaderData> = {};
    if (draft.title) headerPatch.title = draft.title;
    if (draft.currency) headerPatch.currency = draft.currency;
    if (draft.tradeTerms) headerPatch.tradeTerms = draft.tradeTerms;
    if (draft.paymentTerms) headerPatch.paymentTerms = draft.paymentTerms;
    if (draft.deliveryDays != null) headerPatch.deliveryDays = draft.deliveryDays;
    if (draft.validUntil) headerPatch.validUntil = draft.validUntil;
    if (draft.moq !== undefined) headerPatch.moq = draft.moq;
    if (draft.originCountry) headerPatch.originCountry = draft.originCountry;
    if (draft.internalNotes) headerPatch.internalNotes = draft.internalNotes;

    if (Object.keys(headerPatch).length > 0) {
      updateHeader(headerPatch);
    }

    if (draft.lineItems && draft.lineItems.length > 0) {
      const newLines: QuoteLineItemData[] = draft.lineItems.map((li, idx) => ({
        sortOrder: idx,
        category: (VALID_CATEGORIES.has(li.category) ? li.category : "other") as LineCategory,
        itemName: li.itemName ?? "",
        specification: li.specification ?? "",
        unit: li.unit ?? "",
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        totalPrice: li.totalPrice,
        remarks: li.remarks ?? "",
        costPrice: li.costPrice,
        isInternal: false,
      }));
      setLines(newLines);
    }

    // Reset AI review since data changed
    setAiReviewRisk(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-accent/40" />
      </div>
    );
  }

  const isDraft = status === "draft";

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      {/* 导航栏 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}`}
            className="flex items-center gap-1 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeft size={14} />
            {projectName}
          </Link>
          <span className="text-muted">/</span>
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-accent" />
            <span className="text-sm font-medium">{header.title || "报价单"}</span>
          </div>
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            status === "draft" ? "bg-muted/10 text-muted" :
            status === "confirmed" ? "bg-[rgba(46,122,86,0.1)] text-[#2e7a56]" :
            "bg-accent/10 text-accent"
          )}>
            {QUOTE_STATUS_LABELS[status]}
          </span>
        </div>
        {lastSaved && (
          <span className="text-[10px] text-muted">
            上次保存: {lastSaved}
          </span>
        )}
      </div>

      {/* 顶部摘要条 */}
      <QuoteTopSummary
        templateType={header.templateType}
        checks={checks}
        profitMargin={totals.profitMargin}
        status={status}
        lineCount={lines.length}
        aiReviewRisk={aiReviewRisk}
      />

      {/* 主内容: 左侧编辑 + 右侧面板 */}
      <div className="mt-4 flex gap-4">
        {/* 左侧主工作区 */}
        <div className="min-w-0 flex-1 space-y-4">
          <QuoteHeaderForm
            header={header}
            onChange={updateHeader}
            disabled={!isDraft}
          />

          <QuoteLineTable
            lines={lines}
            onChange={setLines}
            disabled={!isDraft}
          />

          <QuoteSummaryBar
            totals={totals}
            currency={header.currency}
            status={status}
            onSave={isDraft ? save : undefined}
            onConfirm={isDraft ? confirm : undefined}
            saving={saving}
            onExportPdf={() => exportQuotePdf({ header, lines, totals, projectName, quoteVersion: version })}
            onExportExcel={() => exportQuoteExcel({ header, lines, totals, projectName, quoteVersion: version })}
          />
        </div>

        {/* 右侧 AI 面板 */}
        <QuoteAiPanel
          projectId={projectId}
          quoteId={quoteId}
          header={header}
          lines={lines}
          checks={checks}
          onTemplateChange={(t) => updateHeader({ templateType: t })}
          onApplyCheckAction={handleApplyCheckAction}
          onApplyDraft={handleApplyDraft}
          onAiReviewChange={setAiReviewRisk}
          status={status}
        />
      </div>
    </div>
  );
}
