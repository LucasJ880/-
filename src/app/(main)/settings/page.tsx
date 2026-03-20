"use client";

import { Suspense, useEffect, useState } from "react";
import { Settings, Calendar, Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { useSearchParams } from "next/navigation";

interface GoogleStatus {
  connected: boolean;
  email?: string;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}

const GOOGLE_ERROR_HINTS: Record<string, string> = {
  access_denied:
    "你已取消授权，或当前 Google 账号不在 OAuth「测试用户」列表中（测试模式下仅限已添加的邮箱）。",
  redirect_uri_mismatch:
    "Google 控制台里的「重定向 URI」必须与当前站点一致。线上请使用下方显示的 https 地址，不要用 localhost。",
  no_user: "授权回来时未检测到登录状态，请先在本站登录再连接 Google。",
  no_code: "未收到授权码，请重试连接。",
  token_fail: "用授权码换取令牌失败，请检查 Vercel 里的 GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI 是否一致。",
};

function SettingsContent() {
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [origin, setOrigin] = useState("");
  const searchParams = useSearchParams();
  const googleResult = searchParams.get("google");
  const googleReason = searchParams.get("reason") ?? "";

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    fetch("/api/auth/google/status")
      .then((r) => r.json())
      .then(setGoogle)
      .catch(() => setGoogle({ connected: false }))
      .finally(() => setLoading(false));
  }, []);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/auth/google/status", { method: "DELETE" });
      setGoogle({ connected: false });
    } catch {
      /* ignore */
    } finally {
      setDisconnecting(false);
    }
  };

  const hasCredentials = true;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Settings size={24} />
          设置
        </h1>
        <p className="mt-1 text-sm text-muted">管理青砚的外部服务连接</p>
      </div>

      {googleResult === "success" && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          <CheckCircle2 size={16} />
          Google Calendar 连接成功！
        </div>
      )}
      {googleResult === "error" && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="flex items-center gap-2 font-medium">
            <XCircle size={16} />
            Google Calendar 连接失败，请重试。
          </div>
          {googleReason && (
            <p className="mt-2 text-xs leading-relaxed opacity-90">
              {GOOGLE_ERROR_HINTS[googleReason] ?? `错误代码：${googleReason}`}
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card-bg">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
            <Calendar size={20} className="text-red-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Google Calendar</h2>
            <p className="text-xs text-muted">
              连接后，Google 日历事件将显示在工作台；青砚创建的日程也会同步到 Google 日历
            </p>
          </div>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" />
              检查连接状态...
            </div>
          ) : google?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-green-700">已连接</span>
                <span className="text-sm text-muted">{google.email}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                  断开连接
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                <span className="text-sm text-muted">未连接</span>
              </div>
              <a
                href="/api/auth/google"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Calendar size={14} />
                连接 Google Calendar
              </a>
              {!hasCredentials && (
                <p className="text-xs text-amber-600">
                  需要先在 .env 中配置 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-3">
          <p className="text-[11px] leading-relaxed text-muted">
            配置步骤：1. 前往{" "}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-accent hover:underline"
            >
              Google Cloud Console <ExternalLink size={9} />
            </a>{" "}
            创建 OAuth 2.0 网页客户端 → 2.「已授权的 JavaScript 来源」填{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
              {origin || "（当前站点域名，如 https://xxx.vercel.app）"}
            </code>
            ；「重定向 URI」必须与 Vercel 环境变量{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
              GOOGLE_REDIRECT_URI
            </code>{" "}
            完全一致，一般为{" "}
            <code className="break-all rounded bg-slate-100 px-1 py-0.5 text-[10px]">
              {origin
                ? `${origin}/api/auth/google/callback`
                : "https://你的域名/api/auth/google/callback"}
            </code>{" "}
            （本地开发则用{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
              http://localhost:3000/api/auth/google/callback
            </code>
            ）→ 3. 启用 Google Calendar API → 4. 将 Client ID、Secret 与{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
              GOOGLE_REDIRECT_URI
            </code>{" "}
            配置到部署环境（如 Vercel 环境变量）
          </p>
        </div>
      </div>
    </div>
  );
}
