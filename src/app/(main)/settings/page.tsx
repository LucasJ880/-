"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, Mail, Loader2, CheckCircle2, XCircle, ExternalLink, ChevronDown, Bell, MessageCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

interface GoogleStatus {
  connected: boolean;
  email?: string;
}

interface GmailStatus {
  connected: boolean;
  email?: string;
  grantedScopes?: string;
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
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [gmailLoading, setGmailLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [gmailDisconnecting, setGmailDisconnecting] = useState(false);
  const [origin, setOrigin] = useState("");
  const searchParams = useSearchParams();
  const googleResult = searchParams.get("google");
  const gmailResult = searchParams.get("gmail");
  const googleReason = searchParams.get("reason") ?? "";

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    apiFetch("/api/auth/google/status")
      .then((r) => r.json())
      .then(setGoogle)
      .catch(() => setGoogle({ connected: false }))
      .finally(() => setLoading(false));
    apiFetch("/api/auth/google-email/status")
      .then((r) => r.json())
      .then(setGmail)
      .catch(() => setGmail({ connected: false }))
      .finally(() => setGmailLoading(false));
  }, []);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await apiFetch("/api/auth/google/status", { method: "DELETE" });
      setGoogle({ connected: false });
    } catch {
      /* ignore */
    } finally {
      setDisconnecting(false);
    }
  };

  const handleGmailDisconnect = async () => {
    setGmailDisconnecting(true);
    try {
      await apiFetch("/api/auth/google-email/status", { method: "DELETE" });
      setGmail({ connected: false });
    } catch {
      /* ignore */
    } finally {
      setGmailDisconnecting(false);
    }
  };

  const hasCredentials = true;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <PageHeader
          title="设置"
          description="管理外部服务连接、集成状态与排错说明。部署与环境变量总览见 docs/DEPLOY_VERCEL.md。"
        />
      </div>

      {googleResult === "success" && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[rgba(46,122,86,0.15)] bg-[rgba(46,122,86,0.04)] px-4 py-3 text-sm text-[#2e7a56]">
          <CheckCircle2 size={16} />
          Google Calendar 连接成功！
        </div>
      )}
      {googleResult === "error" && (
        <div className="mb-4 rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
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
      {gmailResult === "success" && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[rgba(46,122,86,0.15)] bg-[rgba(46,122,86,0.04)] px-4 py-3 text-sm text-[#2e7a56]">
          <CheckCircle2 size={16} />
          Gmail 邮件服务绑定成功！
        </div>
      )}
      {gmailResult === "error" && (
        <div className="mb-4 rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
          <div className="flex items-center gap-2 font-medium">
            <XCircle size={16} />
            Gmail 邮件服务绑定失败，请重试。
          </div>
          {googleReason && (
            <p className="mt-2 text-xs leading-relaxed opacity-90">
              {GOOGLE_ERROR_HINTS[googleReason] ?? `错误代码：${googleReason}`}
            </p>
          )}
        </div>
      )}

      <Link
        href="/settings/notifications"
        className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-card-bg px-5 py-4 transition-colors hover:bg-[rgba(43,96,85,0.03)]"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(43,96,85,0.08)]">
          <Bell size={20} className="text-accent" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">通知偏好</h2>
          <p className="text-xs text-muted">类型、优先级、静默时段与「仅与我相关」</p>
        </div>
        <span className="text-xs text-accent">去设置 →</span>
      </Link>

      <Link
        href="/settings/wechat"
        className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-card-bg px-5 py-4 transition-colors hover:bg-[rgba(43,96,85,0.03)]"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#07c160]/10">
          <MessageCircle size={20} className="text-[#07c160]" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">微信集成</h2>
          <p className="text-xs text-muted">个人微信 + 企业微信双通道接入，AI 消息推送</p>
        </div>
        <span className="text-xs text-accent">去设置 →</span>
      </Link>

      <div className="rounded-xl border border-border bg-card-bg">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(166,61,61,0.04)]">
            <Calendar size={20} className="text-[#a63d3d]" />
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
                <span className="h-2 w-2 rounded-full bg-[#2e7a56]" />
                <span className="text-sm font-medium text-[#2e7a56]">已连接</span>
                <span className="text-sm text-muted">{google.email}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex items-center gap-1.5 rounded-lg border border-[rgba(166,61,61,0.15)] px-3 py-1.5 text-xs font-medium text-[#a63d3d] transition-colors hover:bg-[rgba(166,61,61,0.04)] disabled:opacity-50"
                >
                  {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                  断开连接
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[rgba(110,125,118,0.25)]" />
                <span className="text-sm text-muted">未连接</span>
              </div>
              <a
                href="/api/auth/google"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2b6055] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2b6055]/90"
              >
                <Calendar size={14} />
                连接 Google Calendar
              </a>
              {!hasCredentials && (
                <p className="text-xs text-[#9a6a2f]">
                  需要先在 .env 中配置 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-3">
          <details className="group rounded-lg border border-border/80 bg-background/40">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
              <ChevronDown
                size={14}
                className="shrink-0 text-muted transition-transform group-open:rotate-180"
                aria-hidden
              />
              展开：OAuth 与重定向配置步骤（较长）
            </summary>
            <div className="border-t border-border/60 px-3 pb-3 pt-2">
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
                <code className="rounded bg-[rgba(110,125,118,0.08)] px-1 py-0.5 text-[10px]">
                  {origin || "（当前站点域名，如 https://xxx.vercel.app）"}
                </code>
                ；「重定向 URI」必须与 Vercel 环境变量{" "}
                <code className="rounded bg-[rgba(110,125,118,0.08)] px-1 py-0.5 text-[10px]">
                  GOOGLE_REDIRECT_URI
                </code>{" "}
                完全一致，一般为{" "}
                <code className="break-all rounded bg-[rgba(110,125,118,0.08)] px-1 py-0.5 text-[10px]">
                  {origin
                    ? `${origin}/api/auth/google/callback`
                    : "https://你的域名/api/auth/google/callback"}
                </code>{" "}
                （本地开发则用{" "}
                <code className="rounded bg-[rgba(110,125,118,0.08)] px-1 py-0.5 text-[10px]">
                  http://localhost:3000/api/auth/google/callback
                </code>
                ）→ 3. 启用 Google Calendar API → 4. 将 Client ID、Secret 与{" "}
                <code className="rounded bg-[rgba(110,125,118,0.08)] px-1 py-0.5 text-[10px]">
                  GOOGLE_REDIRECT_URI
                </code>{" "}
                配置到部署环境（如 Vercel 环境变量）。完整部署清单见仓库{" "}
                <code className="text-[10px]">docs/DEPLOY_VERCEL.md</code>。
              </p>
            </div>
          </details>
        </div>
      </div>

      {/* Gmail 邮件服务 */}
      <div className="mt-4 rounded-xl border border-border bg-card-bg">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(43,96,85,0.08)]">
            <Mail size={20} className="text-accent" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Gmail 邮件发送</h2>
            <p className="text-xs text-muted">
              绑定后，可在询价流程中通过青砚直接发送邮件给供应商（AI 生成草稿 → 确认 → 发送）
            </p>
          </div>
        </div>

        <div className="px-5 py-4">
          {gmailLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" />
              检查连接状态...
            </div>
          ) : gmail?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#2e7a56]" />
                <span className="text-sm font-medium text-[#2e7a56]">已绑定</span>
                <span className="text-sm text-muted">{gmail.email}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleGmailDisconnect}
                  disabled={gmailDisconnecting}
                  className="flex items-center gap-1.5 rounded-lg border border-[rgba(166,61,61,0.15)] px-3 py-1.5 text-xs font-medium text-[#a63d3d] transition-colors hover:bg-[rgba(166,61,61,0.04)] disabled:opacity-50"
                >
                  {gmailDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                  解除绑定
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[rgba(110,125,118,0.25)]" />
                <span className="text-sm text-muted">未绑定</span>
              </div>
              <a
                href="/api/auth/google-email"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2b6055] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2b6055]/90"
              >
                <Mail size={14} />
                绑定 Gmail 邮件服务
              </a>
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-3">
          <details className="group rounded-lg border border-border/80 bg-background/40">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
              <ChevronDown
                size={14}
                className="shrink-0 text-muted transition-transform group-open:rotate-180"
                aria-hidden
              />
              展开：Gmail 邮件 OAuth 配置说明
            </summary>
            <div className="border-t border-border/60 px-3 pb-3 pt-2 text-[11px] leading-relaxed text-muted">
              <p>
                Gmail 邮件使用独立的 OAuth 授权流程（scope: <code className="rounded bg-[rgba(110,125,118,0.08)] px-1 py-0.5 text-[10px]">gmail.send</code>），与 Google Calendar 授权互不影响。
              </p>
              <p className="mt-1.5">
                需要在 Google Cloud Console 的 OAuth 客户端中额外添加重定向 URI：{" "}
                <code className="break-all rounded bg-[rgba(110,125,118,0.08)] px-1 py-0.5 text-[10px]">
                  {origin
                    ? `${origin}/api/auth/google-email/callback`
                    : "https://你的域名/api/auth/google-email/callback"}
                </code>
              </p>
              <p className="mt-1.5">
                Vercel 环境变量：<code className="rounded bg-[rgba(110,125,118,0.08)] px-1 py-0.5 text-[10px]">GOOGLE_EMAIL_REDIRECT_URI</code> 设置为上述地址。
              </p>
              <p className="mt-1.5">
                注意：<code className="rounded bg-[rgba(110,125,118,0.08)] px-1 py-0.5 text-[10px]">gmail.send</code> 是 restricted scope，需在{" "}
                <a
                  href="https://admin.google.com/ac/owl/list?tab=configuredApps"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-accent hover:underline"
                >
                  Google Workspace Admin Console <ExternalLink size={9} />
                </a>{" "}
                中将此应用标记为 Trusted。
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
