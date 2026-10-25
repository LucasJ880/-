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
  /** 凭证只显示末 4 位；allowedOrigins 等非凭证字段原样 */
  config: Record<string, unknown>;
  createdAt: string;
}

interface WebsiteCredentials {
  secret: string | null;
  secretPrevExpiresAt: string | null;
  /** 仍在宽限期内的旧密钥（只有末 4 位）与各自到期时间 */
  previousSecrets?: { hint: string; expiresAt: string }[];
  publicKey: string | null;
  allowedOrigins: string[];
  embedReady: boolean;
}

interface WebsiteChannelView {
  canManage: boolean;
  website?: WebsiteCredentials;
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
    // 凭证（服务端密钥 / 嵌入表单公开 key）由服务端生成，添加后在通道卡片里查看接入方式
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
  const [canManage, setCanManage] = useState(false);
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
    if (res.ok) {
      setChannels(await res.json());
      setCanManage(res.headers.get("x-qingyan-can-manage-channels") === "1");
    } else {
      setChannels([]);
      setCanManage(false);
    }
    setLoading(false);
  }, [orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  const handleDelete = async (channel: string) => {
    if (!orgId || ambiguous) return;
    if (!confirm("确定删除该通道配置？")) return;
    const res = await apiFetch(`/api/trade/channels/${channel}?orgId=${encodeURIComponent(orgId)}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      alert(d?.error ?? "删除失败");
    }
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
        <span className="text-xs text-muted">
          {channels.length} 个通道{!canManage && channels.length > 0 ? " · 仅企业负责人或管理员可增删通道、查看密钥" : ""}
        </span>
        {canManage && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500">
            <Plus size={14} /> 添加通道
          </button>
        )}
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
                  {canManage && (
                    <button onClick={() => handleDelete(ch.channel)} aria-label="删除通道" className="rounded-lg p-1.5 text-muted transition hover:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {ch.channel === "website" ? (
                  <WebsiteInquirySetup orgId={orgId} />
                ) : ch.channel === "email" ? (
                  <EmailInboundSetup orgId={orgId} name={ch.name} />
                ) : (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {Object.entries(ch.config).map(([k, v]) => (
                      <span key={k}>{k}: <span className="text-foreground">{Array.isArray(v) ? v.join(", ") : String(v)}</span></span>
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

function CopyField({ label, value, copyKey, copied, onCopy, children }: {
  label: string;
  value: string | null;
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-muted">{label}</span>
        {value && (
          <button type="button" onClick={() => onCopy(copyKey, value)} className="text-accent hover:underline">
            {copied === copyKey ? "已复制" : "复制"}
          </button>
        )}
      </div>
      <code className="break-all text-foreground">{value ?? "—"}</code>
      {children}
    </div>
  );
}

function CodeBlock({ title, code, copyKey, copied, onCopy }: { title: string; code: string; copyKey: string; copied: string | null; onCopy: (key: string, text: string) => void }) {
  return (
    <details className="rounded-lg border border-border/60 bg-background/60 p-2.5">
      <summary className="cursor-pointer text-foreground">{title}</summary>
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={() => onCopy(copyKey, code)} className="text-accent hover:underline">
          {copied === copyKey ? "已复制" : "复制代码"}
        </button>
      </div>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-foreground/90">{code}</pre>
    </details>
  );
}

function WebsiteInquirySetup({ orgId }: { orgId: string }) {
  const [view, setView] = useState<WebsiteChannelView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [originsText, setOriginsText] = useState("");
  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const endpoint = `${appOrigin}/api/trade/webhook/website`;
  const scriptSrc = `${appOrigin}/embed/inquiry.js`;

  const apply = useCallback((d: WebsiteChannelView) => {
    setView(d);
    setOriginsText((d.website?.allowedOrigins ?? []).join("\n"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/trade/channels/website?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WebsiteChannelView | null) => {
        if (cancelled) return;
        if (d) apply(d);
        else setLoadFailed(true);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, apply]);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const act = async (action: string, extra?: Record<string, unknown>): Promise<boolean> => {
    setBusy(action);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/trade/channels/website`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, action, ...(extra ?? {}) }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice({ text: d?.error ?? "操作失败", bad: true });
        return false;
      }
      apply(d as WebsiteChannelView);
      return true;
    } finally {
      setBusy(null);
    }
  };

  const rotateSecret = async () => {
    if (!confirm("轮换后新密钥立即生效；当前密钥（以及仍在宽限期内的旧密钥）在各自 72 小时宽限期内仍可用，请在此期间把网站服务器上的密钥换成新的。继续？")) return;
    if (await act("rotate_secret")) setNotice({ text: "已生成新密钥。旧密钥在各自宽限期内仍可用，到期后失效。" });
  };
  const endSecretGrace = async () => {
    if (!confirm("立即停用所有旧密钥：只有当前密钥还能用，仍在用旧密钥的网站服务器会马上收到 401。确定继续？（密钥泄露时使用）")) return;
    if (await act("end_secret_grace")) setNotice({ text: "旧密钥已全部停用，只有当前密钥有效。" });
  };
  const rotatePublicKey = async () => {
    if (!confirm("轮换后网页上旧的嵌入代码立即失效，需要把 data-key 换成新值。继续？")) return;
    if (await act("rotate_public_key")) setNotice({ text: "已生成新的公开 key，请更新网页上的嵌入代码。" });
  };
  const enableEmbed = async () => {
    if (await act("enable_embed")) setNotice({ text: "已生成嵌入表单公开 key。填写来源域名后即可使用。" });
  };
  const saveOrigins = async () => {
    const list = originsText.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
    if (await act("set_allowed_origins", { allowedOrigins: list })) setNotice({ text: "来源域名已保存。" });
  };

  const intro = (
    <p className="text-muted">
      网站询盘自动进入「线索资产」（活动：网站询盘），带上来源页与 UTM，并即时通知销售。已有邮箱的买家会合并到原线索。两种接入方式任选其一。
    </p>
  );

  if (!view) {
    return (
      <div className="mt-3 space-y-3 text-xs">
        {intro}
        <p className="text-muted">{loadFailed ? "读取通道信息失败，请刷新重试。" : "读取中…"}</p>
      </div>
    );
  }

  if (!view.canManage || !view.website) {
    return (
      <div className="mt-3 space-y-3 text-xs">
        {intro}
        <p className="text-muted">仅企业负责人或企业管理员可以查看密钥与接入代码，请联系他们获取。</p>
      </div>
    );
  }

  const w = view.website;
  const curlExample = `curl -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -H "x-qingyan-webhook-secret: $QINGYAN_WEBHOOK_SECRET" \\
  -d '{"eventId":"inq_20261024_0001","name":"Jane Doe","email":"jane@example.com","company":"Example Textiles","country":"Canada","product":"Waffle bathrobe","message":"500 pcs, 380 gsm","page":"https://www.example.com/contact"}'`;
  const phpExample = `<?php
// 放在网站服务器端（联系表单的提交处理里）。密钥放服务器环境变量，不要输出到网页。
$payload = [
  'eventId' => $inquiryId,            // 你站点自己的询盘编号；重试时保持不变（幂等）
  'name'    => $_POST['name'] ?? '',
  'email'   => $_POST['email'] ?? '',
  'phone'   => $_POST['phone'] ?? '',
  'company' => $_POST['company'] ?? '',
  'country' => $_POST['country'] ?? '',
  'product' => $_POST['product'] ?? '',
  'message' => $_POST['message'] ?? '',
  'page'    => $_SERVER['HTTP_REFERER'] ?? '',
];
$ch = curl_init('${endpoint}');
curl_setopt_array($ch, [
  CURLOPT_POST           => true,
  CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'x-qingyan-webhook-secret: ' . getenv('QINGYAN_WEBHOOK_SECRET')],
  CURLOPT_POSTFIELDS     => json_encode($payload),
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT        => 15,
]);
$body   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
// 200 = 已收到（AI 草稿在后台生成）；网络错误或 5xx 时用同一 eventId 稍后重试`;
  const embedSnippet = w.publicKey
    ? `<!-- 青砚询盘表单：放在网页上要显示表单的位置 -->
<script src="${scriptSrc}" data-key="${w.publicKey}" data-lang="en" async></script>`
    : "";

  return (
    <div className="mt-3 space-y-4 text-xs">
      {intro}

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">方式一：网站服务器转发（有开发能力的网站）</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <CopyField label="接口地址" value={endpoint} copyKey="endpoint" copied={copied} onCopy={copy} />
          <CopyField label="服务端密钥（请求头 x-qingyan-webhook-secret）" value={w.secret} copyKey="secret" copied={copied} onCopy={copy}>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button type="button" disabled={busy !== null} onClick={rotateSecret} className="text-accent hover:underline disabled:opacity-50">
                {busy === "rotate_secret" ? "轮换中…" : "轮换密钥"}
              </button>
              {(w.previousSecrets?.length ?? 0) > 0 && (
                <button type="button" disabled={busy !== null} onClick={endSecretGrace} className="text-red-400 hover:underline disabled:opacity-50">
                  {busy === "end_secret_grace" ? "停用中…" : "立即停用旧密钥"}
                </button>
              )}
            </div>
            {(w.previousSecrets ?? []).map((p) => (
              <div key={`${p.hint}-${p.expiresAt}`} className="mt-1 text-muted">
                旧密钥 {p.hint} 有效至 {new Date(p.expiresAt).toLocaleString()}
              </div>
            ))}
          </CopyField>
        </div>
        <p className="text-amber-500">密钥只能放在网站服务器上（环境变量），不要写进网页 HTML 或前端 JS——浏览器里的任何人都能看到。</p>
        <CodeBlock title="服务器调用示例（curl）" code={curlExample} copyKey="curl" copied={copied} onCopy={copy} />
        <CodeBlock title="服务器调用示例（PHP）" code={phpExample} copyKey="php" copied={copied} onCopy={copy} />
        <p className="text-muted">
          字段：name / email / phone / company / country / product / message，可选 eventId（幂等）、page、utm_*。处理状态可用 GET {endpoint}/status?eventId=…（同一密钥请求头）查询。
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">方式二：嵌入表单（零代码，复制一行到网页）</h3>
        {!w.publicKey ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={enableEmbed}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {busy === "enable_embed" && <Loader2 size={12} className="animate-spin" />}启用嵌入表单
          </button>
        ) : (
          <>
            <CopyField label="公开 key（写在网页里，本身不是机密）" value={w.publicKey} copyKey="publicKey" copied={copied} onCopy={copy}>
              <div className="mt-2">
                <button type="button" disabled={busy !== null} onClick={rotatePublicKey} className="text-accent hover:underline disabled:opacity-50">
                  {busy === "rotate_public_key" ? "轮换中…" : "轮换公开 key（旧代码立即失效）"}
                </button>
              </div>
            </CopyField>
            <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
              <label htmlFor="qy-allowed-origins" className="mb-1 block text-muted">
                允许的来源域名（只有这些网站上的表单能提交；每行一个，如 https://www.example.com）
              </label>
              <textarea
                id="qy-allowed-origins"
                value={originsText}
                onChange={(e) => setOriginsText(e.target.value)}
                rows={3}
                placeholder={"https://www.example.com\nhttps://example.com"}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted">带 www 与不带 www、http 与 https 是不同来源，需分别填写；不要带路径。</span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={saveOrigins}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {busy === "set_allowed_origins" && <Loader2 size={12} className="animate-spin" />}保存来源
                </button>
              </div>
            </div>
            <CodeBlock title="嵌入代码（复制到网站 Contact Us 页面）" code={embedSnippet} copyKey="embed" copied={copied} onCopy={copy} />
            <p className={w.embedReady ? "text-muted" : "text-amber-500"}>
              {w.embedReady
                ? "表单字段：姓名、邮箱、电话（选填）、公司、国家、感兴趣的产品、数量、留言。data-lang 可设 en / zh，data-product 可预填产品。表单不设 cookie，来源与 UTM 只存在访客当前标签页。"
                : "还没有填写来源域名：表单能显示，但提交会被拒绝。"}
            </p>
          </>
        )}
      </section>

      {notice && <p className={notice.bad ? "text-red-400" : "text-emerald-500"}>{notice.text}</p>}
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
            <p className="text-xs text-amber-400">凭证保存在青砚数据库中，只有企业负责人或企业管理员可以管理；通道列表里只显示末 4 位。</p>
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
