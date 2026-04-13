"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
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
} from "lucide-react";

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
  const [binding, setBinding] = useState<BindingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState("");

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [useTls, setUseTls] = useState(true);

  useEffect(() => {
    apiFetch("/api/sales/email-binding")
      .then((r) => r.json())
      .then((d) => {
        if (d.binding) {
          setBinding(d.binding);
          setEmail(d.binding.email);
          setDisplayName(d.binding.displayName);
          setSmtpHost(d.binding.smtpHost || "smtp.gmail.com");
          setSmtpPort(d.binding.smtpPort || 587);
          setSmtpUser(d.binding.smtpUser || "");
          setUseTls(d.binding.useTls ?? true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      const res = await apiFetch("/api/sales/email-binding", {
        method: "POST",
        body: JSON.stringify({ email, displayName, smtpHost, smtpPort, smtpUser, smtpPass, useTls }),
      }).then((r) => r.json());
      if (res.error) { setMsg(res.error); return; }
      setBinding((b) => b ? { ...b, email, displayName, verified: false } : null);
      setMsg("已保存，请点击验证连接");
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setMsg("");
    try {
      const res = await apiFetch("/api/sales/email-binding/verify", {
        method: "POST",
      }).then((r) => r.json());
      if (res.verified) {
        setMsg("验证成功！邮箱已可用于自动发信");
        setBinding((b) => b ? { ...b, verified: true, verifiedAt: new Date().toISOString(), lastError: null } : null);
      } else {
        setMsg(`验证失败：${res.error}`);
        setBinding((b) => b ? { ...b, verified: false, lastError: res.error } : null);
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("确定解绑邮箱？之后自动发信功能将不可用")) return;
    setDeleting(true);
    try {
      await apiFetch("/api/sales/email-binding", { method: "DELETE" });
      setBinding(null);
      setEmail("");
      setDisplayName("");
      setSmtpUser("");
      setSmtpPass("");
      setMsg("已解绑");
    } finally {
      setDeleting(false);
    }
  };

  const applyPreset = (idx: number) => {
    const p = PRESETS[idx];
    if (p.host) setSmtpHost(p.host);
    setSmtpPort(p.port);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="邮箱绑定"
        description="绑定一次，报价/通知邮件自动从你的邮箱发给客户"
      />

      {/* Status card */}
      {binding && (
        <div className={`rounded-xl border p-4 ${binding.verified ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}>
          <div className="flex items-center gap-3">
            {binding.verified ? (
              <CheckCircle size={20} className="text-emerald-600" />
            ) : (
              <XCircle size={20} className="text-amber-600" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium">
                {binding.email}
                <span className={`ml-2 text-xs ${binding.verified ? "text-emerald-600" : "text-amber-600"}`}>
                  {binding.verified ? "已验证" : "未验证"}
                </span>
              </p>
              {binding.lastSentAt && (
                <p className="text-xs text-muted-foreground">
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
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="rounded-xl border border-border bg-white/60 p-6 space-y-5">
        {/* Presets */}
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

        {msg && (
          <p className={`text-sm ${msg.includes("成功") || msg.includes("已保存") ? "text-emerald-600" : "text-red-500"}`}>
            {msg}
          </p>
        )}

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
