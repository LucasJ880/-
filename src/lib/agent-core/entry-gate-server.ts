/**
 * VIS-1c：按请求企业取人类对话的工具列表入口门（判定输入与路由门、岗位总览同一个加载函数）。
 */

import { loadNavigationContextForOrg } from "@/lib/navigation/context-server";
import { isMailReadAllowed } from "@/lib/env/runtime-isolation";
import { toolEntryGate, type ToolEntrySurface } from "./entry-gate";
import type { ToolEntryGate } from "./types";

/**
 * MAIL-1：第三个参数由入口自报身份。只有网页助手对话的消息接口传 `{ surface: "web_assistant" }`，
 * 其它入口（Agent Core 对话、微信对话、工具列表接口）不传，拿到的入口门里没有 mail。
 */
export async function loadToolEntryGate(
  user: { id: string; role: string | null },
  orgId: string | null,
  opts?: { surface?: ToolEntrySurface },
): Promise<ToolEntryGate> {
  return toolEntryGate(await loadNavigationContextForOrg(user, orgId), {
    surface: opts?.surface,
    mailReadEnabled: isMailReadAllowed(),
  });
}
