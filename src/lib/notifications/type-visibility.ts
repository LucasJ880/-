/**
 * VIS-1c：通知类型按「处理页面」判定可见（spec notifications/type-visibility）
 *
 * 每个类型对应收件人点开或处理这类通知的站内页面（有跳转的取落点，没跳转的取其工作区）；
 * 任一页面对当前用户经路由门放行，该类型才出现在通知设置的开关列表与通知页的类型筛选里。
 * 只影响这两处列表：通知的生成、投递、铃铛与通知页的渲染和跳转都不读这张表。
 *
 * 纯模块：无运行时副作用，客户端与测试共用。探测路径的动态段用占位 id（`_`）。
 */

import { NOTIFICATION_TYPE_KEYS } from "./constants";

/** 既有的三个隐藏类型：开关列表一直不列（与 VIS-1c 之前相同） */
export const HIDDEN_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(["runtime_failed", "evaluation_low", "feedback"]);

const TASKS = ["/tasks"] as const;
const PROJECT_DETAIL = "/projects/_";
const INSTALL_FAMILY = ["/install", "/accounting", "/blinds-orders/_"] as const;
const RFQ = ["/bids"] as const;

/** 类型 → 处理页面（design D1 对照表） */
export const NOTIFICATION_TYPE_ENTRIES: Readonly<Record<string, readonly string[]>> = {
  // 任务页登录即可 → 对所有成员可见
  task_due: TASKS,
  calendar_event: TASKS,
  followup: TASKS,
  system: TASKS,
  mention: TASKS,
  task_assigned: TASKS,
  task_status: TASKS,
  task_comment: TASKS,
  // 项目流转与情报；Muse 桥的询问 / 跟进事件也记成这个类型，发给销售（→ 询盘回复页）
  project_update: [PROJECT_DETAIL, "/projects/intelligence/monitor", "/sales/inquiries/_"],
  // 项目智能体审批与 Muse 草稿审批都在审批中心处理（详情页对全体成员放行）
  agent_approval: ["/capabilities/approvals/_"],
  // 项目 AI 标书包；效果图高清渲染完成发给销售
  agent_task: [PROJECT_DETAIL, "/sales/visualizer/_"],
  // 只发给投标项目负责人，处理在招投标流程（项目详情对会计、运营、出单也放行，不取它）
  rfq_quote_received: RFQ,
  rfq_reply_received: RFQ,
  rfq_chase_ready: RFQ,
  rfq_no_response: RFQ,
  quote_signed: ["/sales/quote-sheet"],
  sales_daily_briefing: ["/sales/home", "/sales"],
  // 按收件人分别落在会计、维修单、工艺单
  install_completed: INSTALL_FAMILY,
  install_balance_confirmed: INSTALL_FAMILY,
  install_warranty_sent: INSTALL_FAMILY,
  install_warranty_failed: INSTALL_FAMILY,
  install_repair_submitted: INSTALL_FAMILY,
  install_repair_factory_issued: INSTALL_FAMILY,
  install_repair_scheduled: INSTALL_FAMILY,
  install_repair_closed: INSTALL_FAMILY,
  install_repair_overdue: INSTALL_FAMILY,
  order_stage: ["/blinds-orders/_"],
};

export type NotificationFilterOption = { key: string; label: string; entries: readonly string[] };

/**
 * 通知页的类型筛选（「全部类型」不在此列，恒在首位）。
 * 未登记的两项按代码常量给处理页面：项目分发落项目详情；报价让利审核的收件人是超限折扣审批人，审批对象是报价单。
 */
export const NOTIFICATION_FILTER_OPTIONS: readonly NotificationFilterOption[] = [
  { key: "task_due", label: "任务截止", entries: NOTIFICATION_TYPE_ENTRIES.task_due },
  { key: "calendar_event", label: "日程", entries: NOTIFICATION_TYPE_ENTRIES.calendar_event },
  { key: "followup", label: "跟进", entries: NOTIFICATION_TYPE_ENTRIES.followup },
  { key: "project_update", label: "项目更新", entries: NOTIFICATION_TYPE_ENTRIES.project_update },
  { key: "project_dispatched", label: "项目分发", entries: [PROJECT_DETAIL] },
  { key: "quote_promotion_approval", label: "报价让利审核", entries: ["/sales/quote-sheet"] },
];

export const ALL_TYPES_FILTER = { key: "", label: "全部类型" } as const;

type CanOpen = (href: string) => boolean;

/** 对当前用户可见的已登记类型（不含三个隐藏类型），按注册表顺序 */
export function visibleNotificationTypes(canOpen: CanOpen): string[] {
  return NOTIFICATION_TYPE_KEYS.filter(
    (key) => !HIDDEN_NOTIFICATION_TYPES.has(key) && (NOTIFICATION_TYPE_ENTRIES[key] ?? []).some((href) => canOpen(href)),
  );
}

/** 通知页类型筛选：「全部类型」+ 可见项 */
export function visibleNotificationFilters(canOpen: CanOpen): { key: string; label: string }[] {
  return [
    ALL_TYPES_FILTER,
    ...NOTIFICATION_FILTER_OPTIONS.filter((o) => o.entries.some((href) => canOpen(href))).map(({ key, label }) => ({ key, label })),
  ];
}

/**
 * 开关增删：作用在完整的已开启集合上，所以列表里不出现的类型保存时原样提交（spec「隐藏类型不改偏好、不停投递」）。
 * 至少保留一个开启的类型（与改动前相同）：全部关掉时返回 null，调用方不提交。
 */
export function toggleEnabledType(enabledTypes: readonly string[], key: string): string[] | null {
  const next = new Set(enabledTypes);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  if (next.size === 0) return null;
  return [...next];
}
