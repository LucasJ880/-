"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  Plus,
  Loader2,
  Send,
  MessageSquare,
  DollarSign,
  CheckCircle,
  X,
  Mail,
} from "lucide-react";
import type { InquiryItemRow } from "./project-inquiry-section";
import { AddSupplierDialog } from "./add-supplier-dialog";
import { EmailDraftDialog } from "./email-draft-dialog";
import { QuoteAnalysisPanel } from "./quote-analysis-panel";
import { LanguageAssistButton } from "@/components/language-assist/language-assist-panel";

interface InquiryRound {
  id: string;
  roundNumber: number;
  title: string | null;
  status: string;
  dueDate: string | null;
  items: InquiryItemRow[];
}

interface Props {
  projectId: string;
  orgId: string | null;
  inquiry: InquiryRound;
  canManage: boolean;
  onUpdate: () => void;
}

const ITEM_STATUS_LABEL: Record<string, string> = {
  pending: "待发送",
  sent: "已发送",
  replied: "已回复",
  quoted: "已报价",
  declined: "已拒绝",
  no_response: "未响应",
};

const ITEM_STATUS_CLASS: Record<string, string> = {
  pending: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
  sent: "bg-[rgba(43,96,85,0.08)] text-[#2b6055]",
  replied: "bg-[rgba(43,96,85,0.12)] text-[#2b6055]",
  quoted: "bg-accent/10 text-accent",
  declined: "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]",
  no_response: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]",
};

