"use client";

/**
 * Security-1：账号与企业
 * FIXED：只读展示所属企业
 * MULTI_ORG + canSelfSwitchOrg：可切换工作企业
 * 密码：可修改；系统只存哈希，页面永不展示明文旧密码
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { selectActiveOrganization } from "@/lib/org-selection";
import { orgRoleLabel } from "@/lib/permissions-client";
import { PASSWORD_MIN_LENGTH } from "@/lib/users/password-constants";

type SwitchOrgInfo = {
  orgAccessMode: string;
  canSelfSwitchOrg: boolean;
  canSwitch: boolean;
  activeOrgId: string | null;
  organizations: Array<{
    id: string;
    name: string;
    code: string;
    myRole: string | null;
  }>;
};

export default function SettingsAccountPage() {
  const [info, setInfo] = useState<SwitchOrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/auth/switch-org");
      if (!res.ok) {
        setError("加载企业信息失败");
        setInfo(null);
        return;
      }
      setInfo((await res.json()) as SwitchOrgInfo);
    } catch {
      setError("加载企业信息失败");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = info?.organizations.find((o) => o.id === info.activeOrgId);

  async function handleSwitch(orgId: string) {
    if (!info?.canSwitch || orgId === info.activeOrgId) return;
    setSwitching(orgId);
    const r = await selectActiveOrganization(orgId, { reload: true });
    if (!r.ok) {
      setSwitching(null);
      alert(r.error || "切换失败");
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);
    setPwdErr(null);
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPwdErr(`新密码至少 ${PASSWORD_MIN_LENGTH} 位`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdErr("两次输入的新密码不一致");
      return;
    }
    setPwdBusy(true);
    try {
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwdErr(data.error || "修改失败");
        return;
      }
      setPwdMsg(data.message || "密码已更新");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPwdErr("网络错误，请重试");
    } finally {
      setPwdBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground">
          设置
        </Link>
        <span>/</span>
        <span>账号与企业</span>
      </div>

      <PageHeader
        title="账号与企业"
        description="修改登录密码；查看当前工作企业，获授权后可切换"
      />

      <section className="space-y-4 rounded-md border border-border p-4">
        <div>
          <h2 className="text-sm font-semibold">登录密码</h2>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            系统只保存加密后的密码，无法回显你当前的明文密码。可在此设置/修改新密码；
            输入框旁眼睛图标可临时查看你正在输入的内容。
          </p>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              当前密码（首次设置可留空）
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                aria-label={showPw ? "隐藏密码" : "显示输入"}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              新密码（至少 {PASSWORD_MIN_LENGTH} 位）
            </label>
            <input
              type={showPw ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              确认新密码
            </label>
            <input
              type={showPw ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          {pwdErr && (
            <p className="text-sm text-red-600">{pwdErr}</p>
          )}
          {pwdMsg && (
            <p className="text-sm text-emerald-700">{pwdMsg}</p>
          )}
          <button
            type="submit"
            disabled={pwdBusy || !newPassword}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-50"
          >
            {pwdBusy ? "保存中…" : "更新密码"}
          </button>
        </form>
      </section>

      {loading && <p className="text-sm text-muted-foreground">加载企业信息…</p>}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {info && !loading && (
        <section className="space-y-4 rounded-md border border-border p-4">
          <div>
            <div className="text-xs text-muted-foreground">所属 / 当前企业</div>
            <div className="mt-1 text-base font-medium">
              {current?.name ?? "未分配企业"}
            </div>
            {current?.code && (
              <div className="text-xs text-muted-foreground">{current.code}</div>
            )}
            {current?.myRole && (
              <div className="mt-1 text-sm text-muted-foreground">
                企业角色：{orgRoleLabel(current.myRole)}
              </div>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            访问模式：{info.orgAccessMode}
            {info.orgAccessMode === "FIXED" && " · 由企业管理员设置，不可自行切换"}
          </div>

          {info.canSwitch ? (
            <div className="space-y-2">
              <h2 className="text-sm font-medium">切换工作企业</h2>
              <ul className="divide-y divide-border rounded-md border border-border">
                {info.organizations.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{o.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.code}
                        {o.myRole ? ` · ${orgRoleLabel(o.myRole)}` : ""}
                      </div>
                    </div>
                    {o.id === info.activeOrgId ? (
                      <span className="shrink-0 text-xs text-emerald-700">当前</span>
                    ) : (
                      <button
                        type="button"
                        disabled={switching === o.id}
                        onClick={() => void handleSwitch(o.id)}
                        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
                      >
                        {switching === o.id ? "切换中…" : "切换"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              未开放自助切换。如需变更所属企业，请联系企业管理员。
            </p>
          )}
        </section>
      )}
    </div>
  );
}
