/**
 * Tender/Project Security P0 — AgentTask API 授权布线契约测试（静态源码断言，无 DB）。
 * 运行：npx tsx src/app/api/agent/tasks/__tests__/authz-contract.test.ts
 *
 * 目的：把「每个 AgentTask mutation / read 路由都必须在服务端重新校验项目授权」
 * 固化为回归护栏（S6/S7 授权布线、S5 跨 org、§27 契约级断言），
 * 防止未来有人新增/回退路由时丢掉 server-side gate。
 * 采用精确的「文件 → 必需符号」断言，而非脆弱的大范围字符串扫描。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
];

for (const { file, must, label } of CONTRACT) {
  const src = read(file);
  const missing = must.filter((token) => !src.includes(token));
  ok(missing.length === 0, `${label}${missing.length ? ` — 缺: ${missing.join(", ")}` : ""}`);
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
