/**
 * T5 Segment 2.5 — workDomain 兼容闭环的真实 Postgres 验证（DB 平面，手动运行）
 *
 * 纯平面只能证明纯函数与源码结构；「旧 run 靠持久化证据被判为 sales」「canonical
 * 项目域优先」「admin 也不能绕过缺失域」都需要真实 AgentRun / AgentRunStep / Project。
 *
 *   DB-05  createWorkforceJob 缺 workDomain → 零 AgentRun 写
 *   DB-06  旧 run（无 workDomain）+ 销售工具证据 → sales / LEGACY_SALES_COMPAT
 *   DB-07  旧 run（无 workDomain）+ projectId(Project.workDomain=tender) → project，非 sales
 *   DB-07b 同上但 Project.workDomain=sales → sales / PROJECT_CANONICAL
 *   DB-08  旧 run + 未知工具 → work_domain_ambiguous
 *   DB-08b 旧 run + 零工具证据 → work_domain_missing
 *   DB-09  旧 run + 销售/投标混合工具 → work_domain_ambiguous
 *   DB-10  显式 tender + 全是销售工具证据 → 仍为 project（不可降级）
 *   DB-11  sales 角色本身不构成 sales 域（同一条 run 换角色结果不变）
 *   DB-12  platform admin + 缺失域 → 仍 fail closed（无 system 旁路）
 *
 * 运行（仅隔离 Neon 分支，绝不指向生产）：
 *   DATABASE_URL="$CS" DIRECT_URL="$CS" npx tsx scripts/t5-seg25-work-domain-db-validation.ts
 *
 * 结束清理自建 fixtures；不注册进 test-all。
 */

import { db } from "@/lib/db";
import {
  resolveEffectiveWorkDomain,
  type ResolveWorkDomainResult,
} from "@/lib/workforce-runtime/work-domain";
import {
  resolveWorkforceExecutionPolicy,
  __clearExecutionPolicyCache,
} from "@/lib/workforce-runtime/execution-policy";
import { createWorkforceJob } from "@/lib/workforce-runtime/job";
import { RUNTIME_V2_TOOL_CATALOG } from "@/lib/agent-runtime-v2/tool-catalog";
import { TENDER_WORKFORCE_TOOL_DESCRIPTORS } from "@/lib/tender-workforce/tools";
import { WORKFORCE_JOB_RUN_TYPE } from "@/lib/workforce-runtime/constants";

const TAG = `t5seg25_${Date.now()}`;
let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

const SALES_TOOL = RUNTIME_V2_TOOL_CATALOG[0]!.name;
const SALES_TOOL_2 = RUNTIME_V2_TOOL_CATALOG[1]!.name;
const TENDER_TOOL = TENDER_WORKFORCE_TOOL_DESCRIPTORS[0]!.name;

