/**
 * Tender/Project Security P0 — AgentTask API 授权布线契约测试（静态源码断言，无 DB）。
 * 运行：npx tsx src/app/api/agent/tasks/__tests__/authz-contract.test.ts
 *
 * 目的：把「每个 AgentTask mutation / read 路由都必须在服务端重新校验项目授权」
 * 固化为回归护栏（S6/S7 授权布线、S5 跨 org、§27 契约级断言），
 * 防止未来有人新增/回退路由时丢掉 server-side gate。
 * 采用精确的「文件 → 必需符号」断言，而非脆弱的大范围字符串扫描。
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const routesRoot = resolve(here, "..");

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

function read(rel: string): string {
  return readFileSync(resolve(routesRoot, rel), "utf8");
}

console.log("security-p0 agent-task authz contract");

// 每条记录：路由文件 → 必须出现的授权符号（全部满足才算通过）
const CONTRACT: Array<{ file: string; must: string[]; label: string }> = [
  {
    file: "[taskId]/execute/route.ts",
    must: ["requireProjectManageAccess", "runGuardedTaskMutation", "onAuthorized"],
    label: "execute 需项目管理授权（守卫编排派发）",
  },
  {
    file: "[taskId]/cancel/route.ts",
    must: ["requireProjectManageAccess", "runGuardedTaskMutation", "onAuthorized"],
    label: "cancel 需项目管理授权（守卫编排派发）",
  },
  {
    file: "[taskId]/route.ts",
    must: [
      "requireProjectReadAccess",
      "requireProjectManageAccess",
      "toBusinessAgentTaskDetail",
      "isPlatformAdmin",
    ],
    label: "detail GET 读授权+安全投影，PATCH 管理授权",
  },
  {
    file: "route.ts",
    must: ["requireProjectReadAccess", "requireProjectManageAccess", "sanitizeListStepError"],
    label: "list GET 读授权+error 脱敏，POST 管理授权",
  },
  {
    file: "[taskId]/steps/[stepId]/approve/route.ts",
    must: ["requireProjectReadAccess", "task.projectId"],
    label: "approve 前置项目读授权（租户隔离）",
  },
  {
    file: "[taskId]/steps/[stepId]/reject/route.ts",
    must: ["requireProjectReadAccess", "task.projectId"],
    label: "reject 前置项目读授权（租户隔离）",
  },
  {
    // FIX-23：只给还能打开项目的任务（与项目读权限守卫同口径的批量条件），检查报告只给平台管理员
    file: "recent/route.ts",
    must: [
      "isPlatformAdmin",
      "sanitizeListStepInternals",
      "buildReadableProjectWhere",
      "listEffectiveMemberships",
    ],
    label: "recent GET 按项目读权限口径筛+按平台管理员区分的步骤投影",
  },
];

for (const { file, must, label } of CONTRACT) {
  const src = read(file);
  const missing = must.filter((token) => !src.includes(token));
  ok(missing.length === 0, `${label}${missing.length ? ` — 缺: ${missing.join(", ")}` : ""}`);
}

// —— 目录完整性（FIX-23）：tasks/ 下（含子目录）每个 route.ts 都必须在登记表里 ——
function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === "route.ts") out.push(relative(routesRoot, full).split(sep).join("/"));
  }
  return out.sort();
}
const registered = new Set(CONTRACT.map((c) => c.file));
const routeFiles = listRouteFiles(routesRoot);
console.log(`  目录 src/app/api/agent/tasks/ 下的路由文件 ${routeFiles.length} 个：`);
for (const file of routeFiles) console.log(`    - ${file}${registered.has(file) ? "（已登记）" : "（未登记）"}`);
const unregistered = routeFiles.filter((f) => !registered.has(f));
ok(
  routeFiles.length > 0 && unregistered.length === 0,
  `目录下 ${routeFiles.length} 个路由文件都已登记${unregistered.length ? ` — 未登记: ${unregistered.join(", ")}` : ""}`,
);
const stale = [...registered].filter((f) => !routeFiles.includes(f));
ok(stale.length === 0, `登记表里没有已不存在的路由文件${stale.length ? ` — 不存在: ${stale.join(", ")}` : ""}`);

// —— 最近任务接口的步骤 select 不得选原始报错、输入与输出（FIX-23 design D3）——
// 原始报错 error 不在 AGENT_STEP_INTERNAL_FIELDS 里，投影管不到，只能靠这条拦住
function stepsSelectBlock(src: string): string | null {
  const m = /steps\s*:\s*\{\s*select\s*:\s*\{/.exec(src);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return depth === 0 ? src.slice(start, i - 1) : null;
}
{
  const block = stepsSelectBlock(read("recent/route.ts"));
  const forbidden = block === null ? [] : ["error", "inputJson", "outputJson"].filter((k) => new RegExp(`\\b${k}\\s*:`).test(block));
  ok(
    block !== null && forbidden.length === 0,
    `recent/route.ts 的步骤 select 不含 error / inputJson / outputJson${block === null ? " — 找不到步骤 select" : forbidden.length ? ` — 选了: ${forbidden.join(", ")}` : ""}`,
  );
}

// —— 反向断言：mutation 路由不得只有 withAuth 而无项目授权 ——
// （withAuth 仅认证；必须叠加 requireProject*Access 才是授权边界）
const MUTATION_ROUTES = [
  "[taskId]/execute/route.ts",
  "[taskId]/cancel/route.ts",
];
for (const file of MUTATION_ROUTES) {
  const src = read(file);
  const hasProjectGate =
    src.includes("requireProjectManageAccess") ||
    src.includes("requireProjectWriteAccess");
  ok(hasProjectGate, `${file} 不是「仅 withAuth」——含项目授权闸`);
}

// —— 安全投影模块存在且导出内部字段常量 ——
const dtoSrc = readFileSync(
  resolve(here, "../../../../../lib/agent-tasks/dto.ts"),
  "utf8",
);
ok(
  dtoSrc.includes("AGENT_STEP_INTERNAL_FIELDS") &&
    dtoSrc.includes("toBusinessAgentTaskDetail"),
  "dto.ts 导出安全投影与内部字段常量",
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
