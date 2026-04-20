"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { PageHeader } from "@/components/page-header";
import { Label } from "@/components/ui/label";
import {
  Mail,
  CheckCircle,
  XCircle,
  Loader2,
  Shield,
  Trash2,
  Send,
  ChevronDown,
  Sparkles,
} from "lucide-react";

interface GmailState {
  connected: boolean;
  email?: string;
  grantedScopes?: string;
}

interface SmtpState {
  configured: boolean;
  email?: string;
  displayName?: string;
  verified?: boolean;
  verifiedAt?: string | null;
  lastSentAt?: string | null;
  lastError?: string | null;
}

interface StatusResponse {
  gmail: GmailState;
  smtp: SmtpState;
  activeChannel: "gmail" | "smtp" | null;
}

interface BindingData {
  id: string;
  email: string;
  displayName: string;
  provider: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  useTls: boolean;
  verified: boolean;
  verifiedAt: string | null;
  lastSentAt: string | null;
  lastError: string | null;
}

const PRESETS = [
  { label: "Gmail", host: "smtp.gmail.com", port: 587, hint: "使用 App Password" },
  { label: "Outlook / 365", host: "smtp.office365.com", port: 587, hint: "使用账户密码" },
  { label: "QQ 邮箱", host: "smtp.qq.com", port: 587, hint: "使用授权码" },
  { label: "自定义", host: "", port: 587, hint: "" },
];

