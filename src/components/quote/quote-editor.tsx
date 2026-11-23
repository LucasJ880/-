"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, FileText, Info } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { calculateTotals, type QuoteTotals } from "@/lib/quote/calculate";
import { runQuoteChecks, type CheckItem } from "@/lib/quote/rules";
import { GO_TO_QUOTE_PAGE_ZH, legacyQuoteHintLinesZh, legacyQuoteLoadError, type LegacyQuoteCaps } from "@/lib/quote/finance-view";
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
// dynamic import to avoid jsPDF SSR bundling issue with fflate/Worker
const lazyExportPdf = () => import("@/lib/quote/export-pdf").then((m) => m.exportQuotePdf);
const lazyExportExcel = () => import("@/lib/quote/export-excel").then((m) => m.exportQuoteExcel);

interface Props {
  projectId: string;
  projectName: string;
  quoteId: string;
}

/** 接口 GET …/quotes/{报价} 的返回（旧报价单字段白名单 + capabilities；FIX-26） */
type QuoteDetailJson = Record<string, unknown> & { capabilities?: LegacyQuoteCaps; costHidden?: boolean };
type LoadState = { kind: "loading" } | { kind: "failed"; message: string; href?: string } | { kind: "ok"; detail: QuoteDetailJson };

/** 接口没带 capabilities（不该发生）时按看不到、不能编辑处理，不放开 */
const NO_CAPS: LegacyQuoteCaps = { canViewInternal: false, canEdit: false };

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

function headerFromDetail(data: QuoteDetailJson): QuoteHeaderData {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    ...DEFAULT_HEADER,
    title: str(data.title),
    templateType: (str(data.templateType) || "export_standard") as TemplateType,
    currency: str(data.currency) || "CAD",
    tradeTerms: str(data.tradeTerms),
    paymentTerms: str(data.paymentTerms),
    deliveryDays: (data.deliveryDays as number | null | undefined) ?? null,
    validUntil: data.validUntil ? new Date(data.validUntil as string).toISOString().slice(0, 10) : "",
    moq: (data.moq as number | null | undefined) ?? null,
    originCountry: str(data.originCountry),
    internalNotes: str(data.internalNotes),
  };
}

function linesFromDetail(data: QuoteDetailJson): QuoteLineItemData[] {
  const items = Array.isArray(data.lineItems) ? (data.lineItems as Array<Record<string, unknown>>) : [];
  return items.map((item, idx) => ({
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
  }));
}

/** 读取报价单；读取失败写原因（不再留下空白的默认表单），只有还在读取时转圈 */
export function QuoteEditor({ projectId, projectName, quoteId }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quotes/${quoteId}`);
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setState({ kind: "failed", ...legacyQuoteLoadError(res.status, data) });
        return;
      }
      setState({ kind: "ok", detail: (data ?? {}) as QuoteDetailJson });
    } catch (e) {
      setState({ kind: "failed", ...legacyQuoteLoadError(0, { error: e instanceof Error ? e.message : String(e) }) });
    }
  }, [projectId, quoteId]);

  useEffect(() => { load(); }, [load]);

  if (state.kind === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-accent/40" />
      </div>
    );
  }
  if (state.kind === "failed") {
    return <QuoteLoadFailed projectId={projectId} projectName={projectName} message={state.message} href={state.href} />;
  }
  return <QuoteEditorView projectId={projectId} projectName={projectName} quoteId={quoteId} detail={state.detail} />;
}

/** 读取失败：「打不开这个报价单：」+ 原因；报价引擎的报价（409）另给去报价页的链接 */
export function QuoteLoadFailed({ projectId, projectName, message, href }: { projectId?: string; projectName?: string; message: string; href?: string }) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      {projectId && (
        <Link href={`/projects/${projectId}`} className="mb-4 flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft size={14} />
          {projectName || "返回项目"}
        </Link>
      )}
      <div className="rounded-lg border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
        <p>{message}</p>
        {href && (
          <Link href={href} className="mt-2 inline-block font-medium text-accent hover:underline">
            {GO_TO_QUOTE_PAGE_ZH}
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * FIX-26：按接口给的 capabilities 显示——
 * 看不到成本：顶部一句；行项表没有成本价一栏；合计条只有报价总额；顶部摘要不显示利润率；规则检查不出利润率检查项；
 *            Excel 导出不含成本；AI 面板「输出版本」不出内部成本表。
 * 不能编辑：表单与行项只读；不出保存草稿、确认报价、AI 起草、AI 深度审查、AI 自动流；顶部写不能编辑那句。
 */
export function QuoteEditorView({ projectId, projectName, quoteId, detail }: Props & { detail: QuoteDetailJson }) {
  const caps: LegacyQuoteCaps = detail.capabilities ?? NO_CAPS;
  const costVisible = caps.canViewInternal;
  const canEdit = caps.canEdit;
  const [header, setHeader] = useState<QuoteHeaderData>(() => headerFromDetail(detail));
  const [lines, setLines] = useState<QuoteLineItemData[]>(() => linesFromDetail(detail));
  const [status, setStatus] = useState<QuoteStatus>(((detail.status as string) || "draft") as QuoteStatus);
  const version = (detail.version as number | undefined) ?? 1;
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [aiReviewRisk, setAiReviewRisk] = useState<"low" | "medium" | "high" | null>(null);

  const totals: QuoteTotals = calculateTotals(lines);
  const checks: CheckItem[] = runQuoteChecks(header, lines, undefined, { costHidden: !costVisible });
  const hintLines = legacyQuoteHintLinesZh(caps);

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

  const isDraft = status === "draft";
  const editable = isDraft && canEdit;

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

      {/* 为什么看不到成本 / 不能编辑（FIX-26） */}
      {hintLines.length > 0 && (
        <div className="mb-3 space-y-1 rounded-lg border border-border/60 bg-muted/5 px-4 py-2 text-xs text-muted">
          {hintLines.map((l) => (
            <p key={l.kind} className="flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" />
              <span>{l.text}</span>
            </p>
          ))}
        </div>
      )}

      {/* 顶部摘要条 */}
      <QuoteTopSummary
        templateType={header.templateType}
        checks={checks}
        profitMargin={costVisible ? totals.profitMargin : null}
        status={status}
        lineCount={lines.length}
        aiReviewRisk={aiReviewRisk}
        showCost={costVisible}
        canEdit={canEdit}
      />

      {/* 主内容: 左侧编辑 + 右侧面板 */}
      <div className="mt-4 flex gap-4">
        {/* 左侧主工作区 */}
        <div className="min-w-0 flex-1 space-y-4">
          <QuoteHeaderForm
            header={header}
            onChange={updateHeader}
            disabled={!editable}
          />

          <QuoteLineTable
            lines={lines}
            onChange={setLines}
            disabled={!editable}
            showCost={costVisible}
          />

          <QuoteSummaryBar
            totals={totals}
            currency={header.currency}
            status={status}
            showCost={costVisible}
            onSave={editable ? save : undefined}
            onConfirm={editable ? confirm : undefined}
            saving={saving}
            onExportPdf={async () => {
              const fn = await lazyExportPdf();
              await fn({ header, lines, totals, projectName, quoteVersion: version });
            }}
            onExportExcel={async () => { const fn = await lazyExportExcel(); fn({ header, lines, totals, projectName, quoteVersion: version, costVisible }); }}
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
          canEdit={canEdit}
          showCost={costVisible}
        />
      </div>
    </div>
  );
}
