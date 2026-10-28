/**
 * 厂家入驻向导（PRD F6）— 纯函数层
 *
 * 输入校验、品类发布计划、就绪清单推导、测试询盘载荷与测试标记。
 * 本文件不引用 db 客户端与 Next.js 运行时（upsertMembership 只用调用方传入的事务），
 * 可被注册路由 / 发送执行器 / 向导页面 / 单测直接引用；DB 编排见 ./onboarding.ts 与 ./onboarding-test-inquiry.ts。
 */

import type { Prisma } from "@prisma/client";
import { isValidTimeZone } from "@/lib/automation/local-time";
import {
  isSelectableIndustryPackId,
  type IndustryPackId,
  type ProductCategoryCatalogEntry,
} from "@/lib/industry-packs/registry";
import { hasOrgRole, type OrgRole } from "@/lib/rbac/roles";

/** settingsJson.onboarding.version */
export const ONBOARDING_SETTINGS_VERSION = 1;
export const DEFAULT_FACTORY_TIMEZONE = "Asia/Shanghai";

// ── 测试询盘标记（Revenue Spine 指标 / 队列据此排除）─────────────────────────

/** 测试询盘的 utm_source（落在收据 payload 与 CustomerInteraction.analysisResult.utm） */
export const ONBOARDING_TEST_UTM_SOURCE = "qingyan_onboarding_test";
/** 测试买家 SalesCustomer.tags 标记；发送执行器见此标记一律拒发 */
export const ONBOARDING_TEST_TAG = "qingyan_onboarding_test";
/** 测试商机关闭原因（SalesOpportunity.lostReason） */
export const ONBOARDING_TEST_CLOSE_REASON = "onboarding test";
/**
 * 指标查询排除测试商机的 where 片段（SalesOpportunity）。lostReason 可空，必须显式保留 NULL 行；
 * 用法：where: { orgId, AND: [EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES] }
 */
export const EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES = {
  OR: [{ lostReason: null }, { lostReason: { not: ONBOARDING_TEST_CLOSE_REASON } }],
};
/**
 * 测试草稿系统终止原因（PendingAction.failureReason 前缀）：经 pending-actions/supersede 的系统作废原语写入，
 * status=failed、不写 decidedById（不是人类拒绝）
 */
export const ONBOARDING_TEST_PENDING_ACTION_REASON = "SUPERSEDED_BY_ONBOARDING_TEST";
/** RFC 2606 保留域名：即使误发也不会到达真实买家 */
export const ONBOARDING_TEST_BUYER_EMAIL = "onboarding-test@example.com";
export const ONBOARDING_TEST_BUYER_COMPANY = "【入驻测试】Qingyan Test Buyer";
const ONBOARDING_TEST_EVENT_PREFIX = "onboarding-test-";

export function onboardingTestEventPrefix(orgId: string): string {
  return `${ONBOARDING_TEST_EVENT_PREFIX}${orgId}-`;
}

export function onboardingTestEventId(orgId: string, counter: number): string {
  return `${onboardingTestEventPrefix(orgId)}${counter}`;
}

export function isOnboardingTestEventId(eventId: string | null | undefined): boolean {
  return typeof eventId === "string" && eventId.startsWith(ONBOARDING_TEST_EVENT_PREFIX);
}

