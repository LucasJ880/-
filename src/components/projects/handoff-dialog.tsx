"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import type { HandoffPreview } from "@/lib/projects/handoff/types";

type PreviewResponse = HandoffPreview & {
  ownerCandidates?: Array<{ id: string; name: string }>;
  canManageTender?: boolean;
};

type ExecuteResult = {
  handoffId: string;
  status: string;
  targetDeliveryProjectId: string | null;
  created: boolean;
  message: string;
  taskCount?: number;
  error?: string;
  code?: string;
};

type Props = {
  projectId: string;
  open: boolean;
  onClose: () => void;
  tenderStatus: string | null;
};

export function HandoffDialog({
  projectId,
  open,
  onClose,
  tenderStatus,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  const [deliveryName, setDeliveryName] = useState("");
  const [deliveryOwnerId, setDeliveryOwnerId] = useState("");
  const [plannedCompletionDate, setPlannedCompletionDate] = useState("");
  const [description, setDescription] = useState("");
  const [useOverride, setUseOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [flags, setFlags] = useState({
    insuranceOrBond: false,
    securityOrSiteAccess: false,
    siteMeasurement: false,
    shopDrawing: false,
    procurement: false,
    installation: false,
  });

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/handoff/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          useHistoricalOverride: useOverride,
          overrideReason: useOverride ? overrideReason : null,
          conditionalFlags: flags,
        }),
      });
      if (res.status === 403) {
        setError("无权预览交接");
        setPreview(null);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "预览加载失败");
        setPreview(null);
        return;
      }
      const json = (await res.json()) as PreviewResponse;
      setPreview(json);
      setDeliveryName((n) => n || json.suggestedDeliveryName);
      setDescription((d) => d || json.description || "");
      setFlags((f) => ({ ...f, ...json.conditionalFlags }));
    } catch {
      setError("预览加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, useOverride, overrideReason, flags]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    void loadPreview();
    // 仅在打开时加载；override/flags 变更由用户点「刷新预览」
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  async function execute() {
    if (!deliveryOwnerId) {
      setError("请选择运营项目负责人");
      return;
    }
    setExecuting(true);
    setError("");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/handoff/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryOwnerId,
          deliveryName,
          description,
          plannedCompletionDate: plannedCompletionDate || null,
          conditionalFlags: flags,
          overrideReason: useOverride ? overrideReason : null,
        }),
      });
      const json = (await res.json()) as ExecuteResult;
      if (!res.ok) {
        setError(json.error || "交接失败");
        void loadPreview();
        return;
      }
      setResult(json);
    } catch {
      setError("交接失败，请稍后重试");
    } finally {
      setExecuting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-xl border border-[var(--border)] bg-[var(--card)] sm:rounded-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <h2 className="text-[16px] font-semibold">转为执行项目</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-[var(--muted)]"
          >
            关闭
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {tenderStatus !== "won" ? (
            <p className="text-[13px] text-amber-700">
              当前中标状态为「{tenderStatus || "未设置"}」，仅 won 可交接。
            </p>
          ) : null}

          {loading ? (
            <p className="text-[13px] text-[var(--muted)]">正在加载交接预览…</p>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
              {error}
            </div>
          ) : null}

          {result?.status === "completed" && result.targetDeliveryProjectId ? (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
              <p className="text-[14px] font-medium text-emerald-800">
                执行项目已创建
              </p>
              <p className="text-[13px] text-emerald-800">{result.message}</p>
              <div className="flex flex-wrap gap-2 text-[13px]">
                <Link
                  href={`/ops/projects/${result.targetDeliveryProjectId}`}
                  className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[var(--on-accent)]"
                >
                  打开执行项目
                </Link>
                <Link
                  href={`/projects/${projectId}`}
                  className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5"
                  onClick={onClose}
                >
                  返回投标项目
                </Link>
              </div>
            </div>
          ) : null}

          {preview && !result ? (
            <>
              {preview.existingHandoff?.status === "completed" &&
              preview.existingHandoff.targetDeliveryProjectId ? (
                <div className="rounded-lg border border-[var(--border)] px-3 py-3 text-[13px]">
                  <p className="font-medium">已转为执行项目</p>
                  <Link
                    href={`/ops/projects/${preview.existingHandoff.targetDeliveryProjectId}`}
                    className="mt-2 inline-block text-[var(--accent)] hover:underline"
                  >
                    打开执行项目
                  </Link>
                </div>
              ) : null}

              {preview.existingHandoff?.status === "processing" ? (
                <p className="text-[13px] text-amber-700">交接正在处理中…</p>
              ) : null}

              {preview.existingHandoff?.status === "failed" ? (
                <p className="text-[13px] text-red-700">
                  上次交接失败，可修正后安全重试（不会创建第二个成功交接）。
                </p>
              ) : null}

              {preview.blockers.length ? (
                <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                  {preview.blockers.map((b) => (
                    <li key={b.code}>· {b.message}</li>
                  ))}
                </ul>
              ) : null}

              <section className="space-y-2 text-[13px]">
                <h3 className="font-semibold">来源与摘要</h3>
                <p>来源：{preview.sourceProjectName}</p>
                <p>中标状态：{preview.tenderStatus || "—"}</p>
                <p>客户：{preview.clientOrganization || "—"}</p>
                <p>地址：{preview.location || "—"}</p>
                <p>
                  金额：{preview.amount.label}
                  {preview.amount.confirmed && preview.amount.amount != null
                    ? ` · ${preview.amount.currency || ""} ${preview.amount.amount}`
                    : ""}
                </p>
              </section>

              <section className="grid gap-2 sm:grid-cols-2">
                <label className="text-[13px] sm:col-span-2">
                  执行项目名称
                  <input
                    value={deliveryName}
                    onChange={(e) => setDeliveryName(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                  />
                </label>
                <label className="text-[13px] sm:col-span-2">
                  运营负责人（必选确认）
                  <select
                    value={deliveryOwnerId}
                    onChange={(e) => setDeliveryOwnerId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                  >
                    <option value="">请选择…</option>
                    {(preview.ownerCandidates || []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[13px]">
                  计划完成日期
                  <input
                    type="date"
                    value={plannedCompletionDate}
                    onChange={(e) => setPlannedCompletionDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                  />
                </label>
                <label className="text-[13px] sm:col-span-2">
                  执行项目说明
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                  />
                </label>
              </section>

              <section className="space-y-2 text-[13px]">
                <h3 className="font-semibold">条件任务（仅确认适用项）</h3>
                {(
                  [
                    ["insuranceOrBond", "保险 / Bond"],
                    ["securityOrSiteAccess", "安全 / 现场准入"],
                    ["siteMeasurement", "现场测量"],
                    ["shopDrawing", "Shop Drawing / 客户审批"],
                    ["procurement", "采购 / 生产"],
                    ["installation", "安装"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={flags[key]}
                      onChange={(e) =>
                        setFlags((f) => ({ ...f, [key]: e.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </section>

              {preview.requiresHistoricalOverride ? (
                <section className="space-y-2 rounded-lg border border-[var(--border)] px-3 py-3 text-[13px]">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={useOverride}
                      disabled={!preview.canOverride}
                      onChange={(e) => setUseOverride(e.target.checked)}
                    />
                    历史项目交接 override
                    {!preview.canOverride
                      ? "（需管理层权限）"
                      : ""}
                  </label>
                  {useOverride ? (
                    <textarea
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="override reason（必填）"
                      rows={2}
                      className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                    />
                  ) : null}
                </section>
              ) : null}

              <section className="space-y-1 text-[13px]">
                <h3 className="font-semibold">将创建的任务</h3>
                <p className="text-[var(--muted)]">
                  基础 {preview.baseTasks.length} · 条件{" "}
                  {preview.conditionalTasks.length}
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {[...preview.baseTasks, ...preview.conditionalTasks].map(
                    (t) => (
                      <li key={t.templateKey}>· {t.title}</li>
                    ),
                  )}
                </ul>
              </section>

              {preview.missing.length ? (
                <section className="text-[13px]">
                  <h3 className="font-semibold">缺失信息</h3>
                  <ul>
                    {preview.missing.map((m) => (
                      <li key={m}>· {m}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                <button
                  type="button"
                  onClick={() => void loadPreview()}
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-[13px]"
                >
                  刷新预览
                </button>
                <button
                  type="button"
                  disabled={
                    executing ||
                    !deliveryOwnerId ||
                    preview.existingHandoff?.status === "completed" ||
                    preview.existingHandoff?.status === "processing"
                  }
                  onClick={() => void execute()}
                  className="rounded-md bg-[var(--accent)] px-3 py-2 text-[13px] text-[var(--on-accent)] disabled:opacity-50"
                >
                  {executing ? "交接中…" : "确认创建执行项目"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
