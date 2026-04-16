"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";
import { DOC_SOURCE_TYPE_LABELS, DOC_STATUS_LABELS, label } from "@/lib/i18n/labels";

export default function KnowledgeBaseVersionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const kbId = params.kbId as string;
  const versionId = params.versionId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<{
    version: number;
    note: string | null;
    createdAt: string;
    key: string;
    name: string;
  } | null>(null);
  const [documents, setDocuments] = useState<
    {
      document: {
        id: string;
        title: string;
        sourceType: string;
        sourceUrl: string | null;
        status: string;
      };
      snapshot: {
        version: number;
        content: string;
        summary: string | null;
        note: string | null;
      };
    }[]
  >([]);

  const load = useCallback(() => {
    setLoading(true);
    apiJson<{
      error?: string;
      knowledgeBaseVersion?: {
        version: number;
        note: string | null;
        createdAt: string;
        key: string;
        name: string;
      };
      documents?: {
        document: {
          id: string;
          title: string;
          sourceType: string;
          sourceUrl: string | null;
          status: string;
        };
        snapshot: {
          version: number;
          content: string;
          summary: string | null;
          note: string | null;
        };
      }[];
    }>(
      `/api/projects/${projectId}/knowledge-bases/${kbId}/versions/${versionId}`
    )
      .then((d) => {
        if (d.error) {
          setError(d.error);
          setMeta(null);
        } else {
          setError("");
          const k = d.knowledgeBaseVersion;
          if (k) {
            setMeta({
              version: k.version,
              note: k.note,
              createdAt: k.createdAt,
              key: k.key,
              name: k.name,
            });
          }
          setDocuments(d.documents ?? []);
        }
      })
      .finally(() => setLoading(false));
  }, [projectId, kbId, versionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <p className="text-danger">{error || "未找到版本"}</p>
        <button
          type="button"
          onClick={() =>
            router.push(`/projects/${projectId}/knowledge-bases/${kbId}`)
          }
          className="mt-4 text-sm text-primary"
        >
          返回知识库
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <button
        type="button"
        onClick={() =>
          router.push(`/projects/${projectId}/knowledge-bases/${kbId}`)
        }
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 返回知识库
      </button>

      <div>
        <h1 className="text-xl font-bold">
          {meta.name} · KB 版本 v{meta.version}
        </h1>
        <p className="text-sm text-muted">
          {meta.key} · {new Date(meta.createdAt).toLocaleString("zh-CN")}
          {meta.note ? ` · ${meta.note}` : ""}
        </p>
      </div>

      <ul className="space-y-6">
        {documents.length === 0 ? (
          <li className="text-sm text-muted">该版本下无文档快照</li>
        ) : (
          documents.map(({ document: doc, snapshot: s }) => (
            <li key={doc.id} className="rounded-xl border border-border bg-card-bg p-4">
              <div className="font-medium">{doc.title}</div>
              <div className="text-xs text-muted">
                {label(DOC_SOURCE_TYPE_LABELS, doc.sourceType)} · 文档版本 v{s.version} · {label(DOC_STATUS_LABELS, doc.status)}
                {doc.sourceUrl ? ` · ${doc.sourceUrl}` : ""}
              </div>
              {s.summary && (
                <p className="mt-2 text-sm text-muted">摘要：{s.summary}</p>
              )}
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs">
                {s.content || "（无正文）"}
              </pre>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
