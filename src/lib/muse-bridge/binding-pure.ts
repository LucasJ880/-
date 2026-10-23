/**
 * Muse Bridge — 绑定表读写与身份解析（纯函数，零 DB），供 binding.ts 与测试共用。
 */

import type { MuseErrorCode } from "./contract";

export type MuseBindingRecord = { userId: string; boundAt: string; boundBy: string };
export type MuseBindings = Record<string, MuseBindingRecord>;

export type MuseIdentity = {
  userId: string;
  orgId: string;
  /** User.role（系统角色），ApprovalDecisionContext 需要 */
  role: string | null;
  /** OrganizationMember.role */
  orgRole: string;
};

export type ResolveBindingResult =
  | { ok: true; identity: MuseIdentity }
  | { ok: false; errorCode: Extract<MuseErrorCode, "USER_NOT_BOUND" | "ORG_MEMBERSHIP_REQUIRED">; message: string };

/** 从 settingsJson 读绑定表（纯函数；坏数据一律当作空表）。 */
export function readMuseBindings(settingsJson: unknown): MuseBindings {
  if (!settingsJson || typeof settingsJson !== "object") return {};
  const mb = (settingsJson as Record<string, unknown>).museBridge;
  if (!mb || typeof mb !== "object") return {};
  const raw = (mb as Record<string, unknown>).bindings;
  if (!raw || typeof raw !== "object") return {};
  const out: MuseBindings = {};
  for (const [ref, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.userId !== "string" || !r.userId) continue;
    out[ref] = {
      userId: r.userId,
      boundAt: typeof r.boundAt === "string" ? r.boundAt : "",
      boundBy: typeof r.boundBy === "string" ? r.boundBy : "",
    };
  }
  return out;
}

/** 写回绑定表（纯函数：返回新的 settingsJson，不动其它键）。 */
export function withMuseBinding(
  settingsJson: unknown,
  museUserRef: string,
  record: MuseBindingRecord | null,
): Record<string, unknown> {
  const base = settingsJson && typeof settingsJson === "object" ? { ...(settingsJson as Record<string, unknown>) } : {};
  const mb = base.museBridge && typeof base.museBridge === "object" ? { ...(base.museBridge as Record<string, unknown>) } : {};
  const bindings = { ...readMuseBindings(base) };
  if (record) bindings[museUserRef] = record;
  else delete bindings[museUserRef];
  mb.bindings = bindings;
  base.museBridge = mb;
  return base;
}

/** 纯函数解析：给定绑定表 + 成员列表，判断身份。便于离线测试。 */
export function resolveBindingPure(input: {
  bindings: MuseBindings;
  museUserRef: string;
  orgId: string;
  members: Array<{ userId: string; status: string; orgRole: string; userRole: string | null }>;
}): ResolveBindingResult {
  const b = input.bindings[input.museUserRef];
  if (!b) {
    return { ok: false, errorCode: "USER_NOT_BOUND", message: "这个 Muse 账号还没有绑定青砚用户，请让组织管理员在青砚里完成绑定。" };
  }
  const m = input.members.find((x) => x.userId === b.userId && x.status === "active");
  if (!m) {
    return { ok: false, errorCode: "ORG_MEMBERSHIP_REQUIRED", message: "绑定的青砚用户不是该组织的有效成员，已拒绝。" };
  }
  return { ok: true, identity: { userId: b.userId, orgId: input.orgId, role: m.userRole, orgRole: m.orgRole } };
}

