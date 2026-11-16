"use client";

import Link from "next/link";
import { MailOpen, MessageSquare, Reply } from "lucide-react";
import { inboxReplyHref, interactionMetaLine } from "@/lib/trade/reply-target";
import { Interaction, INTERACTION_ICONS } from "./types";
import { mailWatchReceivedAt, readMailHref, showReadMailEntry } from "@/lib/mail-watch/ui-pure";

export function InteractionTimeline({
  interactions,
  customerName = "",
  mailReadEnabled,
  assistantOpen,
}: {
  interactions: Interaction[];
  /** MAIL-2：「让助手读这封信」的预填文字里用（成员录入的客户名，不是邮件里的文字） */
  customerName?: string;
  /** MAIL-1 状态接口的 mailRead.enabled；不是 true 就不显示「让助手读这封信」 */
  mailReadEnabled?: boolean;
  /** 助手页（/assistant）对当前用户是否放行；不是 true 也不显示 */
  assistantOpen?: boolean;
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
          <div className="absolute -left-6 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-card-bg text-xs shadow-sm">
            {INTERACTION_ICONS[item.type] || "📝"}
          </div>
          <div className="rounded-lg border border-border/50 bg-card-bg/60 px-4 py-3">
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
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted/70">
              <span>{interactionMetaLine(item.direction, item.createdBy.name)}</span>
              {/* 回复目标非空才有入口：进询盘收件箱并直接打开该买家的回复窗口 */}
              {item.replyTarget && (
                <Link
                  href={inboxReplyHref(item.replyTarget)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card-bg px-2 py-1 text-xs font-medium text-foreground hover:border-accent/50 hover:text-accent"
                >
                  <Reply className="h-3 w-3" />
                  回复
                </Link>
              )}
              {/* 来信观察建的条目：打开助手并预填一句话（只有客户名与日期，不带主题），由用户自己发送 */}
              {showReadMailEntry({ mailReadEnabled, assistantOpen, interaction: item }) && (
                <Link
                  href={readMailHref({ customerName, receivedAt: mailWatchReceivedAt(item) })}
                  data-testid="read-mail-entry"
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/5"
                >
                  <MailOpen size={12} />
                  让助手读这封信
                </Link>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
