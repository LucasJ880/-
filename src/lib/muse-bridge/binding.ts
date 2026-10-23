/**
 * Muse Bridge — 身份绑定（零 schema）
 *
 * 存储：Organization.settingsJson.museBridge.bindings[museUserRef] = { userId, boundAt, boundBy }
 *（沿用 tenderProfile 的"存 settingsJson、零 migration"先例）。
 *
 * 解析顺序（fail-closed）：
 *   org 存在 → org 在允许名单 → museUserRef 有绑定 → userId 是该 org 的 active 成员 → 返回身份
 * 任一环节失败 → 具体错误码；绝不回退到"猜一个用户"。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  readMuseBindings,
  resolveBindingPure,
  withMuseBinding,
  type MuseBindingRecord,
  type MuseBindings,
  type MuseIdentity,
  type ResolveBindingResult,
} from "./binding-pure";

export { readMuseBindings, resolveBindingPure, withMuseBinding };
export type { MuseBindingRecord, MuseBindings, MuseIdentity, ResolveBindingResult };

/** DB 版：读 org settings + membership，再走纯函数。 */
export async function resolveMuseBinding(orgId: string, museUserRef: string): Promise<ResolveBindingResult> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  if (!org) {
    return { ok: false, errorCode: "ORG_MEMBERSHIP_REQUIRED", message: "组织不存在。" };
  }
  const bindings = readMuseBindings(org.settingsJson);
  const target = bindings[museUserRef];
  const members = target
    ? await db.organizationMember.findMany({
        where: { orgId, userId: target.userId },
        select: { userId: true, status: true, role: true, user: { select: { role: true } } },
      })
    : [];
  return resolveBindingPure({
    bindings,
    museUserRef,
    orgId,
    members: members.map((m) => ({ userId: m.userId, status: m.status, orgRole: m.role, userRole: m.user?.role ?? null })),
  });
}

/** 管理员绑定/解绑（调用方必须已校验 org 管理权限）。 */
export async function setMuseBinding(input: {
  orgId: string;
  museUserRef: string;
  userId: string | null;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const org = await db.organization.findUnique({ where: { id: input.orgId }, select: { settingsJson: true } });
  if (!org) return { ok: false, error: "组织不存在" };
  if (input.userId) {
    const member = await db.organizationMember.findFirst({
      where: { orgId: input.orgId, userId: input.userId, status: "active" },
      select: { id: true },
    });
    if (!member) return { ok: false, error: "目标用户不是该组织有效成员" };
  }
  const next = withMuseBinding(
    org.settingsJson,
    input.museUserRef,
    input.userId ? { userId: input.userId, boundAt: new Date().toISOString(), boundBy: input.actorUserId } : null,
  );
  await db.organization.update({ where: { id: input.orgId }, data: { settingsJson: next as Prisma.InputJsonValue } });
  return { ok: true };
}
