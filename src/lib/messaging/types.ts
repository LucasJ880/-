/**
 * 统一消息网关 — 核心类型
 *
 * 所有消息通道（个人微信、企业微信、未来的 WhatsApp 等）
 * 都实现 MessagingAdapter 接口，上层统一处理。
 */

export type ChannelType = "personal_wechat" | "wecom";

export type AdapterStatus =
  | "disconnected"
  | "qr_pending"
  | "scanning"
  | "connected"
  | "error";

export type MessageDirection = "inbound" | "outbound";
export type MessageType = "text" | "image" | "file" | "voice";
export type FilterMode = "all" | "keyword" | "whitelist";

// ── Adapter 接口 ─────────────────────────────────────────────

export interface MessagingAdapter {
  readonly channel: ChannelType;

  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): AdapterStatus;

  /** 个人微信需要 QR 登录 */
  getLoginQR?(): Promise<{ qrUrl: string; ticket: string }>;
  checkLoginStatus?(): Promise<AdapterStatus>;

  sendText(to: string, content: string): Promise<string | undefined>;
  sendImage?(to: string, imagePath: string): Promise<string | undefined>;
  sendFile?(to: string, filePath: string, fileName: string): Promise<string | undefined>;

  onMessage(handler: MessageHandler): void;
}

export type MessageHandler = (msg: InboundMessage) => Promise<void>;

// ── 消息结构 ──────────────────────────────────────────────────

export interface InboundMessage {
  channel: ChannelType;
  externalUserId: string;
  externalUserName?: string;
  content: string;
  messageType: MessageType;
  externalMsgId?: string;
  timestamp: Date;
  /** 企业微信可带额外字段 */
  raw?: unknown;
}

export interface OutboundMessage {
  channel: ChannelType;
  to: string;
  content: string;
  messageType: MessageType;
}

// ── 绑定 ──────────────────────────────────────────────────────

export type PushDomain = "trade" | "sales" | "project" | "all";

export interface BindingInfo {
  id: string;
  userId: string;
  orgId: string | null;
  channel: ChannelType;
  externalId: string;
  displayName: string | null;
  status: string;
  pushBriefing: boolean;
  pushFollowup: boolean;
  pushReport: boolean;
  pushSales: boolean;
  pushDomains: string;
  filterMode: FilterMode;
  filterKeyword: string | null;
}

/**
 * 角色 → 默认推送域映射
 *
 * admin/super_admin: 收到所有域
 * trade: 外贸相关
 * sales: 销售相关
 * user:  项目/通用
 */
export const ROLE_DEFAULT_DOMAINS: Record<string, string> = {
  admin: "all",
  super_admin: "all",
  trade: "trade",
  sales: "sales",
  user: "project",
};

// ── 网关配置 ──────────────────────────────────────────────────

export interface GatewayStatus {
  channel: ChannelType;
  status: AdapterStatus;
  botNickname?: string;
  lastHeartbeat?: Date;
  errorMessage?: string;
}

export interface WeComConfig {
  corpId: string;
  agentId: string;
  secret: string;
  callbackToken: string;
  encodingKey: string;
}
