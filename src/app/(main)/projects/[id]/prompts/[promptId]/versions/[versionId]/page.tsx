"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";

export default function PromptVersionViewPage() {
  const params = useParams();
  const projectId = params.id as string;
  const promptId = params.promptId as string;
  const versionId = params.versionId as string;

  const [content, setContent] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    version: number;
    note: string | null;
    createdAt: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    apiJson(
      `/api/projects/${projectId}/prompts/${promptId}/versions/${versionId}`
    )
      .then((d: Record<string, unknown>) => {
        if (d.error) {
          setError(d.error);
          setContent(null);
        } else {
          setContent(d.version.content);
          setMeta({
            version: d.version.version,
            note: d.version.note,
            createdAt: d.version.createdAt,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [projectId, promptId, versionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href={`/projects/${projectId}/prompts/${promptId}`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 返回 Prompt
      </Link>
      {error ? (
        <p className="text-danger">{error}</p>
      ) : (
        <>
          <h1 className="text-lg font-bold">版本 v{meta?.version}</h1>
          {meta?.note && (
            <p className="text-sm text-muted">备注：{meta.note}</p>
          )}
          <p className="text-xs text-muted">
            {meta && new Date(meta.createdAt).toLocaleString("zh-CN")}
          </p>
          <pre className="whitespace-pre-wrap rounded border border-border bg-card-bg p-4 font-mono text-sm">
            {content}
          </pre>
        </>
      )}
    </div>
  );
}