/** 下一次测试的序号：已有该 org 测试事件 id 的最大序号 + 1 */
export function nextOnboardingTestCounter(orgId: string, existingEventIds: string[]): number {
  const prefix = onboardingTestEventPrefix(orgId);
  let max = 0;
  for (const id of existingEventIds) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

function splitTags(tags: string | null | undefined): string[] {
  return (tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function hasOnboardingTestTag(tags: string | null | undefined): boolean {
  return splitTags(tags).includes(ONBOARDING_TEST_TAG);
}

export function withOnboardingTestTag(tags: string | null | undefined): string {
  const list = splitTags(tags);
  if (!list.includes(ONBOARDING_TEST_TAG)) list.push(ONBOARDING_TEST_TAG);
  return list.join(",");
}

/** 测试询盘原始载荷（交给 normalizeInquiry；与网站表单字段同名） */
export function buildOnboardingTestInquiryPayload(input: {
  orgId: string;
  counter: number;
  productLabelEn: string | null;
}): Record<string, string> {
  const product = (input.productLabelEn ?? "").trim() || "home textile products";
  return {
    name: "Test Buyer",
    email: ONBOARDING_TEST_BUYER_EMAIL,
    company: ONBOARDING_TEST_BUYER_COMPANY,
    country: "Canada",
    product,
    message:
      `Hello, we are a home goods importer in Canada and we are interested in ${product}. ` +
      `Could you share your catalog, MOQ and production lead time? ` +
      `[Qingyan onboarding test #${input.counter}: synthetic inquiry, closed automatically and never sent to a buyer]`,
    page: "qingyan://onboarding-test",
    utm_source: ONBOARDING_TEST_UTM_SOURCE,
    utm_medium: "onboarding",
    utm_campaign: `onboarding-test-${input.counter}`,
    eventId: onboardingTestEventId(input.orgId, input.counter),
  };
}

// ── 输入校验 ─────────────────────────────────────────────────────────────

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const ORG_CODE_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

interface ProvisionRequest {
  name: string;
  code: string;
  industryPackId: IndustryPackId;
  timezone: string;
  /** 工厂老板的登录邮箱（须已注册）；空 = 平台管理员暂为组织 owner */
  ownerEmail: string | null;
}

export function validateProvisionRequest(raw: unknown): Validation<ProvisionRequest> {
  const o = rec(raw) ?? {};
  const errors: string[] = [];
  const name = trimmed(o.name).replace(/\s+/g, " ");
  const code = trimmed(o.code).toLowerCase();
  const industryPackId = trimmed(o.industryPackId);
  const timezone = trimmed(o.timezone) || DEFAULT_FACTORY_TIMEZONE;
  const ownerEmail = trimmed(o.ownerEmail).toLowerCase();

  if (!name) errors.push("请填写企业名称");
  else if (name.length > 100) errors.push("企业名称不能超过 100 个字");
  if (!code) errors.push("请填写企业 code");
  else if (!ORG_CODE_RE.test(code)) errors.push("code 仅允许小写字母、数字、连字符，2–63 位，且以字母或数字开头");
  else if (code.startsWith("personal-")) errors.push("personal- 开头的 code 保留给个人工作区");
  if (!isSelectableIndustryPackId(industryPackId)) errors.push("请选择有效的行业包");
  if (!isValidTimeZone(timezone)) errors.push(`无效的时区：${timezone}`);
  if (ownerEmail && !EMAIL_RE.test(ownerEmail)) errors.push("老板邮箱格式不正确");

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      code,
      industryPackId: industryPackId as IndustryPackId,
      timezone,
      ownerEmail: ownerEmail || null,
    },
  };
}

export const ACKNOWLEDGEABLE_STEPS = ["wechat", "email_sender"] as const;
export type AcknowledgeableStep = (typeof ACKNOWLEDGEABLE_STEPS)[number];

export interface OnboardingPatchRequest {
  timezone?: string;
  industryPackId?: IndustryPackId;
  /** 指定工厂老板（须已注册）：组织 ownerId + org_owner 成员 */
  ownerEmail?: string;
  /** true = 管理员确认可跳过；false = 撤销确认 */
  acknowledge?: Partial<Record<AcknowledgeableStep, boolean>>;
  /** 交接：操作者（平台管理员）本人退出该企业成员，不再收该厂询盘通知 */
  leaveOrg?: true;
}

export function validateOnboardingPatch(raw: unknown): Validation<OnboardingPatchRequest> {
  const o = rec(raw) ?? {};
  const errors: string[] = [];
  const out: OnboardingPatchRequest = {};
  if (o.timezone !== undefined) {
    const tz = trimmed(o.timezone);
    if (!isValidTimeZone(tz)) errors.push(`无效的时区：${tz || "（空）"}`);
    else out.timezone = tz;
  }
  if (o.industryPackId !== undefined) {
    const id = trimmed(o.industryPackId);
    if (!isSelectableIndustryPackId(id)) errors.push("请选择有效的行业包");
    else out.industryPackId = id;
  }
  if (o.ownerEmail !== undefined) {
    const email = trimmed(o.ownerEmail).toLowerCase();
    if (!EMAIL_RE.test(email)) errors.push("老板邮箱格式不正确");
    else out.ownerEmail = email;
  }
  if (o.acknowledge !== undefined) {
    const ack = rec(o.acknowledge);
    if (!ack) errors.push("acknowledge 须为对象");
    else {
      out.acknowledge = {};
      for (const [k, v] of Object.entries(ack)) {
        if (!(ACKNOWLEDGEABLE_STEPS as readonly string[]).includes(k)) errors.push(`该步骤不可手动确认：${k}`);
        else if (typeof v !== "boolean") errors.push(`acknowledge.${k} 须为 true / false`);
        else out.acknowledge[k as AcknowledgeableStep] = v;
      }
    }
  }
  if (o.leaveOrg !== undefined) {
    if (o.leaveOrg !== true) errors.push("leaveOrg 只能为 true");
    else out.leaveOrg = true;
  }
  if (!errors.length && Object.keys(out).length === 0) errors.push("没有可更新的字段");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export interface CategorySelection {
  make: string[];
  dontMake: string[];
  excludedCategoryAction: "review" | "decline";
}

/** 做 / 不做：都必须来自 Pack 品类目录；两边不能重叠；至少勾一个「做」。未勾的 = 不确定 */
export function validateCategorySelection(
  raw: unknown,
  catalog: ProductCategoryCatalogEntry[] | undefined,
): Validation<CategorySelection> {
  if (!catalog?.length) return { ok: false, errors: ["该企业的行业包没有品类目录，无需勾选品类"] };
  const o = rec(raw) ?? {};
  const errors: string[] = [];
  const known = new Set(catalog.map((c) => c.key));
  const list = (v: unknown, label: string): string[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      errors.push(`${label} 须为数组`);
      return [];
    }
    const out: string[] = [];
    for (const x of v) {
      const k = trimmed(x);
      if (!k) continue;
      if (!known.has(k)) errors.push(`未知品类：${k}`);
      else if (!out.includes(k)) out.push(k);
    }
    return out;
  };
  const make = list(o.make, "make");
  const dontMake = list(o.dontMake, "dontMake");
  const overlap = make.filter((k) => dontMake.includes(k));
  if (overlap.length) errors.push(`同一品类不能既做又不做：${overlap.join(", ")}`);
  if (!make.length) errors.push("至少勾选一个「做」的品类");
  const action = o.excludedCategoryAction;
  if (action !== undefined && action !== "review" && action !== "decline") {
    errors.push("excludedCategoryAction 只能是 review 或 decline");
  }
  if (errors.length) return { ok: false, errors };
  const order = (keys: string[]) => catalog.map((c) => c.key).filter((k) => keys.includes(k));
  return {
    ok: true,
    value: {
      make: order(make),
      dontMake: order(dontMake),
      excludedCategoryAction: action === "decline" ? "decline" : "review",
    },
  };
}

/**
 * 品类发布计划：在当前生效的 business_profile 原始配置上只改品类相关字段，
 * 其余字段（主市场、商务事实、样品政策等）原样保留——发布是整份覆盖，漏带就等于清空。
 * 目录里自带识别词的类目：勾了（做或不做）才写入 productKeywords；取消勾选则撤回这些词。
 */
export function planBusinessProfileCategories(
  currentRaw: unknown,
  selection: CategorySelection,
  catalog: ProductCategoryCatalogEntry[],
): Record<string, unknown> {
  const base = { ...(rec(currentRaw) ?? {}) };
  const selected = new Set([...selection.make, ...selection.dontMake]);
  const keywords: Record<string, string> = {};
  const existing = rec(base.productKeywords) ?? {};
  for (const [k, v] of Object.entries(existing)) {
    if (typeof v === "string") keywords[k.toLowerCase()] = v;
  }
  for (const entry of catalog) {
    if (!entry.keywords?.length) continue;
    for (const kw of entry.keywords) {
      const k = kw.toLowerCase();
      if (selected.has(entry.key)) keywords[k] = entry.key;
      else if (keywords[k] === entry.key) delete keywords[k];
    }
  }
  const out: Record<string, unknown> = {
    ...base,
    productCategories: [...selection.make],
    excludedCategories: [...selection.dontMake],
    excludedCategoryAction: selection.excludedCategoryAction,
  };
  if (Object.keys(keywords).length) out.productKeywords = keywords;
  else delete out.productKeywords;
  return out;
}

const ORG_BOUND_PLATFORM_ROLES = ["trade", "sales"] as const;
const ORG_BOUND_ORG_ROLES = ["org_member", "org_admin"] as const;
export type OrgBoundPlatformRole = (typeof ORG_BOUND_PLATFORM_ROLES)[number];
export type OrgBoundOrgRole = (typeof ORG_BOUND_ORG_ROLES)[number];

/**
 * 工厂老板（企业 owner）的平台角色：外部工厂人员只能是 trade / sales。
 * 平台 boss（历史上曾可跨租户管理用户），admin / super_admin 是平台管理员——都不能交给外部工厂。
 * 返回 null = 可以；否则返回给管理员看的原因。
 */
export function factoryOwnerRoleProblem(platformRole: string | null | undefined): string | null {
  if (!platformRole) return "该账号没有平台角色";
  if ((ORG_BOUND_PLATFORM_ROLES as readonly string[]).includes(platformRole)) return null;
  if (platformRole === "boss" || platformRole === "manager") {
    return `该账号的平台角色是「${platformRole}」，可跨企业管理用户，不能作为外部工厂老板。请让老板用本向导「邀请业务员」生成的外贸邀请码注册（企业管理员），再指定为老板`;
  }
  if (platformRole === "admin" || platformRole === "super_admin") {
    return "平台管理员不能被指定为工厂老板；留空即由你暂代企业 owner";
  }
  return `该账号的平台角色「${platformRole}」不适合作为工厂老板，请使用外贸（trade）或销售（sales）账号`;
}

export interface InviteRequest {
  role: OrgBoundPlatformRole;
  orgRole: OrgBoundOrgRole;
  count: number;
  expiresInDays: number;
  label: string | null;
}

export function validateInviteRequest(raw: unknown): Validation<InviteRequest> {
  const o = rec(raw) ?? {};
  const errors: string[] = [];
  const role = trimmed(o.role) || "trade";
  const orgRole = trimmed(o.orgRole) || "org_member";
  const count = o.count === undefined ? 1 : Number(o.count);
  const expiresInDays = o.expiresInDays === undefined ? 7 : Number(o.expiresInDays);
  const label = trimmed(o.label);
  if (!(ORG_BOUND_PLATFORM_ROLES as readonly string[]).includes(role)) {
    errors.push("企业邀请码只能分配外贸（trade）或销售（sales）角色");
  }
  if (!(ORG_BOUND_ORG_ROLES as readonly string[]).includes(orgRole)) {
    errors.push("企业内角色只能是 org_member 或 org_admin");
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) errors.push("一次生成 1–20 个邀请码");
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) errors.push("有效期 1–30 天");
  if (label.length > 60) errors.push("备注不能超过 60 个字");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      role: role as OrgBoundPlatformRole,
      orgRole: orgRole as OrgBoundOrgRole,
      count,
      expiresInDays,
      label: label || null,
    },
  };
}

