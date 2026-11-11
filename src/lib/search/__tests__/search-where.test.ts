/**
 * 全局搜索查询条件：可见范围不被关键词条件覆盖（修复任务搜索跨企业泄露）
 * 运行：npx tsx src/lib/search/__tests__/search-where.test.ts
 *
 * 用一个只认本测试所需形状（AND / OR / contains / 等值 / null / in / some / 关联对象）的小求值器，
 * 把 where 跑在样例行上，直接看哪些行会被搜到。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildProjectSearchWhere,
  buildReadableProjectWhere,
  buildTaskSearchWhere,
  shouldSearchProjects,
  type SearchWhere,
} from "../where";
import { gateCtx } from "@/lib/navigation/__tests__/identity-fixtures";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}

type Row = Record<string, unknown>;

function matches(row: Row | null | undefined, where: SearchWhere): boolean {
  if (!row) return false;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as SearchWhere[]).every((w) => matches(row, w));
    if (key === "OR") return (cond as SearchWhere[]).some((w) => matches(row, w));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (typeof cond !== "object") return value === cond;
    const c = cond as Record<string, unknown>;
    if ("contains" in c) return typeof value === "string" && value.includes(String(c.contains));
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("some" in c) return Array.isArray(value) && value.some((v) => matches(v as Row, c.some as SearchWhere));
    return matches(value as Row, c as SearchWhere);
  });
}

// buildProjectVisibilityWhere 对非 super_admin 的返回形状（visibility.ts）：本人在 org-a 有 active 成员身份
const VISIBLE: SearchWhere = {
  intakeStatus: "dispatched",
  OR: [{ ownerId: "u1", orgId: null }, { orgId: { in: ["org-a"] } }, { members: { some: { userId: "u1", status: "active" } } }],
};

const projA = { id: "pa", orgId: "org-a", ownerId: "x", intakeStatus: "dispatched", members: [], name: "报价项目", description: "" };
const projB = { id: "pb", orgId: "org-b", ownerId: "y", intakeStatus: "dispatched", members: [], name: "报价项目 B", description: "" };
const TASKS: Row[] = [
  { id: "t-own-org", title: "报价跟进", description: "", projectId: "pa", project: projA, creatorId: "x" },
  { id: "t-other-org", title: "报价跟进", description: "", projectId: "pb", project: projB, creatorId: "y" },
  { id: "t-mine-personal", title: "报价复核", description: "", projectId: null, project: null, creatorId: "u1" },
  { id: "t-others-personal", title: "报价复核", description: "", projectId: null, project: null, creatorId: "y" },
  { id: "t-no-keyword", title: "量房", description: "", projectId: "pa", project: projA, creatorId: "x" },
];

console.log("search-where（全局搜索范围）");
{
  const where = buildTaskSearchWhere(VISIBLE, "u1", "报价");
  const hits = TASKS.filter((t) => matches(t, where)).map((t) => t.id);
  ok(JSON.stringify(hits) === '["t-own-org","t-mine-personal"]', "任务：只搜到本人可见企业的任务与本人的无项目任务", hits);
  ok(!hits.includes("t-other-org"), "任务：其他企业的任务搜不到（修复前会被搜到）");
  ok(!hits.includes("t-others-personal"), "任务：他人的无项目任务搜不到");
  ok(JSON.stringify(Object.keys(where)) === '["AND"]', "任务：范围与关键词用 AND 组合，顶层没有会覆盖范围的 OR 键", Object.keys(where));

  // 修复前的写法：展开范围后再写 OR 键 → 范围被覆盖
  const scope = { OR: [{ project: VISIBLE }, { projectId: null, creatorId: "u1" }] };
  const before = { ...scope, OR: [{ title: { contains: "报价" } }, { description: { contains: "报价" } }] };
  ok(TASKS.filter((t) => matches(t, before)).some((t) => t.id === "t-other-org"), "回归对照：修复前的写法确实会搜到其他企业的任务");
}
{
  const where = buildTaskSearchWhere(null, "sa", "报价");
  ok(TASKS.filter((t) => matches(t, where)).length === 4, "平台 super_admin：不加范围，按关键词搜全部");
}
{
  const where = buildProjectSearchWhere(VISIBLE, "报价");
  const hits = [projA, projB].filter((p) => matches(p, where)).map((p) => p.id);
  ok(JSON.stringify(hits) === '["pa"]', "项目：只搜到本人可见的项目", hits);
  ok(JSON.stringify(Object.keys(where)) === '["AND"]', "项目：范围与关键词用 AND 组合");
}
{
  const src = readFileSync(join(process.cwd(), "src/app/api/search/route.ts"), "utf8");
  ok(/buildTaskSearchWhere\(projectWhere, user\.id, q\)/.test(src), "路由用 buildTaskSearchWhere 组装任务条件（任务范围不变）");
  // VIS-1c：项目条件改为可读范围 ∧ 项目详情门
  ok(/buildProjectSearchWhere\(buildReadableProjectWhere\(user\.id, adminOrgIds\), q\)/.test(src), "路由的项目条件用可读范围（buildReadableProjectWhere）");
  ok(/if \(isSuperAdmin\(user\.role\)\) return buildProjectSearchWhere\(null, q\);/.test(src), "平台 super_admin：不判定门、项目不加范围");
  ok(/if \(!shouldSearchProjects\(ctx\)\) return null;/.test(src) && /projectSearch === null\s*\? Promise\.resolve\(\[\]\)/.test(src), "项目详情门不放行：不查项目，项目结果为空");
  ok(/loadGateNavigationContextForUser\(user\.id\)/.test(src) && !/resolvePreferredOrgId/.test(src), "判定输入取路由门同一份（缓存、不写库，不走 resolvePreferredOrgId）");
  ok(/isOrgSystemAdmin\(m\.role\)/.test(src), "管理企业按 org_admin / org_owner");
  ok(/return NextResponse\.json\(\{ tasks, projects \}\);/.test(src), "响应形状保持 { tasks, projects }");
  ok(!/\.\.\.taskProjectScope/.test(src) && !/\.\.\.\w+Scope,\s*\n\s*OR:/.test(src), "路由不再出现「展开范围后再写 OR」的写法");
}

// ── VIS-1c：项目结果的范围（spec search/global-search「项目结果的范围」）──
console.log("\n项目结果的范围（VIS-1c）");
{
  // u1：org-a 的 org_member；org-b 的 org_admin；另负责 org-c 的一个项目；是 pa2 的 active 成员
  const P = (id: string, orgId: string | null, over: Partial<Row> = {}): Row => ({
    id, orgId, ownerId: "x", intakeStatus: "dispatched", members: [], name: `报价${id}`, description: "", ...over,
  });
  const projects: Row[] = [
    P("pa1", "org-a"),
    P("pa2", "org-a", { members: [{ userId: "u1", status: "active" }] }),
    P("pa3", "org-a", { members: [{ userId: "u1", status: "removed" }] }),
    P("pb1", "org-b"),
    P("pb2", "org-b", { intakeStatus: "pending_dispatch" }),
    P("pc1", "org-c", { ownerId: "u1" }),
    P("pd1", "org-d"),
  ];
  const where = buildProjectSearchWhere(buildReadableProjectWhere("u1", ["org-b"]), "报价");
  const hits = projects.filter((p) => matches(p, where)).map((p) => p.id);
  ok(JSON.stringify(hits) === '["pa2","pb1","pc1"]', "只搜到：参与的项目、管理企业的已分发项目、本人负责的项目", hits);
  ok(!hits.includes("pa1") && !hits.includes("pa3"), "普通成员：企业里没参与（或已移出）的项目搜不到（修复前能搜到）");
  ok(!hits.includes("pb2"), "未分发的项目搜不到（与详情页一致）");
  ok(hits.includes("pc1"), "负责人：其他企业里本人负责的项目也搜得到（详情页放行负责人）");
  const memberOnly = buildProjectSearchWhere(buildReadableProjectWhere("u1", []), "报价");
  ok(JSON.stringify(projects.filter((p) => matches(p, memberOnly)).map((p) => p.id)) === '["pa2","pc1"]', "没有管理企业时不带企业条件");
  ok(JSON.stringify(Object.keys(where)) === '["AND"]', "可读范围与关键词用 AND 组合");

  ok(!shouldSearchProjects(gateCtx("sales_rep")), "不是项目成员的销售：不搜项目（项目详情门不放行）");
  ok(shouldSearchProjects(gateCtx("sales_rep_project_member")), "是项目成员的销售：搜项目（只会搜到参与的项目）");
  ok(shouldSearchProjects(gateCtx("bids")) && shouldSearchProjects(gateCtx("owner")), "招投标、老板：搜项目");
  ok(!shouldSearchProjects(gateCtx("installer")) && !shouldSearchProjects(gateCtx("no_position")), "安装工、无岗位：不搜项目");
  ok(shouldSearchProjects(gateCtx("super_admin")), "未绑岗位的平台 super_admin：搜项目");
  ok(!shouldSearchProjects(null), "判定输入缺失：不搜项目");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
