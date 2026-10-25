/**
 * 厂家入驻向导（PRD F6）— DB 编排
 *
 * 把 scripts/seed-org-*.ts 的手工步骤做成平台管理员可在界面完成的流程：
 *   建组织（行业包 / 显式模块 / 时区 / 默认工作空间 / 成员）→ 品类（做 / 不做）→ 网站渠道密钥
 *   → 按企业邀请业务员 → 微信绑定状态 → 测试询盘（./onboarding-test-inquiry.ts）→ 就绪检查
 *
 * 约定：
 * - 所有查询按服务端解析的 orgId（路由参数 + 平台管理员鉴权）限定，不信任请求体里的 orgId。
 * - 就绪状态一律从数据库推导；settingsJson.onboarding 只存版本号与管理员手动确认的跳过项。
 * - modulesJson 一律显式写入（空 = 不限制，不能留空）。
 */

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { isValidTimeZone } from "@/lib/automation/local-time";
import { assessConfigHealth } from "@/lib/capabilities/config-health/assess";
import type { ConfigHealthIssue } from "@/lib/capabilities/config-health/types";
import {
  isSelectableIndustryPackId,
  resolveIndustryPack,
  type IndustryPack,
  type ProductCategoryCatalogEntry,
} from "@/lib/industry-packs/registry";
import { ensureBaselineOrgRules, listOrgConfigIssues } from "@/lib/org-rules/service";
import { isPlatformAdmin } from "@/lib/rbac/platform-admin";
import type { OrgRole } from "@/lib/rbac/roles";
import { INQUIRY_REPLY_ACTION_TYPE } from "@/lib/revenue-spine/fde/inbound-sales";
import { TERMINAL_STAGES } from "@/lib/revenue-spine/opportunity-stage";
import { RULE_KEY_BUSINESS_PROFILE, publishRevenueSpineRule } from "@/lib/revenue-spine/policy";
import { parseOrgModulesJson } from "@/lib/tenancy/modules";
import { upsertWebsiteChannel } from "@/lib/trade/channel-service";
import { loadOrgEmailSender } from "@/lib/trade/email-sender";
import {
  ACKNOWLEDGEABLE_STEPS,
  ONBOARDING_SETTINGS_VERSION,
  deriveOnboardingSteps,
  formatInviteCode,
  onboardingTestEventPrefix,
  planBusinessProfileCategories,
  planExistingOrgAdoption,
  planMembership,
  validateCategorySelection,
  type AcknowledgeableStep,
  type InviteRequest,
  type OnboardingPatchRequest,
  type OnboardingStep,
} from "./onboarding-rules";

export class OnboardingError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT" | "PACK_REQUIRED" | "USER_NOT_FOUND",
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}

function asJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
}

const SALES_PLATFORM_ROLES = new Set(["trade", "sales"]);

// ── 建组织 ───────────────────────────────────────────────────────────────

export interface ProvisionFactoryOrgInput {
  name: string;
  code: string;
  industryPackId: string;
  timezone: string;
  actorUserId: string;
  /** 工厂老板：组织 ownerId 与 org_owner 成员；空 = 平台管理员暂为 owner */
  ownerUserId?: string | null;
}

export interface ProvisionFactoryOrgResult {
  orgId: string;
  created: boolean;
  workspacesCreated: string[];
  memberships: Array<{ userId: string; role: string; action: "create" | "update" | "keep" }>;
  /** 已存在的组织只补缺不覆盖：被保留的既有值 */
  keptExisting: string[];
  /** 本次把企业 owner 交给了工厂老板（新建，或既有企业原由平台管理员暂代） */
  ownerAssigned: boolean;
}

/**
 * settingsJson.onboarding：provisionedAt / provisionedById 只由 provisionFactoryOrg 写入（= 经入驻向导开通过，
 * 同 code 重复提交据此判断能否幂等接管）；PATCH 只更新版本号与确认项，不会把别人的企业标成向导开通。
 */
function onboardingSettings(existing: unknown, actorUserId: string, now: Date, mode: "provision" | "update"): Rec {
  const prev = rec(existing) ?? {};
  const out: Rec = { ...prev, version: ONBOARDING_SETTINGS_VERSION };
  if (mode === "provision") {
    out.provisionedAt = typeof prev.provisionedAt === "string" ? prev.provisionedAt : now.toISOString();
    out.provisionedById = typeof prev.provisionedById === "string" ? prev.provisionedById : actorUserId;
  }
  return out;
}

function provisionedByWizard(settings: Rec): boolean {
  return typeof rec(settings.onboarding)?.provisionedById === "string";
}

