"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import {
  Loader2,
  MessageCircle,
  Building2,
  CheckCircle2,
  XCircle,
  Wifi,
  WifiOff,
  Bell,
  BellOff,
  ArrowLeft,
  RefreshCw,
  X,
  QrCode,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";

interface GatewayInfo {
  id: string;
  channel: string;
  status: string;
  loginStatus: string;
  botNickname: string | null;
  corpId: string | null;
  agentId: string | null;
  lastHeartbeat: string | null;
  errorMessage: string | null;
}

interface BindingInfo {
  id: string;
  userId: string;
  channel: string;
  externalId: string;
  displayName: string | null;
  status: string;
  pushBriefing: boolean;
  pushFollowup: boolean;
  pushReport: boolean;
  pushSales: boolean;
  pushDomains: string;
  filterMode: string;
  filterKeyword: string | null;
}

interface QrModalState {
  open: boolean;
  qrUrl: string | null;
  ticket: string | null;
  error: string | null;
  hint: string | null;
  loading: boolean;
}

export default function WeChatSettingsPage() {
  const [gateways, setGateways] = useState<GatewayInfo[]>([]);
  const [bindings, setBindings] = useState<BindingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [qrModal, setQrModal] = useState<QrModalState>({
    open: false, qrUrl: null, ticket: null, error: null, hint: null, loading: false,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 企业微信配置表单
  const [wecomForm, setWecomForm] = useState({
    corpId: "",
    agentId: "",
    secret: "",
    callbackToken: "",
    encodingKey: "",
  });
  const [showWecomForm, setShowWecomForm] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [gwRes, bindRes] = await Promise.all([
        apiFetch("/api/messaging/gateway").then((r) => r.json()),
        apiFetch("/api/messaging/bindings").then((r) => r.json()),
      ]);
      setGateways(gwRes.gateways || []);
      setBindings(bindRes.bindings || []);
    } catch {
      // 初次可能没有数据
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const ticket = qrModal.ticket;
        if (!ticket) return;

        const res = await apiFetch("/api/messaging/gateway", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check_qr_status", ticket }),
        });
        const data = await res.json();

        if (data.status === "confirmed") {
          stopPolling();
          setQrModal({ open: false, qrUrl: null, ticket: null, error: null, hint: null, loading: false });
          await fetchData();
        } else if (data.status === "scaned") {
          setQrModal((prev) => ({ ...prev, hint: "已扫码，请在手机上确认…" }));
        } else if (data.status === "expired") {
          stopPolling();
          setQrModal((prev) => ({ ...prev, error: "二维码已过期，请重新扫码", loading: false }));
        } else if (data.status === "error") {
          stopPolling();
          setQrModal((prev) => ({ ...prev, error: data.error || "扫码失败", loading: false }));
        }
      } catch { /* ignore */ }
    }, 3000);
  }, [fetchData, stopPolling, qrModal.ticket]);

  const handleRequestQR = async () => {
    setQrModal({ open: true, qrUrl: null, ticket: null, error: null, hint: null, loading: true });
    try {
      const res = await apiFetch("/api/messaging/gateway", {
        method: "POST",
        body: JSON.stringify({ action: "request_qr" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setQrModal({
          open: true, qrUrl: null, ticket: null,
          error: data.error || "请求失败",
          hint: data.hint || null,
          loading: false,
        });
        return;
      }
      setQrModal({
        open: true, qrUrl: data.qrUrl, ticket: data.ticket,
        error: null, hint: null, loading: false,
      });
      startPolling();
    } catch (e) {
      setQrModal({
        open: true, qrUrl: null, ticket: null,
        error: e instanceof Error ? e.message : "网络请求失败",
        hint: null, loading: false,
      });
    }
  };

  const closeQrModal = () => {
    stopPolling();
    setQrModal({ open: false, qrUrl: null, ticket: null, error: null, hint: null, loading: false });
  };

  const handleGatewayAction = async (action: string, extra?: Record<string, string>) => {
    if (action === "request_qr") {
      await handleRequestQR();
      return;
    }
    setActionLoading(action);
    try {
      await apiFetch("/api/messaging/gateway", {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
      });
      await fetchData();
    } catch (e) {
      console.error("操作失败:", e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleWecomSave = async () => {
    setActionLoading("configure_wecom");
    try {
      await apiFetch("/api/messaging/gateway", {
        method: "POST",
        body: JSON.stringify({ action: "configure_wecom", ...wecomForm }),
      });
      setShowWecomForm(false);
      await fetchData();
    } catch (e) {
      console.error("保存失败:", e);
    } finally {
      setActionLoading(null);
    }
  };

  const togglePush = async (bindingId: string, field: string, value: boolean) => {
    try {
      await apiFetch("/api/messaging/bindings", {
        method: "POST",
        body: JSON.stringify({ action: "update_preferences", bindingId, [field]: value }),
      });
      setBindings((prev) =>
        prev.map((b) =>
          b.id === bindingId ? { ...b, [field]: value } : b,
        ),
      );
    } catch (e) {
      console.error("更新失败:", e);
    }
  };

  const personalGw = gateways.find((g) => g.channel === "personal_wechat");
  const wecomGw = gateways.find((g) => g.channel === "wecom");

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-foreground"
        >
          <ArrowLeft size={18} />
        </Link>
        <PageHeader title="微信集成" description="管理个人微信和企业微信的连接，控制 AI 消息推送" />
      </div>

      {/* QR 码弹窗 */}
      {qrModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="relative mx-4 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <button
              onClick={closeQrModal}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-foreground"
            >
              <X size={16} />
            </button>

            <div className="flex flex-col items-center space-y-4">
              <div className="rounded-xl bg-[#07c160]/10 p-3">
                <QrCode size={28} className="text-[#07c160]" />
              </div>
              <h3 className="text-lg font-semibold">微信扫码登录</h3>

              {qrModal.loading && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 size={32} className="animate-spin text-[#07c160]" />
                  <p className="text-sm text-muted">正在获取二维码…</p>
                </div>
              )}

              {qrModal.qrUrl && !qrModal.loading && (
                <>
                  <div className="rounded-xl border-2 border-[#07c160]/20 bg-white p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrModal.qrUrl}
                      alt="微信登录二维码"
                      className="h-52 w-52 object-contain"
                    />
                  </div>
                  <p className="text-center text-sm text-muted">
                    请使用微信扫描上方二维码
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Loader2 size={12} className="animate-spin" />
                    {qrModal.hint || "等待扫码确认中…"}
                  </div>
                </>
              )}

              {qrModal.error && !qrModal.loading && (
                <div className="w-full space-y-3">
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
                    <div className="space-y-1">
                      <p className="text-sm text-red-500">{qrModal.error}</p>
                      {qrModal.hint && (
                        <p className="text-xs text-muted">{qrModal.hint}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleRequestQR}
                    className="w-full rounded-lg bg-[#07c160] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#07c160]/90"
                  >
                    重新获取二维码
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 个人微信 ── */}
      <ChannelCard
        title="个人微信"
        icon={<MessageCircle size={20} />}
        subtitle="通过 iLink Bot API 接入，微信对话直连青砚 AI"
        status={personalGw?.loginStatus ?? "disconnected"}
        nickname={personalGw?.botNickname}
        lastHeartbeat={personalGw?.lastHeartbeat}
        error={personalGw?.errorMessage}
        actions={
          personalGw?.status === "active" ? (
            <button
              onClick={() => handleGatewayAction("disconnect", { channel: "personal_wechat" })}
              disabled={actionLoading !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
            >
              {actionLoading === "disconnect" ? <Loader2 size={12} className="animate-spin" /> : <WifiOff size={12} />}
              断开连接
            </button>
          ) : (
            <button
              onClick={() => handleGatewayAction("request_qr")}
              disabled={qrModal.loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#07c160] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#07c160]/90"
            >
              {qrModal.loading ? <Loader2 size={12} className="animate-spin" /> : <QrCode size={14} />}
              扫码登录
            </button>
          )
        }
      />

      {/* ── 企业微信 ── */}
      <ChannelCard
        title="企业微信"
        icon={<Building2 size={20} />}
        subtitle="通过企业微信应用 API 接入，支持部门级推送"
        status={wecomGw?.status ?? "disconnected"}
        nickname={wecomGw?.corpId ? `企业 ${wecomGw.corpId}` : undefined}
        lastHeartbeat={wecomGw?.lastHeartbeat}
        error={wecomGw?.errorMessage}
        actions={
          <div className="flex items-center gap-2">
            {wecomGw?.status === "active" && (
              <button
                onClick={() => handleGatewayAction("disconnect", { channel: "wecom" })}
                disabled={actionLoading !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
              >
                断开
              </button>
            )}
            <button
              onClick={() => setShowWecomForm(!showWecomForm)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2b6055] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2b6055]/90"
            >
              {wecomGw ? "修改配置" : "配置企业微信"}
            </button>
          </div>
        }
      />

      {/* 企业微信配置表单 */}
      {showWecomForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="text-sm font-medium">企业微信应用配置</h3>
          <p className="text-xs text-muted">
            在企业微信管理后台 → 应用管理 → 自建应用中获取以下信息
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["corpId", "企业 ID (CorpID)"],
                ["agentId", "应用 AgentId"],
                ["secret", "应用 Secret"],
                ["callbackToken", "回调 Token"],
                ["encodingKey", "回调 EncodingAESKey"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className={key === "encodingKey" ? "col-span-2" : ""}>
                <label className="mb-1 block text-xs text-muted">{label}</label>
                <input
                  type={key === "secret" ? "password" : "text"}
                  value={wecomForm[key]}
                  onChange={(e) => setWecomForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted/50 focus:border-accent focus:outline-none"
                  placeholder={label}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowWecomForm(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-muted/10"
            >
              取消
            </button>
            <button
              onClick={handleWecomSave}
              disabled={!wecomForm.corpId || !wecomForm.secret || actionLoading === "configure_wecom"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {actionLoading === "configure_wecom" ? <Loader2 size={12} className="animate-spin" /> : null}
              保存并验证
            </button>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-[11px] text-muted space-y-1">
            <p>回调 URL 设置为：<code className="rounded bg-muted/10 px-1">{typeof window !== "undefined" ? window.location.origin : ""}/api/messaging/wecom/callback?org=YOUR_ORG_ID</code></p>
            <p>支持消息类型：文本消息</p>
          </div>
        </div>
      )}

      {/* ── 推送偏好 ── */}
      {bindings.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h3 className="font-medium">推送偏好</h3>
            <p className="mt-0.5 text-xs text-muted">根据你的角色，控制各业务域的微信推送</p>
          </div>
          <div className="divide-y divide-border">
            {bindings.map((b) => {
              const domains = b.pushDomains.split(",").map((d) => d.trim());
              const hasTrade = domains.includes("all") || domains.includes("trade");
              const hasSales = domains.includes("all") || domains.includes("sales");

              return (
                <div key={b.id} className="px-5 py-4 space-y-4">
                  <div className="flex items-center gap-2">
                    {b.channel === "personal_wechat" ? (
                      <MessageCircle size={14} className="text-[#07c160]" />
                    ) : (
                      <Building2 size={14} className="text-accent" />
                    )}
                    <span className="text-sm font-medium">
                      {b.displayName || b.externalId}
                    </span>
                    <span className="rounded-full bg-muted/10 px-2 py-0.5 text-[10px] text-muted">
                      {b.channel === "personal_wechat" ? "个人微信" : "企业微信"}
                    </span>
                    <DomainBadges domains={domains} />
                  </div>

                  {/* 外贸域推送 */}
                  {hasTrade && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-muted uppercase tracking-wider">外贸</p>
                      <div className="flex flex-wrap gap-2">
                        <PushToggle
                          label="每日简报"
                          icon={<Bell size={12} />}
                          enabled={b.pushBriefing}
                          onChange={(v) => togglePush(b.id, "pushBriefing", v)}
                        />
                        <PushToggle
                          label="跟进提醒"
                          icon={<RefreshCw size={12} />}
                          enabled={b.pushFollowup}
                          onChange={(v) => togglePush(b.id, "pushFollowup", v)}
                        />
                        <PushToggle
                          label="外贸周报"
                          icon={<Bell size={12} />}
                          enabled={b.pushReport}
                          onChange={(v) => togglePush(b.id, "pushReport", v)}
                        />
                      </div>
                    </div>
                  )}

                  {/* 销售域推送 */}
                  {hasSales && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-muted uppercase tracking-wider">销售</p>
                      <div className="flex flex-wrap gap-2">
                        <PushToggle
                          label="销售提醒"
                          icon={<Bell size={12} />}
                          enabled={b.pushSales}
                          onChange={(v) => togglePush(b.id, "pushSales", v)}
                        />
                      </div>
                    </div>
                  )}

                  {/* 无匹配域 */}
                  {!hasTrade && !hasSales && (
                    <p className="text-xs text-muted">当前角色暂无业务域推送，绑定后可在此管理通用通知。</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelCard({
  title,
  icon,
  subtitle,
  status,
  nickname,
  lastHeartbeat,
  error,
  actions,
}: {
  title: string;
  icon: React.ReactNode;
  subtitle: string;
  status: string;
  nickname?: string | null;
  lastHeartbeat?: string | null;
  error?: string | null;
  actions: React.ReactNode;
}) {
  const isActive = status === "active" || status === "connected";
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-start justify-between px-5 py-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-lg p-2 ${isActive ? "bg-[#07c160]/10 text-[#07c160]" : "bg-muted/10 text-muted"}`}>
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{title}</h3>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                isActive
                  ? "bg-[#07c160]/10 text-[#07c160]"
                  : status === "qr_pending" || status === "scanning"
                    ? "bg-amber-500/10 text-amber-500"
                    : "bg-muted/10 text-muted"
              }`}>
                {isActive ? (
                  <><CheckCircle2 size={10} />已连接</>
                ) : status === "qr_pending" ? (
                  "等待扫码"
                ) : status === "error" ? (
                  <><XCircle size={10} />异常</>
                ) : (
                  "未连接"
                )}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
            {nickname && (
              <p className="mt-1 text-xs text-foreground/80">
                账号：{nickname}
              </p>
            )}
            {lastHeartbeat && (
              <p className="mt-0.5 text-[10px] text-muted">
                上次心跳：{new Date(lastHeartbeat).toLocaleString("zh-CN")}
              </p>
            )}
            {error && (
              <p className="mt-1 text-xs text-red-500">{error}</p>
            )}
          </div>
        </div>
        <div className="shrink-0">{actions}</div>
      </div>
    </div>
  );
}

function DomainBadges({ domains }: { domains: string[] }) {
  const DOMAIN_LABELS: Record<string, { label: string; color: string }> = {
    all: { label: "全部", color: "bg-accent/10 text-accent" },
    trade: { label: "外贸", color: "bg-blue-500/10 text-blue-500" },
    sales: { label: "销售", color: "bg-orange-500/10 text-orange-500" },
    project: { label: "项目", color: "bg-purple-500/10 text-purple-500" },
  };

  return (
    <div className="ml-auto flex items-center gap-1">
      {domains.map((d) => {
        const info = DOMAIN_LABELS[d];
        if (!info) return null;
        return (
          <span key={d} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${info.color}`}>
            {info.label}
          </span>
        );
      })}
    </div>
  );
}

function PushToggle({
  label,
  icon,
  enabled,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        enabled
          ? "border-accent/30 bg-accent/5 text-accent"
          : "border-border bg-background text-muted"
      }`}
    >
      {enabled ? icon : <BellOff size={12} />}
      {label}
    </button>
  );
}
