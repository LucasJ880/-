/**
 * VIS-1c：人类对话的工具列表入口门（spec agents/tool-authorization「营销工具随营销模块与品牌增长入口」）
 *
 * 营销工具（marketing_*）只在「品牌增长」入口（/marketing）对当前用户放行时进入工具列表；
 * 判定与侧栏、路由门同源（canOpenHref：平台 super_admin 一律放行，输入缺失一律不放行）。
 * 只用于人类对话入口；数字员工与后台运行不传入口门。纯模块。
 */

import { canOpenHref } from "@/lib/navigation/landing";
import type { RouteGateContext } from "@/lib/navigation/filter-context";
import type { ToolEntryGate } from "./types";

export const MARKETING_ENTRY_HREF = "/marketing";

export function toolEntryGate(ctx: RouteGateContext | null): ToolEntryGate {
  return { marketing: canOpenHref(MARKETING_ENTRY_HREF, ctx) };
}