async function upsertMembership(
  tx: Prisma.TransactionClient,
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<{ userId: string; role: string; action: "create" | "update" | "keep" }> {
  const existing = await tx.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true, status: true },
  });
  const plan = planMembership(existing, role);
  if (plan.action === "create") {
    await tx.organizationMember.create({ data: { orgId, userId, role: plan.role, status: "active" } });
  } else if (plan.action === "update") {
    await tx.organizationMember.update({
      where: { orgId_userId: { orgId, userId } },
      data: { role: plan.role, status: "active" },
    });
  }
  return { userId, role: plan.role, action: plan.action };
}

async function ensurePackWorkspaces(tx: Prisma.TransactionClient, orgId: string, pack: IndustryPack): Promise<string[]> {
  const created: string[] = [];
  for (const ws of pack.defaultWorkspaces ?? []) {
    const existing = await tx.workspace.findUnique({ where: { orgId_slug: { orgId, slug: ws.slug } }, select: { id: true } });
    if (existing) continue; // 已有的不改名、不复活：管理员可能已调整
    await tx.workspace.create({ data: { orgId, slug: ws.slug, name: ws.name, type: ws.type, status: "active" } });
    created.push(ws.slug);
  }
  return created;
}

/**
 * 工厂老板的「当前工作企业」：还没选过、或停在个人工作区时切到本企业（老板先用普通邀请码注册会带一个个人工作区，
 * 两个企业且未选择时登录后要手动选）；已选了别的真实企业则不动。
 */
async function preferOrgAsActive(tx: Prisma.TransactionClient, userId: string, orgId: string): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { activeOrgId: true } });
  if (!user || user.activeOrgId === orgId) return;
  if (user.activeOrgId) {
    const current = await tx.organization.findUnique({ where: { id: user.activeOrgId }, select: { code: true, status: true } });
    if (current && current.status !== "archived" && !current.code.startsWith("personal-")) return;
  }
  await tx.user.update({ where: { id: userId }, data: { activeOrgId: orgId } });
}

async function assertActiveUsers(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  const rows = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, status: true } });
  for (const id of unique) {
    const row = rows.find((r) => r.id === id);
    if (!row || row.status !== "active") throw new OnboardingError("USER_NOT_FOUND", "指定的用户不存在或已停用", 400);
  }
}

/**
 * 建工厂组织（单事务，按 code 幂等）。
 * - 新建：行业包、显式模块、时区、onboarding 版本、默认工作空间、成员（操作者 org_admin，老板 org_owner）
 * - 已存在：只补缺（未配置的行业包 / 模块 / 时区 / 工作空间 / 成员），不覆盖既有值；
 *   行业包与请求不一致或组织已归档 → CONFLICT；
 *   不是入驻向导建的、且有操作者 / 工厂老板 / 平台管理员以外的成员 → CONFLICT（不接管别人的企业）；
 *   指定了工厂老板而企业已有别的负责人 → CONFLICT；owner 仍是平台管理员暂代 → 交给工厂老板
 * 事务后补齐平台默认业务规则（已有规则绝不覆盖）。
 */
