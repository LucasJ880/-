"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { DIGITAL_EMPLOYEE_ROLES } from "@/lib/agent-core/skills/digital-employee-roles";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

interface SkillRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  domain: string;
  tier: string;
  version: number;
  isBuiltin: boolean;
  isActive: boolean;
  outputFormat: string;
  updatedAt: string;
  _count: { executions: number };
  stats?: {
    successRate?: number | null;
    avgRating?: number | null;
    lastExecutedAt?: string | null;
  };
}

type FilterState = {
  domain: string;
  tier: string;
  active: string;
  builtin: string;
};

export default function AgentSkillsSettingsPage() {
  const router = useRouter();
  const { isPlatformAdmin, loading: userLoading } = useCurrentUser();
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    domain: "",
    tier: "",
    active: "all",
    builtin: "all",
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [runVars, setRunVars] = useState("{}");
  const [runResult, setRunResult] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (filters.domain) qs.set("domain", filters.domain);
      if (filters.tier) qs.set("tier", filters.tier);
      if (filters.active !== "all") qs.set("active", filters.active);
      if (filters.builtin !== "all") qs.set("builtin", filters.builtin);
      qs.set("includeStats", "1");
      const data = await apiJson<{ skills: SkillRow[] }>(
        `/api/agent-core/skills?${qs.toString()}`,
      );
      setSkills(data.skills ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userLoading && !isPlatformAdmin) {
      router.replace("/settings");
    }
  }, [userLoading, isPlatformAdmin, router]);

  const domains = useMemo(
    () => Array.from(new Set(skills.map((s) => s.domain))).sort(),
    [skills],
  );

  const toggleActive = async (skill: SkillRow) => {
    setBusyId(skill.id);
    try {
      await apiFetch(`/api/agent-core/skills/${skill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !skill.isActive }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    } finally {
      setBusyId(null);
    }
  };

  const savePrompt = async (skillId: string) => {
    setBusyId(skillId);
    try {
      await apiFetch(`/api/agent-core/skills/${skillId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt: editPrompt }),
      });
      setEditId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusyId(null);
    }
  };

  const runTest = async (skillId: string) => {
    setBusyId(skillId);
    setRunResult("");
    try {
      let variables: Record<string, unknown> = {};
      try {
        variables = JSON.parse(runVars) as Record<string, unknown>;
      } catch {
        setError("测试变量需为合法 JSON");
        return;
      }
      const stringVars: Record<string, string> = {};
      for (const [k, v] of Object.entries(variables)) {
        stringVars[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
      const res = await apiJson<{ result: { content?: string; parsed?: unknown } }>(
        `/api/agent-core/skills/${skillId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "run", variables: stringVars }),
        },
      );
      setRunResult(
        typeof res.result?.content === "string"
          ? res.result.content.slice(0, 4000)
          : JSON.stringify(res.result, null, 2).slice(0, 4000),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "测试运行失败");
    } finally {
      setBusyId(null);
    }
  };

  if (userLoading || !isPlatformAdmin) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
      >
        <ArrowLeft size={14} /> 返回设置
      </Link>

      <PageHeader
        title="数字员工技能"
        description="技能帮助数字员工按照统一方法完成工作。涉及客户、项目、预算、发布和外部沟通的动作，仍需要负责人确认。"
      />

      <section className="mb-6 rounded-xl border border-border bg-card-bg p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Sparkles size={16} className="text-accent" />
          推荐数字员工分组
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {DIGITAL_EMPLOYEE_ROLES.map((role) => (
            <div key={role.id} className="rounded-lg border border-border/70 p-3">
              <div className="text-sm font-medium">{role.name}</div>
              <p className="mt-1 text-xs text-muted">{role.description}</p>
              <p className="mt-2 text-[11px] text-muted">
                {role.skillSlugs.join(" · ")}
                {role.includeOperationsSkills ? " · +运营技能包" : ""}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          Domain
          <select
            className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={filters.domain}
            onChange={(e) => setFilters((f) => ({ ...f, domain: e.target.value }))}
          >
            <option value="">全部</option>
            {domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="sales">sales</option>
            <option value="marketing">marketing</option>
            <option value="project">project</option>
            <option value="analytics">analytics</option>
            <option value="operations">operations</option>
          </select>
        </label>
        <label className="text-xs">
          Tier
          <select
            className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={filters.tier}
            onChange={(e) => setFilters((f) => ({ ...f, tier: e.target.value }))}
          >
            <option value="">全部</option>
            <option value="foundation">foundation</option>
            <option value="analysis">analysis</option>
            <option value="execution">execution</option>
          </select>
        </label>
        <label className="text-xs">
          Active
          <select
            className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={filters.active}
            onChange={(e) => setFilters((f) => ({ ...f, active: e.target.value }))}
          >
            <option value="all">全部</option>
            <option value="true">启用</option>
            <option value="false">停用</option>
          </select>
        </label>
        <label className="text-xs">
          Builtin
          <select
            className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={filters.builtin}
            onChange={(e) => setFilters((f) => ({ ...f, builtin: e.target.value }))}
          >
            <option value="all">全部</option>
            <option value="true">内置</option>
            <option value="false">自定义</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-[rgba(43,96,85,0.04)]"
        >
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.04)] px-3 py-2 text-sm text-[#a63d3d]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载数字员工技能…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[rgba(43,96,85,0.04)] text-xs text-muted">
              <tr>
                <th className="px-3 py-2">技能</th>
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">版本</th>
                <th className="px-3 py-2">执行</th>
                <th className="px-3 py-2">成功率</th>
                <th className="px-3 py-2">评分</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.id} className="border-t border-border/70 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{skill.name}</div>
                    <div className="text-[11px] text-muted">{skill.slug}</div>
                  </td>
                  <td className="px-3 py-2">{skill.domain}</td>
                  <td className="px-3 py-2">{skill.tier}</td>
                  <td className="px-3 py-2">
                    {skill.isActive ? "启用" : "停用"}
                    {skill.isBuiltin ? " · 内置" : ""}
                  </td>
                  <td className="px-3 py-2">v{skill.version}</td>
                  <td className="px-3 py-2">{skill._count?.executions ?? 0}</td>
                  <td className="px-3 py-2">
                    {skill.stats?.successRate != null
                      ? `${Math.round(skill.stats.successRate * 100)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {skill.stats?.avgRating != null
                      ? skill.stats.avgRating.toFixed(1)
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busyId === skill.id}
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px]"
                        onClick={() => {
                          setEditId(skill.id);
                          setEditPrompt("");
                          setRunResult("");
                        }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        disabled={busyId === skill.id}
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px]"
                        onClick={() => void toggleActive(skill)}
                      >
                        {skill.isActive ? (
                          <>
                            <PowerOff size={11} /> 停用
                          </>
                        ) : (
                          <>
                            <Power size={11} /> 启用
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === skill.id}
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px]"
                        onClick={() => {
                          setEditId(skill.id);
                          void runTest(skill.id);
                        }}
                      >
                        <Play size={11} /> 测试
                      </button>
                    </div>
                    {editId === skill.id && (
                      <div className="mt-2 w-[320px] space-y-2">
                        <textarea
                          className="h-28 w-full rounded border border-border bg-background p-2 text-xs"
                          placeholder="粘贴新的 systemPrompt（留空则只测试运行）"
                          value={editPrompt}
                          onChange={(e) => setEditPrompt(e.target.value)}
                        />
                        <textarea
                          className="h-16 w-full rounded border border-border bg-background p-2 text-xs"
                          value={runVars}
                          onChange={(e) => setRunVars(e.target.value)}
                          placeholder='测试变量 JSON，如 {"objective":"..."}'
                        />
                        <div className="flex gap-2">
                          {editPrompt.trim() && (
                            <button
                              type="button"
                              className="rounded bg-accent px-2 py-1 text-[11px] text-white"
                              onClick={() => void savePrompt(skill.id)}
                            >
                              保存 Prompt
                            </button>
                          )}
                          <button
                            type="button"
                            className="rounded border border-border px-2 py-1 text-[11px]"
                            onClick={() => void runTest(skill.id)}
                          >
                            运行测试
                          </button>
                          <button
                            type="button"
                            className="rounded border border-border px-2 py-1 text-[11px]"
                            onClick={() => setEditId(null)}
                          >
                            关闭
                          </button>
                        </div>
                        {runResult && (
                          <pre className="max-h-40 overflow-auto rounded bg-[rgba(0,0,0,0.04)] p-2 text-[10px] whitespace-pre-wrap">
                            {runResult}
                          </pre>
                        )}
                        {skill.isBuiltin && (
                          <p className="text-[10px] text-muted">
                            内置技能可编辑/停用，不可删除；人工修改后种子脚本不会覆盖。
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {skills.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted">
                    暂无技能。可先执行 npm run seed:enterprise-skills:write
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
