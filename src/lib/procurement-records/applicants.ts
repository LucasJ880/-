/**
 * PROC-1 申请人资料：修改即版本 +1 并回到未确认；只有真实用户确认后可用于 READY。
 * 不从历史来信 / 回复信自动带出地址；系统不补造姓名、地址或编号。
 */

import { z } from "zod";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { applicantCanonicalKey } from "./identity";
import { REQUIRED_APPLICANT_FIELDS } from "./ready-gate";

const field = z.string().trim().max(200).nullable().optional();

export const applicantInputSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  legalName: field,
  representativeName: field,
  addressLine1: field,
  addressLine2: field,
  city: field,
  province: field,
  postalCode: field,
  country: field,
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: field,
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type ApplicantInput = z.infer<typeof applicantInputSchema>;

const VERSIONED_FIELDS = ["legalName", "representativeName", "addressLine1", "addressLine2", "city", "province", "postalCode", "country", "email", "phone"] as const;

export async function listApplicants(orgId: string) {
  return db.recordsApplicantProfile.findMany({ where: { orgId, archivedAt: null }, orderBy: { createdAt: "asc" } });
}

export async function saveApplicant(input: { orgId: string; userId: string; id?: string | null; body: unknown }) {
  const parsed = applicantInputSchema.safeParse(input.body ?? {});
  if (!parsed.success) return { ok: false as const, status: 400 as const, code: "INVALID_APPLICANT", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("；") };
  const d = parsed.data;
  const clean = (v: string | null | undefined) => (v === undefined ? undefined : v && v.trim() ? v.trim() : null);
  if (!input.id) {
    const row = await db.recordsApplicantProfile.create({
      data: {
        orgId: input.orgId,
        label: d.label ?? "申请人",
        legalName: clean(d.legalName) ?? null,
        representativeName: clean(d.representativeName) ?? null,
        addressLine1: clean(d.addressLine1) ?? null,
        addressLine2: clean(d.addressLine2) ?? null,
        city: clean(d.city) ?? null,
        province: clean(d.province) ?? null,
        postalCode: clean(d.postalCode) ?? null,
        country: clean(d.country) ?? null,
        email: clean(d.email) ?? null,
        phone: clean(d.phone) ?? null,
        notes: clean(d.notes) ?? null,
        canonicalKey: applicantCanonicalKey(d.legalName),
        createdById: input.userId,
      },
    });
    await logAudit({ userId: input.userId, orgId: input.orgId, action: "records_applicant.create", targetType: "records_applicant", targetId: row.id, afterData: { label: row.label, version: 1 } });
    return { ok: true as const, applicant: row };
  }
  const existing = await db.recordsApplicantProfile.findFirst({ where: { id: input.id, orgId: input.orgId } });
  if (!existing) return { ok: false as const, status: 404 as const, code: "APPLICANT_NOT_FOUND", message: "申请人资料不存在" };
  const changes: Record<string, string | null> = {};
  for (const f of VERSIONED_FIELDS) {
    const v = clean(d[f]);
    if (v !== undefined && v !== existing[f]) changes[f] = v;
  }
  const versioned = Object.keys(changes).length > 0;
  const row = await db.recordsApplicantProfile.update({
    where: { id: existing.id },
    data: {
      ...changes,
      ...(d.label !== undefined ? { label: d.label } : {}),
      ...(d.notes !== undefined ? { notes: clean(d.notes) ?? null } : {}),
      ...(versioned
        ? {
            version: { increment: 1 },
            verificationStatus: "UNCONFIRMED",
            confirmedById: null,
            confirmedAt: null,
            canonicalKey: applicantCanonicalKey(changes.legalName !== undefined ? changes.legalName : existing.legalName),
          }
        : {}),
    },
  });
  // 审计只记改了哪些字段，不记字段值（地址 / 邮箱不进审计摘要）
  await logAudit({ userId: input.userId, orgId: input.orgId, action: "records_applicant.update", targetType: "records_applicant", targetId: row.id, afterData: { changedFields: Object.keys(changes), version: row.version } });
  return { ok: true as const, applicant: row };
}

export async function confirmApplicant(input: { orgId: string; userId: string; id: string; expectedVersion: number }) {
  const row = await db.recordsApplicantProfile.findFirst({ where: { id: input.id, orgId: input.orgId, archivedAt: null } });
  if (!row) return { ok: false as const, status: 404 as const, code: "APPLICANT_NOT_FOUND", message: "申请人资料不存在" };
  if (row.version !== input.expectedVersion) return { ok: false as const, status: 409 as const, code: "APPLICANT_VERSION_CHANGED", message: "资料已被修改，请刷新后重新核对再确认" };
  const missing = REQUIRED_APPLICANT_FIELDS.filter((f) => !row[f]?.trim());
  if (missing.length) return { ok: false as const, status: 400 as const, code: "APPLICANT_INCOMPLETE", message: `必填资料缺失：${missing.join("、")}` };
  const res = await db.recordsApplicantProfile.updateMany({
    where: { id: row.id, version: input.expectedVersion },
    data: { verificationStatus: "CONFIRMED", confirmedById: input.userId, confirmedAt: new Date() },
  });
  if (res.count !== 1) return { ok: false as const, status: 409 as const, code: "APPLICANT_VERSION_CHANGED", message: "资料已被修改，请刷新后重新核对再确认" };
  await logAudit({ userId: input.userId, orgId: input.orgId, action: "records_applicant.confirm", targetType: "records_applicant", targetId: row.id, afterData: { version: row.version } });
  return { ok: true as const };
}

export function applicantSnapshot(a: { id: string; version: number; label: string; legalName: string | null; representativeName: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; province: string | null; postalCode: string | null; country: string | null; email: string | null; phone: string | null; verificationStatus: string }) {
  return {
    id: a.id,
    version: a.version,
    label: a.label,
    legalName: a.legalName,
    representativeName: a.representativeName,
    addressLine1: a.addressLine1,
    addressLine2: a.addressLine2,
    city: a.city,
    province: a.province,
    postalCode: a.postalCode,
    country: a.country,
    email: a.email,
    phone: a.phone,
    verificationStatus: a.verificationStatus,
  };
}
