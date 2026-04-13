/**
 * 企业微信 Adapter
 *
 * 基于企业微信官方 API：
 * - 发送：HTTP 调用 qyapi.weixin.qq.com
 * - 接收：Webhook 回调推送到 /api/messaging/wecom/callback
 *
 * 复用 channel-service.ts 中已有的 token 获取逻辑。
 */

import crypto from "crypto";
import { db } from "@/lib/db";
import type {
  MessagingAdapter,
  AdapterStatus,
  MessageHandler,
  WeComConfig,
} from "../types";

const WECOM_API = "https://qyapi.weixin.qq.com/cgi-bin";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export class WeComAdapter implements MessagingAdapter {
  readonly channel = "wecom" as const;

  private status: AdapterStatus = "disconnected";
  private config: WeComConfig | null = null;
  private tokenCache: TokenCache | null = null;
  private messageHandler: MessageHandler | null = null;
  private orgId: string;

  constructor(orgId: string) {
    this.orgId = orgId;
  }

  async start(): Promise<void> {
    const gateway = await db.weChatGateway.findUnique({
      where: { orgId_channel: { orgId: this.orgId, channel: "wecom" } },
    });

    if (!gateway?.corpId || !gateway?.secret) {
      this.status = "disconnected";
      return;
    }

    this.config = {
      corpId: gateway.corpId,
      agentId: gateway.agentId ?? "",
      secret: gateway.secret,
      callbackToken: gateway.callbackToken ?? "",
      encodingKey: gateway.encodingKey ?? "",
    };

    // 验证 token 获取
    try {
      await this.getAccessToken();
      this.status = "connected";
      await db.weChatGateway.update({
        where: { orgId_channel: { orgId: this.orgId, channel: "wecom" } },
        data: { status: "active", lastHeartbeat: new Date() },
      });
    } catch {
      this.status = "error";
    }
  }

  async stop(): Promise<void> {
    this.status = "disconnected";
    this.tokenCache = null;
    await db.weChatGateway.updateMany({
      where: { orgId: this.orgId, channel: "wecom" },
      data: { status: "inactive" },
    });
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  async sendText(to: string, content: string): Promise<string | undefined> {
    if (!this.config) throw new Error("企业微信未配置");

    const token = await this.getAccessToken();
    const res = await fetch(`${WECOM_API}/message/send?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser: to,
        msgtype: "text",
        agentid: Number(this.config.agentId),
        text: { content },
      }),
    });

    const data = await res.json();
    if (data.errcode && data.errcode !== 0) {
      // token 过期，清缓存重试一次
      if (data.errcode === 40014 || data.errcode === 42001) {
        this.tokenCache = null;
        const newToken = await this.getAccessToken();
        const retry = await fetch(`${WECOM_API}/message/send?access_token=${newToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            touser: to,
            msgtype: "text",
            agentid: Number(this.config.agentId),
            text: { content },
          }),
        });
        const retryData = await retry.json();
        if (retryData.errcode && retryData.errcode !== 0) {
          throw new Error(`企业微信发送失败: ${retryData.errmsg}`);
        }
        return retryData.msgid?.toString();
      }
      throw new Error(`企业微信发送失败: ${data.errmsg}`);
    }

    return data.msgid?.toString();
  }

  /**
   * 发送 Markdown 消息（企业微信独有能力）
   */
  async sendMarkdown(to: string, content: string): Promise<string | undefined> {
    if (!this.config) throw new Error("企业微信未配置");

    const token = await this.getAccessToken();
    const res = await fetch(`${WECOM_API}/message/send?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser: to,
        msgtype: "markdown",
        agentid: Number(this.config.agentId),
        markdown: { content },
      }),
    });

    const data = await res.json();
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`企业微信 Markdown 发送失败: ${data.errmsg}`);
    }
    return data.msgid?.toString();
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * 处理企业微信回调 — 由 API 路由调用
   */
  getMessageHandler(): MessageHandler | null {
    return this.messageHandler;
  }

  /**
   * 验证企业微信回调签名（GET 请求验证 URL 有效性）
   */
  verifyCallback(
    msgSignature: string,
    timestamp: string,
    nonce: string,
    echostr: string,
  ): string | null {
    if (!this.config) return null;

    const token = this.config.callbackToken;
    const sorted = [token, timestamp, nonce, echostr].sort().join("");
    const hash = crypto.createHash("sha1").update(sorted).digest("hex");

    if (hash !== msgSignature) return null;

    // 解密 echostr
    return this.decryptMessage(echostr);
  }

  /**
   * 解密企业微信消息
   */
  decryptMessage(encrypted: string): string {
    if (!this.config?.encodingKey) return encrypted;

    try {
      const key = Buffer.from(this.config.encodingKey + "=", "base64");
      const iv = key.subarray(0, 16);
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
      decipher.setAutoPadding(false);

      let decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64")),
        decipher.final(),
      ]);

      // 去除 PKCS7 padding
      const pad = decrypted[decrypted.length - 1];
      decrypted = decrypted.subarray(0, decrypted.length - pad);

      // 跳过 16 字节随机串 + 4 字节消息长度
      const msgLen = decrypted.readUInt32BE(16);
      const message = decrypted.subarray(20, 20 + msgLen).toString("utf-8");
      return message;
    } catch {
      return encrypted;
    }
  }

  // ── 内部方法 ────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.accessToken;
    }

    if (!this.config) throw new Error("企业微信未配置");

    const res = await fetch(
      `${WECOM_API}/gettoken?corpid=${this.config.corpId}&corpsecret=${this.config.secret}`,
    );
    const data = await res.json();

    if (!data.access_token) {
      throw new Error(`获取企业微信 token 失败: ${data.errmsg}`);
    }

    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    };

    return data.access_token;
  }

  /**
   * 保存配置到 DB
   */
  async saveConfig(config: WeComConfig): Promise<void> {
    this.config = config;

    await db.weChatGateway.upsert({
      where: { orgId_channel: { orgId: this.orgId, channel: "wecom" } },
      create: {
        orgId: this.orgId,
        channel: "wecom",
        corpId: config.corpId,
        agentId: config.agentId,
        secret: config.secret,
        callbackToken: config.callbackToken,
        encodingKey: config.encodingKey,
        status: "inactive",
      },
      update: {
        corpId: config.corpId,
        agentId: config.agentId,
        secret: config.secret,
        callbackToken: config.callbackToken,
        encodingKey: config.encodingKey,
      },
    });
  }
}
