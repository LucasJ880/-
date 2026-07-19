"use client";

import { useCallback, useRef, useState } from "react";
import { FolderUp, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ALLOWED_EXT = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "txt",
  "csv",
  "zip",
  "rar",
  "7z",
  "dwg",
  "dxf",
  "msg",
  "eml",
]);

const SKIP_NAME = /(?:^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(?:\/|$)/i;

export const MAX_FOLDER_FILES = 40;

export type PendingImportFile = {
  file: File;
  relativePath: string;
};

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function filterImportFiles(list: FileList | File[]): {
  accepted: PendingImportFile[];
  skipped: string[];
  folderName: string | null;
} {
  const files = Array.from(list);
  const accepted: PendingImportFile[] = [];
  const skipped: string[] = [];
  let folderName: string | null = null;

  for (const file of files) {
    const rel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    if (!folderName && rel.includes("/")) {
      folderName = rel.split("/")[0] || null;
    }
    if (SKIP_NAME.test(rel) || file.name.startsWith(".")) {
      skipped.push(rel);
      continue;
    }
    if (!ALLOWED_EXT.has(extOf(file.name))) {
      skipped.push(`${rel}（类型不支持）`);
      continue;
    }
    if (file.size > 20 * 1024 * 1024) {
      skipped.push(`${rel}（超过 20MB）`);
      continue;
    }
    accepted.push({ file, relativePath: rel });
  }

  return { accepted, skipped, folderName };
}

export function FolderImportZone({
  files,
  onFiles,
  onClear,
  disabled,
}: {
  files: PendingImportFile[];
  onFiles: (files: PendingImportFile[], folderName: string | null) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const ingest = useCallback(
    (list: FileList | File[]) => {
      const { accepted, skipped, folderName } = filterImportFiles(list);
      if (accepted.length === 0) {
        setHint(
          skipped.length
            ? `没有可上传文件（已跳过 ${skipped.length} 个）`
            : "未选择有效文件",
        );
        return;
      }
      const capped = accepted.slice(0, MAX_FOLDER_FILES);
      const msgs: string[] = [];
      if (accepted.length > MAX_FOLDER_FILES) {
        msgs.push(`最多上传 ${MAX_FOLDER_FILES} 个文件，已截取前 ${MAX_FOLDER_FILES} 个`);
      }
      if (skipped.length) {
        msgs.push(`已跳过 ${skipped.length} 个不适用文件`);
      }
      setHint(msgs.length ? msgs.join("；") : null);
      onFiles(capped, folderName);
    },
    [onFiles],
  );

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "rounded-xl border border-dashed px-4 py-5 transition-colors",
          dragOver
            ? "border-accent bg-accent/5"
            : "border-border bg-muted/10",
          disabled && "opacity-50",
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (disabled) return;
          if (e.dataTransfer.files?.length) {
            ingest(e.dataTransfer.files);
          }
        }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <FolderUp size={22} className="text-accent/80" />
          <p className="text-sm font-medium">上传招标文件夹（可选）</p>
          <p className="text-[11px] text-muted">
            选择文件夹后，项目名称会预填为文件夹名；需你确认后再创建。创建后 AI
            会扫描文件并尝试补全截标日等关键信息。
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => folderInputRef.current?.click()}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              选择文件夹
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted/30 disabled:opacity-50"
            >
              或选多个文件
            </button>
          </div>
        </div>
        <input
          ref={(el) => {
            folderInputRef.current = el;
            if (el) {
              el.setAttribute("webkitdirectory", "");
              el.setAttribute("directory", "");
            }
          }}
          type="file"
          className="hidden"
          multiple
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files?.length) ingest(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files?.length) ingest(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}

      {files.length > 0 ? (
        <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted">
              待上传 {files.length} 个文件
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={onClear}
              className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-foreground"
            >
              <X size={12} />
              清空
            </button>
          </div>
          <ul className="max-h-28 space-y-1 overflow-y-auto text-[11px]">
            {files.slice(0, 12).map((f) => (
              <li key={f.relativePath} className="flex items-start gap-1.5 truncate">
                <FileText size={12} className="mt-0.5 shrink-0 text-muted" />
                <span className="truncate">{f.relativePath}</span>
              </li>
            ))}
            {files.length > 12 ? (
              <li className="text-muted">…还有 {files.length - 12} 个</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
