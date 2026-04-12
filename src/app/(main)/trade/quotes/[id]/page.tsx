"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Send,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface QuoteItem {
  id: string;
  productName: string;
  specification: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  remarks: string | null;
}

interface Quote {
  id: string;
  quoteNumber: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  country: string | null;
  status: string;
  currency: string;
  incoterm: string;
  paymentTerms: string | null;
  validDays: number;
  leadTimeDays: number | null;
  moq: string | null;
  shippingPort: string | null;
  subtotal: number;
  discount: number;
  shippingCost: number;
  totalAmount: number;
  notes: string | null;
  internalNotes: string | null;
  expiresAt: string | null;
  createdAt: string;
  items: QuoteItem[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿", sent: "已发送", negotiating: "谈判中",
  accepted: "已接受", rejected: "已拒绝", expired: "已过期",
};

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddItem, setShowAddItem] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/trade/quotes/${id}`);
    if (res.ok) setQuote(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleDeleteItem = async (itemId: string) => {
    await apiFetch(`/api/trade/quotes/${id}/items?itemId=${itemId}`, { method: "DELETE" });
    load();
  };

  const handleStatusChange = async (status: string) => {
    await apiFetch(`/api/trade/quotes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const handleCopy = () => {
    if (!quote) return;
    const lines = quote.items.map((i) =>
      `${i.productName}\t${i.specification ?? ""}\t${i.quantity} ${i.unit}\t${quote.currency} ${i.unitPrice}\t${quote.currency} ${i.totalPrice}`
    );
    const text = [
      `Quote: ${quote.quoteNumber}`,
      `To: ${quote.companyName}`,
      `Terms: ${quote.incoterm} ${quote.shippingPort ?? ""}`,
      `Payment: ${quote.paymentTerms ?? "TBD"}`,
      "",
      "Product\tSpec\tQty\tUnit Price\tTotal",
      ...lines,
      "",
      `Subtotal: ${quote.currency} ${quote.subtotal.toFixed(2)}`,
      `Total: ${quote.currency} ${quote.totalAmount.toFixed(2)}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }
  if (!quote) {
    return <div className="py-20 text-center text-muted">报价单不存在</div>;
  }

  const q = quote;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <button onClick={() => router.back()} className="mt-1 rounded-lg p-1.5 text-muted transition hover:text-foreground">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-blue-400">{q.quoteNumber}</span>
            <h1 className="text-lg font-semibold text-foreground">{q.companyName}</h1>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium",
              q.status === "accepted" ? "bg-emerald-500/15 text-emerald-400" :
              q.status === "draft" ? "bg-zinc-500/15 text-zinc-400" :
              "bg-blue-500/15 text-blue-400"
            )}>
              {STATUS_LABELS[q.status] ?? q.status}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>{q.incoterm} {q.shippingPort ?? ""}</span>
            <span>{q.currency}</span>
            {q.paymentTerms && <span>付款: {q.paymentTerms}</span>}
            {q.leadTimeDays && <span>交期: {q.leadTimeDays}天</span>}
            {q.moq && <span>MOQ: {q.moq}</span>}
            <span>有效期: {q.validDays}天</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-foreground">{q.currency} {q.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
          <p className="text-[10px] text-muted">总金额</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {q.status === "draft" && (
          <button onClick={() => handleStatusChange("sent")} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500">
            <Send size={12} /> 标记为已发送
          </button>
        )}
        {q.status === "sent" && (
          <>
            <button onClick={() => handleStatusChange("accepted")} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500">
              <CheckCircle2 size={12} /> 客户已接受
            </button>
            <button onClick={() => handleStatusChange("negotiating")} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-amber-500/50">
              谈判中
            </button>
            <button onClick={() => handleStatusChange("rejected")} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-red-400 transition hover:border-red-500/50">
              已拒绝
            </button>
          </>
        )}
        <button onClick={handleCopy} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition hover:border-blue-500/50">
          {copied ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
          {copied ? "已复制" : "复制报价"}
        </button>
      </div>

      {/* Items Table */}
      <div className="rounded-xl border border-border/60 bg-card-bg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-xs text-muted">
              <th className="px-4 py-2 text-left">产品</th>
              <th className="px-4 py-2 text-left">规格</th>
              <th className="px-4 py-2 text-right">数量</th>
              <th className="px-4 py-2 text-right">单价</th>
              <th className="px-4 py-2 text-right">小计</th>
              <th className="w-10 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((item) => (
              <tr key={item.id} className="border-b border-border/30">
                <td className="px-4 py-2 text-foreground">{item.productName}</td>
                <td className="px-4 py-2 text-muted">{item.specification ?? "-"}</td>
                <td className="px-4 py-2 text-right text-foreground">{item.quantity} {item.unit}</td>
                <td className="px-4 py-2 text-right text-foreground">{q.currency} {item.unitPrice.toFixed(2)}</td>
                <td className="px-4 py-2 text-right font-medium text-foreground">{q.currency} {item.totalPrice.toFixed(2)}</td>
                <td className="px-2 py-2">
                  {q.status === "draft" && (
                    <button onClick={() => handleDeleteItem(item.id)} className="rounded p-1 text-muted hover:text-red-400">
                      <Trash2 size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-xs text-muted">
              <td colSpan={4} className="px-4 py-2 text-right">小计</td>
              <td className="px-4 py-2 text-right text-foreground">{q.currency} {q.subtotal.toFixed(2)}</td>
              <td></td>
            </tr>
            {q.discount > 0 && (
              <tr className="text-xs text-muted">
                <td colSpan={4} className="px-4 py-1 text-right">折扣</td>
                <td className="px-4 py-1 text-right text-red-400">-{q.currency} {q.discount.toFixed(2)}</td>
                <td></td>
              </tr>
            )}
            {q.shippingCost > 0 && (
              <tr className="text-xs text-muted">
                <td colSpan={4} className="px-4 py-1 text-right">运费</td>
                <td className="px-4 py-1 text-right text-foreground">{q.currency} {q.shippingCost.toFixed(2)}</td>
                <td></td>
              </tr>
            )}
            <tr className="border-t border-border/60 font-semibold">
              <td colSpan={4} className="px-4 py-2 text-right text-foreground">总计</td>
              <td className="px-4 py-2 text-right text-foreground">{q.currency} {q.totalAmount.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add Item */}
      {q.status === "draft" && (
        <>
          <button
            onClick={() => setShowAddItem(!showAddItem)}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted transition hover:border-blue-500/50 hover:text-blue-400"
          >
            <Plus size={12} />
            添加产品行
          </button>
          {showAddItem && (
            <AddItemForm quoteId={q.id} currency={q.currency} onAdded={() => { setShowAddItem(false); load(); }} onCancel={() => setShowAddItem(false)} />
          )}
        </>
      )}

      {/* Notes */}
      {(q.notes || q.internalNotes) && (
        <div className="space-y-2">
          {q.notes && (
            <div className="rounded-xl border border-border/60 bg-card-bg p-4">
              <h3 className="mb-1 text-xs font-medium text-muted">备注（客户可见）</h3>
              <p className="whitespace-pre-wrap text-sm text-foreground">{q.notes}</p>
            </div>
          )}
          {q.internalNotes && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <h3 className="mb-1 text-xs font-medium text-amber-400">内部备注</h3>
              <p className="whitespace-pre-wrap text-sm text-foreground">{q.internalNotes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddItemForm({ quoteId, currency, onAdded, onCancel }: { quoteId: string; currency: string; onAdded: () => void; onCancel: () => void }) {
  const [productName, setProductName] = useState("");
  const [specification, setSpecification] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim() || !quantity || !unitPrice) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/trade/quotes/${quoteId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: productName.trim(),
          specification: specification.trim() || undefined,
          unit,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
        }),
      });
      if (res.ok) onAdded();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border/60 bg-card-bg p-4">
      <div className="grid grid-cols-6 gap-2">
        <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="产品名称 *" className="col-span-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
        <input value={specification} onChange={(e) => setSpecification(e.target.value)} placeholder="规格" className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
        <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" placeholder="数量 *" className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
        <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} type="number" step="0.01" placeholder={`单价 (${currency}) *`} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
        <div className="flex gap-1">
          <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-blue-600 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {saving ? "..." : "添加"}
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg px-2 text-xs text-muted hover:text-foreground">取消</button>
        </div>
      </div>
    </form>
  );
}
