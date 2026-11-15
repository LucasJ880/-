/**
 * Muse Bridge — 个人偏好记忆（P1-8，DB 侧；规则全在 prefs-pure.ts）
 *
 * 学习入口都是 best-effort：失败只 console.error，绝不影响调用方（选定供应商 / 发询价）。
 */

import { db } from "@/lib/db";
import { mutateOrgSettings } from "@/lib/organizations/settings-write";
import { learnIncoterm, learnSupplier, readUserPrefs, withUserPrefs, type MuseUserPrefs } from "./prefs-pure";

export async function loadUserPrefs(orgId: string, userId: string): Promise<MuseUserPrefs> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  return readUserPrefs(org?.settingsJson ?? null, userId);
}

/**
 * FIX-3：在锁里对这个人最新的偏好应用一次修改，返回修改后的偏好（组织不存在返回 null）。
 * fn 拿到的是此刻库里的偏好——不是调用方先前读到的那份；返回同一个对象 = 不写。
 */
export async function updateUserPrefs(orgId: string, userId: string, fn: (p: MuseUserPrefs) => MuseUserPrefs): Promise<MuseUserPrefs | null> {
  const res = await mutateOrgSettings(orgId, (current) => {
    const before = readUserPrefs(current, userId);
    const after = fn(before);
    if (after === before) return { result: before }; // 无变化不写
    return { next: withUserPrefs(current, userId, after), result: after };
  });
  return res.found ? res.result : null;
}

/** 整条保存这个人的偏好（组织设置里别的键原样保留）。新代码优先用 updateUserPrefs——它基于最新的偏好修改。 */
export async function saveUserPrefs(orgId: string, userId: string, prefs: MuseUserPrefs): Promise<void> {
  await mutateOrgSettings(orgId, (current) => ({ next: withUserPrefs(current, userId, prefs), result: null }));
}

async function updatePrefs(orgId: string, userId: string, fn: (p: MuseUserPrefs) => MuseUserPrefs): Promise<void> {
  await updateUserPrefs(orgId, userId, fn);
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
