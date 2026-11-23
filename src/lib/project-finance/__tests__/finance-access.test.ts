/**
 * PERM-4c1：项目财务 / 报价引擎按岗位（不连库）
 *   财务能力决策表、细粒度权限放行表、报价引擎特权、源码断言（路由不再认 org_admin、canManageUsers 已删）
 * CHAIN-2e：报价引擎看内部数字只认财务查看权（项目角色用真实名字）；resolveFinanceViewSafe 的兜底
 * 运行：npx tsx src/lib/project-finance/__tests__/finance-access.test.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { allowCostPermission, decideFinancePrivilege, resolveFinanceViewSafe, type FinancePrivilege } from "../access";
import type { AuthUser } from "@/lib/auth";
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

console.log("PERM-4c1 / CHAIN-2e 报价引擎特权（看内部数字只认财务查看权；编辑 / 批准要求先能看）");
{
  const fin = (o: Partial<Parameters<typeof decideFinancePrivilege>[0]> = {}): FinancePrivilege =>
    decideFinancePrivilege({ isPlatformSuperAdmin: false, isProjectOwner: false, holdsManage: false, holdsRead: false, ...o });
  const base = { user: { id: "u1", role: "user" }, project: { orgId: "o1", ownerId: "other" }, orgRole: "org_admin", projectRole: "viewer" };
  const caps = (projectRole: string | null, finance: FinancePrivilege) => resolveQuoteCapabilities({ ...base, projectRole } as never, { finance });
  const admin = caps("viewer", fin());
  ok(!admin.privileged && !admin.canViewInternal && !admin.canEdit && !admin.canApprove, "org_admin + 项目角色 viewer、没有财务键 → 不直通、看不到内部数字");
  for (const role of ["viewer", "tester", "operator", "project_admin", "accounting"]) {
    const c = caps(role, fin());
    ok(!c.privileged && !c.canViewInternal && !c.canEdit && !c.canApprove, `项目角色 ${role}（带 project:cost:read）、没有财务键 → 看不到内部数字、不能编辑 / 批准`, c);
  }
  const boss = caps("viewer", fin({ holdsManage: true }));
  ok(boss.privileged && boss.canViewInternal && boss.canEdit && boss.canApprove, "持 project.finance.manage（老板）→ 直通");
  const sa = caps("viewer", fin({ isPlatformSuperAdmin: true }));
  ok(sa.privileged && sa.canViewInternal && sa.canEdit && sa.canApprove, "平台 super_admin → 直通");
  const owner = caps("viewer", fin({ isProjectOwner: true }));
  ok(owner.privileged && owner.canViewInternal && owner.canEdit && owner.canApprove, "项目负责人 → 直通（与项目角色无关）");
  const accViewer = caps("viewer", fin({ holdsRead: true }));
  ok(!accViewer.privileged && accViewer.canViewInternal && !accViewer.canEdit && !accViewer.canApprove, "会计岗位（组织范围 project.finance.read）+ viewer → 只读内部数字", accViewer);
  const accOperator = caps("operator", fin({ holdsRead: true }));
  ok(accOperator.canViewInternal && accOperator.canEdit && !accOperator.canApprove, "会计岗位 + operator → 能看能编辑，不能批准（编辑 / 批准另按项目角色）", accOperator);
  const accAccounting = caps("accounting", fin({ holdsRead: true }));
  ok(accAccounting.canViewInternal && accAccounting.canEdit && accAccounting.canApprove, "会计岗位 + 项目角色 accounting → 能批准", accAccounting);
  const accNonMember = caps(null, fin({ holdsRead: true }));
  ok(accNonMember.canViewInternal && !accNonMember.canEdit && !accNonMember.canApprove, "会计岗位、没有项目角色 → 只读内部数字");
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
  ok(!/org_admin/.test(qe) && /resolveFinanceViewSafe\(access\.user, orgId, access\.project\.ownerId\)/.test(qe) && !/PROJECT_COST_READ/.test(qe), "报价引擎按财务查看权（resolveFinanceViewSafe，与成本核算同一判定）；不再认项目角色的 project:cost:read");
  ok(!/canManageUsers/.test(code("src/lib/projects/handoff/access.ts")), "交接管理者判定不含 canManageUsers");
  ok(!/canManageUsers|canDeleteUsers/.test(code("src/lib/rbac/roles.ts")) && !/canManageUsers/.test(code("src/lib/permissions-client.ts")), "canManageUsers / canDeleteUsers 已删除");
}

async function fallbackCases() {
  console.log("CHAIN-2e 财务查看权兜底（resolveFinanceViewSafe）");
  const user = (id: string, role = "user") => ({ id, role, email: `${id}@fixture.test`, name: id }) as unknown as AuthUser;
  const throwing = async (): Promise<FinancePrivilege> => {
    throw new Error("authorize down");
  };
  const warns: unknown[][] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => {
    warns.push(a);
  };
  try {
    const owner = await resolveFinanceViewSafe(user("u1"), "o1", "u1", throwing);
    ok(owner.privileged && owner.canReadAll, "授权查询抛错：项目负责人照旧有特权");
    const acc = await resolveFinanceViewSafe(user("u2"), "o1", "u1", throwing);
    ok(!acc.privileged && !acc.canReadAll, "授权查询抛错：持组织键的人（会计）按不持键算 → 看不到");
    const sa = await resolveFinanceViewSafe(user("u3", "super_admin"), "o1", "u1", throwing);
    ok(sa.privileged && sa.canReadAll, "授权查询抛错：平台超级管理员照旧");
    const platAdmin = await resolveFinanceViewSafe(user("u4", "admin"), "o1", "u1", throwing);
    ok(!platAdmin.privileged && !platAdmin.canReadAll, "平台 admin（非 super_admin）→ 不直通");
    ok(warns.length === 4 && warns.every((w) => String(w[0]).startsWith("[finance-view]") && w[1] === "authorize down" && w.length === 2), "每次抛错记一条警告，只含原因", warns);
  } finally {
    console.warn = origWarn;
  }
  const passthrough = await resolveFinanceViewSafe(user("u2"), "o1", "u1", async () => ({ privileged: false, canReadAll: true }));
  ok(!passthrough.privileged && passthrough.canReadAll, "不抛错时原样用判定结果（会计只读）");
  let called = false;
  const noOrg = await resolveFinanceViewSafe(user("u1"), null, "u1", async () => {
    called = true;
    return { privileged: false, canReadAll: false };
  });
  ok(noOrg.privileged && !called, "项目没有组织：不调判定，只剩超级管理员与负责人");
  const noOrgOther = await resolveFinanceViewSafe(user("u2"), null, "u1");
  ok(!noOrgOther.canReadAll, "项目没有组织、不是负责人 → 看不到");
}

fallbackCases()
  .catch((e) => {
    fail++;
    console.error(e);
  })
  .finally(() => {
    console.log(`\n结果: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
  });
