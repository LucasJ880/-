/**
 * 外贸 AI 对话附件 — 现为公共核心 src/lib/chat-attachments/core.ts 的薄封装，
 * 保留原 import 路径与外贸专用的 Blob 根（trade-chat/）。
 */

export * from "@/lib/chat-attachments/core";
import {
  chatImageBlobPrefix,
  TRADE_CHAT_BLOB_ROOT,
  type ChatAttachment,
  type ChatAttachmentKind,
  type ChatAttachmentSummary,
} from "@/lib/chat-attachments/core";

/** @deprecated 用 ChatAttachment（保留旧名兼容） */
export type TradeChatAttachment = ChatAttachment;
export type TradeChatAttachmentKind = ChatAttachmentKind;
export type TradeChatAttachmentSummary = ChatAttachmentSummary;

/** 外贸对话图片原图的 Blob 路径前缀：trade-chat/{orgId}/{userId}/ */
export function tradeChatImageBlobPrefix(orgId: string, userId: string): string {
  return chatImageBlobPrefix(TRADE_CHAT_BLOB_ROOT, orgId, userId);
}
