/**
 * B5 — Supervisor cancel 端点门：静态回归断言。
 * 运行：npx tsx src/lib/agent-runtime/__tests__/b5-supervisor-cancel-static.test.ts
 *
 * 守住：路由的 cancel 分支只经 cancelSupervisorRunGated；门本身做租户
 * scoped 读取 + Supervisor 属主判别 + actor 授权，且不 import 冻结的
 * agent-supervisor 模块、不新增事件词表、变更仍委托 canonical cancelAgentRun。
 */
import { readFileSync } from "fs";
import { join } from "path";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

const route = readFileSync(
  join(process.cwd(), "src/app/api/agent-supervisor/runs/[id]/route.ts"),
  "utf8",
);
const gate = readFileSync(
  join(process.cwd(), "src/lib/agent-runtime/supervisor-cancel-gate.ts"),
  "utf8",
);

// ── 路由层 ──
ok(route.includes("cancelSupervisorRunGated"), "route: cancel 分支走 cancelSupervisorRunGated");
ok(!/cancelAgentRun\s*\(/.test(route), "route: 不再直接调用通用 cancelAgentRun");
ok(!route.includes('from "@/lib/agent-runtime/run"'), "route: 不再 import 通用 run 原语模块");
ok(route.includes("actor: { userId: user.id, role: user.role }"), "route: actor 取自 withAuth 服务端已认证 user（非 body）");
ok(!/body\.(orgId|userId|role)/.test(route), "route: orgId/userId/role 绝不取自请求 body");
ok(/decision === "not_found"[\s\S]{0,120}status: 404/.test(route), "route: not_found → 404（跨 org/非 Supervisor run 不泄漏存在性）");
ok(/decision === "forbidden"[\s\S]{0,120}status: 403/.test(route), "route: forbidden → 403");
ok(!route.includes('status: "cancelled" })'), "route: 不再无条件谎报 cancelled（返回真实状态）");

// ── 门层 ──
ok(/findFirst\(\{\s*\n?\s*where: \{ id: runId, orgId \}/.test(gate), "gate: 租户 scoped 读取 where:{id, orgId}（非全局查再比对）");
ok(gate.includes('SUPERVISOR_RUN_TYPE = "supervisor"'), "gate: canonical 判别 runType=supervisor");
ok(gate.includes('"runtime_v2"') && gate.includes('"workforce_job"'), "gate: 共享表防护——runtime_v2/workforce_job 显式拒绝");
ok(gate.includes("isSupervisorOwnedRun"), "gate: Supervisor 属主判别先于变更");
ok(gate.includes("isSuperAdmin") && gate.includes('hasOrgRole(membership.role, "org_admin")'), "gate: actor 授权=发起人/平台管理员/org 管理员（成员资格复核）");
ok(gate.includes('membership.status === "active"'), "gate: org 管理员须为活跃成员");
ok(gate.includes("cancelAgentRun(orgId, runId)"), "gate: 变更仍委托 canonical cancelAgentRun（终态幂等+锁内复核）");
ok(!/(from\s+["']|import\(\s*["'])@\/lib\/agent-supervisor/.test(gate), "gate: 不 import 冻结的 agent-supervisor 模块（判别只用 AgentRun 持久化字段）");
ok(!/eventType:\s*["'`]/.test(gate), "gate: 零新事件词表");
ok(!/tx\.agentRun\.update|db\.agentRun\.update/.test(gate), "gate: 自身不直接改 AgentRun 状态（无第二套状态机）");
ok(/not_found/.test(gate) && !/exists in another org|belongs to another/.test(gate), "gate: 跨 org 与不存在同构响应");

console.log(`\nB5 Supervisor cancel 门静态断言 结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
