"use client";

/**
 * RFQ-AUTO-3 本人的开关「自动起草的轮次带跟进授权」。
 *
 * 只显示与开关，不发信、不批准、不起草。开启前能看到授权范围与三段模板（与发询价卡上展示的是同一份）。
 * 开了之后，自动起草的卡带授权——但授权仍然写在卡上，仍然要人在网页上批准那张卡才生效。
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import type { RfqFollowUpCardView } from "./rfq-web-entry-types";

type Props = {
  projectId: string;
  enabled: boolean;
  /** 授权范围 + 模板预览；入口没给时只显示开关与说明 */
  offer: RfqFollowUpCardView | null;
  canManage: boolean;
  /** 开或关成功后让父组件重新取入口状态 */
  onChanged: () => void;
};

export function RfqAutoFollowUpOptIn({ projectId, enabled, offer, canManage, onChanged }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [openTemplate, setOpenTemplate] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tender-rfq/auto-follow-up`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) setError(data?.error ?? "没有设置成功，请重试。");
      else onChanged();
    } catch {
      setError("网络出错了，请重试。");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mt-3 space-y-1.5 rounded-md border border-border bg-background p-3 text-xs" data-testid="rfq-auto-followup-optin">
      <div className="flex flex-wrap items-center gap-2">
        <Repeat size={13} className="text-accent/70" />
        <span className="font-medium text-foreground">自动起草的轮次带跟进授权</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${enabled ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]" : "bg-border/60 text-muted"}`}
          data-testid="rfq-auto-followup-optin-state"
        >
          {enabled ? "已开启" : "未开启"}
        </span>
        <span className="text-muted">只对你自己触发的自动起草生效</span>
        {canManage && !confirming && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => (enabled ? void set(false) : (setExpanded(true), setConfirming(true)))}
            loading={busy && enabled}
            loadingText="正在关闭…"
            data-testid="rfq-auto-followup-optin-toggle"
          >
            {enabled ? "关闭" : "开启"}
          </Button>
        )}
      </div>
      <p className="text-muted">
        {enabled
          ? "你批准招标分析后，系统起草的第 1 轮询价会带上催单和追问的授权。授权写在那张卡上，仍然要你在网页上批准那张卡才生效；关闭只影响之后起草的轮次。"
          : "开启后，你批准招标分析时系统起草的第 1 轮询价会带上催单和追问的授权——批准那张卡，就一并批准了后面的催单和追问。不开启 = 这些轮次的催单和追问照旧逐封批。"}
      </p>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 text-accent" aria-expanded={expanded} data-testid="rfq-auto-followup-optin-expand">
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        授权的范围与邮件模板
      </button>
      {expanded && (
        <div className="space-y-2 rounded-md border border-[#9a6a2f]/30 bg-[#9a6a2f]/[0.05] p-3" data-testid="rfq-auto-followup-optin-scope">
          {offer ? (
            <>
              <p className="text-foreground/85">{offer.summaryZh}</p>
              <p className="text-muted">间隔天数与回复截止按每一轮起草时的设置定格；正文是下面的固定模板，只发给那一轮的原收件人。带授权的卡只能在网页上批，轮次里随时可以「停止自动跟进」。</p>
              <ul className="divide-y divide-border/60 rounded-md border border-border bg-background">
                {offer.templates.map((t) => {
                  const open = openTemplate === t.key;
                  return (
                    <li key={t.key}>
                      <button type="button" onClick={() => setOpenTemplate(open ? null : t.key)} className="flex w-full items-center gap-2 px-3 py-2 text-left" aria-expanded={open}>
                        {open ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
                        <span className="text-foreground">{t.labelZh}</span>
                      </button>
                      {open && (
                        <div className="border-t border-border/60 px-3 py-2">
                          <p className="font-medium text-foreground">{t.subject}</p>
                          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans leading-relaxed text-muted">{t.body}</pre>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-muted">催单最多 2 次、缺字段追问 1 次，正文是固定模板，只发给那一轮的原收件人。具体范围与模板在每张发询价卡上都会列出。</p>
          )}
        </div>
      )}
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#9a6a2f]/30 bg-[#9a6a2f]/[0.05] p-2">
          <span className="text-foreground">开启后，以后你触发的自动起草都会带上上面这份授权（每张卡仍要你批准才生效）。确定开启？</span>
          <Button variant="outline" size="sm" onClick={() => void set(true)} loading={busy} loadingText="正在开启…" data-testid="rfq-auto-followup-optin-confirm">
            确定开启
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
            先不开
          </Button>
        </div>
      )}
      {error && <p className="text-danger" role="alert">{error}</p>}
    </div>
  );
}
