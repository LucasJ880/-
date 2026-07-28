"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { OpsSubnav } from "@/components/ops/ops-subnav";
import {
  DELIVERY_STAGE_LABELS,
  type DeliveryStage,
} from "@/lib/operations/projects/stage";
import type { DeliveryProjectDetail } from "@/lib/operations/projects/types";

type TabKey = "overview" | "work" | "files" | "comms" | "risks";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "总览" },
  { key: "work", label: "工作" },
  { key: "files", label: "文件" },
  { key: "comms", label: "沟通" },
  { key: "risks", label: "风险与变更" },
];

export function DeliveryProjectDetailView({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">(
    "loading",
  );
  const [data, setData] = useState<DeliveryProjectDetail | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [stage, setStage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    const res = await apiFetch(`/api/ops/projects/${projectId}`);
    if (res.status === 403 || res.status === 404) {
      setState("forbidden");
      return;
    }
    if (!res.ok) {
      setState("error");
      return;
    }
    const json = (await res.json()) as DeliveryProjectDetail;
    setData(json);
    setStage(json.deliveryStage || "handoff");
    setState("ready");
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveStage() {
    if (!data || !stage) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/ops/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryStage: stage }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "更新阶段失败");
        return;
      }
      const json = (await res.json()) as DeliveryProjectDetail;
      setData(json);
      setStage(json.deliveryStage || stage);
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") {
    return (
      <div>
        <OpsSubnav />
        <p className="px-4 py-8 text-[13px] text-[var(--muted)]">加载中…</p>
      </div>
    );
  }

  if (state === "forbidden" || !data) {
    return (
      <div>
        <OpsSubnav />
        <div className="mx-auto max-w-6xl px-4 py-10">
          <p className="text-[14px]">无法打开该执行项目。</p>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            可能不是执行项目、不属于当前企业，或你没有权限。
          </p>
          <Link
            href="/ops/projects"
            className="mt-4 inline-block text-[13px] text-[var(--accent)] hover:underline"
          >
            返回执行项目列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <OpsSubnav />
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-6 md:py-8">
        <header className="space-y-2 border-b border-[var(--border)] pb-4">
          <p className="text-[12px] text-[var(--muted)]">
            <Link href="/ops/projects" className="hover:underline">
              执行项目
            </Link>
            {" / "}
            详情
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <p className="text-[13px] text-[var(--muted)]">
            客户：{data.clientOrganization || "—"}
            {" · "}
            负责人：{data.ownerName || "—"}
            {" · "}
            阶段：{data.deliveryStageLabel}
            {" · "}
            健康度：{data.healthLabel}
          </p>
        </header>

        <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] ${
                tab === t.key
                  ? "bg-[var(--accent)] text-[var(--on-accent)]"
                  : "text-[var(--muted)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              <section className="space-y-2">
                <h2 className="text-[15px] font-semibold">项目信息</h2>
                <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
                  <div>
                    <dt className="text-[var(--muted)]">计划完成</dt>
                    <dd>
                      {data.plannedCompletionDate
                        ? new Date(data.plannedCompletionDate).toLocaleDateString(
                            "zh-CN",
                          )
                        : "未设置"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">实际完成</dt>
                    <dd>
                      {data.actualCompletionDate
                        ? new Date(data.actualCompletionDate).toLocaleDateString(
                            "zh-CN",
                          )
                        : "—"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-[var(--muted)]">说明</dt>
                    <dd>{data.description || "—"}</dd>
                  </div>
                </dl>
              </section>

              <section className="space-y-2">
                <h2 className="text-[15px] font-semibold">下一步建议</h2>
                <p className="text-[13px]">
                  {data.nextStepSuggestion || "暂无确定性建议"}
                </p>
                <p className="text-[12px] text-[var(--muted)]">
                  建议仅基于当前阶段与开放任务标题匹配，不做 AI 推测。
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-[15px] font-semibold">开放任务摘要</h2>
                <p className="text-[13px] text-[var(--muted)]">
                  开放 {data.openTaskCount}
                  {" · "}
                  逾期 {data.overdueTaskCount}
                  {" · "}
                  阻塞 {data.blockedTaskCount}
                  {" · "}
                  等待 {data.waitingTaskCount}
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-[15px] font-semibold">最近活动</h2>
                {data.recentActivity.length ? (
                  <ul className="space-y-2">
                    {data.recentActivity.map((a) => (
                      <li
                        key={a.id}
                        className="border-b border-[var(--border)] py-2 text-[13px] last:border-b-0"
                      >
                        <p>
                          {a.action}
                          {a.userName ? ` · ${a.userName}` : ""}
                        </p>
                        <p className="text-[12px] text-[var(--muted)]">
                          {new Date(a.createdAt).toLocaleString("zh-CN")}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-[var(--muted)]">暂无活动记录</p>
                )}
              </section>
            </div>

            <aside className="space-y-4 lg:border-l lg:border-[var(--border)] lg:pl-5">
              <section className="space-y-2">
                <h2 className="text-[15px] font-semibold">推进阶段</h2>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-[13px]"
                >
                  {(Object.keys(DELIVERY_STAGE_LABELS) as DeliveryStage[]).map(
                    (k) => (
                      <option key={k} value={k}>
                        {DELIVERY_STAGE_LABELS[k]}
                      </option>
                    ),
                  )}
                </select>
                <button
                  type="button"
                  disabled={saving || stage === (data.deliveryStage || "")}
                  onClick={() => void saveStage()}
                  className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-[13px] text-[var(--on-accent)] disabled:opacity-50"
                >
                  {saving ? "保存中…" : "更新阶段"}
                </button>
                {!data.canReopenCompleted ? (
                  <p className="text-[11px] text-[var(--muted)]">
                    从已完成恢复需要管理权限
                  </p>
                ) : null}
              </section>
            </aside>
          </div>
        ) : null}

        {tab === "work" ? (
          <section className="space-y-3">
            <p className="text-[13px] text-[var(--muted)]">
              复用统一任务中心，不创建第二套项目任务。
            </p>
            <div className="flex flex-wrap gap-2 text-[13px]">
              <Link
                href={`/tasks?projectId=${data.id}&projectDomain=delivery`}
                className="rounded-md bg-[var(--accent)] px-3 py-2 text-[var(--on-accent)]"
              >
                打开完整任务中心
              </Link>
              <Link
                href={`/tasks?projectId=${data.id}&bucket=blocked`}
                className="rounded-md border border-[var(--border)] px-3 py-2"
              >
                阻塞任务 ({data.blockedTaskCount})
              </Link>
              <Link
                href={`/tasks?projectId=${data.id}&bucket=waiting`}
                className="rounded-md border border-[var(--border)] px-3 py-2"
              >
                等待任务 ({data.waitingTaskCount})
              </Link>
              <Link
                href={`/tasks?projectId=${data.id}&bucket=open`}
                className="rounded-md border border-[var(--border)] px-3 py-2"
              >
                开放任务 ({data.openTaskCount})
              </Link>
            </div>
          </section>
        ) : null}

        {tab === "files" ? (
          <section className="space-y-2">
            <p className="text-[13px]">
              已有项目文件 {data.documentsCount} 个。复用现有项目文件能力，不复制文件系统。
            </p>
            <Link
              href={`/projects/${data.id}?tab=documents`}
              className="inline-block text-[13px] text-[var(--accent)] hover:underline"
            >
              打开项目文件
            </Link>
          </section>
        ) : null}

        {tab === "comms" ? (
          <section className="space-y-2">
            {data.messagesCount > 0 ? (
              <>
                <p className="text-[13px]">
                  已有项目讨论消息 {data.messagesCount} 条。
                </p>
                <Link
                  href={`/projects/${data.id}?tab=discussion`}
                  className="inline-block text-[13px] text-[var(--accent)] hover:underline"
                >
                  打开项目沟通
                </Link>
              </>
            ) : (
              <p className="text-[13px] text-[var(--muted)]">
                当前没有统一项目沟通记录，不伪造客户时间线。
              </p>
            )}
          </section>
        ) : null}

        {tab === "risks" ? (
          <section className="space-y-3">
            <p className="text-[12px] text-[var(--muted)]">
              Phase 4 不创建独立 Risk / ChangeOrder 表；以下为真实数据投影。
            </p>
            {data.riskSignals.length ? (
              <ul className="space-y-2">
                {data.riskSignals.map((r, idx) => (
                  <li
                    key={`${r.kind}-${idx}`}
                    className="border-b border-[var(--border)] py-2 text-[13px] last:border-b-0"
                  >
                    <p className="font-medium">{r.label}</p>
                    <p className="text-[12px] text-[var(--muted)]">
                      来源：{r.source}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-[var(--muted)]">
                暂无基于任务或计划日期的风险信号
              </p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