export function InquiryDetail({
  projectId,
  orgId,
  inquiry,
  canManage,
  onUpdate,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [quoteItemId, setQuoteItemId] = useState<string | null>(null);
  const [emailItem, setEmailItem] = useState<InquiryItemRow | null>(null);

  const base = `/api/projects/${projectId}/inquiries/${inquiry.id}`;
  const isEditable =
    inquiry.status === "draft" || inquiry.status === "in_progress";

  async function action(
    itemId: string,
    path: string,
    method = "POST",
    body?: Record<string, unknown>
  ) {
    setBusy(itemId);
    try {
      const res = await apiFetch(`${base}/items/${itemId}/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : JSON.stringify({}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "操作失败");
      }
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function startInquiry() {
    setBusy("start");
    try {
      const res = await apiFetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "操作失败");
      }
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && isEditable && (
          <button
            type="button"
            onClick={() => setShowAddSupplier(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-background/80"
          >
            <Plus size={12} />
            添加供应商
          </button>
        )}
        {canManage && inquiry.status === "draft" && inquiry.items.length > 0 && (
          <button
            type="button"
            onClick={startInquiry}
            disabled={busy === "start"}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy === "start" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Send size={12} />
            )}
            开始询价
          </button>
        )}
      </div>

      {/* Table */}
      {inquiry.items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">
          暂无供应商，请先添加
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="pb-2 pr-3">供应商</th>
                <th className="pb-2 pr-3">状态</th>
                <th className="pb-2 pr-3">总价</th>
                <th className="pb-2 pr-3">单价</th>
                <th className="pb-2 pr-3">交期(天)</th>
                <th className="pb-2 pr-3">备注</th>
                <th className="pb-2 pr-3">选定</th>
                {canManage && <th className="pb-2">操作</th>}
              </tr>
            </thead>
            <tbody>
              {inquiry.items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-border/60"
                >
                  <td className="py-2.5 pr-3 font-medium">
                    {item.supplier.name}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${ITEM_STATUS_CLASS[item.status] ?? ""}`}
                    >
                      {ITEM_STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {item.totalPrice
                      ? `${item.currency} ${item.totalPrice}`
                      : "—"}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {item.unitPrice
                      ? `${item.currency} ${item.unitPrice}`
                      : "—"}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {item.deliveryDays ?? "—"}
                  </td>
                  <td className="py-2.5 pr-3">
                    <NotesCell
                      quoteNotes={item.quoteNotes}
                      contactNotes={item.contactNotes}
                      supplierName={item.supplier.name}
                    />
                  </td>
                  <td className="py-2.5 pr-3">
                    {item.isSelected ? (
                      <CheckCircle
                        size={16}
                        className="text-accent"
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  {canManage && (
                    <td className="py-2.5">
                      <ItemActions
                        item={item}
                        isEditable={isEditable}
                        busy={busy === item.id}
                        onAction={(path, method, body) =>
                          action(item.id, path, method, body)
                        }
                        onRecordQuote={() => setQuoteItemId(item.id)}
                        onGenerateEmail={() => setEmailItem(item)}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Quote Analysis */}
      <QuoteAnalysisPanel
        projectId={projectId}
        inquiryId={inquiry.id}
        quotedCount={inquiry.items.filter((i) => i.status === "quoted").length}
      />

      {/* Add supplier dialog */}
      {showAddSupplier && orgId && (
        <AddSupplierDialog
          projectId={projectId}
          inquiryId={inquiry.id}
          orgId={orgId}
          onClose={() => setShowAddSupplier(false)}
          onAdded={() => {
            setShowAddSupplier(false);
            onUpdate();
          }}
        />
      )}

      {/* Inline quote form */}
      {quoteItemId && (
        <InlineQuoteForm
          projectId={projectId}
          inquiryId={inquiry.id}
          itemId={quoteItemId}
          onClose={() => setQuoteItemId(null)}
          onSaved={() => {
            setQuoteItemId(null);
            onUpdate();
          }}
        />
      )}

      {/* Email draft dialog */}
      {emailItem && (
        <EmailDraftDialog
          projectId={projectId}
          inquiryId={inquiry.id}
          itemId={emailItem.id}
          supplierName={emailItem.supplier.name}
          onClose={() => setEmailItem(null)}
          onSent={() => {
            setEmailItem(null);
            onUpdate();
          }}
        />
      )}
    </div>
  );
}

// ── Item action buttons ──────────────────────────────────────

function ItemActions({
  item,
  isEditable,
  busy,
  onAction,
  onRecordQuote,
  onGenerateEmail,
}: {
  item: InquiryItemRow;
  isEditable: boolean;
  busy: boolean;
  onAction: (
    path: string,
    method?: string,
    body?: Record<string, unknown>
  ) => void;
  onRecordQuote: () => void;
  onGenerateEmail: () => void;
}) {
  if (busy) {
    return <Loader2 size={12} className="animate-spin text-muted" />;
  }

  const btns: React.ReactNode[] = [];

  if (item.status === "pending" && isEditable) {
    btns.push(
      <ActionBtn
        key="email"
        label="生成邮件"
        icon={<Mail size={11} />}
        className="text-accent"
        onClick={onGenerateEmail}
      />
    );
    btns.push(
      <ActionBtn
        key="send"
        label="标记发送"
        icon={<Send size={11} />}
        onClick={() => onAction("mark-sent", "POST", { sentVia: "email" })}
      />
    );
  }

  if (item.status === "sent") {
    btns.push(
      <ActionBtn
        key="replied"
        label="已回复"
        icon={<MessageSquare size={11} />}
        onClick={() => onAction("mark-replied")}
      />
    );
  }

  if (item.status === "replied" || item.status === "quoted") {
    btns.push(
      <ActionBtn
        key="quote"
        label={item.status === "quoted" ? "更新报价" : "录入报价"}
        icon={<DollarSign size={11} />}
        onClick={onRecordQuote}
      />
    );
  }

  if (item.status === "quoted" && !item.isSelected) {
    btns.push(
      <ActionBtn
        key="select"
        label="选定"
        icon={<CheckCircle size={11} />}
        className="text-accent"
        onClick={() => onAction("select")}
      />
    );
  }

  if (item.isSelected) {
    btns.push(
      <ActionBtn
        key="deselect"
        label="取消选定"
        icon={<X size={11} />}
        onClick={() => onAction("select", "DELETE")}
      />
    );
  }

  if (
    (item.status === "sent" || item.status === "replied") &&
    isEditable
  ) {
    btns.push(
      <ActionBtn
        key="declined"
        label="拒绝"
        className="text-[#a63d3d]"
        onClick={() => onAction("mark-declined")}
      />
    );
  }

  if (item.status === "sent" && isEditable) {
    btns.push(
      <ActionBtn
        key="noresp"
        label="未响应"
        className="text-[#9a6a2f]"
        onClick={() => onAction("mark-no-response")}
      />
    );
  }

  if (btns.length === 0) return <span className="text-muted">—</span>;

  return <div className="flex flex-wrap items-center gap-1">{btns}</div>;
}

function ActionBtn({
  label,
  icon,
  className = "",
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-background/80 ${className}`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Inline quote form ─────────────────────────────────────────

function InlineQuoteForm({
  projectId,
  inquiryId,
  itemId,
  onClose,
  onSaved,
}: {
  projectId: string;
  inquiryId: string;
  itemId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [totalPrice, setTotalPrice] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!totalPrice && !unitPrice) {
      alert("至少需要填写单价或总价");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (totalPrice) body.totalPrice = totalPrice;
      if (unitPrice) body.unitPrice = unitPrice;
      if (deliveryDays) body.deliveryDays = parseInt(deliveryDays, 10);
      if (quoteNotes) body.quoteNotes = quoteNotes;

      const res = await apiFetch(
        `/api/projects/${projectId}/inquiries/${inquiryId}/items/${itemId}/record-quote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "保存失败");
      }
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold">录入报价</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="space-y-1">
          <span className="text-[11px] text-muted">总价</span>
          <input
            value={totalPrice}
            onChange={(e) => setTotalPrice(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-muted">单价</span>
          <input
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-muted">交期 (天)</span>
          <input
            value={deliveryDays}
            onChange={(e) => setDeliveryDays(e.target.value)}
            placeholder="—"
            type="number"
            min={0}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-muted">备注</span>
          <input
            value={quoteNotes}
            onChange={(e) => setQuoteNotes(e.target.value)}
            placeholder="可选"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存报价"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium hover:bg-background/80"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Notes cell with language assist ───────────────────────────

function NotesCell({
  quoteNotes,
  contactNotes,
  supplierName,
}: {
  quoteNotes: string | null;
  contactNotes: string | null;
  supplierName: string;
}) {
  const text = quoteNotes || contactNotes;
  if (!text) return <span className="text-muted">—</span>;

  const context = quoteNotes
    ? `这是供应商「${supplierName}」的报价备注`
    : `这是与供应商「${supplierName}」的沟通备注`;

  return (
    <div className="flex items-center gap-1.5">
      <span className="max-w-[120px] truncate text-[12px]" title={text}>
        {text}
      </span>
      <LanguageAssistButton
        text={text}
        context={context}
        mode="understand_and_reply"
        label="理解"
      />
    </div>
  );
}
