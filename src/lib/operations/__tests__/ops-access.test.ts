/**
 * PERM-4b：运营 / 增长中心 / 平台用户管理权限（不连库）
 *   自批决策表 + 路由源码断言（无平台角色判定、权限函数均 await、判定落在 orgRes 之后）
 * 运行：npx tsx src/lib/operations/__tests__/ops-access.test.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { selfApprovalBlocked } from "../access";

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
function routes(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") out.push(relative(ROOT, p));
    }
  };
  walk(join(ROOT, dir));
  return out.sort();
}

console.log("PERM-4b 自批决策表");
ok(selfApprovalBlocked({ actorId: "marty", authorId: "marty", isPlatformSuperAdmin: false }), "创建人 / 提交人自批 → 拦");
ok(!selfApprovalBlocked({ actorId: "boss", authorId: "marty", isPlatformSuperAdmin: false }), "他人批 → 放");
ok(!selfApprovalBlocked({ actorId: "lucas", authorId: "lucas", isPlatformSuperAdmin: true }), "平台 super_admin 自批 → 放（唯一例外）");
ok(!selfApprovalBlocked({ actorId: "marty", authorId: null, isPlatformSuperAdmin: false }), "作者未知 → 放");

console.log("PERM-4b 路由源码：不再按平台角色");
{
  const ops = routes("src/app/api/operations").filter((p) => !p.includes("/worker/"));
  // isPlatformSuperAdmin(user.role) 是合法的平台管理员标记，其余带 user.role 的判定都不该出现
  const offenders = ops.filter((p) => /canManageUsers\(|isBoss\(|role === "(operations|manager|boss)"|(?<!isPlatformSuperAdmin)\(user\.role\)/.test(read(p)));
  ok(offenders.length === 0, "src/app/api/operations 无 canManageUsers / isBoss / 平台角色字符串判定", offenders);
  const api = routes("src/app/api").filter((p) => /canManageUsers\(/.test(read(p)));
  ok(api.length === 0, "src/app/api 无 canManageUsers(", api);
  for (const lib of ["src/lib/operations/playbook/permissions.ts", "src/lib/operations/service.ts", "src/lib/marketing/access-policy.ts"]) {
    ok(!/isBoss\(|isAdmin\(|role === "(operations|manager|boss)"/.test(read(lib)), `${lib} 无平台角色判定`);
  }
}

console.log("PERM-4b 路由源码：权限函数均被 await、在企业解析之后判定");
{
  const asyncFns = /\b(canReadPlaybook|canEditPlaybookDraft|canSubmitPlaybook|canApprovePlaybook|assertCanApprovePlaybook|canApprovePublishJob|requireOpsPermission|holdsOpsPermission|canEditMarketingBrandProfile)\(/g;
  const bad: string[] = [];
  for (const p of [...routes("src/app/api/operations"), "src/lib/marketing/access.ts"]) {
    const src = read(p);
    for (const m of src.matchAll(asyncFns)) {
      const before = src.slice(Math.max(0, (m.index ?? 0) - 12), m.index);
      const isImportOrDef = /import|export|function/.test(src.slice(Math.max(0, src.lastIndexOf("\n", m.index ?? 0)), m.index));
      if (!isImportOrDef && !/await\s*\(?\s*!?\s*\(?\s*$/.test(before)) bad.push(`${p}: ${m[1]}`);
    }
  }
  ok(bad.length === 0, "所有异步权限判定都有 await（漏 await 会把 Promise 当真值放行）", bad);

  const gated = routes("src/app/api/operations").filter((p) => /requireOpsPermission\(|(?:Playbook|PlaybookDraft)\(user, orgRes\.orgId\)|assertCanApprovePlaybook\(\{|canApprovePublishJob\(user, orgRes\.orgId\)/.test(read(p)));
  const orderBad = gated.filter((p) => {
    const src = read(p);
    const firstGate = src.search(/requireOpsPermission\(user|(?:Playbook|PlaybookDraft)\(user, orgRes|assertCanApprovePlaybook\(\{|canApprovePublishJob\(user, orgRes/);
    const firstOrg = src.indexOf("if (!orgRes.ok) return orgRes.response;");
    return firstOrg < 0 || firstGate < firstOrg;
  });
  ok(gated.length === 27, `受判定的运营路由 = 27：配置 12 + Playbook 12 + 发布任务 3（实际 ${gated.length}）`, gated);
  ok(orderBad.length === 0, "判定都在 orgRes 解析之后（按当前企业判权限）", orderBad);
}

console.log("PERM-4b 关键路由的键");
{
  const tp = read("src/app/api/operations/tender-profile/route.ts");
  ok(/\[\.\.\.OPS_READ_KEYS, "project\.read"\]/.test(tp) && /\[OPS_MANAGE, "project\.update"\]/.test(tp), "投标档案：读 运营 | 招投标，写 运营管理 | 招投标");
  const cp = read("src/app/api/operations/content-plan/[id]/route.ts");
  ok(/body\.status === "approved" \? OPS_CONTENT_APPROVE : OPS_CONTENT_DRAFT/.test(cp), "选题：改为已通过要批准键，其余要起草键");
  const disp = read("src/app/api/operations/content-plan/[id]/dispatch/route.ts");
  const fan = read("src/app/api/operations/video-assets/[id]/fanout/route.ts");
  ok(/OPS_MANAGE/.test(disp) && /OPS_MANAGE/.test(fan), "派发 / 扇出要运营管理权");
  const pjReject = read("src/app/api/operations/publish-jobs/[id]/reject/route.ts");
  ok(!/selfApproval/.test(pjReject), "驳回不做自批判定（可撤自己的）");
  const svc = read("src/lib/operations/service.ts");
  ok(/selfApprovalBlocked\(\{ actorId: opts\.actorUserId, authorId: job\.createdById/.test(svc) && /code: "SELF_APPROVAL"/.test(svc), "发布任务批准：创建人不得自批（无 Boss 例外）");
  const ws = read("src/lib/rbac/workspace-policy.ts");
  const fn = ws.slice(ws.indexOf("export function canAccessOperationsWorkspace"), ws.indexOf("export function canAccessBidWorkspace"));
  ok(!/isOperationsStaff/.test(fn), "/ops 入口不再认平台角色 operations");
  for (const p of ["src/app/api/ops/home/route.ts", "src/app/api/ops/projects/[id]/route.ts"]) {
    ok(/permissionKeys: await loadPermissionKeys\(/.test(read(p)), `${p} 注入权限键`);
  }
  const users = read("src/app/api/users/route.ts") + read("src/app/api/users/[id]/route.ts");
  ok(!/canManageUsers|canDeleteUsers/.test(users) && (users.match(/isPlatformSuperAdmin\(/g) ?? []).length >= 4, "平台用户管理只认 super_admin");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
