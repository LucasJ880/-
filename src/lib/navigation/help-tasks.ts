/**
 * NAV-1b：/help 顶部的「我想做什么」（spec navigation/entry-visibility「/help 顶部的『我想做什么』」「『我想做什么』的外贸内容」）。
 *
 * 每行绑定一个导航入口 key，并属于一个业务模块：企业没开这个模块、或该入口对当前用户侧栏不可见时，整行不出现。
 * （只看入口可见还不够：「邮箱绑定」「成员与组织」「知识库」窗饰企业的成员也看得到，但这些行讲的是外贸的做法。）
 * 「进去后」只写目标页面上实际存在的栏目与按钮——用「」括起来的名称由 entry-visibility.test.ts 对着页面源码核对，
 * 页面改了按钮名，这里要跟着改。
 *
 * 本期只有外贸内容（任务书 NAV-1b）；窗饰内容见后续 NAV-2。
 */

import { isModuleEnabled, type OrgModule, type OrgModulesConfig } from "@/lib/tenancy/modules";

export type HelpTask = {
  /** 这一行讲的是哪个业务模块的做法；企业未开该模块时不出现 */
  module: OrgModule;
  /** 我想… */
  want: string;
  /** 点哪里：导航入口 key（名称与链接由入口决定） */
  entryKey: string;
  /** 进去后 */
  then: string;
};

export const HELP_TASKS: readonly HelpTask[] = [
  { module: "trade", want: "看今天要处理什么", entryKey: "biz-revenue-today", then: "四栏：「今日新询盘」「回复超时」「待审批回复」「样品与报价到期」" },
  // NAV-1c 合并时补回任务书原文：…点「查看回复草稿」或「写回复」…
  { module: "trade", want: "回复买家", entryKey: "biz-inbox", then: "找到买家，点「查看回复草稿」，改好后点「发送邮件」" },
  // NAV-1c 合并时补回任务书原文：…不想用就去询盘收件箱自己写
  { module: "trade", want: "批准 AI 写好的回复", entryKey: "biz-revenue-today", then: "在「待审批回复」里先点「查看草稿」，再点「批准发送」" },
  { module: "trade", want: "已经在邮箱或 WhatsApp 回过了", entryKey: "biz-inbox", then: "点「已回复，标记」，系统不再催" },
  { module: "trade", want: "查一个买家的全部往来", entryKey: "biz-prospects", then: "点开买家，看「对话记录」" },
  { module: "trade", want: "给买家报价", entryKey: "biz-trade-quotes", then: "点「新建报价」；询盘收件箱里每个买家也有「新建报价」" },
  { module: "trade", want: "寄样并盯回音", entryKey: "biz-trade-samples", then: "点「新建寄样」；只记底账、不自动发邮件，寄出 5 个工作日后提醒跟进" },
  { module: "trade", want: "查货号、价格、起订量", entryKey: "biz-trade-products", then: "在售货号、FOB 价、起订量和交期" },
  { module: "trade", want: "展会回来批量录名片", entryKey: "biz-trade-import", then: "上传 CSV 或 Excel" },
  { module: "trade", want: "让 AI 回得更准", entryKey: "mgmt-knowledge", then: "用「手动添加」写一条，或用「导入 MD / ZIP」批量导入" },
  { module: "trade", want: "绑定发信邮箱", entryKey: "sales-email-settings", then: "按页面提示绑定" },
  { module: "trade", want: "加同事、调岗位", entryKey: "mgmt-orgs", then: "点开企业能看到成员名单；加人和调岗位由平台管理员操作" },
];

/** 对当前用户出现的行：企业开了这一行所属的模块（与导航同口径），且绑定的入口在其侧栏可见入口里 */
export function visibleHelpTasks(visibleEntryKeys: ReadonlySet<string>, modules: OrgModulesConfig | null | undefined): HelpTask[] {
  return HELP_TASKS.filter((t) => isModuleEnabled(modules, t.module) && visibleEntryKeys.has(t.entryKey));
}
