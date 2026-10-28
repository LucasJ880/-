/**
 * Visualizer 企业边界纯函数测试（visualizer-org-boundary）
 * 运行：npx tsx src/lib/visualizer/__tests__/access-policy.test.ts
 *
 * 用内存 fixtures + 极小 where 求值器（只支持 AND / OR / 等值 / 关系嵌套）
 * 证明：企业 A 的任一平台角色都看不到企业 B 的可视化方案与客户。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  customerCreateAccess,
  visualizerSessionAccess,
  visualizerSessionListScope,
  type MinimalUser,
} from "../access-policy";

const ORG_A = "org_mengxin";
const ORG_B = "org_sunny";

type Row = Record<string, unknown>;

/** 极小 where 求值器：AND / OR 数组，其余 key 为等值或关系对象嵌套 */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Record<string, unknown>[]).every((w) => matches(row, w));
    if (key === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    const value = row[key];
    if (cond !== null && typeof cond === "object") {
      return value !== null && typeof value === "object" && matches(value as Row, cond as Record<string, unknown>);
    }
    return value === cond;
  });
}

const customers = {
  a1: { id: "a1", name: "梦馨客户甲", orgId: ORG_A, createdById: "a_sales1", archivedAt: null },
  a2: { id: "a2", name: "梦馨客户乙", orgId: ORG_A, createdById: "a_sales2", archivedAt: null },
  b1: { id: "b1", name: "Sunny 客户", orgId: ORG_B, createdById: "b_sales1", archivedAt: null },
};

const sessions = [
  { id: "sa1", customerId: "a1", createdById: "a_sales1", salesOwnerId: "a_sales1", customer: customers.a1 },
  { id: "sa2", customerId: "a2", createdById: "a_sales2", salesOwnerId: null, customer: customers.a2 },
  { id: "sa3", customerId: "a1", createdById: "a_sales2", salesOwnerId: "a_sales2", customer: customers.a1 },
  // 企业 B 的方案：创建人恰好与企业 A 的用户同 id，也不得因 own 规则泄露
  { id: "sb1", customerId: "b1", createdById: "b_sales1", salesOwnerId: "b_sales1", customer: customers.b1 },
  { id: "sb2", customerId: "b1", createdById: "a_boss", salesOwnerId: "a_sales1", customer: customers.b1 },
];

function list(user: MinimalUser, orgId: string, extra: Record<string, unknown> = {}): string[] {
  const where = { ...extra, ...visualizerSessionListScope(user, orgId) };
  return sessions.filter((s) => matches(s, where)).map((s) => s.id).sort();
}

const boss: MinimalUser = { id: "a_boss", role: "boss" };
const admin: MinimalUser = { id: "a_admin", role: "admin" };
const superAdmin: MinimalUser = { id: "lucas", role: "super_admin" };
const sales1: MinimalUser = { id: "a_sales1", role: "sales" };
const sales2: MinimalUser = { id: "a_sales2", role: "sales" };

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("visualizer 企业边界");

test("列表 where 对任何角色都带 customer.orgId，不再返回 null", () => {
  for (const u of [boss, admin, superAdmin, sales1]) {
    const scope = visualizerSessionListScope(u, ORG_A);
    assert.ok(scope, `${u.role} 必须有 where`);
    assert.deepEqual((scope.AND as unknown[])[0], { customer: { orgId: ORG_A } });
  }
});

test("企业 A 老板列方案：只含梦馨客户的方案", () => {
  assert.deepEqual(list(boss, ORG_A), ["sa1", "sa2", "sa3"]);
});

test("平台 admin / super_admin 以企业 A 为上下文：不含企业 B 的方案", () => {
  assert.deepEqual(list(admin, ORG_A), ["sa1", "sa2", "sa3"]);
  assert.deepEqual(list(superAdmin, ORG_A), ["sa1", "sa2", "sa3"]);
});

test("按他企业客户筛选：返回空列表", () => {
  assert.deepEqual(list(boss, ORG_A, { customerId: "b1" }), []);
  assert.deepEqual(list(superAdmin, ORG_A, { customerId: "b1" }), []);
});

test("销售只看本人创建 / 负责 / 本人客户的方案，且不跨企业", () => {
  // sb2 的 salesOwnerId = a_sales1，但属于企业 B，不得出现
  assert.deepEqual(list(sales1, ORG_A), ["sa1", "sa3"]);
  assert.deepEqual(list(sales2, ORG_A), ["sa2", "sa3"]);
});

test("跨企业单条访问：任何平台角色都是 not_found", () => {
  const sb = sessions.find((s) => s.id === "sb2")!;
  for (const u of [boss, admin, superAdmin, sales1]) {
    assert.equal(visualizerSessionAccess(sb, u, ORG_A), "not_found", `${u.role}`);
  }
});

test("企业内可见范围：老板看全部，销售看他人方案 forbidden、看本人客户的方案 ok", () => {
  const sa2 = sessions.find((s) => s.id === "sa2")!;
  const sa3 = sessions.find((s) => s.id === "sa3")!;
  assert.equal(visualizerSessionAccess(sa2, boss, ORG_A), "ok");
  assert.equal(visualizerSessionAccess(sa2, superAdmin, ORG_A), "ok");
  assert.equal(visualizerSessionAccess(sa2, sales1, ORG_A), "forbidden");
  // sa3 由 a_sales2 创建，但客户 a1 由 a_sales1 创建
  assert.equal(visualizerSessionAccess(sa3, sales1, ORG_A), "ok");
});

test("新建方案：他企业客户 404 与不存在同文案", () => {
  const cross = customerCreateAccess(customers.b1, boss, ORG_A);
  const missing = customerCreateAccess(null, boss, ORG_A);
  assert.deepEqual(cross, { ok: false, reason: "客户不存在", status: 404 });
  assert.deepEqual(missing, cross);
  assert.equal(customerCreateAccess(customers.b1, superAdmin, ORG_A).ok, false);
});

test("新建方案：同企业销售为他人客户 403，老板与本人客户通过，归档 400", () => {
  const r = customerCreateAccess(customers.a2, sales1, ORG_A);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 403);
  assert.deepEqual(customerCreateAccess(customers.a2, boss, ORG_A), { ok: true });
  assert.deepEqual(customerCreateAccess(customers.a1, sales1, ORG_A), { ok: true });
  const archived = customerCreateAccess({ ...customers.a1, archivedAt: new Date() }, boss, ORG_A);
  assert.equal(!archived.ok && archived.status, 400);
});

test("前端按当前企业为 /api/visualizer/ 带 orgId", () => {
  const src = readFileSync(join(__dirname, "../../api-fetch.ts"), "utf8");
  assert.ok(src.includes('"/api/visualizer/"'));
});

console.log(`\n${passed} passed`);
