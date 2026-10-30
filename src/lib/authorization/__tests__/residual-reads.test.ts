/**
 * PERM-4c5：残留平台角色读点收口（纯：注入后的判定、营销读守卫规则、视觉方案范围、闸门、接入点源码断言）
 * 运行：npx tsx src/lib/authorization/__tests__/residual-reads.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WINDOW_COVERING_INDUSTRY_PACK, mergedProfileBindings } from "../role-defaults";
import { PLATFORM_ROLE_COLLAPSE_READY } from "../platform-role-collapse";
import { deriveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { canViewTeamTasks, canViewAllDeliveryProjects } from "@/lib/operations/projects/access";
import { canExecuteHandoff, canPreviewHandoff } from "@/lib/projects/handoff/access";
import { isManagementWorkspaceUser } from "@/lib/rbac/workspace-policy";
import { canAccessMarketingWorkspace } from "@/lib/marketing/route-access";
import { canSeeVisualizerSession, visualizerSessionListScope, visualizerViewerForOrg } from "@/lib/visualizer/access";
import { canSeeResource } from "@/lib/rbac/data-scope";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function keysOf(...positions: string[]): string[] {
  return [
    ...new Set(
      positions.flatMap((p) =>
        mergedProfileBindings(WINDOW_COVERING_INDUSTRY_PACK, p)
          .filter((b) => (b.effect ?? "ALLOW") === "ALLOW")
          .map((b) => b.permissionKey),
      ),
    ),
  ];
}

/** 注入岗位信号后的上下文（同 loadWorkspaceSignals 的结果） */
const ctx = (platformRole: string, positions: string[], orgRole = "org_member") => ({
  platformRole,
  orgRole,
  hasMembership: true,
  userId: "u1",
  permissionKeys: keysOf(...positions),
  positionMode: true,
});

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

console.log("residual-reads（PERM-4c5）");

// ── B1 / B2：团队任务 / 运营项目 ──
ok(canViewTeamTasks(ctx("user", ["owner"])), "压扁后 owner：团队任务可见");
ok(!canViewTeamTasks(ctx("boss", ["sales_rep"])), "平台 boss + sales_rep（org_member）：团队任务不可见");
ok(canViewTeamTasks(ctx("user", ["ops_lead"])), "压扁后 ops_lead：团队任务可见（键）");
ok(canViewAllDeliveryProjects(ctx("user", ["ops_lead"])), "压扁后 ops_lead：运营项目列表可见");
ok(!canViewAllDeliveryProjects(ctx("user", ["sales_rep"])), "sales_rep：运营项目列表不可见");
ok(isManagementWorkspaceUser(ctx("user", ["owner"])), "压扁后 owner：任务编辑的管理层判定为真");
ok(!isManagementWorkspaceUser(ctx("boss", ["ops_staff"])), "平台 boss + ops_staff：不是管理层");
ok(canViewTeamTasks(ctx("user", ["sales_rep"], "org_owner")), "企业 org_owner：团队任务仍可见（成员角色口径不变）");
{
  const noSignals = { platformRole: "user", orgRole: "org_member", hasMembership: true, userId: "u1" };
  ok(!canViewTeamTasks(noSignals), "反例：未注入岗位信号时压扁后的老板看不到团队任务（这就是要注入的原因）");
}

// ── B3：交接 ──
ok(canPreviewHandoff(ctx("user", ["bids"]), { canReadTender: true }), "压扁后 bids：可预览交接（bids.handoff.preview）");
ok(canExecuteHandoff(ctx("user", ["bids"]), { canManageTender: true }), "压扁后 bids：可执行交接");
ok(canPreviewHandoff(ctx("user", ["owner"]), { canReadTender: true }), "压扁后 owner：可预览交接（管理层）");
ok(!canExecuteHandoff(ctx("operations", ["ops_staff"]), { canManageTender: false }), "平台 operations + ops_staff：不能执行交接");

