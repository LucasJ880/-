"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload,
  FileText,
  Image,
  FileSpreadsheet,
  File,
  Trash2,
  Download,
  Loader2,
  ExternalLink,
  X,
  CheckCircle2,
  AlertTriangle,
  FolderOpen,
  Plus,
  Calendar,
  Pencil,
  Check,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";

interface ProjectDocument {
  id: string;
  title: string;
  url: string;
  blobUrl: string | null;
  fileType: string;
  fileSize: number | null;
  source: string;
  uploadedById: string | null;
  createdAt: string;
}

interface Props {
  projectId: string;
  closeDate?: string | null;
  onProjectUpdate?: () => void;
}

const FILE_ICONS: Record<string, { icon: typeof FileText; color: string }> = {
  pdf: { icon: FileText, color: "text-red-500" },
  doc: { icon: FileText, color: "text-blue-500" },
  docx: { icon: FileText, color: "text-blue-500" },
  xls: { icon: FileSpreadsheet, color: "text-green-600" },
  xlsx: { icon: FileSpreadsheet, color: "text-green-600" },
  csv: { icon: FileSpreadsheet, color: "text-green-600" },
  jpg: { icon: Image, color: "text-purple-500" },
  jpeg: { icon: Image, color: "text-purple-500" },
  png: { icon: Image, color: "text-purple-500" },
  webp: { icon: Image, color: "text-purple-500" },
  gif: { icon: Image, color: "text-purple-500" },
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileType: string) {
  return FILE_ICONS[fileType.toLowerCase()] ?? { icon: File, color: "text-muted-foreground" };
}