/**
 * 注册时的二次校验：带 orgId 的邀请码只能给 trade / sales 平台角色，企业内只能是 org_member / org_admin。
 * 历史无 orgId 的邀请码不走这里（行为不变）。
 */
export function checkOrgBoundInvite(invite: {
  orgId: string | null;
  orgRole: string | null;
  role: string;
}): { ok: true; orgId: string; orgRole: OrgBoundOrgRole } | { ok: false; error: string } {
  if (!invite.orgId) return { ok: false, error: "邀请码未绑定企业" };
  if (!(ORG_BOUND_PLATFORM_ROLES as readonly string[]).includes(invite.role)) {
    return { ok: false, error: "企业邀请码的角色配置无效" };
  }
  const orgRole = invite.orgRole ?? "org_member";
  if (!(ORG_BOUND_ORG_ROLES as readonly string[]).includes(orgRole)) {
    return { ok: false, error: "企业邀请码的企业角色配置无效" };
  }
  return { ok: true, orgId: invite.orgId, orgRole: orgRole as OrgBoundOrgRole };
}

export interface ExistingOrgFacts {
  /** 经入驻向导开通过（settingsJson.onboarding.provisionedById；PATCH 不写） */
  createdByOnboarding: boolean;
  ownerId: string;
  ownerIsPlatformAdmin: boolean;
  activeMembers: Array<{ userId: string; orgRole: string; isPlatformAdmin: boolean }>;
}

