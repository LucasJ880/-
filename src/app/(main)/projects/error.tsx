"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

export default function ProjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Projects] Render error:", error);
    Sentry.captureException(error, { tags: { boundary: "projects" } });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
        <AlertTriangle className="h-7 w-7 text-red-600" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">项目页面加载失败</h2>
      <p className="max-w-sm text-sm text-muted">
        项目数据加载时遇到问题。可能是暂时的网络或服务异常，请重试。
      </p>
      {(error.message || error.digest) && (
        <pre className="max-w-lg overflow-auto rounded-lg bg-gray-100 px-4 py-2 text-left text-xs text-red-700">
          {error.message}
          {error.digest && `\ndigest: ${error.digest}`}
        </pre>
      )}
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-foreground/90"
        >
          <RefreshCw className="h-4 w-4" />
          重试
        </button>
        <a
          href="/projects"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/80 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white"
        >
          <ArrowLeft className="h-4 w-4" />
          返回项目列表
        </a>
      </div>
    </div>
  );
}
