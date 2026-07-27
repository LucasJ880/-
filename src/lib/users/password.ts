/**
 * 登录密码：仅存 bcrypt 哈希，永不存储/返回明文。
 */

import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { PASSWORD_MIN_LENGTH } from "@/lib/users/password-constants";

export { PASSWORD_MIN_LENGTH };

const BCRYPT_ROUNDS = 12;

export function validateNewPassword(password: string): string | null {
  const p = password.trim();
  if (p.length < PASSWORD_MIN_LENGTH) {
    return `密码至少 ${PASSWORD_MIN_LENGTH} 位`;
  }
  if (p.length > 128) {
    return "密码过长";
  }
  return null;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain.trim(), BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (!passwordHash) return false;
  return bcrypt.compare(plain.trim(), passwordHash);
}

export async function setUserPasswordHash(
  userId: string,
  plainPassword: string,
): Promise<void> {
  const passwordHash = await hashPassword(plainPassword);
  await db.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}
