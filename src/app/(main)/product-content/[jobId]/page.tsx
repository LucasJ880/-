"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { toProxyUrl } from "@/lib/files/blob-access";
import { cn } from "@/lib/utils";

interface FactRow {
  id: string;
  fieldKey: string;
  value: unknown;
  status: string;
  sourceType: string;
  locked: boolean;
}

interface QaResult {
  overallScore: number;
  recommendedStatus: string;
  detectedChangesJson: unknown;
}

interface VisualOutput {
  id: string;
  blobPathname: string | null;
  status: string;
  locked?: boolean;
  qaOverallScore: number | null;
  qaResult?: QaResult | null;
}

interface VisualJob {
  id: string;
  mode: string;
  sceneType: string;
  status: string;
  outputs: VisualOutput[];
}

interface CopyData {
  id: string;
  productNameEn: string | null;
  titleEn: string | null;
  shortDescriptionEn: string | null;
  longDescriptionEn: string | null;
}

interface DocRow {
  id: string;
  docType: string;
  blobPathname: string | null;
  fileName: string | null;
}

interface JobDetail {
  id: string;
  title: string;
  status: string;
  executionMode: string;
  documentPurpose?: string;
  planJson: unknown;
  missingFieldsJson: unknown;
  errorMessage: string | null;
  costCents?: number;
  estimatedCostCents?: number;
  costSummary?: {
    estimatedCents: number;
    actualCents: number;
    budgetCents: number | null;
    withinBudget: boolean;
    byCategory: Record<string, { estimatedCents: number; actualCents: number }>;
  };
  facts: FactRow[];
  visualJobs: VisualJob[];
  copy: CopyData | null;
  documents: DocRow[];
  approvals: Array<{ id: string; actionKey: string; status: string }>;
}

