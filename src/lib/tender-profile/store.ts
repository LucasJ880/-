import { db } from "@/lib/db";
import { mutateOrgSettings } from "@/lib/organizations/settings-write";
import { emptyTenderProfile, tenderProfileSchema, type TenderProfile } from "./contract";

const KEY = "tenderProfile";

export async function getTenderProfile(orgId: string): Promise<TenderProfile | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  const s = org?.settingsJson;
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const raw = (s as Record<string, unknown>)[KEY];
  if (!raw || typeof raw !== "object") return null;
  const parsed = tenderProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function saveTenderProfile(orgId: string, patch: Partial<TenderProfile>): Promise<TenderProfile> {
  const computeNext = (current: unknown) => {
    const s = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
    const parsed = tenderProfileSchema.safeParse(s[KEY] ?? {});
    const base = parsed.success ? parsed.data : emptyTenderProfile();
    const next = tenderProfileSchema.parse({ ...base, ...patch, updatedAt: new Date().toISOString() });
    return { next: JSON.parse(JSON.stringify({ ...s, [KEY]: next })) as unknown, result: next };
  };
  // FIX-3：锁行后在最新的设置上合并这次修改
  const res = await mutateOrgSettings(orgId, computeNext);
  // 组织不存在时照旧抛错（原来是更新一条不存在的记录时由数据库层抛出）
  if (!res.found) throw new Error(`组织不存在：${orgId}`);
  return res.result;
}
