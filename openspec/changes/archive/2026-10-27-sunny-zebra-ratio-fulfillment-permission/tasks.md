# Tasks

## 1. 实现

- [x] 1.1 `zebra-ratios/route.ts` 的保存判定改为：平台管理员 ∨ org_admin 及以上 ∨ `authorize(orders.fulfillment.update)`；GET 的 `canEdit` 同一函数。verify：`npm run typecheck` 0 错。
- [x] 1.2 页面只读提示改为"需要出单岗位或组织管理员"；403 文案同步。verify：`grep -n "出单" src/app/(main)/blinds-orders/zebra-ratios/page.tsx src/app/api/sunny-process/zebra-ratios/route.ts` 命中。
- [x] 1.3 种子 SC-ZD-XZ74-1 备注改为拍板记录（数值不变），`zebra-ratios.test.ts` 断言同步。verify：测试退出 0。

## 2. 验证与收尾

- [x] 2.1 隔离库 [5b]：建出单岗位成员与无岗位成员，断言 200 / 403 与 `canEdit`。verify：`autogen-db.isolated.test.ts` 退出 0。
- [x] 2.2 报告 / 交接文档写明新权限。verify：`openspec validate sunny-zebra-ratio-fulfillment-permission --strict` 通过；`bash scripts/check-test-registry.sh` 退出 0。

## 实施记录（2026-10-27）

- `zebra-ratios.test.ts` 23/0；隔离库 `autogen-db.isolated.test.ts` 37/0（[5b] 新增：未绑岗位 403、绑定「出单·Roller/Zebra/Roman」后 canEdit = true 且 PUT 200、org_owner 仍可编辑）。
- 变异：去掉 `orders.fulfillment.update` 判定 → 隔离库 3 项失败（已恢复）。
