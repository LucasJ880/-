"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  authCardClass,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
} from "@/lib/auth-styles";
import { apiFetch } from "@/lib/api-fetch";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("两次密码输入不一致");
      return;
    }
    if (password.length < 6) {
      setError("密码长度至少 6 位");
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "注册失败");
        return;
      }

      router.push("/");
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
          注册青砚
        </h1>
        <p className="mt-1 text-sm text-muted">创建你的工作助理账号</p>
      </div>

      {error && (
        <div className="mb-4 rounded-[var(--radius-md)] border border-red-200 bg-danger-bg px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="reg-name" className={authLabelClass}>
            昵称 <span className="font-normal text-muted">(可选)</span>
          </label>
          <input
            id="reg-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="你的名字"
            autoComplete="nickname"
            className={authInputClass}
          />
        </div>

        <div>
          <label htmlFor="reg-email" className={authLabelClass}>
            邮箱
          </label>
          <input
            id="reg-email"
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
          <label htmlFor="reg-password" className={authLabelClass}>
            密码
          </label>
          <input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder="至少 6 位"
            className={authInputClass}
          />
        </div>

        <div>
          <label htmlFor="reg-confirm" className={authLabelClass}>
            确认密码
          </label>
          <input
            id="reg-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder="再次输入密码"
            className={authInputClass}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className={authPrimaryButtonClass}
        >
          {loading ? "注册中…" : "注册"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-muted">
        已有账号？
        <Link
          href="/login"
          className="ml-1 font-medium text-accent hover:text-accent-hover"
        >
          登录
        </Link>
      </p>
    </div>
  );
}
