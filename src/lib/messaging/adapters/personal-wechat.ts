/**
 * 个人微信 Adapter — 基于 iLink Bot API (WeChat ClawBot)
 *
 * 协议文档: https://www.wechatbot.dev/en/protocol
 * 基础 URL: https://ilinkai.weixin.qq.com
 *
 * 登录流程: GET /ilink/bot/get_bot_qrcode → 轮询 get_qrcode_status → confirmed 获取 bot_token
 * 消息收发: POST /ilink/bot/getupdates (long-poll) → POST /ilink/bot/sendmessage
 */

import crypto from "crypto";
import { db } from "@/lib/db";
import type {
  MessagingAdapter,
  AdapterStatus,
  MessageHandler,
  InboundMessage,
} from "../types";

const ILINK_BASE = process.env.ILINK_API_BASE || "https://ilinkai.weixin.qq.com";

function generateWechatUin(): string {
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0);
  return Buffer.from(String(num)).toString("base64");
}

function buildHeaders(botToken?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-WECHAT-UIN": generateWechatUin(),
  };
  if (botToken) {
    h["AuthorizationType"] = "ilink_bot_token";
    h["Authorization"] = `Bearer ${botToken}`;
  }
  return h;
}

const BASE_INFO = { base_info: { channel_version: "2.0.0" } };

interface ILinkCredentials {
  botToken: string;
  baseUrl: string;
  getUpdatesBuf: string;
}

export class PersonalWeChatAdapter implements MessagingAdapter {
  readonly channel = "personal_wechat" as const;

  private status: AdapterStatus = "disconnected";
  private credentials: ILinkCredentials | null = null;
  private messageHandler: MessageHandler | null = null;
  private pollAbort: AbortController | null = null;
  private orgId: string;
  private contextTokenCache = new Map<string, string>();

  constructor(orgId: string) {
    this.orgId = orgId;
  }

  async start(): Promise<void> {
    const gateway = await db.weChatGateway.findUnique({
      where: { orgId_channel: { orgId: this.orgId, channel: "personal_wechat" } },
    });

    if (!gateway) {
      this.status = "disconnected";
      return;
    }

    if (gateway.status === "active") {
      this.status = "connected";
      this.startPolling();
    }
  }