export default function ProductContentReviewPage() {
  const params = useParams();
  const jobId = String(params.jobId ?? "");
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [documentPurpose, setDocumentPurpose] = useState("INTERNAL_DRAFT");
  const [copyDraft, setCopyDraft] = useState<Partial<CopyData>>({});

  const load = useCallback(async () => {
    if (!orgId || ambiguous || !jobId) {
      setJob(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/product-content/jobs/${jobId}?orgId=${orgId}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { job: JobDetail };
        setJob(data.job);
        setDocumentPurpose(data.job.documentPurpose ?? "INTERNAL_DRAFT");
        if (data.job.copy) {
          setCopyDraft({
            productNameEn: data.job.copy.productNameEn,
            titleEn: data.job.copy.titleEn,
            shortDescriptionEn: data.job.copy.shortDescriptionEn,
            longDescriptionEn: data.job.copy.longDescriptionEn,
          });
        }
      } else {
        setJob(null);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, ambiguous, jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postAction(path: string, body?: Record<string, unknown>) {
    if (!orgId) return;
    setBusy(path);
    try {
      const res = await apiFetch(`/api/product-content/jobs/${jobId}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...body }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "操作失败");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function patchFact(factId: string, action: "confirm" | "reject" | "lock") {
    if (!orgId) return;
    setBusy(`fact-${factId}-${action}`);
    try {
      const res = await apiFetch(
        `/api/product-content/jobs/${jobId}/facts/${factId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, action }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "更新失败");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function regenerateVisual(outputId: string) {
    if (!orgId) return;
    setBusy(`regen-${outputId}`);
    try {
      const res = await apiFetch(
        `/api/product-content/jobs/${jobId}/visuals/${outputId}/regenerate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, dryRunVisuals: dryRun }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "重新生成失败");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function saveDocumentPurpose(next: string) {
    if (!orgId) return;
    setDocumentPurpose(next);
    await apiFetch(`/api/product-content/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, documentPurpose: next }),
    });
  }

  function parseDetectedChanges(value: unknown): Array<{
    category: string;
    severity: string;
    description: string;
  }> {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is { category: string; severity: string; description: string } =>
        Boolean(item && typeof item === "object" && "description" in item),
    );
  }

  async function patchVisual(outputId: string, action: "approve" | "reject") {
    if (!orgId) return;
    setBusy(`visual-${outputId}`);
    try {
      const res = await apiFetch(
        `/api/product-content/jobs/${jobId}/visuals/${outputId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, action }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "更新失败");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function saveCopy() {
    if (!orgId) return;
    setBusy("copy-save");
    try {
      const res = await apiFetch(`/api/product-content/jobs/${jobId}/copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...copyDraft }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "保存失败");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  const pendingApprovals = useMemo(
    () => job?.approvals.filter((a) => a.status === "pending") ?? [],
    [job],
  );

  if (orgLoading || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-6">
        <Link href="/product-content" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> 返回列表
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">任务不存在或无权访问。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/product-content"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} /> 返回列表
          </Link>
          <PageHeader title={job.title} description={`状态：${job.status}`} />
          {job.errorMessage && (
            <p className="mt-2 text-sm text-red-600">{job.errorMessage}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void postAction("/analyze")}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            分析输入
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void postAction("/plan")}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            生成计划
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void postAction("/approve-plan")}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            批准计划
          </button>
          <label className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            视觉 dry-run
          </label>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              void postAction("/run", { dryRunVisuals: dryRun, formalDocuments: false })
            }
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            运行流水线
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void postAction("/copy")}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            生成文案
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void postAction("/documents", { purpose: documentPurpose })}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            生成文档
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              void postAction("/documents", { purpose: "INTERNAL_DRAFT" })
            }
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            生成内部草稿
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void postAction("/approve")}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            最终批准
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void postAction("/deliver")}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            交付
          </button>
        </div>
      </div>

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <span className="text-muted-foreground">文档用途</span>
            <select
              value={documentPurpose}
              onChange={(e) => void saveDocumentPurpose(e.target.value)}
              className="rounded-md border px-2 py-1 text-sm"
            >
              <option value="INTERNAL_DRAFT">内部草稿</option>
              <option value="CUSTOMER_REVIEW">客户审阅</option>
              <option value="FORMAL_EXTERNAL">正式对外</option>
            </select>
          </label>
          {job.costSummary && (
            <div className="text-muted-foreground">
              成本：预估 {job.costSummary.estimatedCents} 分 · 实际{" "}
              {job.costSummary.actualCents} 分
              {job.costSummary.budgetCents != null && (
                <>
                  {" "}
                  · 预算 {job.costSummary.budgetCents} 分
                  {!job.costSummary.withinBudget && (
                    <span className="ml-1 text-red-600">（超预算）</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {pendingApprovals.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">待审批动作</p>
          <ul className="mt-2 space-y-2">
            {pendingApprovals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span>{a.actionKey}</span>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void apiFetch(
                      `/api/product-content/jobs/${jobId}/approvals/${a.id}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ orgId, decision: "approved" }),
                      },
                    ).then(() => load())
                  }
                  className="rounded border px-2 py-0.5 text-xs"
                >
                  通过
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void apiFetch(
                      `/api/product-content/jobs/${jobId}/approvals/${a.id}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ orgId, decision: "rejected" }),
                      },
                    ).then(() => load())
                  }
                  className="rounded border px-2 py-0.5 text-xs"
                >
                  拒绝
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3 text-sm font-medium">产品事实</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2">字段</th>
                <th className="px-4 py-2">值</th>
                <th className="px-4 py-2">状态</th>
                <th className="px-4 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {job.facts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-muted-foreground">
                    暂无事实，请先添加输入并分析。
                  </td>
                </tr>
              ) : (
                job.facts.map((f) => (
                  <tr key={f.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{f.fieldKey}</td>
                    <td className="max-w-md truncate px-4 py-2">
                      {typeof f.value === "string"
                        ? f.value
                        : JSON.stringify(f.value)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs",
                          f.status === "confirmed"
                            ? "bg-emerald-100 text-emerald-700"
                            : f.status === "conflict"
                              ? "bg-red-100 text-red-700"
                              : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {f.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        {!f.locked && f.status !== "confirmed" && (
                          <button
                            type="button"
                            className="rounded border px-2 py-0.5 text-xs"
                            onClick={() => void patchFact(f.id, "confirm")}
                          >
                            确认
                          </button>
                        )}
                        {f.status !== "rejected" && (
                          <button
                            type="button"
                            className="rounded border px-2 py-0.5 text-xs"
                            onClick={() => void patchFact(f.id, "reject")}
                          >
                            拒绝
                          </button>
                        )}
                        {!f.locked && (
                          <button
                            type="button"
                            className="rounded border px-2 py-0.5 text-xs"
                            onClick={() => void patchFact(f.id, "lock")}
                          >
                            锁定
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3 text-sm font-medium">视觉输出</div>
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {job.visualJobs.flatMap((vj) =>
            vj.outputs.map((out) => (
              <div key={out.id} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  {vj.mode} · {vj.sceneType} · {out.status}
                  {out.qaOverallScore != null ? ` · QA ${out.qaOverallScore}` : ""}
                </p>
                {out.blobPathname?.endsWith(".png") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={toProxyUrl(out.blobPathname)}
                    alt=""
                    className="mt-2 max-h-40 w-full rounded object-contain bg-muted"
                  />
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">无预览</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="rounded border px-2 py-0.5 text-xs"
                    onClick={() => void patchVisual(out.id, "approve")}
                  >
                    通过
                  </button>
                  <button
                    type="button"
                    className="rounded border px-2 py-0.5 text-xs"
                    onClick={() => void patchVisual(out.id, "reject")}
                  >
                    拒绝
                  </button>
                  {!out.locked && out.status !== "locked" && (
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5 text-xs"
                      disabled={busy === `regen-${out.id}`}
                      onClick={() => void regenerateVisual(out.id)}
                    >
                      重新生成
                    </button>
                  )}
                </div>
                {out.qaResult && (
                  <ul className="mt-2 space-y-1 text-xs">
                    {parseDetectedChanges(out.qaResult.detectedChangesJson).map(
                      (change, idx) => (
                        <li key={idx} className="rounded bg-muted/40 px-2 py-1">
                          <span
                            className={cn(
                              "mr-1 rounded px-1",
                              change.severity === "high"
                                ? "bg-red-100 text-red-700"
                                : change.severity === "medium"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-600",
                            )}
                          >
                            {change.severity}
                          </span>
                          <span className="text-muted-foreground">{change.category}</span>
                          {" · "}
                          {change.description}
                        </li>
                      ),
                    )}
                    {parseDetectedChanges(out.qaResult.detectedChangesJson).length ===
                      0 && (
                      <li className="text-muted-foreground">QA 未检测到明显偏差</li>
                    )}
                  </ul>
                )}
              </div>
            )),
          )}
          {job.visualJobs.every((v) => v.outputs.length === 0) && (
            <p className="text-sm text-muted-foreground">暂无视觉输出。</p>
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">出口文案</span>
          {job.copy && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy === "copy-save"}
                onClick={() => void saveCopy()}
                className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
              >
                保存修改
              </button>
              {job.copy && (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void apiFetch(`/api/product-content/jobs/${jobId}/copy`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ orgId, action: "approve" }),
                    }).then(() => load())
                  }
                  className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  批准文案
                </button>
              )}
            </div>
          )}
        </div>
        {!job.copy ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">尚未生成文案。</p>
        ) : (
          <div className="space-y-3 p-4">
            {(
              [
                ["productNameEn", "产品名 (EN)"],
                ["titleEn", "标题 (EN)"],
                ["shortDescriptionEn", "短描述 (EN)"],
                ["longDescriptionEn", "长描述 (EN)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-xs text-muted-foreground">
                {label}
                <textarea
                  value={copyDraft[key] ?? ""}
                  onChange={(e) =>
                    setCopyDraft((d) => ({ ...d, [key]: e.target.value }))
                  }
                  rows={key.includes("long") ? 4 : 2}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3 text-sm font-medium">交付文档</div>
        <ul className="divide-y">
          {job.documents.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted-foreground">尚未生成文档。</li>
          ) : (
            job.documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  {doc.docType.toUpperCase()} · {doc.fileName ?? doc.docType}
                </span>
                {doc.blobPathname && (
                  <a
                    href={`${toProxyUrl(doc.blobPathname)}?download=1&filename=${encodeURIComponent(doc.fileName ?? doc.docType)}`}
                    className="text-primary hover:underline"
                  >
                    下载
                  </a>
                )}
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
