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
import {
  OrgActivePicker,
  type OrgActiveOption,
} from "@/components/org-active-picker";
import {
  hydrateStoredOrgId,
  selectActiveOrganization,
} from "@/lib/org-selection";
import { useWechatEntryEnabled } from "@/components/wechat-entry/context";
import { WechatLoginEntry } from "@/components/wechat-entry/login-entry";

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

function LoginForm() {
  const searchParams = useSearchParams();
  const wechatEnabled = useWechatEntryEnabled();
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
  const [orgStep, setOrgStep] = useState(false);
  const [orgs, setOrgs] = useState<OrgActiveOption[]>([]);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);

  const next = safeNext(searchParams.get("next"));

  async function finishLogin(opts: {
    activeOrgId?: string | null;
    needsSelection?: boolean;
    organizations?: OrgActiveOption[];
  }) {
    try {
      sessionStorage.removeItem("qy_401_ts");
    } catch {
      /* ignore */
    }

    const list = opts.organizations ?? [];
    if (opts.activeOrgId) {
      hydrateStoredOrgId(opts.activeOrgId);
      window.location.href = next;
      return;
    }
    if (list.length === 1) {
      await selectActiveOrganization(list[0].id);
      window.location.href = next;
      return;
    }
    if (opts.needsSelection && list.length > 1) {
      setOrgs(list);
      setOrgStep(true);
      return;
    }
    window.location.href = next;
  }

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

      await finishLogin({
        activeOrgId: data.activeOrgId,
        needsSelection: data.needsSelection,
        organizations: data.organizations,
      });
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectOrg(orgId: string) {
    setBusyOrgId(orgId);
    setError("");
    const r = await selectActiveOrganization(orgId);
    if (!r.ok) {
      setError(r.error || "选择组织失败");
      setBusyOrgId(null);
      return;
    }
    window.location.href = next;
  }

  function handleWeChatLogin() {
    // 微信回调后先进入选组织页，再跳到业务目标页
    const params = new URLSearchParams({
      next: `/select-org?next=${encodeURIComponent(next)}`,
    });
    window.location.href = `/api/auth/wechat?${params.toString()}`;
  }

  if (orgStep) {
    return (
      <div className={authCardClass}>
        {error && (
          <div className="mb-4 rounded-[var(--radius-md)] border border-[rgba(166,61,61,0.15)] bg-danger-bg px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}
        <OrgActivePicker
          organizations={orgs}
          busyId={busyOrgId}
          onSelect={handleSelectOrg}
        />
      </div>
    );
  }

  return (
    <div className={authCardClass}>
      <div className="mb-6 text-center">
        <img
          src="/icons/icon-192x192.png"
          alt="青砚"
          className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover shadow-sm"
        />
        <h1 className="text-brand-gradient text-2xl font-bold tracking-tight">
          登录青砚
        </h1>
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

      {wechatEnabled && <WechatLoginEntry onClick={handleWeChatLogin} />}

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