export async function provisionFactoryOrg(input: ProvisionFactoryOrgInput): Promise<ProvisionFactoryOrgResult> {
  if (!isSelectableIndustryPackId(input.industryPackId)) {
    throw new OnboardingError("INVALID_INPUT", `未知行业包：${input.industryPackId}`);
  }
  const packRes = resolveIndustryPack(input.industryPackId);
  if (packRes.status !== "ok") throw new OnboardingError("INVALID_INPUT", packRes.message);
  const pack = packRes.pack;
  if (!isValidTimeZone(input.timezone)) throw new OnboardingError("INVALID_INPUT", `无效的时区：${input.timezone}`);
  const ownerUserId = input.ownerUserId || null;
  await assertActiveUsers([input.actorUserId, ...(ownerUserId ? [ownerUserId] : [])]);

  const now = new Date();
  const attempt = () =>
    db.$transaction(async (tx) => {
      const keptExisting: string[] = [];
      let org = await tx.organization.findUnique({
        where: { code: input.code },
        select: { id: true, status: true, industryPackId: true, modulesJson: true, settingsJson: true, ownerId: true },
      });
      let created = false;
      let ownerAssigned = false;
      if (org) {
        if (org.status === "archived") throw new OnboardingError("CONFLICT", "该 code 属于已归档的企业，请换一个 code", 409);
        const existingPack = org.industryPackId ? resolveIndustryPack(org.industryPackId) : null;
        if (existingPack && (existingPack.status !== "ok" || existingPack.pack.id !== pack.id)) {
          throw new OnboardingError("CONFLICT", `该 code 已被占用，且行业包为 ${org.industryPackId}（与所选不同）`, 409);
        }
        const settings = rec(org.settingsJson) ?? {};
        const [owner, activeMembers] = await Promise.all([
          tx.user.findUnique({ where: { id: org.ownerId }, select: { role: true } }),
          tx.organizationMember.findMany({
            where: { orgId: org.id, status: "active" },
            select: { userId: true, role: true, user: { select: { role: true } } },
          }),
        ]);
        const adoption = planExistingOrgAdoption(
          {
            createdByOnboarding: provisionedByWizard(settings),
            ownerId: org.ownerId,
            ownerIsPlatformAdmin: isPlatformAdmin(owner?.role),
            activeMembers: activeMembers.map((m) => ({ userId: m.userId, orgRole: m.role, isPlatformAdmin: isPlatformAdmin(m.user.role) })),
          },
          input.actorUserId,
          ownerUserId,
        );
        if (!adoption.ok) throw new OnboardingError("CONFLICT", adoption.message, 409);
        ownerAssigned = !!adoption.setOwnerId;
        const nextSettings: Rec = { ...settings, onboarding: onboardingSettings(settings.onboarding, input.actorUserId, now, "provision") };
        if (isValidTimeZone(typeof settings.timezone === "string" ? settings.timezone : "")) keptExisting.push("timezone");
        else nextSettings.timezone = input.timezone;
        const modules = parseOrgModulesJson(org.modulesJson);
        if (modules?.enabled.length) keptExisting.push("modulesJson");
        if (org.industryPackId) keptExisting.push("industryPackId");
        if (!ownerAssigned) keptExisting.push("ownerId");
        await tx.organization.update({
          where: { id: org.id },
          data: {
            ...(org.industryPackId ? {} : { industryPackId: pack.id }),
            ...(modules?.enabled.length ? {} : { modulesJson: { enabled: [...pack.enabledModules] } }),
            ...(adoption.setOwnerId ? { ownerId: adoption.setOwnerId } : {}),
            settingsJson: asJson(nextSettings),
          },
        });
      } else {
        org = await tx.organization.create({
          data: {
            name: input.name,
            code: input.code,
            ownerId: ownerUserId ?? input.actorUserId,
            status: "active",
            planType: "free",
            industryPackId: pack.id,
            modulesJson: { enabled: [...pack.enabledModules] },
            settingsJson: asJson({ timezone: input.timezone, onboarding: onboardingSettings(null, input.actorUserId, now, "provision") }),
          },
          select: { id: true, status: true, industryPackId: true, modulesJson: true, settingsJson: true, ownerId: true },
        });
        created = true;
        ownerAssigned = !!ownerUserId;
      }
      const workspacesCreated = await ensurePackWorkspaces(tx, org.id, pack);
      const memberships = [await upsertMembership(tx, org.id, input.actorUserId, "org_admin")];
      if (ownerUserId) {
        memberships.push(await upsertMembership(tx, org.id, ownerUserId, "org_owner"));
        await preferOrgAsActive(tx, ownerUserId, org.id);
      }
      return { orgId: org.id, created, workspacesCreated, memberships, keptExisting, ownerAssigned };
    });

  let result: ProvisionFactoryOrgResult;
  try {
    result = await attempt();
  } catch (err) {
    // 并发同 code：唯一约束冲突后重读即是幂等结果
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") result = await attempt();
    else throw err;
  }

  const baseline = await ensureBaselineOrgRules({ orgId: result.orgId, userId: input.actorUserId });
  await logAudit({
    userId: input.actorUserId,
    orgId: result.orgId,
    action: result.created ? "onboarding.org.provision" : "onboarding.org.reprovision",
    targetType: AUDIT_TARGETS.ORG,
    targetId: result.orgId,
    afterData: {
      code: input.code,
      industryPackId: pack.id,
      modules: pack.enabledModules,
      timezone: input.timezone,
      ownerUserId,
      ownerAssigned: result.ownerAssigned,
      created: result.created,
      workspacesCreated: result.workspacesCreated,
      memberships: result.memberships,
      keptExisting: result.keptExisting,
      baselineRules: baseline.map((b) => `${b.ruleKey}:${b.status}`),
    },
  });
  return result;
}

// ── 品类 ─────────────────────────────────────────────────────────────────

async function loadOrgPack(orgId: string): Promise<{ org: { id: string; name: string; industryPackId: string | null }; pack: IndustryPack }> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, industryPackId: true, status: true } });
  if (!org) throw new OnboardingError("NOT_FOUND", "企业不存在", 404);
  if (org.status === "archived") throw new OnboardingError("CONFLICT", "企业已归档，不能修改", 409);
  const pack = resolveIndustryPack(org.industryPackId);
  if (pack.status !== "ok") throw new OnboardingError("PACK_REQUIRED", "请先为企业配置有效的行业包");
  return { org, pack: pack.pack };
}

