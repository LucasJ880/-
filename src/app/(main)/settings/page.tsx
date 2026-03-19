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

function SettingsContent() {
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const searchParams = useSearchParams();
  const googleResult = searchParams.get("google");

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
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <XCircle size={16} />
          Google Calendar 连接失败，请重试。
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
            创建 OAuth 2.0 客户端 → 2. 授权重定向 URI 填写{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
              http://localhost:3000/api/auth/google/callback
            </code>{" "}
            → 3. 启用 Google Calendar API → 4. 将 Client ID 和 Secret 填入 .env
          </p>
        </div>
      </div>
    </div>
  );
}
