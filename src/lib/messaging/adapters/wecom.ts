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
const MEDIA_TIMEOUT_MS = 20000;
const MAX_OUTBOUND_IMAGE_BYTES = 10 * 1024 * 1024;

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

/** 从企业微信 XML 中提取单个标签内容（支持 CDATA）。 */
function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`);
  const m = re.exec(xml);
  return m ? m[1] : null;
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

  /**
   * 仅从 DB 加载配置（不拉 access_token、不写状态）。
   * 用于回调 URL 验证等只需 token/encodingKey 的轻量场景，避免额外网络往返拖慢校验。
   */
  async loadConfig(): Promise<boolean> {
    const gateway = await db.weChatGateway.findUnique({
      where: { orgId_channel: { orgId: this.orgId, channel: "wecom" } },
    });
    if (!gateway?.corpId || !gateway?.callbackToken || !gateway?.encodingKey) {
      return false;
    }
    this.config = {
      corpId: gateway.corpId,
      agentId: gateway.agentId ?? "",
      secret: gateway.secret ?? "",
      callbackToken: gateway.callbackToken,
      encodingKey: gateway.encodingKey,
    };
    return true;
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

  /**
   * 发送图片（自建应用）：先把图片上传为临时素材拿 media_id，再 message/send。
   * imageUrl 为可公开访问的图片地址（如 Vercel Blob）。
   */
  async sendImage(to: string, imageUrl: string): Promise<string | undefined> {
    if (!this.config) throw new Error("企业微信未配置");

    // 1. 拉取图片字节
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) });
    if (!imgRes.ok) throw new Error(`企业微信图片拉取失败: HTTP ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length === 0) throw new Error("企业微信图片为空");
    if (buf.length > MAX_OUTBOUND_IMAGE_BYTES) {
      throw new Error(`企业微信图片过大（>${Math.round(MAX_OUTBOUND_IMAGE_BYTES / 1024 / 1024)}MB）`);
    }
    const contentType = imgRes.headers.get("content-type") || "image/png";
    const ext = contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : contentType.includes("webp")
        ? "webp"
        : "png";

    // 2. 上传临时素材
    const mediaId = await this.uploadMedia(buf, contentType, `image.${ext}`);

    // 3. 发送图片消息
    const token = await this.getAccessToken();
    const send = async (t: string) =>
      fetch(`${WECOM_API}/message/send?access_token=${t}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          touser: to,
          msgtype: "image",
          agentid: Number(this.config!.agentId),
          image: { media_id: mediaId },
        }),
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      });
    let res = await send(token);
    let data = await res.json();
    if (data.errcode === 40014 || data.errcode === 42001) {
      this.tokenCache = null;
      res = await send(await this.getAccessToken());
      data = await res.json();
    }
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`企业微信图片发送失败: ${data.errmsg}`);
    }
    return data.msgid?.toString();
  }

  /**
   * 上传临时素材，返回 media_id（3 天有效）。
   */
  private async uploadMedia(
    bytes: Buffer,
    contentType: string,
    fileName: string,
  ): Promise<string> {
    const token = await this.getAccessToken();
    const form = new FormData();
    form.append(
      "media",
      new Blob([new Uint8Array(bytes)], { type: contentType }),
      fileName,
    );
    const res = await fetch(
      `${WECOM_API}/media/upload?access_token=${token}&type=image`,
      { method: "POST", body: form, signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) },
    );
    const data = await res.json();
    if (!data.media_id) {
      throw new Error(`企业微信素材上传失败: ${data.errmsg ?? "未知错误"}`);
    }
    return data.media_id as string;
  }

  /**
   * 下载入站图片素材，返回字节 + MIME。
   */
  async downloadMedia(
    mediaId: string,
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    if (!this.config) return null;
    try {
      const token = await this.getAccessToken();
      const res = await fetch(
        `${WECOM_API}/media/get?access_token=${token}&media_id=${encodeURIComponent(mediaId)}`,
        { signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) },
      );
      const contentType = res.headers.get("content-type") || "";
      // 出错时企业微信返回 JSON
      if (contentType.includes("application/json")) {
        return null;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) return null;
      const mimeType = contentType.split(";")[0].trim() || "image/jpeg";
      return { bytes, mimeType };
    } catch {
      return null;
    }
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
    if (!this.signatureMatches(msgSignature, timestamp, nonce, echostr)) return null;
    return this.decryptMessage(echostr);
  }

  /**
   * 解密并验签 POST 回调消息体。
   *
   * 企业微信 POST 推送的明文 XML 外层只含 <Encrypt>，真正的消息体经 AES 加密。
   * 必须：1) 取出 <Encrypt> 密文；2) 用 sha1(sort(token,timestamp,nonce,encrypt)) 验签；
   *       3) 解密得到内层消息 XML。任一步失败返回 null（拒绝处理，防伪造）。
   */
  decryptCallback(
    body: string,
    msgSignature: string,
    timestamp: string,
    nonce: string,
  ): string | null {
    if (!this.config) return null;
    const encrypt = extractTag(body, "Encrypt");
    if (!encrypt) return null;
    if (!this.signatureMatches(msgSignature, timestamp, nonce, encrypt)) return null;
    const plain = this.decryptMessage(encrypt);
    return plain === encrypt ? null : plain;
  }

  private signatureMatches(
    msgSignature: string,
    timestamp: string,
    nonce: string,
    encrypt: string,
  ): boolean {
    if (!this.config) return false;
    const sorted = [this.config.callbackToken, timestamp, nonce, encrypt].sort().join("");
    const hash = crypto.createHash("sha1").update(sorted).digest("hex");
    // 时序安全比较
    if (hash.length !== msgSignature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(msgSignature));
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
