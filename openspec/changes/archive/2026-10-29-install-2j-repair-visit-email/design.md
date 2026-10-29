# Design: install-2j-repair-visit-email

## Context

动机见 proposal.md。现状：
- 2e：`POST /api/install/repairs/{id}/schedule` 新建返修预约或改期同一条未完成的预约（`startAt` 改为新时间，`endAt` = 开始 + 2 小时），审计 `install.repair.scheduled`；维修单进度里的 `schedule` 指向当前返修预约。
- 2c / 2g：质保邮件的模式——生成时把收件人 / 主题 / 正文 / HTML 定稿进 `PendingAction`（`payloadHash` 防篡改），批准后执行器重新校验再经 `sendAsOrg` 以组织发件身份发出；未配置组织发件身份 `NO_ORG_SENDER`，不回落个人邮箱；`deriveWarrantyStatus` 推导状态；会计页 `WarrantyApprove` 显示预览与"批准发送"。
- 报修电话 / 邮箱在质保设置 `contact` 里（2g 起有种子）。

## Goals / Non-Goals

**Goals**
- 每个返修时间只发一封确认邮件，改期自动重新生成，旧审批批准时被拒发。
- 与质保邮件同样的审批与执行器校验强度。

**Non-Goals**
- 不改质保邮件的生成、执行、状态（`warranty-service.ts`、`exec-install-warranty-email.ts` 不动；`warranty-panel.tsx` 只给预览批准组件加可选文案参数，默认值保持原文）。
- 不改排期的校验、通知与预约写法（`scheduleRepair` 只在成功之后追加一步生成邮件）。
- 不加通知类型、不加权限键、不碰 Prisma schema 与 `src/lib/muse-bridge/**`。

## Decisions

### D1 一个"返修时间"一封邮件
审批幂等键 `install-repair-visit:<维修单 id>:<预约 id>:<开始时间毫秒>:<第几次>`；"该时间已发送"由审计 `install.repair_visit_email.sent`（`afterData` 带维修单、预约、开始时间）判定。改期后开始时间变化 → 新键、新审批、改期主题（该维修单此前任一时间已有发送记录即视为改期）。
- 否决：每个维修单只发一封——改期后客户收不到新时间。
- 否决：改期时主动作废旧审批——要改写别的审批状态；执行器按"预约与时间未变"拒发更简单可靠。

### D2 执行器重新校验
校验顺序：企业一致 → 批准人是有效成员 → 维修单存在且属本企业、未关闭 → 当前返修预约 = 审批里的预约、未取消未完成、开始时间 = 审批里的时间 → 未发过 → 收件人 = 客户档案当前邮箱 → 组织发件身份。同一维修单的发送用 advisory lock 串行化。
- 否决：执行时重渲邮件——批准人批准的是预览里看到的内容。

### D3 内容只用对客户安全的字段
主题 / 正文只用：客户名、单号、工艺单号、地址（工艺单地址优先，客户档案地址兜底）、日期与到达时间段（企业时区，`en-US` 长日期 + 12 小时制）、各行位置 + 问题类型的英文说明、报修电话 / 邮箱 / 公司名。问题类型英文说明是固定表（不带"客户原因"等内部归因）。不输出备注、问题描述原文、照片、出单、员工姓名、金额。
- 否决：带安装工名字——员工内部信息，不对外。

### D4 生成时机与入口
排期接口成功后（事务外）生成，失败只记日志、不影响排期；排期响应带邮件状态。维修单详情带当前时间的状态；`POST /visit-email` 供补齐资料后重新生成。生成 / 重新生成要求 `install.task.assign`，批准人是发起人。
- 否决：在详情页 GET 时自动生成——读接口不应有写副作用。

### D5 页面复用质保邮件的预览批准组件
`WarrantyApprove` 加可选 `label` / `footer` 文案参数（默认仍是质保文案），维修单详情的"返修时间确认邮件"卡片复用它；状态推导复用 `deriveWarrantyStatus`（已发送 → 最近审批 → 阻断原因 → 未生成，逻辑相同）。

## 与八条硬纪律

1. 零 schema：审批在既有 `PendingAction`，发送记 `AuditLog`；不加 model / 字段 / migration。
2. 出站先审批：只在审批批准后由执行器发出；生成时零出站。
3. 禁止第三套队列：不涉及（沿用既有审批执行器）。
4. 脱敏：不涉及 Muse；邮件不含金额（spec「返修时间确认邮件不输出的内容」）。
5. 不爬登录页：不涉及。
6. 邮箱分离：发件身份只读组织设置 `trade.email_sender`；收件人只取客户档案，不从请求取。
7. 确定性优先：渲染、状态推导都是确定性函数；不加 LLM 调用。
8. 测试注册：新增 `repair-visit-email.test.ts`、`repair-visit-email-db.isolated.test.ts` 登记进 `scripts/test-all.sh`。

## Risks / Trade-offs

- [旧审批仍在待处理列表里] → 批准时 `SCHEDULE_CHANGED` 拒发并显示原因；详情页只显示当前时间的审批。
- [客户邮箱缺失] → 阻断并列出原因，补齐后详情页一键重新生成。
- [到达时间段固定 2 小时] → 与 2e 预约结束时间一致；不另设置。

## Migration Plan

部署即生效；已排的返修不会补发（只在之后的排期 / 改期或手动"生成确认邮件"时生成）。回滚 = 回退本 PR；未批准的审批在旧代码里是未知动作类型，执行返回失败、不会发信。

## 验证方式

- `npx tsx src/lib/install/__tests__/repair-visit-email.test.ts`：渲染（首次 / 改期主题、时区日期时间、英文问题说明、联系方式、HTML 同内容、同输入同输出）、不出内部信息、生成条件。
- 隔离库 `repair-visit-email-db.isolated.test.ts`：排期后待批准；客户无邮箱阻断；补齐后重新生成；出单岗 403；未配置发件身份 `NO_ORG_SENDER`；批准发送与审计；改期后旧审批 `SCHEDULE_CHANGED`、新审批改期主题；重复 `ALREADY_SENT`；维修单关闭后 `REPAIR_CLOSED`。
- `npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-policy.test.ts`（或现有位置）：新动作类型属对外发送类。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate install-2j-repair-visit-email --strict`；全量 `npm test`。
- 本地浏览器走查：排期后详情页卡片显示预览与"批准发送"；截图存 `docs/install-2j-screenshots/`。
