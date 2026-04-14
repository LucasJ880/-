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
  Sparkles,
  RefreshCw,
  Upload,
  Brain,
  CalendarDays,
  Ruler,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  new_lead: "新线索",
  needs_confirmed: "需求确认",
  measure_booked: "预约量房",
  quoted: "已报价",
  negotiation: "洽谈中",
  signed: "已签单",
  producing: "生产中",
  installing: "安装中",
  completed: "已完成",
  lost: "已流失",
  on_hold: "暂搁置",
};

const STAGE_COLORS: Record<string, string> = {
  new_lead: "bg-blue-100 text-blue-800",
  needs_confirmed: "bg-cyan-100 text-cyan-800",
  measure_booked: "bg-teal-100 text-teal-800",
  quoted: "bg-orange-100 text-orange-800",
  negotiation: "bg-purple-100 text-purple-800",
  signed: "bg-emerald-100 text-emerald-800",
  producing: "bg-amber-100 text-amber-800",
  installing: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
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
  const [showCreateQuote, setShowCreateQuote] = useState(false);
  const [showImportConvo, setShowImportConvo] = useState(false);
  const [sendingEmailFor, setSendingEmailFor] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"timeline" | "quotes" | "orders" | "coaching">(
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

  const handleSendEmail = async (quoteId: string) => {
    if (!customer?.email || sendingEmailFor) return;
    setSendingEmailFor(quoteId);
    try {
      const res = await apiFetch(`/api/sales/quotes/${quoteId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: customer.email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "发送失败");
        return;
      }
      loadCustomer();
    } catch (err) {
      console.error("Send email failed:", err);
      alert("邮件发送失败");
    } finally {
      setSendingEmailFor(null);
    }
  };

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

      {/* AI Advice Panel */}
      <AiAdvicePanel customerId={customer.id} />

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
          {/* Quick actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/sales/calendar?customerId=${customer.id}&action=new&type=measure`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <Ruler size={13} />
              预约量房
            </Link>
            <Link
              href={`/sales/calendar?customerId=${customer.id}&action=new&type=install`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              <CalendarDays size={13} />
              预约安装
            </Link>
          </div>
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
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-transparent",
                          STAGE_COLORS[opp.stage] || "bg-gray-100 text-gray-600"
                        )}
                      >
                        {STAGE_LABELS[opp.stage] || opp.stage}
                      </Badge>
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
            { key: "timeline" as const, label: "互动时间线", count: customer.interactions.length },
            { key: "quotes" as const, label: "报价记录", count: customer.quotes.length },
            { key: "orders" as const, label: "工艺单", count: customer.blindsOrders.length },
            { key: "coaching" as const, label: "AI 建议", count: 0 },
          ]
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

        <div className="ml-auto flex items-center gap-2">
          {activeTab === "timeline" && (
            <>
              <button
                onClick={() => setShowImportConvo(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-white/80 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white"
              >
                <Upload className="h-3.5 w-3.5" />
                导入对话
              </button>
              <button
                onClick={() => setShowAddInteraction(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-white hover:bg-foreground/90"
              >
                <Plus className="h-3.5 w-3.5" />
                记录
              </button>
            </>
          )}
          {activeTab === "quotes" && (
            <button
              onClick={() => setShowCreateQuote(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
            >
              <Plus className="h-3.5 w-3.5" />
              新建报价
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "timeline" && (
        <InteractionTimeline interactions={customer.interactions} />
      )}
      {activeTab === "quotes" && (
        <QuotesList
          quotes={customer.quotes}
          customerEmail={customer.email}
          onSendEmail={handleSendEmail}
        />
      )}
      {activeTab === "orders" && <OrdersList orders={customer.blindsOrders} />}
      {activeTab === "coaching" && <CoachingPanel customerId={customer.id} />}

      {/* Add Interaction Dialog */}
      <AddInteractionDialog
        open={showAddInteraction}
        onOpenChange={setShowAddInteraction}
        customerId={customer.id}
        opportunities={customer.opportunities}
        onSuccess={() => {
          setShowAddInteraction(false);
          loadCustomer();
        }}
      />

      {/* Import Conversation Dialog */}
      <ImportConversationDialog
        open={showImportConvo}
        onOpenChange={setShowImportConvo}
        customerId={customer.id}
        onSuccess={() => {
          setShowImportConvo(false);
          loadCustomer();
        }}
      />

      {/* Create Quote Dialog */}
      <CreateQuoteDialog
        open={showCreateQuote}
        onOpenChange={setShowCreateQuote}
        customerId={customer.id}
        opportunities={customer.opportunities}
        onSuccess={() => {
          setShowCreateQuote(false);
          setActiveTab("quotes");
          loadCustomer();
        }}
      />

      {/* Sending email overlay */}
      {sendingEmailFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-xl bg-white px-6 py-4 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <span className="text-sm font-medium">正在发送报价邮件…</span>
          </div>
        </div>
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

const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  sent: "已发送",
  accepted: "已接受",
  rejected: "已拒绝",
};
const QUOTE_STATUS_COLOR: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

/* ── Quotes List ── */
function QuotesList({
  quotes,
  customerEmail,
  onSendEmail,
}: {
  quotes: Quote[];
  customerEmail: string | null;
  onSendEmail: (quoteId: string) => void;
}) {
  if (quotes.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted">
        <FileText className="h-8 w-8 opacity-30" />
        <p className="mt-2 text-sm">暂无报价记录</p>
      </div>
    );
  }

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
                  QUOTE_STATUS_COLOR[q.status] || "bg-gray-100 text-gray-600"
                )}
              >
                {QUOTE_STATUS_LABEL[q.status] || q.status}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {q.status === "draft" && customerEmail && (
                <button
                  onClick={() => onSendEmail(q.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors"
                >
                  <Send className="h-3 w-3" />
                  发送邮件
                </button>
              )}
              <span className="text-sm font-semibold text-foreground">
                ${q.grandTotal.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-xs text-muted">
              {q.items.length} 项产品 ·{" "}
              {new Date(q.createdAt).toLocaleDateString("zh-CN")}
            </span>
            <div className="flex flex-wrap gap-1">
              {q.items.slice(0, 3).map((item) => (
                <span key={item.id} className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted">
                  {item.product} - {item.fabric}
                </span>
              ))}
              {q.items.length > 3 && (
                <span className="text-[10px] text-muted">+{q.items.length - 3}</span>
              )}
            </div>
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

/* ── Add Interaction Dialog (shadcn/ui) ── */
function AddInteractionDialog({
  open,
  onOpenChange,
  customerId,
  opportunities,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  opportunities: Opportunity[];
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>记录互动</DialogTitle>
          <DialogDescription>记录与客户的沟通互动</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>类型</Label>
              <ShadSelect
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone_call">电话</SelectItem>
                  <SelectItem value="wechat">微信</SelectItem>
                  <SelectItem value="email">邮件</SelectItem>
                  <SelectItem value="in_person">面谈</SelectItem>
                  <SelectItem value="note">备注</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1.5">
              <Label>方向</Label>
              <ShadSelect
                value={form.direction || "none"}
                onValueChange={(v) => setForm({ ...form, direction: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不适用</SelectItem>
                  <SelectItem value="outbound">发出</SelectItem>
                  <SelectItem value="inbound">收到</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
          </div>

          {opportunities.length > 0 && (
            <div className="space-y-1.5">
              <Label>关联机会</Label>
              <ShadSelect
                value={form.opportunityId || "none"}
                onValueChange={(v) => setForm({ ...form, opportunityId: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="不关联" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联</SelectItem>
                  {opportunities.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>摘要 *</Label>
            <Input
              placeholder="简要描述这次互动…"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>详细内容</Label>
            <textarea
              className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:border-accent/30 h-24 resize-none"
              placeholder="可选：详细内容…"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !form.summary.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Create Quote Dialog ── */
interface QuoteLineItem {
  product: string;
  fabric: string;
  widthIn: string;
  heightIn: string;
  cordless: boolean;
  location: string;
}

interface ProductOption {
  name: string;
  fabrics: string[];
}

interface PreviewResult {
  grandTotal: number;
  merchSubtotal: number;
  installApplied: number;
  deliveryFee: number;
  taxAmount: number;
  itemResults: { price: number; install: number; msrp: number; discountPct: number }[];
  errors: { index: number; error: string }[];
}

function CreateQuoteDialog({
  open,
  onOpenChange,
  customerId,
  opportunities,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  opportunities: Opportunity[];
  onSuccess: () => void;
}) {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [opportunityId, setOpportunityId] = useState("");
  const [installMode, setInstallMode] = useState<"default" | "pickup">("default");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<QuoteLineItem[]>([
    { product: "", fabric: "", widthIn: "", heightIn: "", cordless: false, location: "" },
  ]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch("/api/sales/quotes/preview")
      .then((r) => r.json())
      .then((d) => setProducts(d.products || []))
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  }, []);

  const updateItem = (idx: number, patch: Partial<QuoteLineItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    setPreview(null);
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
    setPreview(null);
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { product: "", fabric: "", widthIn: "", heightIn: "", cordless: false, location: "" },
    ]);
  };

  const canPreview = items.every(
    (it) => it.product && it.fabric && Number(it.widthIn) > 0 && Number(it.heightIn) > 0
  );

  const handlePreview = async () => {
    if (!canPreview) return;
    setPreviewLoading(true);
    try {
      const apiItems = items.map((it) => ({
        product: it.product,
        fabric: it.fabric,
        widthIn: Number(it.widthIn),
        heightIn: Number(it.heightIn),
        cordless: it.cordless,
        location: it.location || undefined,
      }));
      const res = await apiFetch("/api/sales/quotes/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: apiItems, installMode }),
      });
      const data = await res.json();
      setPreview(data);
    } catch (err) {
      console.error(err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!canPreview) return;
    setSaving(true);
    try {
      const apiItems = items.map((it) => ({
        product: it.product,
        fabric: it.fabric,
        widthIn: Number(it.widthIn),
        heightIn: Number(it.heightIn),
        cordless: it.cordless,
        location: it.location || undefined,
      }));
      const res = await apiFetch("/api/sales/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          opportunityId: opportunityId || undefined,
          items: apiItems,
          installMode,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "创建报价失败");
        return;
      }
      onSuccess();
    } catch (err) {
      console.error(err);
      alert("创建报价失败");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/20";

  const getFabrics = (productName: string) =>
    products.find((p) => p.name === productName)?.fabrics || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新建报价</DialogTitle>
          <DialogDescription>为客户创建窗饰产品报价</DialogDescription>
        </DialogHeader>

        {loadingProducts ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Options row */}
            <div className="grid grid-cols-2 gap-3">
              {opportunities.length > 0 && (
                <div className="space-y-1.5">
                  <Label>关联机会</Label>
                  <ShadSelect
                    value={opportunityId || "none"}
                    onValueChange={(v) => setOpportunityId(v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="不关联" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不关联</SelectItem>
                      {opportunities.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>安装方式</Label>
                <ShadSelect
                  value={installMode}
                  onValueChange={(v) => {
                    setInstallMode(v as "default" | "pickup");
                    setPreview(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">上门安装</SelectItem>
                    <SelectItem value="pickup">自取 (无安装费)</SelectItem>
                  </SelectContent>
                </ShadSelect>
              </div>
            </div>

            {/* Line items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  产品明细 ({items.length})
                </span>
                <button
                  onClick={addItem}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  添加产品
                </button>
              </div>

              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border/60 bg-white/50 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted">#{idx + 1}</span>
                    {items.length > 1 && (
                      <button
                        onClick={() => removeItem(idx)}
                        className="text-muted hover:text-red-500 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">产品</label>
                      <select
                        className={inputClass}
                        value={item.product}
                        onChange={(e) => updateItem(idx, { product: e.target.value, fabric: "" })}
                      >
                        <option value="">选择产品…</option>
                        {products.map((p) => (
                          <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">面料/系列</label>
                      <select
                        className={inputClass}
                        value={item.fabric}
                        onChange={(e) => updateItem(idx, { fabric: e.target.value })}
                        disabled={!item.product}
                      >
                        <option value="">选择面料…</option>
                        {getFabrics(item.product).map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">宽 (inch)</label>
                      <Input
                        type="number"
                        placeholder="宽"
                        value={item.widthIn}
                        min={1}
                        onChange={(e) => updateItem(idx, { widthIn: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">高 (inch)</label>
                      <Input
                        type="number"
                        placeholder="高"
                        value={item.heightIn}
                        min={1}
                        onChange={(e) => updateItem(idx, { heightIn: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">位置</label>
                      <Input
                        placeholder="可选"
                        value={item.location}
                        onChange={(e) => updateItem(idx, { location: e.target.value })}
                      />
                    </div>
                    <div className="flex items-end pb-0.5">
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-muted cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={item.cordless}
                          onChange={(e) => updateItem(idx, { cordless: e.target.checked })}
                        />
                        无绳
                      </label>
                    </div>
                  </div>
                  {preview?.itemResults[idx] && (
                    <div className="flex items-center gap-3 rounded bg-accent/5 px-2 py-1 text-[11px]">
                      <span className="text-muted">MSRP ${preview.itemResults[idx].msrp}</span>
                      <span className="text-muted">折后 ${preview.itemResults[idx].price.toFixed(2)}</span>
                      <span className="text-muted">安装 ${preview.itemResults[idx].install.toFixed(2)}</span>
                    </div>
                  )}
                  {preview?.errors.find((e) => e.index === idx) && (
                    <p className="text-[11px] text-red-500">
                      {preview.errors.find((e) => e.index === idx)!.error}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>备注</Label>
              <textarea
                className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:border-accent/30 h-16 resize-none"
                placeholder="可选备注…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Preview summary */}
            {preview && preview.itemResults.length > 0 && (
              <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 space-y-1 text-sm">
                <div className="flex justify-between text-muted">
                  <span>产品小计</span><span>${preview.merchSubtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>安装费</span><span>${preview.installApplied.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>配送费</span><span>${preview.deliveryFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>税费 (HST)</span><span>${preview.taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-accent/20 pt-1 font-semibold text-foreground">
                  <span>总计</span><span>${preview.grandTotal.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                variant="secondary"
                onClick={handlePreview}
                disabled={!canPreview || previewLoading}
              >
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                计算价格
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                <Button variant="accent" onClick={handleSubmit} disabled={saving || !canPreview}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  创建报价
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Import Conversation Dialog ── */
function ImportConversationDialog({
  open,
  onOpenChange,
  customerId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  onSuccess: () => void;
}) {
  const [channel, setChannel] = useState("wechat");
  const [rawText, setRawText] = useState("");
  const [importing, setImporting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{
    id: string;
    messageCount: number;
    language: string;
    topicTags: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const CHANNELS = [
    { key: "wechat", label: "微信", hint: "粘贴微信聊天记录导出" },
    { key: "xiaohongshu", label: "小红书", hint: "粘贴小红书私信对话" },
    { key: "facebook", label: "Facebook", hint: "粘贴 Messenger 对话" },
    { key: "email", label: "邮件", hint: "粘贴邮件往来内容" },
  ];

  async function handleImport() {
    if (!rawText.trim()) {
      setError("请粘贴对话内容");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/sales/conversations/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, channel, rawText }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "导入失败");
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setImporting(false);
    }
  }

  async function handleExtractKnowledge() {
    if (!result?.id) return;
    setExtracting(true);
    try {
      await apiFetch("/api/sales/knowledge/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId: result.id }),
      });
    } catch {
      // non-critical
    } finally {
      setExtracting(false);
      onSuccess();
    }
  }

  function handleReset() {
    setRawText("");
    setResult(null);
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入对话记录</DialogTitle>
          <DialogDescription>
            粘贴聊天记录，系统会自动解析并提取知识
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>渠道</Label>
              <div className="grid grid-cols-4 gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch.key}
                    onClick={() => setChannel(ch.key)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                      channel === ch.key
                        ? "border-foreground bg-foreground text-white"
                        : "border-border bg-white/80 text-muted hover:text-foreground"
                    )}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted">
                {CHANNELS.find((c) => c.key === channel)?.hint}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>对话内容</Label>
              <textarea
                className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 h-48 resize-none font-mono text-xs leading-relaxed"
                placeholder={
                  channel === "wechat"
                    ? "2024-03-15 14:23 张三\n你好，想问一下窗帘价格\n\n2024-03-15 14:25 Sunny Shutter\n您好！请问是什么窗型呢？\n\n或简化格式：\n客户: 你好，想问价格\n我: 您好！什么窗型？"
                    : channel === "email"
                    ? "From: customer@email.com\nSubject: Quote for blinds\n\nHi, I'd like to get a quote...\n---\nFrom: sunny@shutter.com\n\nDear Customer, ..."
                    : "客户: 你好\n我: 您好！有什么可以帮您的？"
                }
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
            </div>

            {error && (
              <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                onClick={handleImport}
                disabled={!rawText.trim() || importing}
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                导入解析
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-success-bg px-4 py-3 text-sm text-success">
              导入成功！解析了 {result.messageCount} 条消息
              <span className="ml-2 text-xs opacity-70">
                语言: {result.language === "zh" ? "中文" : result.language === "en" ? "英文" : "中英混合"}
              </span>
            </div>

            {result.topicTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.topicTags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={handleReset}>
                继续导入
              </Button>
              <Button
                variant="secondary"
                onClick={handleExtractKnowledge}
                disabled={extracting}
              >
                {extracting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Brain className="h-4 w-4" />
                )}
                提取知识
              </Button>
              <Button onClick={onSuccess}>完成</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── AI Advice Panel ── */
interface AiProfile {
  customerType?: string | null;
  budgetRange?: string | null;
  communicationStyle?: string | null;
  decisionSpeed?: string | null;
  keyNeeds?: string[];
  objectionHistory?: string[];
  priceSensitivity?: number | null;
  winProbability?: number | null;
  confidence?: number;
  productPreferences?: string[];
}

const PROFILE_LABELS: Record<string, string> = {
  residential: "住宅客户", commercial: "商业客户", designer: "设计师",
  contractor: "承包商", developer: "开发商",
  economy: "经济型", mid_range: "中端", premium: "高端", luxury: "奢华",
  fast: "快速", moderate: "一般", slow: "慢",
};

function ProfileBadge({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg bg-white/60 border border-border/50 px-2.5 py-1.5 min-w-[70px]">
      <span className="text-[10px] text-muted">{label}</span>
      <span className="text-xs font-medium text-foreground">{PROFILE_LABELS[value] || value}</span>
    </div>
  );
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  const textColor = score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-600" : "text-red-600";
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-lg font-bold", textColor)}>{score}</span>
      <div className="flex-1">
        <div className="h-2 rounded-full bg-muted/20 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
        </div>
        <span className="text-[10px] text-muted">Deal 健康度</span>
      </div>
    </div>
  );
}

function AiAdvicePanel({ customerId }: { customerId: string }) {
  const [advice, setAdvice] = useState<string | null>(null);
  const [profile, setProfile] = useState<AiProfile | null>(null);
  const [dealHealth, setDealHealth] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchAdvice = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/sales/customers/${customerId}/ai-advice`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setAdvice(data.advice || null);
        setProfile(data.profile || null);
        setDealHealth(data.dealHealth || 0);
        setExpanded(true);
      }
    } catch (err) {
      console.error("AI advice failed:", err);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  return (
    <div className="rounded-xl border border-accent/20 bg-accent/[0.02]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">AI 销售助手</h3>
          {profile && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              画像置信度 {((profile.confidence ?? 0) * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {advice && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-muted hover:text-foreground"
            >
              {expanded ? "收起" : "展开"}
            </button>
          )}
          <button
            onClick={fetchAdvice}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : advice ? (
              <RefreshCw className="h-3 w-3" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {advice ? "重新分析" : "AI 分析"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-accent/10">
          {/* Profile + Health Row */}
          {(profile || dealHealth > 0) && (
            <div className="px-4 py-3 space-y-3">
              {dealHealth > 0 && <HealthBar score={dealHealth} />}

              {profile && (
                <div className="flex flex-wrap gap-2">
                  <ProfileBadge label="类型" value={profile.customerType} />
                  <ProfileBadge label="预算" value={profile.budgetRange} />
                  <ProfileBadge label="决策" value={profile.decisionSpeed} />
                  <ProfileBadge label="沟通" value={profile.communicationStyle} />
                  {profile.winProbability != null && (
                    <div className="flex flex-col items-center gap-0.5 rounded-lg bg-white/60 border border-border/50 px-2.5 py-1.5 min-w-[70px]">
                      <span className="text-[10px] text-muted">赢率</span>
                      <span className={cn(
                        "text-xs font-bold",
                        profile.winProbability >= 0.6 ? "text-emerald-600" : profile.winProbability >= 0.3 ? "text-amber-600" : "text-red-600"
                      )}>
                        {(profile.winProbability * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {profile.priceSensitivity != null && (
                    <div className="flex flex-col items-center gap-0.5 rounded-lg bg-white/60 border border-border/50 px-2.5 py-1.5 min-w-[70px]">
                      <span className="text-[10px] text-muted">价格敏感</span>
                      <span className="text-xs font-medium text-foreground">
                        {profile.priceSensitivity >= 0.7 ? "高" : profile.priceSensitivity >= 0.4 ? "中" : "低"}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {profile?.keyNeeds && (profile.keyNeeds as string[]).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] text-muted mr-1">需求:</span>
                  {(profile.keyNeeds as string[]).map((n, i) => (
                    <span key={i} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
                      {n}
                    </span>
                  ))}
                </div>
              )}

              {profile?.objectionHistory && (profile.objectionHistory as string[]).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] text-muted mr-1">异议:</span>
                  {(profile.objectionHistory as string[]).map((o, i) => (
                    <span key={i} className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-700">
                      {o}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Advice Text */}
          {advice && (
            <div className="border-t border-accent/10 px-4 py-3">
              <div className="prose-ai text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {advice}
              </div>
            </div>
          )}
        </div>
      )}

      {!advice && !loading && (
        <div className="px-4 pb-3">
          <p className="text-xs text-muted/60">
            点击"AI 分析"，AI 将综合客户画像、知识库和历史数据给出策略建议
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Coaching Panel ── */

interface CoachingRecordItem {
  id: string;
  coachingType: string;
  recommendation: string;
  adopted: boolean | null;
  outcome: string | null;
  contributionScore: number | null;
  createdAt: string;
  opportunity?: { title: string; stage: string } | null;
  insight?: { title: string; insightType: string; effectiveness: number } | null;
}

interface CoachingStatsData {
  total: number;
  adopted: number;
  adoptionRate: number;
  wonWithAdoption: number;
  avgContribution: number;
}

const COACHING_TYPE_LABELS: Record<string, string> = {
  tactic: "策略",
  objection_response: "异议应对",
  email_draft: "邮件话术",
  next_action: "下一步",
};

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  won: { label: "成单", color: "text-emerald-600 bg-emerald-50" },
  lost: { label: "丢单", color: "text-red-600 bg-red-50" },
  still_open: { label: "进行中", color: "text-blue-600 bg-blue-50" },
};

function CoachingPanel({ customerId }: { customerId: string }) {
  const [records, setRecords] = useState<CoachingRecordItem[]>([]);
  const [stats, setStats] = useState<CoachingStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/sales/coaching?customerId=${customerId}&stats=true`
      );
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records ?? []);
        setStats(data.stats ?? null);
      }
    } catch (err) {
      console.error("Load coaching failed:", err);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAdopt = async (recordId: string, adopted: boolean) => {
    setUpdatingId(recordId);
    try {
      await apiFetch(`/api/sales/coaching/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adopted }),
      });
      loadData();
    } catch {
      // ignore
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-white/70 p-3 text-center">
            <p className="text-lg font-bold text-foreground">{stats.total}</p>
            <p className="text-[10px] text-muted">总建议</p>
          </div>
          <div className="rounded-lg border border-border bg-white/70 p-3 text-center">
            <p className="text-lg font-bold text-accent">
              {(stats.adoptionRate * 100).toFixed(0)}%
            </p>
            <p className="text-[10px] text-muted">采纳率</p>
          </div>
          <div className="rounded-lg border border-border bg-white/70 p-3 text-center">
            <p className="text-lg font-bold text-emerald-600">{stats.wonWithAdoption}</p>
            <p className="text-[10px] text-muted">采纳后成单</p>
          </div>
          <div className="rounded-lg border border-border bg-white/70 p-3 text-center">
            <p className="text-lg font-bold text-foreground">
              {(stats.avgContribution * 100).toFixed(0)}%
            </p>
            <p className="text-[10px] text-muted">平均贡献度</p>
          </div>
        </div>
      )}

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white/40 py-12">
          <Brain className="h-8 w-8 text-muted/40" />
          <p className="mt-3 text-sm text-muted">暂无 AI 建议记录</p>
          <p className="mt-1 text-xs text-muted/60">
            当 AI 给出跟进建议时，记录将自动显示在这里
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((record) => {
            const isUpdating = updatingId === record.id;
            const outcomeInfo = record.outcome ? OUTCOME_LABELS[record.outcome] : null;

            return (
              <div
                key={record.id}
                className="rounded-lg border border-border bg-white/80 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                        {COACHING_TYPE_LABELS[record.coachingType] || record.coachingType}
                      </span>
                      {record.insight && (
                        <span className="text-[10px] text-muted">
                          基于: {record.insight.title}
                        </span>
                      )}
                      {outcomeInfo && (
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", outcomeInfo.color)}>
                          {outcomeInfo.label}
                        </span>
                      )}
                      {record.contributionScore != null && record.outcome && (
                        <span className="text-[10px] text-muted">
                          贡献度 {(record.contributionScore * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm text-foreground leading-relaxed line-clamp-3">
                      {record.recommendation}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                      <span>{new Date(record.createdAt).toLocaleDateString("zh-CN")}</span>
                      {record.opportunity && (
                        <span>· {record.opportunity.title}</span>
                      )}
                    </div>
                  </div>

                  {/* Adoption buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    {record.adopted === null ? (
                      <>
                        <button
                          onClick={() => handleAdopt(record.id, true)}
                          disabled={isUpdating}
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                        >
                          {isUpdating ? "…" : "采纳"}
                        </button>
                        <button
                          onClick={() => handleAdopt(record.id, false)}
                          disabled={isUpdating}
                          className="rounded-md border border-border bg-white px-2 py-1 text-[10px] font-medium text-muted hover:text-foreground disabled:opacity-50 transition-colors"
                        >
                          忽略
                        </button>
                      </>
                    ) : (
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        record.adopted ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                      )}>
                        {record.adopted ? "✓ 已采纳" : "已忽略"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
