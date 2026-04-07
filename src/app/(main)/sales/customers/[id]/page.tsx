"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Clock,
  Plus,
  MessageSquare,
  DollarSign,
  FileText,
  Send,
  Loader2,
  TrendingUp,
  X,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

/* ── Types ── */
interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  wechatNote: string | null;
  status: string;
  tags: string | null;
  notes: string | null;
  createdAt: string;
  opportunities: Opportunity[];
  interactions: Interaction[];
  quotes: Quote[];
  blindsOrders: BlindsOrder[];
}

interface Opportunity {
  id: string;
  title: string;
  stage: string;
  estimatedValue: number | null;
  priority: string;
  productTypes: string | null;
  nextFollowupAt: string | null;
  updatedAt: string;
  _count: { quotes: number; blindsOrders: number };
}

interface Interaction {
  id: string;
  type: string;
  direction: string | null;
  summary: string;
  content: string | null;
  createdAt: string;
  createdBy: { name: string };
}

interface Quote {
  id: string;
  version: number;
  status: string;
  grandTotal: number;
  createdAt: string;
  items: { id: string; product: string; fabric: string; price: number }[];
}

interface BlindsOrder {
  id: string;
  code: string;
  status: string;
  createdAt: string;
}

const STAGE_LABELS: Record<string, string> = {
  new_inquiry: "新询盘",
  consultation_booked: "已约咨询",
  measured: "已测量",
  quoted: "已报价",
  negotiation: "洽谈中",
  won: "已成交",
  lost: "已流失",
  on_hold: "暂搁置",
};

const STAGE_COLORS: Record<string, string> = {
  new_inquiry: "bg-blue-100 text-blue-800",
  consultation_booked: "bg-cyan-100 text-cyan-800",
  measured: "bg-amber-100 text-amber-800",
  quoted: "bg-orange-100 text-orange-800",
  negotiation: "bg-purple-100 text-purple-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-red-100 text-red-800",
  on_hold: "bg-gray-100 text-gray-600",
};

const INTERACTION_ICONS: Record<string, string> = {
  phone_call: "📞",
  wechat: "💬",
  email: "📧",
  in_person: "🤝",
  note: "📝",
};

