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
  ChevronDown,
  ChevronRight,
  Sparkles,
  Brain,
  Target,
  Shield,
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
  parseStatus: string | null;
  aiSummaryJson: string | null;
  aiSummaryStatus: string | null;
  createdAt: string;
}

interface DocumentAiSummary {
  documentType?: string;
  title?: string | null;
  issuingParty?: string | null;
  projectName?: string | null;
  budget?: string | null;
  currency?: string | null;
  keyDates?: Array<{ label: string; date: string }>;
  technicalRequirements?: string[];
  qualificationRequirements?: string[];
  evaluationCriteria?: Array<{ criterion: string; weight: string | null }>;
  scope?: string | null;
  deliverables?: string[];
  riskFlags?: string[];
  summary?: string;
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

type ProcessingStatus = {
  active: boolean;
  step: string;
  documentTitle?: string;
  remaining: number;
};

export function ProjectFileManager({ projectId, closeDate, onProjectUpdate }: Props) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<ProcessingStatus>({
    active: false,
    step: "",
    remaining: 0,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);

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

  const processNextFile = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing({ active: true, step: "starting", remaining: 0 });

    try {
      let done = false;
      while (!done) {
        const res = await apiFetch(`/api/projects/${projectId}/files/process-next`, {
          method: "POST",
        });
        if (!res.ok) break;

        const data = await res.json();
        done = data.done;

        if (!done) {
          const stepLabel =
            data.step === "parse"
              ? "解析文件"
              : data.step === "ai_summary"
              ? "AI 摘要"
              : data.step === "intelligence"
              ? "情报分析"
              : "处理中";

          setProcessing({
            active: true,
            step: stepLabel,
            documentTitle: data.documentTitle,
            remaining: data.remaining ?? 0,
          });
          await fetchFiles();
        }
      }

      await fetchFiles();
      onProjectUpdate?.();
    } catch (err) {
      console.error("[ProcessNext]", err);
    }

    setProcessing({ active: false, step: "", remaining: 0 });
    processingRef.current = false;
  }, [projectId, fetchFiles, onProjectUpdate]);

  const retryFailed = useCallback(async () => {
    if (processingRef.current) return;
    // 第一次调用带 ?retry=1，重置失败状态
    processingRef.current = true;
    setProcessing({ active: true, step: "重置失败文件", remaining: 0 });

    try {
      const res = await apiFetch(`/api/projects/${projectId}/files/process-next?retry=1`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.done) {
          await fetchFiles();
        }
      }
    } catch {}

    processingRef.current = false;
    // 继续处理剩余文件
    processNextFile();
  }, [projectId, fetchFiles, processNextFile]);

  // 页面加载后检测是否有未处理的文件，自动开始处理
  useEffect(() => {
    if (loading || documents.length === 0) return;
    const hasPending = documents.some(
      (d) =>
        d.parseStatus === "pending" ||
        (d.parseStatus === "done" && d.aiSummaryStatus === "pending" && d.source === "upload")
    );
    if (hasPending && !processingRef.current) {
      processNextFile();
    }
  }, [loading, documents, processNextFile]);

  const handleUpload = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      setUploading(true);
      setUploadError(null);
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
          const msgs = data.errors.map((e: { name: string; reason: string }) => `${e.name}: ${e.reason}`);
          setUploadError(msgs.join("；"));
        }

        if (!res.ok && data.error) {
          setUploadError(data.error);
        }

        await fetchFiles();
        onProjectUpdate?.();

        // 上传完成后自动触发逐文件处理
        processNextFile();
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "上传失败，请重试");
      }

      setUploading(false);
      setUploadProgress([]);
    },
    [projectId, fetchFiles, onProjectUpdate, processNextFile]
  );

  const handleDelete = useCallback(
    async (fileId: string) => {
      setDeletingId(fileId);
      try {
        await apiFetch(`/api/projects/${projectId}/files/${fileId}`, {
          method: "DELETE",
        });
        await fetchFiles();
        onProjectUpdate?.();
      } catch {}
      setDeletingId(null);
    },
    [projectId, fetchFiles, onProjectUpdate]
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
  const failedCount = documents.filter(
    (d) => d.parseStatus === "failed" || d.aiSummaryStatus === "failed"
  ).length;

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

      {/* 拖拽上传区域 — 始终可见 */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          "mx-4 mt-4 rounded-lg border-2 border-dashed text-center transition-colors cursor-pointer",
          dragOver
            ? "border-accent bg-accent/5 px-6 py-8"
            : documents.length === 0
            ? "border-border/50 hover:border-border px-6 py-8"
            : "border-border/30 hover:border-border/60 px-4 py-3"
        )}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        {documents.length === 0 || dragOver ? (
          <>
            <Upload
              className={cn(
                "mx-auto h-8 w-8",
                dragOver ? "text-accent" : "text-muted-foreground/40"
              )}
            />
            <p className="mt-2 text-sm font-medium text-foreground">
              {dragOver ? "松开即可上传" : "拖拽文件到这里，或点击上传"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              支持 PDF、Word、Excel、图片等，最大 20MB
            </p>
          </>
        ) : (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Upload size={14} />
            <span className="text-xs">拖拽或点击此处上传更多文件</span>
          </div>
        )}
      </div>

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

      {/* AI 处理进度 */}
      {processing.active && (
        <div className="mx-4 mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-violet-600">
            <Loader2 size={12} className="animate-spin" />
            <span>
              {processing.step}
              {processing.documentTitle ? `：${processing.documentTitle}` : ""}
            </span>
          </div>
          {processing.remaining > 0 && (
            <p className="mt-1 text-[10px] text-violet-500/70">
              还剩 {processing.remaining} 个文件待处理
            </p>
          )}
        </div>
      )}

      {/* 失败文件重试 */}
      {failedCount > 0 && !processing.active && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
          <AlertTriangle size={13} className="shrink-0 text-red-500" />
          <span className="flex-1 text-xs text-red-600">
            {failedCount} 个文件处理失败
          </span>
          <button
            onClick={retryFailed}
            className="flex items-center gap-1 rounded-md bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-500/20 transition-colors"
          >
            重新处理
          </button>
        </div>
      )}

      {/* 上传错误提示 */}
      {uploadError && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-500" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-red-600">上传遇到问题</p>
            <p className="mt-0.5 text-[10px] text-red-500/80">{uploadError}</p>
          </div>
          <button
            onClick={() => setUploadError(null)}
            className="shrink-0 p-0.5 text-red-400 hover:text-red-600"
          >
            <X size={12} />
          </button>
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
  const [expanded, setExpanded] = useState(false);
  const { icon: Icon, color } = getFileIcon(doc.fileType);
  const isExternal = doc.source !== "upload";
  const hasSummary = doc.aiSummaryStatus === "done" && doc.aiSummaryJson;
  const summaryGenerating = doc.aiSummaryStatus === "generating";

  const summary: DocumentAiSummary | null = hasSummary
    ? (() => { try { return JSON.parse(doc.aiSummaryJson!) as DocumentAiSummary; } catch { return null; } })()
    : null;

  return (
    <div className="rounded-lg border border-border/30 bg-background hover:border-border/60 transition-colors">
      <div className="group flex items-center gap-3 px-3 py-2.5">
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
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
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
            {doc.parseStatus === "parsing" && (
              <>
                <span>·</span>
                <span className="text-accent flex items-center gap-0.5">
                  <Loader2 size={8} className="animate-spin" /> 解析中
                </span>
              </>
            )}
            {doc.parseStatus === "done" && doc.source === "upload" && !hasSummary && !summaryGenerating && (
              <>
                <span>·</span>
                <span className="text-emerald-500 flex items-center gap-0.5">
                  <CheckCircle2 size={8} /> AI 可读
                </span>
              </>
            )}
            {summaryGenerating && (
              <>
                <span>·</span>
                <span className="text-violet-500 flex items-center gap-0.5">
                  <Loader2 size={8} className="animate-spin" /> AI 摘要生成中
                </span>
              </>
            )}
            {hasSummary && summary && (
              <>
                <span>·</span>
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-violet-500 flex items-center gap-0.5 hover:text-violet-600 transition-colors"
                >
                  <Sparkles size={8} />
                  AI 摘要
                  {expanded ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
                </button>
              </>
            )}
            {doc.parseStatus === "failed" && (
              <>
                <span>·</span>
                <span className="text-red-400 flex items-center gap-0.5">
                  <AlertTriangle size={8} /> 解析失败
                </span>
              </>
            )}
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

      {/* AI 摘要展开区 */}
      {expanded && summary && (
        <div className="border-t border-border/20 px-3 py-3 bg-violet-500/[0.03]">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={12} className="text-violet-500" />
            <span className="text-[11px] font-medium text-violet-600">AI 文档摘要</span>
            {summary.documentType && (
              <span className="ml-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] font-medium text-violet-600">
                {summary.documentType}
              </span>
            )}
          </div>

          {summary.summary && (
            <p className="text-xs text-foreground/80 mb-2.5 leading-relaxed">{summary.summary}</p>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
            {summary.issuingParty && (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">发文方:</span>
                <span className="text-foreground font-medium">{summary.issuingParty}</span>
              </div>
            )}
            {summary.projectName && (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">项目:</span>
                <span className="text-foreground font-medium">{summary.projectName}</span>
              </div>
            )}
            {summary.budget && (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">预算:</span>
                <span className="text-foreground font-medium">{summary.budget} {summary.currency || ""}</span>
              </div>
            )}
            {summary.scope && (
              <div className="col-span-2 flex items-start gap-1.5">
                <span className="text-muted-foreground shrink-0">范围:</span>
                <span className="text-foreground">{summary.scope}</span>
              </div>
            )}
          </div>

          {summary.keyDates && summary.keyDates.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1 mb-1">
                <Clock size={10} className="text-amber-500" />
                <span className="text-[10px] font-medium text-muted-foreground">关键日期</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {summary.keyDates.map((kd, i) => (
                  <span key={i} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-700">
                    {kd.label}: {kd.date}
                  </span>
                ))}
              </div>
            </div>
          )}

          {summary.technicalRequirements && summary.technicalRequirements.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1 mb-1">
                <Target size={10} className="text-blue-500" />
                <span className="text-[10px] font-medium text-muted-foreground">技术要求 ({summary.technicalRequirements.length})</span>
              </div>
              <ul className="space-y-0.5">
                {summary.technicalRequirements.slice(0, 5).map((req, i) => (
                  <li key={i} className="text-[10px] text-foreground/80 pl-3 relative before:absolute before:left-0 before:top-[6px] before:h-1 before:w-1 before:rounded-full before:bg-blue-400">
                    {req}
                  </li>
                ))}
                {summary.technicalRequirements.length > 5 && (
                  <li className="text-[10px] text-muted-foreground pl-3">
                    ...还有 {summary.technicalRequirements.length - 5} 项
                  </li>
                )}
              </ul>
            </div>
          )}

          {summary.evaluationCriteria && summary.evaluationCriteria.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1 mb-1">
                <Brain size={10} className="text-emerald-500" />
                <span className="text-[10px] font-medium text-muted-foreground">评分标准</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {summary.evaluationCriteria.map((ec, i) => (
                  <span key={i} className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-700">
                    {ec.criterion}{ec.weight ? ` (${ec.weight})` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}

          {summary.riskFlags && summary.riskFlags.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1 mb-1">
                <Shield size={10} className="text-red-500" />
                <span className="text-[10px] font-medium text-muted-foreground">风险提示</span>
              </div>
              <ul className="space-y-0.5">
                {summary.riskFlags.map((rf, i) => (
                  <li key={i} className="text-[10px] text-red-600/80 pl-3 relative before:absolute before:left-0 before:top-[6px] before:h-1 before:w-1 before:rounded-full before:bg-red-400">
                    {rf}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
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
