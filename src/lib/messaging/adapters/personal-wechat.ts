/**
 * 个人微信 Adapter — 基于 iLink Bot API (WeChat ClawBot)
 *
 * 协议文档: https://www.wechatbot.dev/zh/protocol
 * 基础 URL: https://ilinkai.weixin.qq.com，媒体 CDN: https://novac2c.cdn.weixin.qq.com/c2c
 *
 * 登录: GET /ilink/bot/get_bot_qrcode → 轮询 get_qrcode_status → confirmed 拿 bot_token
 * 收消息: POST /ilink/bot/getupdates (长轮询, msgs[].item_list)
 * 发消息: POST /ilink/bot/sendmessage (msg.item_list 信封, 必带 context_token)
 * 媒体: getuploadurl → AES-128-ECB 加密 → CDN upload/download
 */

import { db } from "@/lib/db";
import {
  ILINK_BASE_DEFAULT,
  ILINK_CDN_BASE_DEFAULT,
  BASE_INFO,
  MEDIA_TYPE,
  buildHeaders,
  parseGetUpdates,
  buildSendTextPayload,
  buildSendImagePayload,
  splitMessage,
  aesEcbEncrypt,
  aesEcbDecrypt,
  decodeAesKey,
  md5Hex,
  sniffImageMime,
  type ParsedImageRef,
} from "./ilink-media";
import type {
  MessagingAdapter,
  AdapterStatus,
  MessageHandler,
  InboundMessage,
} from "../types";
import crypto from "crypto";

const ILINK_BASE = process.env.ILINK_API_BASE || ILINK_BASE_DEFAULT;
const ILINK_CDN_BASE = process.env.ILINK_CDN_BASE || ILINK_CDN_BASE_DEFAULT;
const CHANNEL = "personal_wechat" as const;

interface ILinkCredentials {
  botToken: string;
  baseUrl: string;
  getUpdatesBuf: string;
}

