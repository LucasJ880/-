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
/** MAIL-1：读信工具的受众 = 邮箱绑定页的受众（同一个放行判定） */
export const MAIL_ENTRY_HREF = "/settings/email";

/** 调用入口门的入口自报身份；只有网页助手对话才可能拿到读信工具 */
export type ToolEntrySurface = "web_assistant";

export type ToolEntryGateOptions = {
  surface?: ToolEntrySurface;
  /** 读信开关（MAIL_READ_ENABLED）是否已开；由服务端加载函数读环境变量后传入，本模块保持纯 */
  mailReadEnabled?: boolean;
};

/**
 * mail 一项只在「网页助手入口 ∧ 读信开关开」时才计算并写进结果；其它情况结果里没有这个键
 * （与改动前的返回完全相同），读信工具按「非 true 即不可用」处理。
 */
export function toolEntryGate(ctx: RouteGateContext | null, opts?: ToolEntryGateOptions): ToolEntryGate {
  const gate: ToolEntryGate = { marketing: canOpenHref(MARKETING_ENTRY_HREF, ctx) };
  if (opts?.surface === "web_assistant" && opts.mailReadEnabled === true) {
    gate.mail = canOpenHref(MAIL_ENTRY_HREF, ctx);
  }
  return gate;
}
