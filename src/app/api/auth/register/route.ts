import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { DEFAULT_ENVIRONMENTS } from "@/lib/common/constants";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { checkOrgBoundInvite, upsertMembership, type OrgBoundOrgRole } from "@/lib/organizations/onboarding-rules";
import { ensureDefaultPositions } from "@/lib/authorization/onboarding-positions";

const REGISTER_RATE_LIMIT = {
  name: "auth-register",
  windowMs: 60_000,
  maxRequests: 5,
} as const;

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimitAsync(REGISTER_RATE_LIMIT, ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const { email, password, name, inviteCode } = body as {
    email?: string;
    password?: string;
    name?: string;
    inviteCode?: string;
  };

  if (!email || !password) {
    return NextResponse.json({ error: "邮箱和密码为必填项" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "密码长度至少 6 位" },
      { status: 400 }
    );
  }

  if (!inviteCode || !inviteCode.trim()) {
    return NextResponse.json({ error: "邀请码为必填项" }, { status: 400 });
  }

  const invite = await db.inviteCode.findUnique({
    where: { code: inviteCode.trim().toUpperCase() },
  });

  if (!invite || !invite.isActive) {
    return NextResponse.json({ error: "邀请码无效或已停用" }, { status: 400 });
  }

  if (invite.maxUses !== null && invite.usedCount >= invite.maxUses) {
    return NextResponse.json({ error: "邀请码已达使用上限" }, { status: 400 });
  }

  if (invite.expiresAt && new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "邀请码已过期" }, { status: 400 });
  }

  // PERM-7b：不再签发平台 admin——历史上签发为 admin 的邀请码按 user 落
  const assignedRole = invite.role === "admin" ? "user" : invite.role;

  // 企业邀请码（入驻向导）：只给 trade / sales 平台角色；企业须存在且启用
  let orgBinding: { orgId: string; orgRole: OrgBoundOrgRole } | null = null;
  if (invite.orgId) {
    const check = checkOrgBoundInvite(invite);
    if (!check.ok) {
      return NextResponse.json({ error: "邀请码配置无效，请联系管理员" }, { status: 400 });
    }
    const org = await db.organization.findUnique({
      where: { id: check.orgId },
      select: { id: true, status: true },
    });
    if (!org || org.status !== "active") {
      return NextResponse.json({ error: "邀请码对应的企业不可用，请联系管理员" }, { status: 400 });
    }
    orgBinding = { orgId: org.id, orgRole: check.orgRole };
  }

  const existing = await db.user.findUnique({ where: { email } });

  if (existing?.passwordHash) {
    return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const displayName = name || email.split("@")[0];

  if (orgBinding) {
    return registerIntoOrg(request, {
      invite: { id: invite.id, usedCount: invite.usedCount, role: assignedRole, companyIdsJson: invite.companyIdsJson },
      orgId: orgBinding.orgId,
      orgRole: orgBinding.orgRole,
      email,
      name,
      displayName,
      passwordHash,
      existing: existing ? { id: existing.id, name: existing.name } : null,
    });
  }

  let user;
  let isNewUser = false;

  if (existing && !existing.passwordHash) {
    user = await db.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        name: name || existing.name,
        role: assignedRole,
        inviteCodeId: invite.id,
        // 公司归属随邀请码带入（联合品牌 logo）
        companyIdsJson: invite.companyIdsJson,
        lastLoginAt: new Date(),
      },
    });
  } else {
    user = await db.user.create({
      data: {
        email,
        passwordHash,
        name: displayName,
        role: assignedRole,
        inviteCodeId: invite.id,
        companyIdsJson: invite.companyIdsJson,
        status: "active",
      },
    });
    isNewUser = true;
  }

  await db.inviteCode.update({
    where: { id: invite.id },
    data: { usedCount: { increment: 1 } },
  });

  if (isNewUser) {
    try {
      await bootstrapNewUser(user.id, displayName, assignedRole);
    } catch (err) {
      console.error("[register] bootstrap failed:", err);
    }
  }

  const token = await createSession({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });

  setSessionCookie(response, token);

  await logAudit({
    userId: user.id,
    action: existing ? AUDIT_ACTIONS.LOGIN : AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.USER,
    targetId: user.id,
    request,
  });

  return response;
}