/* ── Page ── */
export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddInteraction, setShowAddInteraction] = useState(false);
  const [activeTab, setActiveTab] = useState<"timeline" | "quotes" | "orders">(
    "timeline"
  );

  const loadCustomer = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/sales/customers/${id}`);
      if (!res.ok) {
        router.push("/sales");
        return;
      }
      const data = await res.json();
      setCustomer(data);
    } catch (err) {
      console.error("Load customer failed:", err);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    loadCustomer();
  }, [loadCustomer]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/sales"
          className="rounded-lg border border-border bg-white/80 p-1.5 text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <PageHeader
          title={customer.name}
          description={`客户 · ${customer.source || "未知来源"} · ${new Date(customer.createdAt).toLocaleDateString("zh-CN")} 创建`}
        />
      </div>

      {/* Top cards: info + opportunities */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Customer Info */}
        <div className="rounded-xl border border-border bg-white/70 p-5">
          <h3 className="text-sm font-semibold text-foreground">基本信息</h3>
          <div className="mt-3 space-y-2.5 text-sm">
            {customer.phone && (
              <div className="flex items-center gap-2 text-muted">
                <Phone className="h-4 w-4 shrink-0" />
                <a href={`tel:${customer.phone}`} className="hover:text-foreground">
                  {customer.phone}
                </a>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-2 text-muted">
                <Mail className="h-4 w-4 shrink-0" />
                <a href={`mailto:${customer.email}`} className="hover:text-foreground">
                  {customer.email}
                </a>
              </div>
            )}
            {customer.address && (
              <div className="flex items-start gap-2 text-muted">
                <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{customer.address}</span>
              </div>
            )}
            {customer.wechatNote && (
              <div className="flex items-center gap-2 text-muted">
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span>{customer.wechatNote}</span>
              </div>
            )}
          </div>
          {customer.notes && (
            <div className="mt-4 rounded-lg bg-white/50 p-3 text-xs text-muted leading-relaxed">
              {customer.notes}
            </div>
          )}
        </div>

        {/* Opportunities */}
        <div className="rounded-xl border border-border bg-white/70 p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              销售机会 ({customer.opportunities.length})
            </h3>
          </div>
          {customer.opportunities.length === 0 ? (
            <p className="mt-4 text-sm text-muted/60">暂无机会记录</p>
          ) : (
            <div className="mt-3 space-y-2">
              {customer.opportunities.map((opp) => (
                <div
                  key={opp.id}
                  className="flex items-center justify-between rounded-lg border border-border/50 bg-white/50 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {opp.title}
                      </span>
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                          STAGE_COLORS[opp.stage] || "bg-gray-100 text-gray-600"
                        )}
                      >
                        {STAGE_LABELS[opp.stage] || opp.stage}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                      {opp.estimatedValue != null && (
                        <span>${opp.estimatedValue.toLocaleString()}</span>
                      )}
                      {opp.productTypes && <span>{opp.productTypes}</span>}
                      {opp.nextFollowupAt && (
                        <span className="text-amber-600">
                          跟进: {new Date(opp.nextFollowupAt).toLocaleDateString("zh-CN")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>{opp._count.quotes} 报价</span>
                    <span>{opp._count.blindsOrders} 订单</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabs: Timeline / Quotes / Orders */}
      <div className="flex items-center gap-1 border-b border-border">
        {(
          [
            { key: "timeline", label: "互动时间线", count: customer.interactions.length },
            { key: "quotes", label: "报价记录", count: customer.quotes.length },
            { key: "orders", label: "工艺单", count: customer.blindsOrders.length },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            className={cn(
              "border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px]">
                {tab.count}
              </span>
            )}
          </button>
        ))}

        {activeTab === "timeline" && (
          <button
            onClick={() => setShowAddInteraction(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-white hover:bg-foreground/90"
          >
            <Plus className="h-3.5 w-3.5" />
            记录
          </button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "timeline" && (
        <InteractionTimeline interactions={customer.interactions} />
      )}
      {activeTab === "quotes" && <QuotesList quotes={customer.quotes} />}
      {activeTab === "orders" && <OrdersList orders={customer.blindsOrders} />}

      {/* Add Interaction Dialog */}
      {showAddInteraction && (
        <AddInteractionDialog
          customerId={customer.id}
          opportunities={customer.opportunities}
          onClose={() => setShowAddInteraction(false)}
          onSuccess={() => {
            setShowAddInteraction(false);
            loadCustomer();
          }}
        />
      )}
    </div>
  );
}

/* ── Interaction Timeline ── */
function InteractionTimeline({
  interactions,
}: {
  interactions: Interaction[];
}) {
  if (interactions.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted">
        <MessageSquare className="h-8 w-8 opacity-30" />
        <p className="mt-2 text-sm">暂无互动记录</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-0 pl-6">
      <div className="absolute left-[11px] top-0 bottom-0 w-px bg-border" />
      {interactions.map((item) => (
        <div key={item.id} className="relative pb-5">
          <div className="absolute -left-6 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-white text-xs shadow-sm">
            {INTERACTION_ICONS[item.type] || "📝"}
          </div>
          <div className="rounded-lg border border-border/50 bg-white/60 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {item.summary}
              </span>
              <span className="text-[11px] text-muted">
                {new Date(item.createdAt).toLocaleString("zh-CN")}
              </span>
            </div>
            {item.content && (
              <p className="mt-1.5 text-xs text-muted leading-relaxed whitespace-pre-wrap">
                {item.content}
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted/70">
              <span>{item.createdBy.name}</span>
              {item.direction && (
                <span>
                  · {item.direction === "inbound" ? "收到" : "发出"}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Quotes List ── */
function QuotesList({ quotes }: { quotes: Quote[] }) {
  if (quotes.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted">
        <FileText className="h-8 w-8 opacity-30" />
        <p className="mt-2 text-sm">暂无报价记录</p>
      </div>
    );
  }

  const statusLabel: Record<string, string> = {
    draft: "草稿",
    sent: "已发送",
    accepted: "已接受",
    rejected: "已拒绝",
  };
  const statusColor: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    sent: "bg-blue-100 text-blue-800",
    accepted: "bg-emerald-100 text-emerald-800",
    rejected: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-2">
      {quotes.map((q) => (
        <div
          key={q.id}
          className="rounded-lg border border-border/50 bg-white/60 px-4 py-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                报价 v{q.version}
              </span>
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                  statusColor[q.status] || "bg-gray-100 text-gray-600"
                )}
              >
                {statusLabel[q.status] || q.status}
              </span>
            </div>
            <span className="text-sm font-semibold text-foreground">
              ${q.grandTotal.toFixed(2)}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {q.items.length} 项产品 ·{" "}
            {new Date(q.createdAt).toLocaleDateString("zh-CN")}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Orders List ── */
function OrdersList({ orders }: { orders: BlindsOrder[] }) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted">
        <FileText className="h-8 w-8 opacity-30" />
        <p className="mt-2 text-sm">暂无工艺单</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <Link
          key={o.id}
          href={`/blinds-orders/${o.id}`}
          className="flex items-center justify-between rounded-lg border border-border/50 bg-white/60 px-4 py-3 hover:bg-white/80 transition-colors"
        >
          <div>
            <span className="text-sm font-medium text-foreground">
              {o.code}
            </span>
            <span className="ml-2 text-xs text-muted">{o.status}</span>
          </div>
          <span className="text-xs text-muted">
            {new Date(o.createdAt).toLocaleDateString("zh-CN")}
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ── Add Interaction Dialog ── */
function AddInteractionDialog({
  customerId,
  opportunities,
  onClose,
  onSuccess,
}: {
  customerId: string;
  opportunities: Opportunity[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    type: "note",
    direction: "",
    summary: "",
    content: "",
    opportunityId: "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.summary.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/api/sales/customers/${customerId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          opportunityId: form.opportunityId || null,
          direction: form.direction || null,
        }),
      });
      onSuccess();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">记录互动</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                类型
              </label>
              <select
                className={inputClass}
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="phone_call">电话</option>
                <option value="wechat">微信</option>
                <option value="email">邮件</option>
                <option value="in_person">面谈</option>
                <option value="note">备注</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                方向
              </label>
              <select
                className={inputClass}
                value={form.direction}
                onChange={(e) =>
                  setForm({ ...form, direction: e.target.value })
                }
              >
                <option value="">不适用</option>
                <option value="outbound">发出</option>
                <option value="inbound">收到</option>
              </select>
            </div>
          </div>

          {opportunities.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                关联机会
              </label>
              <select
                className={inputClass}
                value={form.opportunityId}
                onChange={(e) =>
                  setForm({ ...form, opportunityId: e.target.value })
                }
              >
                <option value="">不关联</option>
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              摘要 *
            </label>
            <input
              className={inputClass}
              placeholder="简要描述这次互动…"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              详细内容
            </label>
            <textarea
              className={cn(inputClass, "h-24 resize-none")}
              placeholder="可选：详细内容…"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.summary.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-white hover:bg-foreground/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