type ExistingOrgAdoption =
  | { ok: true; setOwnerId: string | null }
  | { ok: false; code: "CODE_TAKEN" | "OWNER_CONFLICT"; message: string };

/**
 * 同 code 的既有企业能否由入驻向导接管（POST 按 code 幂等的前提）：
 * - 不是入驻向导建的企业：owner 与所有在册成员都只能是操作者 / 本次指定的工厂老板 / 平台管理员，
 *   否则 CODE_TAKEN（旧版任何登录用户都能建企业，接管会把原建者留在一家真实工厂里，跨租户）
 * - 指定了工厂老板：企业已有别的（非平台管理员）org_owner，或 owner 是别人 → OWNER_CONFLICT；
 *   owner 仍是平台管理员（含操作者）暂代 → 交给工厂老板（setOwnerId）
 */
export function planExistingOrgAdoption(
  facts: ExistingOrgFacts,
  actorUserId: string,
  requestedOwnerUserId: string | null,
): ExistingOrgAdoption {
  const trusted = (userId: string, isPlatformAdmin: boolean) =>
    isPlatformAdmin || userId === actorUserId || (!!requestedOwnerUserId && userId === requestedOwnerUserId);
  if (!facts.createdByOnboarding) {
    const outsiders =
      !trusted(facts.ownerId, facts.ownerIsPlatformAdmin) || facts.activeMembers.some((m) => !trusted(m.userId, m.isPlatformAdmin));
    if (outsiders) {
      return {
        ok: false,
        code: "CODE_TAKEN",
        message: "该 code 已被一家不是由入驻向导创建、且有其他成员的企业占用，请换一个 code；如需为该企业补齐配置，请在下方列表点进它的入驻页",
      };
    }
  }
  if (!requestedOwnerUserId) return { ok: true, setOwnerId: null };
  const otherOwner = facts.activeMembers.some(
    (m) => m.orgRole === "org_owner" && !m.isPlatformAdmin && m.userId !== requestedOwnerUserId,
  );
  const ownerIsSomeoneElse =
    facts.ownerId !== requestedOwnerUserId && facts.ownerId !== actorUserId && !facts.ownerIsPlatformAdmin;
  if (otherOwner || ownerIsSomeoneElse) {
    return {
      ok: false,
      code: "OWNER_CONFLICT",
      message: "该企业已有别的负责人，重复提交不会更换老板；如确需更换，请在入驻页第 1 步「工厂老板邮箱」里修改",
    };
  }
  return { ok: true, setOwnerId: facts.ownerId === requestedOwnerUserId ? null : requestedOwnerUserId };
}

