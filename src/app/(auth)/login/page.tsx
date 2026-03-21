"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  authCardClass,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
} from "@/lib/auth-styles";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "登录失败");
        return;
      }

      const dest = safeNext(searchParams.get("next"));
      router.push(dest);
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
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