async function loadActiveBusinessProfile(orgId: string): Promise<{ configJson: unknown; version: number } | null> {
  return db.orgBusinessRule.findFirst({
    where: { orgId, ruleKey: RULE_KEY_BUSINESS_PROFILE, status: "active" },
    orderBy: { version: "desc" },
    select: { configJson: true, version: true },
  });
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * 发布企业品类（revenue_spine.business_profile 新版本）：做 → productCategories，不做 → excludedCategories。
 * 在当前生效配置上只改品类字段，其余商务事实原样保留。
 */
export async function setOrgProductCategories(
  orgId: string,
  input: unknown,
  actorUserId: string,
): Promise<{ version: number; make: string[]; dontMake: string[]; excludedCategoryAction: "review" | "decline" }> {
  const { pack } = await loadOrgPack(orgId);
  const catalog = pack.productCategoryCatalog;
  const v = validateCategorySelection(input, catalog);
  if (!v.ok) throw new OnboardingError("INVALID_INPUT", v.errors.join("；"));
  const current = await loadActiveBusinessProfile(orgId);
  const config = planBusinessProfileCategories(current?.configJson ?? null, v.value, catalog ?? []);
  const { version } = await publishRevenueSpineRule({ orgId, ruleKey: RULE_KEY_BUSINESS_PROFILE, config, userId: actorUserId });
  const before = rec(current?.configJson) ?? {};
  await logAudit({
    userId: actorUserId,
    orgId,
    action: "onboarding.categories.publish",
    targetType: "org_business_rule",
    targetId: RULE_KEY_BUSINESS_PROFILE,
    beforeData: {
      version: current?.version ?? null,
      productCategories: strArray(before.productCategories),
      excludedCategories: strArray(before.excludedCategories),
    },
    afterData: { version, ...v.value },
  });
  return { version, ...v.value };
}

// ── 网站渠道 ─────────────────────────────────────────────────────────────

export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return secret.length > 8 ? `${secret.slice(0, 4)}****${secret.slice(-4)}` : "****";
}

/** 建 / 复用本企业的网站询盘通道；只返回 website 通道自己的密钥，不读取其他通道 */
export async function ensureOnboardingWebsiteChannel(
  orgId: string,
  actorUserId: string,
  name?: string | null,
): Promise<{ created: boolean; channel: { id: string; name: string; status: string; createdAt: Date; updatedAt: Date }; secret: string }> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, status: true } });
  if (!org) throw new OnboardingError("NOT_FOUND", "企业不存在", 404);
  if (org.status !== "active") throw new OnboardingError("CONFLICT", "企业未启用", 409);
  const before = await db.tradeChannel.findUnique({
    where: { orgId_channel: { orgId, channel: "website" } },
    select: { id: true, name: true, status: true },
  });
  const ch = await upsertWebsiteChannel({ orgId, name: (name ?? "").trim().slice(0, 60) || before?.name || "官网询盘" });
  const secret = String((ch.config as Rec | null)?.secret ?? "");
  await logAudit({
    userId: actorUserId,
    orgId,
    action: before ? "onboarding.website_channel.ensure" : "onboarding.website_channel.create",
    targetType: "trade_channel",
    targetId: ch.id,
    beforeData: before ? { status: before.status, name: before.name } : null,
    // 审计里只留密钥掩码
    afterData: { status: ch.status, name: ch.name, secret: maskSecret(secret) },
  });
  return {
    created: !before,
    channel: { id: ch.id, name: ch.name, status: ch.status, createdAt: ch.createdAt, updatedAt: ch.updatedAt },
    secret,
  };
}

// ── 邀请 ─────────────────────────────────────────────────────────────────

