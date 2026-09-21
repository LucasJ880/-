/**
 * 对话图片附件上传的公共处理（各对话产品线的 upload-image 路由共用）：
 * 校验（扩展名 / 魔数 / 大小）→ 原图存私有 Blob（{root}{orgId}/{userId}/…）→ Vision 识别成文本。
 * 识别失败会回滚删除刚上传的原图。
 */

import { validateUploadedFileAsync } from "@/lib/files/upload-guard";
import { deleteBlob, putPrivateBlob } from "@/lib/files/blob-access";
import { describeImageForChat } from "@/lib/ai/image-to-text";
import {
  attachmentBlobPathBelongsTo,
  chatImageBlobPrefix,
  type ChatBlobRoot,
} from "./core";

export const CHAT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
export const CHAT_IMAGE_ALLOWED_EXT = ["png", "jpg", "jpeg", "webp"];
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export interface ChatImageUploadBody {
  name: string;
  kind: "image";
  size: number;
  mime: string;
  text: string;
  textLength: number;
  blobPath: string;
  fileUrl: string;
}

export type ChatImageUploadResult =
  | { ok: true; body: ChatImageUploadBody }
  | { ok: false; status: number; error: string };

export async function processChatImageUpload(input: {
  file: File;
  orgId: string;
  userId: string;
  root: ChatBlobRoot;
}): Promise<ChatImageUploadResult> {
  const check = await validateUploadedFileAsync(input.file, {
    maxSize: CHAT_IMAGE_MAX_BYTES,
    allowedExtensions: CHAT_IMAGE_ALLOWED_EXT,
    allowedMimeTypes: Object.values(MIME_BY_EXT),
    checkMagicBytes: true,
  });
  if (!check.ok) return { ok: false, status: 400, error: check.reason };
  // 魔数已校验；MIME 以扩展名为准，避免浏览器给的 octet-stream 进到 data URL / 代理响应头
  const mime = MIME_BY_EXT[check.ext] ?? check.mime;

  const blobPath = `${chatImageBlobPrefix(input.root, input.orgId, input.userId)}${Date.now()}_${check.safeName}`;
  let proxyUrl: string;
  try {
    const blob = await putPrivateBlob({ pathname: blobPath, body: check.buffer, contentType: mime });
    proxyUrl = blob.proxyUrl;
  } catch (e) {
    console.error("[chat-attachments/upload-image] blob put failed:", e);
    return { ok: false, status: 502, error: "图片存储失败，请稍后再试" };
  }

  try {
    const { text } = await describeImageForChat({ buffer: check.buffer, mime, fileName: input.file.name });
    if (!text.trim()) {
      await deleteBlob(blobPath).catch(() => undefined);
      return { ok: false, status: 422, error: "图片里没有识别出可用内容" };
    }
    return {
      ok: true,
      body: {
        name: input.file.name,
        kind: "image",
        size: input.file.size,
        mime,
        text,
        textLength: text.length,
        blobPath,
        fileUrl: proxyUrl,
      },
    };
  } catch (err) {
    console.error("[chat-attachments/upload-image] vision failed:", err);
    await deleteBlob(blobPath).catch(() => undefined);
    return { ok: false, status: 502, error: "图片识别失败，请稍后再试" };
  }
}

/** 用户发送前移除了图片芯片 → 删掉刚上传的原图；只允许删本 org + 本人前缀下的对象 */
export async function deleteOwnChatImage(input: {
  path: string;
  orgId: string;
  userId: string;
  root: ChatBlobRoot;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const path = input.path.trim();
  const own = chatImageBlobPrefix(input.root, input.orgId, input.userId);
  if (!path.startsWith(own) || !attachmentBlobPathBelongsTo(path, input.orgId) || path.includes("..")) {
    return { ok: false, error: "路径不合法" };
  }
  await deleteBlob(path).catch(() => undefined);
  return { ok: true };
}
