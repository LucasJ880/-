/**
 * MAIL-2 页面用的纯函数（邮箱绑定页的「客户来信提醒」、客户时间线的「让助手读这封信」）。
 * 客户端组件会引用本文件：不要在这里引入服务端模块。spec mail/inbound-watch
 */

/** 来信观察建的互动在 analysisResult.sourceRef.kind 上的标记 */
export const MAIL_WATCH_SOURCE_KIND = "mail_watch";

/** 成员勾选接口（GET /api/sales/mail-watch/opt-in）的返回 */
export interface MailWatchOptInStatus {
  /** 组织开关 */
  orgEnabled: boolean;
  /** 本人是否已勾选 */
  optedIn: boolean;
  /** 本人是否已连接 Gmail */
  gmailConnected: boolean;
  /** 本人的授权是否含读信权限 */
  hasReadScope: boolean;
  /** 本人能否改组织开关（企业管理员 / 平台 super_admin） */
  canManageOrg: boolean;
}

export type MailWatchCheckboxState = "hidden" | "disabled_org_off" | "enabled";

export interface MailWatchPanelState {
  /** 整块是否显示（平台开关关 → 接口 404 → status 为 null → 不显示） */
  visible: boolean;
  checkbox: MailWatchCheckboxState;
  checked: boolean;
  /** 可勾选但读不了信：提示先连接 Google 或重新授权 */
  hint: "needs_google" | "needs_reauth" | null;
  /** 企业管理员才看到组织开关 */
  showOrgSwitch: boolean;
  orgEnabled: boolean;
}

/** 邮箱绑定页显示哪种状态。status 为 null = 平台开关关闭或接口不可用 → 整块不显示 */
export function mailWatchPanelState(status: MailWatchOptInStatus | null | undefined): MailWatchPanelState {
  if (!status) {
    return { visible: false, checkbox: "hidden", checked: false, hint: null, showOrgSwitch: false, orgEnabled: false };
  }
  return {
    visible: true,
    checkbox: status.orgEnabled ? "enabled" : "disabled_org_off",
    checked: status.optedIn,
    hint: !status.gmailConnected ? "needs_google" : !status.hasReadScope ? "needs_reauth" : null,
    showOrgSwitch: status.canManageOrg,
    orgEnabled: status.orgEnabled,
  };
}

/** 这条互动是不是来信观察建的 */
export function isMailWatchInteraction(interaction: { analysisResult?: unknown } | null | undefined): boolean {
  const ref = (interaction?.analysisResult as { sourceRef?: { kind?: unknown } } | null | undefined)?.sourceRef;
  return ref?.kind === MAIL_WATCH_SOURCE_KIND;
}

/** 这封信的收信时间：来信观察记在 sourceRef.receivedAt（Gmail 的收信时间）；没有或不合法时退回互动的创建时间 */
export function mailWatchReceivedAt(interaction: { analysisResult?: unknown; createdAt: string | Date }): string | Date {
  const ref = (interaction.analysisResult as { sourceRef?: { receivedAt?: unknown } } | null | undefined)?.sourceRef;
  const at = typeof ref?.receivedAt === "string" ? ref.receivedAt : null;
  return at && !Number.isNaN(new Date(at).getTime()) ? at : interaction.createdAt;
}

/**
 * 「让助手读这封信」是否显示：读信开关开（状态接口带 mailRead.enabled）、助手页对本人放行、且这条是来信观察建的。
 * 助手页不放行的人（比如岗位模式下只有销售岗位的成员，路由门会把 /assistant 重定向走）点了也到不了，所以不显示。
 */
export function showReadMailEntry(input: {
  mailReadEnabled: boolean | undefined;
  assistantOpen: boolean | undefined;
  interaction: { analysisResult?: unknown } | null | undefined;
}): boolean {
  return input.mailReadEnabled === true && input.assistantOpen === true && isMailWatchInteraction(input.interaction);
}

/** 客户名进预填文字前：去换行与控制字符、去引号、至多 40 字（客户名是成员录入的，不是邮件里的文字） */
function plainName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f"“”「」]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

/**
 * 助手的预填文字：只有客户名与来信日期。不含主题或任何来自邮件的文字——
 * 那会让发信人写的字变成用户发给助手的话。
 */
export function readMailPrompt(input: { customerName: string; receivedAt: string | Date; timeZone?: string }): string {
  const at = new Date(input.receivedAt);
  const name = plainName(input.customerName) || "这位客户";
  if (Number.isNaN(at.getTime())) return `帮我读一下${name}最近发来的邮件`;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: input.timeZone || "America/Toronto",
    month: "numeric",
    day: "numeric",
  }).formatToParts(at);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `帮我读一下${name}在 ${month} 月 ${day} 日发来的邮件`;
}

/** 入口链接：打开助手并预填（由用户自己发送） */
export function readMailHref(input: { customerName: string; receivedAt: string | Date; timeZone?: string }): string {
  return `/assistant?prompt=${encodeURIComponent(readMailPrompt(input))}`;
}
