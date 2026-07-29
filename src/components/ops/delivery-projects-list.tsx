"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { OpsSubnav } from "@/components/ops/ops-subnav";
import { DELIVERY_STAGE_LABELS, type DeliveryStage } from "@/lib/operations/projects/stage";
import type { DeliveryProjectListItem } from "@/lib/operations/projects/types";

type ListResponse = {
  items: DeliveryProjectListItem[];
  total: number;
  page: number;
  pageSize: number;
  view: "mine" | "team";
  canToggleTeamView: boolean;
  sections?: {
    needsAttention: number;
    active: number;
    onHold: number;
    recentlyCompleted: number;
  };
};

function healthTone(h: string): string {
  if (h === "blocked") return "text-red-700";
  if (h === "at_risk") return "text-amber-700";
  if (h === "attention") return "text-orange-700";
  if (h === "completed") return "text-[var(--muted)]";
  return "text-emerald-700";
}

export function DeliveryProjectsList() {
  const [state, setState] = useState<"loading" | "ready" | "error" | "unauthorized">(
    "loading",
  );
  const [data, setData] = useState<ListResponse | null>(null);
  const [view, setView] = useState<"mine" | "team">("mine");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [health, setHealth] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    clientOrganization: "",
    plannedCompletionDate: "",
    description: "",
  });

  const load = useCallback(
    async (nextView: "mine" | "team" = view) => {
      setState("loading");
      const params = new URLSearchParams({ view: nextView });
      if (search.trim()) params.set("search", search.trim());
      if (stage) params.set("stage", stage);
      if (health) params.set("health", health);
      const res = await apiFetch(`/api/ops/projects?${params}`);
      if (res.status === 403) {
        setState("unauthorized");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      const json = (await res.json()) as ListResponse;
      setData(json);
      setView(json.view);
      setState("ready");
    },
    [view, search, stage, health],
  );

  useEffect(() => {
    void load("mine");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createProject() {
    if (!form.name.trim() || !form.clientOrganization.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch("/api/ops/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          clientOrganization: form.clientOrganization.trim(),
          plannedCompletionDate: form.plannedCompletionDate || null,
          description: form.description || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "创建失败");
        return;
      }
      const created = await res.json();
      setForm({
        name: "",
        clientOrganization: "",
        plannedCompletionDate: "",
        description: "",
      });
      window.location.href = `/ops/projects/${created.id}`;
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <OpsSubnav />
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-6 md:py-8">
        <header className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">执行项目</h1>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              运营交付项目，与招投标项目分离
            </p>
          </div>
          {data?.canToggleTeamView ? (
            <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => void load("mine")}
                className={`rounded-md px-3 py-1.5 ${
                  view === "mine"
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "text-[var(--muted)]"
                }`}
              >
                我的项目
              </button>
              <button
                type="button"
                onClick={() => void load("team")}
                className={`rounded-md px-3 py-1.5 ${
                  view === "team"
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "text-[var(--muted)]"
                }`}
              >
                团队项目
              </button>
            </div>
          ) : null}
        </header>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目 / 客户"
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-[13px]"
          />
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-[13px]"
          >
            <option value="">全部阶段</option>
            {(Object.keys(DELIVERY_STAGE_LABELS) as DeliveryStage[]).map((k) => (
              <option key={k} value={k}>
                {DELIVERY_STAGE_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            value={health}
            onChange={(e) => setHealth(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-[13px]"
          >
            <option value="">全部健康度</option>
            <option value="blocked">阻塞</option>
            <option value="at_risk">有风险</option>
            <option value="attention">需关注</option>
            <option value="healthy">健康</option>
            <option value="completed">已完成</option>
          </select>
          <button
            type="button"
            onClick={() => void load(view)}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-[13px]"
          >
            筛选
          </button>
        </div>

        {data?.sections ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "需要关注", value: data.sections.needsAttention },
              { label: "活跃项目", value: data.sections.active },
              { label: "暂停项目", value: data.sections.onHold },
              { label: "最近完成", value: data.sections.recentlyCompleted },
            ].map((c) => (
              <div key={c.label} className="px-1">
                <p className="text-[11px] text-[var(--muted)]">{c.label}</p>
                <p className="text-xl font-semibold tabular-nums">{c.value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <details className="rounded-lg border border-[var(--border)] px-4 py-3">
          <summary className="cursor-pointer text-[13px] font-medium">
            手动创建执行项目
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="项目名称 *"
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-[13px]"
            />
            <input
              value={form.clientOrganization}
              onChange={(e) =>
                setForm((f) => ({ ...f, clientOrganization: e.target.value }))
              }
              placeholder="客户名称 *"
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-[13px]"
            />
            <input
              type="date"
              value={form.plannedCompletionDate}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  plannedCompletionDate: e.target.value,
                }))
              }
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-[13px]"
            />
            <input
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="项目说明（可选）"
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-[13px]"
            />
          </div>
          <button
            type="button"
            disabled={creating}
            onClick={() => void createProject()}
            className="mt-3 rounded-md bg-[var(--accent)] px-3 py-2 text-[13px] text-[var(--on-accent)] disabled:opacity-50"
          >
            {creating ? "创建中…" : "创建执行项目"}
          </button>
        </details>

        {state === "loading" ? (
          <p className="text-[13px] text-[var(--muted)]">加载中…</p>
        ) : null}
        {state === "unauthorized" ? (
          <p className="text-[13px] text-red-700">无权访问执行项目</p>
        ) : null}
        {state === "error" ? (
          <p className="text-[13px] text-red-700">加载失败，请重试</p>
        ) : null}

        {state === "ready" && data ? (
          data.items.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] px-4 py-10">
              <p className="text-[14px]">当前还没有执行项目。</p>
              <p className="mt-2 text-[13px] text-[var(--muted)]">
                可以手动创建执行项目；中标项目自动交接将在后续阶段开放。
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[12px] text-[var(--muted)]">
                    <th className="py-2 pr-3 font-medium">项目</th>
                    <th className="py-2 pr-3 font-medium">客户</th>
                    <th className="py-2 pr-3 font-medium">负责人</th>
                    <th className="py-2 pr-3 font-medium">阶段</th>
                    <th className="py-2 pr-3 font-medium">健康度</th>
                    <th className="py-2 pr-3 font-medium">计划完成</th>
                    <th className="py-2 pr-3 font-medium">任务</th>
                    <th className="py-2 font-medium">更新</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--border)] last:border-b-0"
                    >
                      <td className="py-2.5 pr-3">
                        <Link
                          href={`/ops/projects/${p.id}`}
                          className="font-medium text-[var(--accent)] hover:underline"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3 text-[var(--muted)]">
                        {p.clientOrganization || "—"}
                      </td>
                      <td className="py-2.5 pr-3">{p.ownerName || "—"}</td>
                      <td className="py-2.5 pr-3">{p.deliveryStageLabel}</td>
                      <td className={`py-2.5 pr-3 ${healthTone(p.health)}`}>
                        {p.healthLabel}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums">
                        {p.plannedCompletionDate
                          ? new Date(p.plannedCompletionDate).toLocaleDateString(
                              "zh-CN",
                            )
                          : "—"}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-[var(--muted)]">
                        开 {p.openTaskCount}
                        {p.overdueTaskCount ? ` · 逾 ${p.overdueTaskCount}` : ""}
                        {p.blockedTaskCount ? ` · 阻 ${p.blockedTaskCount}` : ""}
                      </td>
                      <td className="py-2.5 tabular-nums text-[var(--muted)]">
                        {new Date(p.updatedAt).toLocaleDateString("zh-CN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
