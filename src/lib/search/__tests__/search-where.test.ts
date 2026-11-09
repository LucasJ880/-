/**
 * 全局搜索查询条件：可见范围不被关键词条件覆盖（修复任务搜索跨企业泄露）
 * 运行：npx tsx src/lib/search/__tests__/search-where.test.ts
 *
 * 用一个只认本测试所需形状（AND / OR / contains / 等值 / null / in / some / 关联对象）的小求值器，
 * 把 where 跑在样例行上，直接看哪些行会被搜到。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProjectSearchWhere, buildTaskSearchWhere, type SearchWhere } from "../where";

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
  ok(/buildTaskSearchWhere\(projectWhere, user\.id, q\)/.test(src) && /buildProjectSearchWhere\(projectWhere, q\)/.test(src), "路由用这两个函数组装查询条件");
  ok(!/\.\.\.taskProjectScope/.test(src) && !/\.\.\.\w+Scope,\s*\n\s*OR:/.test(src), "路由不再出现「展开范围后再写 OR」的写法");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
