/**
 * Playbook 执行模式（组织级，存 Organization.settingsJson）
 *
 * - off：紧急回退（不建议默认）
 * - warn：禁止自动发布；人工可用兼容上下文并告警（现有组织默认）
 * - enforce：进入发布审批也必须有批准 Playbook（新组织默认）
 */

import { db } from "@/lib/db";
import { mutateOrgSettings } from "@/lib/organizations/settings-write";

export type PlaybookEnforcementMode = "off" | "warn" | "enforce";

const VALID: PlaybookEnforcementMode[] = ["off", "warn", "enforce"];

export function parsePlaybookEnforcementMode(
  raw: unknown,
): PlaybookEnforcementMode | null {
  if (typeof raw !== "string") return null;
  return VALID.includes(raw as PlaybookEnforcementMode)
    ? (raw as PlaybookEnforcementMode)
    : null;
}

/** 未配置时：warn（旧组织兼容）；显式传入 defaultForNewOrg 时用于新建组织 */
export async function getPlaybookEnforcementMode(
  orgId: string,
  opts?: { defaultForNewOrg?: boolean },
): Promise<PlaybookEnforcementMode> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { settingsJson: true, createdAt: true },
  });
  const settings =
    org?.settingsJson && typeof org.settingsJson === "object"
      ? (org.settingsJson as Record<string, unknown>)
      : {};
  const parsed = parsePlaybookEnforcementMode(settings.playbookEnforcementMode);
  if (parsed) return parsed;
  if (opts?.defaultForNewOrg) return "enforce";
  return "warn";
}

export async function setPlaybookEnforcementMode(
  orgId: string,
  mode: PlaybookEnforcementMode,
): Promise<void> {
  // FIX-3：锁行后在最新的设置上只改这一项
  const res = await mutateOrgSettings(orgId, (current) => {
    const prev = current && typeof current === "object" ? { ...(current as Record<string, unknown>) } : {};
    prev.playbookEnforcementMode = mode;
    return { next: prev, result: null };
  });
  // 组织不存在时的既有行为：更新一条不存在的记录会抛错
  if (!res.found) throw new Error(`组织不存在：${orgId}`);
}
