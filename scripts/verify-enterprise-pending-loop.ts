/**
 * 企业技能 PendingAction 闭环验证（真实 DB）
 *
 * 路径：技能提案收集 → createDraft(pending) → approve/execute 或 reject
 * 默认对 sunny-shutter-bid-lead 组织执行；执行内部备注后写真实项目备注。
 *
 * 用法：
 *   npx tsx scripts/verify-enterprise-pending-loop.ts
 *   npx tsx scripts/verify-enterprise-pending-loop.ts --org sunny-shutter-bid-lead
 *   npx tsx scripts/verify-enterprise-pending-loop.ts --skip-execute   # 只验证创建+拒绝
 */

import { db } from "@/lib/db";
import {
  collectPendingProposals,
  materializeSkillPendingActions,
  buildSkillPendingIdempotencyKey,
} from "@/lib/agent-core/skills/pending-action-bridge";
import {
  executePendingAction,
  rejectPendingAction,
} from "@/lib/pending-actions/executor";
import { randomUUID } from "crypto";

const orgArgIdx = process.argv.indexOf("--org");
const ORG_CODE =
  orgArgIdx > -1 ? process.argv[orgArgIdx + 1] : "sunny-shutter-bid-lead";
const SKIP_EXECUTE = process.argv.includes("--skip-execute");
const ALLOW_INACTIVE = process.argv.includes("--allow-inactive");

function ok(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  console.log(`✓ ${msg}`);
}