class InviteAlreadyUsedError extends Error {}

/**
 * 企业邀请码注册：单事务内原子占用邀请码（按读到的 usedCount 做 CAS，单次使用）→ 建 / 补用户
 * → 加入企业（不降级既有更高角色）→ 设为当前工作企业。不建个人工作区。
 */
async function registerIntoOrg(
  request: NextRequest,
  input: {
    invite: { id: string; usedCount: number; role: string; companyIdsJson: string | null };
    orgId: string;
    orgRole: OrgBoundOrgRole;
    email: string;
    name: string | undefined;
    displayName: string;
    passwordHash: string;
    existing: { id: string; name: string } | null;
  },
) {
  let user: { id: string; email: string; name: string; role: string };
  let membershipAction: string;
  try {
    const out = await db.$transaction(async (tx) => {
      const claimed = await tx.inviteCode.updateMany({
        where: { id: input.invite.id, isActive: true, usedCount: input.invite.usedCount },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new InviteAlreadyUsedError();

      const select = { id: true, email: true, name: true, role: true } as const;
      const u = input.existing
        ? await tx.user.update({
            where: { id: input.existing.id },
            data: {
              passwordHash: input.passwordHash,
              name: input.name || input.existing.name,
              role: input.invite.role,
              inviteCodeId: input.invite.id,
              companyIdsJson: input.invite.companyIdsJson,
              activeOrgId: input.orgId,
              lastLoginAt: new Date(),
            },
            select,
          })
        : await tx.user.create({
            data: {
              email: input.email,
              passwordHash: input.passwordHash,
              name: input.displayName,
              role: input.invite.role,
              inviteCodeId: input.invite.id,
              companyIdsJson: input.invite.companyIdsJson,
              activeOrgId: input.orgId,
              status: "active",
            },
            select,
          });

      const membership = await upsertMembership(tx, input.orgId, u.id, input.orgRole);
      return { user: u, membershipAction: membership.action, membershipRole: membership.role };
    });
    user = out.user;
    membershipAction = `${out.membershipAction}:${out.membershipRole}`;
  } catch (err) {
    if (err instanceof InviteAlreadyUsedError) {
      return NextResponse.json({ error: "邀请码已达使用上限" }, { status: 400 });
    }
    throw err;
  }

  // PERM-6b：经企业邀请码加入后按平台角色自动绑岗位（平台 trade → trade_rep、sales → sales_rep；已有绑定不动）。
  // 岗位模式企业没有绑定即无权限，所以必须在这里落。
  await ensureDefaultPositions({ orgId: input.orgId, actorUserId: user.id });

  const token = await createSession({ sub: user.id, email: user.email, role: user.role });
  const response = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    organization: { id: input.orgId },
  });
  setSessionCookie(response, token);

  await logAudit({
    userId: user.id,
    orgId: input.orgId,
    action: input.existing ? AUDIT_ACTIONS.LOGIN : AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.USER,
    targetId: user.id,
    afterData: { inviteCodeId: input.invite.id, orgBound: true, membership: membershipAction },
    request,
  });

  return response;
}

/**
 * 根据角色 bootstrap 不同的初始数据
 * - admin/user: 创建组织 + 默认项目 + 环境
 * - sales/trade: 仅创建组织（不需要项目管理模块）
 */
async function bootstrapNewUser(userId: string, displayName: string, role: string) {
  const orgCode = `personal-${userId.slice(0, 8)}`;

  await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: `${displayName}的工作区`,
        code: orgCode,
        ownerId: userId,
        planType: "free",
      },
    });

    await tx.organizationMember.create({
      data: {
        orgId: org.id,
        userId,
        role: "org_admin",
        status: "active",
      },
    });

    if (role === "user") {
      const project = await tx.project.create({
        data: {
          orgId: org.id,
          name: "我的第一个项目",
          description: "这是系统自动创建的默认项目，你可以在这里管理 Prompt、知识库和环境配置。",
          ownerId: userId,
          status: "active",
        },
      });

      await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId,
          role: "project_admin",
          status: "active",
        },
      });

      for (const env of DEFAULT_ENVIRONMENTS) {
        await tx.environment.create({
          data: {
            projectId: project.id,
            name: env.name,
            code: env.code,
          },
        });
      }
    }
  });
}
