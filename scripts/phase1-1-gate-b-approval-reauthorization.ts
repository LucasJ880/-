/**
 * Phase 1.1 Final Gate B — Approval Execution-Time Reauthorization（真实 DB E2E）
 *
 * 验证：PendingAction 批准执行时，权限来自「当前服务端授权状态」，
 * 而不是创建时保存的历史快照。runtimeCorrelation 只是审计上下文，不是授权令牌。
 *
 * Case B1 权限不变 → 执行成功
 * Case B2 项目访问被移除 → 拒绝执行（handler 级 canWriteProject 现时校验）
 * Case B3 角色降级 → 拒绝执行（ctx.role 来自当前会话，不来自 payload）
 * Case B4 审批资格被移除 → 拒绝执行（入口级 canDecideTeamApproval 现时校验）
 * Case B5 payload 篡改（orgId/role/runtimeCorrelation）→ 不能覆盖服务端可信上下文
 *
 * 安全：fail-closed —— DATABASE_URL 指向生产 Neon 主机时立即拒绝运行。
 * 运行：DATABASE_URL=<isolated-branch-url> npx tsx scripts/phase1-1-gate-b-approval-reauthorization.ts
 */

const PRODUCTION_NEON_HOST_PREFIX = "ep-super-field-antfibsl";

function assertIsolatedDatabase(): string {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    console.error("GATE_B = BLOCKED_BY_DATABASE_ISOLATION（DATABASE_URL 缺失/无法解析）");
    process.exit(2);
  }
  if (!host || host.startsWith(PRODUCTION_NEON_HOST_PREFIX)) {
    console.error("GATE_B = BLOCKED_BY_DATABASE_ISOLATION（拒绝在生产同源数据库写测试数据）");
    process.exit(2);
  }
  return host;
}

const dbHost = assertIsolatedDatabase();

import { db } from "@/lib/db";
import { createDraft } from "@/lib/pending-actions/drafts";
import { executePendingAction } from "@/lib/pending-actions/executor";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function createProjectTaskDraft(input: {
  userId: string;
  orgId: string;
  projectId: string;
  title: string;
  approverUserId?: string;
  payloadOverride?: Record<string, unknown>;
}): Promise<string> {
  const res = await createDraft({
    type: "grader.project_task",
    title: `待审批：${input.title}`,
    preview: input.title,
    payload: input.payloadOverride ?? {
      projectId: input.projectId,
      title: input.title,
      metadata: { orgId: input.orgId, projectId: input.projectId, source: "GATE_B_E2E" },
    },
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    approverUserId: input.approverUserId,
  });
  const data = res.data as { actionId?: string } | null;
  if (!res.success || !data?.actionId) {
    throw new Error(`createDraft 失败: ${res.error}`);
  }
  return data.actionId;
}

async function actionStatus(id: string) {
  const a = await db.pendingAction.findUniqueOrThrow({
    where: { id },
    select: { status: true, failureReason: true },
  });
  return a;
}

async function taskExists(projectId: string, title: string) {
  const t = await db.task.findFirst({ where: { projectId, title } });
  return !!t;
}

