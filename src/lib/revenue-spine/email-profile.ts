/**
 * Revenue Spine — 邮件里的公司资料（OrgBusinessRule：trade.email_profile，按版本发布）
 *
 * 给买家的邮件展示专业性靠具体、可核实的内容：公司一句话介绍、几个数字、工厂照片、业务员全名职务 WhatsApp、
 * 规格书口径的起订量 / 交期说法。这些都要公司确认后才填；**不填就不出现**，邮件照常发。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loadOrgEmailSender } from "@/lib/trade/email-sender";
import { safeUrl, type EmailBrand, type EmailSignature } from "./email-layout";
import { checkDraftGuardrails } from "./reply-draft";

export const RULE_KEY_EMAIL_PROFILE = "trade.email_profile";

export interface EmailProfileMember {
  /** 速记卡上写的名字（如 Cathy），按它匹配 */
  cardName: string;
  fullName: string;
  title: string | null;
  whatsapp: string | null;
}

export interface EmailProfile {
  accent: string;
  logoUrl: string | null;
  website: string | null;
  /** 公司默认 WhatsApp（业务员没填时用） */
  whatsapp: string | null;
  /** 英文一句话介绍，进首封 */
  companyLine: string | null;
  /** 最多 4 个数字，如 { value: "2008", label: "established in Jiande, Zhejiang" } */
  facts: Array<{ value: string; label: string }>;
  factImageUrl: string | null;
  /** 页脚地址 */
  address: string | null;
  /** 用规格书说法写起订量和交期（替代“需内部确认”那句） */
  specWording: boolean;
  /** 首封里提供视频看样 */
  videoCall: boolean;
  team: EmailProfileMember[];
}

export const EMPTY_EMAIL_PROFILE: EmailProfile = {
  accent: "#8E6657",
  logoUrl: null,
  website: null,
  whatsapp: null,
  companyLine: null,
  facts: [],
  factImageUrl: null,
  address: null,
  specWording: false,
  videoCall: false,
  team: [],
};

/** 规格书口径（确认后替代“需内部确认”） */
export const SPEC_WORDING = "MOQ is project-dependent and quoted after specification review. Production lead time is confirmed after sample approval.";

function str(v: unknown, max = 300): string | null {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
}

function lines(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : "")).filter(Boolean);
  return typeof v === "string" ? v.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : [];
}

function cols(line: string): string[] {
  return line.split(/\s*[|｜]\s*/).map((c) => c.trim());
}

/**
 * 校验设置页提交的内容。facts / team 可以是数组，也可以是多行文本：
 * facts 一行「数值 | 说明」，team 一行「卡上名字 | 全名 | 职务 | WhatsApp」。
 */
