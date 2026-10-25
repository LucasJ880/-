/**
 * 微信绑定的「占有证明」（proof of control）— 纯函数，无 DB
 *
 * 背景：此前 POST /api/messaging/bindings 只凭用户自己填的 externalId 建绑定，并按
 * (channel, externalId) upsert 覆盖 userId——任何登录用户填别人的企微 UserId / 微信 ID，
 * 就能把别人的绑定抢到自己名下（别人的消息从此以抢占者身份进入青砚，推送也跟着改道）。
 *
 * 现在的规则：
 * 1. 绑定必须带验证码。验证码只由青砚机器人通过该渠道发给这个外部账号本人：
 *    - 企业微信：未绑定的账号给青砚应用发任意消息，机器人回 UserId + 验证码；
 *    - 个人微信：未绑定的账号给青砚机器人发「绑定青砚」，机器人回微信 ID + 验证码。
 *    能在网页上填出验证码 = 能收到该外部账号的消息 = 控制该账号。
 * 2. 验证码是无状态的 HMAC（密钥由服务端 JWT_SECRET 派生，域分隔），绑定 channel + externalId
 *    + 时间窗；15 分钟一个时间窗，接受当前与上一个窗（有效期 15–30 分钟）。不落库、无需迁移。
 *    8 位、每位 32 种字符（40 bit），在有效期内暴力猜中不可行。
 * 3. 已被**其他用户**占用且仍 active 的绑定，即使验证码正确也不迁移（decideBindingClaim → conflict），
 *    须原账号先解绑；原账号解绑（status≠active）后，持验证码的新账号才可接手（字段全部重置）。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelType } from "./types";

export const BIND_CODE_WINDOW_MS = 15 * 60 * 1000;
/** 给用户看的有效期（保证至少这么久） */
export const BIND_CODE_VALID_MINUTES = 15;
export const BIND_CODE_LENGTH = 8;
/** 去掉易混的 0 / 1 / I / O，正好 32 个字符（每位 5 bit） */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const KEY_LABEL = "qingyan/wechat-binding-proof/v1";

/** 个人微信里触发下发验证码的命令（精确匹配，避免客户闲聊误触发） */
export const PERSONAL_WECHAT_BIND_COMMAND = "绑定青砚";

/** 从服务端密钥派生验证码专用子密钥；未配置密钥时返回 null（绑定一律失败，fail-closed） */
export function deriveBindCodeKey(rootSecret: string | undefined | null): Buffer | null {
  const s = (rootSecret ?? "").trim();
  if (!s) return null;
  return createHmac("sha256", s).update(KEY_LABEL).digest();
}

export function bindCodeKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  return deriveBindCodeKey(env.JWT_SECRET);
}

function windowIndex(nowMs: number): number {
  return Math.floor(nowMs / BIND_CODE_WINDOW_MS);
}

function codeForWindow(key: Buffer, channel: ChannelType, externalId: string, window: number): string {
  const mac = createHmac("sha256", key)
    .update(`bind|${channel}|${externalId}|${window}`)
    .digest();
  let out = "";
  for (let i = 0; i < BIND_CODE_LENGTH; i++) out += ALPHABET[mac[i] & 31];
  return out;
}

/** 给机器人回复用：当前时间窗的验证码（未分隔）；没有密钥返回 null */
export function issueBindCode(
  key: Buffer | null,
  channel: ChannelType,
  externalId: string,
  now: Date = new Date(),
): string | null {
  if (!key || !externalId) return null;
  return codeForWindow(key, channel, externalId, windowIndex(now.getTime()));
}

/** 展示格式：ABCD-EFGH */
export function formatBindCode(code: string): string {
  return code.length === BIND_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** 用户输入归一：去空格 / 连字符，转大写 */
export function normalizeBindCode(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/[\s\-_.·]/g, "").toUpperCase();
}

/** 校验：当前窗或上一个窗的验证码；常量时间比较 */
export function verifyBindCode(
  key: Buffer | null,
  channel: ChannelType,
  externalId: string,
  input: unknown,
  now: Date = new Date(),
): boolean {
  if (!key || !externalId) return false;
  const code = normalizeBindCode(input);
  // 只接受 8 位 ASCII 字母数字（多字节字符会让 Buffer 长度不等，timingSafeEqual 会抛错）
  if (!/^[0-9A-Z]{8}$/.test(code)) return false;
  const given = Buffer.from(code);
  const w = windowIndex(now.getTime());
  let match = false;
  for (const win of [w, w - 1]) {
    const expected = Buffer.from(codeForWindow(key, channel, externalId, win));
    if (timingSafeEqual(given, expected)) match = true;
  }
  return match;
}

export type BindingClaimDecision =
  /** 没有这条绑定：新建 */
  | "create"
  /** 本人的绑定：刷新（重新激活 / 更新昵称），不改归属 */
  | "refresh_own"
  /** 别人已解绑（status≠active）的旧行：交给新账号，字段全部重置 */
  | "reclaim_released"
  /** 别人仍在用：拒绝，绝不迁移 */
  | "conflict";

/** 纯函数：验证码通过之后，这条 (channel, externalId) 能否归到 requester 名下 */
export function decideBindingClaim(
  existing: { userId: string; status: string } | null,
  requesterUserId: string,
): BindingClaimDecision {
  if (!existing) return "create";
  if (existing.userId === requesterUserId) return "refresh_own";
  if (existing.status === "active") return "conflict";
  return "reclaim_released";
}

/** 个人微信：是否为「绑定青砚」命令（忽略首尾与中间空白） */
export function isPersonalWeChatBindCommand(content: string | null | undefined): boolean {
  return (content ?? "").replace(/\s+/g, "") === PERSONAL_WECHAT_BIND_COMMAND;
}

/** 机器人给未绑定账号的回复（含验证码；没有密钥时不下发验证码并提示联系管理员） */
export function buildUnboundReply(channel: ChannelType, externalId: string, code: string | null): string {
  const idLabel = channel === "wecom" ? "企微 UserId" : "微信 ID";
  const lines = [
    "你好，我是青砚。",
    channel === "wecom"
      ? "当前企微账号尚未绑定青砚用户，所以无法进入你的工作组织。"
      : "当前微信尚未绑定青砚用户。",
    `你的${idLabel}：${externalId}`,
  ];
  if (code) {
    lines.push(
      `绑定验证码：${formatBindCode(code)}（${BIND_CODE_VALID_MINUTES} 分钟内有效，只用于绑定你本人的账号，请勿转发给他人）`,
      `请打开青砚 → 设置 → 微信集成，填写上述 ${idLabel} 和验证码完成绑定后再发消息。`,
    );
  } else {
    lines.push("绑定验证暂不可用，请联系管理员。");
  }
  return lines.join("\n");
}
