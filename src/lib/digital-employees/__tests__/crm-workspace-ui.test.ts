import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("客户列表同时保留手机卡片与桌面表格数字员工信号", () => {
  const customerList = source("src/app/(main)/sales/customer-list.tsx");
  assert.match(customerList, /md:hidden/);
  assert.match(customerList, /hidden max-w-full[\s\S]*md:block/);
  assert.match(customerList, /DigitalEmployeeBadge/);
  assert.match(customerList, /findPotentialDuplicateCustomerIds/);
});

test("商机看板显示数字员工风险和下一步", () => {
  const pipeline = source("src/app/(main)/sales/pipeline-board.tsx");
  assert.match(pipeline, /数字员工 ·/);
  assert.match(pipeline, /下一步：/);
  assert.match(pipeline, /reviewCrmRecord/);
});

test("客户详情接入可执行的数字员工面板", () => {
  const detail = source("src/app/(main)/sales/customers/[id]/page.tsx");
  const panel = source("src/app/(main)/sales/customers/[id]/digital-employee-panel.tsx");
  assert.match(detail, /CustomerDigitalEmployeePanel/);
  assert.match(detail, /onRecordFollowup/);
  assert.match(detail, /onCreateQuote/);
  assert.match(panel, /发邮件、改商机状态仍由销售确认/);
  assert.match(panel, /sales\/calendar\?new=1/);
});
