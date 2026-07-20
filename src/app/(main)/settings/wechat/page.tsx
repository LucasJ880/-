"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { apiFetch, apiJson } from "@/lib/api-fetch";
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
  mode: string | null;
  fulfillmentOrgId: string | null;
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

  // 企业微信配置表单（平台级）
  const [wecomForm, setWecomForm] = useState({
    corpId: "",
    agentId: "",
    secret: "",
    callbackToken: "",
    encodingKey: "",
  });
  const [showWecomForm, setShowWecomForm] = useState(false);
  const [platformWecom, setPlatformWecom] = useState<GatewayInfo | null>(null);
  const [canManagePlatformWecom, setCanManagePlatformWecom] = useState(false);
  const [wecomUserId, setWecomUserId] = useState("");
  const [bindError, setBindError] = useState<string | null>(null);
  const [bindOk, setBindOk] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [gwRes, bindRes] = await Promise.all([
        apiJson<{
          gateways?: GatewayInfo[];
          orgId?: string | null;
          platformWecom?: GatewayInfo | null;
          canManagePlatformWecom?: boolean;
        }>("/api/messaging/gateway"),
        apiJson<{ bindings?: BindingInfo[] }>("/api/messaging/bindings"),
      ]);
      setGateways(gwRes.gateways || []);
      setPlatformWecom(gwRes.platformWecom ?? null);
      setCanManagePlatformWecom(Boolean(gwRes.canManagePlatformWecom));
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
        body: JSON.stringify({
          action: "configure_wecom",
          scope: "platform",
          ...wecomForm,
        }),
      });
      setShowWecomForm(false);
      await fetchData();
    } catch (e) {
      console.error("保存失败:", e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleBindWecom = async () => {
    const externalId = wecomUserId.trim();
    if (!externalId) {
      setBindError("请填写企微 UserId");
      return;
    }
    setActionLoading("bind_wecom");
    setBindError(null);
    setBindOk(false);
    try {
      await apiFetch("/api/messaging/bindings", {
        method: "POST",
        body: JSON.stringify({
          channel: "wecom",
          externalId,
          displayName: externalId,
        }),
      });
      setWecomUserId("");
      setBindOk(true);
      await fetchData();
    } catch (e) {
      setBindError(e instanceof Error ? e.message : "绑定失败");
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
  const wecomGw = platformWecom;

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
                  <div className="w-full rounded-lg border border-amber-300/40 bg-amber-50/50 p-2.5 text-[11px] leading-relaxed text-amber-700">
                    <p className="font-medium">扫码前请确认账号已开通 ClawBot（灰度）：</p>
                    <p>· iOS 微信 8.0.70+；微信「我 → 设置 → 插件」能看到 ClawBot 入口</p>
                    <p>· 若提示「该账号不支持此功能」，说明未在灰度名单，请换已开通的账号，或改用企业微信通道</p>
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

      {/* ── 企业微信（平台级统一入口）── */}
      <ChannelCard
        title="企业微信"
        icon={<Building2 size={20} />}
        subtitle="青砚平台统一入口：一套企微应用服务全部组织，进线后按账号绑定进入工作组织"
        status={wecomGw?.status ?? "disconnected"}
        nickname={wecomGw?.corpId ? `企业 ${wecomGw.corpId}` : undefined}
        lastHeartbeat={wecomGw?.lastHeartbeat}
        error={wecomGw?.errorMessage}
        actions={
          canManagePlatformWecom ? (
            <div className="flex items-center gap-2">
              {wecomGw?.status === "active" && (
                <button
                  onClick={() =>
                    handleGatewayAction("disconnect", {
                      channel: "wecom",
                      scope: "platform",
                    })
                  }
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
          ) : (
            <span className="text-xs text-muted">由平台管理员配置；你只需完成下方账号绑定</span>
          )
        }
      />

      {!showWecomForm && <WeComCallbackHint />}

      {/* 企业微信配置表单（平台管理员） */}
      {showWecomForm && canManagePlatformWecom && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="text-sm font-medium">平台企业微信应用配置</h3>
          <p className="text-xs text-muted">
            在企业微信管理后台 → 应用管理 → 自建应用中获取以下信息。保存后作为青砚全平台入口，不绑定单一客户组织。
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
          <WeComCallbackHint />
        </div>
      )}

      {/* ── 企业微信账号绑定 ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-medium">绑定企业微信账号</h3>
        <p className="text-xs text-muted">
          必须绑定后，在企微应用里发消息才会进入你的青砚工作组织。UserId 在企微管理后台 → 通讯录 → 成员详情 →「账号」。
          也可先给 mengxin 发消息，未绑定时机器人会把你的 UserId 回复给你。
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            value={wecomUserId}
            onChange={(e) => setWecomUserId(e.target.value)}
            placeholder="企微 UserId，例如 ZhangSan"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleBindWecom()}
            disabled={actionLoading === "bind_wecom"}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2b6055] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2b6055]/90 disabled:opacity-50"
          >
            {actionLoading === "bind_wecom" ? <Loader2 size={12} className="animate-spin" /> : null}
            绑定
          </button>
        </div>
        {bindError && <p className="text-xs text-red-500">{bindError}</p>}
        {bindOk && <p className="text-xs text-[#2e7a56]">绑定成功，请回到企微再发一句「你好」。</p>}
        {bindings.some((b) => b.channel === "wecom" && b.status === "active") && (
          <p className="text-xs text-muted">
            已绑定：
            {bindings
              .filter((b) => b.channel === "wecom" && b.status === "active")
              .map((b) => b.displayName || b.externalId)
              .join("、")}
          </p>
        )}
      </div>

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

/**
 * 企业微信回调 URL 提示（平台级）。
 * 优先使用 NEXT_PUBLIC_WECHAT_PUBLIC_ORIGIN（备案子域名），避免在 qingyan.ca 上误填加拿大域。
 */
function WeComCallbackHint() {
  const [copied, setCopied] = useState(false);
  const configuredOrigin = (
    process.env.NEXT_PUBLIC_WECHAT_PUBLIC_ORIGIN || ""
  ).trim().replace(/\/$/, "");
  const browserOrigin =
    typeof window !== "undefined" ? window.location.origin : "";
  const origin = configuredOrigin || browserOrigin;
  const usingRecommended = Boolean(configuredOrigin);
  // 平台级回调：固定 ?org=platform（也可省略 org）
  const callbackUrl = `${origin}/api/messaging/wecom/callback?org=platform`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-[11px] text-muted space-y-2">
      <p className="font-medium text-foreground/80">企业微信接收消息 · 平台回调 URL</p>
      <div className="flex items-start gap-2">
        <code className="flex-1 rounded bg-muted/10 px-1.5 py-1 break-all text-[11px] text-foreground/90">
          {callbackUrl}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/10"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      {usingRecommended ? (
        <p className="text-[10px] text-[#2e7a56]">
          已使用备案回调域名（NEXT_PUBLIC_WECHAT_PUBLIC_ORIGIN）。产品站可继续使用 qingyan.ca。
        </p>
      ) : (
        <p className="text-[10px] text-amber-700/90">
          未配置 NEXT_PUBLIC_WECHAT_PUBLIC_ORIGIN，当前按浏览器域名拼接。生产请设为
          https://wechat.mengxinhometextile.com，避免把 qingyan.ca 填进企微后台。
        </p>
      )}
      <ol className="list-decimal space-y-1 pl-4 text-[10px] leading-relaxed">
        <li>阿里云 DNS：主机记录 <code className="rounded bg-muted/10 px-0.5">wechat</code>，类型 A，记录值 <code className="rounded bg-muted/10 px-0.5">76.76.21.21</code>（以 Vercel Domains 提示为准）。</li>
        <li>平台管理员在本页保存一套 CorpID / AgentId / Secret / Token / EncodingAESKey。</li>
        <li>企业微信后台 → 应用管理 → 自建应用 → 接收消息：粘贴上方 URL（含 <code className="rounded bg-muted/10 px-0.5">org=platform</code>），Token 与 EncodingAESKey 与本页一致，点保存并验证。</li>
        <li>成员在青砚完成企微账号绑定后，在应用内发测试文本；业务归属走当前工作组织。</li>
      </ol>
      <p>支持消息类型：文本、图片。路径固定为 /api/messaging/wecom/callback，勿使用 /wechat/callback。勿再填写客户组织 ID。</p>
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
