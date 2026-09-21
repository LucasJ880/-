"use client";

/**
 * AI 对话附件 — 浏览器侧公共 hook（外贸助手 / 主助手 / 项目问青砚 / 收件箱共用）
 *
 * 选文件 / 拖入 / 粘贴 → 文档走 /api/ai/upload-file 解析成文本，图片走 imageEndpoint
 * （存原图 + Vision 识别）→ 芯片显示状态 → 发送时 buildPayload() 随消息提交。
 *
 * 注意：解析请求等副作用放在 setState 更新函数之外——React 开发模式（StrictMode）
 * 会把更新函数调用两次，放在里面会重复上传。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  ATTACH_MAX_FILES,
  DOC_EXTENSIONS,
  DOC_MAX_BYTES,
  IMAGE_EXTENSIONS,
  IMAGE_MAX_BYTES,
  ATTACH_HINT,
  type AttachmentKind,
  type AttachmentSummary,
  type OutgoingAttachment,
  type PendingAttachment,
} from "./types";

const EXT_BY_IMAGE_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** 粘贴的截图有时没有扩展名（或叫 image.png）——按 MIME 补一个，服务端按扩展名校验 */
function ensureImageFileName(file: File): File {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.name.includes(".") && IMAGE_EXTENSIONS.has(ext)) return file;
  const fallbackExt = EXT_BY_IMAGE_MIME[file.type] ?? "png";
  const base = file.name && file.name !== "image" ? file.name.replace(/\.[^.]*$/, "") : "截图";
  return new File([file], `${base}.${fallbackExt}`, { type: file.type });
}

export interface UseChatAttachmentsOptions {
  /** 当前组织；图片上传需要（随表单提交） */
  orgId?: string | null;
  /** 图片上传接口：存原图 + 识别，如 /api/ai/upload-image、/api/trade/chat/upload-image */
  imageEndpoint: string;
  /** 文档解析接口，默认 /api/ai/upload-file */
  docEndpoint?: string;
  /** 一条消息最多几个附件 */
  maxFiles?: number;
  /** 是否允许图片（默认允许） */
  allowImages?: boolean;
}

