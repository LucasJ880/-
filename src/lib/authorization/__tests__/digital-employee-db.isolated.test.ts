/**
 * PERM-5b：数字员工岗位绑定与授权——真实 DB（隔离库）端到端
 *
 *   主体解析（active / 停用 / 跨企业 / sponsor 非成员）；无绑定全拒（无兼容回退、无平台管理员全权）；
 *   绑定 sales_rep 后按 sponsor 范围授权；禁区（绑了 accounting 也不能安排安装）；允许键集合；
 *   数字员工审批（归属 / 审批人 = sponsor，停用 Agent 不建）；审计展示文本；
 *   绑定脚本 --principal-type DIGITAL_EMPLOYEE（写入 / 审计 / 不能绑 owner / 人类 --prune 不动数字员工绑定）。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/authorization/__tests__/digital-employee-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据；不出网。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-5b 数字员工 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-5b digital employee DB test" });

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

const ROOT = join(__dirname, "..", "..", "..", "..");

async function main() {
  const { db } = await import("@/lib/db");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { authorize, resolveAllowedPermissionKeys } = await import("@/lib/authorization/authorize");
  const { resolveDigitalEmployeePrincipal, digitalEmployeeCorrelation } = await import("@/lib/authorization/digital-employee");
  const { requestDigitalEmployeeApproval } = await import("@/lib/approval/digital-employee");
  const { logAudit } = await import("@/lib/audit/logger");
  const { listAuditLogs } = await import("@/lib/audit/query");

  const stamp = Date.now().toString(36);
  const ALEX = `deale_${stamp}`;
  const LYNN = `delynn_${stamp}`;
  const MIKI = `demiki_${stamp}`;
  const PADMIN = `depadm_${stamp}`;
  const OUTSIDER = `deout_${stamp}`;
  const ORG = `deorg_${stamp}`;
  const ORG2 = `deorg2_${stamp}`;
  const users = [ALEX, LYNN, MIKI, PADMIN, OUTSIDER];
  const roleOf: Record<string, string> = { [ALEX]: "sales", [LYNN]: "sales", [MIKI]: "user", [PADMIN]: "super_admin", [OUTSIDER]: "sales" };
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: roleOf[id] } });
  }
  await db.organization.create({ data: { id: ORG, name: "Example DE Fixture", code: `deo-${stamp}`, ownerId: ALEX, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG2, name: "Example DE Other", code: `deo2-${stamp}`, ownerId: OUTSIDER } });
  for (const id of [ALEX, LYNN, MIKI, PADMIN]) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  }
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OUTSIDER, role: "org_admin", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const profileId = async (key: string) => (await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } }))!.id;
  const bind = async (principalType: "HUMAN" | "DIGITAL_EMPLOYEE", principalId: string, key: string) =>
    db.principalRoleBinding.create({ data: { orgId: ORG, principalType, principalId, roleProfileId: await profileId(key), status: "active" } });
  await bind("HUMAN", ALEX, "sales_rep");
  await bind("HUMAN", MIKI, "accounting");

  const project = await db.project.create({ data: { name: "Fixture DE project", ownerId: ALEX, orgId: ORG } });
  const env = await db.environment.create({ data: { projectId: project.id, name: "prod", code: "prod" } });
  const project2 = await db.project.create({ data: { name: "Fixture other project", ownerId: OUTSIDER, orgId: ORG2 } });
  const env2 = await db.environment.create({ data: { projectId: project2.id, name: "prod", code: "prod" } });
  const agent = (key: string, createdById: string, opts: { status?: string; other?: boolean } = {}) =>
    db.agent.create({
      data: {
        projectId: opts.other ? project2.id : project.id,
        environmentId: opts.other ? env2.id : env.id,
        key: `${key}_${stamp}`,
        name: `销售助手 ${key}`,
        status: opts.status ?? "active",
        createdById,
        updatedById: createdById,
      },
    });
  const salesAgent = await agent("sales", ALEX);
  const anaAgent = await agent("ana", MIKI);
  const disabledAgent = await agent("off", ALEX, { status: "disabled" });
  const foreignAgent = await agent("far", OUTSIDER, { other: true });
  const orphanAgent = await agent("orph", OUTSIDER);
  const adminAgent = await agent("adm", PADMIN);
  const agentIds = [salesAgent.id, anaAgent.id, disabledAgent.id, foreignAgent.id, orphanAgent.id, adminAgent.id];

  const tmp = mkdtempSync(join(tmpdir(), "perm5b-"));
  const runScript = (file: object, extra: string[]) => {
    const path = join(tmp, `b-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(path, JSON.stringify(file));
    const r = spawnSync("npx", ["tsx", "scripts/bind-positions.ts", "--org", `deo-${stamp}`, "--file", path, "--actor", `${PADMIN}@fixture.test`, ...extra], {
      cwd: ROOT,
      env: { ...process.env, ALLOW_POSITION_BINDING: "true" },
      encoding: "utf-8",
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  try {
    console.log("\n[1] 主体解析");
    const r1 = await resolveDigitalEmployeePrincipal({ agentId: salesAgent.id, orgId: ORG });
    ok(r1.ok && r1.principal.sponsorUserId === ALEX && r1.principal.type === "DIGITAL_EMPLOYEE", "active Agent → 主体，sponsor = 创建人 Alex", r1);
    const code = async (agentId: string, orgId = ORG) => {
      const r = await resolveDigitalEmployeePrincipal({ agentId, orgId });
      return r.ok ? "OK" : r.reasonCode;
    };
    ok((await code(disabledAgent.id)) === "AGENT_INACTIVE", "停用 Agent → AGENT_INACTIVE");
    ok((await code(foreignAgent.id)) === "AGENT_ORG_MISMATCH", "别家企业项目的 Agent → AGENT_ORG_MISMATCH");
    ok((await code(orphanAgent.id)) === "SPONSOR_NOT_MEMBER", "创建人不是本企业成员 → SPONSOR_NOT_MEMBER");
    ok((await code(`nope_${stamp}`)) === "AGENT_NOT_FOUND", "不存在 → AGENT_NOT_FOUND");
    if (!r1.ok) throw new Error("salesAgent 解析失败，后续无法继续");
    const de = r1.principal;

    console.log("\n[2] 无绑定全拒（无兼容回退、不继承 sponsor、无平台管理员全权）");
    const a0 = await authorize({ principal: de, orgId: ORG, permission: "sales.customer.read" });
    ok(!a0.allowed && a0.reasonCode === "NO_BINDING", "未绑定的数字员工读客户 → NO_BINDING（sponsor Alex 有 sales_rep 也不继承）", a0);
    const adm = await resolveDigitalEmployeePrincipal({ agentId: adminAgent.id, orgId: ORG });
    const a0b = adm.ok ? await authorize({ principal: adm.principal, orgId: ORG, permission: "sales.customer.read" }) : null;
    ok(!!a0b && !a0b.allowed && a0b.reasonCode === "NO_BINDING", "平台管理员创建的数字员工也没有全权", a0b);

    console.log("\n[3] 绑定 sales_rep 后按 sponsor 范围");
    await bind("DIGITAL_EMPLOYEE", salesAgent.id, "sales_rep");
    const a1 = await authorize({ principal: de, orgId: ORG, permission: "sales.quote.read" });
    ok(a1.allowed, "数字员工（sales_rep）不带资源读报价 → 允许", a1);
    const a2 = await authorize({ principal: de, orgId: ORG, permission: "sales.customer.read", resource: { type: "sales_customer", ownerId: ALEX, orgId: ORG } });
    ok(a2.allowed && a2.matchedScope === "PRINCIPAL", "读 sponsor Alex 的客户 → PRINCIPAL 命中", a2);
    const a3 = await authorize({ principal: de, orgId: ORG, permission: "sales.customer.read", resource: { type: "sales_customer", ownerId: LYNN, orgId: ORG } });
    ok(!a3.allowed && a3.reasonCode === "RESOURCE_OUT_OF_SCOPE", "读 Lynn 的客户 → 拒绝", a3);
    const a4 = await authorize({ principal: de, orgId: ORG, permission: "sales.quote.discount.over_limit.submit" });
    ok(!a4.allowed && a4.reasonCode === "PRINCIPAL_TYPE_NOT_ALLOWED", "数字员工不给折扣（超限折扣键在禁区）", a4);
    const keys = await resolveAllowedPermissionKeys(de);
    ok(keys.includes("sales.customer.read") && keys.includes("sales.quote.create") && !keys.some((k) => k.endsWith(".approve") || k.startsWith("sales.quote.discount.")), "允许键集合含销售读写、不含审批 / 折扣", keys);

    console.log("\n[4] 禁区：绑了 accounting 也不能安排安装");
    const ana = await resolveDigitalEmployeePrincipal({ agentId: anaAgent.id, orgId: ORG });
    await bind("DIGITAL_EMPLOYEE", anaAgent.id, "accounting");
    if (ana.ok) {
      const b1 = await authorize({ principal: ana.principal, orgId: ORG, permission: "install.task.assign" });
      ok(!b1.allowed && b1.reasonCode === "PRINCIPAL_TYPE_NOT_ALLOWED", "数据分析数字员工 install.task.assign → PRINCIPAL_TYPE_NOT_ALLOWED", b1);
      const b2 = await authorize({ principal: ana.principal, orgId: ORG, permission: "accounting.read" });
      ok(b2.allowed, "数据分析数字员工 accounting.read → 允许", b2);
    } else ok(false, "anaAgent 解析失败", ana);
    const b3 = await authorize({ principal: { type: "HUMAN", id: MIKI, orgId: ORG }, orgId: ORG, permission: "install.task.assign" });
    ok(b3.allowed, "人类会计 Miki install.task.assign → 允许（不受禁区影响）", b3);

    console.log("\n[5] 数字员工审批");
    const before = await db.pendingAction.count({ where: { orgId: ORG } });
    const req = await requestDigitalEmployeeApproval({
      agentId: salesAgent.id,
      positionKey: "sales_rep",
      orgId: ORG,
      actionType: "sales.send_inquiry_reply",
      title: "回复询盘（数字员工草稿）",
      preview: "Example reply to a fixture inquiry",
      payload: { inquiryId: `inq_${stamp}`, body: "Example" },
      risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong" },
      source: { module: "perm-5b.isolated-test" },
      idempotencyKey: `perm5b:${stamp}:1`,
    });
    ok(req.ok, "数字员工审批创建成功", req);
    const pa = req.ok ? await db.pendingAction.findUnique({ where: { id: req.actionIds[0] } }) : null;
    ok(!!pa && pa.createdById === ALEX && pa.approverUserId === ALEX && pa.status === "pending", "PendingAction 归属 = 审批人 = sponsor Alex，待确认", pa && { createdById: pa.createdById, approverUserId: pa.approverUserId, status: pa.status });
    ok(!!pa && pa.approverUserId !== salesAgent.id && pa.createdById !== salesAgent.id, "审批人 / 归属都不是 Agent id");
    const meta = (pa?.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata ?? {};
    const deMeta = meta._digitalEmployee as Record<string, unknown> | undefined;
    ok(meta.principalActorType === "agent" && deMeta?.agentId === salesAgent.id && deMeta?.positionKey === "sales_rep" && deMeta?.sponsorUserId === ALEX, "payload.metadata 标 agent / Agent / 岗位 / sponsor", meta);
    const off = await requestDigitalEmployeeApproval({
      agentId: disabledAgent.id,
      positionKey: "sales_rep",
      orgId: ORG,
      actionType: "sales.send_inquiry_reply",
      title: "x",
      preview: "x",
      payload: {},
      risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong" },
      source: { module: "perm-5b.isolated-test" },
      idempotencyKey: `perm5b:${stamp}:2`,
    });
    ok(!off.ok && off.errorCode === "AGENT_INACTIVE", "停用 Agent 发起审批 → 失败", off);
    const owner = await requestDigitalEmployeeApproval({
      agentId: salesAgent.id,
      positionKey: "owner",
      orgId: ORG,
      actionType: "sales.send_inquiry_reply",
      title: "x",
      preview: "x",
      payload: {},
      risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong" },
      source: { module: "perm-5b.isolated-test" },
      idempotencyKey: `perm5b:${stamp}:3`,
    });
    ok(!owner.ok && owner.errorCode === "POSITION_NOT_ALLOWED", "代 owner 岗位发起 → POSITION_NOT_ALLOWED", owner);
    ok((await db.pendingAction.count({ where: { orgId: ORG } })) === before + 1, "失败的发起不建 PendingAction");

    console.log("\n[6] 审计展示");
    await logAudit({
      userId: ALEX,
      orgId: ORG,
      action: "perm5b.fixture.digital",
      targetType: "fixture",
      targetId: "t1",
      afterData: { note: "digital" },
      correlation: digitalEmployeeCorrelation({ principal: de, agentName: salesAgent.name, positionKey: "sales_rep" }),
    });
    await logAudit({ userId: ALEX, orgId: ORG, action: "perm5b.fixture.human", targetType: "fixture", targetId: "t2", afterData: { note: "human" } });
    const logs = await listAuditLogs({ orgId: ORG }, { page: 1, pageSize: 50 });
    const dLog = logs.data.find((l) => l.action === "perm5b.fixture.digital");
    const hLog = logs.data.find((l) => l.action === "perm5b.fixture.human");
    ok(dLog?.actorDisplay === `数字员工 ${salesAgent.name} 代 岗位 sales_rep`, "数字员工审计 → 展示文本", dLog);
    ok(!!hLog && hLog.actorDisplay === undefined, "人类审计 → 无展示文本", hLog);
    ok(!!dLog && !("afterData" in (dLog as object)), "列表仍不返回 afterData");

    console.log("\n[7] 绑定脚本 --principal-type DIGITAL_EMPLOYEE");
    const s0 = runScript({ bindings: { "TODO:销售数字员工": ["sales_rep"] } }, ["--principal-type", "DIGITAL_EMPLOYEE"]);
    ok(s0.code === 2 && s0.out.includes("TODO:销售数字员工"), "占位文件 → 退出 2", s0);
    const s1 = runScript({ bindings: { [adminAgent.id]: ["owner"] } }, ["--principal-type", "DIGITAL_EMPLOYEE"]);
    ok(s1.code === 2 && s1.out.includes("owner"), "数字员工绑 owner → 退出 2", s1);
    const s2 = runScript({ bindings: { [foreignAgent.id]: ["sales_rep"] } }, ["--principal-type", "DIGITAL_EMPLOYEE"]);
    ok(s2.code === 2 && s2.out.includes("不属于本企业"), "别家企业的 Agent → 退出 2", s2);
    const s3 = runScript({ bindings: { [adminAgent.id]: ["bids"] } }, ["--principal-type", "DIGITAL_EMPLOYEE"]);
    ok(s3.code === 0 && s3.out.includes("新增 1") && !s3.out.includes("postgresql://"), "合法文件 → 退出 0、新增 1、不输出连接串", s3);
    const row = await db.principalRoleBinding.findFirst({ where: { orgId: ORG, principalType: "DIGITAL_EMPLOYEE", principalId: adminAgent.id, status: "active" }, include: { roleProfile: true } });
    ok(row?.roleProfile.key === "bids", "写入 DIGITAL_EMPLOYEE 绑定（Agent → bids）");
    const audit = await db.auditLog.findFirst({ where: { orgId: ORG, action: "authorization.position.bind", targetId: adminAgent.id } });
    const after = JSON.parse(audit?.afterData ?? "{}") as Record<string, unknown>;
    ok(after.principalType === "DIGITAL_EMPLOYEE" && after.agentName === adminAgent.name, "审计标主体类型与 Agent 名", audit?.afterData);
    const s4 = runScript({ bindings: { [adminAgent.id]: ["bids"] } }, ["--principal-type", "DIGITAL_EMPLOYEE"]);
    ok(s4.code === 0 && s4.out.includes("新增 0"), "重复执行幂等 → 新增 0", s4.out.slice(-200));
    const s5 = runScript({ bindings: { [`${ALEX}@fixture.test`]: ["sales_rep"] } }, ["--prune"]);
    ok(s5.code === 0, "人类文件带 --prune 执行 → 退出 0", s5);
    const still = await db.principalRoleBinding.count({ where: { orgId: ORG, principalType: "DIGITAL_EMPLOYEE", status: "active" } });
    ok(still === 3, "人类 --prune 不动数字员工绑定（3 条仍 active）", still);
  } finally {
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [ORG, ORG2] } }] } });
    await db.agent.deleteMany({ where: { id: { in: agentIds } } });
    await db.environment.deleteMany({ where: { projectId: { in: [project.id, project2.id] } } });
    await db.project.deleteMany({ where: { id: { in: [project.id, project2.id] } } }).catch((e) => console.warn("project cleanup:", e instanceof Error ? e.message : e));
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-5b 数字员工 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
