/**
 * 厂家入驻向导（PRD F6）— 真实 DB 端到端（隔离库）
 *
 *   provisionFactoryOrg（按 code 幂等：行业包 / 显式模块 / 时区 / 工作空间 / 成员）
 *   → 品类发布（revenue_spine.business_profile，保留既有商务事实）→ 网站渠道密钥（不回传其他通道凭证）
 *   → 企业邀请码注册（加入企业、不建个人工作区、角色越界拒绝、单次使用）→ 微信绑定状态
 *   → 测试询盘（收据 → 商机 → 草稿 → 通知，随后草稿系统取消、商机 disqualified、买家归档，执行器拒发）
 *   → 就绪推导 → 交接（平台管理员退出成员）；POST /api/organizations 仅平台管理员；入驻接口拒绝非平台管理员。
 *   同 code 不接管别人建的企业；补填老板邮箱把平台管理员暂代的 owner 交给工厂老板；已归档企业不可修改。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/organizations/__tests__/onboarding-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过入驻向导 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Factory onboarding DB e2e" });

// 路由级测试需要签发会话（仅本进程内的测试密钥）
process.env.JWT_SECRET = process.env.JWT_SECRET || "onboarding-isolated-test-secret-0123456789";
// 链路里的 LLM 调用（询盘分析等）指向本机不可达端口：测试绝不外呼任何模型服务
process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";
delete process.env.OPENAI_API_KEY;

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 900) : "");
  }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const {
    OnboardingError,
    createOrgInvites,
    ensureOnboardingWebsiteChannel,
    getOnboardingStatus,
    listOnboardingOrgs,
    provisionFactoryOrg,
    setOrgProductCategories,
    updateOnboardingSettings,
  } = await import("@/lib/organizations/onboarding");
  const { runOnboardingTestInquiry } = await import("@/lib/organizations/onboarding-test-inquiry");
  const { ONBOARDING_TEST_TAG, ONBOARDING_TEST_CLOSE_REASON, ONBOARDING_TEST_PENDING_ACTION_REASON } = await import(
    "@/lib/organizations/onboarding-rules"
  );
  const { loadRevenueSpinePolicy, publishRevenueSpineRule, RULE_KEY_BUSINESS_PROFILE } = await import("@/lib/revenue-spine/policy");
  const { INQUIRY_REPLY_ACTION_TYPE } = await import("@/lib/revenue-spine/fde/inbound-sales");
  const { buildRevenueQueue } = await import("@/lib/revenue-spine/daily-actions");
  const { computeRevenueCockpit } = await import("@/lib/revenue-spine/cockpit");
  const { __setToolPolicyLoaderForTest } = await import("@/lib/pending-actions/executor");
  const { execSalesSendInquiryReply, __setInquiryReplySenderForTest } = await import("@/lib/pending-actions/exec-sales-inquiry-reply");
  const registerRoute = await import("@/app/api/auth/register/route");
  const orgsRoute = await import("@/app/api/organizations/route");
  const onboardingRoute = await import("@/app/api/admin/onboarding/route");
  const onboardingOrgRoute = await import("@/app/api/admin/onboarding/[orgId]/route");
  const websiteChannelRoute = await import("@/app/api/admin/onboarding/[orgId]/website-channel/route");
  __setToolPolicyLoaderForTest(async () => ({ value: {} }));

  const stamp = Date.now().toString(36);
  const ADMIN = `obadmin_${stamp}`;
  const BOSS = `obboss_${stamp}`;
  const BOSS2 = `obboss2_${stamp}`;
  const PLAIN = `obplain_${stamp}`;
  const CODE = `example-textiles-${stamp}`;
  const createdUserIds: string[] = [ADMIN, BOSS, BOSS2, PLAIN];
  const createdOrgIds: string[] = [];
  const inviteIds: string[] = [];

  await db.user.create({ data: { id: ADMIN, email: `${ADMIN}@fixture.test`, name: "Platform Admin", role: "admin" } });
  await db.user.create({ data: { id: BOSS, email: `${BOSS}@fixture.test`, name: "Example Owner", role: "boss" } });
  await db.user.create({ data: { id: PLAIN, email: `${PLAIN}@fixture.test`, name: "Plain User", role: "user" } });
  await db.user.create({ data: { id: BOSS2, email: `${BOSS2}@fixture.test`, name: "Maple Owner", role: "boss" } });

  const session = async (id: string, role: string) => createSession({ sub: id, email: `${id}@fixture.test`, role });
  const adminCookie = `qy_session=${await session(ADMIN, "admin")}`;
  const plainCookie = `qy_session=${await session(PLAIN, "user")}`;
  let ipSeq = 1;
  const req = (url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
    new NextRequest(`http://localhost${url}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.20.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}`,
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });

  let orgId = "";
  try {
    // ── 1. 建企业：按 code 幂等 ──
    const first = await provisionFactoryOrg({
      name: "Example Textiles",
      code: CODE,
      industryPackId: "home_textile_trade_v1",
      timezone: "Asia/Shanghai",
      actorUserId: ADMIN,
      ownerUserId: BOSS,
    });
    orgId = first.orgId;
    createdOrgIds.push(orgId);
    const second = await provisionFactoryOrg({
      name: "Example Textiles (again)",
      code: CODE,
      industryPackId: "home_textile_trade_v1",
      timezone: "America/Toronto",
      actorUserId: ADMIN,
      ownerUserId: BOSS,
    });
    ok(first.created && !second.created && second.orgId === orgId, "同一 code 提交两次 → 同一企业，第二次不新建", { first, second });
    ok(second.workspacesCreated.length === 0 && second.memberships.every((m) => m.action === "keep"), "第二次不重复建工作空间 / 成员", second);
    ok(second.keptExisting.includes("timezone") && second.keptExisting.includes("modulesJson"), "第二次只补缺：既有时区 / 模块保留", second.keptExisting);
    ok(first.ownerAssigned && !second.ownerAssigned && second.keptExisting.includes("ownerId"), "新建时 owner 交给老板；重复提交 owner 不变", { first: first.ownerAssigned, second: second.ownerAssigned });
    const bossRow = await db.user.findUniqueOrThrow({ where: { id: BOSS }, select: { activeOrgId: true } });
    ok(bossRow.activeOrgId === orgId, "老板还没选过工作企业 → 当前工作企业设为该工厂", bossRow);

    const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
    const settings = (org.settingsJson ?? {}) as Record<string, unknown>;
    const onboarding = (settings.onboarding ?? {}) as Record<string, unknown>;
    ok(org.industryPackId === "home_textile_trade_v1", "industryPackId 写入", org.industryPackId);
    ok(
      JSON.stringify((org.modulesJson as { enabled: string[] }).enabled) ===
        JSON.stringify(["trade", "product_content", "supply_chain", "sales", "marketing", "operations"]),
      "modulesJson 显式写入行业包模块（不留空）",
      org.modulesJson,
    );
    ok(settings.timezone === "Asia/Shanghai" && onboarding.version === 1, "settingsJson.timezone + onboarding.version", settings);
    ok(org.ownerId === BOSS && org.name === "Example Textiles", "企业 owner 是工厂老板（不是平台管理员）；名称不被第二次覆盖", { ownerId: org.ownerId, name: org.name });
    const workspaces = await db.workspace.findMany({ where: { orgId }, select: { slug: true } });
    ok(workspaces.length === 6, "6 个默认工作空间（无重复）", workspaces);
    const members = await db.organizationMember.findMany({ where: { orgId }, select: { userId: true, role: true, status: true } });
    ok(
      members.length === 2 &&
        members.some((m) => m.userId === ADMIN && m.role === "org_admin") &&
        members.some((m) => m.userId === BOSS && m.role === "org_owner"),
      "成员：平台管理员 org_admin，老板 org_owner",
      members,
    );
    const rules = await db.orgBusinessRule.findMany({ where: { orgId, status: "active" }, select: { ruleKey: true } });
    ok(["quote_margin", "quote_auto_send", "project_risk", "agent_tool_policy"].every((k) => rules.some((r) => r.ruleKey === k)), "平台默认业务规则已补齐", rules);
    let conflict: unknown = null;
    try {
      await provisionFactoryOrg({ name: "X", code: CODE, industryPackId: "generic_business_v1", timezone: "UTC", actorUserId: ADMIN });
    } catch (err) {
      conflict = err;
    }
    ok(conflict instanceof OnboardingError && conflict.code === "CONFLICT", "同 code 不同行业包 → CONFLICT", String(conflict));

    // ── 1b. 同 code 不接管别人建的企业；补填老板把平台管理员暂代的 owner 交出 ──
    const expectConflict = async (fn: () => Promise<unknown>): Promise<OnboardingError | null> => {
      try {
        await fn();
        return null;
      } catch (err) {
        return err instanceof OnboardingError ? err : null;
      }
    };
    const SQUAT = `maple-home-goods-${stamp}`;
    const squatOrg = await db.organization.create({ data: { name: "Maple Home Goods", code: SQUAT, ownerId: PLAIN, status: "active" } });
    createdOrgIds.push(squatOrg.id);
    await db.organizationMember.create({ data: { orgId: squatOrg.id, userId: PLAIN, role: "org_admin", status: "active" } });
    // 管理员先从列表点进去改过设置（PATCH 写 settingsJson.onboarding）也不算「向导开通」，仍不接管
    await updateOnboardingSettings(squatOrg.id, { acknowledge: { wechat: true } }, ADMIN);
    for (const owner of [BOSS2, null]) {
      const err = await expectConflict(() =>
        provisionFactoryOrg({ name: "Maple Home Goods", code: SQUAT, industryPackId: "home_textile_trade_v1", timezone: "America/Toronto", actorUserId: ADMIN, ownerUserId: owner }),
      );
      ok(err?.code === "CONFLICT" && err.status === 409 && /code/.test(err.message), `普通用户先占的 code（owner=${owner ? "老板" : "空"}）→ 409，不接管`, err?.message);
    }
    const squatAfter = await db.organization.findUniqueOrThrow({ where: { id: squatOrg.id }, include: { members: true } });
    ok(
      squatAfter.industryPackId === null && squatAfter.ownerId === PLAIN && squatAfter.members.length === 1 && squatAfter.members[0].userId === PLAIN,
      "被拒后原企业不变：没加老板 / 平台管理员，没写行业包",
      { pack: squatAfter.industryPackId, members: squatAfter.members.map((m) => `${m.userId}:${m.role}`) },
    );
    const ownerClash = await expectConflict(() =>
      provisionFactoryOrg({ name: "Example Textiles", code: CODE, industryPackId: "home_textile_trade_v1", timezone: "Asia/Shanghai", actorUserId: ADMIN, ownerUserId: PLAIN }),
    );
    ok(
      ownerClash?.code === "CONFLICT" && !(await db.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId: PLAIN } } })),
      "已有老板的企业，用别人的邮箱重复提交 → 409，不把他加进企业",
      ownerClash?.message,
    );

    const LATER = `example-later-${stamp}`;
    const later1 = await provisionFactoryOrg({ name: "Example Later", code: LATER, industryPackId: "home_textile_trade_v1", timezone: "Asia/Shanghai", actorUserId: ADMIN });
    createdOrgIds.push(later1.orgId);
    const leaveAsOwner = await expectConflict(() => updateOnboardingSettings(later1.orgId, { leaveOrg: true }, ADMIN));
    ok(leaveAsOwner?.code === "CONFLICT" && /owner/.test(leaveAsOwner.message), "平台管理员仍是 owner 时不能退出成员", leaveAsOwner?.message);
    const later2 = await provisionFactoryOrg({ name: "Example Later", code: LATER, industryPackId: "home_textile_trade_v1", timezone: "Asia/Shanghai", actorUserId: ADMIN, ownerUserId: BOSS });
    const laterOrg = await db.organization.findUniqueOrThrow({ where: { id: later1.orgId }, select: { ownerId: true } });
    ok(
      !later1.ownerAssigned && later2.orgId === later1.orgId && !later2.created && later2.ownerAssigned && laterOrg.ownerId === BOSS,
      "先不填老板、再用同一 code 补填老板邮箱 → 企业 owner 改为工厂老板",
      { ownerId: laterOrg.ownerId, later2 },
    );
    const bossAfterLater = await db.user.findUniqueOrThrow({ where: { id: BOSS }, select: { activeOrgId: true } });
    ok(bossAfterLater.activeOrgId === orgId, "老板已选了别的真实企业 → 当前工作企业不被改", bossAfterLater);
    const personal2 = await db.organization.create({ data: { name: "Maple Owner 的工作区", code: `personal-ob2${stamp}`, ownerId: BOSS2, status: "active" } });
    createdOrgIds.push(personal2.id);
    await db.organizationMember.create({ data: { orgId: personal2.id, userId: BOSS2, role: "org_owner", status: "active" } });
    await db.user.update({ where: { id: BOSS2 }, data: { activeOrgId: personal2.id } });
    await updateOnboardingSettings(later1.orgId, { ownerUserId: BOSS2 }, ADMIN);
    const boss2Row = await db.user.findUniqueOrThrow({ where: { id: BOSS2 }, select: { activeOrgId: true } });
    ok(boss2Row.activeOrgId === later1.orgId, "老板停在个人工作区 → 指定为老板后当前工作企业切到该工厂", boss2Row);
    await db.organization.update({ where: { id: later1.orgId }, data: { status: "archived" } });
    const archivedCats = await expectConflict(() => setOrgProductCategories(later1.orgId, { make: ["towel"] }, ADMIN));
    const archivedPatch = await expectConflict(() => updateOnboardingSettings(later1.orgId, { timezone: "UTC" }, ADMIN));
    ok(archivedCats?.code === "CONFLICT" && archivedPatch?.code === "CONFLICT", "已归档企业：品类发布与 PATCH 都拒绝", [archivedCats?.message, archivedPatch?.message]);

    const s0 = await getOnboardingStatus(orgId);
    ok(
      !!s0 &&
        s0.steps.find((s) => s.key === "pack")?.status === "done" &&
        ["categories", "website_channel", "members", "wechat", "test_inquiry"].every((k) => s0.steps.find((s) => s.key === k)?.status === "todo") &&
        !s0.ready,
      "刚建好：只有行业包与时区完成，其余待办",
      s0?.steps,
    );

    // ── 2. 品类：做 / 不做，保留既有商务事实 ──
    await publishRevenueSpineRule({
      orgId,
      ruleKey: RULE_KEY_BUSINESS_PROFILE,
      config: { primaryMarkets: ["Canada"], commercialFacts: { moq: { quantity: 800, unit: "pcs", per: "style" } } },
      userId: ADMIN,
    });
    const published = await setOrgProductCategories(orgId, { make: ["blanket", "bathrobe", "towel"], dontMake: ["bedding", "slipper", "pet"] }, ADMIN);
    const policy = await loadRevenueSpinePolicy(orgId);
    ok(published.version === 2, "品类发布为 business_profile 新版本", published);
    ok(
      JSON.stringify(policy.businessProfile.productCategories) === JSON.stringify(["blanket", "bathrobe", "towel"]) &&
        JSON.stringify(policy.businessProfile.excludedCategories) === JSON.stringify(["bedding", "slipper", "pet"]) &&
        policy.businessProfile.productKeywords["pet bed"] === "pet",
      "生效策略：做 / 不做 / 目录识别词",
      policy.businessProfile,
    );
    ok(
      policy.businessProfile.commercialFacts.moq?.quantity === 800 && JSON.stringify(policy.businessProfile.primaryMarkets) === JSON.stringify(["Canada"]),
      "既有商务事实与主市场未被品类发布清掉",
      policy.businessProfile.commercialFacts,
    );
    const catAudit = await db.auditLog.findFirst({ where: { orgId, action: "onboarding.categories.publish" } });
    ok(!!catAudit && catAudit.userId === ADMIN, "品类发布有审计记录", catAudit?.action);
    let badCats: unknown = null;
    try {
      await setOrgProductCategories(orgId, { make: ["towel"], dontMake: ["towel"] }, ADMIN);
    } catch (err) {
      badCats = err;
    }
    ok(badCats instanceof OnboardingError && badCats.code === "INVALID_INPUT", "做 / 不做重叠 → INVALID_INPUT", String(badCats));

    // ── 3. 网站渠道：复用旧密钥，不回传其他通道凭证 ──
    await db.tradeChannel.create({
      data: { orgId, channel: "whatsapp", name: "WA", config: { accessToken: `wa-token-${stamp}-secret`, phoneNumberId: "123" } },
    });
    const ch1 = await ensureOnboardingWebsiteChannel(orgId, ADMIN);
    const ch2 = await ensureOnboardingWebsiteChannel(orgId, ADMIN, "Example Website");
    ok(ch1.created && !ch2.created && ch1.secret.length >= 20 && ch1.secret === ch2.secret, "第二次沿用原密钥（已嵌入网页的代码不失效）", { c1: ch1.created, c2: ch2.created });
    const chRes = await websiteChannelRoute.POST(req(`/api/admin/onboarding/${orgId}/website-channel`, { method: "POST", body: {}, cookie: adminCookie }), ctx(orgId));
    const chBody = await chRes.json();
    ok(chRes.status === 200 && chBody.secret === ch1.secret && !JSON.stringify(chBody).includes(`wa-token-${stamp}`), "接口只返回 website 通道自己的密钥，不含 WhatsApp 凭证", chBody);
    const chAudit = await db.auditLog.findFirst({ where: { orgId, action: "onboarding.website_channel.create" } });
    ok(!!chAudit && !(chAudit.afterData ?? "").includes(ch1.secret), "审计里只有密钥掩码", chAudit?.afterData);

    // ── 4. 企业邀请码注册 ──
    const invites = await createOrgInvites(orgId, { role: "trade", orgRole: "org_member", count: 2, expiresInDays: 7, label: null }, ADMIN);
    inviteIds.push(...invites.map((i) => i.id));
    const inviteRows = await db.inviteCode.findMany({ where: { id: { in: inviteIds } } });
    ok(
      inviteRows.length === 2 && inviteRows.every((r) => r.orgId === orgId && r.orgRole === "org_member" && r.maxUses === 1 && !!r.expiresAt && r.expiresAt > new Date()),
      "邀请码绑定企业、单次使用、有到期时间",
      inviteRows,
    );
    const repEmail = `rep_${stamp}@maplehome.example`;
    const regRes = await registerRoute.POST(req("/api/auth/register", { method: "POST", body: { email: repEmail, password: "secret123", name: "Maple Rep", inviteCode: invites[0].code.toLowerCase() } }));
    const regBody = await regRes.json();
    const rep = await db.user.findUnique({ where: { email: repEmail } });
    if (rep) createdUserIds.push(rep.id);
    ok(regRes.status === 200 && regBody.organization?.id === orgId, "企业邀请码注册成功", regBody);
    ok(rep?.role === "trade" && rep.activeOrgId === orgId, "平台角色 trade，当前工作企业 = 该企业", { role: rep?.role, activeOrgId: rep?.activeOrgId });
    const repMemberships = rep ? await db.organizationMember.findMany({ where: { userId: rep.id } }) : [];
    ok(repMemberships.length === 1 && repMemberships[0].orgId === orgId && repMemberships[0].role === "org_member", "只加入该企业（org_member），没有个人工作区", repMemberships);
    ok(!rep || !(await db.organization.findFirst({ where: { code: `personal-${rep.id.slice(0, 8)}` } })), "未建 personal- 组织");
    const reuse = await registerRoute.POST(req("/api/auth/register", { method: "POST", body: { email: `rep2_${stamp}@maplehome.example`, password: "secret123", inviteCode: invites[0].code } }));
    ok(reuse.status === 400 && !(await db.user.findUnique({ where: { email: `rep2_${stamp}@maplehome.example` } })), "同一邀请码第二次使用被拒，且没有建用户", await reuse.json());

    // 越界角色：直接写库伪造（接口层已拒绝），注册时二次校验仍拒绝
    for (const [role, orgRole] of [["admin", "org_member"], ["boss", "org_member"], ["trade", "org_owner"]] as const) {
      const bad = await db.inviteCode.create({ data: { code: `QY-BAD${role.toUpperCase()}${orgRole.length}${stamp}`.toUpperCase(), role, createdById: ADMIN, maxUses: 1, orgId, orgRole } });
      inviteIds.push(bad.id);
      const email = `bad_${role}_${orgRole}_${stamp}@maplehome.example`;
      const r = await registerRoute.POST(req("/api/auth/register", { method: "POST", body: { email, password: "secret123", inviteCode: bad.code } }));
      ok(r.status === 400 && !(await db.user.findUnique({ where: { email } })), `企业邀请码角色越界（${role} / ${orgRole}）注册被拒`, r.status);
    }

    // 企业管理员邀请
    const adminInvite = await createOrgInvites(orgId, { role: "sales", orgRole: "org_admin", count: 1, expiresInDays: 1, label: "Sales lead" }, ADMIN);
    inviteIds.push(adminInvite[0].id);
    const leadEmail = `lead_${stamp}@maplehome.example`;
    const leadRes = await registerRoute.POST(req("/api/auth/register", { method: "POST", body: { email: leadEmail, password: "secret123", inviteCode: adminInvite[0].code } }));
    const lead = await db.user.findUnique({ where: { email: leadEmail } });
    if (lead) createdUserIds.push(lead.id);
    const leadMember = lead ? await db.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId: lead.id } } }) : null;
    ok(leadRes.status === 200 && lead?.role === "sales" && leadMember?.role === "org_admin", "sales + org_admin 邀请：加入为企业管理员", { status: leadRes.status, role: lead?.role, orgRole: leadMember?.role });

    // 旧邀请码（无 orgId）行为不变：仍建个人工作区
    const legacyCode = `QY-LEGACY-${stamp}`.toUpperCase();
    const legacy = await db.inviteCode.create({ data: { code: legacyCode, role: "trade", createdById: ADMIN, maxUses: 1 } });
    inviteIds.push(legacy.id);
    const legacyEmail = `legacy_${stamp}@maplehome.example`;
    const legacyRes = await registerRoute.POST(req("/api/auth/register", { method: "POST", body: { email: legacyEmail, password: "secret123", inviteCode: legacyCode } }));
    const legacyUser = await db.user.findUnique({ where: { email: legacyEmail } });
    if (legacyUser) createdUserIds.push(legacyUser.id);
    const personal = legacyUser ? await db.organization.findFirst({ where: { code: `personal-${legacyUser.id.slice(0, 8)}` } }) : null;
    if (personal) createdOrgIds.push(personal.id);
    ok(legacyRes.status === 200 && !!personal && personal.ownerId === legacyUser?.id && legacyUser?.activeOrgId === null, "无 orgId 的旧邀请码：仍建个人工作区（行为不变）", { status: legacyRes.status, personal: personal?.code });

    // ── 5. 微信绑定状态 ──
    const s1 = await getOnboardingStatus(orgId);
    ok(s1?.steps.find((s) => s.key === "members")?.status === "done" && s1.steps.find((s) => s.key === "wechat")?.status === "todo", "有业务员后：邀请步骤完成，微信待绑定", s1?.steps);
    await db.weChatBinding.create({ data: { userId: rep!.id, orgId, channel: "personal_wechat", externalId: `wx_${stamp}`, status: "active" } });
    const s2 = await getOnboardingStatus(orgId);
    const repRow = s2?.members.find((m) => m.userId === rep!.id);
    ok(repRow?.wechatBound === true && s2?.steps.find((s) => s.key === "wechat")?.status === "done", "业务员绑定微信后：微信步骤完成", repRow);
    const inviteState = (id: string) => s2?.invites.find((i) => i.id === id)?.state;
    ok(inviteState(invites[0].id) === "used" && inviteState(invites[1].id) === "unused" && inviteState(adminInvite[0].id) === "used", "邀请码状态：已用 / 未用如实推导", s2?.invites.map((i) => i.state));

    // ── 6. 测试询盘 ──
    const t1 = await runOnboardingTestInquiry(orgId, ADMIN);
    ok(t1.ok, "测试询盘全链路通过", t1);
    ok(t1.eventId === `onboarding-test-${orgId}-1` && t1.stages.receipt.ok, "收据：onboarding-test-<orgId>-1", t1.stages.receipt);
    ok(t1.stages.opportunity.ok && t1.stages.draft.ok && !!t1.stages.draft.pendingActionId, "建出商机，草稿进入审批", { opp: t1.stages.opportunity, draft: t1.stages.draft });
    const testBuyers = await db.salesCustomer.findMany({ where: { orgId, email: { equals: "onboarding-test@example.com", mode: "insensitive" } }, select: { id: true } });
    ok(
      t1.stages.opportunity.customerId === t1.stages.opportunity.preTaggedBuyerId && testBuyers.length === 1,
      "商机挂在入链前预建、已带测试标记的买家上（草稿生成时就带拒发标记，不是事后补打）",
      { customerId: t1.stages.opportunity.customerId, preTagged: t1.stages.opportunity.preTaggedBuyerId, buyers: testBuyers.length },
    );
    ok(t1.stages.notification.ok && t1.stages.notification.recipients >= 2 && t1.stages.notification.wechatRecipients >= 1, "通知了业务员与老板，其中已绑定微信的被统计", t1.stages.notification);
    const draft = await db.pendingAction.findUnique({ where: { id: t1.stages.draft.pendingActionId! } });
    ok(
      draft?.type === INQUIRY_REPLY_ACTION_TYPE && draft.status === "failed" && (draft.failureReason ?? "").startsWith(ONBOARDING_TEST_PENDING_ACTION_REASON) && draft.decidedById === null,
      "草稿经系统作废原语终止（failed + SUPERSEDED_BY_ONBOARDING_TEST，不冒充人工拒绝）",
      { status: draft?.status, reason: draft?.failureReason, decidedById: draft?.decidedById },
    );
    const opp = await db.salesOpportunity.findUnique({ where: { id: t1.stages.opportunity.opportunityId! }, include: { customer: true } });
    ok(opp?.stage === "disqualified" && opp.lostReason === ONBOARDING_TEST_CLOSE_REASON, "商机 → disqualified（lostReason = onboarding test）", { stage: opp?.stage, lostReason: opp?.lostReason });
    ok(!!opp?.customer.archivedAt && (opp.customer.tags ?? "").includes(ONBOARDING_TEST_TAG) && /@example\.com$/.test(opp.customer.email ?? ""), "测试买家（example.com）已打标记并归档", { tags: opp?.customer.tags, archivedAt: opp?.customer.archivedAt });
    const openActions = await db.salesAction.count({ where: { orgId, opportunityId: opp?.id ?? "", status: { in: ["open", "in_progress"] } } });
    ok(openActions === 0 && t1.stages.closed.salesActionsDismissed >= 1, "FDE / SLA 行动已关闭", { openActions, closed: t1.stages.closed });
    const prospect = await db.tradeProspect.findUnique({ where: { id: t1.stages.opportunity.prospectId! } });
    ok(prospect?.stage === "archived" && prospect.nextFollowUpAt === null, "Trade 线索 archived（不触发 SLA 提醒）", { stage: prospect?.stage });
    const interaction = await db.customerInteraction.findFirst({ where: { orgId, opportunityId: opp?.id ?? "", direction: "inbound" } });
    const utm = ((interaction?.analysisResult ?? {}) as { utm?: { source?: string } }).utm;
    ok(utm?.source === "qingyan_onboarding_test", "互动带测试 utm 标记（指标可过滤）", utm);

    // 不可发送：执行器拒发（即使有人拿到草稿内容直接调用）；审批端点也不能批准已终止的草稿
    let sent = 0;
    __setInquiryReplySenderForTest(async () => {
      sent++;
      return { channel: "test", messageId: "never" };
    });
    try {
      const payload = draft!.payload as Parameters<typeof execSalesSendInquiryReply>[0];
      const exec = await execSalesSendInquiryReply(payload, { userId: ADMIN, role: "admin", orgId }, draft!.id);
      ok(!exec.ok && exec.errorCode === "ONBOARDING_TEST" && sent === 0, "执行器对测试买家拒发（ONBOARDING_TEST）", exec);
      const { approveApprovalItem } = await import("@/lib/approval/port");
      const approved = await approveApprovalItem("pending_action", draft!.id, { userId: ADMIN, role: "admin", orgId });
      ok(!approved.ok && sent === 0, "已终止的草稿无法再批准发送", approved);
    } finally {
      __setInquiryReplySenderForTest(null);
    }

    // 指标 / 队列：测试商机不在开放 pipeline 与今日队列
    const queue = await buildRevenueQueue(orgId, { limit: 50 });
    const inQueue = [queue.hotLeads, queue.needReply, queue.quoteFollowUp, queue.sampleFollowUp, queue.followUpsDue, queue.stale].some((b) =>
      b.some((o) => o.id === opp?.id),
    );
    const cockpit = await computeRevenueCockpit(orgId);
    ok(!inQueue && queue.approvalsRequired === 0, "测试商机不进今日收入队列，也没有待审批", { approvals: queue.approvalsRequired });
    ok(cockpit.metrics.openOpportunities === 0 && cockpit.metrics.qualifiedPipeline.count === 0, "收入驾驶舱开放商机 / 合格 pipeline 不含测试单", cockpit.metrics);

    // 第二次测试：新序号、新商机，同样关闭
    const t2 = await runOnboardingTestInquiry(orgId, ADMIN);
    ok(t2.ok && t2.counter === 2 && t2.stages.opportunity.opportunityId !== t1.stages.opportunity.opportunityId, "第二次测试：序号 2，新商机，同样关闭", t2);

    // 驾驶舱阶段分布：测试单不计入；lostReason 为空 / 其他原因的真实 disqualified 照常计入
    const realCustomer = await db.salesCustomer.create({ data: { orgId, name: "Maple Home Goods", createdById: BOSS } });
    for (const lostReason of [null, "price too high"]) {
      await db.salesOpportunity.create({ data: { orgId, customerId: realCustomer.id, title: "Real inquiry", stage: "disqualified", lostReason, createdById: BOSS } });
    }
    const cockpit2 = await computeRevenueCockpit(orgId);
    const disq = cockpit2.stageCounts.find((g) => g.stage === "disqualified");
    const disqAll = await db.salesOpportunity.count({ where: { orgId, stage: "disqualified" } });
    ok(disq?.count === 2 && disqAll === 4, "收入驾驶舱阶段分布排除 2 条测试单，保留 2 条真实 disqualified", { stageCounts: cockpit2.stageCounts, disqAll });

    // ── 7. 就绪推导 ──
    const s3 = await getOnboardingStatus(orgId);
    ok(
      s3?.testInquiries.length === 2 && s3.testInquiries.every((t) => t.opportunityStage === "disqualified" && t.openDrafts === 0 && t.draftGenerated),
      "状态里两次测试都生成过草稿且已关闭",
      s3?.testInquiries,
    );
    ok(s3?.steps.find((s) => s.key === "test_inquiry")?.status === "done" && s3.ready, "全部必做完成 → 就绪（发件身份为推荐项）", s3?.steps);
    const h3 = s3?.steps.find((s) => s.key === "handoff");
    ok(h3?.status === "warning" && h3.required === false && /Platform Admin/.test(h3.detail), "交接提示：平台管理员仍在成员里（推荐项，不阻塞就绪）", h3);
    await updateOnboardingSettings(orgId, { acknowledge: { email_sender: true }, timezone: "Asia/Ho_Chi_Minh" }, ADMIN);
    const s4 = await getOnboardingStatus(orgId, { configHealth: true, actorUserId: ADMIN });
    ok(
      s4?.steps.find((s) => s.key === "email_sender")?.status === "acknowledged" && s4.org.timezone === "Asia/Ho_Chi_Minh" && !!s4.acknowledged.email_sender,
      "PATCH：确认暂用平台发件地址、改时区（只存确认标记）",
      { steps: s4?.steps, ack: s4?.acknowledged },
    );
    ok(!!s4?.configHealth && Array.isArray(s4.configHealth.issues) && s4.ready, "附带中台配置健康问题；平台级问题不阻塞就绪", s4?.configHealth?.issues.map((i) => `${i.scope}:${i.severity}:${i.code}`));
    const listed = await listOnboardingOrgs();
    ok(
      listed.some((o) => o.id === orgId && o.stepsComplete) && !listed.some((o) => o.code.startsWith("personal-")) && !listed.some((o) => o.id === later1.orgId),
      "列表含该企业（必做步骤已完成），不含个人工作区与已归档企业",
      listed.filter((o) => o.id === orgId),
    );

    // 交接：平台管理员本人退出成员（不再收该厂询盘通知），仍可继续管理入驻
    await updateOnboardingSettings(orgId, { leaveOrg: true }, ADMIN);
    const adminMember = await db.organizationMember.findUnique({ where: { orgId_userId: { orgId, userId: ADMIN } } });
    const s5 = await getOnboardingStatus(orgId);
    ok(
      adminMember?.status === "inactive" && s5?.steps.find((s) => s.key === "handoff")?.status === "done" && s5.ready && !s5.members.some((m) => m.userId === ADMIN),
      "交接后平台管理员成员停用，交接步骤完成，仍就绪",
      { status: adminMember?.status, handoff: s5?.steps.find((s) => s.key === "handoff") },
    );
    const leaveTwice = await expectConflict(() => updateOnboardingSettings(orgId, { leaveOrg: true }, ADMIN));
    ok(leaveTwice?.code === "CONFLICT", "已退出再退出 → 409", leaveTwice?.message);
    const leaveAudit = await db.auditLog.findFirst({ where: { orgId, action: "onboarding.org.update", userId: ADMIN }, orderBy: { createdAt: "desc" } });
    ok(!!leaveAudit && (leaveAudit.afterData ?? "").includes("actorLeftOrg"), "交接有审计记录", leaveAudit?.afterData);

    // ── 8. 路由鉴权 ──
    const plainCreate = await orgsRoute.POST(req("/api/organizations", { method: "POST", body: { name: "Should Not Exist" }, cookie: plainCookie }));
    const plainCreateBody = await plainCreate.json();
    ok(plainCreate.status === 403 && plainCreateBody.code === "PLATFORM_ADMIN_REQUIRED", "普通用户 POST /api/organizations → 403", plainCreateBody);
    const adminCreate = await orgsRoute.POST(req("/api/organizations", { method: "POST", body: { name: "Blank Org", code: `blank-${stamp}` }, cookie: adminCookie }));
    const adminCreateBody = await adminCreate.json();
    if (adminCreateBody.organization?.id) createdOrgIds.push(adminCreateBody.organization.id);
    ok(adminCreate.status === 201, "平台管理员仍可 POST /api/organizations", adminCreateBody);
    const plainList = await onboardingRoute.GET(req("/api/admin/onboarding", { cookie: plainCookie }));
    const plainStatus = await onboardingOrgRoute.GET(req(`/api/admin/onboarding/${orgId}`, { cookie: plainCookie }), ctx(orgId));
    const plainProvision = await onboardingRoute.POST(
      req("/api/admin/onboarding", { method: "POST", body: { name: "Nope", code: `nope-${stamp}`, industryPackId: "home_textile_trade_v1" }, cookie: plainCookie }),
    );
    ok(plainList.status === 403 && plainStatus.status === 403 && plainProvision.status === 403, "入驻接口拒绝非平台管理员", [plainList.status, plainStatus.status, plainProvision.status]);
    ok(!(await db.organization.findUnique({ where: { code: `nope-${stamp}` } })), "被拒的请求没有建企业");
    const adminStatus = await onboardingOrgRoute.GET(req(`/api/admin/onboarding/${orgId}`, { cookie: adminCookie }), ctx(orgId));
    const adminStatusBody = await adminStatus.json();
    ok(adminStatus.status === 200 && adminStatusBody.status?.org?.id === orgId && !JSON.stringify(adminStatusBody).includes(ch1.secret), "平台管理员读取状态（密钥只给掩码）", adminStatus.status);
    const badProvision = await onboardingRoute.POST(
      req("/api/admin/onboarding", { method: "POST", body: { name: "Bad", code: "Bad Code", industryPackId: "home_textile" }, cookie: adminCookie }),
    );
    ok(badProvision.status === 400, "建企业输入校验（非法 code / 别名包）→ 400", await badProvision.json());
    const missing = await onboardingOrgRoute.GET(req(`/api/admin/onboarding/missing_${stamp}`, { cookie: adminCookie }), ctx(`missing_${stamp}`));
    ok(missing.status === 404, "不存在的企业 → 404", missing.status);
  } finally {
    try {
      const orgIds = createdOrgIds;
      const oppIds = (await db.salesOpportunity.findMany({ where: { orgId: { in: orgIds } }, select: { id: true } })).map((o) => o.id);
      await db.pendingAction.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.websiteInquiryReceipt.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.tradeInquiryAnalysis.deleteMany({ where: { prospect: { orgId: { in: orgIds } } } }).catch(() => undefined);
      await db.tradeOutreachStep.deleteMany({ where: { orgId: { in: orgIds } } }).catch(() => undefined);
      await db.tradeMessage.deleteMany({ where: { prospect: { orgId: { in: orgIds } } } });
      await db.tradeProspect.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.tradeCampaign.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.tradeChannel.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.customerInteraction.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.salesAction.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.salesRfqEvidence.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.salesRfq.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.salesOpportunityAssessment.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.businessOutcome.deleteMany({ where: { orgId: { in: orgIds } } }).catch(() => undefined);
      await db.salesOpportunity.deleteMany({ where: { id: { in: oppIds } } });
      await db.salesCustomer.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.agentRunEvent.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.agentRun.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.agentSession.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.capabilityQuotaReservation.deleteMany({ where: { orgId: { in: orgIds } } }).catch(() => undefined);
      await db.orgBusinessRule.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.workspace.deleteMany({ where: { orgId: { in: orgIds } } });
      await db.weChatBinding.deleteMany({ where: { userId: { in: createdUserIds } } });
      await db.inviteCode.deleteMany({ where: { OR: [{ id: { in: inviteIds } }, { orgId: { in: orgIds } }] } });
      await db.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
      await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: orgIds } }, { userId: { in: createdUserIds } }] } });
      await db.user.updateMany({ where: { id: { in: createdUserIds } }, data: { activeOrgId: null } });
      await db.organizationMember.deleteMany({ where: { OR: [{ orgId: { in: orgIds } }, { userId: { in: createdUserIds } }] } });
      await db.organization.deleteMany({ where: { id: { in: orgIds } } });
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    } catch (cleanupErr) {
      console.warn("[cleanup] 清理未完成：", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  });