async function main() {
  const org = await db.organization.findUnique({
    where: { code: ORG_CODE },
    select: { id: true, name: true, status: true },
  });
  if (!org) throw new Error(`组织不存在: ${ORG_CODE}`);
  if (org.status === "active") {
    ok(true, `组织 active: ${org.name}`);
  } else if (ALLOW_INACTIVE) {
    ok(true, `组织 ${org.status}（已允许 --allow-inactive）: ${org.name}`);
  } else {
    throw new Error(
      `组织 ${ORG_CODE} 非 active（${org.status}）。可加 --allow-inactive`,
    );
  }

  const member = await db.organizationMember.findFirst({
    where: { orgId: org.id, status: "active" },
    orderBy: { joinedAt: "asc" },
    select: {
      userId: true,
      role: true,
      user: { select: { id: true, name: true, role: true } },
    },
  });
  if (!member) throw new Error("组织无活跃成员，无法验证审批");
  const userId = member.userId;
  const role = member.user.role || member.role || "admin";
  console.log(`操作人: ${member.user.name ?? userId} (role=${role})\n`);

  const project = await db.project.findFirst({
    where: { orgId: org.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });

  // ── 1) 提案收集（纯逻辑）──
  const fixture = {
    pendingActionProposal: {
      type: "grader.internal_note",
      title: `[闭环验证] 企业技能内部备注 ${new Date().toISOString()}`,
      preview: "验证数字员工技能 → PendingAction → 执行",
      payload: {
        targetType: "PROJECT",
        targetId: project?.id ?? "missing",
        note: "企业数字员工技能库 Phase1 闭环验证备注（可忽略）",
        metadata: { orgId: org.id, projectId: project?.id },
      },
    },
    priorities: [
      {
        pendingActionProposal: {
          type: "sales_send_quote_email",
          title: "应被跳过的直发邮件",
        },
      },
    ],
  };
  const collected = collectPendingProposals(fixture);
  ok(collected.length === 2, `收集到 ${collected.length} 条提案`);

  // ── 2) 落库（含非法类型 skip）+ 幂等 + 来源链 ──
  const fakeExecutionId = `verify-exec-${randomUUID()}`;
  const fakeSkillId = `verify-skill-${randomUUID()}`;
  const materializeOnce = () =>
    materializeSkillPendingActions({
      parsed: fixture,
      userId,
      orgId: org.id,
      skillId: fakeSkillId,
      skillSlug: "verify-enterprise-pending-loop",
      skillExecutionId: fakeExecutionId,
      agentRunId: null,
      projectId: project?.id,
    });

  const materialized = await materializeOnce();
  ok(materialized.created.length === 1, "合法提案落库 1 条");
  ok(
    materialized.skipped.some((s) => s.reason.includes("白名单")),
    "非法直发类型被跳过",
  );
  ok(materialized.created[0].reused !== true, "首次落库非 reused");

  const again = await materializeOnce();
  ok(again.created.length === 1, "重复处理仍返回 1 条");
  ok(again.created[0].reused === true, "重复处理标记 reused");
  ok(
    again.created[0].id === materialized.created[0].id,
    "幂等返回同一 PendingAction",
  );

  const actionId = materialized.created[0].id;
  const row = await db.pendingAction.findUnique({
    where: { id: actionId },
    select: { id: true, status: true, type: true, orgId: true, title: true, payload: true },
  });
  ok(row?.status === "pending", `草稿状态 pending (${row?.id})`);
  ok(row?.type === "grader.internal_note", "类型为 grader.internal_note");
  ok(row?.orgId === org.id, "组织隔离 orgId 正确");

  const meta = (row?.payload as { metadata?: Record<string, unknown> } | null)
    ?.metadata;
  ok(meta?.source === "AGENT_SKILL", "metadata.source=AGENT_SKILL");
  ok(meta?.skillId === fakeSkillId, "metadata.skillId");
  ok(meta?.skillSlug === "verify-enterprise-pending-loop", "metadata.skillSlug");
  ok(meta?.skillExecutionId === fakeExecutionId, "metadata.skillExecutionId");
  ok(meta?.proposalIndex === 0, "metadata.proposalIndex");
  ok(
    meta?.idempotencyKey ===
      buildSkillPendingIdempotencyKey(
        fakeExecutionId,
        0,
        "grader.internal_note",
      ),
    "metadata.idempotencyKey",
  );

  // ── 3a) 无项目或 skip-execute：拒绝路径 ──
  if (!project || SKIP_EXECUTE) {
    const rejected = await rejectPendingAction(
      actionId,
      { userId, role, orgId: org.id },
      "闭环验证：拒绝路径",
    );
    ok(rejected.ok === true, "拒绝成功");
    const after = await db.pendingAction.findUnique({
      where: { id: actionId },
      select: { status: true },
    });
    ok(after?.status === "rejected", "状态变为 rejected");
    console.log("\n✅ PendingAction 闭环验证通过（创建 → 拒绝）");
    return;
  }

  // ── 3b) 有项目：批准并执行写入项目备注 ──
  const executed = await executePendingAction(actionId, {
    userId,
    role,
    orgId: org.id,
  });
  ok(executed.ok === true, `执行成功: ${executed.message ?? executed.resultRef}`);
  const afterExec = await db.pendingAction.findUnique({
    where: { id: actionId },
    select: { status: true },
  });
  ok(afterExec?.status === "executed", "状态变为 executed");

  // 再验证拒绝路径（第二条草稿）
  const rejectFixture = {
    pendingActionProposal: {
      type: "grader.project_task",
      title: "[闭环验证] 应拒绝的任务草稿",
      preview: "不会执行",
      payload: {
        projectId: project.id,
        title: "闭环验证任务（应拒绝）",
        description: "verify-enterprise-pending-loop",
        priority: "low",
        metadata: { orgId: org.id },
      },
    },
  };
  const m2 = await materializeSkillPendingActions({
    parsed: rejectFixture,
    userId,
    orgId: org.id,
    skillId: fakeSkillId,
    skillSlug: "verify-enterprise-pending-loop",
    skillExecutionId: `verify-exec-reject-${randomUUID()}`,
    projectId: project.id,
  });
  ok(m2.created.length === 1, "第二条草稿落库");
  const rej = await rejectPendingAction(
    m2.created[0].id,
    { userId, role, orgId: org.id },
    "闭环验证：拒绝路径",
  );
  ok(rej.ok === true, "第二条拒绝成功");

  console.log("\n✅ PendingAction 闭环验证通过（创建 → 执行 + 创建 → 拒绝）");
  console.log(`   已执行草稿: ${actionId}`);
  console.log(`   已拒绝草稿: ${m2.created[0].id}`);
  console.log(`   项目: ${project.name} (${project.id})`);
}

main()
  .catch((e) => {
    console.error("\n❌", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
