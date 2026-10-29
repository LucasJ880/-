# Tasks

## 1. 纯函数

- [x] 1.1 `closeout.ts` 收口单元补 `category`（D3；`category.ts` 导出外采购段映射）；新建 `src/lib/install/warranty.ts`：设置类型 / 种子 / 清洗（D1 / D2 / D10）、到期日（D8）、`renderWarrantyEmail`（主题 / 英文正文 / 同内容 HTML，无金额）、生成阻断原因、质保状态推导；新建 `src/lib/install/__tests__/warranty.test.ts` 覆盖 spec「质保设置」「邮件内容」「邮件不输出的内容」「生成条件」，`closeout-units.test.ts` 补品类断言；同 task 注册 `scripts/test-all.sh`。verify：两个测试 0 失败。

## 2. 服务、接口与执行器

- [x] 2.1 `GET / PUT /api/install/warranty-settings`（读：`accounting.read` / `install.balance.confirm` / `sales.settings.manage` 任一 ORG；写：`sales.settings.manage`；只替换 `sunnyWarranty` 键；审计）。verify：typecheck；隔离库用例（task 3.2）。
- [x] 2.2 新审批类型 `install.send_warranty_email`：`types.ts` 类型与 payload、`executor.ts` 分发、`wechat-confirm-policy.ts` 归对外发送（D9）并更新 `wechat-confirm-policy.test.ts`；新建 `src/lib/pending-actions/exec-install-warranty-email.ts`（校验企业 / 已确认 / 收件人 / 已发送 / 组织发件身份，`sendAsOrg`，测试注入发件函数，成功审计 `install.warranty.sent` + 通知销售，失败通知批准人）。verify：`npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-policy.test.ts` 0 失败；typecheck。
- [x] 2.3 `src/lib/install/warranty-service.ts`：生成审批（`requestApproval`，批准人 = 确认人，幂等键 D7）、阻断原因、状态查询；`confirmBalance` 首次成功后调用并在响应带 `warranty`；`POST /api/accounting/balance/{orderId}/warranty`；`listBalance` 的 `recentConfirmed` 带质保状态。verify：typecheck；隔离库用例。
- [x] 2.4 通知类型 `install_warranty_sent` / `install_warranty_failed` 登记（类型表 / grandfather / 开关文案 / 图标），`installNotificationHref` 覆盖两者；`balance.test.ts` 补落点断言。verify：`npx tsx src/lib/install/__tests__/balance.test.ts` 0 失败。

## 3. 页面与端到端

- [x] 3.1 `balance-tab.tsx`：确认对话框第二步（邮件预览 iframe `srcdoc` + 沙箱、"批准发送"调 `/api/ai/pending-actions/{id}`、"稍后"）；阻断时列原因；"最近已确认"质保状态列与"生成质保邮件"；页签内"质保设置"面板（老板编辑、会计只读）。verify：`npx eslint src/components/accounting` 0 error；本地 Playwright 走查截图。
- [x] 3.2 新建 `src/lib/install/__tests__/warranty-db.isolated.test.ts`（真实路由 + 隔离库 + 注入测试发件函数）覆盖 design 验证方式所列场景；注册 `scripts/test-all.sh`。verify：本地 Postgres 隔离库 0 失败；`bash scripts/check-test-registry.sh` 通过。

## 4. 收尾

- [x] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2c-warranty-email --strict` 通过；写 `docs/QINGYAN_INSTALL-2c_REPORT.md`（含上线动作：老板配置组织发件身份与质保电话 / 邮箱；不可清理清单追加 `install.warranty.sent`）+ 更新 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md`（标注已实现、种子来源）+ `docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2c 改 `[G]` + 更新 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2c .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- 2b PR 合并后本 change 才能开 PR；合并后 `/opsx:archive install-2c-warranty-email --yes`（独立小 PR），TASKFLOW INSTALL-2c 改 `[x]`。
- 生产：老板在 设置 → 邮件 配置组织发件身份；在会计"待收尾款" → 质保设置 填电话与邮箱。
- 之后 `/opsx:propose install-2d-repair-form`。