export async function createOrgInvites(
  orgId: string,
  req: InviteRequest,
  actorUserId: string,
): Promise<Array<{ id: string; code: string; role: string; orgRole: string; expiresAt: Date | null; label: string | null }>> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, status: true } });
  if (!org) throw new OnboardingError("NOT_FOUND", "企业不存在", 404);
  if (org.status !== "active") throw new OnboardingError("CONFLICT", "企业未启用，不能邀请成员", 409);
  const expiresAt = new Date(Date.now() + req.expiresInDays * 24 * 60 * 60 * 1000);
  const label = req.label ?? `${org.name} · ${req.role === "trade" ? "外贸" : "销售"}`;
  const out: Array<{ id: string; code: string; role: string; orgRole: string; expiresAt: Date | null; label: string | null }> = [];
  for (let i = 0; i < req.count; i++) {
    let row: { id: string; code: string; role: string; orgRole: string | null; expiresAt: Date | null; label: string | null } | null = null;
    for (let tries = 0; tries < 5 && !row; tries++) {
      try {
        row = await db.inviteCode.create({
          data: {
            code: formatInviteCode(randomBytes(8)),
            role: req.role,
            label,
            maxUses: 1,
            expiresAt,
            createdById: actorUserId,
            orgId,
            orgRole: req.orgRole,
          },
          select: { id: true, code: true, role: true, orgRole: true, expiresAt: true, label: true },
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      }
    }
    if (!row) throw new Error("邀请码生成冲突，请重试");
    out.push({ ...row, orgRole: row.orgRole ?? req.orgRole });
  }
  await logAudit({
    userId: actorUserId,
    orgId,
    action: AUDIT_ACTIONS.INVITE,
    targetType: "invite_code",
    targetId: out[0]?.id ?? null,
    afterData: { count: out.length, role: req.role, orgRole: req.orgRole, expiresAt: expiresAt.toISOString(), inviteCodeIds: out.map((o) => o.id) },
  });
  return out;
}

// ── PATCH：时区 / 行业包 / 老板 / 手动确认 ───────────────────────────────

export async function updateOnboardingSettings(
  orgId: string,
  patch: OnboardingPatchRequest & { ownerUserId?: string | null },
  actorUserId: string,
): Promise<void> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, status: true, industryPackId: true, modulesJson: true, settingsJson: true, ownerId: true },
  });
  if (!org) throw new OnboardingError("NOT_FOUND", "企业不存在", 404);
  if (org.status === "archived") throw new OnboardingError("CONFLICT", "企业已归档，不能修改", 409);
  if (patch.ownerUserId) await assertActiveUsers([patch.ownerUserId]);
  if (patch.leaveOrg) {
    // 交接：只退出操作者本人；企业必须已有别的负责人（org_owner），且操作者不是企业 owner
    const nextOwnerId = patch.ownerUserId ?? org.ownerId;
    if (nextOwnerId === actorUserId) {
      throw new OnboardingError("CONFLICT", "你仍是企业 owner：请先指定工厂老板，再退出成员", 409);
    }
    const [mine, otherOwners] = await Promise.all([
      db.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId: actorUserId } }, select: { status: true } }),
      db.organizationMember.count({
        where: { orgId, status: "active", role: "org_owner", userId: { not: actorUserId }, user: { status: "active" } },
      }),
    ]);
    if (mine?.status !== "active") throw new OnboardingError("CONFLICT", "你不是该企业的在册成员，无需退出", 409);
    if (otherOwners === 0 && !patch.ownerUserId) {
      throw new OnboardingError("CONFLICT", "企业还没有工厂老板（企业负责人）：请先指定，再退出成员", 409);
    }
  }
  const settings = rec(org.settingsJson) ?? {};
  const onboarding = onboardingSettings(settings.onboarding, actorUserId, new Date(), "update");
  const acks: Rec = { ...(rec(onboarding.acknowledgements) ?? {}) };
  for (const [step, value] of Object.entries(patch.acknowledge ?? {})) {
    if (value) acks[step] = { at: new Date().toISOString(), byUserId: actorUserId };
    else delete acks[step];
  }
  const nextSettings: Rec = {
    ...settings,
    ...(patch.timezone ? { timezone: patch.timezone } : {}),
    onboarding: { ...onboarding, acknowledgements: acks },
  };
  const pack = patch.industryPackId ? resolveIndustryPack(patch.industryPackId) : null;
  if (pack && pack.status !== "ok") throw new OnboardingError("INVALID_INPUT", pack.message);

  await db.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: orgId },
      data: {
        settingsJson: asJson(nextSettings),
        ...(pack?.status === "ok" ? { industryPackId: pack.pack.id, modulesJson: { enabled: [...pack.pack.enabledModules] } } : {}),
        ...(patch.ownerUserId ? { ownerId: patch.ownerUserId } : {}),
      },
    });
    if (pack?.status === "ok") await ensurePackWorkspaces(tx, orgId, pack.pack);
    if (patch.ownerUserId) {
      await upsertMembership(tx, orgId, patch.ownerUserId, "org_owner");
      await preferOrgAsActive(tx, patch.ownerUserId, orgId);
    }
    if (patch.leaveOrg) {
      await tx.organizationMember.update({ where: { orgId_userId: { orgId, userId: actorUserId } }, data: { status: "inactive" } });
    }
  });

  await logAudit({
    userId: actorUserId,
    orgId,
    action: "onboarding.org.update",
    targetType: AUDIT_TARGETS.ORG,
    targetId: orgId,
    beforeData: {
      timezone: settings.timezone ?? null,
      industryPackId: org.industryPackId,
      modulesJson: org.modulesJson,
      ownerId: org.ownerId,
      acknowledgements: rec(rec(settings.onboarding)?.acknowledgements) ?? {},
    },
    afterData: {
      timezone: nextSettings.timezone ?? null,
      industryPackId: pack?.status === "ok" ? pack.pack.id : org.industryPackId,
      modules: pack?.status === "ok" ? pack.pack.enabledModules : undefined,
      ownerId: patch.ownerUserId ?? org.ownerId,
      acknowledgements: acks,
      ...(patch.leaveOrg ? { actorLeftOrg: true } : {}),
    },
  });
}

