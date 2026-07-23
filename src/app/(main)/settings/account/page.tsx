"use client";

/**
 * Security-1：账号与企业
 * FIXED：只读展示所属企业
 * MULTI_ORG + canSelfSwitchOrg：可切换工作企业
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { selectActiveOrganization } from "@/lib/org-selection";
import { orgRoleLabel } from "@/lib/permissions-client";

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
        description="查看当前工作企业；获授权后可在此切换"
      />

      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
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
