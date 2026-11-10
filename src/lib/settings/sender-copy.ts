/**
 * VIS-1c：发信文案按企业设置（spec settings/sender-copy）
 *
 * 企业设置 `Organization.settingsJson.ui.senderCopy`（既有 JSON 位，零 schema）只认一个值 `platform_relay`：
 * 该企业的询盘通知与跟进邮件走平台发信通道，`/settings` 与 `/settings/email` 显示代发说明、不显示 Gmail / SMTP 绑定。
 * 缺省或其他值 → 标准邮箱绑定。纯模块：页面、企业列表接口、回填脚本与测试共用。
 */

export const SENDER_COPY_PLATFORM_RELAY = "platform_relay" as const;
export type SenderCopyMode = typeof SENDER_COPY_PLATFORM_RELAY;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

/** 读企业设置里的发信文案模式；只透出已知值，其余一律 null */
export function readSenderCopy(settingsJson: unknown): SenderCopyMode | null {
  const ui = asObject(asObject(settingsJson)?.ui);
  return ui?.senderCopy === SENDER_COPY_PLATFORM_RELAY ? SENDER_COPY_PLATFORM_RELAY : null;
}

/**
 * 写发信文案模式，返回新的 settingsJson（不改入参）：
 * - `platform_relay`：设置 `ui.senderCopy`，保留其他键；
 * - `clear`：只删 `ui.senderCopy`，`ui` 因此为空时删掉 `ui`。
 */
export function withSenderCopy(settingsJson: unknown, mode: SenderCopyMode | "clear"): JsonObject {
  const settings: JsonObject = { ...(asObject(settingsJson) ?? {}) };
  const ui: JsonObject = { ...(asObject(settings.ui) ?? {}) };
  if (mode === "clear") {
    delete ui.senderCopy;
    if (Object.keys(ui).length === 0) delete settings.ui;
    else settings.ui = ui;
    return settings;
  }
  ui.senderCopy = mode;
  settings.ui = ui;
  return settings;
}

/** 代发模式的标题：「〈企业名〉发信通道」 */
export function platformRelayTitle(orgName: string | null | undefined): string {
  const name = orgName?.trim();
  return name ? `${name}发信通道` : "企业发信通道";
}

/** 代发模式的说明（不含任何企业专属的人名、邮箱与域名） */
export const PLATFORM_RELAY_SUMMARY = "询盘通知与审批后的跟进邮件由平台发信通道以企业的「公司发件身份」发出，不使用 Gmail。";

/** 登录账号上另有个人 Gmail 时的提示 */
export function personalGmailNotice(gmailEmail: string | null | undefined): string {
  const who = gmailEmail ? `（${gmailEmail}）` : "";
  return `你登录账号上绑着的 Gmail${who}是个人绑定，不会用来发本企业的邮件；它可能还在别的企业里使用，请不要在此解除。`;
}
