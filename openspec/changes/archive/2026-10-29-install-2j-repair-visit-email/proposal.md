# Proposal: install-2j-repair-visit-email

**TASKFLOW：** INSTALL-2j（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）。依赖 INSTALL-2e（安排返修 / 改期、返修预约）、INSTALL-2c / 2g（组织发件身份、对外邮件审批与执行器模式、报修联系方式）。来源：Lucas 2026-10-29——"给客户发返修时间确认邮件（对外发送，要走审批）"。
**受影响的 Muse 意图：** 无。不改 `src/lib/muse-bridge/**`。

## Why

运营主管排好返修后，客户只能靠电话或销售口头得知上门时间；改期也没有书面通知，客户不在家导致白跑的风险由公司承担。

## What Changes

- 安排返修或改期成功后，系统为当前返修时间生成一条"返修时间确认邮件"审批（`install.send_repair_visit_email`），批准人为排期的人；批准前不发任何邮件。
- 邮件英文：首次与改期两种主题；含客户名、维修单号、工艺单号、地址、企业时区的日期与到达时间段、各行位置与问题的英文说明、报修电话 / 邮箱；不含金额、内部备注、照片、员工姓名。
- 批准后执行器重新校验（维修单未关闭、预约与时间未变、收件人仍是客户档案邮箱、组织发件身份已配置、同一时间未发过）再以组织发件身份发出并记审计。
- 维修单详情显示邮件状态与预览、"批准发送"；新增 `POST /api/install/repairs/{id}/visit-email`（重新生成）；排期接口响应带邮件状态。
- 审批归为对外发送类：不能微信回数字确认，只能在网页看完预览后批准。
- 写 `docs/QINGYAN_INSTALL-2j_REPORT.md`，TASKFLOW 增 INSTALL-2j 行并改 `[G]`。

## Capabilities

### New Capabilities
- `installation/repair-visit-email`：返修时间确认邮件的生成、内容、不输出的内容、批准后发送、状态与重新生成。

### Modified Capabilities
（无。排期、维修单详情的既有要求不变，新增行为都写在新能力里。）

## Impact

- 新增：`src/lib/install/repair-visit-email.ts`（纯函数：渲染、生成条件）、`src/lib/install/repair-visit-email-service.ts`（生成审批、状态）、`src/lib/pending-actions/exec-install-repair-visit-email.ts`（执行器）、`src/app/api/install/repairs/[id]/visit-email/route.ts`。
- 改：`src/lib/pending-actions/types.ts`、`executor.ts`、`src/lib/ai-grader/actions/wechat-confirm-policy.ts`（登记动作类型）；`src/lib/install/repair-service.ts`（排期成功后生成，响应带状态）；`src/app/api/install/repairs/[id]/route.ts`（详情带状态）；`src/components/install/repair-pages.tsx`（详情卡片）；`src/components/accounting/warranty-panel.tsx`（预览批准组件加可选文案参数，质保邮件行为不变）。
- 数据库：零 schema。审批在既有 `PendingAction`，发送记 `AuditLog`。
- 权限：不加新键；生成 / 重新生成 = `install.task.assign`（ORG），批准人 = 生成人。
- 测试：新增 `repair-visit-email.test.ts`、`repair-visit-email-db.isolated.test.ts` 并注册；`wechat-confirm-policy.test.ts` 补断言。

## Out of scope

- 抄送（质保邮件的抄送设置不用于本邮件）；新的站内通知类型。
- 中文邮件；短信 / 微信通知客户；客户在线确认或改约。
- 首装预约的确认邮件（只做返修预约）。
- 自动发送（不经审批）。
