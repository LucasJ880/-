"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  authCardClass,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
} from "@/lib/auth-styles";
import { Loader2 } from "lucide-react";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

const WECHAT_ERROR_MAP: Record<string, string> = {
  missing_params: "微信授权参数缺失，请重试",
  state_expired: "登录超时，请重新扫码",
  state_mismatch: "安全校验失败，请重试",
  not_configured: "微信登录尚未配置",
  token_fail: "微信授权失败，请稍后重试",
  userinfo_fail: "获取微信信息失败，请重试",
  account_disabled: "账号已停用，请联系管理员",
};

function WeChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05a6.127 6.127 0 0 1-.253-1.726c0-3.573 3.27-6.47 7.3-6.47.258 0 .51.013.76.035C16.728 4.82 13.03 2.188 8.691 2.188zM5.785 6.24c.648 0 1.174.468 1.174 1.045 0 .578-.526 1.046-1.174 1.046-.649 0-1.175-.468-1.175-1.046 0-.577.526-1.045 1.175-1.045zm5.813 0c.648 0 1.175.468 1.175 1.045 0 .578-.527 1.046-1.175 1.046s-1.175-.468-1.175-1.046c0-.577.527-1.045 1.175-1.045zM16.95 9.57c-3.527 0-6.39 2.53-6.39 5.648 0 3.119 2.863 5.649 6.39 5.649a7.55 7.55 0 0 0 2.27-.35.652.652 0 0 1 .54.072l1.43.84a.242.242 0 0 0 .126.04.221.221 0 0 0 .218-.222c0-.054-.022-.108-.036-.16l-.294-1.115a.444.444 0 0 1 .16-.499C22.922 18.423 24 16.61 24 15.218c0-3.118-2.863-5.648-6.39-5.648h-.66zm-2.41 3.24c.494 0 .895.357.895.796 0 .44-.4.798-.896.798-.494 0-.894-.357-.894-.798 0-.44.4-.796.894-.796zm4.822 0c.494 0 .895.357.895.796 0 .44-.401.798-.895.798-.494 0-.895-.357-.895-.798 0-.44.4-.796.895-.796z" />
    </svg>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => {
    const wxErr = searchParams.get("wechat");
    if (wxErr === "error") {
      const reason = searchParams.get("reason") || "";
      return WECHAT_ERROR_MAP[reason] || `微信登录失败（${reason || "未知错误"}）`;
    }
    return "";
  });
  const [loading, setLoading] = useState(false);

  const next = safeNext(searchParams.get("next"));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "登录失败");
        return;
      }

      try { sessionStorage.removeItem("qy_401_ts"); } catch {}

      window.location.href = next;
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  function handleWeChatLogin() {
    const params = new URLSearchParams({ next });
    window.location.href = `/api/auth/wechat?${params.toString()}`;
  }

  return (
    <div className={authCardClass}>
      <div className="mb-6 text-center">
        <h1 className="text-brand-gradient text-2xl font-bold tracking-tight">
          登录青砚
        </h1>
        <p className="mt-1 text-sm text-muted">AI 工作助理</p>
      </div>

      {error && (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[rgba(166,61,61,0.15)] bg-danger-bg px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className={authLabelClass}>
            邮箱
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
            placeholder="name@example.com"
            className={authInputClass}
          />
        </div>

        <div>
          <label htmlFor="login-password" className={authLabelClass}>
            密码
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="至少 6 位"
            className={authInputClass}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className={authPrimaryButtonClass}
        >
          {loading ? "登录中…" : "登录"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border/60" />
        <span className="text-xs text-muted/70">或</span>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      <button
        type="button"
        onClick={handleWeChatLogin}
        className="flex min-h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-white/60 py-2.5 text-sm font-medium text-foreground/90 backdrop-blur-sm transition-all duration-200 hover:bg-white/80 hover:shadow-sm active:scale-[0.99]"
      >
        <WeChatIcon className="h-5 w-5 text-[#07C160]" />
        微信扫码登录
      </button>

      <p className="mt-4 text-center text-sm text-muted">
        还没有账号？
        <Link
          href="/register"
          className="ml-1 font-medium text-accent hover:text-accent-hover"
        >
          注册
        </Link>
      </p>
      <p className="mt-3 text-center text-[11px] leading-relaxed text-muted/80">
        为保障安全，登录状态将在 8 小时后自动失效。
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div
          className={`${authCardClass} flex min-h-[320px] items-center justify-center`}
        >
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
