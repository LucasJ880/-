"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, CheckCircle2, XCircle, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

interface Channel {
  id: string;
  channel: string;
  name: string;
  status: string;
  config: Record<string, string>;
  createdAt: string;
}

const CHANNEL_INFO: Record<string, { label: string; color: string; fields: { key: string; label: string; placeholder: string }[] }> = {
  whatsapp: {
    label: "WhatsApp",
    color: "bg-emerald-500/15 text-emerald-400",
    fields: [
      { key: "accessToken", label: "Access Token", placeholder: "Meta Graph API Access Token" },
      { key: "phoneNumberId", label: "Phone Number ID", placeholder: "WhatsApp Business Phone Number ID" },
    ],
  },
  wechat: {
    label: "微信公众号",
    color: "bg-green-500/15 text-green-400",
    fields: [
      { key: "appId", label: "App ID", placeholder: "公众号 AppID" },
      { key: "appSecret", label: "App Secret", placeholder: "公众号 AppSecret" },
    ],
  },
  wechat_work: {
    label: "企业微信",
    color: "bg-blue-500/15 text-blue-400",
    fields: [
      { key: "corpId", label: "Corp ID", placeholder: "企业ID" },
      { key: "corpSecret", label: "Corp Secret", placeholder: "应用的Secret" },
      { key: "agentId", label: "Agent ID", placeholder: "应用AgentId" },
    ],
  },
  website: {
    label: "网站询盘表单",
    color: "bg-indigo-500/15 text-indigo-400",
    // 密钥由服务端生成，添加后在通道卡片里查看接入代码
    fields: [],
  },
  email: {
    label: "邮件转发询盘",
    color: "bg-amber-500/15 text-amber-500",
    // 转发地址由服务端生成；添加时只填允许转发的发件邮箱（白名单）
    fields: [],
  },
};

