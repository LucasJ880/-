"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import {
  Sparkles,
  AlertTriangle,
  Clock,
  Loader2,
  RefreshCw,
  CheckCircle2,
  FileText,
  Users,
  Mail,
  TrendingUp,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Zap,
  Send,
  CalendarPlus,
  UserCheck,
  UserX,
  X,
  Edit3,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

// ── 类型 ─────────────────────────────────────────────────────────

interface BriefingAction {
  type: string;
  label: string;
  payload?: Record<string, unknown>;
}

interface BriefingItem {
  id: string;
  domain: string;
  severity: "urgent" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  action?: BriefingAction;
  entityType?: string;
  entityId?: string;
}

interface BriefingData {
  id?: string;
  title: string;
  summary: string;
  priority?: string;
  status?: string;
  totalUrgent: number;
  totalWarning: number;
  totalItems?: number;
  items?: BriefingItem[];
  domains?: { domain: string; itemCount: number; stats: Record<string, number> }[];
}

interface EmailDraft {
  subject: string;
  body: string;
  subjectZh: string;
  bodyZh: string;
  to?: string;
  prospectId: string;
  companyName: string;
}

// ── 样式常量 ─────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  urgent: {
    bg: "bg-red-500/5",
    border: "border-red-500/15",
    text: "text-red-600 dark:text-red-400",
    dot: "bg-red-500",
    icon: AlertTriangle,
  },
  warning: {
    bg: "bg-amber-500/5",
    border: "border-amber-500/15",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    icon: Clock,
  },
  info: {
    bg: "bg-accent/5",
    border: "border-accent/15",
    text: "text-accent",
    dot: "bg-accent",
    icon: CheckCircle2,
  },
} as const;

const CATEGORY_ICONS: Record<string, typeof AlertTriangle> = {
  // 外贸
  followup_overdue: Clock,
  quote_expiring: FileText,
  no_response: Mail,
  prospect_review: Users,
  new_replies: MessageSquare,
  // 销售
  followup_due: Clock,
  quote_pending: FileText,
  stale_opportunity: AlertTriangle,
  upcoming_measure: CalendarPlus,
  upcoming_install: CalendarPlus,
  new_inquiries: TrendingUp,
};

