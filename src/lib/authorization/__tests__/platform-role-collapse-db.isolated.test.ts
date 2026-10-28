/**
 * PERM-4c3：平台角色压扁执行器 + 岗位模式企业关闭兼容回退——真实 DB（隔离库）
 *
 *   非 super_admin 执行者拒绝；非岗位模式企业拒绝；dry-run 不写库；闸门关闭写入被拒；
 *   缺绑定 / 同时是旧模式企业成员整批拒绝；闸门打开压扁 + 审计、再跑无变化、--restore 还原；
 *   岗位模式企业无绑定成员无权限，旧模式企业照旧兼容回退。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/authorization/__tests__/platform-role-collapse-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-4c3 平台角色压扁 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-4c3 platform role collapse DB test" });

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

async function main() {
  const { db } = await import("@/lib/db");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { runPlatformRoleCollapse } = await import("@/lib/authorization/platform-role-collapse-run");
  const { COLLAPSE_AUDIT_ACTION, RESTORE_AUDIT_ACTION } = await import("@/lib/authorization/platform-role-collapse");
  const { resolveEffectiveBindings } = await import("@/lib/authorization/resolve-effective-permissions");

  const stamp = Date.now().toString(36);
  const SA = `prcsa_${stamp}`;
  const ADM = `prcadm_${stamp}`;
  const BOSS = `prcboss_${stamp}`;
  const SALES = `prcsales_${stamp}`;
  const OPS = `prcops_${stamp}`;
  const TRADE = `prctrade_${stamp}`;
  const LATE_SALES = `prclate_${stamp}`;
  const CROSS = `prccross_${stamp}`;
  const NOBIND_OWNER = `prcnbo_${stamp}`;
  const LEGACY_OWNER = `prclo_${stamp}`;
  const WC = `prcwc_${stamp}`;
  const LEGACY = `prcleg_${stamp}`;
  const WC_CODE = `prc-wc-${stamp}`;
  const LEGACY_CODE = `prc-leg-${stamp}`;
  const role: Record<string, string> = {
    [SA]: "super_admin",
    [ADM]: "admin",
    [BOSS]: "boss",
    [SALES]: "sales",
    [OPS]: "operations",
    [TRADE]: "trade",
    [LATE_SALES]: "sales",
    [CROSS]: "manager",
    [NOBIND_OWNER]: "user",
    [LEGACY_OWNER]: "boss",
  };
  const users = Object.keys(role);
  const email = (id: string) => `${id}@fixture.test`;
  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Example ${id}`, role: role[id] } });
  await db.organization.create({ data: { id: WC, name: "Example WC Fixture", code: WC_CODE, ownerId: BOSS, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: LEGACY, name: "Example Legacy Fixture", code: LEGACY_CODE, ownerId: LEGACY_OWNER } });
  const addMember = (orgId: string, userId: string, orgRole = "org_member") =>
    db.organizationMember.create({ data: { orgId, userId, role: orgRole, status: "active" } });
  await addMember(WC, BOSS, "org_owner");
  for (const id of [SALES, OPS, TRADE, CROSS]) await addMember(WC, id);
  await addMember(LEGACY, CROSS);
  await addMember(LEGACY, LEGACY_OWNER, "org_owner");
  await seedOrgAuthorizationProfiles(WC);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: WC, key } } });
    await db.principalRoleBinding.create({ data: { orgId: WC, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(BOSS, "owner");
  await bind(OPS, "ops_staff");
  await bind(CROSS, "pricing_lead");
  // seed 之后才加入：没有自动绑定
  await addMember(WC, LATE_SALES);
  await addMember(WC, NOBIND_OWNER, "org_owner");

  const run = (opts: { actor?: string; org?: string; dryRun?: boolean; restore?: boolean; ready?: boolean }) =>
    runPlatformRoleCollapse({
      orgCode: opts.org ?? WC_CODE,
      actorEmail: email(opts.actor ?? SA),
      dryRun: opts.dryRun ?? false,
      restore: opts.restore ?? false,
      ready: opts.ready ?? false,
    });
  const roles = async () =>
    Object.fromEntries((await db.user.findMany({ where: { id: { in: users } }, select: { id: true, role: true } })).map((u) => [u.id, u.role]));
  const auditCount = (action: string) => db.auditLog.count({ where: { orgId: WC, action } });

  try {
    // ── 兼容回退收口（合并即生效） ──
    const nbo = await resolveEffectiveBindings({ type: "HUMAN", id: NOBIND_OWNER, orgId: WC });
    ok(nbo.length === 0, "岗位模式企业：无绑定的 org_owner 无权限（不回退系统模板）", nbo.slice(0, 2));
    const late = await resolveEffectiveBindings({ type: "HUMAN", id: LATE_SALES, orgId: WC });
    ok(late.length === 0, "岗位模式企业：无绑定的平台 sales 无权限（不回退 sales_rep）", late.slice(0, 2));
    const bossKeys = await resolveEffectiveBindings({ type: "HUMAN", id: BOSS, orgId: WC });
    ok(bossKeys.some((b) => b.permissionKey === "organization.dashboard.read" && b.source.startsWith("binding:")), "岗位模式企业：有绑定照常（owner 键，来源 binding）");
    const lo = await resolveEffectiveBindings({ type: "HUMAN", id: LEGACY_OWNER, orgId: LEGACY });
    ok(lo.length > 0 && lo.every((b) => b.source.startsWith("compat:")), "旧模式企业：无绑定 org_owner 照旧兼容回退（来源 compat）", lo.slice(0, 2));
    const sa = await resolveEffectiveBindings({ type: "HUMAN", id: SA, orgId: WC });
    ok(sa.length > 0 && sa.every((b) => b.source.startsWith("platform_admin:")), "super_admin 全权不受影响");

    // ── 拒绝路径 ──
    const before = await roles();
    const r1 = await run({ actor: ADM, dryRun: true });
    ok(r1.exitCode === 1, "执行者是平台 admin（非 super_admin）→ 退出 1", r1.lines);
    const r2 = await run({ org: LEGACY_CODE, dryRun: true });
    ok(r2.exitCode === 2 && r2.lines.some((l) => l.includes("不是岗位模式")), "旧模式企业 → 退出 2", r2.lines);
    const r3 = await run({ org: `missing-${stamp}`, dryRun: true });
    ok(r3.exitCode === 2, "企业不存在 → 退出 2", r3.lines);

    // ── 前置校验：缺绑定 + 跨旧模式企业 ──
    const r4 = await run({ dryRun: true });
    ok(r4.exitCode === 2, "dry-run：有阻断 → 退出 2", r4.lines);
    ok(r4.lines.some((l) => l.includes(email(LATE_SALES)) && l.includes("无 active 岗位绑定")), "阻断列出缺绑定的人", r4.lines);
    ok(r4.lines.some((l) => l.includes(email(CROSS)) && l.includes(LEGACY_CODE)), "阻断列出同时是旧模式企业成员的人与企业", r4.lines);
    const r5 = await run({ ready: true });
    ok(r5.exitCode === 2, "闸门打开但有阻断 → 退出 2", r5.lines);
    ok(JSON.stringify(await roles()) === JSON.stringify(before), "有阻断：整批未写入");
    ok((await auditCount(COLLAPSE_AUDIT_ACTION)) === 0, "有阻断：无压扁审计");

    // 解除阻断：补绑定、停用旧模式企业成员关系
    await bind(LATE_SALES, "sales_rep");
    await db.organizationMember.update({ where: { orgId_userId: { orgId: LEGACY, userId: CROSS } }, data: { status: "inactive" } });

    // ── dry-run 与闸门 ──
    const r6 = await run({ dryRun: true });
    ok(r6.exitCode === 0, "dry-run：无阻断 → 退出 0", r6.lines);
    ok(r6.lines.some((l) => l === `压扁 ${email(SALES)}：sales → user`), "dry-run 打印 邮箱：前角色 → user", r6.lines);
    ok(r6.lines.some((l) => l.includes(email(TRADE)) && l.includes("不在压扁范围")), "trade 列为跳过", r6.lines);
    ok(r6.lines.some((l) => l === "待压扁 5，跳过 2，阻断 0"), "汇总：5 人待压扁（boss / sales / operations / 补绑的 sales / manager）", r6.lines);
    ok(JSON.stringify(await roles()) === JSON.stringify(before), "dry-run 不写库");
    const r7 = await run({});
    ok(r7.exitCode === 1 && r7.lines.some((l) => l.includes("PLATFORM_ROLE_COLLAPSE_READY")), "闸门关闭：写入退出 1 并提示闸门", r7.lines);
    ok(JSON.stringify(await roles()) === JSON.stringify(before), "闸门关闭：无人被改");
    ok((await auditCount(COLLAPSE_AUDIT_ACTION)) === 0, "闸门关闭：无审计");

    // ── 闸门打开：压扁 ──
    const r8 = await run({ ready: true });
    ok(r8.exitCode === 0, "闸门打开：压扁成功", r8.lines);
    const after = await roles();
    ok([BOSS, SALES, OPS, LATE_SALES, CROSS].every((id) => after[id] === "user"), "boss / sales / operations / manager → user", after);
    ok(after[TRADE] === "trade" && after[SA] === "super_admin" && after[ADM] === "admin" && after[NOBIND_OWNER] === "user", "trade / super_admin / admin / user 不变", after);
    ok(after[LEGACY_OWNER] === "boss", "非目标企业成员不受影响", after);
    const audits = await db.auditLog.findMany({ where: { orgId: WC, action: COLLAPSE_AUDIT_ACTION }, select: { targetId: true, afterData: true, userId: true } });
    ok(audits.length === 5, "每人一条压扁审计", audits.length);
    const salesAudit = audits.find((a) => a.targetId === SALES);
    const salesAfter = salesAudit?.afterData ? JSON.parse(salesAudit.afterData) : {};
    ok(salesAfter.fromRole === "sales" && salesAfter.toRole === "user" && salesAudit?.userId === SA, "审计含前后角色与执行者", salesAfter);
    ok(!audits.some((a) => /password|hash|token/i.test(a.afterData ?? "")), "审计不含密码哈希 / token");
    ok(r8.lines.some((l) => l.includes("重新登录")), "输出提醒重新登录");

    // ── 再跑无变化 ──
    const r9 = await run({ ready: true });
    ok(r9.exitCode === 0 && r9.lines.some((l) => l.startsWith("待压扁 0")), "再跑一次：0 人待压扁", r9.lines);
    ok((await auditCount(COLLAPSE_AUDIT_ACTION)) === 5, "再跑一次：不新增审计");

    // ── 还原（不受闸门限制） ──
    await db.user.update({ where: { id: OPS }, data: { role: "trade" } }); // 压扁后被另行调整
    const r10 = await run({ restore: true, dryRun: true });
    ok(r10.exitCode === 0 && r10.lines.some((l) => l === `还原 ${email(BOSS)}：user → boss`), "restore dry-run 打印还原计划", r10.lines);
    ok((await roles())[BOSS] === "user", "restore dry-run 不写库");
    const r11 = await run({ restore: true });
    ok(r11.exitCode === 0, "闸门关闭时 --restore 可执行", r11.lines);
    const restored = await roles();
    ok(restored[BOSS] === "boss" && restored[SALES] === "sales" && restored[LATE_SALES] === "sales" && restored[CROSS] === "manager", "还原为压扁前角色", restored);
    ok(restored[OPS] === "trade" && r11.lines.some((l) => l.includes(email(OPS)) && l.includes("不还原")), "当前不是 user 的人跳过", r11.lines);
    ok((await auditCount(RESTORE_AUDIT_ACTION)) === 4, "每人一条还原审计");
  } finally {
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [WC, LEGACY] } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [WC, LEGACY] } } });
    await db.roleProfile.deleteMany({ where: { orgId: { in: [WC, LEGACY] } } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: { in: [WC, LEGACY] } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: [WC, LEGACY] } } });
    await db.organization.deleteMany({ where: { id: { in: [WC, LEGACY] } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-4c3 平台角色压扁 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
