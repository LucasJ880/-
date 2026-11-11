/**
 * VIS-1e 以岗位预览的 cookie（spec authorization/position-preview，design D4）。纯模块：不导入数据库与 next/*。
 *
 * `qy_preview` = jose HS256 JWT，密钥由 JWT_SECRET 派生（HMAC-SHA256(JWT_SECRET, "qy-preview-v1")），另带
 * `aud: "qy-preview"`。派生密钥让会话校验（用 JWT_SECRET 本身、不查 aud）认不出它：预览 cookie 不能当登录会话用，
 * 会话 token 也通不过预览校验。这里只做无库校验（签名、aud、过期、属于会话用户、岗位个数），有库校验见 server.ts。
 */

import { createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const PREVIEW_COOKIE = "qy_preview";
export const PREVIEW_AUDIENCE = "qy-preview";
export const PREVIEW_TTL_SECONDS = 2 * 60 * 60;
export const PREVIEW_MAX_POSITIONS = 10;

const KEY_DERIVATION_LABEL = "qy-preview-v1";
const POSITION_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

export type PreviewClaims = {
  /** 本人 userId */
  sub: string;
  orgId: string;
  /** 岗位 key（RoleProfile.key），已去重、保序 */
  keys: string[];
  /** 过期时间（秒） */
  exp: number;
};

function previewKey(secret: string | undefined = process.env.JWT_SECRET): Uint8Array {
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return new Uint8Array(createHmac("sha256", secret).update(KEY_DERIVATION_LABEL).digest());
}

/** 岗位 key 列表：字符串、去重保序、1–10 个、形如 `accounting`；不合格返回 null */
export function normalizePositionKeys(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const k of raw) {
    if (typeof k !== "string") return null;
    const key = k.trim();
    if (!POSITION_KEY_RE.test(key)) return null;
    if (!out.includes(key)) out.push(key);
  }
  if (out.length === 0 || out.length > PREVIEW_MAX_POSITIONS) return null;
  return out;
}

export async function signPreviewToken(
  input: { userId: string; orgId: string; keys: readonly string[] },
  opts: { now?: Date; secret?: string } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const keys = normalizePositionKeys([...input.keys]);
  if (!keys) throw new Error("invalid preview position keys");
  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const exp = nowSec + PREVIEW_TTL_SECONDS;
  const token = await new SignJWT({ orgId: input.orgId, keys })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setAudience(PREVIEW_AUDIENCE)
    .setIssuedAt(nowSec)
    .setExpirationTime(exp)
    .sign(previewKey(opts.secret));
  return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * 无库校验：签名（派生密钥）、aud、未过期、`sub` 等于会话用户、企业与岗位形状。任一不过返回 null（当作不存在）。
 */
export async function verifyPreviewToken(
  token: string | null | undefined,
  sessionUserId: string | null | undefined,
  opts: { now?: Date; secret?: string } = {},
): Promise<PreviewClaims | null> {
  if (!token || !sessionUserId) return null;
  try {
    const { payload } = await jwtVerify(token, previewKey(opts.secret), {
      audience: PREVIEW_AUDIENCE,
      algorithms: ["HS256"],
      currentDate: opts.now,
    });
    if (payload.sub !== sessionUserId) return null;
    if (typeof payload.orgId !== "string" || !payload.orgId) return null;
    if (typeof payload.exp !== "number") return null;
    const keys = normalizePositionKeys(payload.keys);
    if (!keys) return null;
    return { sub: payload.sub, orgId: payload.orgId, keys, exp: payload.exp };
  } catch {
    return null;
  }
}
