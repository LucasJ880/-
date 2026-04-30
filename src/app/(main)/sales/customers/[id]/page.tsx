"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
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
  Pencil,
  ImageIcon,
} from "lucide-react";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomerDetail, STAGE_LABELS, STAGE_COLORS } from "./types";
import { AiAdvicePanel } from "./ai-advice-panel";
import { InteractionTimeline } from "./interaction-timeline";
import { QuotesList } from "./quotes-list";
import { OrdersList } from "./orders-list";
import { CoachingPanel } from "./coaching-panel";
import { VisualizerList } from "./visualizer-list";
import type { VisualizerSessionSummary } from "@/lib/visualizer/types";
import { AddInteractionDialog } from "./add-interaction-dialog";
import { ImportConversationDialog } from "./import-conversation-dialog";
import { CreateQuoteDialog } from "./create-quote-dialog";
import { useSwipeable } from "@/lib/hooks/use-swipeable";
import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id";
import {
  isSalesOrgCreateBlocked,
  salesOrgCreateBlockedHint,
  withSalesOrgId,
} from "@/lib/sales/sales-client-org";

const CUSTOMER_SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "referral", label: "转介绍" },
  { value: "google_ads", label: "Google Ads" },
  { value: "walk_in", label: "上门" },
  { value: "wechat", label: "微信" },
  { value: "phone", label: "电话" },
  { value: "other", label: "其他" },
];

const CUSTOMER_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "active", label: "跟进中" },
  { value: "completed", label: "已完成" },
  { value: "dormant", label: "休眠" },
];

type BasicInfoDraft = {
  name: string;
  phone: string;
  email: string;
  address: string;
  source: string;
  wechatNote: string;
  status: string;
  tags: string;
  notes: string;
};

function formatCustomerSourceLabel(source: string | null): string {
  if (!source) return "—";
  const hit = CUSTOMER_SOURCE_OPTIONS.find((o) => o.value === source);
  return hit?.label ?? source;
}

function formatCustomerStatusLabel(status: string | null): string {
  if (!status) return "—";
  const hit = CUSTOMER_STATUS_OPTIONS.find((o) => o.value === status);
  return hit?.label ?? status;
}

