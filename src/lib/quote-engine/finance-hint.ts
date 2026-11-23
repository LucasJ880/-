/**
 * CHAIN-2e 报价引擎没有权限时的白话说明（纯模块：客户端组件 import；不读库、不 import next/server）。
 * 「谁能看、找谁」与 CHAIN-2b 报价表助手同一句（经 project-finance/view-hint 的 financeHiddenHintZh），只换前面的对象；
 * 没有真人负责人（负责人是导入用的系统账号）、授权查询出错时换成对应的那一句。
 */
import { financeHiddenHintZh, NO_OWNER_NEXT_STEP_ZH, UNCONFIRMED_HINT_ZH } from "@/lib/project-finance/view-hint";

/** 接口 capabilities 里的 hintReason：默认（没有权限、有负责人）时不带 */
export type QuoteHintReason = "no_owner" | "unconfirmed";

/** 「报价与成本」卡、投标页报价区、「我方报价」卡、单个报价页：没有财务查看权时（默认那句） */
export const QUOTE_COST_HIDDEN_HINT_ZH = financeHiddenHintZh("估算成本和毛利率");

/** 不能新建 / 修改 / 批准报价时（canEdit = false 的人一定不是负责人：负责人直通）——下一步：请人把你设为主负责人 */
export const QUOTE_EDIT_HIDDEN_HINT_ZH = "你不是本项目负责人，不能新建、修改或批准报价。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。";

/** 同上，项目还没有真人负责人时 */
export const QUOTE_EDIT_NO_OWNER_HINT_ZH = `你不是本项目负责人，不能新建、修改或批准报价。${NO_OWNER_NEXT_STEP_ZH}`;

/** 单个报价页读取失败时，后面接接口给的原因 */
export const QUOTE_LOAD_FAILED_PREFIX_ZH = "打不开这个报价：";

/** 单个报价页保存被拒（403）：不重新读取、填的内容留在页面上 */
export const QUOTE_SAVE_FORBIDDEN_ZH = "没有保存：你现在没有修改这份报价的权限（权限可能刚被调整，或暂时无法确认）。填的内容还留在页面上，可以先复制下来；刷新页面后再试，或找项目负责人。";

export type QuoteHintCaps = { canViewInternal: boolean; canEdit?: boolean; hintReason?: QuoteHintReason };

/**
 * 该显示哪几句：edit = 这个位置要说明「为什么不能新建 / 修改 / 批准」（只在 canEdit === false 时出）；
 * cost = 这个位置要说明「为什么看不到估算成本和毛利率」（只在 canViewInternal === false 时出）。同一句只出一次。
 */
export function quoteHintLinesZh(caps: QuoteHintCaps, show: { edit: boolean; cost: boolean }): Array<{ kind: "edit" | "cost"; text: string }> {
  const out: Array<{ kind: "edit" | "cost"; text: string }> = [];
  if (show.edit && caps.canEdit === false) {
    out.push({ kind: "edit", text: caps.hintReason === "unconfirmed" ? UNCONFIRMED_HINT_ZH : caps.hintReason === "no_owner" ? QUOTE_EDIT_NO_OWNER_HINT_ZH : QUOTE_EDIT_HIDDEN_HINT_ZH });
  }
  if (show.cost && !caps.canViewInternal) {
    out.push({ kind: "cost", text: financeHiddenHintZh("估算成本和毛利率", caps.hintReason ?? "no_access") });
  }
  return out.filter((l, i) => out.findIndex((x) => x.text === l.text) === i);
}