export default function TradeChannelsPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setChannels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await apiFetch(`/api/trade/channels?orgId=${encodeURIComponent(orgId)}`);
    if (res.ok) setChannels(await res.json());
    else setChannels([]);
    setLoading(false);
  }, [orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  const handleDelete = async (channel: string) => {
    if (!orgId || ambiguous) return;
    if (!confirm("确定删除该通道配置？")) return;
    await apiFetch(`/api/trade/channels/${channel}?orgId=${encodeURIComponent(orgId)}`, { method: "DELETE" });
    load();
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
        <p className="text-sm text-muted">请先选择当前组织后再配置消息通道。</p>
        <button type="button" onClick={() => router.push("/organizations")} className="text-sm text-accent underline-offset-2 hover:underline">
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="消息通道" description="配置 WhatsApp、微信等消息通道，直接在青砚中与客户沟通" />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{channels.length} 个通道</span>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500">
          <Plus size={14} /> 添加通道
        </button>
      </div>

      {channels.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card-bg px-8 py-16 text-center">
          <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">暂未配置消息通道</p>
          <p className="mt-1 text-xs text-muted">添加 WhatsApp 或微信通道后，可直接在线索详情页发送消息</p>
        </div>
      ) : (
        <div className="space-y-3">
          {channels.map((ch) => {
            const info = CHANNEL_INFO[ch.channel];
            return (
              <div key={ch.id} className="rounded-xl border border-border/60 bg-card-bg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", info?.color ?? "bg-zinc-500/15 text-zinc-400")}>
                      {info?.label ?? ch.channel}
                    </span>
                    <span className="text-sm font-medium text-foreground">{ch.name}</span>
                    {ch.status === "active" ? (
                      <CheckCircle2 size={12} className="text-emerald-400" />
                    ) : (
                      <XCircle size={12} className="text-red-400" />
                    )}
                  </div>
                  <button onClick={() => handleDelete(ch.channel)} className="rounded-lg p-1.5 text-muted transition hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
                {ch.channel === "website" ? (
                  <WebsiteInquirySetup orgId={orgId} />
                ) : ch.channel === "email" ? (
                  <EmailInboundSetup orgId={orgId} name={ch.name} />
                ) : (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {Object.entries(ch.config).map(([k, v]) => (
                      <span key={k}>{k}: <span className="text-foreground">{v}</span></span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <AddChannelModal
          orgId={orgId}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function WebsiteInquirySetup({ orgId }: { orgId: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const endpoint =
    typeof window !== "undefined" ? `${window.location.origin}/api/trade/webhook/website` : "/api/trade/webhook/website";

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/trade/channels/website?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: { secret?: string } } | null) => {
        if (!cancelled) setSecret(d?.config?.secret ?? null);
      })
      .catch(() => {
        if (!cancelled) setSecret(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const snippet = `<!-- 青砚网站询盘：放到 Contact Us 表单所在页面 -->
<form id="qy-inquiry">
  <input name="name" placeholder="Your name" required />
  <input name="email" type="email" placeholder="Work email" required />
  <input name="company" placeholder="Company" />
  <input name="country" placeholder="Country" />
  <input name="product" placeholder="Product of interest" />
  <textarea name="message" placeholder="Quantity, specs, target price..."></textarea>
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off" />
  <button type="submit">Send inquiry</button>
</form>
<script>
document.getElementById('qy-inquiry').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const q = new URLSearchParams(location.search);
  ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']
    .forEach((k) => { if (q.get(k)) data[k] = q.get(k); });
  data.page = location.href;
  const res = await fetch('${endpoint}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-qingyan-webhook-secret': '${secret ?? "<密钥>"}' },
    body: JSON.stringify(data),
  });
  form.innerHTML = res.ok
    ? '<p>Thanks! We will get back to you within 24 hours.</p>'
    : '<p>Something went wrong. Please email us directly.</p>';
});
</script>`;

  return (
    <div className="mt-3 space-y-3 text-xs">
      <p className="text-muted">
        网站表单提交后自动进入「线索资产」（活动：网站询盘），带上来源页与 UTM，并即时通知销售。已有邮箱的买家会合并到原线索。
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-muted">接口地址</span>
            <button type="button" onClick={() => copy("endpoint", endpoint)} className="text-accent hover:underline">
              {copied === "endpoint" ? "已复制" : "复制"}
            </button>
          </div>
          <code className="break-all text-foreground">{endpoint}</code>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-muted">通道密钥（请求头 x-qingyan-webhook-secret）</span>
            {secret && (
              <button type="button" onClick={() => copy("secret", secret)} className="text-accent hover:underline">
                {copied === "secret" ? "已复制" : "复制"}
              </button>
            )}
          </div>
          <code className="break-all text-foreground">{secret ?? "读取中…"}</code>
        </div>
      </div>
      <details className="rounded-lg border border-border/60 bg-background/60 p-2.5">
        <summary className="cursor-pointer text-foreground">接入代码（复制到网站 Contact Us 页面）</summary>
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={() => copy("snippet", snippet)} className="text-accent hover:underline">
            {copied === "snippet" ? "已复制" : "复制代码"}
          </button>
        </div>
        <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-foreground/90">{snippet}</pre>
        <p className="mt-2 text-muted">
          自建站（如 Next.js）可不改表单结构，只在提交处 fetch 上面的接口；字段名支持 name / email / phone / company / country / product / message，另有 page 与 utm_* 可选。
        </p>
      </details>
    </div>
  );
}

function EmailInboundSetup({ orgId, name }: { orgId: string; name: string }) {
  const [address, setAddress] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/trade/channels/email?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: { forwarderAllowlist?: string[] }; inbound?: { enabled?: boolean; address?: string | null } } | null) => {
        if (cancelled) return;
        setEnabled(Boolean(d?.inbound?.enabled));
        setAddress(d?.inbound?.address ?? null);
        setDraft((d?.config?.forwarderAllowlist ?? []).join("\n"));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch("/api/trade/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, channel: "email", name, config: { forwarderAllowlist: draft } }),
      });
      const d = (await res.json().catch(() => null)) as { error?: string; invalid?: string[]; config?: { forwarderAllowlist?: string[] } } | null;
      if (res.ok) {
        setDraft((d?.config?.forwarderAllowlist ?? []).join("\n"));
        setNotice({ ok: true, text: "转发白名单已保存" });
      } else {
        setNotice({ ok: false, text: `${d?.error ?? "保存失败"}${d?.invalid?.length ? `：${d.invalid.join("、")}` : ""}` });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 text-xs">
      <p className="text-muted">
        把询盘邮件转发到下面的地址：官网询盘通知、阿里巴巴国际站 / 中国制造网等平台的询盘通知、客户直接发来的邮件都可以。系统识别出买家后进入「线索资产」（活动：邮件转发询盘），自动生成回复草稿并通知销售。
      </p>
      <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-muted">转发地址</span>
          {address && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* ignore */
                }
              }}
              className="text-accent hover:underline"
            >
              {copied ? "已复制" : "复制"}
            </button>
          )}
        </div>
        <code className="break-all text-foreground">{enabled === null ? "读取中…" : address ?? "未开通（平台尚未配置收信域名）"}</code>
      </div>
      <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
        <label className="mb-1 block text-muted">允许转发的发件邮箱（每行一个）</label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="sales@your-factory.com"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={cn(notice ? (notice.ok ? "text-emerald-500" : "text-red-400") : "text-muted")}>
            {notice?.text ?? ""}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}保存白名单
          </button>
        </div>
      </div>
      <p className="text-muted">
        只接收白名单里的邮箱转发来的邮件。发件人不在白名单、发件域名没通过 DKIM 验证、或识别不出买家邮箱 / 电话的邮件会被隔离并通知企业管理员，不会建线索。官网已经推送过的询盘再转发过来记为重复，不会重复建商机。
      </p>
    </div>
  );
}

function AddChannelModal({ orgId, onClose, onAdded }: { orgId: string; onClose: () => void; onAdded: () => void }) {
  const [channel, setChannel] = useState("whatsapp");
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = CHANNEL_INFO[channel];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/trade/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, channel, name, config }),
      });
      if (res.ok) onAdded();
      else {
        const d = (await res.json().catch(() => null)) as { error?: string; invalid?: string[] } | null;
        setError(`${d?.error ?? "保存失败"}${d?.invalid?.length ? `：${d.invalid.join("、")}` : ""}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card-bg p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-foreground">添加消息通道</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">通道类型</label>
              <select value={channel} onChange={(e) => { setChannel(e.target.value); setConfig({}); }} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none">
                {Object.entries(CHANNEL_INFO).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">显示名称</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 公司 WhatsApp" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
            </div>
          </div>
          {info?.fields.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium text-foreground">{f.label}</label>
              <input
                value={config[f.key] ?? ""}
                onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                type="password"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
              />
            </div>
          ))}
          {channel === "email" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">允许转发的发件邮箱（每行一个）</label>
              <textarea
                value={config.forwarderAllowlist ?? ""}
                onChange={(e) => setConfig({ ...config, forwarderAllowlist: e.target.value })}
                rows={3}
                placeholder="sales@your-factory.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-muted">转发地址由系统生成，保存后在通道卡片里查看。</p>
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
            <p className="text-xs text-amber-400">配置信息将加密存储。Webhook URL 配置完成后会显示在通道详情中。</p>
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground">取消</button>
            <button type="submit" disabled={saving || !name.trim()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />}
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
