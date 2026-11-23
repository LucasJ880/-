/**
 * CHAIN-2e：没有财务查看权时的白话说明（纯模块：客户端组件也 import；不读库）。
 * 报价引擎、比价面板、询价追踪页同一规则：
 * - no_access（默认）：「X只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」——与 CHAIN-2b 同一句
 * - no_owner：项目负责人是导入用的系统账号（没有真人负责人）→「需要的话请找项目负责人」换成「这个项目还没有指定负责人，……」
 * - mixed：追踪页上被隐藏的几行里，有的项目有负责人、有的没有
 * - unconfirmed：授权查询出错、按兜底收紧了——不能说成「没有权限」，只说暂时无法确认
 */
import { COST_ACCESS_HINT_ZH } from "@/lib/tender-pricing/finance-view";

export type FinanceHintReason = "no_access" | "no_owner" | "mixed" | "unconfirmed";

/** 谁能看（与 COST_ACCESS_HINT_ZH 的前半句逐字相同；测试核对） */
export const WHO_CAN_SEE_ZH = "只给项目负责人和有全企业「查看项目结算」权限的人看；";
/** 找谁（与 COST_ACCESS_HINT_ZH 的后半句逐字相同） */
export const ASK_OWNER_ZH = "需要的话请找项目负责人。";
/** 没有真人负责人时的下一步 */
export const NO_OWNER_NEXT_STEP_ZH = "这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人。";
/** 授权查询出错时 */
export const UNCONFIRMED_HINT_ZH = "暂时无法确认你的查看权限，请稍后刷新。";

/** subject：被藏起来的东西，如「落地价」「估算成本和毛利率」 */
export function financeHiddenHintZh(subject: string, reason: FinanceHintReason = "no_access"): string {
  switch (reason) {
    case "unconfirmed":
      return UNCONFIRMED_HINT_ZH;
    case "no_owner":
      return `${subject}${WHO_CAN_SEE_ZH}${NO_OWNER_NEXT_STEP_ZH}`;
    case "mixed":
      return `${subject}${WHO_CAN_SEE_ZH}需要的话请找项目负责人；还没有指定负责人的项目，请找组织管理员在项目成员里把做报价的同事设为主负责人。`;
    default:
      return `${subject}${COST_ACCESS_HINT_ZH}`;
  }
}

/** 纯决策：为什么看不到。授权查询出错优先（不冒充「没有权限」），其次看有没有真人负责人 */
export function financeHintReason(input: { unconfirmed: boolean; ownerAssigned: boolean }): Exclude<FinanceHintReason, "mixed"> {
  if (input.unconfirmed) return "unconfirmed";
  return input.ownerAssigned ? "no_access" : "no_owner";
}

/** 接口里带的原因：默认（no_access）不带。只在看的人缺权限（看不到或不能编辑）时才算原因，所以完整权限的人返回形状与改动前相同 */
export type FinanceHintReasonField = { hintReason?: Exclude<FinanceHintReason, "no_access"> };
export function hintReasonField(reason: FinanceHintReason): FinanceHintReasonField {
  return reason === "no_access" ? {} : { hintReason: reason };
}
