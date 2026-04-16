"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

export default function AssistantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Assistant] Render error:", error);
    Sentry.captureException(error, { tags: { boundary: "assistant" } });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
        <AlertTriangle className="h-7 w-7 text-red-600" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">AI 助手暂不可用</h2>
      <p className="max-w-sm text-sm text-muted">
        AI 服务加载时遇到问题。请稍后重试，若问题持续请联系管理员。
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
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/80 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white"
        >
          <Home className="h-4 w-4" />
          返回首页
        </a>
      </div>
    </div>
  );
}
