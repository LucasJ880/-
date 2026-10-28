/**
 * PERM-4c3：平台角色压扁规划 + 兼容回退收口（纯）
 * 运行：npx tsx src/lib/authorization/__tests__/platform-role-collapse.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLLAPSIBLE_PLATFORM_ROLES,
  PLATFORM_ROLE_COLLAPSE_READY,
  RESIDUAL_ROLE_READS_DOC,
  planCollapse,
  planRestore,
  summarizeCollapse,
  type CollapseMember,
} from "../platform-role-collapse";
import { compatFallbackAllowed, compatProfileKeyForMembership } from "../resolve-effective-permissions";
import { WINDOW_COVERING_INDUSTRY_PACK } from "../role-defaults";

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

function member(userId: string, platformRole: string, extra: Partial<CollapseMember> = {}): CollapseMember {
  return { userId, email: `${userId}@x.test`, platformRole, memberStatus: "active", activeBindingCount: 1, ...extra };
}

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

console.log("platform-role-collapse（PERM-4c3）");

// ── 常量 ──
ok(COLLAPSIBLE_PLATFORM_ROLES.join(",") === "boss,manager,operations,sales,trade", "压扁范围 = boss / manager / operations / sales / trade（PERM-6c 加 trade）");
ok(PLATFORM_ROLE_COLLAPSE_READY === true, "写库闸门已打开（PERM-4c5 残留读点收口完成）");
ok(RESIDUAL_ROLE_READS_DOC === "docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md", "闸门提示指向残留清单文档");

// ── 范围 ──
{
  const plan = planCollapse({
    orgCode: "sunny",
    positionMode: true,
    members: [
      member("boss1", "boss"),
      member("mgr1", "manager"),
      member("ops1", "operations"),
      member("sales1", "sales"),
      member("trade1", "trade"),
      member("sa1", "super_admin"),
      member("adm1", "admin"),
      member("user1", "user"),
      member("gone1", "sales", { memberStatus: "inactive" }),
    ],
    otherMemberships: [],
  });
  ok(plan.blockers.length === 0, "全员有绑定、无跨企业 → 无阻断");
  ok(plan.change.map((c) => c.userId).join(",") === "boss1,mgr1,ops1,sales1,trade1", "只改五种旧角色（含 trade）");
  ok(plan.change.every((c) => c.fromRole !== "user"), "计划记录前角色");
  const skippedIds = plan.skipped.map((s) => s.userId);
  ok(["sa1", "adm1", "user1"].every((id) => skippedIds.includes(id)) && !skippedIds.includes("trade1"), "super_admin / admin / user 跳过；trade 不跳过");
  ok(plan.skipped.find((s) => s.userId === "gone1")?.reason === "非 active 成员", "非 active 成员跳过（即使是 sales）");
  const lines = summarizeCollapse(plan);
  ok(lines.some((l) => l === "压扁 sales1@x.test：sales → user"), "输出行：邮箱 前角色 → user");
  ok(lines[lines.length - 1] === "待压扁 5，跳过 4，阻断 0", "输出汇总行");
  ok(!lines.join("\n").match(/password|hash|token|postgres/i), "输出不含密码哈希 / token / 连接串");
}

// ── 幂等 ──
{
  const plan = planCollapse({
    orgCode: "sunny",
    positionMode: true,
    members: [member("a", "user"), member("b", "user"), member("c", "admin")],
    otherMemberships: [],
  });
  ok(plan.change.length === 0 && plan.blockers.length === 0, "已压扁后再跑：0 人待改、无阻断");
}

// ── 前置校验 ──
{
  const plan = planCollapse({
    orgCode: "mengxin",
    positionMode: false,
    members: [member("boss1", "boss")],
    otherMemberships: [],
  });
  ok(plan.blockers.some((b) => b.includes("不是岗位模式")), "非岗位模式企业 → 阻断");
}
{
  const plan = planCollapse({
    orgCode: "sunny",
    positionMode: true,
    members: [member("sales1", "sales", { activeBindingCount: 0 }), member("sales2", "sales")],
    otherMemberships: [],
  });
  ok(plan.blockers.length === 1 && plan.blockers[0].includes("sales1@x.test") && plan.blockers[0].includes("无 active 岗位绑定"), "缺绑定 → 阻断并列名");
  ok(plan.change.length === 2, "阻断时计划仍完整列出（整批不写由执行器负责）");
}
{
  const plan = planCollapse({
    orgCode: "sunny",
    positionMode: true,
    members: [member("boss1", "boss"), member("boss2", "boss"), member("boss3", "boss")],
    otherMemberships: [
      { userId: "boss1", orgCode: "mengxin", positionMode: false, status: "active" },
      { userId: "boss2", orgCode: "other-wc", positionMode: true, status: "active" },
      { userId: "boss3", orgCode: "mengxin", positionMode: false, status: "inactive" },
    ],
  });
  ok(plan.blockers.length === 1 && plan.blockers[0].includes("boss1@x.test") && plan.blockers[0].includes("mengxin"), "同时是旧模式企业 active 成员 → 阻断并列出企业");
  ok(!plan.blockers.some((b) => b.includes("boss2")), "另一家也是岗位模式 → 不阻断");
  ok(!plan.blockers.some((b) => b.includes("boss3")), "旧模式企业成员关系非 active → 不阻断");
}
{
  const plan = planCollapse({
    orgCode: "sunny",
    positionMode: true,
    members: [member("adm1", "admin", { activeBindingCount: 0 }), member("u1", "user", { activeBindingCount: 0 })],
    otherMemberships: [{ userId: "adm1", orgCode: "mengxin", positionMode: false, status: "active" }],
  });
  ok(plan.blockers.length === 0, "不在压扁范围的人不参与前置校验");
}
{
  // PERM-6c：trade 纳入压扁后同样走前置校验（缺绑定 / 同时是旧模式企业成员）
  const plan = planCollapse({
    orgCode: "sunny",
    positionMode: true,
    members: [member("trade1", "trade", { activeBindingCount: 0 }), member("trade2", "trade")],
    otherMemberships: [{ userId: "trade2", orgCode: "mengxin", positionMode: false, status: "active" }],
  });
  ok(plan.blockers.some((b) => b.includes("trade1")) && plan.blockers.some((b) => b.includes("trade2") && b.includes("mengxin")), "外贸成员缺绑定 / 同时在梦馨 → 阻断");
}

// ── 还原计划 ──
{
  const t = (s: number) => new Date(Date.UTC(2026, 9, 28, 0, 0, s));
  const plan = planRestore({
    records: [
      { userId: "a", email: "a@x.test", fromRole: "sales", createdAt: t(1) },
      { userId: "a", email: "a@x.test", fromRole: "boss", createdAt: t(5) },
      { userId: "b", email: "b@x.test", fromRole: "operations", createdAt: t(2) },
      { userId: "c", email: "c@x.test", fromRole: "sales", createdAt: t(3) },
    ],
    currentRoles: { a: "user", b: "trade" },
  });
  ok(plan.restore.length === 1 && plan.restore[0].userId === "a" && plan.restore[0].toRole === "boss", "每人取最新一条压扁记录还原");
  ok(plan.skipped.some((s) => s.userId === "b" && s.role === "trade"), "当前不是 user → 跳过");
  ok(plan.skipped.some((s) => s.userId === "c"), "用户不存在 → 跳过");
}

// ── 兼容回退收口 ──
ok(!compatFallbackAllowed(WINDOW_COVERING_INDUSTRY_PACK), "窗饰（岗位模式）企业：不做兼容回退");
ok(compatFallbackAllowed(null), "无行业包企业：照旧兼容回退");
ok(compatFallbackAllowed("unknown_pack"), "未登记行业包：照旧兼容回退");
ok(compatProfileKeyForMembership({ orgRole: "org_owner", platformRole: "boss" }) === "org_owner", "旧模式映射本身不变（org_owner → org_owner）");
{
  const s = src("src/lib/authorization/resolve-effective-permissions.ts");
  const fallbackAt = s.indexOf("compatProfileKeyForMembership({\n    orgRole: member.role");
  const gateAt = s.indexOf("if (!compatFallbackAllowed(org?.industryPackId)) return [];");
  const saAt = s.indexOf('if (user?.role === "super_admin")');
  const deAt = s.indexOf('if (principal.type === "DIGITAL_EMPLOYEE")');
  ok(gateAt > 0 && fallbackAt > gateAt, "resolveEffectiveBindings：兼容回退前先判岗位模式");
  ok(saAt > 0 && saAt < gateAt, "super_admin 全权在收口之前（不受影响）");
  ok(deAt > 0 && deAt < gateAt, "数字员工路径在收口之前（不受影响）");
}

// ── 脚本源码 ──
{
  const script = src("scripts/collapse-platform-roles.ts");
  const run = src("src/lib/authorization/platform-role-collapse-run.ts");
  const envAt = script.indexOf('process.env.ALLOW_ROLE_COLLAPSE !== "true"');
  const importAt = script.indexOf('await import("@/lib/authorization/platform-role-collapse-run")');
  ok(envAt > 0 && importAt > envAt, "脚本：ALLOW_ROLE_COLLAPSE 闸在连库之前");
  ok(script.includes("ready: PLATFORM_ROLE_COLLAPSE_READY"), "脚本：写库闸门取代码常量（无命令行绕过）");
  ok(!/--force|--ack/.test(script), "脚本：无 --force / --ack 绕过参数");
  ok(run.includes('actor.role !== "super_admin"'), "执行器：执行者必须是 super_admin");
  const restoreAt = run.indexOf("if (input.restore) return restore(");
  const gateAt = run.indexOf("if (!input.ready)");
  const blockAt = run.indexOf("if (plan.blockers.length > 0)");
  const dryAt = run.indexOf("if (input.dryRun) return { exitCode: 0, lines };");
  ok(restoreAt > 0 && gateAt > restoreAt, "执行器：--restore 不受写库闸门限制");
  ok(blockAt > 0 && dryAt > blockAt && gateAt > dryAt, "执行器：先前置校验，再 dry-run 返回，最后才看闸门");
  ok(run.includes("db.$transaction"), "执行器：整批写入在一个事务内");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
