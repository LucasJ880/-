"use client";

/**
 * 询盘收件箱 — 外贸员唯一的进线入口
 * 官网表单 / WhatsApp / 微信 / 邮件回复 的进线按买家聚合，待回复优先。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  FileText,
  Globe,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { getTradeProspectStageLabel } from "@/lib/trade/stage";

interface Thread {
  prospectId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  country: string | null;
  stage: string;
  source: string;
  score: number | null;
  channel: string;
  lastInboundAt: string;
  lastInboundSubject: string | null;
  lastInboundExcerpt: string;
  inboundCount: number;
  replied: boolean;
  waitingMinutes: number | null;
}

const CHANNEL_META: Record<string, { label: string; icon: typeof Mail; cls: string }> = {
  website: { label: "官网", icon: Globe, cls: "bg-indigo-500/15 text-indigo-400" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, cls: "bg-emerald-500/15 text-emerald-400" },
  wechat: { label: "微信", icon: MessageCircle, cls: "bg-green-500/15 text-green-400" },
  wechat_work: { label: "企业微信", icon: MessageCircle, cls: "bg-blue-500/15 text-blue-400" },
  email: { label: "邮件", icon: Mail, cls: "bg-zinc-500/15 text-zinc-300" },
};

function waitingLabel(minutes: number): { text: string; urgent: boolean } {
  if (minutes < 60) return { text: `等了 ${minutes} 分钟`, urgent: minutes >= 5 };
  if (minutes < 60 * 24) return { text: `等了 ${Math.round(minutes / 60)} 小时`, urgent: true };
  return { text: `等了 ${Math.round(minutes / 1440)} 天`, urgent: true };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

export default function TradeInboxPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [counts, setCounts] = useState({ pending: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setThreads([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await apiFetch(
      `/api/trade/inbox?orgId=${encodeURIComponent(orgId)}&filter=${filter}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { items: Thread[]; counts: { pending: number; total: number } };
      setThreads(data.items ?? []);
      setCounts(data.counts ?? { pending: 0, total: 0 });
    } else {
      setThreads([]);
    }
    setLoading(false);
  }, [orgId, ambiguous, filter]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  // 标记已处理：记一次跟进（今天已联系，3 天后再看），线索从待回复移出
  const markHandled = async (t: Thread) => {
    if (!orgId) return;
    setMarking(t.prospectId);
    try {
      const next = new Date();
      next.setDate(next.getDate() + 3);
      await apiFetch(`/api/trade/prospects/${t.prospectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          lastContactAt: new Date().toISOString(),
          nextFollowUpAt: next.toISOString(),
        }),
      });
      await apiFetch(`/api/trade/prospects/${t.prospectId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          direction: "outbound",
          channel: t.channel,
          content: "已在系统外回复买家（收件箱标记）",
        }),
      }).catch(() => {});
      await load();
    } finally {
      setMarking(null);
    }
  };

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织后再查看询盘。</p>
        <button type="button" onClick={() => router.push("/organizations")} className="text-sm text-accent underline-offset-2 hover:underline">
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="询盘收件箱"
        description="官网表单、WhatsApp、微信、邮件回复的进线都在这里，待回复的排最前——询盘当天回。"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card-bg p-1 text-xs">
          <button
            type="button"
            onClick={() => setFilter("pending")}
            className={cn("rounded-md px-3 py-1.5 font-medium transition", filter === "pending" ? "bg-accent text-[color:var(--on-accent)]" : "text-muted hover:text-foreground")}
          >
            待回复 {counts.pending > 0 && <span className="ml-1 rounded-full bg-black/10 px-1.5">{counts.pending}</span>}
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn("rounded-md px-3 py-1.5 font-medium transition", filter === "all" ? "bg-accent text-[color:var(--on-accent)]" : "text-muted hover:text-foreground")}
          >
            全部 <span className="ml-1 text-[10px] opacity-70">{counts.total}</span>
          </button>
        </div>
        <button type="button" onClick={() => void load()} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition hover:text-foreground">
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card-bg px-8 py-16 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-foreground">{filter === "pending" ? "没有待回复的询盘" : "还没有进线"}</p>
          <p className="mt-1 text-xs text-muted">
            官网 Contact Us、WhatsApp、微信的进线会自动出现在这里；也可以在
            <Link href="/trade/prospects" className="mx-1 text-accent hover:underline">线索资产</Link>
            手动录入买家。
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {threads.map((t) => {
            const meta = CHANNEL_META[t.channel] ?? CHANNEL_META.email;
            const Icon = meta.icon;
            const wait = !t.replied && t.waitingMinutes !== null ? waitingLabel(t.waitingMinutes) : null;
            const quoteHref = `/trade/quotes/new?prospectId=${encodeURIComponent(t.prospectId)}&companyName=${encodeURIComponent(t.companyName)}${t.contactName ? `&contactName=${encodeURIComponent(t.contactName)}` : ""}${t.contactEmail ? `&contactEmail=${encodeURIComponent(t.contactEmail)}` : ""}${t.country ? `&country=${encodeURIComponent(t.country)}` : ""}`;
            return (
              <li key={t.prospectId} className={cn("rounded-xl border bg-card-bg p-4", wait?.urgent ? "border-amber-500/40" : "border-border/60")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", meta.cls)}>
                        <Icon size={11} /> {meta.label}
                      </span>
                      <Link href={`/trade/prospects/${t.prospectId}`} className="text-sm font-semibold text-foreground hover:underline">
                        {t.companyName}
                      </Link>
                      {t.contactName && <span className="text-xs text-muted">{t.contactName}</span>}
                      {t.country && <span className="text-xs text-muted">· {t.country}</span>}
                      <span className="rounded bg-[rgba(110,125,118,0.08)] px-1.5 py-0.5 text-[10px] text-muted">
                        {getTradeProspectStageLabel(t.stage)}
                      </span>
                      {t.score !== null && <span className="text-[10px] text-muted">评分 {t.score.toFixed(1)}</span>}
                    </div>
                    {t.lastInboundSubject && (
                      <p className="mt-1.5 text-xs font-medium text-foreground/90">{t.lastInboundSubject}</p>
                    )}
                    <p className="mt-1 text-xs leading-relaxed text-muted">{t.lastInboundExcerpt}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                      <span className="inline-flex items-center gap-1"><Clock size={11} /> {timeAgo(t.lastInboundAt)}</span>
                      <span>{t.inboundCount} 条进线</span>
                      {wait ? (
                        <span className={cn("font-medium", wait.urgent ? "text-amber-500" : "text-muted")}>{wait.text}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-500"><CheckCircle2 size={11} /> 已回复</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Link href={`/trade/prospects/${t.prospectId}`} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/50 hover:text-accent">
                      打开线索
                    </Link>
                    <Link href={quoteHref} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/50 hover:text-accent">
                      <FileText size={12} /> 新建报价
                    </Link>
                    {!t.replied && (
                      <button
                        type="button"
                        disabled={marking === t.prospectId}
                        onClick={() => void markHandled(t)}
                        className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-[color:var(--on-accent)] transition hover:bg-accent-hover disabled:opacity-50"
                      >
                        {marking === t.prospectId ? "…" : "已回复，标记"}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
