/**
 * 通知跳转地址（COLLAB-2 design D11，spec notifications/click-targets）
 *
 * 顶栏铃铛、通知页与邮件链接共用这一张对照表（此前铃铛与通知页各有一份，已经漂移）。
 * 纯函数；"记住所选组织"的副作用留在各自的组件里，这里只判断该记哪个组织。
 *
 * 取用顺序（取第一条有结果的规则）：
 * 1. 安装、尾款、质保、返修类通知：installNotificationHref（与本次之前相同）；
 * 2. 按 entityType：协作对象、业务对象、销售与营收对象；
 * 3. 带项目与活动：/projects/{projectId}?activity={activityId}；
 * 4. 带项目：/projects/{projectId}。
 * 都没有 → null（没有跳转地址）。地址里的 id 都做 URL 编码。
 */

import { installNotificationHref } from "@/lib/install/balance";

export const PROJECT_DISCUSSION_HASH = "#project-discussion";

export interface NotificationLinkTarget {
  type?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  projectId?: string | null;
  activityId?: string | null;
  orgId?: string | null;
}

const enc = encodeURIComponent;

function entityHref(item: NotificationLinkTarget): string | null {
  const id = item.entityId ? enc(item.entityId) : null;
  const projectId = item.projectId ? enc(item.projectId) : null;
  switch (item.entityType) {
    // 协作对象
    case "task":
      return id && `/tasks?open=${id}`;
    case "project_discussion":
      return projectId && `/projects/${projectId}?tab=workbench${PROJECT_DISCUSSION_HASH}`;
    case "project_files":
      return projectId && `/projects/${projectId}?tab=files`;
    case "project":
      return id && `/projects/${id}`;
    // 业务对象
    case "blinds_order":
      return id && `/blinds-orders/${id}`;
    case "approval":
      return id && `/capabilities/approvals/${id}`;
    case "trade_prospect":
      return id && `/trade/prospects/${id}`;
    case "trade_booth_summary":
      return id && `/trade/booth-cards?day=${id}`;
    // 销售与营收对象
    case "muse_inquiry":
      return id && `/sales/inquiries/${id}`;
    case "sales_quote":
      return id && `/sales/quote-sheet?mode=order&quoteId=${id}${item.orgId ? `&orgId=${enc(item.orgId)}` : ""}`;
    case "sales_customer":
      return id && `/sales/customers/${id}`;
    case "sales_actions":
      return "/sales?view=customers";
    case "visualizer_session":
      return id && `/sales/visualizer/${id}`;
    case "revenue_opportunity":
      return id && `/revenue/${id}`;
    default:
      return null;
  }
}

export function notificationHref(item: NotificationLinkTarget): string | null {
  const installHref = installNotificationHref(item);
  if (installHref) return installHref;
  const href = entityHref(item);
  if (href) return href;
  if (item.projectId && item.activityId) {
    return `/projects/${enc(item.projectId)}?activity=${enc(item.activityId)}`;
  }
  if (item.projectId) return `/projects/${enc(item.projectId)}`;
  return null;
}

/** 打开前要记住的所选组织：安装类、报价、审批、展会小结与销售 / 营收对象（与通知页此前的规则相同） */
const ORG_SCOPED_ENTITY_TYPES = new Set([
  "sales_quote",
  "approval",
  "trade_booth_summary",
  "revenue_opportunity",
  "sales_customer",
  "sales_actions",
  "visualizer_session",
]);

export function notificationOrgToRemember(item: NotificationLinkTarget): string | null {
  if (!item.orgId) return null;
  if (installNotificationHref(item)) return item.orgId;
  return item.entityType && ORG_SCOPED_ENTITY_TYPES.has(item.entityType) ? item.orgId : null;
}
