/**
 * T5-P0C 整改纯测：执行 descriptor 语义 + 策略新鲜度授权
 * 运行：npx tsx src/lib/workforce-runtime/__tests__/t5-execution-policy.test.ts
 *
 * DESC-01..05  Planner 可见性 vs 执行策略元数据分离 / 缺失 fail-closed / 风险映射
 * AUTH-FRESH-*  resume 时对真实工具重跑 canInvokeTool（纯函数层：注入策略与工具集）
 */
import { readFileSync } from "node:fs";
import { ok, finish } from "./helpers";
import {
  getExecutionToolPolicyDescriptor,
  executionRiskForDescriptor,
  resolveExecutionPolicyTool,
} from "../execution-descriptor";
import { RUNTIME_V2_TOOL_CATALOG } from "@/lib/agent-runtime-v2/tool-catalog";
import {
  TENDER_WORKFORCE_TOOL_DESCRIPTORS,
  TENDER_WORKFORCE_TOOL_NAMES,
} from "@/lib/tender-workforce/tools";
import { tenderWorkforcePlannerTools } from "@/lib/tender-workforce/tools";
import {
  buildTenderDeterministicPlan,
  TENDER_PLAN_SEMANTIC_STAGES,
} from "@/lib/tender-workforce/deterministic-plan";
import { canInvokeTool } from "@/lib/tenancy/tool-auth";
import { toolDomainForWorkDomain, allowRolesForToolDomain } from "../execution-policy";

/* ---------------- DESC-01：全局 planner 不可见 tender 工具 ---------------- */
{
  const globalNames = new Set(RUNTIME_V2_TOOL_CATALOG.map((t) => t.name));
  const leaked = TENDER_WORKFORCE_TOOL_NAMES.filter((n) => globalNames.has(n));
  ok(
    leaked.length === 0,
    "DESC-01: GLOBAL_PLANNER_VISIBLE_TENDER_TOOLS = 0（未为修策略把 tender 工具塞进全局 catalog）",
    leaked,
  );
}

/* ---------------- DESC-02：tender 工具有执行 descriptor ---------------- */
{
  const missing = TENDER_WORKFORCE_TOOL_NAMES.filter(
    (n) => !getExecutionToolPolicyDescriptor(n),
  );
  ok(
    missing.length === 0,
    `DESC-02: tender 执行 descriptor 覆盖 ${TENDER_WORKFORCE_TOOL_NAMES.length}/${TENDER_WORKFORCE_TOOL_NAMES.length}`,
    missing,
  );
}

/* ---------------- DESC-03：缺失 descriptor → fail closed ---------------- */
{
  const res = resolveExecutionPolicyTool("totally_unknown_tool_xyz");
  ok(
    !res.ok && res.code === "TOOL_POLICY_DESCRIPTOR_MISSING",
    "DESC-03: 缺失 descriptor → TOOL_POLICY_DESCRIPTOR_MISSING（不给默认风险）",
  );
  ok(
    getExecutionToolPolicyDescriptor("") === null &&
      getExecutionToolPolicyDescriptor("   ") === null,
    "DESC-03b: 空工具名 → null（不猜）",
  );
}

/* ---------------- DESC-04：未知可执行工具无法取得风险 ---------------- */
{
  const res = resolveExecutionPolicyTool("sales_ghost_tool");
  ok(!res.ok, "DESC-04: 未注册工具无法获得执行风险 → 无法运行");
}

/* ---------------- DESC-05：既有 sales descriptor 行为不变 ---------------- */
{
  const sample = RUNTIME_V2_TOOL_CATALOG[0];
  const res = resolveExecutionPolicyTool(sample.name);
  ok(
    res.ok && res.descriptor.name === sample.name,
    "DESC-05: 既有全局工具仍从 RUNTIME_V2_TOOL_CATALOG 解析",
  );
  const readOnlyTool = RUNTIME_V2_TOOL_CATALOG.find((t) => t.readOnly);
  if (readOnlyTool) {
    ok(
      executionRiskForDescriptor(readOnlyTool) === "l0_read",
      "DESC-05b: 只读工具 → l0_read（既有语义不变）",
    );
  }
  const approvalTool = RUNTIME_V2_TOOL_CATALOG.find((t) => t.requiresApproval);
  if (approvalTool) {
    ok(
      executionRiskForDescriptor(approvalTool) === "l2_soft",
      "DESC-05c: 需审批工具 → l2_soft（既有语义不变）",
    );
  }
}

/* ---------------- DESC-06：tender MEDIUM 写型分析工具不再是 l0_read ---------------- */
{
  const risks = TENDER_WORKFORCE_TOOL_DESCRIPTORS.map((d) => ({
    name: d.name,
    readOnly: d.readOnly,
    risk: executionRiskForDescriptor(d),
  }));
  const writeLike = risks.filter((r) => !r.readOnly);
  ok(
    writeLike.length > 0 && writeLike.every((r) => r.risk === "l1_internal_write"),
    "DESC-06: MEDIUM 写型分析工具 → l1_internal_write（不再被表示为 l0_read）",
    writeLike,
  );
  const readOnlyTender = risks.filter((r) => r.readOnly);
  ok(
    readOnlyTender.every((r) => r.risk === "l0_read"),
    "DESC-06b: 只读 tender 工具（evidence_compliance）→ l0_read",
    readOnlyTender,
  );
}