// ── 状态推导 ─────────────────────────────────────────────────────────────

export type InviteState = "unused" | "used" | "expired" | "disabled";

export function inviteState(row: { isActive: boolean; usedCount: number; maxUses: number | null; expiresAt: Date | null }, now: Date): InviteState {
  if (!row.isActive) return "disabled";
  if (row.maxUses !== null && row.usedCount >= row.maxUses) return "used";
  if (row.expiresAt && row.expiresAt <= now) return "expired";
  return "unused";
}

export interface OnboardingStatus {
  org: {
    id: string;
    name: string;
    code: string;
    status: string;
    industryPackId: string | null;
    timezone: string | null;
    modules: string[];
    owner: { id: string; name: string; email: string };
    createdAt: Date;
    onboardingVersion: number | null;
  };
  pack: { status: "ok" | "missing" | "invalid" | "incompatible"; id: string | null; name: string | null; message: string | null };
  catalog: ProductCategoryCatalogEntry[];
  categories: { published: boolean; version: number | null; make: string[]; dontMake: string[]; excludedCategoryAction: string | null };
  websiteChannel: { exists: boolean; id: string | null; name: string | null; status: string | null; secretPreview: string | null; updatedAt: Date | null };
  members: Array<{
    userId: string;
    name: string;
    email: string;
    platformRole: string;
    orgRole: string;
    isSalesRole: boolean;
    wechatBound: boolean;
    wechatChannels: string[];
  }>;
  invites: Array<{
    id: string;
    code: string;
    role: string;
    orgRole: string | null;
    label: string | null;
    state: InviteState;
    expiresAt: Date | null;
    createdAt: Date;
  }>;
  testInquiries: Array<{
    receiptId: string;
    eventId: string;
    status: string;
    firstSeenAt: Date;
    opportunityId: string | null;
    opportunityStage: string | null;
    pendingActionId: string | null;
    /** 该次测试是否生成过回复草稿（任何状态） */
    draftGenerated: boolean;
    openDrafts: number;
  }>;
  emailSender: { configured: boolean; fromName: string | null; fromEmail: string | null; replyTo: string | null };
  acknowledged: Partial<Record<AcknowledgeableStep, { at: string; byUserId: string }>>;
  configHealth: { overall: string; issues: ConfigHealthIssue[] } | null;
  steps: OnboardingStep[];
  ready: boolean;
  doneRequired: number;
  totalRequired: number;
}

async function loadConfigHealth(orgId: string, actorUserId: string): Promise<{ overall: string; issues: ConfigHealthIssue[] }> {
  try {
    const report = await assessConfigHealth({
      userId: actorUserId,
      orgId,
      orgRole: "org_admin",
      isPlatformAdmin: true,
      workspaceIds: [],
      runVisibility: "AGGREGATE_ONLY",
      hasMembership: false,
    });
    return { overall: report.overall, issues: report.issues.filter((i) => i.status !== "HEALTHY") };
  } catch (err) {
    // 中台健康检查不可用时退回经营中心规则检查，不伪造健康
    console.warn("[onboarding] assessConfigHealth failed:", err instanceof Error ? err.message : err);
    const legacy = await listOrgConfigIssues(orgId);
    return {
      overall: legacy.length ? "WARNING" : "HEALTHY",
      issues: legacy.map((row) => ({
        code: `RULE_${row.ruleKey.toUpperCase()}`,
        severity: row.status === "invalid" ? "ERROR" : "WARNING",
        status: row.status === "missing" ? "MISSING" : row.status === "invalid" ? "INCOMPATIBLE" : "WARNING",
        scope: "ORGANIZATION",
        scopeId: orgId,
        title: `业务规则：${row.ruleKey}`,
        message: row.message,
      })),
    };
  }
}

