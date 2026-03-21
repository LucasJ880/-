import { isValidEmail, isNonEmptyString } from "@/lib/common/validation";
import { ENTITY_STATUS } from "@/lib/common/constants";

// ============================================================
// User 校验
// ============================================================

export interface UserProfileInput {
  name?: string;
  nickname?: string;
  avatar?: string;
  phone?: string;
}

export function validateUserProfile(
  input: UserProfileInput
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (input.name !== undefined && !isNonEmptyString(input.name)) {
    errors.push("名称不能为空");
  }
  if (input.name && input.name.length > 64) {
    errors.push("名称长度不能超过 64 字符");
  }
  if (input.nickname && input.nickname.length > 64) {
    errors.push("昵称长度不能超过 64 字符");
  }
  if (input.phone && !/^[\d\-+() ]{6,20}$/.test(input.phone)) {
    errors.push("手机号格式不正确");
  }

  return errors.length ? { valid: false, errors } : { valid: true };
}

export function validateEmail(email: unknown): email is string {
  return typeof email === "string" && isValidEmail(email);
}

export function isValidUserStatus(status: string): boolean {
  return Object.values(ENTITY_STATUS).includes(status as EntityStatus);
}

type EntityStatus = (typeof ENTITY_STATUS)[keyof typeof ENTITY_STATUS];