/**
 * 成员关系幂等写入计划：
 * - 无记录 → 新建；停用 → 以目标角色重新启用（重新邀请不恢复旧的高角色）
 * - 启用中且角色不低于目标 → 保持（绝不降级 owner / admin）；低于目标 → 升到目标
 */
export function planMembership(
  existing: { role: string; status: string } | null,
  target: OrgRole,
): { action: "create" | "update" | "keep"; role: string } {
  if (!existing) return { action: "create", role: target };
  if (existing.status !== "active") return { action: "update", role: target };
  if (hasOrgRole(existing.role, target)) return { action: "keep", role: existing.role };
  return { action: "update", role: target };
}

/** 按 planMembership 幂等写入成员关系（入驻向导与企业邀请码注册共用；事务由调用方传入） */
export async function upsertMembership(
  tx: Prisma.TransactionClient,
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<{ userId: string; role: string; action: "create" | "update" | "keep" }> {
  const where = { orgId_userId: { orgId, userId } };
  const plan = planMembership(await tx.organizationMember.findUnique({ where, select: { role: true, status: true } }), role);
  if (plan.action === "create") await tx.organizationMember.create({ data: { orgId, userId, role: plan.role, status: "active" } });
  else if (plan.action === "update") await tx.organizationMember.update({ where, data: { role: plan.role, status: "active" } });
  return { userId, role: plan.role, action: plan.action };
}

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 邀请码：QY- + 8 位易读字符（去掉 0/O/1/I）；随机源可注入以便测试 */
export function formatInviteCode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += INVITE_ALPHABET[(bytes[i] ?? 0) % INVITE_ALPHABET.length];
  return `QY-${out}`;
}

// ── 就绪清单 ─────────────────────────────────────────────────────────────

export type OnboardingStepKey =
  | "pack"
  | "categories"
  | "website_channel"
  | "email_inbound"
  | "members"
  | "wechat"
  | "test_inquiry"
  | "email_sender"
  | "handoff";