/** 入驻状态：每一步都从数据库推导；opts.configHealth 时附带中台配置健康问题 */
export async function getOnboardingStatus(
  orgId: string,
  opts?: { configHealth?: boolean; actorUserId?: string; now?: Date },
): Promise<OnboardingStatus | null> {
  const now = opts?.now ?? new Date();
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      industryPackId: true,
      modulesJson: true,
      settingsJson: true,
      createdAt: true,
      owner: { select: { id: true, name: true, email: true, role: true } },
    },
  });
  if (!org) return null;
  const { role: ownerPlatformRole, ...ownerPublic } = org.owner;

  const packRes = resolveIndustryPack(org.industryPackId);
  const pack = packRes.status === "ok" ? packRes.pack : null;
  const settings = rec(org.settingsJson) ?? {};
  const onboarding = rec(settings.onboarding) ?? {};
  const timezone = typeof settings.timezone === "string" ? settings.timezone : null;
  const modules = parseOrgModulesJson(org.modulesJson);

  const [profile, channel, memberRows, inviteRows, receipts, sender, configHealth] = await Promise.all([
    loadActiveBusinessProfile(orgId),
    db.tradeChannel.findUnique({
      where: { orgId_channel: { orgId, channel: "website" } },
      select: { id: true, name: true, status: true, config: true, updatedAt: true },
    }),
    db.organizationMember.findMany({
      where: { orgId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { role: true, user: { select: { id: true, name: true, email: true, role: true, status: true } } },
    }),
    db.inviteCode.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, code: true, role: true, orgRole: true, label: true, isActive: true, usedCount: true, maxUses: true, expiresAt: true, createdAt: true },
    }),
    db.websiteInquiryReceipt.findMany({
      where: { orgId, eventId: { startsWith: onboardingTestEventPrefix(orgId) } },
      orderBy: { firstSeenAt: "desc" },
      take: 20,
      select: { id: true, eventId: true, status: true, firstSeenAt: true, opportunityId: true, pendingActionId: true },
    }),
    loadOrgEmailSender(orgId),
    opts?.configHealth ? loadConfigHealth(orgId, opts.actorUserId ?? org.owner.id) : Promise.resolve(null),
  ]);

  const activeMembers = memberRows.filter((m) => m.user.status === "active");
  const bindings = activeMembers.length
    ? await db.weChatBinding.findMany({
        where: {
          userId: { in: activeMembers.map((m) => m.user.id) },
          status: "active",
          OR: [{ orgId: null }, { orgId }],
        },
        select: { userId: true, channel: true },
      })
    : [];
  const members = activeMembers.map((m) => {
    const channels = [...new Set(bindings.filter((b) => b.userId === m.user.id).map((b) => b.channel))];
    return {
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      platformRole: m.user.role,
      orgRole: m.role,
      isSalesRole: SALES_PLATFORM_ROLES.has(m.user.role),
      wechatBound: channels.length > 0,
      wechatChannels: channels,
    };
  });

  const oppIds = receipts.map((r) => r.opportunityId).filter((x): x is string => !!x);
  const [opps, openDrafts] = oppIds.length
    ? await Promise.all([
        db.salesOpportunity.findMany({ where: { orgId, id: { in: oppIds } }, select: { id: true, stage: true } }),
        db.pendingAction.findMany({
          where: {
            orgId,
            type: INQUIRY_REPLY_ACTION_TYPE,
            OR: oppIds.map((id) => ({ payload: { path: ["opportunityId"], equals: id } })),
          },
          select: { payload: true, status: true },
        }),
      ])
    : [[], []];
  const draftsFor = (oppId: string) => openDrafts.filter((d) => (rec(d.payload)?.opportunityId ?? null) === oppId);
  const openDraftCount = (oppId: string) => draftsFor(oppId).filter((d) => d.status === "pending").length;
  const testInquiries = receipts.map((r) => ({
    receiptId: r.id,
    eventId: r.eventId,
    status: r.status,
    firstSeenAt: r.firstSeenAt,
    opportunityId: r.opportunityId,
    opportunityStage: opps.find((o) => o.id === r.opportunityId)?.stage ?? null,
    pendingActionId: r.pendingActionId,
    draftGenerated: r.opportunityId ? draftsFor(r.opportunityId).length > 0 : false,
    openDrafts: r.opportunityId ? openDraftCount(r.opportunityId) : 0,
  }));
  const latest = testInquiries[0] ?? null;

  const profileCfg = rec(profile?.configJson) ?? {};
  const make = strArray(profileCfg.productCategories);
  const dontMake = strArray(profileCfg.excludedCategories);
  const channelSecret = (rec(channel?.config)?.secret as string | undefined) ?? null;

  const ackRaw = rec(onboarding.acknowledgements) ?? {};
  const acknowledged: OnboardingStatus["acknowledged"] = {};
  for (const step of ACKNOWLEDGEABLE_STEPS) {
    const a = rec(ackRaw[step]);
    if (a && typeof a.at === "string") acknowledged[step] = { at: a.at, byUserId: String(a.byUserId ?? "") };
  }

  const invites = inviteRows.map((row) => ({
    id: row.id,
    code: row.code,
    role: row.role,
    orgRole: row.orgRole,
    label: row.label,
    state: inviteState(row, now),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));

  const blockingIssues = (configHealth?.issues ?? []).filter((i) => i.scope === "ORGANIZATION" && i.severity === "CRITICAL").length;
  const handoff = {
    platformAdminMembers: members.filter((m) => isPlatformAdmin(m.platformRole) && m.userId !== org.owner.id).map((m) => m.name || m.email),
    ownerIsPlatformAdmin: isPlatformAdmin(ownerPlatformRole),
  };
  const derived = deriveOnboardingSteps({
    pack: { status: packRes.status, id: org.industryPackId, name: pack?.name ?? null, hasCatalog: !!pack?.productCategoryCatalog?.length },
    modulesExplicit: !!modules?.enabled.length,
    timezone,
    categories: { published: !!profile && Array.isArray(profileCfg.productCategories), make, dontMake },
    websiteChannel: { exists: !!channel, active: channel?.status === "active", secretSet: !!channelSecret },
    members: members.map((m) => ({ isSalesRole: m.isSalesRole, wechatBound: m.wechatBound })),
    pendingInvites: invites.filter((i) => i.state === "unused").length,
    testInquiry: {
      count: testInquiries.length,
      latestHasOpportunity: !!latest?.opportunityId,
      latestHadDraft: !!latest?.draftGenerated,
      latestClosed: !!latest?.opportunityStage && (TERMINAL_STAGES as readonly string[]).includes(latest.opportunityStage) && latest.openDrafts === 0,
    },
    emailSender: { configured: !!sender },
    acknowledged: Object.fromEntries(Object.keys(acknowledged).map((k) => [k, true])),
    blockingIssues,
    handoff,
  });

  return {
    org: {
      id: org.id,
      name: org.name,
      code: org.code,
      status: org.status,
      industryPackId: org.industryPackId,
      timezone,
      modules: modules?.enabled ?? [],
      owner: ownerPublic,
      createdAt: org.createdAt,
      onboardingVersion: typeof onboarding.version === "number" ? onboarding.version : null,
    },
    pack: {
      status: packRes.status,
      id: pack?.id ?? org.industryPackId,
      name: pack?.name ?? null,
      message: packRes.status === "ok" ? null : packRes.message,
    },
    catalog: pack?.productCategoryCatalog ?? [],
    categories: {
      published: !!profile && Array.isArray(profileCfg.productCategories),
      version: profile?.version ?? null,
      make,
      dontMake,
      excludedCategoryAction: typeof profileCfg.excludedCategoryAction === "string" ? profileCfg.excludedCategoryAction : null,
    },
    websiteChannel: {
      exists: !!channel,
      id: channel?.id ?? null,
      name: channel?.name ?? null,
      status: channel?.status ?? null,
      secretPreview: maskSecret(channelSecret),
      updatedAt: channel?.updatedAt ?? null,
    },
    members,
    invites,
    testInquiries,
    emailSender: {
      configured: !!sender,
      fromName: sender?.fromName ?? null,
      fromEmail: sender?.fromEmail ?? null,
      replyTo: sender?.replyTo ?? null,
    },
    acknowledged,
    configHealth,
    ...derived,
  };
}