// ── B4：审批执行的资源可见性（执行器 canSeeResource(ctx.role…)） ──
{
  const derive = (platformRole: string, positions: string[]) =>
    deriveEffectivePlatformRole({ platformRole, positionMode: true, permissionKeys: keysOf(...positions) });
  const repQuote = { orgId: "orgA", createdById: "rep1" };
  ok(canSeeResource(derive("user", ["owner"]), "boss1", repQuote, "orgA"), "压扁后 owner 批准销售的报价动作：执行器可见（与平台 boss 相同）");
  ok(canSeeResource("boss", "boss1", repQuote, "orgA"), "对照：平台 boss 可见");
  ok(!canSeeResource(derive("user", ["sales_rep"]), "rep2", repQuote, "orgA"), "另一名销售：不可见他人的报价");
  ok(!canSeeResource(derive("user", ["owner"]), "boss1", repQuote, "orgB"), "跨企业：不可见");
}

// ── A6：营销读守卫规则 ──
const mkt = (platformRole: string, positions: string[], positionMode = true) =>
  canAccessMarketingWorkspace(deriveEffectivePlatformRole({ platformRole, positionMode, permissionKeys: keysOf(...positions) }));
ok(!mkt("user", ["sales_rep"]), "压扁后 sales_rep：营销工作区被拦");
ok(!mkt("user", ["pricing_lead"]), "压扁后 pricing_lead：营销工作区被拦");
ok(mkt("user", ["ops_staff"]), "ops_staff：营销工作区可进");
ok(mkt("user", ["owner"]), "owner：营销工作区可进");
ok(mkt("sales", ["ops_staff"]), "平台 sales + ops_staff：按岗位可进");
ok(!mkt("sales", [], false), "旧模式平台 sales：被拦（与中间件一致）");

// ── B5：视觉方案范围（跨企业泄露修复） ──
{
  const sess = (orgId: string, createdById = "other") => ({ createdById, salesOwnerId: null, customer: { createdById: "other", orgId } });
  const bossA = visualizerViewerForOrg({ id: "u1", role: "boss" }, "orgA");
  ok(canSeeVisualizerSession(sess("orgA"), bossA), "boss（企业 A 上下文）：看得到 A 的他人方案");
  ok(!canSeeVisualizerSession(sess("orgB"), bossA), "boss（企业 A 上下文）：看不到 B 的方案（泄露已修）");
  const listA = visualizerSessionListScope(bossA) as { OR: unknown[] } | null;
  ok(listA !== null && JSON.stringify(listA).includes('"orgA"') && !JSON.stringify(listA).includes("orgB"), "boss 列表：限企业 A");
  const admin = visualizerViewerForOrg({ id: "u2", role: "admin" }, "orgA");
  ok(!canSeeVisualizerSession(sess("orgB"), admin), "平台 admin：也不跨企业");
  const sa = visualizerViewerForOrg({ id: "u3", role: "super_admin" }, "orgA");
  ok(canSeeVisualizerSession(sess("orgB"), sa) && visualizerSessionListScope(sa) === null, "平台 super_admin：仍看全部");
  const rep = visualizerViewerForOrg({ id: "u4", role: "sales" }, "orgA");
  ok(!canSeeVisualizerSession(sess("orgA"), rep) && canSeeVisualizerSession(sess("orgA", "u4"), rep), "sales：只看本人");
  const unresolved = { id: "u1", role: "boss" };
  ok(!canSeeVisualizerSession(sess("orgA"), unresolved), "未解析的查看者：只看本人（fail-closed）");
  ok(canSeeVisualizerSession(sess("orgA"), visualizerViewerForOrg({ id: "u1", role: deriveEffectivePlatformRole({ platformRole: "user", positionMode: true, permissionKeys: keysOf("owner") }) }, "orgA")), "压扁后 owner（派生 boss）：本企业全部");
}

// ── 闸门 ──
ok(PLATFORM_ROLE_COLLAPSE_READY === true, "写库闸门已打开");