export type OnboardingStepStatus = "done" | "todo" | "warning" | "skipped" | "acknowledged";

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  status: OnboardingStepStatus;
  required: boolean;
  detail: string;
}

export interface OnboardingFacts {
  pack: { status: "ok" | "missing" | "invalid" | "incompatible"; id: string | null; name: string | null; hasCatalog: boolean };
  modulesExplicit: boolean;
  timezone: string | null;
  categories: { published: boolean; make: string[]; dontMake: string[] };
  websiteChannel: { exists: boolean; active: boolean; secretSet: boolean };
  /** 邮件转发入口（推荐项）：platformEnabled = 平台已配置收信域名 INBOUND_EMAIL_DOMAIN；缺省视为平台未开通 */
  /** authVerifyConfigured：平台配置了受信 authserv-id（INBOUND_EMAIL_AUTHSERV_ID）；缺省视为已配置（旧调用方） */
  emailInbound?: { platformEnabled: boolean; exists: boolean; active: boolean; aliasSet: boolean; allowlistCount: number; authVerifyConfigured?: boolean };
  members: Array<{ isSalesRole: boolean; wechatBound: boolean }>;
  pendingInvites: number;
  testInquiry: { count: number; latestHasOpportunity: boolean; latestHadDraft: boolean; latestClosed: boolean };
  emailSender: { configured: boolean };
  acknowledged: Partial<Record<AcknowledgeableStep, boolean>>;
  /** 企业级 CRITICAL 配置问题数（平台级问题只提示不阻塞） */
  blockingIssues: number;
  /** 交接：仍在册的平台管理员（不含企业 owner 本人）；企业 owner 是否仍是平台管理员 */
  handoff: { platformAdminMembers: string[]; ownerIsPlatformAdmin: boolean };
}

const ONBOARDING_STEP_LABELS: Record<OnboardingStepKey, string> = {
  pack: "行业包与时区",
  categories: "产品品类（做 / 不做 / 不确定）",
  website_channel: "网站渠道密钥",
  email_inbound: "邮件转发入口",
  members: "邀请业务员",
  wechat: "微信绑定",
  test_inquiry: "发送测试询盘",
  email_sender: "组织发件身份",
  handoff: "交接（平台管理员退出成员）",
};

const DONE_STATUSES: OnboardingStepStatus[] = ["done", "skipped", "acknowledged"];

/** 已完成（含跳过 / 管理员确认）的步骤 */
export function isStepDone(step: { status: OnboardingStepStatus }): boolean {
  return DONE_STATUSES.includes(step.status);
}

