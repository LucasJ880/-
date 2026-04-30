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
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  {Object.entries(ch.config).map(([k, v]) => (
                    <span key={k}>{k}: <span className="text-foreground">{v}</span></span>
                  ))}
                </div>
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

function AddChannelModal({ orgId, onClose, onAdded }: { orgId: string; onClose: () => void; onAdded: () => void }) {
  const [channel, setChannel] = useState("whatsapp");
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const info = CHANNEL_INFO[channel];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/trade/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, channel, name, config }),
      });
      if (res.ok) onAdded();
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
