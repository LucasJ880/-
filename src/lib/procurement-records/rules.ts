/**
 * PROC-1 机关申请规则（RuleProfile）。种子一律未核实；只有 org_admin 及以上真实用户核对官方页面后为 VERIFIED；
 * 之后任何修改回到 UNVERIFIED。未知费用为 null，不按 0 处理。门户字段只记已观察内容。
 *
 * 种子来源（任务书「官方参考」，核实基准日 2026-11-05，本会话未能联网复核）：
 *   S1 申请资格 / 费用 / 时限；S2 Access to Information Act 概述（仅保留 CAD 5 申请费）；
 *   S3 Completed ATI（既有披露副本可免费索取；非正式请求不套用正式时限）；S5 申请准备要求；S9 处理手册。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { isUniqueViolation } from "./instruments";

export const RULE_CHANNELS = ["FORMAL_ONLINE", "FORMAL_MAIL", "FORMAL_EMAIL", "INFORMAL_COPY"] as const;
export type RuleChannel = (typeof RULE_CHANNELS)[number];

export function ruleChannelFor(channel: string): RuleChannel {
  return channel === "INFORMAL" ? "INFORMAL_COPY" : "FORMAL_ONLINE";
}

const S = {
  S1: { label: "S1 联邦申请资格、费用和时限", url: "https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/how-access-information-personal-information-requests-work.html" },
  S2: { label: "S2 Access to Information Act 概述（仅保留 CAD 5 申请费）", url: "https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information-act.html" },
  S3: { label: "S3 Completed Access to Information Requests", url: "https://search.open.canada.ca/ati/" },
  S5: { label: "S5 官方申请准备要求（从此核实最新入口、账号与支付条件）", url: "https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/request-information/what-you-will-need.html" },
  S9: { label: "S9 联邦请求处理手册（实际期限计算前查对应条款）", url: "https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/access-information-manual.html" },
};

/** 我方字段 → 门户字段的对应（门户字段名未观察前一律 observed=false） */
export const OUR_FIELDS = [
  "申请人 / 公司法定名称",
  "代表人姓名",
  "地址",
  "邮箱",
  "接收机关",
  "申请正文（英文）",
  "记录期间（起止日）",
  "希望的记录格式（电子 / CSV / XLSX）",
  "申请费支付",
];

function fieldGuide() {
  return OUR_FIELDS.map((ourField) => ({ ourField, portalLabel: null, observed: false, observedAt: null, observedById: null }));
}

interface RuleSeed {
  jurisdiction: string;
  institutionKey: string;
  channel: RuleChannel;
  lawLabel: string;
  guidanceUrl: string | null;
  applicationFeeCents: number | null;
  currency: string | null;
  otherFeesRule: string | null;
  deadlineValue: number | null;
  deadlineUnit: string | null;
  selfServeSupported: boolean;
  sourceRefs: Array<{ label: string; url: string }>;
}

export const DEFAULT_RULE_SEEDS: RuleSeed[] = [
  {
    jurisdiction: "CA-FED",
    institutionKey: "*",
    channel: "FORMAL_ONLINE",
    lawLabel: "Access to Information Act (Canada)",
    guidanceUrl: S.S5.url,
    applicationFeeCents: 500,
    currency: "CAD",
    otherFeesRule: "现行制度只收 CAD 5 申请费，取消了申请费以外的其他费用（S2）；不得套用省级检索 / 处理费模板",
    deadlineValue: 30,
    deadlineUnit: "CALENDAR_DAYS",
    selfServeSupported: true,
    sourceRefs: [S.S1, S.S2, S.S5, S.S9],
  },
  {
    jurisdiction: "CA-FED",
    institutionKey: "*",
    channel: "INFORMAL_COPY",
    lawLabel: "Completed ATI requests — informal copy of previously released records",
    guidanceUrl: S.S3.url,
    applicationFeeCents: 0,
    currency: "CAD",
    otherFeesRule: "既有披露副本可通过官方机制免费索取（S3）；发出索取仍是对外申请；非正式请求不适用正式申请的法定时限",
    deadlineValue: null,
    deadlineUnit: null,
    selfServeSupported: true,
    sourceRefs: [S.S3],
  },
  ...(
    [
      ["CA-ON", "Freedom of Information and Protection of Privacy Act (Ontario)"],
      ["CA-BC", "Freedom of Information and Protection of Privacy Act (British Columbia)"],
      ["CA-MB", "The Freedom of Information and Protection of Privacy Act (Manitoba)"],
      ["CA-SK", "The Freedom of Information and Protection of Privacy Act (Saskatchewan)"],
    ] as const
  ).map(([jurisdiction, lawLabel]) => ({
    jurisdiction,
    institutionKey: "*",
    channel: "FORMAL_ONLINE" as RuleChannel,
    lawLabel,
    guidanceUrl: null,
    applicationFeeCents: null,
    currency: "CAD",
    otherFeesRule: "省 / 市费用（含检索、处理费）与时限须分别核实；不得套用联邦规则",
    deadlineValue: null,
    deadlineUnit: null,
    selfServeSupported: false,
    sourceRefs: [],
  })),
];

