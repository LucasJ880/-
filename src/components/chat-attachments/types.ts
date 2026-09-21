/** AI 对话附件 — 浏览器侧类型（与 src/lib/chat-attachments/core.ts 的服务端形状对应） */

export type AttachmentKind = "document" | "image";

/** 服务端回给浏览器的附件摘要（不带正文） */
export interface AttachmentSummary {
  name: string;
  kind?: AttachmentKind;
  size: number;
  textLength: number;
  /** 图片原图（经 /api/files 代理）：气泡里显示缩略图 */
  fileUrl?: string;
  mime?: string;
}

/** 输入框里待发送的附件：先经解析 / 识别接口转成文本 */
export interface PendingAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  size: number;
  status: "parsing" | "ready" | "error";
  text?: string;
  error?: string;
  /** 图片的本地预览（object URL，发送/移除时释放） */
  previewUrl?: string;
  /** 图片原图已存到私有 Blob 的路径 / 代理 URL（上传接口返回） */
  blobPath?: string;
  fileUrl?: string;
  mime?: string;
}

/** 随消息提交给服务端的附件 */
export interface OutgoingAttachment {
  name: string;
  kind: AttachmentKind;
  size: number;
  text: string;
  blobPath?: string;
  mime?: string;
}

export const DOC_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"]);
export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
export const ATTACH_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp";
export const ATTACH_MAX_FILES = 5;
/** 与 /api/ai/upload-file 上限一致 */
export const DOC_MAX_BYTES = 10 * 1024 * 1024;
/** 与 upload-image 接口上限一致 */
export const IMAGE_MAX_BYTES = 6 * 1024 * 1024;
export const ATTACH_HINT = "支持 PDF、Word、Excel、CSV、TXT 和 PNG/JPG/WebP 图片";

export function formatBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatChars(n: number): string {
  if (n < 1000) return `${n} 字符`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k 字符`;
}
