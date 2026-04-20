"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  ScrollText,
  Search,
  Filter,
  DollarSign,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  Eye,
  Share2,
  Mail,
  X,
  Wallet,
} from "lucide-react";
import { RecordDepositDialog } from "@/components/sales/record-deposit-dialog";

interface QuoteItem {
  id: string;
  customerId: string;
  customer: { id: string; name: string; phone?: string; email?: string };
  opportunity?: { id: string; title: string; stage: string } | null;
  version: number;
  status: string;
  installMode: string;
  grandTotal: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  items: { product: string; fabric: string }[];
  createdBy?: { name?: string };
  shareToken?: string | null;
  viewedAt?: string | null;
  depositAmount?: number | null;
  depositMethod?: string | null;
  depositCollectedAt?: string | null;
}

const DEPOSIT_METHOD_LABEL: Record<string, string> = {
  cash: "现金",
  check: "支票",
  etransfer: "E-Transfer",
};

function isSignedLike(status: string): boolean {
  return status === "signed" || status === "accepted";
}

const STATUS_MAP: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  draft: { label: "草稿", icon: FileText, color: "bg-gray-100 text-gray-700" },
  sent: { label: "已发送", icon: Clock, color: "bg-blue-100 text-blue-700" },
  viewed: { label: "已查看", icon: Eye, color: "bg-cyan-100 text-cyan-700" },
  // 历史 accepted（早期公开签字通道写入）与 signed 语义一致，统一显示为"已签约"
  accepted: { label: "已签约", icon: CheckCircle, color: "bg-green-100 text-green-700" },
  signed: { label: "已签约", icon: CheckCircle, color: "bg-green-100 text-green-700" },
  rejected: { label: "已拒绝", icon: XCircle, color: "bg-red-100 text-red-700" },
  expired: { label: "已过期", icon: XCircle, color: "bg-gray-100 text-gray-500" },
};

// 签约状态的别名：筛选"已签约"时同时匹配 signed 和历史的 accepted
const STATUS_ALIASES: Record<string, string[]> = {
  signed: ["signed", "accepted"],
};

const STATUS_FILTERS = ["all", "draft", "sent", "viewed", "signed", "rejected"] as const;