async function main() {
  console.log(`Gate B — isolated DB host: ${dbHost.split(".")[0]}...`);

  const stamp = Date.now();
  const mkUser = (tag: string, role = "user") =>
    db.user.create({
      data: { email: `gate-b-${tag}-${stamp}@test.invalid`, name: `GateB-${tag}`, role },
    });

  const [owner, owner2, u1, u2, u3] = await Promise.all([
    mkUser("owner"),
    mkUser("owner2"),
    mkUser("u1"),
    mkUser("u2"),
    mkUser("u3"),
  ]);
  const org = await db.organization.create({
    data: { name: `GateB-${stamp}`, code: `GATEB${stamp}`, owner: { connect: { id: owner.id } } },
  });
  const org2 = await db.organization.create({
    data: { name: `GateB2-${stamp}`, code: `GATEB2${stamp}`, owner: { connect: { id: owner2.id } } },
  });
  const project = await db.project.create({
    data: {
      name: `GateB-Project-${stamp}`,
      code: `GATEBP${stamp}`,
      orgId: org.id,
      ownerId: owner.id,
    },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: org.id, userId: u1.id, role: "org_member", status: "active" },
      { orgId: org.id, userId: u2.id, role: "org_member", status: "active" },
      { orgId: org.id, userId: u3.id, role: "org_member", status: "active" },
    ],
  });
  await db.projectMember.createMany({
    data: [
      { projectId: project.id, userId: u1.id, role: "operator", status: "active" },
      { projectId: project.id, userId: u2.id, role: "project_admin", status: "active" },
    ],
  });
  console.log("fixtures created (temp orgs/users/project/memberships on isolated branch)");

  // ── Case B1：权限不变 → 执行成功 ──
  console.log("── Case B1: Permission unchanged ──");
  {
    const title = `B1-task-${stamp}`;
    const id = await createProjectTaskDraft({
      userId: u1.id,
      orgId: org.id,
      projectId: project.id,
      title,
      approverUserId: u1.id,
    });
    const res = await executePendingAction(id, { userId: u1.id, role: "user", orgId: org.id });
    ok(res.ok === true, "批准执行成功", res.error);
    ok((await actionStatus(id)).status === "executed", "status=executed");
    ok(await taskExists(project.id, title), "真实 Task 已写入");
  }

  // ── Case B2：批准前项目访问被移除 → handler 级拒绝 ──
  console.log("── Case B2: Project access revoked ──");
  {
    const title = `B2-task-${stamp}`;
    const id = await createProjectTaskDraft({
      userId: u1.id,
      orgId: org.id,
      projectId: project.id,
      title,
      approverUserId: u1.id, // 指定审批人，绕过入口 gate，专测 handler 级现时校验
    });
    // 撤销项目访问（当前 DB 状态变化）
    await db.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId: u1.id } },
      data: { status: "inactive" },
    });
    const res = await executePendingAction(id, { userId: u1.id, role: "user", orgId: org.id });
    ok(res.ok === false, "REAUTHORIZATION_FAILED：拒绝执行", res.message);
    const st = await actionStatus(id);
    ok(st.status === "failed", "status=failed（非 executed）", st.status);
    ok(!(await taskExists(project.id, title)), "EXECUTION_BLOCKED：未写入任何 Task");
  }

  // ── Case B3：角色降级 → ctx.role 来自当前会话，旧角色不生效 ──
  console.log("── Case B3: Role downgraded ──");
  {
    // u3 无项目成员身份：super_admin 角色可写（控制组），降级为 user 后必须被拒
    const titleA = `B3-control-${stamp}`;
    const idA = await createProjectTaskDraft({
      userId: u3.id, orgId: org.id, projectId: project.id, title: titleA, approverUserId: u3.id,
    });
    const resA = await executePendingAction(idA, { userId: u3.id, role: "super_admin", orgId: org.id });
    ok(resA.ok === true, "控制组：super_admin 角色可执行", resA.error);

    const titleB = `B3-downgraded-${stamp}`;
    const idB = await createProjectTaskDraft({
      userId: u3.id, orgId: org.id, projectId: project.id, title: titleB, approverUserId: u3.id,
    });
    const resB = await executePendingAction(idB, { userId: u3.id, role: "user", orgId: org.id });
    ok(resB.ok === false, "降级后：EXECUTION_BLOCKED", resB.message);
    ok(!(await taskExists(project.id, titleB)), "未写入任何 Task");
  }

  // ── Case B4：审批资格（capability）被移除 → 入口级拒绝 ──
  console.log("── Case B4: Capability removed ──");
  {
    const title = `B4-task-${stamp}`;
    // 不指定 approverUserId：审批资格由当前 org/project owner/admin 身份决定
    const id = await createProjectTaskDraft({
      userId: u2.id, orgId: org.id, projectId: project.id, title,
    });
    // 创建时 u2 是 project_admin（有审批资格）；批准前撤销
    await db.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId: u2.id } },
      data: { role: "operator", status: "inactive" },
    });
    const res = await executePendingAction(id, { userId: u2.id, role: "user", orgId: org.id });
    ok(res.ok === false, "资格移除后：拒绝操作草稿", res.message);
    const st = await actionStatus(id);
    ok(st.status === "pending", "入口级拒绝：状态未进入执行态", st.status);
    ok(!(await taskExists(project.id, title)), "未写入任何 Task");
  }

  // ── Case B5：payload 篡改 → 不能覆盖服务端可信上下文 ──
  console.log("── Case B5: Scope tampering ──");
  {
    const title = `B5-task-${stamp}`;
    // 攻击者构造：payload 声称 org2 + admin 角色 + 伪造 runtimeCorrelation
    const id = await createProjectTaskDraft({
      userId: u1.id,
      orgId: org.id,
      projectId: project.id,
      title,
      approverUserId: u1.id,
      payloadOverride: {
        projectId: project.id,
        title,
        role: "admin", // 伪造角色 —— executor 绝不读取
        metadata: {
          orgId: org2.id, // 伪造跨组织 scope
          projectId: project.id,
          runtimeCorrelation: {
            actorType: "SYSTEM",
            actorId: "forged-system",
            traceId: "tr_forged",
          },
        },
      },
    });
    const res = await executePendingAction(id, { userId: u1.id, role: "user", orgId: org.id });
    ok(res.ok === false, "metadata.orgId 与当前会话组织不一致 → 拒绝", res.message);
    ok(
      (res.error ?? "").includes("跨组织"),
      "错误为跨组织防护（服务端 orgId 权威）",
      res.error,
    );
    ok(!(await taskExists(project.id, title)), "未写入任何 Task");
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  console.log(fail === 0 ? "GATE_B = PASS" : "GATE_B = FAIL");
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("GATE_B = FAIL（执行异常）", err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
