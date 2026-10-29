# Tasks

## 1. 权限与口径

- [x] 1.1 `permissions.ts` 新增 `install.balance.confirm`（"确认收到尾款"，HIGH，`["ORG"]`）并加入数字员工禁区；`role-defaults.ts`：`accounting`、`owner` 追加（ORG）；`authorize.test.ts` 加登记、两岗快照、其他岗不含、数字员工绑 accounting 仍拒绝。verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 0 失败。
- [x] 1.2 新建 `src/lib/install/balance.ts`（纯）：`quoteBalanceDue`（D3）、确认入参校验与差额判定（D9 / D10）、确认记录解析、`installNotificationHref`（D6）；新建 `src/lib/install/__tests__/balance.test.ts` 覆盖 spec「应收尾款口径」「确认收到尾款」校验、「差额必须说明」「通知落点」，同 task 注册 `scripts/test-all.sh`。verify：`npx tsx src/lib/install/__tests__/balance.test.ts` 0 失败。

## 2. 服务、接口与通知

- [x] 2.1 新建 `src/lib/install/balance-service.ts`（批量查关联报价 D4、确认记录、待收尾款行）与 `GET /api/accounting/balance`、`POST /api/accounting/balance/{orderId}/confirm`（ORG 键判定、企业归属 404、`NOT_INSTALLED` 409、advisory lock D7、`writeAuditLog(tx)` + `applyOrderTransition` 仅 installed 时、幂等、事务后通知销售 D8）；`api-fetch` 前缀如需登记一并加。verify：typecheck 0 error；隔离库用例（task 3.2）。
- [x] 2.2 `/complete` 首次成功后通知持 `install.balance.confirm` 者（`entityType=install_balance`）与工艺单创建人（`entityType=blinds_order`），类型 `install_completed`；`install_balance_confirmed` 同样登记；`NOTIFICATION_TYPE_KEYS` + `TYPE_INTRODUCED_AT` + 通知类型开关文案 / 图标；`header.tsx` 与 `notifications/page.tsx` 先调 `installNotificationHref`。verify：typecheck；`grep -n "installNotificationHref" src/components/header.tsx "src/app/(main)/notifications/page.tsx"` 各 1 处；隔离库用例。
- [x] 2.3 `build-home.ts` 销售首页"待收尾款"改为本月签约报价逐单 `quoteBalanceDue` 之和并剔除关联工艺单已确认的报价。verify：既有 `src/lib/sales/home` 相关已注册测试通过；隔离库用例。

## 3. 页面与端到端

- [x] 3.1 `accounting-view.tsx`：新增"待收尾款"页签（接口 403 不显示；不显示月份选择）；页签读写 URL `tab`，`order` 参数展开并高亮该行；行展开调 `/api/install/tasks/{appointmentId}` 显示收口缩略图；"确认收到尾款"对话框（实收预填应收、方式四选一、日期默认今天、差额时备注必填、409 / 400 原样提示）；"最近已确认"列表；页头说明更新。verify：`npx eslint src/components/accounting` 0 error；本地 Playwright 走查截图（design 验证方式"页面"一行）。
- [x] 3.2 新建 `src/lib/install/__tests__/balance-db.isolated.test.ts`（真实路由 + 隔离库）覆盖 design 验证方式所列场景；注册 `scripts/test-all.sh`。verify：本地 Postgres 隔离库 0 失败；`bash scripts/check-test-registry.sh` 通过。

## 4. 收尾

- [x] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2b-balance-confirm --strict` 通过；写 `docs/QINGYAN_INSTALL-2b_REPORT.md`（含不可清理清单追加 `install.balance.confirmed`、Q6 改为沿用四种方式的说明、上线需重跑岗位种子）+ `docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2b 改 `[G]` + 更新 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2b .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后 `/opsx:archive install-2b-balance-confirm --yes`（独立小 PR），TASKFLOW INSTALL-2b 改 `[x]`；确认 `openspec list --specs` 出现 `installation/balance-confirmation`。
- 生产：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`。
- 之后 `/opsx:propose install-2c-warranty-email`。