const ACTION_CONFIG: Record<string, { icon: typeof Send; style: string }> = {
  // 外贸
  followup_draft: { icon: Mail, style: "bg-accent/10 text-accent hover:bg-accent/20" },
  quote_extend: { icon: CalendarPlus, style: "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20" },
  prospect_review: { icon: UserCheck, style: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20" },
  view_replies: { icon: MessageSquare, style: "bg-accent/10 text-accent hover:bg-accent/20" },
  // 销售
  view_sales_customer: { icon: Users, style: "bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20" },
  view_sales_board: { icon: TrendingUp, style: "bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20" },
};

// ── 草稿弹窗 ─────────────────────────────────────────────────────

function DraftModal({
  draft,
  onClose,
  onSend,
  sending,
}: {
  draft: EmailDraft;
  onClose: () => void;
  onSend: (edited: { subject: string; body: string; to: string }) => void;
  sending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [to, setTo] = useState(draft.to ?? "");
  const [showZh, setShowZh] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-accent" />
            <h3 className="text-sm font-semibold">AI 邮件草稿 — {draft.companyName}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowZh(!showZh)}
              className="rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground transition-colors"
            >
              {showZh ? "显示原文" : "显示中文"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              className="rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground transition-colors"
            >
              <Edit3 size={11} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="max-h-[60vh] overflow-y-auto p-5 space-y-4">
          {/* 收件人 */}
          <div>
            <label className="text-[11px] font-medium text-muted uppercase tracking-wide">收件人</label>
            {editing ? (
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
                placeholder="email@example.com"
              />
            ) : (
              <p className="mt-1 text-sm text-foreground">{to || "未设置收件人"}</p>
            )}
          </div>

          {/* 主题 */}
          <div>
            <label className="text-[11px] font-medium text-muted uppercase tracking-wide">主题</label>
            {editing ? (
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
            ) : (
              <p className="mt-1 text-sm font-medium text-foreground">
                {showZh ? draft.subjectZh : subject}
              </p>
            )}
          </div>

          {/* 正文 */}
          <div>
            <label className="text-[11px] font-medium text-muted uppercase tracking-wide">正文</label>
            {editing ? (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm leading-relaxed focus:border-accent focus:outline-none resize-y"
              />
            ) : (
              <div className="mt-1 rounded-lg bg-muted/5 px-4 py-3 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {showZh ? draft.bodyZh : body}
              </div>
            )}
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
          <p className="text-[11px] text-muted">
            {to ? `将发送至 ${to}` : "请填写收件人邮箱"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onSend({ subject, body, to })}
              disabled={sending || !to || !subject || !body}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium transition-colors",
                "bg-accent text-white hover:bg-accent/90 disabled:opacity-50",
              )}
            >
              {sending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Send size={12} />
              )}
              {sending ? "发送中..." : "确认发送"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 操作反馈提示 ─────────────────────────────────────────────────

function ActionToast({
  message,
  success,
  onClose,
}: {
  message: string;
  success: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={cn(
      "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 shadow-lg transition-all",
      success
        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        : "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",
    )}>
      {success ? <Check size={14} /> : <X size={14} />}
      <span className="text-sm">{message}</span>
    </div>
  );
}

// ── BriefingItem 卡片（增强版：带一键动作） ─────────────────────

function BriefingItemCard({
  item,
  onAction,
  actionLoading,
}: {
  item: BriefingItem;
  onAction: (item: BriefingItem) => void;
  actionLoading: string | null;
}) {
  const config = SEVERITY_CONFIG[item.severity];
  const Icon = CATEGORY_ICONS[item.category] ?? config.icon;
  const actionCfg = item.action ? ACTION_CONFIG[item.action.type] : null;
  const ActionIcon = actionCfg?.icon ?? Zap;
  const isLoading = actionLoading === item.id;

  const secondaryActions: { type: string; label: string; icon: typeof UserX }[] = [];
  if (item.category === "prospect_review") {
    secondaryActions.push({ type: "prospect_skip", label: "跳过", icon: UserX });
  }

  return (
    <div className={cn(
      "flex items-start gap-3 rounded-lg border px-3.5 py-2.5 transition-colors hover:bg-muted/5",
      config.bg, config.border,
    )}>
      <div className={cn(
        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
        config.bg,
      )}>
        <Icon size={13} className={config.text} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground leading-snug">
          {item.title}
        </p>
        <p className="mt-0.5 text-xs text-muted leading-relaxed">
          {item.description}
        </p>
        {item.action && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onAction(item)}
              disabled={isLoading}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
                actionCfg?.style ?? "bg-accent/10 text-accent hover:bg-accent/20",
              )}
            >
              {isLoading ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <ActionIcon size={10} />
              )}
              {isLoading ? "处理中..." : item.action.label}
            </button>
            {secondaryActions.map((sa) => (
              <button
                key={sa.type}
                type="button"
                onClick={() => onAction({
                  ...item,
                  action: { type: sa.type, label: sa.label, payload: item.action?.payload },
                })}
                disabled={isLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                <sa.icon size={10} />
                {sa.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 主组件 ───────────────────────────────────────────────────────

export function DashboardDailyBriefing() {
  const { orgId: actionOrgId, ambiguous, loading: orgLoading } = useCurrentOrgId();

  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [draftModal, setDraftModal] = useState<EmailDraft | null>(null);
  const [sendingDraft, setSendingDraft] = useState(false);
  const [toast, setToast] = useState<{ message: string; success: boolean } | null>(null);
  const [completedActions, setCompletedActions] = useState<Set<string>>(new Set());
  const didInit = useRef(false);

  const showToast = useCallback((message: string, success: boolean) => {
    setToast({ message, success });
  }, []);

  const fetchBriefing = useCallback(async () => {
    try {
      const res = await apiFetch("/api/secretary/briefing");
      if (res.ok) {
        const data = await res.json();
        if (data.briefing) setBriefing(data.briefing);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (ambiguous || !actionOrgId) {
      showToast("请先选择当前组织后再生成简报。", false);
      return;
    }
    setGenerating(true);
    try {
      const res = await apiFetch("/api/secretary/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: actionOrgId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.briefing) {
          setBriefing({
            title: `今日简报`,
            summary: data.briefing.summary,
            totalUrgent: data.briefing.totalUrgent,
            totalWarning: data.briefing.totalWarning,
            totalItems: data.briefing.totalItems,
            items: data.briefing.items,
            domains: data.briefing.domains,
          });
          setCompletedActions(new Set());
        }
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(j.error ?? "简报生成失败", false);
      }
    } catch { /* ignore */ }
    finally { setGenerating(false); }
  }, [ambiguous, actionOrgId, showToast]);

  const handleAction = useCallback(async (item: BriefingItem) => {
    if (!item.action) return;

    const actionType = item.action.type;
    const payload = item.action.payload;

    // 销售域动作 — 跳转到客户详情或看板
    if (actionType === "view_sales_customer" && payload?.customerId) {
      window.location.href = `/sales/customers/${payload.customerId}`;
      return;
    }
    if (actionType === "view_sales_board") {
      window.location.href = "/sales";
      return;
    }

    if (!item.entityId) return;

    const secretaryTypes = new Set([
      "followup_draft",
      "send_draft",
      "prospect_approve",
      "prospect_skip",
      "quote_extend",
    ]);
    if (secretaryTypes.has(actionType) && !actionOrgId) {
      showToast(
        "你加入了多个组织，请先进入某个组织页面（路径含 /organizations/组织id），或在侧栏将当前组织写入本地选择后再试。",
        false,
      );
      return;
    }

    // 如果跟进引擎已预生成草稿，直接打开弹窗，无需再调 API
    if (actionType === "followup_draft" && payload?.prefilled) {
      const pre = payload.prefilled as { subject: string; body: string; subjectZh: string; bodyZh: string };
      setDraftModal({
        subject: pre.subject,
        body: pre.body,
        subjectZh: pre.subjectZh,
        bodyZh: pre.bodyZh,
        prospectId: item.entityId,
        companyName: (payload.companyName as string) ?? "",
      });
      return;
    }

    setActionLoading(item.id);

    try {
      const res = await apiFetch("/api/secretary/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: actionType,
          entityId: item.entityId,
          orgId: actionOrgId || undefined,
          params: payload,
        }),
      });

      const result = await res.json();

      if (actionType === "followup_draft" && result.success && result.draft) {
        setDraftModal(result.draft);
      } else if (result.success) {
        showToast(result.message, true);
        setCompletedActions((prev) => new Set(prev).add(item.id));
      } else {
        showToast(result.message || "操作失败", false);
      }
    } catch {
      showToast("网络错误，请稍后重试", false);
    } finally {
      setActionLoading(null);
    }
  }, [showToast, actionOrgId]);

  const handleSendDraft = useCallback(async (edited: { subject: string; body: string; to: string }) => {
    if (!draftModal) return;
    if (!actionOrgId) {
      showToast(
        "你加入了多个组织，请先进入某个组织页面或完成组织选择后再发送。",
        false,
      );
      return;
    }
    setSendingDraft(true);

    try {
      const res = await apiFetch("/api/secretary/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "send_draft",
          entityId: draftModal.prospectId,
          orgId: actionOrgId || undefined,
          params: { subject: edited.subject, body: edited.body, to: edited.to },
        }),
      });

      const result = await res.json();
      if (result.success) {
        showToast(result.message, true);
        setDraftModal(null);
        const relatedId = `trade_overdue_${draftModal.prospectId}`;
        const relatedId2 = `trade_noreply_${draftModal.prospectId}`;
        setCompletedActions((prev) => {
          const next = new Set(prev);
          next.add(relatedId);
          next.add(relatedId2);
          return next;
        });
      } else {
        showToast(result.message || "发送失败", false);
      }
    } catch {
      showToast("网络错误，请稍后重试", false);
    } finally {
      setSendingDraft(false);
    }
  }, [draftModal, showToast, actionOrgId]);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    fetchBriefing();
  }, [fetchBriefing]);

  // ── 加载中 ──
  if (loading || orgLoading) {
    return (
      <div className="rounded-xl border border-accent/20 bg-card-bg p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles size={15} className="text-accent" />
          AI 每日简报
        </div>
        <div className="mt-4 flex items-center justify-center py-6">
          <Loader2 size={20} className="animate-spin text-accent/40" />
        </div>
      </div>
    );
  }

  // ── 未生成 ──
  if (!briefing) {
    return (
      <div className="rounded-xl border border-accent/20 bg-card-bg p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={15} className="text-accent" />
            AI 每日简报
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || ambiguous || !actionOrgId}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              "bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50",
            )}
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            {generating ? "生成中..." : "生成今日简报"}
          </button>
        </div>
        <div className="mt-4 flex flex-col items-center gap-2 py-6 text-center">
          <Sparkles size={28} className="text-accent/20" />
          <p className="text-sm text-muted">今日简报尚未生成</p>
          <p className="text-xs text-muted/60">
            点击上方按钮，AI 秘书将为你扫描外贸客户动态并生成简报
          </p>
        </div>
      </div>
    );
  }

  // ── 已有简报 ──
  const allItems = briefing.items ?? [];
  const items = allItems.filter((i) => !completedActions.has(i.id));
  const previewItems = items.slice(0, 4);
  const hasMore = items.length > 4;
  const tradeStats = briefing.domains?.find((d) => d.domain === "trade")?.stats;
  const salesStats = briefing.domains?.find((d) => d.domain === "sales")?.stats;
  const completedCount = completedActions.size;

  return (
    <>
      <div className="rounded-xl border border-accent/20 bg-card-bg">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <h2 className="text-sm font-semibold">AI 每日简报</h2>
            {briefing.totalUrgent > 0 && (
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
                {briefing.totalUrgent} 项紧急
              </span>
            )}
            {briefing.totalWarning > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {briefing.totalWarning} 项关注
              </span>
            )}
            {completedCount > 0 && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                {completedCount} 项已处理
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || ambiguous || !actionOrgId}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw size={11} className={cn(generating && "animate-spin")} />
            刷新
          </button>
        </div>

        {/* 多组织未选当前 org 时提示 */}
        {ambiguous && (
          <div className="border-b border-amber-500/25 bg-amber-500/5 px-4 py-2 text-[12px] text-amber-900 dark:text-amber-100/90">
            检测到多个组织：外贸与秘书一键操作需要明确的当前组织。请从侧栏进入目标组织的页面（地址中包含该组织的路径），或完成产品内的「当前组织」选择后再试。
          </div>
        )}

        {/* AI 摘要 */}
        <div className="px-4 py-3 border-b border-border/30">
          <p className="text-[13px] text-foreground leading-relaxed">
            {briefing.summary}
          </p>
          {(tradeStats || salesStats) && (
            <div className="mt-2 flex flex-wrap gap-3">
              {tradeStats?.activeCampaigns !== undefined && (
                <StatBadge icon={TrendingUp} label="活跃活动" value={tradeStats.activeCampaigns} />
              )}
              {tradeStats?.totalProspects !== undefined && (
                <StatBadge icon={Users} label="外贸客户" value={tradeStats.totalProspects} />
              )}
              {tradeStats?.recentReplies !== undefined && tradeStats.recentReplies > 0 && (
                <StatBadge icon={MessageSquare} label="新回复" value={tradeStats.recentReplies} accent />
              )}
              {salesStats?.activeOpportunities !== undefined && (
                <StatBadge icon={TrendingUp} label="活跃机会" value={salesStats.activeOpportunities} />
              )}
              {salesStats?.newInquiries !== undefined && salesStats.newInquiries > 0 && (
                <StatBadge icon={Users} label="新询盘" value={salesStats.newInquiries} accent />
              )}
              {salesStats?.wonThisMonth !== undefined && salesStats.wonThisMonth > 0 && (
                <StatBadge icon={CheckCircle2} label="本月成交" value={salesStats.wonThisMonth} accent />
              )}
            </div>
          )}
        </div>

        {/* 待办事项列表 */}
        {items.length > 0 ? (
          <div className="p-4 space-y-2">
            {(expanded ? items : previewItems).map((item) => (
              <BriefingItemCard
                key={item.id}
                item={item}
                onAction={handleAction}
                actionLoading={actionLoading}
              />
            ))}
            {hasMore && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] text-muted hover:text-foreground transition-colors"
              >
                {expanded ? (
                  <><ChevronUp size={12} /> 收起</>
                ) : (
                  <><ChevronDown size={12} /> 展开全部 {items.length} 项</>
                )}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <CheckCircle2 size={24} className="text-accent/30" />
            <p className="text-sm font-medium text-muted">
              {completedCount > 0 ? "所有事项已处理完毕" : "所有事项运行正常"}
            </p>
          </div>
        )}
      </div>

      {/* 草稿弹窗 */}
      {draftModal && (
        <DraftModal
          draft={draftModal}
          onClose={() => setDraftModal(null)}
          onSend={handleSendDraft}
          sending={sendingDraft}
        />
      )}

      {/* 操作提示 */}
      {toast && (
        <ActionToast
          message={toast.message}
          success={toast.success}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
}

// ── 辅助组件 ─────────────────────────────────────────────────────

function StatBadge({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-muted/5 px-2 py-1">
      <Icon size={11} className={accent ? "text-accent" : "text-muted"} />
      <span className="text-[11px] text-muted">{label}</span>
      <span className={cn("text-[11px] font-medium", accent ? "text-accent" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}