async function main() {
  console.log(`T5 Segment 2.5 — workDomain 真实 Postgres 验证（${TAG}）`);

  const owner = await db.user.create({
    data: {
      email: `${TAG}_owner@test.qingyan.local`,
      name: `${TAG}-owner`,
      role: "sales",
      status: "active",
    },
  });
  const admin = await db.user.create({
    data: {
      email: `${TAG}_admin@test.qingyan.local`,
      name: `${TAG}-admin`,
      role: "admin",
      status: "active",
    },
  });
  const org = await db.organization.create({
    data: { name: `${TAG}-org`, code: TAG, ownerId: admin.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: org.id, userId: owner.id, role: "org_member", status: "active" },
      { orgId: org.id, userId: admin.id, role: "org_admin", status: "active" },
    ],
  });
  const tenderProject = await db.project.create({
    data: {
      name: `${TAG}-tender`,
      ownerId: owner.id,
      orgId: org.id,
      workDomain: "tender",
    },
  });
  const salesProject = await db.project.create({
    data: {
      name: `${TAG}-sales`,
      ownerId: owner.id,
      orgId: org.id,
      workDomain: "sales",
    },
  });
  const session = await db.agentSession.create({
    data: { orgId: org.id, userId: owner.id, channel: "web" },
  });

  /** 造一条「旧」run：metadata 里没有 workDomain（升级前的真实形态） */
  async function legacyRun(input: {
    metadata?: Record<string, unknown>;
    tools?: Array<string | null>;
  }): Promise<string> {
    const run = await db.agentRun.create({
      data: {
        orgId: org.id,
        sessionId: session.id,
        runType: WORKFORCE_JOB_RUN_TYPE,
        status: "running",
        runtimeVersion: "v2",
        metadata: (input.metadata ?? {}) as never,
      },
      select: { id: true },
    });
    let i = 0;
    for (const tool of input.tools ?? []) {
      i += 1;
      await db.agentRunStep.create({
        data: {
          orgId: org.id,
          runId: run.id,
          stepKey: `s${i}`,
          title: `step ${i}`,
          status: "pending",
          ...(tool ? { preferredTool: tool } : {}),
        },
      });
    }
    return run.id;
  }

  async function resolveFor(
    runId: string,
    metadata: Record<string, unknown>,
  ): Promise<ResolveWorkDomainResult> {
    return resolveEffectiveWorkDomain({
      orgId: org.id,
      runId,
      runMetadata: metadata,
    });
  }

  const createdRunIds: string[] = [];

  try {
    /* ── DB-05：新建缺域 → 零 DB 写 ── */
    {
      process.env.WORKFORCE_RUNTIME_ENABLED = "1";
      process.env.WORKFORCE_RUNTIME_ORG_ALLOWLIST = "";
      process.env.WORKFORCE_RUNTIME_ROLE_ALLOWLIST = "";
      process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST = owner.id;
      const before = await db.agentRun.count({ where: { orgId: org.id } });
      const created = await createWorkforceJob({
        orgId: org.id,
        userId: owner.id,
        role: "sales",
        goal: "帮我看看最近需要跟进的客户并排出优先级",
        // @ts-expect-error 故意省略必填 workDomain，验证运行时也 fail-closed
        workDomain: undefined,
      });
      const after = await db.agentRun.count({ where: { orgId: org.id } });
      ok(
        created.ok === false &&
          created.error === "WORK_DOMAIN_REQUIRED" &&
          after === before,
        "DB-05: createWorkforceJob 缺 workDomain → WORK_DOMAIN_REQUIRED 且零 AgentRun 写",
        { created, before, after },
      );
    }

    /* ── DB-06：旧 run + 销售工具证据 ── */
    {
      const runId = await legacyRun({ tools: [SALES_TOOL, SALES_TOOL_2, null] });
      createdRunIds.push(runId);
      const r = await resolveFor(runId, {});
      ok(
        r.ok && r.workDomain === "sales" && r.source === "LEGACY_SALES_COMPAT",
        "DB-06: 旧 run（无 workDomain）+ 销售工具证据 → sales / LEGACY_SALES_COMPAT",
        r,
      );

      // 端到端：策略解析成功且允许 sales 角色
      __clearExecutionPolicyCache();
      const policy = await resolveWorkforceExecutionPolicy({
        orgId: org.id,
        runId,
        userId: owner.id,
        role: "sales",
        runMetadata: {},
      });
      ok(
        policy.ok &&
          policy.policy.toolDomain === "sales" &&
          policy.policy.allowRoles.includes("sales") &&
          policy.policy.workDomainResolutionSource === "LEGACY_SALES_COMPAT",
        "DB-06b: 该旧 run 的执行策略恢复为 sales 域（历史行为可用）",
        policy.ok ? policy.policy.toolDomain : policy,
      );
    }

    /* ── DB-07：canonical 项目域优先于工具推断 ── */
    {
      const runId = await legacyRun({ tools: [SALES_TOOL, SALES_TOOL_2] });
      createdRunIds.push(runId);
      const r = await resolveFor(runId, { projectId: tenderProject.id });
      ok(
        r.ok && r.workDomain === "tender" && r.source === "PROJECT_CANONICAL",
        "DB-07: 旧 run + Project.workDomain=tender → tender（不是 sales）",
        r,
      );
      const r2 = await resolveFor(runId, { projectId: salesProject.id });
      ok(
        r2.ok && r2.workDomain === "sales" && r2.source === "PROJECT_CANONICAL",
        "DB-07b: 同一 run 挂到 sales 项目 → sales / PROJECT_CANONICAL",
        r2,
      );
      const r3 = await resolveFor(runId, { projectId: `${tenderProject.id}_gone` });
      ok(
        !r3.ok && r3.code === "work_domain_ambiguous",
        "DB-07c: 声明的项目不存在于本组织 → fail closed（不退回工具推断）",
        r3,
      );
    }

    /* ── DB-08：未知工具 / 零证据 ── */
    {
      const unknownRun = await legacyRun({ tools: [SALES_TOOL, "future_tool_x"] });
      createdRunIds.push(unknownRun);
      const r = await resolveFor(unknownRun, {});
      ok(
        !r.ok && r.code === "work_domain_ambiguous",
        "DB-08: 旧 run 出现未知工具 → work_domain_ambiguous",
        r,
      );

      const emptyRun = await legacyRun({ tools: [] });
      createdRunIds.push(emptyRun);
      const r2 = await resolveFor(emptyRun, {});
      ok(
        !r2.ok && r2.code === "work_domain_missing",
        "DB-08b: 旧 run 零工具证据 → work_domain_missing（不猜 sales）",
        r2,
      );
    }

    /* ── DB-09：混合域证据 ── */
    {
      const runId = await legacyRun({ tools: [SALES_TOOL, TENDER_TOOL] });
      createdRunIds.push(runId);
      const r = await resolveFor(runId, {});
      ok(
        !r.ok && r.code === "work_domain_ambiguous",
        "DB-09: 销售/投标工具混合 → work_domain_ambiguous（不按第一个工具定域）",
        r,
      );
    }

    /* ── DB-10：显式域不可被工具证据降级 ── */
    {
      const runId = await legacyRun({ tools: [SALES_TOOL, SALES_TOOL_2] });
      createdRunIds.push(runId);
      const r = await resolveFor(runId, { workDomain: "tender" });
      ok(
        r.ok && r.workDomain === "tender" && r.source === "EXPLICIT",
        "DB-10: 显式 tender + 全销售工具证据 → 仍为 tender（EXPLICIT 不可降级）",
        r,
      );
      __clearExecutionPolicyCache();
      const policy = await resolveWorkforceExecutionPolicy({
        orgId: org.id,
        runId,
        userId: owner.id,
        role: "sales",
        runMetadata: { workDomain: "tender" },
      });
      ok(
        policy.ok && policy.policy.toolDomain === "project",
        "DB-10b: 其执行策略为 project 域（销售工具将按 project 策略判定）",
        policy.ok ? policy.policy.toolDomain : policy,
      );
    }

    /* ── DB-11：角色不是域 ── */
    {
      const runId = await legacyRun({ tools: [TENDER_TOOL] });
      createdRunIds.push(runId);
      const asSales = await resolveFor(runId, {});
      const runId2 = await legacyRun({ tools: [SALES_TOOL] });
      createdRunIds.push(runId2);
      const salesEvidence = await resolveFor(runId2, {});
      ok(
        !asSales.ok && salesEvidence.ok && salesEvidence.workDomain === "sales",
        "DB-11: 域只由持久化证据决定；sales 用户执行投标工具不会被判成 sales 域",
        { asSales, salesEvidence },
      );
    }

    /* ── DB-12：admin 不能绕过缺失域 ── */
    {
      const runId = await legacyRun({ tools: [] });
      createdRunIds.push(runId);
      __clearExecutionPolicyCache();
      const asAdmin = await resolveWorkforceExecutionPolicy({
        orgId: org.id,
        runId,
        userId: admin.id,
        role: "admin",
        runMetadata: {},
      });
      ok(
        !asAdmin.ok && asAdmin.code === "work_domain_missing",
        "DB-12: platform admin + 缺失域 → 仍 fail closed（无 system 旁路）",
        asAdmin,
      );

      const ambiguousRun = await legacyRun({ tools: [SALES_TOOL, TENDER_TOOL] });
      createdRunIds.push(ambiguousRun);
      __clearExecutionPolicyCache();
      const asAdmin2 = await resolveWorkforceExecutionPolicy({
        orgId: org.id,
        runId: ambiguousRun,
        userId: admin.id,
        role: "admin",
        runMetadata: {},
      });
      ok(
        !asAdmin2.ok && asAdmin2.code === "work_domain_ambiguous",
        "DB-12b: admin + 歧义域 → 仍 fail closed",
        asAdmin2,
      );
    }
  } finally {
    await db.agentRunStep.deleteMany({ where: { orgId: org.id } });
    await db.agentRunEvent.deleteMany({ where: { orgId: org.id } });
    await db.agentRun.deleteMany({ where: { orgId: org.id } });
    await db.agentSession.deleteMany({ where: { orgId: org.id } });
    await db.project.deleteMany({ where: { orgId: org.id } });
    await db.organizationMember.deleteMany({ where: { orgId: org.id } });
    await db.organization.deleteMany({ where: { id: org.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, admin.id] } } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("异常：", e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