export function deriveOnboardingSteps(f: OnboardingFacts): {
  steps: OnboardingStep[];
  ready: boolean;
  doneRequired: number;
  totalRequired: number;
} {
  const steps: OnboardingStep[] = [];
  const push = (key: OnboardingStepKey, status: OnboardingStepStatus, detail: string, required = true) =>
    steps.push({ key, label: ONBOARDING_STEP_LABELS[key], status, required, detail });

  // 1. 行业包与时区
  {
    const problems: string[] = [];
    if (f.pack.status !== "ok") problems.push(f.pack.status === "missing" ? "未配置行业包" : `行业包无效（${f.pack.id ?? "空"}）`);
    if (!f.modulesExplicit) problems.push("模块未显式配置（空 = 不限制）");
    if (!f.timezone || !isValidTimeZone(f.timezone)) problems.push("未设置有效时区");
    push(
      "pack",
      problems.length ? "todo" : "done",
      problems.length ? problems.join("；") : `${f.pack.name ?? f.pack.id} · ${f.timezone}`,
    );
  }

  // 2. 品类
  if (!f.pack.hasCatalog) {
    push("categories", "skipped", "该行业包没有品类目录", false);
  } else if (f.categories.published && f.categories.make.length) {
    push("categories", "done", `做 ${f.categories.make.length} 类 · 不做 ${f.categories.dontMake.length} 类`);
  } else {
    push("categories", "todo", "尚未发布产品品类");
  }

  // 3. 网站渠道
  if (f.websiteChannel.exists && f.websiteChannel.active && f.websiteChannel.secretSet) {
    push("website_channel", "done", "网站询盘通道已启用，密钥已生成");
  } else if (f.websiteChannel.exists) {
    push("website_channel", "warning", f.websiteChannel.active ? "通道缺少密钥，请重新生成" : "网站通道已停用");
  } else {
    push("website_channel", "todo", "尚未创建网站询盘通道");
  }

  // 3b. 邮件转发入口（推荐项，不阻塞就绪）
  {
    const e = f.emailInbound;
    if (!e?.platformEnabled) push("email_inbound", "skipped", "平台未开通邮件转发入口（未配置收信域名）", false);
    else if (e.exists && e.authVerifyConfigured === false)
      push("email_inbound", "warning", "平台未配置发件验证（INBOUND_EMAIL_AUTHSERV_ID）：转发来的邮件都会按「未通过 DKIM / DMARC 验证」被隔离", false);
    else if (e.exists && e.active && e.aliasSet && e.allowlistCount > 0) push("email_inbound", "done", `转发地址已生成，白名单 ${e.allowlistCount} 个发件邮箱`, false);
    else if (e.exists && !e.active) push("email_inbound", "warning", "邮件转发通道已停用", false);
    else if (e.exists) push("email_inbound", "warning", "转发白名单为空：转发来的邮件都会被隔离，请在「外贸 → 消息通道」添加业务员的发件邮箱", false);
    else push("email_inbound", "todo", "尚未创建邮件转发通道：在企业的「外贸 → 消息通道」添加「邮件转发询盘」", false);
  }

  // 4. 业务员
  const sales = f.members.filter((m) => m.isSalesRole);
  if (sales.length) {
    push("members", "done", `已加入 ${sales.length} 名业务员${f.pendingInvites ? `；另有 ${f.pendingInvites} 个邀请码未使用` : ""}`);
  } else {
    push("members", "todo", f.pendingInvites ? `已发出 ${f.pendingInvites} 个邀请码，等待业务员注册` : "还没有外贸 / 销售角色的成员");
  }

  // 5. 微信
  const bound = sales.filter((m) => m.wechatBound).length;
  if (sales.length && bound > 0) {
    push("wechat", "done", `${bound} / ${sales.length} 名业务员已绑定微信`);
  } else if (f.acknowledged.wechat) {
    push("wechat", "acknowledged", "管理员已确认暂不绑定微信（询盘提醒仅站内）");
  } else {
    push("wechat", "todo", sales.length ? "业务员都还没有绑定微信" : "先邀请业务员，再让其绑定微信");
  }

  // 6. 测试询盘
  if (f.testInquiry.count === 0) {
    push("test_inquiry", "todo", "尚未发送测试询盘");
  } else if (!f.testInquiry.latestHasOpportunity) {
    push("test_inquiry", "warning", "最近一次测试未建出商机，请查看结果后重试");
  } else if (!f.testInquiry.latestHadDraft) {
    push("test_inquiry", "warning", "最近一次测试没有生成回复草稿（可能是 FDE 失败或品类判为不做），请查看结果后重试");
  } else if (!f.testInquiry.latestClosed) {
    push("test_inquiry", "warning", "最近一次测试的草稿未关闭，请重新发送测试询盘");
  } else {
    push("test_inquiry", "done", `已完成 ${f.testInquiry.count} 次测试，测试单已关闭`);
  }

  // 7. 发件身份（推荐项，不阻塞就绪）
  if (f.emailSender.configured) push("email_sender", "done", "已配置组织发件身份", false);
  else if (f.acknowledged.email_sender) push("email_sender", "acknowledged", "管理员已确认暂用平台发件地址", false);
  else push("email_sender", "warning", "未配置组织发件身份：批准后的回复将用审批人邮箱或平台地址发出", false);

  // 8. 交接（推荐项）：平台管理员留在成员里会收到该厂每条真实询盘的通知
  if (f.handoff.ownerIsPlatformAdmin) {
    push("handoff", "warning", "企业 owner 仍是平台管理员：请先在第 1 步指定工厂老板，交付后再退出成员", false);
  } else if (f.handoff.platformAdminMembers.length) {
    push(
      "handoff",
      "warning",
      `${f.handoff.platformAdminMembers.join("、")} 仍是企业成员，会收到该厂每条真实询盘的通知；交付后请退出`,
      false,
    );
  } else {
    push("handoff", "done", "平台管理员已退出企业成员", false);
  }

  const required = steps.filter((s) => s.required);
  const doneRequired = required.filter(isStepDone).length;
  return {
    steps,
    ready: doneRequired === required.length && f.blockingIssues === 0,
    doneRequired,
    totalRequired: required.length,
  };
}
