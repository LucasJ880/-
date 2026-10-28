/**
 * PERM-7：岗位绑定界面（纯：完整集合差异 / 最后一个 owner 护栏 / 数字员工四岗 / 守卫与接入点源码断言）
 * 运行：npx tsx src/lib/authorization/__tests__/position-binding-console.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OWNER_POSITION_KEY,
  planBindingDiff,
  validateDigitalEmployeeBindings,
  wouldRemoveLastOwnerBinding,
  type BindingPlan,
} from "../position-binding";
import { DIGITAL_EMPLOYEE_POSITION_KEYS } from "../digital-employee";

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

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const keys = (items: Array<{ profileKey: string }>) => items.map((x) => x.profileKey).sort().join(",");
const ALL = ["org_owner", "org_admin", "sales_rep", "trade_rep", "owner", "ops_staff", "bids"];
const plan = (desired: string[], have: string[], status = "active") =>
  planBindingDiff({
    desired: [{ email: "a@x.test", userId: "u1", keys: desired }],
    existing: have.map((k) => ({ userId: "u1", profileKey: k, status })),
    prune: true,
    prunableKeys: ALL,
  });

console.log("position-binding-console（PERM-7）");

// ── 完整集合差异（界面语义：集合外的 active 绑定都停用，含系统模板） ──
{
  const add = plan(["ops_staff"], []);
  ok(keys(add.create) === "ops_staff" && add.deactivate.length === 0, "加岗位：新建 ops_staff");
  const swap = plan(["ops_staff"], ["sales_rep"]);
  ok(keys(swap.create) === "ops_staff" && keys(swap.deactivate) === "sales_rep", "换岗位：新建 ops_staff、停用 sales_rep");
  const clear = plan([], ["owner", "org_owner"]);
  ok(clear.create.length === 0 && keys(clear.deactivate) === "org_owner,owner", "清空：停用全部（含系统模板 org_owner）");
  const same = plan(["owner", "bids"], ["owner", "bids"]);
  ok(same.create.length === 0 && same.deactivate.length === 0 && keys(same.keep) === "bids,owner", "无变化：全部保留");
  const revive = plan(["sales_rep"], ["sales_rep"], "inactive");
  ok(keys(revive.create) === "sales_rep", "inactive 的岗位重新勾选 → 计划新增（执行时重新启用旧行）");
  const other = planBindingDiff({
    desired: [{ email: "a@x.test", userId: "u1", keys: ["ops_staff"] }],
    existing: [{ userId: "u2", profileKey: "owner", status: "active" }],
    prune: true,
    prunableKeys: ALL,
  });
  ok(other.deactivate.length === 0, "只动目标主体，不碰其他人的绑定");
}

// ── 最后一个 owner 护栏 ──
{
  const drop: BindingPlan = { create: [], keep: [], deactivate: [{ email: "a", userId: "u1", profileKey: OWNER_POSITION_KEY }] };
  const keep: BindingPlan = { create: [], keep: [{ email: "a", userId: "u1", profileKey: OWNER_POSITION_KEY }], deactivate: [] };
  ok(wouldRemoveLastOwnerBinding({ positionMode: true, principalType: "HUMAN", plan: drop, otherActiveOwnerCount: 0 }), "岗位模式停用唯一老板 → 拦");
  ok(!wouldRemoveLastOwnerBinding({ positionMode: true, principalType: "HUMAN", plan: drop, otherActiveOwnerCount: 1 }), "还有其他老板 → 放行");
  ok(!wouldRemoveLastOwnerBinding({ positionMode: true, principalType: "HUMAN", plan: keep, otherActiveOwnerCount: 0 }), "没停 owner → 放行");
  ok(!wouldRemoveLastOwnerBinding({ positionMode: false, principalType: "HUMAN", plan: drop, otherActiveOwnerCount: 0 }), "旧模式企业不适用");
  ok(!wouldRemoveLastOwnerBinding({ positionMode: true, principalType: "DIGITAL_EMPLOYEE", plan: drop, otherActiveOwnerCount: 0 }), "数字员工不参与");
}

// ── 数字员工四岗（界面合成单主体绑定文件，沿用脚本校验） ──
{
  const v = (k: string[]) =>
    validateDigitalEmployeeBindings({
      file: { bindings: { ag1: k } },
      orgId: "org1",
      knownProfileKeys: ALL,
      allowedPositionKeys: DIGITAL_EMPLOYEE_POSITION_KEYS,
      agentsById: { ag1: { id: "ag1", name: "销售助手", status: "active", orgId: "org1" } },
    });
  const bad = v(["owner"]);
  ok(!bad.ok && bad.errors.some((e) => e.includes("只允许")), "数字员工绑 owner → 拒绝并说明只允许四岗");
  ok(v(["sales_rep"]).ok, "数字员工绑 sales_rep → 通过");
}

// ── 守卫与接入点 ──
{
  const guards = src("src/lib/auth/guards.ts");
  const at = guards.indexOf("export async function requirePlatformSuperAdmin(");
  ok(at > 0 && guards.slice(at, guards.indexOf("\n}\n", at)).includes("isPlatformSuperAdmin(result.user.role)"), "requirePlatformSuperAdmin 只认 super_admin");

  const route = src("src/app/api/organizations/[orgId]/positions/route.ts");
  for (const m of ["GET", "PUT"]) {
    const i = route.indexOf(`export async function ${m}(`);
    ok(i > 0 && route.slice(i, i + 200).includes("await requirePlatformSuperAdmin(request)"), `positions ${m}：只认 super_admin`);
  }
  ok(route.includes("prune: true,") && route.includes("prunableKeys: knownProfileKeys,"), "PUT 按完整集合算差异");
  ok(route.includes('via: "console"'), "界面写入审计来源 console");
  ok(route.includes('code: "LAST_OWNER_BINDING"') && route.includes("status: 409"), "最后一个 owner → 409");
  ok(route.includes("if (body?.dryRun === true) return NextResponse.json({ plan, dryRun: true });"), "dryRun 在写入前返回");
  ok(route.indexOf("wouldRemoveLastOwnerBinding(") < route.indexOf("body?.dryRun === true"), "护栏在 dryRun 之前（预览也会提示）");

  const members = src("src/app/api/organizations/[orgId]/members/route.ts");
  const member = src("src/app/api/organizations/[orgId]/members/[memberId]/route.ts");
  ok(!members.includes("requirePlatformAdmin(") && !member.includes("requirePlatformAdmin("), "成员接口不再用 requirePlatformAdmin（会放行平台 admin）");
  ok((members.match(/await requirePlatformSuperAdmin\(request\)/g) ?? []).length === 1, "成员 POST 只认 super_admin");
  ok((member.match(/await requirePlatformSuperAdmin\(request\)/g) ?? []).length === 2, "成员 PATCH / DELETE 只认 super_admin");
  const getAt = members.indexOf("export async function GET(");
  ok(members.slice(getAt, members.indexOf("export async function POST(")).includes("await requireAuth(request)"), "成员列表 GET 读取规则不变");

  const page = src("src/app/(main)/organizations/[orgId]/page.tsx");
  ok(page.includes("const canManageMembers = isPlatformSuperAdmin(platformRole);"), "页面：成员管理只对 super_admin");
  ok(page.includes("{canManageMembers && <PositionsSection orgId={orgId} />}"), "页面：岗位一节只对 super_admin 渲染");
  const membersSection = page.slice(page.indexOf('<h2 className="text-sm font-semibold">成员</h2>'));
  ok(!membersSection.includes("canManageOrg"), "页面：成员编辑控件不再按 org_admin 显示");

  const script = src("scripts/bind-positions.ts");
  ok(script.includes("await executeBindingPlan({") && script.includes('via: "scripts/bind-positions.ts",'), "脚本改调共用服务，审计来源不变");
  ok(!script.includes("principalRoleBinding.create(") && !script.includes("logAuthorizationChange("), "脚本不再自己写库 / 审计");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
