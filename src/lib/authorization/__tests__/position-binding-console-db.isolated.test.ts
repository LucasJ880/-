/**
 * PERM-7：岗位绑定界面——真实 DB（隔离库）+ 真实路由
 *
 *   positions 接口只认 super_admin；完整集合写入 / 预览 / 重新启用；校验 400；最后一个 owner 409；
 *   数字员工四岗；审计 via console；成员增删改只认 super_admin；脚本经共用服务仍可用（via 脚本路径）。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/authorization/__tests__/position-binding-console-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-7 岗位绑定界面 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-7 position binding console DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-7-isolated-test-secret-0123456789abcdef";

const ROOT = process.cwd();
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

type Handler = (req: unknown, ctx: unknown) => Promise<Response>;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { loadPermissionKeys } = await import("@/lib/rbac/permission-keys");
  const positionsRoute = await import("@/app/api/organizations/[orgId]/positions/route");
  const membersRoute = await import("@/app/api/organizations/[orgId]/members/route");
  const memberRoute = await import("@/app/api/organizations/[orgId]/members/[memberId]/route");

  const stamp = Date.now().toString(36);
  const SA = `pbsa_${stamp}`;
  const ADM = `pbadm_${stamp}`;
  const OWNER1 = `pbo1_${stamp}`;
  const OWNER2 = `pbo2_${stamp}`;
  const OADMIN = `pboa_${stamp}`;
  const MEMBER = `pbm_${stamp}`;
  const OUTSIDER = `pbout_${stamp}`;
  const NEWBIE = `pbnew_${stamp}`;
  const ORG = `pborg_${stamp}`;
  const ORG_CODE = `pb-${stamp}`;
  const role: Record<string, string> = {
    [SA]: "super_admin",
    [ADM]: "admin",
    [OWNER1]: "user",
    [OWNER2]: "user",
    [OADMIN]: "user",
    [MEMBER]: "user",
    [OUTSIDER]: "user",
    [NEWBIE]: "user",
  };
  const users = Object.keys(role);
  const email = (id: string) => `${id}@fixture.test`;
  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Example ${id}`, role: role[id] } });
  await db.organization.create({ data: { id: ORG, name: "Example WC Positions", code: ORG_CODE, ownerId: OWNER1, industryPackId: "window_covering_services_v1" } });
  for (const [id, orgRole] of [[OWNER1, "org_owner"], [OWNER2, "org_member"], [OADMIN, "org_admin"], [MEMBER, "org_member"], [ADM, "org_member"]] as const) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: orgRole, status: "active" } });
  }
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(OWNER1, "owner");
  await bind(MEMBER, "sales_rep");

  const project = await db.project.create({ data: { name: "Fixture PB project", ownerId: OWNER1, orgId: ORG } });
  const env = await db.environment.create({ data: { projectId: project.id, name: "prod", code: "prod" } });
  const agent = await db.agent.create({
    data: { projectId: project.id, environmentId: env.id, key: `pbag_${stamp}`, name: "销售助手 PB", status: "active", createdById: OWNER1, updatedById: OWNER1 },
  });

  const req = async (uid: string, method: string, url: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: {
        cookie: `qy_session=${await createSession({ sub: uid, email: email(uid), role: role[uid] })}`,
        "x-forwarded-for": "10.48.0.8",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const call = async (handler: unknown, uid: string, method: string, url: string, body?: unknown, params: Record<string, string> = { orgId: ORG }) =>
    (handler as Handler)(await req(uid, method, url, body), { params: Promise.resolve(params) });
  const posUrl = `/api/organizations/${ORG}/positions`;
  const put = (uid: string, body: unknown) => call(positionsRoute.PUT, uid, "PUT", posUrl, body);
  const json = async (r: Response) => (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const activeKeys = async (principalId: string, principalType = "HUMAN") =>
    (
      await db.principalRoleBinding.findMany({ where: { orgId: ORG, principalId, principalType, status: "active" }, select: { roleProfile: { select: { key: true } } } })
    )
      .map((b) => b.roleProfile.key)
      .sort()
      .join(",");
  const auditCount = (action: string) => db.auditLog.count({ where: { orgId: ORG, action } });

  const tmp = mkdtempSync(join(tmpdir(), "perm7-"));
  const runScript = (file: object, extra: string[]) => {
    const path = join(tmp, `b-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(path, JSON.stringify(file));
    const r = spawnSync("npx", ["tsx", "scripts/bind-positions.ts", "--org", ORG_CODE, "--file", path, "--actor", email(SA), ...extra], {
      cwd: ROOT,
      env: { ...process.env, ALLOW_POSITION_BINDING: "true" },
      encoding: "utf-8",
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  try {
    // ── 权限 ──
    const g = await call(positionsRoute.GET, SA, "GET", posUrl);
    const gd = await json(g);
    ok(g.status === 200, "super_admin 读取岗位 200", g.status);
    const members = (gd.members ?? []) as Array<{ userId: string; keys: string[] }>;
    ok(members.find((m) => m.userId === OWNER1)?.keys.includes("owner") === true, "列出成员岗位（OWNER1 含 owner）", members);
    ok(((gd.org ?? {}) as { positionMode?: boolean }).positionMode === true, "窗饰企业 positionMode = true");
    const das = (gd.digitalEmployees ?? []) as Array<{ agentId: string; sponsor: string | null }>;
    ok(das.some((a) => a.agentId === agent.id && a.sponsor === `Example ${OWNER1}`), "列出数字员工与 sponsor", das);
    for (const uid of [ADM, OWNER1, OADMIN]) {
      const r = await call(positionsRoute.GET, uid, "GET", posUrl);
      ok(r.status === 403 && (await json(r)).code === "PLATFORM_ADMIN_REQUIRED", `${uid.split("_")[0]}：读取岗位 403`, r.status);
    }
    const ownerPut = await put(OWNER1, { principalType: "HUMAN", principalId: MEMBER, keys: ["ops_staff"] });
    ok(ownerPut.status === 403 && (await activeKeys(MEMBER)) === "sales_rep", "老板岗位提交变更 403，绑定不变");

    // ── 预览与写入 ──
    const bindBefore = await auditCount("authorization.position.bind");
    const dry = await put(SA, { principalType: "HUMAN", principalId: MEMBER, keys: ["ops_staff"], dryRun: true });
    const dryPlan = (await json(dry)).plan as { create: Array<{ profileKey: string }>; deactivate: Array<{ profileKey: string }> };
    ok(dry.status === 200 && dryPlan.create.map((x) => x.profileKey).join() === "ops_staff" && dryPlan.deactivate.map((x) => x.profileKey).join() === "sales_rep", "预览：新增 ops_staff、停用 sales_rep", dryPlan);
    ok((await activeKeys(MEMBER)) === "sales_rep" && (await auditCount("authorization.position.bind")) === bindBefore, "预览不写库、不写审计");
    const keysBefore = await loadPermissionKeys(MEMBER, ORG);
    const w = await put(SA, { principalType: "HUMAN", principalId: MEMBER, keys: ["ops_staff"] });
    ok(w.status === 200 && (await activeKeys(MEMBER)) === "ops_staff", "换岗位：ops_staff active、sales_rep 停用", await json(w));
    const keysAfter = (await loadPermissionKeys(MEMBER, ORG)) ?? [];
    ok(!!keysBefore?.includes("sales.quote.create") && keysAfter.includes("operations.read") && !keysAfter.includes("sales.quote.create"), "写入后下一次解析立即生效", keysAfter.slice(0, 8));
    const lastBind = await db.auditLog.findFirst({ where: { orgId: ORG, action: "authorization.position.bind", targetId: MEMBER }, orderBy: { createdAt: "desc" } });
    const bindAfter = lastBind?.afterData ? JSON.parse(lastBind.afterData) : {};
    ok(bindAfter.profileKey === "ops_staff" && bindAfter.via === "console" && lastBind?.userId === SA, "审计：bind ops_staff、via console、执行者 super_admin", bindAfter);
    ok((await db.auditLog.count({ where: { orgId: ORG, action: "authorization.position.unbind", targetId: MEMBER } })) === 1, "审计：unbind sales_rep");
    const back = await put(SA, { principalType: "HUMAN", principalId: MEMBER, keys: ["sales_rep"] });
    const rows = await db.principalRoleBinding.count({ where: { orgId: ORG, principalId: MEMBER, roleProfile: { key: "sales_rep" } } });
    ok(back.status === 200 && rows === 1 && (await activeKeys(MEMBER)) === "sales_rep", "换回 sales_rep：重新启用旧行，不重复建行", rows);

    // ── 校验 ──
    const nonMember = await put(SA, { principalType: "HUMAN", principalId: OUTSIDER, keys: ["sales_rep"] });
    ok(nonMember.status === 400, "非成员 400");
    const unknown = await put(SA, { principalType: "HUMAN", principalId: MEMBER, keys: ["no_such_key"] });
    const unknownBody = await json(unknown);
    ok(unknown.status === 400 && ((unknownBody.errors ?? []) as string[]).some((e) => e.includes("未知岗位")), "未知岗位 400 并列原因", unknownBody);
    const badBody = await put(SA, { principalType: "ROBOT", principalId: MEMBER, keys: [] });
    ok(badBody.status === 400, "主体类型非法 400");

    // ── 最后一个 owner ──
    const last = await put(SA, { principalType: "HUMAN", principalId: OWNER1, keys: [] });
    ok(last.status === 409 && (await json(last)).code === "LAST_OWNER_BINDING" && (await activeKeys(OWNER1)).includes("owner"), "停用唯一老板 409，绑定不变");
    const lastDry = await put(SA, { principalType: "HUMAN", principalId: OWNER1, keys: [], dryRun: true });
    ok(lastDry.status === 409, "预览时也提示最后一个老板");
    ok((await put(SA, { principalType: "HUMAN", principalId: OWNER2, keys: ["owner"] })).status === 200, "给第二人绑 owner");
    const moved = await put(SA, { principalType: "HUMAN", principalId: OWNER1, keys: [] });
    ok(moved.status === 200 && !(await activeKeys(OWNER1)).includes("owner"), "还有其他老板时可停用");

    // ── 数字员工 ──
    const deOwner = await put(SA, { principalType: "DIGITAL_EMPLOYEE", principalId: agent.id, keys: ["owner"] });
    ok(deOwner.status === 400, "数字员工绑 owner 400");
    const deSales = await put(SA, { principalType: "DIGITAL_EMPLOYEE", principalId: agent.id, keys: ["sales_rep"] });
    ok(deSales.status === 200 && (await activeKeys(agent.id, "DIGITAL_EMPLOYEE")) === "sales_rep", "数字员工绑 sales_rep 200");
    ok((await activeKeys(MEMBER)) === "sales_rep" && (await activeKeys(OWNER2)) === "owner", "数字员工变更不影响人类绑定");
    const deAudit = await db.auditLog.findFirst({ where: { orgId: ORG, action: "authorization.position.bind", targetId: agent.id } });
    const deAfter = deAudit?.afterData ? JSON.parse(deAudit.afterData) : {};
    ok(deAfter.principalType === "DIGITAL_EMPLOYEE" && deAfter.agentName === "销售助手 PB" && deAfter.via === "console", "数字员工审计含主体类型与 Agent 名称", deAfter);

    // ── 成员增删改只认 super_admin ──
    const memberRow = await db.organizationMember.findFirst({ where: { orgId: ORG, userId: MEMBER } });
    const mUrl = `/api/organizations/${ORG}/members`;
    const admPost = await call(membersRoute.POST, ADM, "POST", mUrl, { userId: NEWBIE, role: "org_member" });
    ok(admPost.status === 403 && (await json(admPost)).code === "PLATFORM_ADMIN_REQUIRED", "平台 admin POST 成员 403", admPost.status);
    const admPatch = await call(memberRoute.PATCH, ADM, "PATCH", `${mUrl}/${memberRow!.id}`, { role: "org_viewer" }, { orgId: ORG, memberId: memberRow!.id });
    ok(admPatch.status === 403, "平台 admin PATCH 成员 403", admPatch.status);
    const admDelete = await call(memberRoute.DELETE, ADM, "DELETE", `${mUrl}/${memberRow!.id}`, undefined, { orgId: ORG, memberId: memberRow!.id });
    ok(admDelete.status === 403 && (await db.organizationMember.findFirst({ where: { id: memberRow!.id } }))?.status === "active", "平台 admin DELETE 成员 403，成员不变", admDelete.status);
    const oaPatch = await call(memberRoute.PATCH, OADMIN, "PATCH", `${mUrl}/${memberRow!.id}`, { role: "org_viewer" }, { orgId: ORG, memberId: memberRow!.id });
    ok(oaPatch.status === 403, "org_admin PATCH 成员 403");
    const saPost = await call(membersRoute.POST, SA, "POST", mUrl, { userId: NEWBIE, role: "org_member" });
    ok(saPost.status === 200 || saPost.status === 201, "super_admin POST 成员成功", saPost.status);
    const saPatch = await call(memberRoute.PATCH, SA, "PATCH", `${mUrl}/${memberRow!.id}`, { role: "org_viewer" }, { orgId: ORG, memberId: memberRow!.id });
    ok(saPatch.status === 200, "super_admin PATCH 成员 200", saPatch.status);
    const list = await call(membersRoute.GET, MEMBER, "GET", mUrl);
    ok(list.status === 200, "成员读目录不变（active 成员 200）", list.status);

    // ── 脚本经共用服务 ──
    const sDry = runScript({ bindings: { [email(MEMBER)]: ["sales_rep"] } }, ["--dry-run"]);
    ok(sDry.code === 0 && sDry.out.includes(`${email(MEMBER)}: sales_rep`) && sDry.out.includes("新增 0，已存在 1，停用 0"), "脚本 dry-run 输出格式不变", sDry.out);
    const sRun = runScript({ bindings: { [email(NEWBIE)]: ["bids"] } }, []);
    const scriptAudit = await db.auditLog.findFirst({ where: { orgId: ORG, action: "authorization.position.bind", targetId: NEWBIE } });
    const scriptAfter = scriptAudit?.afterData ? JSON.parse(scriptAudit.afterData) : {};
    ok(sRun.code === 0 && (await activeKeys(NEWBIE)) === "bids" && scriptAfter.via === "scripts/bind-positions.ts" && scriptAfter.email === email(NEWBIE), "脚本写入 + 审计（via 脚本路径）", { out: sRun.out.slice(-300), scriptAfter });
  } finally {
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.agent.deleteMany({ where: { id: agent.id } });
    await db.environment.deleteMany({ where: { projectId: project.id } });
    await db.project.deleteMany({ where: { id: project.id } }).catch((e) => console.warn("project cleanup:", e instanceof Error ? e.message : e));
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-7 岗位绑定界面 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