export function ProjectFileManager({ projectId, closeDate, onProjectUpdate }: Props) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    try {
      const data = await apiJson<{ documents: ProjectDocument[] }>(
        `/api/projects/${projectId}/files`
      );
      setDocuments(data.documents ?? []);
    } catch {}
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleUpload = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      setUploading(true);
      setUploadProgress(files.map((f) => f.name));

      const formData = new FormData();
      for (const f of files) {
        formData.append("files", f);
      }

      try {
        const res = await apiFetch(`/api/projects/${projectId}/files`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (data.errors?.length > 0) {
          console.warn("部分文件上传失败:", data.errors);
        }

        await fetchFiles();
      } catch {}

      setUploading(false);
      setUploadProgress([]);
    },
    [projectId, fetchFiles]
  );

  const handleDelete = useCallback(
    async (fileId: string) => {
      setDeletingId(fileId);
      try {
        await apiFetch(`/api/projects/${projectId}/files/${fileId}`, {
          method: "DELETE",
        });
        await fetchFiles();
      } catch {}
      setDeletingId(null);
    },
    [projectId, fetchFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = e.dataTransfer.files;
      if (files.length > 0) handleUpload(files);
    },
    [handleUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const uploadedFiles = documents.filter((d) => d.source === "upload");
  const externalFiles = documents.filter((d) => d.source !== "upload");

  return (
    <div className="rounded-xl border border-border/50 bg-card">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-border/30 px-5 py-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-accent" />
          <h3 className="font-semibold text-foreground">项目文件</h3>
          {documents.length > 0 && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
              {documents.length}
            </span>
          )}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          上传文件
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* 截止时间 */}
      <DeadlineEditor
        projectId={projectId}
        closeDate={closeDate}
        onSaved={onProjectUpdate}
      />

      {/* 拖拽上传区域 */}
      {(documents.length === 0 || dragOver) && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            "mx-4 mt-4 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
            dragOver
              ? "border-accent bg-accent/5"
              : "border-border/50 hover:border-border"
          )}
        >
          <Upload
            className={cn(
              "mx-auto h-8 w-8",
              dragOver ? "text-accent" : "text-muted-foreground/40"
            )}
          />
          <p className="mt-2 text-sm font-medium text-foreground">
            {dragOver ? "松开即可上传" : "拖拽文件到这里上传"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            支持 PDF、Word、Excel、图片等，最大 20MB
          </p>
          {documents.length === 0 && !dragOver && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              选择文件
            </button>
          )}
        </div>
      )}

      {/* 上传进度 */}
      {uploading && uploadProgress.length > 0 && (
        <div className="mx-4 mt-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-accent">
            <Loader2 size={12} className="animate-spin" />
            正在上传 {uploadProgress.length} 个文件...
          </div>
          <div className="mt-1 space-y-0.5">
            {uploadProgress.map((name, i) => (
              <div key={i} className="text-[10px] text-muted-foreground truncate">
                {name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 文件列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : documents.length > 0 ? (
        <div className="p-4 space-y-3">
          {/* 上传文件 */}
          {uploadedFiles.length > 0 && (
            <div>
              {externalFiles.length > 0 && (
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  上传文件 ({uploadedFiles.length})
                </h4>
              )}
              <div className="space-y-1">
                {uploadedFiles.map((doc) => (
                  <FileRow
                    key={doc.id}
                    doc={doc}
                    deleting={deletingId === doc.id}
                    onDelete={() => handleDelete(doc.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 外链文件 */}
          {externalFiles.length > 0 && (
            <div>
              {uploadedFiles.length > 0 && (
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  外部链接 ({externalFiles.length})
                </h4>
              )}
              <div className="space-y-1">
                {externalFiles.map((doc) => (
                  <FileRow
                    key={doc.id}
                    doc={doc}
                    deleting={deletingId === doc.id}
                    onDelete={() => handleDelete(doc.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FileRow({
  doc,
  deleting,
  onDelete,
}: {
  doc: ProjectDocument;
  deleting: boolean;
  onDelete: () => void;
}) {
  const { icon: Icon, color } = getFileIcon(doc.fileType);
  const isExternal = doc.source !== "upload";

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border/30 bg-background px-3 py-2.5 hover:border-border/60 transition-colors">
      <Icon size={18} className={cn("shrink-0", color)} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {doc.title}
          </span>
          {isExternal && (
            <ExternalLink size={10} className="shrink-0 text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="uppercase">{doc.fileType}</span>
          {doc.fileSize && (
            <>
              <span>·</span>
              <span>{formatSize(doc.fileSize)}</span>
            </>
          )}
          <span>·</span>
          <span>
            {new Date(doc.createdAt).toLocaleDateString("zh-CN", {
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          title="下载 / 预览"
        >
          <Download size={13} />
        </a>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="rounded p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          title="删除"
        >
          {deleting ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Trash2 size={13} />
          )}
        </button>
      </div>
    </div>
  );
}

function DeadlineEditor({
  projectId,
  closeDate,
  onSaved,
}: {
  projectId: string;
  closeDate?: string | null;
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const currentDate = closeDate ? closeDate.slice(0, 10) : null;

  const daysLeft = currentDate
    ? Math.ceil((new Date(currentDate).getTime() - Date.now()) / 86400000)
    : null;

  const handleSave = useCallback(async () => {
    if (!value) return;
    setSaving(true);
    try {
      await apiFetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closeDate: value }),
      });
      setEditing(false);
      onSaved?.();
    } catch {}
    setSaving(false);
  }, [value, projectId, onSaved]);

  const handleClear = useCallback(async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closeDate: null }),
      });
      setEditing(false);
      setValue("");
      onSaved?.();
    } catch {}
    setSaving(false);
  }, [projectId, onSaved]);

  if (editing) {
    return (
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5">
        <Calendar size={14} className="shrink-0 text-accent" />
        <span className="text-xs font-medium text-foreground">截止时间</span>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="rounded-md border border-border/50 bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          autoFocus
        />
        <button
          onClick={handleSave}
          disabled={!value || saving}
          className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          保存
        </button>
        {currentDate && (
          <button
            onClick={handleClear}
            disabled={saving}
            className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50 transition-colors"
          >
            清除
          </button>
        )}
        <button
          onClick={() => setEditing(false)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          取消
        </button>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2.5">
      <Calendar size={14} className="shrink-0 text-accent/60" />
      {currentDate ? (
        <>
          <span className="text-xs text-muted-foreground">截止时间</span>
          <span className={cn(
            "text-sm font-medium",
            daysLeft !== null && daysLeft <= 3
              ? "text-red-600"
              : daysLeft !== null && daysLeft <= 7
              ? "text-amber-600"
              : "text-foreground"
          )}>
            {new Date(currentDate).toLocaleDateString("zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
          {daysLeft !== null && (
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
              daysLeft <= 0
                ? "bg-red-500/10 text-red-600"
                : daysLeft <= 3
                ? "bg-red-500/10 text-red-600"
                : daysLeft <= 7
                ? "bg-amber-500/10 text-amber-600"
                : "bg-accent/10 text-accent"
            )}>
              <Clock size={9} />
              {daysLeft > 0
                ? `剩余 ${daysLeft} 天`
                : daysLeft === 0
                ? "今天截止"
                : `已过期 ${Math.abs(daysLeft)} 天`}
            </span>
          )}
        </>
      ) : (
        <span className="text-xs text-muted-foreground">未设置截止时间</span>
      )}
      <button
        onClick={() => {
          setValue(currentDate ?? "");
          setEditing(true);
        }}
        className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
      >
        <Pencil size={10} />
        {currentDate ? "修改" : "设置"}
      </button>
    </div>
  );
}