/* ---------------- AUTH-FRESH：策略变化后的重鉴权（纯函数层） ---------------- */
{
  const toolName = TENDER_WORKFORCE_TOOL_NAMES[0];
  const resolved = resolveExecutionPolicyTool(toolName);
  const risk = resolved.ok ? resolved.risk : "l0_read";
  const domain = toolDomainForWorkDomain("tender");
  const base = {
    tenant: {
      userId: "u1",
      orgId: "o1",
      orgRole: "org_admin",
      isPlatformAdmin: false,
      workspaceIds: [] as string[],
    },
    hasMembership: true,
    tool: {
      name: toolName,
      domain,
      risk,
      allowRoles: allowRolesForToolDomain(domain),
    },
    maxRisk: "l2_soft" as const,
  };

  const allowed = canInvokeTool({
    ...base,
    modulesJson: { enabled: ["projects", "bids"] },
    toolPolicy: { disabledTools: [], forceApprovalTools: [] },
  });
  ok(allowed.ok, "AUTH-FRESH-04: 策略未变 → 允许恢复执行", allowed);

  const disabled = canInvokeTool({
    ...base,
    modulesJson: { enabled: ["projects", "bids"] },
    toolPolicy: { disabledTools: [toolName], forceApprovalTools: [] },
  });
  ok(
    !disabled.ok && disabled.code === "tool_disabled",
    "AUTH-FRESH-01: 批准后该工具被加入 disabledTools → 当前不允许（→ POLICY_STALE）",
  );

  const moduleOff = canInvokeTool({
    ...base,
    modulesJson: { enabled: ["sales"] },
    toolPolicy: { disabledTools: [], forceApprovalTools: [] },
  });
  ok(
    !moduleOff.ok && moduleOff.code === "module_disabled",
    "AUTH-FRESH-02: 批准后模块被关停 → 当前不允许（→ POLICY_STALE）",
  );

  const viewer = canInvokeTool({
    ...base,
    tenant: { ...base.tenant, orgRole: "org_viewer" },
    modulesJson: { enabled: ["projects", "bids"] },
    toolPolicy: { disabledTools: [], forceApprovalTools: [] },
  });
  ok(
    !viewer.ok,
    "AUTH-FRESH-03: 角色降级为 viewer → 当前不允许（canonical 归属 ACTOR_STALE，见 resume-freshness 门 A 先于门 C）",
  );
}



/* ---------------- DELIV-01..12：交付物 parity closure ---------------- */
{
  const NAMES = TENDER_WORKFORCE_TOOL_NAMES;
  const DESCS = TENDER_WORKFORCE_TOOL_DESCRIPTORS;
  const legacySrc = readFileSync("src/lib/tender-auto-analysis/worker.ts", "utf8");
  const delivSrc = readFileSync("src/lib/tender-auto-analysis/deliverables.ts", "utf8");
  const toolsSrc = readFileSync("src/lib/tender-workforce/tools.ts", "utf8");
  const DELIV_TOOL = "tender_build_deliverables";

  ok(
    legacySrc.includes("await buildDeliverables({ runId: run.id })") &&
      delivSrc.includes("export async function buildDeliverables("),
    "DELIV-01: legacy 仍调用同一 service 文件中的 buildDeliverables（行为未改）",
  );
  ok((NAMES as readonly string[]).includes(DELIV_TOOL), "DELIV-02: 交付物工具在 Tender scoped 工具集中");
  ok(
    !RUNTIME_V2_TOOL_CATALOG.some((t) => t.name === DELIV_TOOL),
    "DELIV-03: 全局 planner catalog 不含交付物工具（GLOBAL_PLANNER_VISIBLE_TENDER_TOOLS 仍为 0）",
  );
  ok(!!getExecutionToolPolicyDescriptor(DELIV_TOOL), "DELIV-04: 执行 descriptor 覆盖交付物工具");
  ok(
    !resolveExecutionPolicyTool("deliverables_ghost_tool").ok,
    "DELIV-05: 未知工具仍 fail-closed",
  );
  const plan = buildTenderDeterministicPlan({ projectId: "p1", projectName: "T" });
  const dtask = plan.tasks.find((t) => t.preferredTool === DELIV_TOOL);
  ok(!!dtask, "DELIV-06: 确定性计划含交付物阶段");
  ok(dtask?.workerKey === "tender_worker", "DELIV-07: 交付物任务 workerKey=tender_worker");
  ok(
    plan.tasks.every((t) => t.workerKey === "tender_worker" || t.workerKey === "synthesis_worker"),
    "DELIV-08: 计划内 sales_worker fallback = 0",
  );
  ok(
    (dtask?.dependsOn ?? []).includes("t3_extract_requirements"),
    "DELIV-09: 交付物依赖真实前置（已抽取要求）——与 legacy 领域先决条件一致",
  );
  const synth = plan.tasks.find((t) => t.taskKind === "synthesis");
  const finalizeTask = plan.tasks[plan.tasks.length - 1];
  ok(
    (synth?.dependsOn ?? []).includes(dtask!.id) &&
      (finalizeTask.dependsOn ?? []).includes(synth!.id),
    "DELIV-10: synthesis 消费交付物，finalize 消费 synthesis",
  );
  ok(
    tenderWorkforcePlannerTools().some((t) => t.name === DELIV_TOOL),
    "DELIV-11: flag OFF 的 LLM planner scope 同样可见交付物工具",
  );
  ok(
    delivSrc.includes("buildGroundedDeliverables") &&
      !toolsSrc.includes("DELIVERABLE_DEFINITIONS"),
    "DELIV-12: 唯一领域实现（工具不复制 legacy 静态模板逻辑）",
  );
  ok(
    (TENDER_PLAN_SEMANTIC_STAGES as readonly string[]).includes("build_deliverables"),
    "DELIV-13: 语义阶段表含交付物",
  );
  ok(DESCS.length === NAMES.length && NAMES.length === 8, "DELIV-14: 工具数 8，descriptor 覆盖 8/8");
}

finish();
