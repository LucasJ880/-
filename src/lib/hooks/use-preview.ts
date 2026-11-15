"use client";

/**
 * VIS-1e 以岗位预览（spec authorization/position-preview「预览只读」「横幅与失效」）：
 * 预览中（含已失效、尚未退出）写请求都会被代理拒绝，客户端据此不发自动写请求、禁用 AI 对话输入。
 */

import { useCurrentUser, type CurrentUserPreview } from "@/lib/hooks/use-current-user";

export const PREVIEW_CHAT_DISABLED_HINT = "预览中为只读，不能发消息";

export function usePreviewInfo(): CurrentUserPreview | null {
  return useCurrentUser().user?.preview ?? null;
}

export function usePreviewReadonly(): boolean {
  return usePreviewInfo() !== null;
}
