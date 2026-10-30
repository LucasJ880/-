/**
 * PERM-4c1：项目财务 / 报价引擎按岗位（不连库）
 *   财务能力决策表、细粒度权限放行表、报价引擎特权、源码断言（路由不再认 org_admin、canManageUsers 已删）
 * 运行：npx tsx src/lib/project-finance/__tests__/finance-access.test.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { allowCostPermission, decideFinancePrivilege } from "../access";
import { resolveQuoteCapabilities } from "@/lib/quote-engine/access";
import { PERMISSIONS } from "@/lib/rbac/permissions";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".ts")) out.push(relative(ROOT, p));
    }
  };
  walk(join(ROOT, dir));
  return out;
}

console.log("PERM-4c1 财务能力决策表");
{
  const d = (o: Partial<Parameters<typeof decideFinancePrivilege>[0]>) =>
    decideFinancePrivilege({ isPlatformSuperAdmin: false, isProjectOwner: false, holdsManage: false, holdsRead: false, ...o });
  const none = d({});
  ok(!none.privileged && !none.canReadAll, "无岗位键、非负责人 → 无特权、不可看全部");
  const sa = d({ isPlatformSuperAdmin: true });
  ok(sa.privileged && sa.canReadAll, "平台 super_admin → 特权");
  const owner = d({ isProjectOwner: true });
  ok(owner.privileged && owner.canReadAll, "项目负责人 → 特权");
  const boss = d({ holdsManage: true });
  ok(boss.privileged && boss.canReadAll, "持 project.finance.manage（老板）→ 特权");
  const acc = d({ holdsRead: true });
  ok(!acc.privileged && acc.canReadAll, "持 project.finance.read（会计）→ 只读全量、无特权");
}

console.log("PERM-4c1 细粒度权限放行表");
{
  const P = PERMISSIONS;
  const acc = { privileged: false, canReadAll: true };
  const none = { privileged: false, canReadAll: false };
  const boss = { privileged: true, canReadAll: true };
  const allow = (finance: typeof acc, permission: Parameters<typeof allowCostPermission>[0]["permission"], projectRole: string | null = null) =>
    allowCostPermission({ finance, projectRole, permission });
  ok(allow(acc, P.PROJECT_COST_READ), "会计：读 → 放行");
  for (const p of [P.PROJECT_COST_WRITE, P.PROJECT_COST_REVIEW, P.PROJECT_PAYMENT_RECORD, P.PROJECT_EXPENSE_SUBMIT]) {
    ok(!allow(acc, p), `会计：${p} → 拒绝（只读）`);
  }
  for (const p of [P.PROJECT_COST_READ, P.PROJECT_COST_WRITE, P.PROJECT_COST_REVIEW, P.PROJECT_PAYMENT_RECORD]) {
    ok(allow(boss, p), `老板：${p} → 放行`);
  }
  ok(!allow(none, P.PROJECT_COST_READ), "无岗位键非成员 → 读也拒绝");
  ok(allow(none, P.PROJECT_EXPENSE_SUBMIT, "project_admin") === true, "项目角色规则不变（project_admin 可提交费用）");
}

console.log("PERM-4c1 报价引擎特权");
{
  const base = { user: { id: "u1", role: "user" }, project: { orgId: "o1", ownerId: "other" }, orgRole: "org_admin", projectRole: "project_viewer" } as never;
  const admin = resolveQuoteCapabilities(base, { financeManage: false });
  ok(!admin.privileged && !admin.canViewInternal && !admin.canApprove, "org_admin 本身不再直通");
  const boss = resolveQuoteCapabilities(base, { financeManage: true });
  ok(boss.privileged && boss.canViewInternal && boss.canEdit && boss.canApprove, "持 project.finance.manage → 直通");
  const sa = resolveQuoteCapabilities({ ...(base as object), user: { id: "u1", role: "super_admin" } } as never, { financeManage: false });
  ok(sa.privileged, "平台 super_admin → 直通");
  const platAdmin = resolveQuoteCapabilities({ ...(base as object), user: { id: "u1", role: "admin" } } as never, { financeManage: false });
  ok(!platAdmin.privileged, "平台 admin（非 super_admin）→ 不直通");
}

console.log("PERM-4c1 源码断言");
{
  const finance = files("src/app/api/projects/[id]/finance");
  const offenders = finance.filter((p) => /orgRole === "org_admin"|role === "super_admin"/.test(code(p)));
  ok(offenders.length === 0, "财务路由不再按 org_admin / 平台角色字符串判特权", offenders);
  const users = finance.filter((p) => /access\.finance\./.test(code(p)));
  ok(users.length === 5, `5 个路由改读 access.finance（实际 ${users.length}）`, users);
  const lib = code("src/lib/project-finance/access.ts");
  ok(!/org_admin/.test(lib) && /if \(access\.status !== 403\) return access;/.test(lib), "守卫不认 org_admin；非成员只在 403 时尝试结算键进入（404 / 未派发照旧）");
  ok(/project\.intakeStatus !== "dispatched"/.test(lib) && /om\.status !== "active"/.test(lib), "非成员进入要求已派发项目 + 本企业 active 成员");
  const qe = code("src/lib/quote-engine/access.ts");
  ok(!/org_admin/.test(qe) && /permission: "project\.finance\.manage"/.test(qe), "报价引擎特权改按 project.finance.manage");
  ok(!/canManageUsers/.test(code("src/lib/projects/handoff/access.ts")), "交接管理者判定不含 canManageUsers");
  ok(!/canManageUsers|canDeleteUsers/.test(code("src/lib/rbac/roles.ts")) && !/canManageUsers/.test(code("src/lib/permissions-client.ts")), "canManageUsers / canDeleteUsers 已删除");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
