"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type Detail = {
  id: string;
  sourceType: string;
  actionType: string;
  title?: string | null;
  riskLevel: string;
  status: string;
  executionStatus?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  submittedById?: string | null;
  sourceAgentSkillTool?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  decidedAt?: string | null;
  executedAt?: string | null;
  runId?: string | null;
  payloadSummary?: unknown;
  payloadHash?: string | null;
  policyVersion?: string | null;
  errorSummary?: string | null;
  capabilities: {
    canApprove: boolean;
    canReject: boolean;
    canCancel: boolean;
    canRetry: boolean;
  };
};

export default function CapabilityApprovalDetailPage() {
  const params = useParams<{ approvalId: string }>();
  const approvalId = decodeURIComponent(params.approvalId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiFetch(
      `/api/capabilities/approvals/${encodeURIComponent(approvalId)}`,
    );
    if (res.status === 403) {
      setError("无权限查看该审批");
      return;
    }
    if (res.status === 404) {
      setError("审批不存在");
      return;
    }
    if (!res.ok) {
      setError("加载失败");
      return;
    }
    setDetail((await res.json()) as Detail);
  }, [approvalId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: "approve" | "reject" | "cancel" | "retry") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch(
        `/api/capabilities/approvals/${encodeURIComponent(approvalId)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: `${action}:${approvalId}:${Date.now()}`,
            note: action === "reject" ? "能力中台拒绝" : undefined,
          }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      setMsg(data.ok ? data.message ?? "完成" : data.error ?? "失败");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <Link
        href="/capabilities/approvals"
        className="text-sm text-primary hover:underline"
      >
        ← 返回列表
      </Link>
      <PageHeader title="审批详情" description="业务摘要 / 依据 / 执行状态 / Trace" />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}

      {detail ? (
        <>
          <section className="rounded-xl border p-4">
            <h2 className="text-sm font-semibold">业务摘要</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">动作</dt>
                <dd>{detail.title ?? detail.actionType}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">来源</dt>
                <dd>
                  {detail.sourceType} · {detail.sourceAgentSkillTool ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">提交人</dt>
                <dd className="font-mono text-xs">
                  {detail.submittedById ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">风险</dt>
                <dd>{detail.riskLevel}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Workspace / Project</dt>
                <dd>
                  {detail.workspaceId ?? "—"} / {detail.projectId ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">时间</dt>
                <dd>
                  {new Date(detail.createdAt).toLocaleString()}
                  {detail.expiresAt
                    ? ` → 到期 ${new Date(detail.expiresAt).toLocaleString()}`
                    : ""}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border p-4">
            <h2 className="text-sm font-semibold">审批依据</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>政策版本：{detail.policyVersion ?? "org-default"}</li>
              <li>
                payloadHash：
                <span className="font-mono text-xs">
                  {detail.payloadHash?.slice(0, 16) ?? "—"}…
                </span>
              </li>
              <li>
                操作能力：approve={String(detail.capabilities.canApprove)} /
                reject={String(detail.capabilities.canReject)} / cancel=
                {String(detail.capabilities.canCancel)} / retry=
                {String(detail.capabilities.canRetry)}
              </li>
              <li>CRITICAL 工具不会因 workspace_admin 自动免审批</li>
            </ul>
            {detail.payloadSummary ? (
              <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
                {JSON.stringify(detail.payloadSummary, null, 2)}
              </pre>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                当前可见性下不展示业务正文
              </p>
            )}
          </section>

          <section className="rounded-xl border p-4">
            <h2 className="text-sm font-semibold">执行状态</h2>
            <p className="mt-2 text-sm">
              审批：{detail.status} · 执行：{detail.executionStatus ?? "尚未执行"}
            </p>
            {detail.errorSummary ? (
              <p className="mt-2 text-sm text-destructive">
                {detail.errorSummary}
              </p>
            ) : null}
            {detail.runId ? (
              <p className="mt-2 text-sm">
                <Link
                  href={`/capabilities/runs/${detail.runId}`}
                  className="text-primary hover:underline"
                >
                  查看关联运行 Trace →
                </Link>
              </p>
            ) : null}
          </section>

          <div className="flex flex-wrap gap-2">
            {detail.capabilities.canApprove ? (
              <button
                type="button"
                disabled={busy}
                className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => void act("approve")}
              >
                批准并执行
              </button>
            ) : null}
            {detail.capabilities.canReject ? (
              <button
                type="button"
                disabled={busy}
                className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => void act("reject")}
              >
                拒绝
              </button>
            ) : null}
            {detail.capabilities.canCancel ? (
              <button
                type="button"
                disabled={busy}
                className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => void act("cancel")}
              >
                取消
              </button>
            ) : null}
            {detail.capabilities.canRetry ? (
              <button
                type="button"
                disabled={busy}
                className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => void act("retry")}
              >
                重试执行
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