/**
 * 列表：非归档、非个人工作区的企业 + 必做步骤摘要。
 * 不跑中台配置健康检查，所以只报「必做步骤是否完成」（stepsComplete），不报「就绪」——就绪以详情页为准。
 */
export async function listOnboardingOrgs(): Promise<
  Array<{
    id: string;
    name: string;
    code: string;
    status: string;
    industryPackId: string | null;
    createdAt: Date;
    stepsComplete: boolean;
    doneRequired: number;
    totalRequired: number;
    pendingStep: string | null;
  }>
> {
  const orgs = await db.organization.findMany({
    where: { status: { not: "archived" }, NOT: { code: { startsWith: "personal-" } } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true },
  });
  const out = [];
  for (const o of orgs) {
    const s = await getOnboardingStatus(o.id);
    if (!s) continue;
    const pending = s.steps.find((st) => st.required && !["done", "skipped", "acknowledged"].includes(st.status));
    out.push({
      id: s.org.id,
      name: s.org.name,
      code: s.org.code,
      status: s.org.status,
      industryPackId: s.org.industryPackId,
      createdAt: s.org.createdAt,
      stepsComplete: s.doneRequired === s.totalRequired,
      doneRequired: s.doneRequired,
      totalRequired: s.totalRequired,
      pendingStep: pending?.label ?? null,
    });
  }
  return out;
}

/** 按邮箱找已注册、启用中的用户（用于指定工厂老板） */
export async function findActiveUserIdByEmail(email: string): Promise<string> {
  const user = await db.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
    select: { id: true, status: true },
  });
  if (!user || user.status !== "active") {
    throw new OnboardingError("USER_NOT_FOUND", `该邮箱尚未注册或已停用：${email}`);
  }
  return user.id;
}