export default function EmailBindingPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [binding, setBinding] = useState<BindingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unlinkingGmail, setUnlinkingGmail] = useState(false);
  const [showSmtp, setShowSmtp] = useState(false);
  const [msg, setMsg] = useState("");

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [useTls, setUseTls] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const d = await apiJson<StatusResponse>("/api/sales/email-status");
      setStatus(d);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    apiJson<{ binding?: BindingData }>("/api/sales/email-binding")
      .then((d) => {
        if (d.binding) {
          setBinding(d.binding);
          setEmail(d.binding.email);
          setDisplayName(d.binding.displayName);
          setSmtpHost(d.binding.smtpHost || "smtp.gmail.com");
          setSmtpPort(d.binding.smtpPort || 587);
          setSmtpUser(d.binding.smtpUser || "");
          setUseTls(d.binding.useTls ?? true);
          // 已有 SMTP 绑定时默认展开高级配置
          setShowSmtp(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // OAuth 回调跳回 /settings/email?gmail=success|error，回来时刷新状态
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("gmail")) {
      const flag = url.searchParams.get("gmail");
      if (flag === "success") {
        setMsg("Google 邮箱连接成功！后续报价邮件将自动用你的 Gmail 发送");
      } else if (flag === "error") {
        const reason = url.searchParams.get("reason") || "";
        setMsg(`Google 授权失败${reason ? `：${reason}` : ""}，请重试`);
      }
      url.searchParams.delete("gmail");
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url.toString());
      loadStatus();
    }
  }, [loadStatus]);

  const handleConnectGoogle = () => {
    // 带上 return_to 让 callback 回跳到当前页面（默认跳 /settings）
    window.location.href = "/api/auth/google-email?return_to=/settings/email";
  };

  const handleUnlinkGoogle = async () => {
    if (!confirm("确定断开 Google 邮箱？之后报价邮件会回落到 SMTP 或无法发送")) return;
    setUnlinkingGmail(true);
    try {
      await apiFetch("/api/auth/google-email/status", { method: "DELETE" });
      setMsg("已断开 Google 邮箱连接");
      loadStatus();
    } finally {
      setUnlinkingGmail(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      await apiJson("/api/sales/email-binding", {
        method: "POST",
        body: JSON.stringify({ email, displayName, smtpHost, smtpPort, smtpUser, smtpPass, useTls }),
      });
      setBinding((b) => b ? { ...b, email, displayName, verified: false } : null);
      setMsg("已保存，请点击验证连接");
      loadStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setMsg("");
    try {
      const res = await apiJson<{ verified: boolean; error?: string }>("/api/sales/email-binding/verify", {
        method: "POST",
      });
      if (res.verified) {
        setMsg("验证成功！邮箱已可用于自动发信");
        setBinding((b) => b ? { ...b, verified: true, verifiedAt: new Date().toISOString(), lastError: null } : null);
        loadStatus();
      } else {
        setMsg(`验证失败：${res.error}`);
        setBinding((b) => b ? { ...b, verified: false, lastError: res.error ?? null } : null);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "验证失败");
    } finally {
      setVerifying(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("确定解绑 SMTP 邮箱？")) return;
    setDeleting(true);
    try {
      await apiFetch("/api/sales/email-binding", { method: "DELETE" });
      setBinding(null);
      setEmail("");
      setDisplayName("");
      setSmtpUser("");
      setSmtpPass("");
      setMsg("已解绑 SMTP 邮箱");
      loadStatus();
    } finally {
      setDeleting(false);
    }
  };

  const applyPreset = (idx: number) => {
    const p = PRESETS[idx];
    if (p.host) setSmtpHost(p.host);
    setSmtpPort(p.port);
  };

  if (loading || statusLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const gmail = status?.gmail;
  const activeChannel = status?.activeChannel;

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="邮箱绑定"
        description="绑定一次，报价 / 通知邮件自动从你的邮箱发给客户"
      />

      {/* ─── 当前生效通道提示 ─── */}
      {activeChannel && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-sm text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-emerald-600" />
            <span>
              当前发信通道：
              <strong className="ml-1">
                {activeChannel === "gmail" ? "Google Gmail（OAuth 一键授权）" : "SMTP 邮箱"}
              </strong>
            </span>
          </div>
        </div>
      )}

      {/* ─── Google OAuth 一键授权（主推） ─── */}
      <div className="rounded-xl border-2 border-accent/30 bg-gradient-to-br from-accent/5 to-transparent p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-lg bg-white p-2 shadow-sm">
            <Sparkles size={22} className="text-accent" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">
              通过 Google 一键连接（推荐）
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              点击授权后，青砚将用你自己的 Gmail 账号发送报价 / 通知邮件。
              无需配置 SMTP，无需生成 App Password，客户看到的发件人就是你。
            </p>

            {gmail?.connected ? (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-200 bg-white/60 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <CheckCircle size={16} className="shrink-0 text-emerald-600" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-emerald-800">
                      {gmail.email}
                    </p>
                    <p className="text-[11px] text-emerald-700/80">已连接 Gmail</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleConnectGoogle}
                    className="rounded-md border border-border bg-white px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/50"
                  >
                    重新授权
                  </button>
                  <button
                    onClick={handleUnlinkGoogle}
                    disabled={unlinkingGmail}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    title="断开 Gmail 连接"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleConnectGoogle}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white border border-border px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:border-accent/50 hover:bg-accent/5 transition-colors"
              >
                <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden>
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
                  <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.04l3.007-2.333z" />
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" />
                </svg>
                使用 Google 账号连接
              </button>
            )}
          </div>
        </div>
      </div>

      {msg && (
        <p className={`text-sm ${msg.includes("成功") || msg.includes("已保存") || msg.includes("已断开") ? "text-emerald-600" : "text-red-500"}`}>
          {msg}
        </p>
      )}

      {/* ─── 高级：SMTP 手动配置（折叠） ─── */}
      <div className="rounded-xl border border-border bg-white/60">
        <button
          type="button"
          onClick={() => setShowSmtp((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              高级：手动配置 SMTP
              {binding && (
                <span className="ml-2 text-xs text-muted-foreground">
                  （已配置 {binding.email}{binding.verified ? "" : "，未验证"}）
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {gmail?.connected
                ? "已连接 Gmail，通常不需要再配置 SMTP；保留作为兜底"
                : "仅建议无法用 Google OAuth 的场景（非 Gmail、企业邮箱等）"}
            </p>
          </div>
          <ChevronDown
            size={16}
            className={`shrink-0 text-muted-foreground transition-transform ${showSmtp ? "rotate-180" : ""}`}
          />
        </button>

        {showSmtp && (
          <div className="border-t border-border px-5 py-5 space-y-5">
            {binding && (
              <div className={`rounded-lg border p-3 ${binding.verified ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}>
                <div className="flex items-center gap-3">
                  {binding.verified ? (
                    <CheckCircle size={18} className="text-emerald-600" />
                  ) : (
                    <XCircle size={18} className="text-amber-600" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {binding.email}
                      <span className={`ml-2 text-xs ${binding.verified ? "text-emerald-600" : "text-amber-600"}`}>
                        {binding.verified ? "已验证" : "未验证"}
                      </span>
                    </p>
                    {binding.lastSentAt && (
                      <p className="text-xs text-muted-foreground truncate">
                        上次发信: {new Date(binding.lastSentAt).toLocaleString("zh-CN")}
                      </p>
                    )}
                    {binding.lastError && (
                      <p className="text-xs text-red-500 mt-0.5">{binding.lastError}</p>
                    )}
                  </div>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="rounded-md p-2 text-muted-foreground hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="解绑 SMTP"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">快速选择</Label>
              <div className="flex gap-2 flex-wrap">
                {PRESETS.map((p, i) => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(i)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      smtpHost === p.host
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>发信邮箱 *</Label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
                  placeholder="you@gmail.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>显示名称 *</Label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
                  placeholder="Kevin @ Sunny Blinds"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>SMTP 服务器</Label>
                <input
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>端口</Label>
                <input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)}
                  className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>SMTP 用户名</Label>
                <input
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
                  placeholder="通常是邮箱地址"
                />
              </div>
              <div className="space-y-1.5">
                <Label>SMTP 密码 / App Password</Label>
                <input
                  type="password"
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useTls}
                onChange={(e) => setUseTls(e.target.checked)}
                className="rounded border-border"
              />
              使用 TLS 加密
            </label>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={saving || !email || !smtpHost || !smtpUser || !smtpPass}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Mail size={16} />
                {saving ? "保存中..." : "保存配置"}
              </button>
              <button
                onClick={handleVerify}
                disabled={verifying || !binding}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
              >
                <Shield size={16} />
                {verifying ? "验证中..." : "验证连接"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="rounded-xl border border-border bg-muted/20 p-5">
        <h3 className="text-sm font-semibold mb-3">绑定后自动生效的场景</h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <Send size={14} className="mt-0.5 text-blue-500" />
            <span><strong>报价分享</strong> — 报价单直接从你的邮箱发给客户</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle size={14} className="mt-0.5 text-emerald-500" />
            <span><strong>签约通知</strong> — 客户签名后你收到邮件通知</span>
          </div>
          <div className="flex items-start gap-2">
            <Mail size={14} className="mt-0.5 text-purple-500" />
            <span><strong>跟进提醒</strong> — AI 秘书的跟进邮件从你的邮箱发出</span>
          </div>
        </div>
      </div>
    </div>
  );
}