export class PersonalWeChatAdapter implements MessagingAdapter {
  readonly channel = CHANNEL;

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
    const loaded = await this.loadCredentials();
    if (loaded) {
      this.startPolling();
    }
  }

  /**
   * 仅加载凭证（不启动长轮询）— 用于 Serverless 多实例下的按需发送
   */
  async loadCredentials(): Promise<boolean> {
    const gateway = await db.weChatGateway.findUnique({
      where: { orgId_channel: { orgId: this.orgId, channel: CHANNEL } },
    });

    if (!gateway) {
      this.status = "disconnected";
      return false;
    }

    if (gateway.status === "active" && gateway.botToken) {
      this.credentials = {
        botToken: gateway.botToken,
        baseUrl: gateway.botBaseUrl || ILINK_BASE,
        getUpdatesBuf: gateway.getUpdatesBuf || "",
      };
      this.status = "connected";
      return true;
    }

    return false;
  }

  async stop(): Promise<void> {
    this.pollAbort?.abort();
    this.pollAbort = null;
    this.credentials = null;
    this.status = "disconnected";

    await db.weChatGateway.updateMany({
      where: { orgId: this.orgId, channel: CHANNEL },
      data: { status: "inactive", loginStatus: "disconnected", botToken: null },
    });
  }

  /**
   * 仅停止内存中的长轮询循环，不清除 DB 凭证（供 worker 重启/重扫使用）。
   * 与 stop() 不同：不会把网关置为 inactive、不清 botToken。
   */
  stopPolling(): void {
    this.pollAbort?.abort();
    this.pollAbort = null;
    this.status = "disconnected";
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  /** 请求 QR 登录码：GET /ilink/bot/get_bot_qrcode?bot_type=3 */
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
            ` 原始响应字段: ${Object.keys(data).join(", ")}`,
        );
      }

      await db.weChatGateway.upsert({
        where: { orgId_channel: { orgId: this.orgId, channel: CHANNEL } },
        create: {
          orgId: this.orgId,
          channel: CHANNEL,
          loginStatus: "qr_pending",
          status: "inactive",
          errorMessage: null,
        },
        update: { loginStatus: "qr_pending", status: "inactive", errorMessage: null },
      });

      return { qrUrl, ticket: qrcode };
    } catch (e) {
      this.status = "error";
      const errMsg = e instanceof Error ? e.message : String(e);
      await db.weChatGateway.upsert({
        where: { orgId_channel: { orgId: this.orgId, channel: CHANNEL } },
        create: {
          orgId: this.orgId,
          channel: CHANNEL,
          loginStatus: "error",
          status: "inactive",
          errorMessage: errMsg,
        },
        update: { loginStatus: "error", errorMessage: errMsg },
      });
      throw e;
    }
  }

  /**
   * 轮询 QR 扫码状态：GET /ilink/bot/get_qrcode_status?qrcode=...
   * 状态机: wait → scaned → confirmed (或 expired)；confirmed 返回 bot_token / baseurl
   */
  async checkQRStatus(qrcode: string): Promise<{
    status: "wait" | "scaned" | "confirmed" | "expired";
    botToken?: string;
    baseUrl?: string;
    nickname?: string;
  }> {
    const res = await fetch(
      `${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json", "iLink-App-ClientVersion": "1" },
      },
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
        where: { orgId: this.orgId, channel: CHANNEL },
        data: { loginStatus: "disconnected", errorMessage: "二维码已过期，请重新扫码" },
      });
    }

    return { status };
  }

  async checkLoginStatus(): Promise<AdapterStatus> {
    const gateway = await db.weChatGateway.findUnique({
      where: { orgId_channel: { orgId: this.orgId, channel: CHANNEL } },
    });
    this.status = (gateway?.loginStatus as AdapterStatus) ?? "disconnected";
    return this.status;
  }

  // ── 发送 ────────────────────────────────────────────────────

  /** 发送文本：POST /ilink/bot/sendmessage（msg.item_list 信封） */
  async sendText(to: string, content: string): Promise<string | undefined> {
    if (!this.credentials) throw new Error("个人微信未登录");

    const contextToken = await this.resolveContextToken(to);
    if (!contextToken) {
      throw new Error("缺少 context_token（客户需先发消息以建立会话），无法发送");
    }

    const base = this.credentials.baseUrl || ILINK_BASE;
    const segments = splitMessage(content, 2000);
    let lastClientId: string | undefined;

    for (const segment of segments) {
      const payload = buildSendTextPayload({ toUserId: to, contextToken, text: segment });
      const res = await fetch(`${base}/ilink/bot/sendmessage`, {
        method: "POST",
        headers: buildHeaders(this.credentials.botToken),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`发送失败: ${res.status} ${err}`);
      }
      const data = await res.json().catch(() => ({}));
      if (data.ret === -14 || data.errcode === -14) {
        await this.handleSessionExpired();
        throw new Error("会话已过期，请重新扫码登录");
      }
      lastClientId = payload.msg.client_id;
      if (segments.length > 1) await sleep(500);
    }

    return lastClientId;
  }

  /**
   * 发送图片：拉取 URL（或直接字节）→ AES 加密 → CDN 上传 → sendmessage image_item
   * @param to 接收者用户 ID
   * @param image 图片 URL（http/https）或 dataURL
   */
  async sendImage(to: string, image: string): Promise<string | undefined> {
    if (!this.credentials) throw new Error("个人微信未登录");

    const contextToken = await this.resolveContextToken(to);
    if (!contextToken) {
      throw new Error("缺少 context_token（客户需先发消息以建立会话），无法发送图片");
    }

    const raw = await loadImageBytes(image);
    if (!raw) throw new Error("无法读取图片内容");

    const base = this.credentials.baseUrl || ILINK_BASE;

    // 1. 加密
    const aesKey = crypto.randomBytes(16);
    const aesKeyHex = aesKey.toString("hex");
    const ciphertext = aesEcbEncrypt(raw, aesKey);
    const filekey = crypto.randomBytes(16).toString("hex");

    // 2. 申请上传参数
    const uploadParamRes = await fetch(`${base}/ilink/bot/getuploadurl`, {
      method: "POST",
      headers: buildHeaders(this.credentials.botToken),
      body: JSON.stringify({
        filekey,
        media_type: MEDIA_TYPE.IMAGE,
        to_user_id: to,
        rawsize: raw.length,
        rawfilemd5: md5Hex(raw),
        filesize: ciphertext.length,
        no_need_thumb: true,
        aeskey: aesKeyHex,
        ...BASE_INFO,
      }),
    });
    if (!uploadParamRes.ok) {
      throw new Error(`getuploadurl 失败: ${uploadParamRes.status}`);
    }
    const uploadParamData = await uploadParamRes.json();
    if (uploadParamData.ret === -14 || uploadParamData.errcode === -14) {
      await this.handleSessionExpired();
      throw new Error("会话已过期，请重新扫码登录");
    }
    const uploadParam = uploadParamData.upload_param;
    if (!uploadParam) throw new Error("getuploadurl 未返回 upload_param");

    // 3. 上传密文到 CDN
    const uploadUrl =
      `${ILINK_CDN_BASE}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}` +
      `&filekey=${encodeURIComponent(filekey)}`;
    const cdnRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(ciphertext),
    });
    if (!cdnRes.ok) {
      const err = await cdnRes.text().catch(() => "");
      throw new Error(`CDN 上传失败: ${cdnRes.status} ${err}`);
    }
    const encryptedParam = cdnRes.headers.get("x-encrypted-param");
    if (!encryptedParam) throw new Error("CDN 上传未返回 x-encrypted-param");

    // 4. 发送图片消息
    const payload = buildSendImagePayload({
      toUserId: to,
      contextToken,
      encryptQueryParam: encryptedParam,
      aesKeyHex,
      midSize: ciphertext.length,
    });
    const sendRes = await fetch(`${base}/ilink/bot/sendmessage`, {
      method: "POST",
      headers: buildHeaders(this.credentials.botToken),
      body: JSON.stringify(payload),
    });
    if (!sendRes.ok) {
      const err = await sendRes.text().catch(() => "");
      throw new Error(`发送图片失败: ${sendRes.status} ${err}`);
    }
    const sendData = await sendRes.json().catch(() => ({}));
    if (sendData.ret === -14 || sendData.errcode === -14) {
      await this.handleSessionExpired();
      throw new Error("会话已过期，请重新扫码登录");
    }

    return payload.msg.client_id;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  // ── 内部方法 ────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollAbort) return;
    this.pollAbort = new AbortController();

    const poll = async () => {
      let consecutiveErrors = 0;
      while (this.status === "connected" && !this.pollAbort?.signal.aborted) {
        try {
          await this.pollOnce();
          await this.updateHeartbeat();
          consecutiveErrors = 0;
        } catch (e) {
          if (this.pollAbort?.signal.aborted) break;
          consecutiveErrors++;
          console.error("[PersonalWeChatAdapter] Poll error:", e);
          await sleep(consecutiveErrors >= 3 ? 30000 : 2000);
        }
      }
    };

    poll().catch(() => {});
  }

  /** 长轮询接收消息：POST /ilink/bot/getupdates */
  private async pollOnce(): Promise<void> {
    if (!this.credentials) return;

    const base = this.credentials.baseUrl || ILINK_BASE;
    const res = await fetch(`${base}/ilink/bot/getupdates`, {
      method: "POST",
      headers: buildHeaders(this.credentials.botToken),
      body: JSON.stringify({
        get_updates_buf: this.credentials.getUpdatesBuf,
        ...BASE_INFO,
      }),
      signal: this.pollAbort?.signal,
    });

    if (!res.ok) return;

    const data = await res.json().catch(() => null);
    const parsed = parseGetUpdates(data);

    if (parsed.sessionExpired) {
      await this.handleSessionExpired();
      return;
    }

    if (parsed.nextBuf && parsed.nextBuf !== this.credentials.getUpdatesBuf) {
      this.credentials.getUpdatesBuf = parsed.nextBuf;
      db.weChatGateway
        .updateMany({
          where: { orgId: this.orgId, channel: CHANNEL },
          data: { getUpdatesBuf: parsed.nextBuf },
        })
        .catch(() => {});
    }

    for (const msg of parsed.msgs) {
      if (msg.contextToken) {
        await this.cacheContextToken(msg.fromUserId, msg.contextToken);
      }
      for (const item of msg.items) {
        await this.dispatchItem(msg, item).catch((e) =>
          console.error("[PersonalWeChatAdapter] dispatch error:", e),
        );
      }
    }
  }

  private async dispatchItem(
    msg: { fromUserId: string; messageId?: string; createTimeMs?: number },
    item: { type: number; text?: string; image?: ParsedImageRef },
  ): Promise<void> {
    if (!this.messageHandler) return;

    const timestamp = msg.createTimeMs ? new Date(msg.createTimeMs) : new Date();

    if (item.type === 1 && item.text) {
      const inbound: InboundMessage = {
        channel: CHANNEL,
        externalUserId: msg.fromUserId,
        content: item.text,
        messageType: "text",
        externalMsgId: msg.messageId,
        timestamp,
      };
      await this.messageHandler(inbound);
      return;
    }

    if (item.type === 2 && item.image) {
      const media = await this.downloadImage(item.image);
      if (!media) {
        console.warn("[PersonalWeChatAdapter] 图片下载/解密失败，跳过");
        return;
      }
      const inbound: InboundMessage = {
        channel: CHANNEL,
        externalUserId: msg.fromUserId,
        content: "",
        messageType: "image",
        externalMsgId: msg.messageId,
        timestamp,
        media,
      };
      await this.messageHandler(inbound);
    }
  }

  /** 下载并解密入站图片 */
  private async downloadImage(
    ref: ParsedImageRef,
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    if (!ref.encryptQueryParam) return null;
    try {
      const url = `${ILINK_CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(
        ref.encryptQueryParam,
      )}`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) return null;
      const ciphertext = Buffer.from(await res.arrayBuffer());

      const key = decodeAesKey({ aesKeyHex: ref.aesKeyHex, aesKeyB64: ref.aesKeyB64 });
      const plaintext = aesEcbDecrypt(ciphertext, key);
      const mime = sniffImageMime(plaintext) || "image/png";
      return { bytes: plaintext, mimeType: mime };
    } catch (e) {
      console.error("[PersonalWeChatAdapter] downloadImage error:", e);
      return null;
    }
  }

  // ── context_token：内存 + DB 双写 ───────────────────────────

  private async cacheContextToken(externalUserId: string, token: string): Promise<void> {
    this.contextTokenCache.set(externalUserId, token);
    try {
      await db.weChatContext.upsert({
        where: {
          orgId_channel_externalUserId: {
            orgId: this.orgId,
            channel: CHANNEL,
            externalUserId,
          },
        },
        create: { orgId: this.orgId, channel: CHANNEL, externalUserId, contextToken: token },
        update: { contextToken: token },
      });
    } catch {
      // DB 写失败不阻塞收消息
    }
  }

  private async resolveContextToken(externalUserId: string): Promise<string | null> {
    const cached = this.contextTokenCache.get(externalUserId);
    if (cached) return cached;
    const row = await db.weChatContext.findUnique({
      where: {
        orgId_channel_externalUserId: {
          orgId: this.orgId,
          channel: CHANNEL,
          externalUserId,
        },
      },
      select: { contextToken: true },
    });
    if (row?.contextToken) {
      this.contextTokenCache.set(externalUserId, row.contextToken);
      return row.contextToken;
    }
    return null;
  }

  private async handleSessionExpired(): Promise<void> {
    this.status = "disconnected";
    this.credentials = null;
    this.contextTokenCache.clear();
    this.pollAbort?.abort();
    this.pollAbort = null;

    await db.weChatGateway.updateMany({
      where: { orgId: this.orgId, channel: CHANNEL },
      data: {
        status: "inactive",
        loginStatus: "disconnected",
        botToken: null,
        errorMessage: "会话已过期，请重新扫码",
      },
    });
  }

  private async updateHeartbeat(): Promise<void> {
    await db.weChatGateway.updateMany({
      where: { orgId: this.orgId, channel: CHANNEL },
      data: { lastHeartbeat: new Date() },
    });
  }

  /**
   * QR 确认后持久化登录态（不在本进程启动长轮询）。
   *
   * 长轮询统一由常驻 worker（`adapter.start()`）拥有：
   * - Vercel serverless 进程在请求结束即销毁，进程内轮询无意义；
   * - 本地若 web 与 worker 同时轮询同一账号会产生游标竞争/重复处理。
   * 故这里只落库凭证，由 worker 周期重扫接管。
   */
  async completeLogin(botToken: string, baseUrl: string, nickname?: string): Promise<void> {
    this.credentials = { botToken, baseUrl, getUpdatesBuf: "" };
    this.status = "connected";

    await db.weChatGateway.upsert({
      where: { orgId_channel: { orgId: this.orgId, channel: CHANNEL } },
      create: {
        orgId: this.orgId,
        channel: CHANNEL,
        loginStatus: "connected",
        status: "active",
        botNickname: nickname,
        botToken,
        botBaseUrl: baseUrl,
        getUpdatesBuf: "",
        lastHeartbeat: new Date(),
      },
      update: {
        loginStatus: "connected",
        status: "active",
        botNickname: nickname,
        botToken,
        botBaseUrl: baseUrl,
        getUpdatesBuf: "",
        lastHeartbeat: new Date(),
        errorMessage: null,
      },
    });
  }
}

async function loadImageBytes(image: string): Promise<Buffer | null> {
  if (image.startsWith("data:")) {
    const comma = image.indexOf(",");
    if (comma === -1) return null;
    return Buffer.from(image.slice(comma + 1), "base64");
  }
  if (image.startsWith("http://") || image.startsWith("https://")) {
    const res = await fetch(image);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
