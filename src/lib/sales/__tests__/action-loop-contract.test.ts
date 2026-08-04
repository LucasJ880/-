import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("销售行动模型具备组织边界、活动去重与闭环字段", () => {
  const schema = source("prisma/schema.prisma");
  assert.match(schema, /model SalesAction/);
  assert.match(schema, /orgId\s+String/);
  assert.match(schema, /activeKey\s+String\?\s+@unique/);
  assert.match(schema, /resolutionNote\s+String\?/);
  assert.match(schema, /dismissedReason\s+String\?/);
  assert.match(schema, /@@index\(\[orgId, status, dueAt\]\)/);
});

test("行动接口从当前销售组织解析范围并写审计日志", () => {
  const collection = source("src/app/api/sales/actions/route.ts");
  const detail = source("src/app/api/sales/actions/[id]/route.ts");
  for (const route of [collection, detail]) {
    assert.match(route, /resolveSalesOrgIdForRequest/);
    assert.match(route, /orgId: orgRes\.orgId/);
    assert.match(route, /AUDIT_TARGETS\.SALES_ACTION/);
  }
  assert.match(detail, /已结束的行动不能重新打开/);
  assert.match(detail, /只有销售经理可以把行动分配给其他成员/);
  assert.match(detail, /完成行动前，请先在客户互动中设置未来的下次跟进时间/);
});

test("客户建议可进入行动队列且首页提供处理结果入口", () => {
  const customerPanel = source("src/app/(main)/sales/customers/[id]/digital-employee-panel.tsx");
  const actionPanel = source("src/app/(main)/sales/sales-action-loop-panel.tsx");
  const interaction = source("src/app/(main)/sales/customers/[id]/add-interaction-dialog.tsx");
  assert.match(customerPanel, /加入行动队列/);
  assert.match(actionPanel, /开始处理/);
  assert.match(actionPanel, /填写处理结果/);
  assert.match(actionPanel, /填写忽略原因/);
  assert.match(actionPanel, /行动负责人/);
  assert.match(interaction, /下次跟进时间/);
});