/** 补齐缺省规则（已存在的不改，保留用户核实结果） */
export async function ensureDefaultRules(orgId: string): Promise<void> {
  const existing = await db.recordsRuleProfile.findMany({ where: { orgId }, select: { jurisdiction: true, institutionKey: true, channel: true } });
  const has = new Set(existing.map((e) => `${e.jurisdiction}|${e.institutionKey}|${e.channel}`));
  for (const s of DEFAULT_RULE_SEEDS) {
    if (has.has(`${s.jurisdiction}|${s.institutionKey}|${s.channel}`)) continue;
    try {
      await db.recordsRuleProfile.create({
        data: {
          orgId,
          jurisdiction: s.jurisdiction,
          institutionKey: s.institutionKey,
          channel: s.channel,
          lawLabel: s.lawLabel,
          guidanceUrl: s.guidanceUrl,
          officialPortalUrl: null,
          applicationFeeCents: s.applicationFeeCents,
          currency: s.currency,
          otherFeesRule: s.otherFeesRule,
          deadlineValue: s.deadlineValue,
          deadlineUnit: s.deadlineUnit,
          selfServeSupported: s.selfServeSupported,
          sourceRefsJson: s.sourceRefs as unknown as Prisma.InputJsonValue,
          fieldGuideJson: fieldGuide() as unknown as Prisma.InputJsonValue,
          verificationStatus: "UNVERIFIED",
          verificationMethod: "种子：任务书引用的官方来源（核实基准日 2026-11-05），尚未由用户核对官方页面",
        },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
}

/** 先找机关专属规则，再找辖区缺省 "*" */
export async function findRule(orgId: string, jurisdiction: string, institutionKey: string | null, channel: string) {
  const ch = ruleChannelFor(channel);
  if (institutionKey) {
    const specific = await db.recordsRuleProfile.findUnique({ where: { orgId_jurisdiction_institutionKey_channel: { orgId, jurisdiction, institutionKey, channel: ch } } });
    if (specific) return specific;
  }
  return db.recordsRuleProfile.findUnique({ where: { orgId_jurisdiction_institutionKey_channel: { orgId, jurisdiction, institutionKey: "*", channel: ch } } });
}

export async function listRules(orgId: string) {
  await ensureDefaultRules(orgId);
  return db.recordsRuleProfile.findMany({ where: { orgId }, orderBy: [{ jurisdiction: "asc" }, { institutionKey: "asc" }, { channel: "asc" }] });
}

export interface RuleUpdateInput {
  officialPortalUrl?: string | null;
  guidanceUrl?: string | null;
  applicationFeeCents?: number | null;
  currency?: string | null;
  otherFeesRule?: string | null;
  deadlineValue?: number | null;
  deadlineUnit?: string | null;
  effectiveFrom?: string | null;
  selfServeSupported?: boolean;
  lawLabel?: string;
}

function validUrl(u: string | null | undefined): boolean {
  if (u === null || u === undefined) return true;
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "mailto:";
  } catch {
    return false;
  }
}

/**
 * 修改规则：任何修改回到 UNVERIFIED。verify=true 时要求入口与费用已知、写明核实方法，置 VERIFIED 并记核实人与时间。
 */
export async function updateRule(input: {
  orgId: string;
  ruleId: string;
  userId: string;
  patch: RuleUpdateInput;
  verify?: { method: string } | null;
}): Promise<{ ok: true } | { ok: false; status: 400 | 404; code: string; message: string }> {
  const rule = await db.recordsRuleProfile.findFirst({ where: { id: input.ruleId, orgId: input.orgId } });
  if (!rule) return { ok: false, status: 404, code: "RULE_NOT_FOUND", message: "规则不存在" };
  const p = input.patch;
  if (!validUrl(p.officialPortalUrl) || !validUrl(p.guidanceUrl)) return { ok: false, status: 400, code: "INVALID_URL", message: "入口必须是 https 或 mailto 地址" };
  if (p.applicationFeeCents !== undefined && p.applicationFeeCents !== null && (!Number.isInteger(p.applicationFeeCents) || p.applicationFeeCents < 0)) {
    return { ok: false, status: 400, code: "INVALID_FEE", message: "费用须为非负整数分，或 null 表示未知" };
  }
  if (p.deadlineUnit !== undefined && p.deadlineUnit !== null && !["CALENDAR_DAYS", "BUSINESS_DAYS"].includes(p.deadlineUnit)) {
    return { ok: false, status: 400, code: "INVALID_DEADLINE_UNIT", message: "时限单位只能是 CALENDAR_DAYS / BUSINESS_DAYS" };
  }
  const next = {
    officialPortalUrl: p.officialPortalUrl !== undefined ? p.officialPortalUrl : rule.officialPortalUrl,
    applicationFeeCents: p.applicationFeeCents !== undefined ? p.applicationFeeCents : rule.applicationFeeCents,
  };
  if (input.verify) {
    if (!input.verify.method?.trim() || input.verify.method.trim().length < 6) return { ok: false, status: 400, code: "VERIFY_METHOD_REQUIRED", message: "请写明核实方法（打开了哪个官方页面、看到了什么）" };
    if (!next.officialPortalUrl) return { ok: false, status: 400, code: "PORTAL_REQUIRED", message: "核实时必须填写官方提交入口" };
    if (next.applicationFeeCents === null) return { ok: false, status: 400, code: "FEE_REQUIRED", message: "核实时必须填写费用（免费填 0）" };
  }
  await db.recordsRuleProfile.update({
    where: { id: rule.id },
    data: {
      ...(p.lawLabel !== undefined ? { lawLabel: p.lawLabel } : {}),
      ...(p.officialPortalUrl !== undefined ? { officialPortalUrl: p.officialPortalUrl } : {}),
      ...(p.guidanceUrl !== undefined ? { guidanceUrl: p.guidanceUrl } : {}),
      ...(p.applicationFeeCents !== undefined ? { applicationFeeCents: p.applicationFeeCents } : {}),
      ...(p.currency !== undefined ? { currency: p.currency } : {}),
      ...(p.otherFeesRule !== undefined ? { otherFeesRule: p.otherFeesRule } : {}),
      ...(p.deadlineValue !== undefined ? { deadlineValue: p.deadlineValue } : {}),
      ...(p.deadlineUnit !== undefined ? { deadlineUnit: p.deadlineUnit } : {}),
      ...(p.effectiveFrom !== undefined ? { effectiveFrom: p.effectiveFrom ? new Date(`${p.effectiveFrom}T00:00:00Z`) : null } : {}),
      ...(p.selfServeSupported !== undefined ? { selfServeSupported: p.selfServeSupported } : {}),
      ...(input.verify
        ? { verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedById: input.userId, verificationMethod: input.verify.method.trim().slice(0, 1000) }
        : { verificationStatus: "UNVERIFIED", verifiedAt: null, verifiedById: null }),
    },
  });
  await logAudit({ userId: input.userId, orgId: input.orgId, action: input.verify ? "records_rule.verify" : "records_rule.update", targetType: "records_rule", targetId: rule.id, afterData: { ...p, verified: Boolean(input.verify) } as Record<string, unknown> });
  return { ok: true };
}

/** 记录一次门户字段的实际观察（只记观察到的标签，不改变规则核实状态） */
export async function recordFieldObservation(input: { orgId: string; ruleId: string; userId: string; ourField: string; portalLabel: string }) {
  const rule = await db.recordsRuleProfile.findFirst({ where: { id: input.ruleId, orgId: input.orgId }, select: { id: true, fieldGuideJson: true } });
  if (!rule) return { ok: false as const, status: 404 as const, code: "RULE_NOT_FOUND" };
  const guide = (Array.isArray(rule.fieldGuideJson) ? rule.fieldGuideJson : []) as Array<Record<string, unknown>>;
  const now = new Date().toISOString();
  const idx = guide.findIndex((g) => g.ourField === input.ourField);
  const entry = { ourField: input.ourField, portalLabel: input.portalLabel.trim().slice(0, 200), observed: true, observedAt: now, observedById: input.userId };
  if (idx >= 0) guide[idx] = entry;
  else guide.push(entry);
  await db.recordsRuleProfile.update({ where: { id: rule.id }, data: { fieldGuideJson: guide as unknown as Prisma.InputJsonValue } });
  return { ok: true as const };
}