export interface ChatAttachmentsController {
  pending: PendingAttachment[];
  readyAttachments: PendingAttachment[];
  parsingCount: number;
  hasReady: boolean;
  isParsing: boolean;
  notice: string | null;
  addFiles: (files: FileList | File[] | null | undefined) => void;
  removePending: (id: string) => void;
  /** 发送后清空（释放预览）；不删服务端原图 */
  clear: () => void;
  /** 随消息提交的附件 */
  buildPayload: () => OutgoingAttachment[];
  /** 乐观渲染用户气泡用的摘要 */
  toSummaries: () => AttachmentSummary[];
  /** textarea onPaste：剪贴板里有文件（截图）时接管 */
  onPaste: (e: ClipboardEvent) => void;
  /** 拖拽进对话区 */
  dropZone: {
    isDragging: boolean;
    onDragEnter: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

export function useChatAttachments(options: UseChatAttachmentsOptions): ChatAttachmentsController {
  const {
    orgId,
    imageEndpoint,
    docEndpoint = "/api/ai/upload-file",
    maxFiles = ATTACH_MAX_FILES,
    allowImages = true,
  } = options;

  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  /** pending 的同步镜像：连续拖入/粘贴时上限判断不等下一次渲染 */
  const pendingRef = useRef<PendingAttachment[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const updatePending = useCallback((id: string, patch: Partial<PendingAttachment>) => {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const parseFile = useCallback(
    async (id: string, file: File, kind: AttachmentKind) => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        if (kind === "image" && orgId) formData.append("orgId", orgId);
        const endpoint = kind === "image" ? imageEndpoint : docEndpoint;
        const res = await apiFetch(endpoint, { method: "POST", body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          updatePending(id, { status: "error", error: data.error || (kind === "image" ? "识别失败" : "解析失败") });
          return;
        }
        const text = typeof data.text === "string" ? data.text : "";
        if (!text.trim()) {
          updatePending(id, {
            status: "error",
            error: kind === "image" ? "图片里没有识别出可用内容" : "没有可提取的文字（扫描件请直接传图片）",
          });
          return;
        }
        updatePending(id, {
          status: "ready",
          text,
          ...(typeof data.blobPath === "string" ? { blobPath: data.blobPath } : {}),
          ...(typeof data.fileUrl === "string" ? { fileUrl: data.fileUrl } : {}),
          ...(typeof data.mime === "string" ? { mime: data.mime } : {}),
        });
      } catch {
        updatePending(id, { status: "error", error: "网络错误，请重试" });
      }
    },
    [docEndpoint, imageEndpoint, orgId, updatePending],
  );

  const addFiles = useCallback(
    (files: FileList | File[] | null | undefined) => {
      if (!files || files.length === 0) return;
      const incoming = Array.from(files);
      const current = pendingRef.current;
      const slots = maxFiles - current.filter((p) => p.status !== "error").length;
      if (slots <= 0) {
        setNotice(`一条消息最多附 ${maxFiles} 个文件`);
        return;
      }
      const accepted = incoming.slice(0, slots);
      if (accepted.length < incoming.length) {
        setNotice(`一条消息最多附 ${maxFiles} 个文件，已忽略多余的 ${incoming.length - accepted.length} 个`);
      }
      const toParse: { id: string; file: File; kind: AttachmentKind }[] = [];
      const added: PendingAttachment[] = accepted.map((raw) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const isImage =
          raw.type.startsWith("image/") || IMAGE_EXTENSIONS.has(raw.name.split(".").pop()?.toLowerCase() ?? "");
        const file = isImage ? ensureImageFileName(raw) : raw;
        const kind: AttachmentKind = isImage ? "image" : "document";
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (isImage && !allowImages) {
          return { id, kind, name: file.name, size: file.size, status: "error", error: "此处不支持图片" };
        }
        if (isImage ? !IMAGE_EXTENSIONS.has(ext) : !DOC_EXTENSIONS.has(ext)) {
          return { id, kind, name: file.name, size: file.size, status: "error", error: `不支持的格式（${ATTACH_HINT}）` };
        }
        const maxBytes = isImage ? IMAGE_MAX_BYTES : DOC_MAX_BYTES;
        if (file.size > maxBytes) {
          return {
            id,
            kind,
            name: file.name,
            size: file.size,
            status: "error",
            error: `文件过大（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`,
          };
        }
        toParse.push({ id, file, kind });
        return {
          id,
          kind,
          name: file.name,
          size: file.size,
          status: "parsing",
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        };
      });
      pendingRef.current = [...current, ...added];
      setPending((prev) => [...prev, ...added]);
      for (const { id, file, kind } of toParse) void parseFile(id, file, kind);
    },
    [allowImages, maxFiles, parseFile],
  );

  const removePending = useCallback(
    (id: string) => {
      const target = pendingRef.current.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      // 图片原图已上传但用户不发了：尽力删掉，失败也不影响界面
      if (target?.blobPath) {
        const qs = new URLSearchParams({ path: target.blobPath });
        if (orgId) qs.set("orgId", orgId);
        void apiFetch(`${imageEndpoint}?${qs.toString()}`, { method: "DELETE" }).catch(() => undefined);
      }
      pendingRef.current = pendingRef.current.filter((p) => p.id !== id);
      setPending((prev) => prev.filter((p) => p.id !== id));
    },
    [imageEndpoint, orgId],
  );

  const clear = useCallback(() => {
    for (const p of pendingRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    pendingRef.current = [];
    setPending([]);
  }, []);

  const readyAttachments = useMemo(() => pending.filter((p) => p.status === "ready"), [pending]);
  const parsingCount = useMemo(() => pending.filter((p) => p.status === "parsing").length, [pending]);

  const buildPayload = useCallback(
    (): OutgoingAttachment[] =>
      pendingRef.current
        .filter((p) => p.status === "ready")
        .map((p) => ({
          name: p.name,
          kind: p.kind,
          size: p.size,
          text: p.text ?? "",
          ...(p.blobPath ? { blobPath: p.blobPath } : {}),
          ...(p.mime ? { mime: p.mime } : {}),
        })),
    [],
  );

  const toSummaries = useCallback(
    (): AttachmentSummary[] =>
      pendingRef.current
        .filter((p) => p.status === "ready")
        .map((p) => ({
          name: p.name,
          kind: p.kind,
          size: p.size,
          textLength: p.text?.length ?? 0,
          ...(p.fileUrl ? { fileUrl: p.fileUrl } : {}),
          ...(p.mime ? { mime: p.mime } : {}),
        })),
    [],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles],
  );

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);
  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  return {
    pending,
    readyAttachments,
    parsingCount,
    hasReady: readyAttachments.length > 0,
    isParsing: parsingCount > 0,
    notice,
    addFiles,
    removePending,
    clear,
    buildPayload,
    toSummaries,
    onPaste,
    dropZone: { isDragging, onDragEnter, onDragLeave, onDragOver, onDrop },
  };
}
