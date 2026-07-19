"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  setFolderImportPipelineActive,
  takePendingFolderImport,
} from "@/lib/projects/pending-folder-import";
import { requestAutoAiPanels } from "@/lib/projects/auto-ai-panels";
import type { PendingImportFile } from "@/components/project-create/folder-import-zone";

type Phase = "idle" | "upload" | "scan" | "done" | "error";

async function uploadPendingFiles(
  projectId: string,
  pending: PendingImportFile[],
  onProgress: (msg: string) => void,
) {
  const batchSize = 6;
  let uploaded = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    onProgress(
      `上传文件 ${Math.min(i + batch.length, pending.length)}/${pending.length}…`,
    );
    const formData = new FormData();
    for (const item of batch) {
      formData.append("files", item.file);
      formData.append("relativePaths", item.relativePath);
    }
    const res = await apiFetch(`/api/projects/${projectId}/files`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.uploaded?.length) {
      throw new Error(data.error || `上传失败 (${res.status})`);
    }
    uploaded += data.total || data.uploaded?.length || 0;
    if (Array.isArray(data.errors)) {
      for (const e of data.errors) {
        allErrors.push(`${e.name}: ${e.reason}`);
      }
    }
  }

  return { uploaded, errors: allErrors };
}

async function runProjectFilePipeline(
  projectId: string,
  onProgress: (msg: string) => void,
) {
  let guard = 0;
  while (guard < 200) {
    guard += 1;
    const res = await apiFetch(`/api/projects/${projectId}/files/process-next`, {
      method: "POST",
    });
    if (!res.ok) break;
    const data = await res.json();
    if (data.done) {
      const applied = data.metadata?.applied
        ? Object.keys(data.metadata.applied)
        : [];
      if (applied.length) {
        onProgress(`AI 已补全：${applied.join("、")}`);
      } else {
        onProgress("文件扫描完成");
      }
      return data;
    }
    const step =
      data.step === "parse"
        ? "解析"
        : data.step === "ai_summary" || data.step === "ai_summary_skip"
          ? "摘要"
          : data.step === "intelligence"
            ? "项目情报"
            : "处理中";
    onProgress(
      `AI 扫描中（${step}${data.documentTitle ? `：${data.documentTitle}` : ""}，剩余 ${data.remaining ?? "…"}）`,
    );
  }
  return null;
}

export function ProjectImportBanner({
  projectId,
  onFinished,
}: {
  projectId: string;
  onFinished?: () => void;
}) {
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    const pending = takePendingFolderImport(projectId);
    if (!pending?.length) return;
    started.current = true;
    setFolderImportPipelineActive(projectId, true);

    let cancelled = false;
    (async () => {
      try {
        setPhase("upload");
        setMessage(`准备上传 ${pending.length} 个文件…`);
        const { uploaded, errors: uploadErrors } = await uploadPendingFiles(
          projectId,
          pending,
          (msg) => {
            if (!cancelled) setMessage(msg);
          },
        );
        if (cancelled) return;
        setErrors(uploadErrors);

        if (uploaded > 0) {
          setPhase("scan");
          await runProjectFilePipeline(projectId, (msg) => {
            if (!cancelled) setMessage(msg);
          });
        }

        if (cancelled) return;
        setPhase("done");
        setMessage(
          uploadErrors.length
            ? `导入完成（${uploadErrors.length} 个文件失败）`
            : "导入完成，可继续浏览项目",
        );
        onFinished?.();
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("qingyan:project-updated", {
              detail: { projectId },
            }),
          );
          requestAutoAiPanels(projectId, "folder-import-done");
        }
      } catch (e) {
        if (cancelled) return;
        setPhase("error");
        setMessage(e instanceof Error ? e.message : "导入失败");
      } finally {
        setFolderImportPipelineActive(projectId, false);
      }
    })();

    return () => {
      cancelled = true;
      setFolderImportPipelineActive(projectId, false);
    };
  }, [projectId, onFinished]);

  if (dismissed || phase === "idle") return null;

  const tone =
    phase === "error"
      ? "border-[rgba(166,61,61,0.25)] bg-[rgba(166,61,61,0.04)]"
      : phase === "done"
        ? "border-emerald-500/25 bg-emerald-500/5"
        : "border-border bg-card-bg";

  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {phase === "upload" || phase === "scan" ? (
            <Loader2 size={16} className="animate-spin text-accent" />
          ) : phase === "done" ? (
            <CheckCircle2 size={16} className="text-emerald-600" />
          ) : (
            <AlertTriangle size={16} className="text-[#a63d3d]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {phase === "upload"
              ? "正在上传文件夹"
              : phase === "scan"
                ? "AI 正在解析文件"
                : phase === "done"
                  ? "后台导入完成"
                  : "导入出错"}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">{message}</p>
          {(phase === "upload" || phase === "scan") && (
            <p className="mt-1 text-[11px] text-muted">
              可先浏览项目其它内容，导入在后台继续。
            </p>
          )}
          {errors.length > 0 ? (
            <p className="mt-1 text-[11px] text-[#9a6a2f]">
              {errors.slice(0, 3).join("；")}
              {errors.length > 3 ? `…等 ${errors.length} 项` : ""}
            </p>
          ) : null}
        </div>
        {(phase === "done" || phase === "error") && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded p-1 text-muted hover:bg-muted/30 hover:text-foreground"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
