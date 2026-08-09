"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type TabKey = "overview" | "policies" | "quotas" | "audit";

const TABS: Array<{ key: TabKey; label: string; path: string }> = [
  { key: "overview", label: "总览", path: "/capabilities/governance" },
  {
    key: "policies",
    label: "策略",
    path: "/capabilities/governance/policies",
  },
  { key: "quotas", label: "配额", path: "/capabilities/governance/quotas" },
  { key: "audit", label: "审计", path: "/capabilities/governance/audit" },
];

function tabFromPath(pathname: string): TabKey {
  if (pathname.endsWith("/policies")) return "policies";
  if (pathname.endsWith("/quotas")) return "quotas";
  if (pathname.endsWith("/audit")) return "audit";
  return "overview";
}

export default function GovernancePage() {
  const pathname = usePathname();
  const router = useRouter();
  const tab = tabFromPath(pathname);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projection, setProjection] = useState<Record<string, unknown> | null>(
    null,
  );
  const [usage, setUsage] = useState<Record<string, unknown> | null>(null);
  const [quotas, setQuotas] = useState<{
    policies: unknown[];
    effective: unknown[];
    alerts?: { aiDisabled: boolean; zeroHardLimitMetrics: string[] };
  } | null>(null);
  const [audit, setAudit] = useState<{ items: unknown[]; total: number } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "overview" || tab === "policies") {
        const res = await apiFetch("/api/capabilities/governance");
        if (res.status === 403) {
          setError("无企业成员身份或无权访问治理中心");
          return;
        }
        if (!res.ok) {
          setError("加载治理投影失败");
          return;
        }
        setProjection(await res.json());
      }
      if (tab === "overview" || tab === "quotas") {
        const [uRes, qRes] = await Promise.all([
          apiFetch("/api/capabilities/governance/usage"),
          apiFetch("/api/capabilities/governance/quotas"),
        ]);
        if (uRes.status === 403 || qRes.status === 403) {
          setError("无企业成员身份或无权访问治理中心");
          return;
        }
        if (uRes.ok) setUsage(await uRes.json());
        if (qRes.ok) setQuotas(await qRes.json());
      }
      if (tab === "audit") {
        const res = await apiFetch("/api/capabilities/governance/audit");
        if (res.status === 403) {
          setError("无权查看企业治理审计");
          return;
        }
        if (!res.ok) {
          setError("加载审计失败");
          return;
        }
        setAudit(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const providers =
    (projection?.providerStatus as Array<{
      provider: string;
      status: string;
      models: string[];
    }>) ?? [];
  const modules =
    (projection?.modules as Array<{
      key: string;
      enabled: boolean;
      sourceScope: string;
    }>) ?? [];
  const visibility = projection?.visibilityPolicy as
    | { value: string; sourceScope: string }
    | undefined;
  const industryPack = projection?.industryPack as
    | { id?: string | null; status: string }
    | undefined;
  const metrics =
    (usage?.metrics as Array<{
      metric: string;
      currentUsage: number;
      hardLimit: number | null;
      level: string;
      usagePercent: number;
    }>) ?? [];
  const nearLimits =
    (usage?.nearLimits as Array<{ metric: string; level: string }>) ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="治理中心"
        description="企业模块、行业包、Tool Policy、配额与审计（不开发完整计费）"
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`rounded-md border px-3 py-1.5 text-sm ${
              tab === t.key ? "bg-muted font-medium" : ""
            }`}
            onClick={() => router.push(t.path)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && !error && (
        <p className="text-sm text-muted-foreground">加载中…</p>
      )}

      {!loading && !error && tab === "overview" && (
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-base font-medium">用量与配额</h2>
            <p className="text-sm text-muted-foreground">
              本月 AI 费用：{String(usage?.monthAiCost ?? "—")} · 当前并发：
              {String(usage?.concurrentRuns ?? "—")}
            </p>
            {nearLimits.length > 0 && (
              <p className="text-sm text-amber-700">
                接近限制：
                {nearLimits.map((n) => `${n.metric}(${n.level})`).join("、")}
              </p>
            )}
            <ul className="grid gap-2 sm:grid-cols-2">
              {metrics.map((m) => (
                <li
                  key={m.metric}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="font-medium">{m.metric}</div>
                  <div className="text-muted-foreground">
                    {m.currentUsage} / {m.hardLimit ?? "∞"}（{m.usagePercent}%）·{" "}
                    {m.level}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-medium">Provider 状态</h2>
            <ul className="space-y-1 text-sm">
              {providers.map((p) => (
                <li key={p.provider}>
                  {p.provider}: <strong>{p.status}</strong>
                  {p.models?.length ? ` · ${p.models.join(", ")}` : ""}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {!loading && !error && tab === "policies" && (
        <div className="space-y-4 text-sm">
          <p>
            Industry Pack：{industryPack?.id ?? "—"}（{industryPack?.status}）
          </p>
          <p>
            Visibility：{visibility?.value}（来源 {visibility?.sourceScope}）
          </p>
          <div>
            <h3 className="mb-2 font-medium">模块</h3>
            <ul className="space-y-1">
              {modules.map((m) => (
                <li key={m.key}>
                  {m.key}: {m.enabled ? "启用" : "关闭"} · {m.sourceScope}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 font-medium">Tool Policy</h3>
            <ul className="space-y-1">
              {(
                (projection?.toolPolicies as Array<{
                  toolKey: string;
                  allowed: boolean;
                  requiresApproval: boolean;
                }>) ?? []
              ).map((t) => (
                <li key={t.toolKey}>
                  {t.toolKey}: {t.allowed ? "允许" : "禁用"}
                  {t.requiresApproval ? " · 需审批" : ""}
                </li>
              ))}
              {(
                (projection?.toolPolicies as unknown[]) ?? []
              ).length === 0 && (
                <li className="text-muted-foreground">无显式禁用/强制审批项</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {!loading && !error && tab === "quotas" && (
        <div className="space-y-4 text-sm">
          {quotas?.alerts?.aiDisabled && (
            <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-800">
              <div className="font-semibold">AI 已被配额停用</div>
              <div className="mt-1">
                当前生效的 MONTHLY_AI_COST 硬限额为 0，本企业所有 AI
                调用都会被阻断。若非有意禁用，请调整或停用下方对应策略。
              </div>
            </div>
          )}
          {!quotas?.alerts?.aiDisabled &&
            (quotas?.alerts?.zeroHardLimitMetrics?.length ?? 0) > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800">
                <div className="font-semibold">部分能力硬限额为 0</div>
                <div className="mt-1">
                  以下指标的有效硬限额为 0，对应能力已被完全阻断：
                  {quotas?.alerts?.zeroHardLimitMetrics?.join("、")}
                </div>
              </div>
            )}
          <h3 className="font-medium">有效配额（当前实际生效）</h3>
          <ul className="space-y-2">
            {(
              (quotas?.effective as Array<{
                metric: string;
                warningLimit: number | null;
                softLimit: number | null;
                hardLimit: number | null;
                sourcePolicies: Array<{ scope: string; version?: number }>;
              }>) ?? []
            ).map((e) => (
              <li
                key={e.metric}
                className={`rounded-md border px-3 py-2 ${
                  e.hardLimit === 0 ? "border-red-300 bg-red-50" : ""
                }`}
              >
                <div className="font-medium">
                  {e.metric}
                  {e.hardLimit === 0 && (
                    <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                      已阻断
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground">
                  warn {e.warningLimit ?? "—"} / soft {e.softLimit ?? "—"} /
                  hard {e.hardLimit ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  来源：
                  {e.sourcePolicies
                    .map((s) => `${s.scope}${s.version != null ? `@v${s.version}` : ""}`)
                    .join(" → ")}
                </div>
              </li>
            ))}
          </ul>
          {(() => {
            const all =
              (quotas?.policies as Array<{
                id: string;
                metric: string;
                workspaceId: string | null;
                version: number;
                hardLimit: unknown;
                enabled: boolean;
              }>) ?? [];
            const current = all.filter((p) => p.enabled);
            const history = all.filter((p) => !p.enabled);
            return (
              <>
                <h3 className="font-medium">当前生效策略（{current.length}）</h3>
                <ul className="space-y-1">
                  {current.map((p) => (
                    <li key={p.id}>
                      {p.metric} · ws={p.workspaceId ?? "ORG"} · v{p.version} ·
                      hard={String(p.hardLimit)}
                    </li>
                  ))}
                  {current.length === 0 && (
                    <li className="text-muted-foreground">
                      无自定义策略，使用平台默认配额
                    </li>
                  )}
                </ul>
                <details>
                  <summary className="cursor-pointer font-medium">
                    历史版本（{history.length}，已停用）
                  </summary>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {history.map((p) => (
                      <li key={p.id}>
                        {p.metric} · ws={p.workspaceId ?? "ORG"} · v{p.version} ·
                        hard={String(p.hardLimit)}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            );
          })()}
        </div>
      )}

      {!loading && !error && tab === "audit" && (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">共 {audit?.total ?? 0} 条</p>
          <ul className="space-y-2">
            {(
              (audit?.items as Array<{
                id: string;
                action: string;
                targetType: string;
                riskLevel?: string | null;
                createdAt: string;
                userId: string;
              }>) ?? []
            ).map((a) => (
              <li key={a.id} className="rounded-md border px-3 py-2">
                <div className="font-medium">
                  {a.action} · {a.targetType}
                </div>
                <div className="text-muted-foreground">
                  {new Date(a.createdAt).toLocaleString()} · actor {a.userId}
                  {a.riskLevel ? ` · ${a.riskLevel}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