function customerToDraft(c: CustomerDetail): BasicInfoDraft {
  return {
    name: c.name ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    address: c.address ?? "",
    source: c.source ?? "",
    wechatNote: c.wechatNote ?? "",
    status: c.status ?? "active",
    tags: c.tags ?? "",
    notes: c.notes ?? "",
  };
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useSalesCurrentOrgId();
  const orgCreateBlocked = isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId);
  const { user, loading: userLoading, isSuperAdmin } = useCurrentUser();
  const canDeleteCustomer = isSuperAdmin;
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [visSessions, setVisSessions] = useState<VisualizerSessionSummary[]>([]);
  const [showAddInteraction, setShowAddInteraction] = useState(false);
  const [showCreateQuote, setShowCreateQuote] = useState(false);
  const [showImportConvo, setShowImportConvo] = useState(false);
  const [sendingEmailFor, setSendingEmailFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openingVisualizerFor, setOpeningVisualizerFor] = useState<string | null>(
    null,
  );
  const [editingBasic, setEditingBasic] = useState(false);
  const [basicDraft, setBasicDraft] = useState<BasicInfoDraft | null>(null);
  const [basicSaving, setBasicSaving] = useState(false);
  const [basicError, setBasicError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "timeline" | "quotes" | "orders" | "visualizer" | "coaching"
  >("timeline");
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);
  const TAB_ORDER: (
    | "timeline"
    | "quotes"
    | "orders"
    | "visualizer"
    | "coaching"
  )[] = ["timeline", "quotes", "orders", "visualizer", "coaching"];
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

  // 视觉方案 sessions（用于在 opp 行 / quote 行挂封面）
  const loadVisualizerSessions = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/visualizer/sessions?customerId=${encodeURIComponent(id)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { sessions?: VisualizerSessionSummary[] };
      setVisSessions(data.sessions ?? []);
    } catch (err) {
      console.error("Load visualizer sessions failed:", err);
    }
  }, [id]);

  useEffect(() => {
    loadCustomer();
    loadVisualizerSessions();
  }, [loadCustomer, loadVisualizerSessions]);

  // opp → 最新 session 封面（sessions 已按 updatedAt desc）
  const oppIdToCover = useMemo(() => {
    const map = new Map<string, { sessionId: string; cover: string | null }>();
    for (const s of visSessions) {
      if (!s.opportunityId) continue;
      if (map.has(s.opportunityId)) continue;
      map.set(s.opportunityId, {
        sessionId: s.id,
        cover: s.previewImages[0] ?? null,
      });
    }
    return map;
  }, [visSessions]);

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

  /**
   * 在客户/机会上下文下幂等打开 Visualizer：
   * - 有同 (customerId, opportunityId?) 的活跃 session → 复用最新
   * - 没有则创建并跳转
   * opportunityId 传 null 时等价于客户级方案（不挂任何机会）
   */
  const handleOpenVisualizer = async (opportunityId: string | null) => {
    if (!customer) return;
    const key = opportunityId ?? "__customer__";
    if (openingVisualizerFor) return;
    setOpeningVisualizerFor(key);
    try {
      const res = await apiFetch("/api/visualizer/sessions/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          opportunityId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "打开失败",
        );
        return;
      }
      const sessionId = (data as { session?: { id?: string } }).session?.id;
      if (!sessionId) {
        alert("后端未返回 session id");
        return;
      }
      router.push(`/sales/visualizer/${sessionId}`);
    } catch (err) {
      console.error("Open visualizer failed:", err);
      alert("网络错误，无法打开方案");
    } finally {
      setOpeningVisualizerFor(null);
    }
  };

  const handleSendEmail = async (quoteId: string) => {
    if (!customer?.email || sendingEmailFor) return;
    if (orgCreateBlocked) {
      alert(salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? "无法发送");
      return;
    }
    setSendingEmailFor(quoteId);
    try {
      const res = await apiFetch(`/api/sales/quotes/${quoteId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withSalesOrgId(orgId!, { to: customer.email })),
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

  const canEditBasicInfo =
    !userLoading &&
    !!user &&
    (isSuperAdmin ||
      (!!customer.createdById &&
        customer.createdById === user.id &&
        user.canEditCustomers !== false));

  let noEditBasicHint: string | null = null;
  if (!canEditBasicInfo && !userLoading && user && !isSuperAdmin) {
    if (!customer.createdById) {
      noEditBasicHint = "客户档案缺少创建人信息，仅管理员可修改。";
    } else if (customer.createdById !== user.id) {
      noEditBasicHint = "你不是该客户的创建人，无法在此修改档案。";
    } else if (user.canEditCustomers === false) {
      noEditBasicHint = "管理员暂未授权你修改客户信息。";
    }
  }

  const startBasicEdit = () => {
    setBasicDraft(customerToDraft(customer));
    setBasicError(null);
    setEditingBasic(true);
  };

  const cancelBasicEdit = () => {
    setEditingBasic(false);
    setBasicDraft(null);
    setBasicError(null);
  };

  const saveBasicEdit = async () => {
    if (!basicDraft) return;
    if (!basicDraft.name.trim()) {
      setBasicError("客户名称不能为空");
      return;
    }
    setBasicSaving(true);
    setBasicError(null);
    try {
      const res = await apiFetch(`/api/sales/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: basicDraft.name.trim(),
          phone: basicDraft.phone.trim() || null,
          email: basicDraft.email.trim() || null,
          address: basicDraft.address.trim() || null,
          source: basicDraft.source.trim() || null,
          wechatNote: basicDraft.wechatNote.trim() || null,
          status: basicDraft.status.trim() || "active",
          tags: basicDraft.tags.trim() || null,
          notes: basicDraft.notes.trim() || null,
        }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBasicError(
          typeof (raw as { error?: unknown }).error === "string"
            ? (raw as { error: string }).error
            : "保存失败",
        );
        return;
      }
      const data = raw as Partial<CustomerDetail>;
      setCustomer((prev) =>
        prev
          ? {
              ...prev,
              ...data,
              opportunities: prev.opportunities,
              interactions: prev.interactions,
              quotes: prev.quotes,
              blindsOrders: prev.blindsOrders,
            }
          : null,
      );
      setEditingBasic(false);
      setBasicDraft(null);
    } catch {
      setBasicError("网络错误");
    } finally {
      setBasicSaving(false);
    }
  };

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

      {!orgLoading && ambiguous && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {salesOrgCreateBlockedHint(false, true, null)}
        </div>
      )}

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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">基本信息</h3>
            {canEditBasicInfo && !editingBasic && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={startBasicEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </Button>
            )}
            {canEditBasicInfo && editingBasic && basicDraft && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={cancelBasicEdit}
                  disabled={basicSaving}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void saveBasicEdit()}
                  disabled={basicSaving}
                >
                  {basicSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  保存
                </Button>
              </div>
            )}
          </div>

          {noEditBasicHint && (
            <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
              {noEditBasicHint}
            </p>
          )}

          {editingBasic && basicDraft ? (
            <div className="mt-3 space-y-3 text-sm">
              {basicError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  {basicError}
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="cust-name">客户名称</Label>
                <Input
                  id="cust-name"
                  value={basicDraft.name}
                  onChange={(e) => setBasicDraft({ ...basicDraft, name: e.target.value })}
                  disabled={basicSaving}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cust-phone">电话</Label>
                  <Input
                    id="cust-phone"
                    value={basicDraft.phone}
                    onChange={(e) => setBasicDraft({ ...basicDraft, phone: e.target.value })}
                    disabled={basicSaving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cust-email">邮箱</Label>
                  <Input
                    id="cust-email"
                    type="email"
                    value={basicDraft.email}
                    onChange={(e) => setBasicDraft({ ...basicDraft, email: e.target.value })}
                    disabled={basicSaving}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-address">地址</Label>
                <Input
                  id="cust-address"
                  value={basicDraft.address}
                  onChange={(e) => setBasicDraft({ ...basicDraft, address: e.target.value })}
                  disabled={basicSaving}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>来源</Label>
                  <ShadSelect
                    value={!basicDraft.source ? "__empty" : basicDraft.source}
                    onValueChange={(v) =>
                      setBasicDraft({ ...basicDraft, source: v === "__empty" ? "" : v })
                    }
                    disabled={basicSaving}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="请选择…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__empty">未指定</SelectItem>
                      {CUSTOMER_SOURCE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                      {basicDraft.source &&
                        !CUSTOMER_SOURCE_OPTIONS.some((o) => o.value === basicDraft.source) && (
                          <SelectItem value={basicDraft.source}>
                            当前值：{basicDraft.source}
                          </SelectItem>
                        )}
                    </SelectContent>
                  </ShadSelect>
                </div>
                <div className="space-y-1.5">
                  <Label>客户状态</Label>
                  <ShadSelect
                    value={basicDraft.status || "active"}
                    onValueChange={(v) => setBasicDraft({ ...basicDraft, status: v })}
                    disabled={basicSaving}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOMER_STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                      {basicDraft.status &&
                        !CUSTOMER_STATUS_OPTIONS.some((o) => o.value === basicDraft.status) && (
                          <SelectItem value={basicDraft.status}>
                            当前值：{basicDraft.status}
                          </SelectItem>
                        )}
                    </SelectContent>
                  </ShadSelect>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-wechat">微信 / 备注</Label>
                <Input
                  id="cust-wechat"
                  value={basicDraft.wechatNote}
                  onChange={(e) => setBasicDraft({ ...basicDraft, wechatNote: e.target.value })}
                  disabled={basicSaving}
                  placeholder="微信号或简短说明"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-tags">标签（逗号分隔）</Label>
                <Input
                  id="cust-tags"
                  value={basicDraft.tags}
                  onChange={(e) => setBasicDraft({ ...basicDraft, tags: e.target.value })}
                  disabled={basicSaving}
                  placeholder="如：门店, 高意向"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-notes">内部备注</Label>
                <textarea
                  id="cust-notes"
                  rows={4}
                  value={basicDraft.notes}
                  onChange={(e) => setBasicDraft({ ...basicDraft, notes: e.target.value })}
                  disabled={basicSaving}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="仅团队内部可见"
                />
              </div>
            </div>
          ) : (
            <>
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
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {customer.source && (
                    <span>来源：{formatCustomerSourceLabel(customer.source)}</span>
                  )}
                  {customer.status && (
                    <span>状态：{formatCustomerStatusLabel(customer.status)}</span>
                  )}
                  {customer.tags && <span>标签：{customer.tags}</span>}
                </div>
              </div>
              {customer.notes && (
                <div className="mt-4 rounded-lg bg-white/50 p-3 text-xs text-muted leading-relaxed">
                  {customer.notes}
                </div>
              )}
            </>
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
              {customer.opportunities.map((opp) => {
                const cover = oppIdToCover.get(opp.id) ?? null;
                return (
                <div
                  key={opp.id}
                  className="flex items-center justify-between rounded-lg border border-border/50 bg-white/50 px-4 py-2.5"
                >
                  {cover && cover.cover && (
                    <Link
                      href={`/sales/visualizer/${cover.sessionId}`}
                      className="mr-3 shrink-0"
                      title="打开方案效果图"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cover.cover}
                        alt={`${opp.title} 方案封面`}
                        className="h-10 w-14 rounded border border-border object-cover"
                      />
                    </Link>
                  )}
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
                    <button
                      type="button"
                      onClick={() => handleOpenVisualizer(opp.id)}
                      disabled={openingVisualizerFor === opp.id}
                      className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-60"
                      title="为该销售机会打开可视化方案"
                    >
                      {openingVisualizerFor === opp.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ImageIcon className="h-3 w-3" />
                      )}
                      可视化方案
                    </button>
                  </div>
                </div>
                );
              })}
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
            { key: "visualizer" as const, label: "可视化方案", shortLabel: "方案", count: 0 },
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
                disabled={orgCreateBlocked}
                title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-white/80 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white disabled:opacity-40"
              >
                <Upload className="h-3.5 w-3.5" />
                导入对话
              </button>
              <button
                onClick={() => setShowAddInteraction(true)}
                disabled={orgCreateBlocked}
                title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
                className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-white hover:bg-foreground/90 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                记录
              </button>
            </>
          )}
          {activeTab === "quotes" && (
            <button
              onClick={() => setShowCreateQuote(true)}
              disabled={orgCreateBlocked}
              title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-40"
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
          disabled={orgCreateBlocked}
          title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
          className="fab md:hidden disabled:opacity-40"
          aria-label="新建互动"
        >
          <Plus size={24} strokeWidth={2.2} />
        </button>
      )}
      {activeTab === "quotes" && (
        <button
          type="button"
          onClick={() => setShowCreateQuote(true)}
          disabled={orgCreateBlocked}
          title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
          className="fab md:hidden disabled:opacity-40"
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
            oppIdToCover={Object.fromEntries(oppIdToCover)}
          />
        )}
        {activeTab === "orders" && <OrdersList orders={customer.blindsOrders} />}
        {activeTab === "visualizer" && (
          <VisualizerList
            customerId={customer.id}
            opportunities={customer.opportunities.map((o) => ({
              id: o.id,
              title: o.title,
              stage: o.stage,
            }))}
          />
        )}
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