  async stop(): Promise<void> {
    this.pollAbort?.abort();
    this.pollAbort = null;
    this.status = "disconnected";

    await db.weChatGateway.updateMany({
      where: { orgId: this.orgId, channel: "personal_wechat" },
      data: { status: "inactive", loginStatus: "disconnected" },
    });
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  /**
   * 请求 QR 登录码
   * GET /ilink/bot/get_bot_qrcode?bot_type=3
   */
  async getLoginQR(): Promise<{ qrUrl: string; ticket: string }> {
    this.status = "qr_pending";

    try {
      const res = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`获取 QR 码失败: ${res.status} ${errText}`);
      }

      const data = await res.json();

      const qrcode = data.qrcode || "";
      const qrImgContent = data.qrcode_img_content || "";

      let qrUrl = "";
      if (qrImgContent) {
        qrUrl = qrImgContent.startsWith("http")
          ? qrImgContent
          : `data:image/png;base64,${qrImgContent}`;
      } else if (qrcode) {
        qrUrl = `https://login.weixin.qq.com/qrcode/${qrcode}`;
      }

      if (!qrUrl) {
        throw new Error(
          "iLink API 未返回有效的 QR 码，请检查服务是否可用。" +
          ` 原始响应字段: ${Object.keys(data).join(", ")}`
        );
      }

      await db.weChatGateway.upsert({
        where: { orgId_channel: { orgId: this.orgId, channel: "personal_wechat" } },
        create: {
          orgId: this.orgId,
          channel: "personal_wechat",
          loginStatus: "qr_pending",
          status: "inactive",
          errorMessage: null,
        },
        update: {
          loginStatus: "qr_pending",
          status: "inactive",
          errorMessage: null,
        },
      });

      return { qrUrl, ticket: qrcode };
    } catch (e) {
      this.status = "error";
      const errMsg = e instanceof Error ? e.message : String(e);

      await db.weChatGateway.upsert({
        where: { orgId_channel: { orgId: this.orgId, channel: "personal_wechat" } },
        create: {
          orgId: this.orgId,
          channel: "personal_wechat",
          loginStatus: "error",
          status: "inactive",
          errorMessage: errMsg,
        },
        update: {
          loginStatus: "error",
          errorMessage: errMsg,
        },
      });

      throw e;
    }
  }

  /**
   * 轮询 QR 扫码状态
   * GET /ilink/bot/get_qrcode_status?qrcode=...
   *
   * 状态机: wait → scaned → confirmed (或 expired)
   * confirmed 时返回 bot_token 和 baseurl
   */
  async checkQRStatus(qrcode: string): Promise<{
    status: "wait" | "scaned" | "confirmed" | "expired";
    botToken?: string;
    baseUrl?: string;
    nickname?: string;
  }> {
    const res = await fetch(
      `${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { method: "GET", headers: { "Content-Type": "application/json" } },
    );

    if (!res.ok) {
      throw new Error(`QR 状态查询失败: ${res.status}`);
    }

    const data = await res.json();
    const status = data.status || "wait";

    if (status === "confirmed") {
      const botToken = data.bot_token || data.token || "";
      const baseUrl = data.baseurl || data.base_url || ILINK_BASE;
      const nickname = data.nickname || data.bot_nickname || "";

      if (botToken) {
        await this.completeLogin(botToken, baseUrl, nickname);
      }

      return { status: "confirmed", botToken, baseUrl, nickname };
    }

    if (status === "expired") {
      await db.weChatGateway.updateMany({
        where: { orgId: this.orgId, channel: "personal_wechat" },
        data: { loginStatus: "disconnected", errorMessage: "二维码已过期，请重新扫码" },
      });
    }

    return { status };
  }

  async checkLoginStatus(): Promise<AdapterStatus> {
    const gateway = await db.weChatGateway.findUnique({
      where: { orgId_channel: { orgId: this.orgId, channel: "personal_wechat" } },
    });
    this.status = (gateway?.loginStatus as AdapterStatus) ?? "disconnected";
    return this.status;
  }

  /**
   * 发送文本消息
   * POST /ilink/bot/sendmessage
   */
  async sendText(to: string, content: string): Promise<string | undefined> {
    if (!this.credentials) {
      throw new Error("个人微信未登录");
    }

    const segments = splitMessage(content, 2000);
    let lastMsgId: string | undefined;

    for (const segment of segments) {
      const contextToken = this.contextTokenCache.get(to) || "";
      const base = this.credentials.baseUrl || ILINK_BASE;

      const res = await fetch(`${base}/ilink/bot/sendmessage`, {
        method: "POST",
        headers: buildHeaders(this.credentials.botToken),
        body: JSON.stringify({
          ...BASE_INFO,
          to_user: to,
          msg_type: 1,
          content: { text: segment },
          context_token: contextToken,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`发送失败: ${err}`);
      }

      const data = await res.json();
      if (data.errcode === -14) {
        await this.handleSessionExpired();
        throw new Error("会话已过期，请重新扫码登录");
      }

      lastMsgId = data.msg_id?.toString();

      if (segments.length > 1) {
        await sleep(500);
      }
    }

    return lastMsgId;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  // ── 内部方法 ────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollAbort) return;
    this.pollAbort = new AbortController();

    const poll = async () => {
      while (this.status === "connected" && !this.pollAbort?.signal.aborted) {
        try {
          await this.pollOnce();
          await this.updateHeartbeat();
        } catch (e) {
          if (this.pollAbort?.signal.aborted) break;
          console.error("[PersonalWeChatAdapter] Poll error:", e);
          await sleep(5000);
        }
      }
    };

    poll().catch(() => {});
  }

  /**
   * 长轮询接收消息
   * POST /ilink/bot/getupdates
   */
  private async pollOnce(): Promise<void> {
    if (!this.credentials) return;

    const base = this.credentials.baseUrl || ILINK_BASE;
    const res = await fetch(`${base}/ilink/bot/getupdates`, {
      method: "POST",
      headers: buildHeaders(this.credentials.botToken),
      body: JSON.stringify({
        ...BASE_INFO,
        get_updates_buf: this.credentials.getUpdatesBuf,
      }),
      signal: this.pollAbort?.signal,
    });

    if (!res.ok) return;

    const data = await res.json();

    if (data.ret === -14 || data.errcode === -14) {
      await this.handleSessionExpired();
      return;
    }

    if (data.get_updates_buf) {
      this.credentials.getUpdatesBuf = data.get_updates_buf;
    }

    const updates = data.updates || data.messages || [];
    for (const update of updates) {
      if (update.context_token && update.from_user) {
        this.contextTokenCache.set(update.from_user, update.context_token);
      }

      const hasText = update.content?.text || update.text;
      if (!hasText) continue;

      const msg: InboundMessage = {
        channel: "personal_wechat",
        externalUserId: update.from_user || update.from || "",
        externalUserName: update.from_nickname || update.nickname,
        content: update.content?.text || update.text || "",
        messageType: "text",
        externalMsgId: update.msg_id?.toString(),
        timestamp: new Date(update.timestamp ? update.timestamp * 1000 : Date.now()),
      };

      if (this.messageHandler && msg.externalUserId && msg.content) {
        this.messageHandler(msg).catch((e) =>
          console.error("[PersonalWeChatAdapter] Handler error:", e),
        );
      }
    }
  }

  private async handleSessionExpired(): Promise<void> {
    this.status = "disconnected";
    this.credentials = null;
    this.contextTokenCache.clear();
    this.pollAbort?.abort();
    this.pollAbort = null;

    await db.weChatGateway.updateMany({
      where: { orgId: this.orgId, channel: "personal_wechat" },
      data: {
        status: "inactive",
        loginStatus: "disconnected",
        errorMessage: "会话已过期，请重新扫码",
      },
    });
  }

  private async updateHeartbeat(): Promise<void> {
    await db.weChatGateway.updateMany({
      where: { orgId: this.orgId, channel: "personal_wechat" },
      data: { lastHeartbeat: new Date() },
    });
  }

  async completeLogin(botToken: string, baseUrl: string, nickname?: string): Promise<void> {
    this.credentials = { botToken, baseUrl, getUpdatesBuf: "" };
    this.status = "connected";

    await db.weChatGateway.upsert({
      where: { orgId_channel: { orgId: this.orgId, channel: "personal_wechat" } },
      create: {
        orgId: this.orgId,
        channel: "personal_wechat",
        loginStatus: "connected",
        status: "active",
        botNickname: nickname,
        lastHeartbeat: new Date(),
      },
      update: {
        loginStatus: "connected",
        status: "active",
        botNickname: nickname,
        lastHeartbeat: new Date(),
        errorMessage: null,
      },
    });

    this.startPolling();
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const segments: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = maxLen;
    segments.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return segments;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
