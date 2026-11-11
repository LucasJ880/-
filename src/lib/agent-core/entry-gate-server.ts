/**
 * VIS-1c：按请求企业取人类对话的工具列表入口门（判定输入与路由门、岗位总览同一个加载函数）。
 */

import { loadNavigationContextForOrg } from "@/lib/navigation/context-server";
import { toolEntryGate } from "./entry-gate";
import type { ToolEntryGate } from "./types";

export async function loadToolEntryGate(
  user: { id: string; role: string | null },
  orgId: string | null,
): Promise<ToolEntryGate> {
  return toolEntryGate(await loadNavigationContextForOrg(user, orgId));
}
