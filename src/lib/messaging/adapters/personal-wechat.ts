/**
 * 个人微信 Adapter — 基于 iLink Bot API
 *
 * 使用 @wechatbot/wechatbot SDK 或直接 HTTP 调用 iLink API。
 * 考虑到 SDK 可能尚未安装，此处用纯 HTTP 实现核心协议，
 * 后续可无缝切换为 SDK 封装。
 *
 * iLink API 端点: https://ilinkai.weixin.qq.com
 * 协议: QR 登录 → long-poll getupdates → sendmessage
 */

import { db } from "@/lib/db";
import type {
  MessagingAdapter,
  AdapterStatus,
  MessageHandler,
  InboundMessage,
} from "../types";

const ILINK_BASE = "https://ilinkai.weixin.qq.com";

interface ILinkCredentials {
  token: string;
  contextToken: string;
}

export class PersonalWeChatAdapter implements MessagingAdapter {
  readonly channel = "personal_wechat" as const;

  private status: AdapterStatus = "disconnected";
  private credentials: ILinkCredentials | null = null;
  private messageHandler: MessageHandler | null = null;
  private pollAbort: AbortController | null = null;
  private orgId: string;

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

    // 如果有保存的凭证，尝试恢复连接
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

  async getLoginQR(): Promise<{ qrUrl: string; ticket: string }> {
    this.status = "qr_pending";

    try {
      const res = await fetch(`${ILINK_BASE}/cgi-bin/mmloginqrcode/getqrcode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: 1 }),
      });

      if (!res.ok) throw new Error(`获取 QR 码失败: ${res.status}`);

      const data = await res.json();
      const qrUrl = data.qr_url || data.qrUrl || "";
      const ticket = data.ticket || data.uuid || "";

      await db.weChatGateway.upsert({
        where: { orgId_channel: { orgId: this.orgId, channel: "personal_wechat" } },
        create: {
          orgId: this.orgId,
          channel: "personal_wechat",
          loginStatus: "qr_pending",
          status: "inactive",
        },
        update: {
          loginStatus: "qr_pending",
          status: "inactive",
        },
      });

      return { qrUrl, ticket };
    } catch (e) {
      this.status = "error";
      throw e;
    }
  }

  async checkLoginStatus(): Promise<AdapterStatus> {
    const gateway = await db.weChatGateway.findUnique({
      where: { orgId_channel: { orgId: this.orgId, channel: "personal_wechat" } },
    });
    this.status = (gateway?.loginStatus as AdapterStatus) ?? "disconnected";
    return this.status;
  }

  async sendText(to: string, content: string): Promise<string | undefined> {
    if (!this.credentials) {
      throw new Error("个人微信未登录");
    }

    // 微信消息长度限制，自动分段
    const segments = splitMessage(content, 2000);

    let lastMsgId: string | undefined;
    for (const segment of segments) {
      const res = await fetch(`${ILINK_BASE}/cgi-bin/mmbot/sendmessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.credentials.token}`,
        },
        body: JSON.stringify({
          to_user: to,
          msg_type: 1,
          content: { text: segment },
          context_token: this.credentials.contextToken,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`发送失败: ${err}`);
      }

      const data = await res.json();
      lastMsgId = data.msg_id?.toString();

      // 分段之间短暂延迟，避免消息顺序错乱
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

  private async pollOnce(): Promise<void> {
    if (!this.credentials) return;

    const res = await fetch(`${ILINK_BASE}/cgi-bin/mmbot/getupdates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.credentials.token}`,
      },
      body: JSON.stringify({
        context_token: this.credentials.contextToken,
        timeout: 30,
      }),
      signal: this.pollAbort?.signal,
    });

    if (!res.ok) return;

    const data = await res.json();

    // 更新 context_token
    if (data.context_token) {
      this.credentials.contextToken = data.context_token;
    }

    // 处理消息
    const updates = data.updates || data.messages || [];
    for (const update of updates) {
      if (!update.content?.text && !update.text) continue;

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

  private async updateHeartbeat(): Promise<void> {
    await db.weChatGateway.updateMany({
      where: { orgId: this.orgId, channel: "personal_wechat" },
      data: { lastHeartbeat: new Date() },
    });
  }

  /**
   * 登录成功后由 API 路由调用，传入凭证
   */
  async completeLogin(token: string, contextToken: string, nickname?: string): Promise<void> {
    this.credentials = { token, contextToken };
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
