import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("归档客户从报价、商机和行动接口中排除", () => {
  for (const relativePath of [
    "src/app/api/sales/quotes/list/route.ts",
    "src/app/api/sales/opportunities/route.ts",
    "src/app/api/sales/opportunities/health-batch/route.ts",
    "src/app/api/sales/actions/route.ts",
  ]) {
    assert.match(
      source(relativePath),
      /customer:\s*\{\s*archivedAt:\s*null\s*\}/,
      `${relativePath} 必须过滤归档客户`,
    );
  }
});

test("销售首页和数字员工扫描不统计归档客户", () => {
  const home = source("src/lib/sales/home/build-home.ts");
  assert.match(home, /activeCustomer\s*=\s*\{\s*customer:\s*\{\s*archivedAt:\s*null/);
  assert.match(home, /activeCustomerOrg\s*=\s*\{\s*customer:\s*\{\s*orgId,\s*archivedAt:\s*null/);

  const secretary = source("src/lib/secretary/domains/sales.ts");
  assert.match(secretary, /customer:\s*\{\s*archivedAt:\s*null\s*\}/);

  const sync = source("src/lib/sales/auto-action-sync.ts");
  assert.match(sync, /customer:\s*\{\s*archivedAt:\s*null\s*\}/);
});

test("归档客户时自动收口未完成的数字员工行动", () => {
  const archiveRoute = source("src/app/api/sales/customers/[id]/route.ts");
  assert.match(archiveRoute, /db\.\$transaction\(/);
  assert.match(archiveRoute, /status:\s*"auto_resolved"/);
  assert.match(archiveRoute, /activeKey:\s*null/);
});
