import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { validateAdminInviteOrgBinding } from "@/lib/organizations/onboarding-rules";
import { findBindableOrg } from "@/lib/organizations/invite-org-binding";

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const codes = await db.inviteCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // USR-1：每个码带上所属企业（InviteCode.orgId 不是外键关系，单独查一次）
  const orgIds = [...new Set(codes.map((c) => c.orgId).filter((v): v is string => !!v))];
  const orgs = orgIds.length
    ? await db.organization.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true, status: true },
      })
    : [];
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  return NextResponse.json({
    codes: codes.map((c) => ({
      ...c,
      org: c.orgId ? orgById.get(c.orgId) ?? { id: c.orgId, name: null, status: "missing" } : null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { code, role, label, maxUses, expiresAt, companyIds, orgId, orgRole } = body as {
    code?: string;
    role?: string;
    label?: string;
    maxUses?: number | null;
    expiresAt?: string | null;
    companyIds?: string[];
    orgId?: unknown;
    orgRole?: unknown;
  };

  if (!code || !role) {
    return NextResponse.json(
      { error: "邀请码和角色为必填项" },
      { status: 400 }
    );
  }

  const validRoles = [
    // PERM-7b：不再签发平台 admin（平台管理员只有 super_admin，等同 user 的 admin 没有意义）
    "boss",
    "manager",
    "operations",
    "sales",
    "trade",
    "user",
  ];
  if (!validRoles.includes(role)) {
    return NextResponse.json(
      { error: `无效角色，可选: ${validRoles.join(", ")}` },
      { status: 400 }
    );
  }

  // USR-1：加入企业（选填）——平台角色只能 sales / trade，企业须存在且启用
  const binding = validateAdminInviteOrgBinding({ role, orgId, orgRole });
  if (!binding.ok) {
    return NextResponse.json({ error: binding.error }, { status: 400 });
  }
  const boundOrg = binding.orgId ? await findBindableOrg(binding.orgId) : null;
  if (binding.orgId && !boundOrg) {
    return NextResponse.json({ error: "企业不存在或已停用" }, { status: 400 });
  }

  const existing = await db.inviteCode.findUnique({
    where: { code: code.trim().toUpperCase() },
  });
  if (existing) {
    return NextResponse.json({ error: "邀请码已存在" }, { status: 409 });
  }

  // 公司 logo 跟随企业：绑定企业时按该企业关联的公司写入（页面不再提供选择，传入的 companyIds 忽略）；
  // 不绑定企业时仍接受旧参数 companyIds（接口兼容）
  let companyIdsJson: string | null = null;
  if (boundOrg) {
    companyIdsJson = boundOrg.companyId ? JSON.stringify([boundOrg.companyId]) : null;
  } else if (companyIds && companyIds.length > 0) {
    const validCompanies = await db.company.findMany({
      where: { id: { in: companyIds }, isActive: true },
      select: { id: true },
    });
    if (validCompanies.length !== companyIds.length) {
      return NextResponse.json(
        { error: "包含无效或已停用的公司" },
        { status: 400 },
      );
    }
    companyIdsJson = JSON.stringify(companyIds);
  }

  const inviteCode = await db.inviteCode.create({
    data: {
      code: code.trim().toUpperCase(),
      role,
      label: label?.trim() || null,
      maxUses: maxUses ?? null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdById: auth.user.id,
      companyIdsJson,
      orgId: binding.orgId,
      orgRole: binding.orgRole,
    },
  });

  return NextResponse.json({ inviteCode }, { status: 201 });
}