// ── 接入点源码断言 ──
{
  const injected: Array<[string, string]> = [
    ["src/app/api/tasks/route.ts", "/api/tasks"],
    ["src/app/api/tasks/[id]/route.ts", "/api/tasks/[id]"],
    ["src/app/api/ops/projects/route.ts", "/api/ops/projects"],
    ["src/app/api/projects/[id]/handoff/route.ts", "交接记录"],
    ["src/app/api/projects/[id]/handoff/preview/route.ts", "交接预览"],
    ["src/app/api/projects/[id]/handoff/execute/route.ts", "交接执行"],
  ];
  for (const [p, name] of injected) ok(src(p).includes("...(await loadWorkspaceSignals(user.id,"), `${name}：注入岗位信号`);
  ok((src("src/app/api/tasks/route.ts").match(/loadWorkspaceSignals\(/g) ?? []).length === 2, "/api/tasks：GET 与 POST 都注入");
  ok((src("src/app/api/tasks/[id]/route.ts").match(/loadWorkspaceSignals\(/g) ?? []).length === 2, "/api/tasks/[id]：PATCH 与 DELETE 都注入");
  const derived: Array<[string, string]> = [
    ["src/app/api/ai/pending-actions/[id]/route.ts", "待审批动作决策"],
    ["src/app/api/agent/tasks/[taskId]/steps/[stepId]/approve/route.ts", "任务步骤批准"],
    ["src/app/api/agent/tasks/[taskId]/steps/[stepId]/reject/route.ts", "任务步骤拒绝"],
    ["src/lib/ai-grader/actions/wechat-confirm.ts", "微信确认"],
    ["src/app/api/auth/me/route.ts", "/api/auth/me"],
    ["src/lib/marketing/access.ts", "营销读守卫"],
    ["src/lib/messaging/binding.ts", "微信绑定默认推送"],
    ["src/lib/assistant/followup-task.ts", "持久跟进开关"],
    ["src/lib/workforce-runtime/job.ts", "workforce 开关"],
    ["src/lib/visualizer/access.ts", "视觉方案查看者"],
  ];
  for (const [p, name] of derived) ok(src(p).includes("resolveEffectivePlatformRole("), `${name}：用派生角色`);
  const pa = src("src/app/api/ai/pending-actions/[id]/route.ts");
  ok(!/role: user\.role,\s*orgId: orgRes\.orgId/.test(pa), "待审批动作：决策 / 批准 / 拒绝不再直接传 user.role");
  const sup = src("src/app/api/agent-supervisor/runs/route.ts");
  ok(!/isSupervisorEnabled\(\{\s*userId: user\.id,\s*role: user\.role/.test(sup), "agent-supervisor 开关不再直接传 user.role");
  // 营销
  const mktFiles = [
    "plans", "metrics", "mmm/datasets", "mmm/runs", "attributions", "economics", "audits", "daily-brief",
    "experiments", "health", "brand-profile", "dashboard", "channel-accounts", "campaigns", "automations",
  ];
  for (const f of mktFiles) ok(src(`src/app/api/marketing/${f}/route.ts`).includes("requireMarketingReadAccess(user"), `GET /api/marketing/${f}：读守卫`);
  for (const d of ["src/app/(main)/marketing/layout.tsx", "src/app/(main)/operations/growth/layout.tsx"]) {
    ok(src(d).includes("await guardMarketingWorkspacePage()"), `${d}：服务端门槛`);
  }
  ok(src("src/middleware.ts").includes("canAccessMarketingWorkspace(role)"), "中间件原判定保留（旧模式）");
  // 前端
  ok(src("src/components/dashboard/management-dashboard-client.tsx").includes("user?.effectiveRole || user?.role"), "管理总览读 effectiveRole");
  ok(src("src/app/(main)/assistant/digital-employee-workbench.tsx").includes("user?.effectiveRole ?? user?.role"), "工作台营销入口读 effectiveRole");
  // 视觉方案：所有路由都先解析查看者
  const vRoutes = src("src/app/api/visualizer/sessions/route.ts");
  ok(vRoutes.includes("resolveVisualizerViewer(user)") && vRoutes.includes("visualizerSessionListScope(viewer)"), "视觉方案列表：先解析查看者");
  ok(src("src/app/api/files/[...path]/route.ts").includes("canSeeVisualizerSession(session, await resolveVisualizerViewer(user))"), "文件代理：视觉方案按查看者");
  ok(src("src/lib/agent-core/tools/sales-visualizer.ts").includes("visualizerViewerForOrg({ id: ctx.userId, role: ctx.role }, ctx.orgId)"), "智能体视觉方案工具：限当前企业");
  // 入职清单
  ok(src("src/lib/organizations/onboarding.ts").includes("hasSalesWorkKey(memberKeys[i])"), "入职清单：岗位模式按销售工作键");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
