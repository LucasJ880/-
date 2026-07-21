/**
 * 跨租户隔离断言（纯逻辑：模拟实体 org 边界）
 * 运行：npx tsx src/lib/tenancy/__tests__/tenant-isolation.test.ts
 */

import {
  assertEntityBelongsToOrg,
  entityBelongsToOrg,
  TenantAccessError,
} from "../assert";

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

const SUNNY = "org_sunny";
const MENGXIN = "org_mengxin";

type FakeCustomer = { id: string; orgId: string; name: string };

const sunnyCustomer: FakeCustomer = {
  id: "cust_sunny_1",
  orgId: SUNNY,
  name: "Sunny Client",
};
const mengxinCustomer: FakeCustomer = {
  id: "cust_mx_1",
  orgId: MENGXIN,
  name: "Mengxin Buyer",
};

function readCustomerAs(
  actorOrgId: string,
  customer: FakeCustomer,
): FakeCustomer | null {
  if (!entityBelongsToOrg(customer.orgId, actorOrgId)) return null;
  return customer;
}

function mutateCustomerAs(actorOrgId: string, customer: FakeCustomer): boolean {
  try {
    assertEntityBelongsToOrg(customer.orgId, actorOrgId);
    return true;
  } catch (e) {
    return !(e instanceof TenantAccessError);
  }
}

console.log("tenant isolation");

ok(
  readCustomerAs(SUNNY, sunnyCustomer)?.name === "Sunny Client",
  "Sunny 用户可读 Sunny 客户",
);
ok(
  readCustomerAs(SUNNY, mengxinCustomer) === null,
  "Sunny 用户不可读梦馨客户",
);
ok(
  readCustomerAs(MENGXIN, sunnyCustomer) === null,
  "梦馨用户不可读 Sunny 客户",
);
ok(
  readCustomerAs(MENGXIN, mengxinCustomer)?.id === "cust_mx_1",
  "梦馨用户可读梦馨客户",
);

ok(mutateCustomerAs(SUNNY, sunnyCustomer), "Sunny 可改自家客户");
ok(!mutateCustomerAs(SUNNY, mengxinCustomer), "Sunny 不可改梦馨客户（伪造 ID）");
ok(!mutateCustomerAs(MENGXIN, sunnyCustomer), "梦馨不可改 Sunny 客户");

// 伪造 URL 资源 ID：仅知道 id 不够，必须 org 匹配
const forgedId = mengxinCustomer.id;
ok(
  readCustomerAs(SUNNY, { ...mengxinCustomer, id: forgedId }) === null,
  "仅知道他企资源 ID 仍不可读",
);

console.log(`\ntenant-isolation: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
