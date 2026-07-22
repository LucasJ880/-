"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type Issue = {
  code: string;
  severity: string;
  status: string;
  scope: string;
  title: string;
  message: string;
  recommendedAction?: string;
  actionHref?: string;
};

type Report = {
  orgId: string;
  overall: string;
  checkedAt: string;
  issues: Issue[];
  summary: {
    healthy: number;
    warning: number;
    error: number;
    missing: number;
    incompatible: number;
  };
};

function overallClass(overall: string) {
  switch (overall) {
    case "HEALTHY":
      return "text-emerald-700";
    case "WARNING":
    case "MISSING":
      return "text-amber-700";
    default:
      return "text-red-700";
  }
}

function severityClass(sev: string) {
  switch (sev) {
    case "CRITICAL":
    case "ERROR":
      return "bg-red-50 text-red-700 border-red-100";
    case "WARNING":
      return "bg-amber-50 text-amber-800 border-amber-100";
    default:
      return "bg-slate-50 text-slate-700 border-slate-100";
  }
}

export default function CapabilitiesHealthPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/capabilities/config-health");
      if (res.status === 403) {
        setError("无企业成员身份，无法查看配置健康");
        setReport(null);
        return;
      }
      if (!res.ok) {
        setError("加载配置健康失败（不伪造 HEALTHY）");
        setReport(null);
        return;
      }
      setReport((await res.json()) as Report);
    } catch {
      setError("加载配置健康失败（不伪造 HEALTHY）");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="配置健康"
        description="检查企业 Pack、模块、Provider、配额与关键配置；不展示密钥，不自动高风险修复"
        actions={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void load()}
              className="min-h-9 rounded-md border border-border bg-white px-3 text-sm"
            >
              重新检查
            </button>
            <Link
              href="/capabilities"
              className="self-center text-sm text-muted-foreground"
            >
              ← 返回中台总览
            </Link>
          </div>
        }
      />

      {loading && (
        <p className="text-sm text-muted-foreground">检查中…</p>
      )}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {report && (
        <>
          <div className="rounded-lg border border-border bg-white/70 p-4">
            <p className="text-xs text-muted-foreground">
              检查时间 {new Date(report.checkedAt).toLocaleString("zh-CN")}
            </p>
            <p className={`mt-1 text-xl font-semibold ${overallClass(report.overall)}`}>
              总体状态：{report.overall}
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>警告 {report.summary.warning}</span>
              <span>错误 {report.summary.error}</span>
              <span>缺失 {report.summary.missing}</span>
              <span>不兼容 {report.summary.incompatible}</span>
            </div>
          </div>

          {report.issues.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              未发现问题
            </p>
          ) : (
            <ul className="space-y-2">
              {report.issues.map((issue) => (
                <li
                  key={`${issue.code}-${issue.title}`}
                  className={`rounded-md border px-3 py-3 ${severityClass(issue.severity)}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold tracking-wide">
                      {issue.severity}
                    </span>
                    <span className="text-[11px] opacity-70">{issue.status}</span>
                    <span className="text-[11px] opacity-70">{issue.scope}</span>
                    <span className="font-medium">{issue.title}</span>
                  </div>
                  <p className="mt-1 text-sm opacity-90">{issue.message}</p>
                  {issue.recommendedAction && (
                    <p className="mt-1 text-xs opacity-75">
                      建议：{issue.recommendedAction}
                    </p>
                  )}
                  {issue.actionHref && (
                    <Link
                      href={issue.actionHref}
                      className="mt-2 inline-block text-xs font-medium underline"
                    >
                      前往处理 →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