export function parseEmailProfile(input: unknown): { profile: EmailProfile | null; errors: string[] } {
  const o = (input ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const url = (key: string, label: string): string | null => {
    const raw = str(o[key], 500);
    if (!raw) return null;
    const ok = safeUrl(raw);
    if (!ok) errors.push(`${label}要以 https:// 开头`);
    return ok;
  };
  const accentRaw = str(o.accent, 7) ?? EMPTY_EMAIL_PROFILE.accent;
  if (!/^#[0-9a-f]{6}$/i.test(accentRaw)) errors.push("主色要写成 #RRGGBB");

  const facts = (Array.isArray(o.facts) ? (o.facts as Array<{ value?: unknown; label?: unknown }>).map((f) => [String(f.value ?? ""), String(f.label ?? "")]) : lines(o.facts).map(cols))
    .map(([value, label]) => ({ value: (value ?? "").slice(0, 24), label: (label ?? "").slice(0, 80) }))
    .filter((f) => f.value || f.label);
  for (const f of facts) if (!f.value || !f.label) errors.push(`公司数字要写成「数值 | 说明」：${f.value || f.label}`);
  if (facts.length > 4) errors.push("公司数字最多 4 个");

  const team: EmailProfileMember[] = [];
  const rawTeam = Array.isArray(o.team)
    ? (o.team as Array<Record<string, unknown>>).map((m) => [m.cardName, m.fullName, m.title, m.whatsapp].map((x) => (typeof x === "string" ? x : "")))
    : lines(o.team).map(cols);
  for (const [cardName, fullName, title, whatsapp] of rawTeam) {
    if (!cardName || !fullName) {
      errors.push(`业务员要写成「卡上名字 | 全名 | 职务 | WhatsApp」：${cardName || fullName || "（空行）"}`);
      continue;
    }
    team.push({ cardName: cardName.slice(0, 40), fullName: fullName.slice(0, 60), title: title ? title.slice(0, 60) : null, whatsapp: whatsapp ? whatsapp.slice(0, 30) : null });
  }

  const profile: EmailProfile = {
    accent: accentRaw,
    logoUrl: url("logoUrl", "Logo 链接"),
    website: url("website", "官网"),
    whatsapp: str(o.whatsapp, 30),
    companyLine: str(o.companyLine, 300),
    facts: facts.slice(0, 4),
    factImageUrl: url("factImageUrl", "工厂照片链接"),
    address: str(o.address, 200),
    specWording: o.specWording === true,
    videoCall: o.videoCall === true,
    team,
  };
  return errors.length ? { profile: null, errors } : { profile, errors };
}

/**
 * 公司介绍和数字会写进每一封首封：里面有价格、起订量、交期、认证等承诺的话，每封草稿都会被守卫拦下、进不了审批。
 * 保存时就挡住，告诉填的人哪一句不行（加载时不查，守卫以后收紧也不会让已保存的资料整份失效）。
 */
export function profileGuardrailErrors(p: EmailProfile): string[] {
  const parts: Array<[string, string]> = [
    ["公司介绍", p.companyLine ?? ""],
    ...p.facts.map((f): [string, string] => ["公司数字", `${f.value} ${f.label}`]),
    ["页脚地址", p.address ?? ""],
  ];
  return parts
    .filter(([, text]) => text.trim())
    .flatMap(([where, text]) => checkDraftGuardrails(text).map((v) => `${where}「${text}」：${v}。邮件里不能写这类承诺，会让每封草稿都进不了审批`));
}

export async function loadEmailProfile(orgId: string): Promise<EmailProfile> {
  const row = await db.orgBusinessRule.findFirst({
    where: { orgId, ruleKey: RULE_KEY_EMAIL_PROFILE, status: "active" },
    orderBy: { version: "desc" },
    select: { configJson: true },
  });
  const p = (row?.configJson as { profile?: unknown } | null)?.profile;
  if (!p) return EMPTY_EMAIL_PROFILE;
  return parseEmailProfile(p).profile ?? EMPTY_EMAIL_PROFILE;
}

export async function saveEmailProfile(orgId: string, profile: EmailProfile, userId: string | null): Promise<{ version: number }> {
  return db.$transaction(async (tx) => {
    const latest = await tx.orgBusinessRule.findFirst({
      where: { orgId, ruleKey: RULE_KEY_EMAIL_PROFILE },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    await tx.orgBusinessRule.updateMany({
      where: { orgId, ruleKey: RULE_KEY_EMAIL_PROFILE, status: "active" },
      data: { status: "superseded" },
    });
    await tx.orgBusinessRule.create({
      data: {
        orgId,
        ruleKey: RULE_KEY_EMAIL_PROFILE,
        version,
        status: "active",
        configJson: { profile } as unknown as Prisma.InputJsonValue,
        createdById: userId,
        updatedById: userId,
      },
    });
    return { version };
  });
}

/** 起草邮件要用的：公司资料、品牌（抬头 / 主色）、买家点「回复」的地址（组织发件身份；没设就不放回复按钮） */
export async function loadEmailBranding(orgId: string, orgName: string): Promise<{ profile: EmailProfile; brand: EmailBrand; replyEmail: string | null }> {
  const [profile, sender] = await Promise.all([loadEmailProfile(orgId), loadOrgEmailSender(orgId)]);
  return {
    profile,
    brand: { orgName, logoUrl: profile.logoUrl, accent: profile.accent },
    replyEmail: sender ? (sender.replyTo ?? sender.fromEmail) : null,
  };
}

/** 设置页的多行文本写法 */
export function emailProfileToForm(p: EmailProfile) {
  return {
    ...p,
    facts: p.facts.map((f) => `${f.value} | ${f.label}`).join("\n"),
    team: p.team.map((m) => [m.cardName, m.fullName, m.title ?? "", m.whatsapp ?? ""].join(" | ")).join("\n"),
  };
}

/** 落款：卡上的业务员在名单里就用全名、职务、WhatsApp；否则用传入的名字 + 公司 WhatsApp */
export function signatureFor(profile: EmailProfile, name: string, orgName: string): EmailSignature {
  const key = name.trim().toLowerCase();
  const m = profile.team.find((t) => t.cardName.toLowerCase() === key || t.fullName.toLowerCase() === key || t.fullName.toLowerCase().split(/\s+/)[0] === key);
  return {
    name: m?.fullName ?? name,
    title: m?.title ?? null,
    org: orgName,
    whatsapp: m?.whatsapp ?? profile.whatsapp,
    website: profile.website,
  };
}
