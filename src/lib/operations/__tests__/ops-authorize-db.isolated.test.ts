/**
 * PERM-4b：运营 / 增长中心 / 平台用户管理按岗位权限——真实 DB（隔离库）+ 真实路由端到端
 *
 *   运营配置读写（销售 403 / 老板读 200 改 403 / Marty 改 200 / Maggie 扇出 403 / 招投标岗写投标档案 200）；
 *   Playbook（Maggie 起草提交 200、Marty 自批 403、老板批 Marty 的 200、销售读 403）；
 *   发布任务（Maggie 批 403、Marty 批 Maggie 的放行、平台角色 boss 自批 403、创建人可驳回自己的）；
 *   增长中心（销售写 403、Marty 写 200、Maggie canEdit=false）；平台用户管理（平台 admin 403）；
 *   运营中心入口（平台角色 operations 无岗位 403、Maggie 200）。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/operations/__tests__/ops-authorize-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据；发布通道用 postflow（DB 队列，不出网）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-4b 运营权限 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-4b ops authorize DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-4b-isolated-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : "");
  }
}

type Handler = (r: unknown, c: unknown) => Promise<Response>;

const PLAYBOOK_CONTENT = {
  accountRole: "主账号",
  businessObjective: "为本地窗饰业务带来上门测量线索",
  positioning: "本地高端定制窗饰品牌，强调做工与安装",
  toneOfVoice: "专业亲和",
  targetAudienceJson: ["本地屋主"],
  contentPillarsJson: ["安装案例", "面料知识", "季节促销"],
  ctaStrategyJson: { primary: "预约免费上门测量" },
};

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const brandRoute = await import("@/app/api/operations/brand-profile/route");
  const contentPlanRoute = await import("@/app/api/operations/content-plan/route");
  const fanoutRoute = await import("@/app/api/operations/video-assets/[id]/fanout/route");
  const tenderRoute = await import("@/app/api/operations/tender-profile/route");
  const pbListRoute = await import("@/app/api/operations/matrix-accounts/[id]/playbooks/route");
  const pbSubmitRoute = await import("@/app/api/operations/matrix-accounts/[id]/playbooks/[playbookId]/submit/route");
  const pbApproveRoute = await import("@/app/api/operations/matrix-accounts/[id]/playbooks/[playbookId]/approve/route");
  const pjApproveRoute = await import("@/app/api/operations/publish-jobs/[id]/approve/route");
  const pjRejectRoute = await import("@/app/api/operations/publish-jobs/[id]/reject/route");
  const growthBrandRoute = await import("@/app/api/marketing/brand-profile/route");
  const usersRoute = await import("@/app/api/users/route");
  const opsHomeRoute = await import("@/app/api/ops/home/route");

  const stamp = Date.now().toString(36);
  const BOSS = `opboss_${stamp}`;
  const MARTY = `opmarty_${stamp}`;
  const MAGGIE = `opmaggie_${stamp}`;
  const REP = `oprep_${stamp}`;
  const BIDS = `opbids_${stamp}`;
  const PADMIN = `oppadmin_${stamp}`;
  const OPSNOKEY = `opnokey_${stamp}`;
  const ORG = `oporg_${stamp}`;
  const users = [BOSS, MARTY, MAGGIE, REP, BIDS, PADMIN, OPSNOKEY];
  const roleOf: Record<string, string> = { [BOSS]: "boss", [MARTY]: "operations", [MAGGIE]: "operations", [REP]: "sales", [BIDS]: "user", [PADMIN]: "admin", [OPSNOKEY]: "operations" };

  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: roleOf[id] } });
  }
  await db.organization.create({ data: { id: ORG, name: "Example Blinds Fixture", code: `opo-${stamp}`, ownerId: BOSS, industryPackId: "window_covering_services_v1" } });
  for (const id of users) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  }
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    const dup = await db.principalRoleBinding.findFirst({ where: { orgId: ORG, principalId: userId, roleProfileId: profile!.id } });
    if (!dup) await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(BOSS, "owner");
  await bind(MARTY, "ops_lead");
  await bind(MAGGIE, "ops_staff");
  await bind(REP, "sales_rep");
  await bind(BIDS, "bids");
  // OPSNOKEY：平台角色 operations、org_member、无岗位——兼容回退为空

  const account = await db.matrixAccount.create({ data: { orgId: ORG, platform: "instagram", handle: `fixture_${stamp}`, publishChannel: "postflow" } });
  const asset = await db.videoAsset.create({ data: { orgId: ORG, source: "manual", title: "Fixture video", videoUrl: "https://example.test/v.mp4" } });
  // PublishJob 在 (assetId, accountId) 上唯一：每条任务一条资产
  const job = async (createdById: string) => {
    const a = await db.videoAsset.create({ data: { orgId: ORG, source: "manual", title: `Fixture video ${createdById}`, videoUrl: "https://example.test/v.mp4" } });
    return db.publishJob.create({ data: { orgId: ORG, assetId: a.id, accountId: account.id, captionText: "Fixture caption for review", channel: "postflow", status: "pending_human_approval", createdById } });
  };
  const jobByMaggie = await job(MAGGIE);
  const jobByBoss = await job(BOSS);
  const jobByMarty = await job(MARTY);

  const call = async (handler: Handler, uid: string, url: string, method = "GET", body?: unknown, params: Record<string, string> = {}) => {
    const cookie = `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: roleOf[uid] })}`;
    const sep = url.includes("?") ? "&" : "?";
    const r = new NextRequest(`http://localhost${url}${sep}orgId=${ORG}`, {
      method,
      headers: { "content-type": "application/json", cookie, "x-forwarded-for": "10.31.0.6" },
      body: body === undefined ? undefined : JSON.stringify({ orgId: ORG, ...(body as object) }),
    });
    const res = await handler(r, { params: Promise.resolve(params) });
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, body: (ct.includes("json") ? await res.json() : null) as Record<string, unknown> | null };
  };

  try {
    console.log("\n[1] 运营配置读写");
    const b1 = await call(brandRoute.GET as unknown as Handler, REP, `/api/operations/brand-profile`);
    ok(b1.status === 403, "销售读品牌档案 → 403", b1);
    const b2 = await call(contentPlanRoute.GET as unknown as Handler, BOSS, `/api/operations/content-plan`);
    ok(b2.status === 200, "老板读内容计划 → 200", b2.status);
    const b3 = await call(brandRoute.PUT as unknown as Handler, BOSS, `/api/operations/brand-profile`, "PUT", { brandName: "Example Brand" });
    ok(b3.status === 403, "老板（平台角色 boss）改品牌档案 → 403", b3);
    const b4 = await call(brandRoute.PUT as unknown as Handler, MARTY, `/api/operations/brand-profile`, "PUT", { brandName: "Example Brand" });
    ok(b4.status === 200, "Marty（ops_lead）改品牌档案 → 200", b4);
    const f1 = await call(fanoutRoute.POST as unknown as Handler, MAGGIE, `/api/operations/video-assets/${asset.id}/fanout`, "POST", { captionText: "x", groupName: "默认组" }, { id: asset.id });
    ok(f1.status === 403, "Maggie（ops_staff）扇出视频 → 403", f1);
    const t1 = await call(tenderRoute.PUT as unknown as Handler, BIDS, `/api/operations/tender-profile`, "PUT", { entityName: "Example Tender Inc." });
    ok(t1.status === 200, "招投标岗保存投标档案 → 200", t1);
    const t2 = await call(tenderRoute.GET as unknown as Handler, REP, `/api/operations/tender-profile`);
    ok(t2.status === 403, "销售读投标档案 → 403", t2.status);

    console.log("\n[2] Playbook 分权");
    const pr = await call(pbListRoute.GET as unknown as Handler, REP, `/api/operations/matrix-accounts/${account.id}/playbooks`, "GET", undefined, { id: account.id });
    ok(pr.status === 403, "销售读 Playbook → 403", pr.status);
    const pm = await call(pbListRoute.POST as unknown as Handler, MAGGIE, `/api/operations/matrix-accounts/${account.id}/playbooks`, "POST", { content: PLAYBOOK_CONTENT }, { id: account.id });
    const pmId = String((pm.body?.playbook as { id?: string })?.id ?? "");
    const pms = await call(pbSubmitRoute.POST as unknown as Handler, MAGGIE, `/api/operations/matrix-accounts/${account.id}/playbooks/${pmId}/submit`, "POST", {}, { id: account.id, playbookId: pmId });
    ok(pm.status === 201 && pms.status === 200, "Maggie 起草 + 提交 Playbook → 201 / 200", { pm: pm.status, pms: pms.body });
    const pa0 = await call(pbApproveRoute.POST as unknown as Handler, MAGGIE, `/api/operations/matrix-accounts/${account.id}/playbooks/${pmId}/approve`, "POST", {}, { id: account.id, playbookId: pmId });
    ok(pa0.status === 403, "Maggie 批准 Playbook → 403（无批准权）", pa0);
    await db.matrixAccountPlaybook.update({ where: { id: pmId }, data: { status: "archived" } });
    const px = await call(pbListRoute.POST as unknown as Handler, MARTY, `/api/operations/matrix-accounts/${account.id}/playbooks`, "POST", { content: PLAYBOOK_CONTENT }, { id: account.id });
    const pxId = String((px.body?.playbook as { id?: string })?.id ?? "");
    await call(pbSubmitRoute.POST as unknown as Handler, MARTY, `/api/operations/matrix-accounts/${account.id}/playbooks/${pxId}/submit`, "POST", {}, { id: account.id, playbookId: pxId });
    const pa1 = await call(pbApproveRoute.POST as unknown as Handler, MARTY, `/api/operations/matrix-accounts/${account.id}/playbooks/${pxId}/approve`, "POST", {}, { id: account.id, playbookId: pxId });
    ok(pa1.status === 403 && (await db.matrixAccountPlaybook.findUnique({ where: { id: pxId } }))?.status === "submitted", "Marty 批自己提交的 Playbook → 403，仍为待审", pa1);
    const pa2 = await call(pbApproveRoute.POST as unknown as Handler, BOSS, `/api/operations/matrix-accounts/${account.id}/playbooks/${pxId}/approve`, "POST", {}, { id: account.id, playbookId: pxId });
    ok(pa2.status === 200 && (await db.matrixAccountPlaybook.findUnique({ where: { id: pxId } }))?.status === "approved", "老板批 Marty 的 Playbook → 200，已批准", pa2);

    console.log("\n[3] 发布任务审核");
    const j1 = await call(pjApproveRoute.POST as unknown as Handler, MAGGIE, `/api/operations/publish-jobs/${jobByMaggie.id}/approve`, "POST", {}, { id: jobByMaggie.id });
    ok(j1.status === 403 && (await db.publishJob.findUnique({ where: { id: jobByMaggie.id } }))?.status === "pending_human_approval", "Maggie 批发布任务 → 403，状态不变", j1);
    const j2 = await call(pjApproveRoute.POST as unknown as Handler, MARTY, `/api/operations/publish-jobs/${jobByMaggie.id}/approve`, "POST", {}, { id: jobByMaggie.id });
    const j2row = await db.publishJob.findUnique({ where: { id: jobByMaggie.id } });
    ok(j2.status === 200 && j2row?.approvedById === MARTY, "Marty 批 Maggie 创建的任务 → 放行并按既有流程派发（postflow 入队）", { j2: j2.body, status: j2row?.status });
    const j3 = await call(pjApproveRoute.POST as unknown as Handler, BOSS, `/api/operations/publish-jobs/${jobByBoss.id}/approve`, "POST", {}, { id: jobByBoss.id });
    ok(j3.status === 403 && j3.body?.code === "SELF_APPROVAL", "平台角色 boss 自批发布任务 → 403 SELF_APPROVAL（无 Boss 例外）", j3);
    const j4 = await call(pjRejectRoute.POST as unknown as Handler, MARTY, `/api/operations/publish-jobs/${jobByMarty.id}/reject`, "POST", { reason: "撤回" }, { id: jobByMarty.id });
    ok(j4.status === 200, "创建人（Marty）驳回自己的任务 → 200", j4);

    console.log("\n[4] 增长中心写权");
    const g1 = await call(growthBrandRoute.PUT as unknown as Handler, REP, `/api/marketing/brand-profile`, "PUT", { legalName: "Example Co" });
    ok(g1.status === 403, "销售（org_member）写增长中心 → 403", g1.status);
    const g2 = await call(growthBrandRoute.PUT as unknown as Handler, MARTY, `/api/marketing/brand-profile`, "PUT", { legalName: "Example Co" });
    ok(g2.status === 200, "Marty（ops_lead）写增长中心品牌事实 → 200", g2.status);
    const g5 = await call(growthBrandRoute.PUT as unknown as Handler, PADMIN, `/api/marketing/brand-profile`, "PUT", { legalName: "Example Co" });
    ok(g5.status === 403, "平台 admin、无 operations.manage 写增长中心 → 403", g5.status);
    const g3 = await call(growthBrandRoute.GET as unknown as Handler, MAGGIE, `/api/marketing/brand-profile`);
    ok(g3.status === 200 && (g3.body?.permissions as { canEdit?: boolean })?.canEdit === false, "Maggie 读增长中心：canEdit=false", g3.body?.permissions);
    const g4 = await call(growthBrandRoute.GET as unknown as Handler, MARTY, `/api/marketing/brand-profile`);
    ok((g4.body?.permissions as { canEdit?: boolean })?.canEdit === true, "Marty 读增长中心：canEdit=true", g4.body?.permissions);

    console.log("\n[5] 平台用户管理 / 运营中心入口");
    const u1 = await call(usersRoute.GET as unknown as Handler, PADMIN, `/api/users`);
    ok(u1.status === 403 && u1.body?.code === "PLATFORM_ADMIN_REQUIRED", "平台 admin 列平台用户 → 403", u1);
    const u2 = await call(usersRoute.GET as unknown as Handler, BOSS, `/api/users`);
    ok(u2.status === 403, "boss 列平台用户 → 403", u2.status);
    const h1 = await call(opsHomeRoute.GET as unknown as Handler, OPSNOKEY, `/api/ops/home`);
    ok(h1.status === 403, "平台角色 operations、无岗位 → 运营中心 403", h1);
    const h2 = await call(opsHomeRoute.GET as unknown as Handler, MAGGIE, `/api/ops/home`);
    ok(h2.status === 200, "Maggie（ops_staff，含 operations.read）→ 运营中心 200", h2.status);
  } finally {
    await db.publishJobStatusEvent.deleteMany({ where: { job: { orgId: ORG } } }).catch(() => undefined);
    await db.publishJob.deleteMany({ where: { orgId: ORG } });
    await db.matrixAccountPlaybook.deleteMany({ where: { orgId: ORG } });
    await db.matrixAccount.deleteMany({ where: { orgId: ORG } });
    await db.videoAsset.deleteMany({ where: { orgId: ORG } });
    await db.brandProfile.deleteMany({ where: { orgId: ORG } });
    await db.marketingBrandProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-4b 运营权限 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
