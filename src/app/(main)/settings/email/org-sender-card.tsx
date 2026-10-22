"use client";

/**
 * 公司发件身份：审批中心批准的跟进邮件、外贸收件箱回复都以这个身份发出（不用个人 Gmail）。
 * 数据：/api/trade/email-sender（组织级，按版本发布）
 */

import { useEffect, useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { Label } from "@/components/ui/label";

type DomainStatus = "verified" | "pending" | "failed" | "not_started" | "not_added" | "no_resend" | "unknown";

interface SenderState {
  sender: { fromName: string; fromEmail: string | null; replyTo: string | null; bcc: string[] } | null;
  platformFrom: string;
  resendConfigured: boolean;
  domainStatus: DomainStatus | null;
  canEditFromEmail: boolean;
}

const inputCls =
  "w-full rounded-lg border border-border bg-card-bg/80 px-3 py-2 text-sm disabled:opacity-60";

function StatusLine({ s }: { s: SenderState }) {
  if (!s.resendConfigured) {
    return <p className="text-xs text-red-600">平台还没配置 Resend（RESEND_API_KEY），设置了发件身份后批准发送会失败，请联系平台管理员。</p>;
  }
  if (!s.sender) {
    return (
      <p className="text-xs text-muted-foreground">
        未设置：批准后用审批人自己绑定的 Gmail 发送；审批人没绑 Gmail 时由平台地址 {s.platformFrom} 发出，且没有回复地址。
      </p>
    );
  }
  const { fromName, fromEmail, replyTo } = s.sender;
  const replies = replyTo ?? fromEmail;
  if (!fromEmail) {
    return (
      <p className="text-xs text-muted-foreground">
        由平台地址 {s.platformFrom} 发出，发件人显示「{fromName}」，买家回复到 {replies}。
      </p>
    );
  }
  const domain = fromEmail.slice(fromEmail.indexOf("@") + 1);
  if (s.domainStatus === "verified") {
    return <p className="text-xs text-emerald-700">{domain} 已验证：邮件从 {fromEmail} 发出，买家回复到 {replies}。</p>;
  }
  const waiting =
    s.domainStatus === "unknown"
      ? `读不到 ${domain} 的验证状态。发送时自动判断：未验证就`
      : `${domain} 还没在平台 Resend 验证${s.domainStatus === "not_added" ? "（尚未添加域名）" : s.domainStatus === "failed" ? "（验证失败，请检查 DNS 记录）" : "（等待 DNS 生效）"}。在此之前`;
  return (
    <p className="text-xs text-amber-700">
      {waiting}由平台地址 {s.platformFrom} 代发，发件人仍显示「{fromName}」，买家回复仍到 {replies}，不会丢。
    </p>
  );
}

export function OrgSenderCard({ orgId }: { orgId: string | null }) {
  const [state, setState] = useState<SenderState | null>(null);
  const [hidden, setHidden] = useState(false);
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [bcc, setBcc] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const apply = (d: SenderState) => {
    setState(d);
    setFromName(d.sender?.fromName ?? "");
    setFromEmail(d.sender?.fromEmail ?? "");
    setReplyTo(d.sender?.replyTo ?? "");
    setBcc((d.sender?.bcc ?? []).join(", "));
  };

  useEffect(() => {
    if (!orgId) return;
    void (async () => {
      try {
        const res = await apiFetch("/api/trade/email-sender");
        if (!res.ok) {
          setHidden(true);
          return;
        }
        apply(await res.json());
      } catch {
        setHidden(true);
      }
    })();
  }, [orgId]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/trade/email-sender", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, fromName, fromEmail, replyTo, bcc }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: "error", text: (data.errors ?? [data.error ?? "保存失败"]).join("；") });
        return;
      }
      apply(data);
      setMsg({ tone: "ok", text: `已保存（第 ${data.version} 版），之后批准的邮件按新设置发出。` });
    } catch {
      setMsg({ tone: "error", text: "保存失败，请检查网络后重试" });
    } finally {
      setSaving(false);
    }
  };

  if (hidden) return null;
  if (!state) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border p-5">
        <Loader2 className="animate-spin text-muted-foreground" size={18} />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg bg-muted/40 p-2">
          <Building2 size={20} className="text-accent" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">公司发件身份（跟进邮件）</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              审批中心批准的询盘 / 展会跟进邮件、外贸收件箱的回复，都以这个身份发出，不用任何人的个人 Gmail。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="sender-name">发件人名称</Label>
              <input id="sender-name" className={inputCls} value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Cathy | Mengxin Home Textile" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sender-email">发件地址</Label>
              <input
                id="sender-email"
                className={inputCls}
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="cathy@company.com"
                disabled={!state.canEditFromEmail}
              />
              {!state.canEditFromEmail && <p className="text-[11px] text-muted-foreground">发件地址由平台管理员设置</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="sender-reply">回复地址（买家点回复时收信）</Label>
              <input id="sender-reply" className={inputCls} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="留空 = 发件地址" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sender-bcc">密送留底（逗号分隔，最多 3 个）</Label>
              <input id="sender-bcc" className={inputCls} value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="cathy@company.com" />
            </div>
          </div>
          <StatusLine s={state} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              保存发件身份
            </button>
            {msg && <span className={`text-xs ${msg.tone === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