export default function SalesQuotesPage() {
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [shareLangMenu, setShareLangMenu] = useState<string | null>(null);
  const [emailDialog, setEmailDialog] = useState<QuoteItem | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailLang, setEmailLang] = useState("en");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState("");
  const [depositTarget, setDepositTarget] = useState<QuoteItem | null>(null);

  const copyShareLink = (q: QuoteItem, lang: string = "en") => {
    if (!q.shareToken) return;
    const url = `${window.location.origin}/quote/${q.shareToken}?lang=${lang}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(q.id);
      setShareLangMenu(null);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const openEmailDialog = (q: QuoteItem) => {
    setEmailDialog(q);
    setEmailTo(q.customer?.email || "");
    setEmailLang("en");
    setSendResult("");
  };

  const handleSendEmail = async () => {
    if (!emailDialog || !emailTo) return;
    setSending(true);
    setSendResult("");
    try {
      const res = await apiFetch(`/api/sales/quotes/${emailDialog.id}/send-email`, {
        method: "POST",
        body: JSON.stringify({ to: emailTo, lang: emailLang }),
      }).then((r) => r.json());
      if (res.error) {
        setSendResult(`失败：${res.error}`);
      } else {
        setSendResult("发送成功！");
        loadQuotes();
        setTimeout(() => setEmailDialog(null), 1500);
      }
    } finally {
      setSending(false);
    }
  };

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiJson<{ quotes?: QuoteItem[] }>("/api/sales/quotes/list");
      setQuotes(res.quotes ?? []);
    } catch {
      setQuotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);

  const filtered = quotes.filter((q) => {
    if (statusFilter !== "all") {
      const allowed = STATUS_ALIASES[statusFilter] ?? [statusFilter];
      if (!allowed.includes(q.status)) return false;
    }
    if (search) {
      const s = search.toLowerCase();
      const nameMatch = q.customer?.name?.toLowerCase().includes(s);
      const productMatch = q.items?.some(
        (i) => i.product?.toLowerCase().includes(s) || i.fabric?.toLowerCase().includes(s),
      );
      if (!nameMatch && !productMatch) return false;
    }
    return true;
  });

  const totalValue = filtered.reduce((s, q) => s + (q.grandTotal || 0), 0);
  const draftCount = quotes.filter((q) => q.status === "draft").length;
  const pendingDepositCount = quotes.filter(
    (q) => isSignedLike(q.status) && !q.depositCollectedAt,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="全部报价"
        description="管理所有销售报价单"
        actions={
          <Link
            href="/sales"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/80 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-white transition-colors"
          >
            返回看板
          </Link>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "总报价", value: quotes.length, icon: ScrollText, color: "text-blue-600" },
          { label: "报价总额", value: `$${(totalValue / 1000).toFixed(1)}k`, icon: DollarSign, color: "text-emerald-600" },
          { label: "草稿", value: draftCount, icon: FileText, color: "text-gray-600" },
          { label: "待登记定金", value: pendingDepositCount, icon: Wallet, color: "text-orange-600" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-white/60 p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <stat.icon size={14} className={stat.color} />
              {stat.label}
            </div>
            <p className={cn("mt-1 text-2xl font-bold", stat.color)}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索客户名、产品..."
            className="w-full rounded-lg border border-border bg-white/80 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-white/60 p-0.5">
          <Filter size={14} className="ml-2 text-muted-foreground" />
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                statusFilter === s
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "all" ? "全部" : STATUS_MAP[s]?.label ?? s}
            </button>
          ))}
        </div>
      </div>

      {/* Quote list */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-sm text-muted-foreground">
          <ScrollText size={40} className="mb-3 opacity-30" />
          {quotes.length === 0 ? "暂无报价记录" : "没有匹配的报价"}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-white/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">客户</th>
                <th className="px-4 py-3">机会</th>
                <th className="px-4 py-3">产品</th>
                <th className="px-4 py-3">版本</th>
                <th className="px-4 py-3 text-right">总额</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">创建时间</th>
                <th className="px-4 py-3 text-center">分享</th>
                <th className="px-4 py-3 text-center">邮件</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => {
                const st = STATUS_MAP[q.status] ?? STATUS_MAP.draft;
                const products = [...new Set(q.items?.map((i) => i.product) ?? [])].join(", ");
                return (
                  <tr
                    key={q.id}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/sales/customers/${q.customerId}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {q.customer?.name ?? "—"}
                      </Link>
                      {q.customer?.phone && (
                        <p className="text-xs text-muted-foreground">{q.customer.phone}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {q.opportunity?.title ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                      {products || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">v{q.version}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      ${q.grandTotal?.toLocaleString("en-CA", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", st.color)}>
                          <st.icon size={12} />
                          {st.label}
                        </span>
                        {isSignedLike(q.status) && !q.depositCollectedAt && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDepositTarget(q); }}
                            className="inline-flex items-center gap-1 rounded-md bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-orange-600 transition-colors"
                            title="客户已签字，请登记定金"
                          >
                            <Wallet size={10} />
                            待登记定金
                          </button>
                        )}
                        {isSignedLike(q.status) && q.depositCollectedAt && typeof q.depositAmount === "number" && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            <CheckCircle size={10} />
                            定金 ${q.depositAmount.toFixed(0)}
                            {q.depositMethod ? ` · ${DEPOSIT_METHOD_LABEL[q.depositMethod] || q.depositMethod}` : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(q.createdAt).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {q.shareToken ? (
                        <div className="relative inline-block">
                          {copiedId === q.id ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                              <CheckCircle size={13} />
                              已复制
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShareLangMenu(shareLangMenu === q.id ? null : q.id);
                                }}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                                title="复制分享链接"
                              >
                                <Share2 size={13} />
                                分享
                              </button>
                              {shareLangMenu === q.id && (
                                <div className="absolute right-0 top-full mt-1 z-20 rounded-lg border border-border bg-white shadow-lg py-1 min-w-[100px]">
                                  {[
                                    { code: "en", label: "English" },
                                    { code: "cn", label: "中文" },
                                    { code: "fr", label: "Français" },
                                  ].map((l) => (
                                    <button
                                      key={l.code}
                                      onClick={(e) => { e.stopPropagation(); copyShareLink(q, l.code); }}
                                      className="block w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors"
                                    >
                                      {l.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEmailDialog(q); }}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        title="邮件发送报价"
                      >
                        <Mail size={13} />
                        发送
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Record deposit dialog */}
      {depositTarget && (
        <RecordDepositDialog
          open={!!depositTarget}
          onOpenChange={(open) => { if (!open) setDepositTarget(null); }}
          quoteId={depositTarget.id}
          grandTotal={depositTarget.grandTotal}
          onSaved={(payload) => {
            setQuotes((prev) =>
              prev.map((x) =>
                x.id === depositTarget.id
                  ? {
                      ...x,
                      depositAmount: payload.depositAmount,
                      depositMethod: payload.depositMethod,
                      depositCollectedAt: payload.depositCollectedAt,
                    }
                  : x,
              ),
            );
            setDepositTarget(null);
          }}
        />
      )}

      {/* Email send dialog */}
      {emailDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">邮件发送报价</h3>
              <button onClick={() => setEmailDialog(null)} className="rounded-md p-1 hover:bg-muted transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">客户</p>
                <p className="text-sm font-medium">{emailDialog.customer?.name} — ${emailDialog.grandTotal?.toFixed(2)}</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">收件邮箱 *</label>
                <input
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
                  placeholder="customer@email.com"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">邮件语言</label>
                <div className="flex gap-2">
                  {[
                    { code: "en", label: "English" },
                    { code: "cn", label: "中文" },
                    { code: "fr", label: "Français" },
                  ].map((l) => (
                    <button
                      key={l.code}
                      onClick={() => setEmailLang(l.code)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        emailLang === l.code
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/30",
                      )}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {sendResult && (
                <p className={`text-sm ${sendResult.includes("成功") ? "text-emerald-600" : "text-red-500"}`}>
                  {sendResult}
                </p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setEmailDialog(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sending || !emailTo}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Mail size={15} />
                {sending ? "发送中..." : "发送报价"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
