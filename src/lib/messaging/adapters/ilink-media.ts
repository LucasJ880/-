/**
 * iLink Bot 协议 — 纯函数层（无网络副作用，便于单测）
 *
 * 覆盖：通用请求头、X-WECHAT-UIN 生成、AES-128-ECB 加解密、AES key 双编码兼容、
 * 密文大小公式、入站 getupdates 报文解析、出站 sendmessage 报文构造、图片字节嗅探。
 *
 * 协议参考：https://www.wechatbot.dev/zh/protocol （epiral/weixin-bot protocol-spec）
 */

import crypto from "crypto";

export const ILINK_BASE_DEFAULT = "https://ilinkai.weixin.qq.com";
export const ILINK_CDN_BASE_DEFAULT = "https://novac2c.cdn.weixin.qq.com/c2c";
export const ILINK_CHANNEL_VERSION = "1.0.0";

export const BASE_INFO = { base_info: { channel_version: ILINK_CHANNEL_VERSION } };

/** 媒体类型（getuploadurl.media_type） */
export const MEDIA_TYPE = { IMAGE: 1, VIDEO: 2, FILE: 3, VOICE: 4 } as const;

/** item_list[].type */
export const ITEM_TYPE = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 } as const;

/** message_type / message_state（出站固定 BOT/FINISH） */
export const MESSAGE_TYPE_BOT = 2;
export const MESSAGE_STATE_FINISH = 2;

/** 随机 uint32 → 十进制字符串 → base64 */
export function randomWechatUin(): string {
  const value = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

/** 业务 POST 通用请求头 */
export function buildHeaders(botToken?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-WECHAT-UIN": randomWechatUin(),
  };
  const routeTag = process.env.ILINK_SK_ROUTE_TAG;
  if (routeTag) h["SKRouteTag"] = routeTag;
  if (botToken) {
    h["AuthorizationType"] = "ilink_bot_token";
    h["Authorization"] = `Bearer ${botToken}`;
  }
  return h;
}

