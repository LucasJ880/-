"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  MessageSquare,
  Plus,
  Upload,
  Loader2,
  CalendarDays,
  ChevronDown,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { CustomerDetail, STAGE_LABELS, STAGE_COLORS } from "./types";
import { AiAdvicePanel } from "./ai-advice-panel";
import { InteractionTimeline } from "./interaction-timeline";
import { QuotesList } from "./quotes-list";
import { OrdersList } from "./orders-list";
import { CoachingPanel } from "./coaching-panel";
import { AddInteractionDialog } from "./add-interaction-dialog";
import { ImportConversationDialog } from "./import-conversation-dialog";
import { CreateQuoteDialog } from "./create-quote-dialog";
import { useSwipeable } from "@/lib/hooks/use-swipeable";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isSuperAdmin: canDeleteCustomer } = useCurrentUser();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddInteraction, setShowAddInteraction] = useState(false);
  const [showCreateQuote, setShowCreateQuote] = useState(false);
  const [showImportConvo, setShowImportConvo] = useState(false);
  const [sendingEmailFor, setSendingEmailFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<"timeline" | "quotes" | "orders" | "coaching">(
    "timeline"
  );
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);
  const TAB_ORDER: ("timeline" | "quotes" | "orders" | "coaching")[] = [
    "timeline",
    "quotes",
    "orders",
    "coaching",
  ];
  const swipeHandlers = useSwipeable({
    onSwipeLeft: () => {
      const idx = TAB_ORDER.indexOf(activeTab);
      if (idx < TAB_ORDER.length - 1) setActiveTab(TAB_ORDER[idx + 1]);
    },
    onSwipeRight: () => {
      const idx = TAB_ORDER.indexOf(activeTab);
      if (idx > 0) setActiveTab(TAB_ORDER[idx - 1]);
    },
  });

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

  const handleDeleteCustomer = async () => {
    if (!customer || deleting) return;
    const counts = [
      customer.opportunities?.length
        ? `${customer.opportunities.length} 个销售机会`
        : null,
      customer.quotes?.length ? `${customer.quotes.length} 份报价` : null,
      customer.blindsOrders?.length
        ? `${customer.blindsOrders.length} 个订单`
        : null,
    ]
      .filter(Boolean)
      .join("、");
    const countsHint = counts
      ? `\n该客户关联 ${counts}，删除后将一并归档、不再出现在列表中（数据不会物理删除）。`
      : "";
    if (
      !window.confirm(
        `确定删除客户 "${customer.name}" 吗？${countsHint}\n\n此操作会将客户标记为已归档，销售和 AI 都将看不到该客户。`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/sales/customers/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "删除失败");
        return;
      }
      router.push("/sales");
    } catch (err) {
      console.error("Delete customer failed:", err);
      alert("删除失败");
    } finally {
      setDeleting(false);
    }
  };

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
      <div className="flex items-center gap-3">
        <Link
          href="/sales"
          className="rounded-lg border border-border bg-white/80 p-1.5 text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <PageHeader
            title={customer.name}
            description={`客户 · ${customer.source || "未知来源"} · ${new Date(customer.createdAt).toLocaleDateString("zh-CN")} 创建`}
          />
        </div>
        {canDeleteCustomer && (
          <button
            type="button"
            onClick={handleDeleteCustomer}
            disabled={deleting}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
            title="管理员可删除客户（软删，客户将被归档）"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            删除客户
          </button>
        )}
      </div>

      {/* ───────── Mobile summary bar (默认收起) ───────── */}
      <div className="md:hidden -mt-1 space-y-2">
        <div className="flex items-center gap-2">
          {customer.phone && (
            <a
              href={`tel:${customer.phone}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 active:bg-emerald-100"
            >
              <Phone size={13} />
              呼叫
            </a>
          )}
          {customer.email && (
            <a
              href={`mailto:${customer.email}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 active:bg-blue-100"
            >
              <Mail size={13} />
              邮件
            </a>
          )}
          {customer.address && (
            <a
              href={`https://maps.apple.com/?q=${encodeURIComponent(customer.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/70 px-3 py-1.5 text-xs font-medium text-foreground/80 active:bg-white"
            >
              <MapPin size={13} />
              地图
            </a>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileSummaryOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-white/70 px-3 py-2.5 text-left active:bg-white"
        >
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <Sparkles size={14} className="shrink-0 text-[var(--accent)]" />
            <span className="truncate">
              {customer.opportunities.length > 0
                ? `${customer.opportunities.length} 个销售机会 · 点击查看 AI 建议`
                : "AI 建议与基本信息"}
            </span>
          </div>
          <ChevronDown
            size={16}
            className={cn(
              "shrink-0 text-muted transition-transform duration-200",
              mobileSummaryOpen && "rotate-180"
            )}
          />
        </button>
      </div>

      {/* ───────── AI 建议 + 基本信息 + 机会（desktop 始终显示，mobile 折叠） ───────── */}
      <div
        className={cn(
          "space-y-5",
          !mobileSummaryOpen && "hidden md:block"
        )}
      >
      <AiAdvicePanel customerId={customer.id} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
          <div className="mt-4 flex flex-wrap gap-2">
            {/* 现场量房入口已下线，统一走『电子报价单』 */}
            <Link
              href={`/sales/calendar?customerId=${customer.id}&action=new&type=install`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              <CalendarDays size={13} />
              预约安装
            </Link>
          </div>
        </div>

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
      </div>

      <div className="-mx-4 md:mx-0 flex items-center gap-1 overflow-x-auto border-b border-border px-4 md:px-0 scrollbar-hide">
        {(
          [
            { key: "timeline" as const, label: "互动时间线", shortLabel: "互动", count: customer.interactions.length },
            { key: "quotes" as const, label: "报价记录", shortLabel: "报价", count: customer.quotes.length },
            { key: "orders" as const, label: "工艺单", shortLabel: "工艺单", count: customer.blindsOrders.length },
            { key: "coaching" as const, label: "AI 建议", shortLabel: "AI", count: 0 },
          ]
        ).map((tab) => (
          <button
            key={tab.key}
            className={cn(
              "shrink-0 border-b-2 px-3 md:px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="hidden md:inline">{tab.label}</span>
            <span className="md:hidden">{tab.shortLabel}</span>
            {tab.count > 0 && (
              <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px]">
                {tab.count}
              </span>
            )}
          </button>
        ))}

        {/* Desktop action buttons */}
        <div className="ml-auto hidden md:flex items-center gap-2">
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

      {/* Mobile FAB */}
      {activeTab === "timeline" && (
        <button
          type="button"
          onClick={() => setShowAddInteraction(true)}
          className="fab md:hidden"
          aria-label="新建互动"
        >
          <Plus size={24} strokeWidth={2.2} />
        </button>
      )}
      {activeTab === "quotes" && (
        <button
          type="button"
          onClick={() => setShowCreateQuote(true)}
          className="fab md:hidden"
          aria-label="新建报价"
        >
          <Plus size={24} strokeWidth={2.2} />
        </button>
      )}

      <div {...swipeHandlers}>
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
      </div>

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

      <ImportConversationDialog
        open={showImportConvo}
        onOpenChange={setShowImportConvo}
        customerId={customer.id}
        onSuccess={() => {
          setShowImportConvo(false);
          loadCustomer();
        }}
      />

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
