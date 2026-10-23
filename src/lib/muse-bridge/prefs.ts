/**
 * Muse Bridge — 个人偏好记忆（P1-8，DB 侧；规则全在 prefs-pure.ts）
 *
 * 学习入口都是 best-effort：失败只 console.error，绝不影响调用方（选定供应商 / 发询价）。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { learnIncoterm, learnSupplier, readUserPrefs, withUserPrefs, type MuseUserPrefs } from "./prefs-pure";

export async function loadUserPrefs(orgId: string, userId: string): Promise<MuseUserPrefs> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  return readUserPrefs(org?.settingsJson ?? null, userId);
}

export async function saveUserPrefs(orgId: string, userId: string, prefs: MuseUserPrefs): Promise<void> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  if (!org) return;
  await db.organization.update({
    where: { id: orgId },
    data: { settingsJson: withUserPrefs(org.settingsJson, userId, prefs) as Prisma.InputJsonValue },
  });
}

async function updatePrefs(orgId: string, userId: string, fn: (p: MuseUserPrefs) => MuseUserPrefs): Promise<void> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  if (!org) return;
  const before = readUserPrefs(org.settingsJson, userId);
  const after = fn(before);
  if (after === before) return; // 无变化不写
  await db.organization.update({
    where: { id: orgId },
    data: { settingsJson: withUserPrefs(org.settingsJson, userId, after) as Prisma.InputJsonValue },
  });
}

/** selectItem 成功后：操作者本人的常用供应商挪到最前（上限 5） */
export async function learnSupplierPreference(input: { projectId: string; userId: string; supplierId: string }): Promise<void> {
  try {
    const project = await db.project.findUnique({ where: { id: input.projectId }, select: { orgId: true } });
    if (!project?.orgId) return;
    await updatePrefs(project.orgId, input.userId, (p) => learnSupplier(p, input.supplierId, new Date()));
  } catch (err) {
    console.error("[muse-bridge] learnSupplierPreference failed:", err);
  }
}

/** 询价批准并发出后：记下这轮贸易条款（仅当操作者之前没有默认值） */
export async function learnIncotermPreference(input: { orgId: string; userId: string; incoterm: string | null | undefined }): Promise<void> {
  try {
    if (!input.incoterm) return;
    await updatePrefs(input.orgId, input.userId, (p) => learnIncoterm(p, input.incoterm, new Date()));
  } catch (err) {
    console.error("[muse-bridge] learnIncotermPreference failed:", err);
  }
}