/** 生成全局唯一 client_id */
export function generateClientId(): string {
  return `qingyan-weixin:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

// ── AES-128-ECB ────────────────────────────────────────────────

export function aesEcbEncrypt(plaintext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) throw new Error(`AES key must be 16 bytes, got ${key.length}`);
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

export function aesEcbDecrypt(ciphertext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) throw new Error(`AES key must be 16 bytes, got ${key.length}`);
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** 密文大小：filesize = ceil((rawsize + 1) / 16) * 16 */
export function cipherFileSize(rawsize: number): number {
  return Math.ceil((rawsize + 1) / 16) * 16;
}

export function md5Hex(buf: Buffer): string {
  return crypto.createHash("md5").update(buf).digest("hex");
}

/**
 * 解码 iLink 的 AES key，统一返回 16 字节 Buffer。
 *
 * 兼容三种来源（优先级从高到低）：
 * 1. image_item.aeskey：32 位 hex 字符串 → 直接 hex 解码。
 * 2. media.aes_key（base64）：base64 解码后若为 16 字节直接用；若为 32 字节 ASCII hex → 再 hex 解码。
 */
export function decodeAesKey(opts: {
  aesKeyHex?: string | null;
  aesKeyB64?: string | null;
}): Buffer {
  const hex = (opts.aesKeyHex ?? "").trim();
  if (/^[0-9a-fA-F]{32}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }
  const b64 = (opts.aesKeyB64 ?? "").trim();
  if (b64) {
    const decoded = Buffer.from(b64, "base64");
    if (decoded.length === 16) return decoded;
    if (decoded.length === 32) {
      const asAscii = decoded.toString("utf8");
      if (/^[0-9a-fA-F]{32}$/.test(asAscii)) {
        return Buffer.from(asAscii, "hex");
      }
    }
  }
  throw new Error("无法解析 AES key（既不是 32位hex 也不是有效 base64 16/32 字节）");
}

/** 出站 image_item.media.aes_key 采用官方 openclaw 形式：base64(hex string) */
export function encodeOutboundAesKey(aesKeyHex: string): string {
  return Buffer.from(aesKeyHex, "utf8").toString("base64");
}

// ── 图片字节嗅探 ───────────────────────────────────────────────

export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 6) {
    const head = buf.toString("ascii", 0, 6);
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  return null;
}

export function extFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

// ── 入站 getupdates 解析 ───────────────────────────────────────

export interface ParsedImageRef {
  encryptQueryParam?: string;
  aesKeyB64?: string; // media.aes_key
  aesKeyHex?: string; // image_item.aeskey（32位 hex）
  encryptType?: number;
  midSize?: number;
}

export interface ParsedInboundItem {
  type: number;
  text?: string;
  image?: ParsedImageRef;
}

export interface ParsedInboundMsg {
  messageId?: string;
  fromUserId: string;
  contextToken?: string;
  createTimeMs?: number;
  items: ParsedInboundItem[];
}

export interface ParsedGetUpdates {
  sessionExpired: boolean;
  nextBuf?: string;
  longPollTimeoutMs?: number;
  msgs: ParsedInboundMsg[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asString(v: any): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v);
}

/** 解析 getupdates 响应；兼容字段缺失。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseGetUpdates(data: any): ParsedGetUpdates {
  if (!data || typeof data !== "object") {
    return { sessionExpired: false, msgs: [] };
  }

  if (data.ret === -14 || data.errcode === -14) {
    return { sessionExpired: true, msgs: [] };
  }

  const rawMsgs: unknown[] = Array.isArray(data.msgs)
    ? data.msgs
    : Array.isArray(data.updates)
      ? data.updates
      : Array.isArray(data.messages)
        ? data.messages
        : [];

  const msgs: ParsedInboundMsg[] = [];
  for (const m of rawMsgs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = m as any;
    const fromUserId = asString(msg.from_user_id ?? msg.from_user ?? msg.from) ?? "";
    if (!fromUserId) continue;

    const items: ParsedInboundItem[] = [];
    const rawItems: unknown[] = Array.isArray(msg.item_list) ? msg.item_list : [];
    for (const it of rawItems) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = it as any;
      const type = Number(item.type);
      if (type === ITEM_TYPE.TEXT) {
        const text = asString(item.text_item?.text);
        if (text) items.push({ type, text });
      } else if (type === ITEM_TYPE.IMAGE) {
        const img = item.image_item ?? {};
        const media = img.media ?? {};
        items.push({
          type,
          image: {
            encryptQueryParam: asString(media.encrypt_query_param),
            aesKeyB64: asString(media.aes_key),
            aesKeyHex: asString(img.aeskey),
            encryptType: media.encrypt_type !== undefined ? Number(media.encrypt_type) : undefined,
            midSize: img.mid_size !== undefined ? Number(img.mid_size) : undefined,
          },
        });
      }
      // voice/file/video 暂不处理
    }

    msgs.push({
      messageId: asString(msg.message_id),
      fromUserId,
      contextToken: asString(msg.context_token),
      createTimeMs: msg.create_time_ms !== undefined ? Number(msg.create_time_ms) : undefined,
      items,
    });
  }

  return {
    sessionExpired: false,
    nextBuf: asString(data.get_updates_buf),
    longPollTimeoutMs:
      data.longpolling_timeout_ms !== undefined ? Number(data.longpolling_timeout_ms) : undefined,
    msgs,
  };
}

// ── 出站 sendmessage 报文构造 ──────────────────────────────────

export interface SendEnvelope {
  msg: {
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    message_type: number;
    message_state: number;
    context_token: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    item_list: any[];
  };
  base_info: { channel_version: string };
}

function baseEnvelope(toUserId: string, contextToken: string, clientId: string) {
  return {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: MESSAGE_TYPE_BOT,
      message_state: MESSAGE_STATE_FINISH,
      context_token: contextToken,
      item_list: [] as unknown[],
    },
    base_info: { channel_version: ILINK_CHANNEL_VERSION },
  };
}

export function buildSendTextPayload(args: {
  toUserId: string;
  contextToken: string;
  text: string;
  clientId?: string;
}): SendEnvelope {
  const env = baseEnvelope(args.toUserId, args.contextToken, args.clientId ?? generateClientId());
  env.msg.item_list = [{ type: ITEM_TYPE.TEXT, text_item: { text: args.text } }];
  return env;
}

export function buildSendImagePayload(args: {
  toUserId: string;
  contextToken: string;
  encryptQueryParam: string;
  aesKeyHex: string;
  midSize: number;
  clientId?: string;
}): SendEnvelope {
  const env = baseEnvelope(args.toUserId, args.contextToken, args.clientId ?? generateClientId());
  env.msg.item_list = [
    {
      type: ITEM_TYPE.IMAGE,
      image_item: {
        media: {
          encrypt_query_param: args.encryptQueryParam,
          aes_key: encodeOutboundAesKey(args.aesKeyHex),
          encrypt_type: 1,
        },
        mid_size: args.midSize,
      },
    },
  ];
  return env;
}

/** 长文本分片：优先 \n\n，其次 \n，再次空格，最后硬切。 */
export function splitMessage(text: string, maxLen = 2000): string[] {
  if (text.length <= maxLen) return [text];
  const segments: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut <= 0) cut = remaining.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = remaining.lastIndexOf(" ", maxLen);
    if (cut <= 0) cut = maxLen;
    segments.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^[\n ]+/, "");
  }
  if (remaining.length > 0) segments.push(remaining);
  return segments;
}
