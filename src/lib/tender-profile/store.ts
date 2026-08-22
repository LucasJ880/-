import { db } from "@/lib/db";
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
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  const s = org?.settingsJson && typeof org.settingsJson === "object" && !Array.isArray(org.settingsJson)
    ? (org.settingsJson as Record<string, unknown>)
    : {};
  const current = tenderProfileSchema.safeParse(s[KEY] ?? {});
  const base = current.success ? current.data : emptyTenderProfile();
  const next = tenderProfileSchema.parse({ ...base, ...patch, updatedAt: new Date().toISOString() });
  await db.organization.update({
    where: { id: orgId },
    data: { settingsJson: JSON.parse(JSON.stringify({ ...s, [KEY]: next })) },
  });
  return next;
}
