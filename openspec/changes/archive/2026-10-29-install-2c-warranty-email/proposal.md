# Proposal: install-2c-warranty-email

**TASKFLOW：** INSTALL-2c（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）；承载方案 `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §3.3–3.4、§12 Q1–Q5（2026-10-28 Lucas 拍板：质保以报价单为准）与模板 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md`。依赖 INSTALL-2b（尾款确认）。
**受影响的 Muse 意图：** 无。本 change 不改 `src/lib/muse-bridge/**`；新审批类型属"对外发送"，Muse 侧沿用既有规则只读、提示到网页审批。

## Why

会计确认尾款后，客户应收到一封完工 + 质保确认邮件（含客户、单号、安装日、每扇窗产品与质保年限），而现在系统里没有质保条款、没有模板，也没有任何发给客户的完工邮件。对外发信必须先审批（硬纪律 2），且年限必须与客户签字的报价单一致。

## What Changes

- 新增组织级质保设置（`Organization.settingsJson.sunnyWarranty`）：按品类 × 部件存年限，种子取报价单口径（帘类与窗帘：人工 1 / 面料 5 / 部件 15 年；Shutters：人工 1 / 部件 5 年）；联系方式（公司名、地址、官网质保页种子已确认，电话 / 邮箱未核实不预置）；`GET / PUT /api/install/warranty-settings`，老板（`sales.settings.manage`）可改，会计可读；每次保存记审计。
- 给每个收口单元确定品类（Blinds 行按产品类型；国内下单 → 帘类；窗帘 → 窗帘；Vinyl → Shutters；外采购按段），用于查年限。
- 新增确定性模板：主题、英文正文与同内容 HTML（质保编号 `W-<单号>`、单号、客户、地址、安装日、每扇窗位置 / 产品 / 面料、各品类覆盖年限与到期日、官网条款链接、报修联系方式），不含任何金额。
- 尾款确认成功后自动生成 `install.send_warranty_email` 审批（批准人 = 确认尾款的会计），确认对话框直接展示邮件预览与"批准发送"；缺客户邮箱 / 缺联系方式 / 品类未配置年限时不生成，列出原因。
- 新增 `POST /api/accounting/balance/{orderId}/warranty`：补齐资料后、或审批被拒 / 过期 / 发送失败后重新生成；已发送 → 409。
- 新增执行器：批准后以组织发件身份（`trade.email_sender`）经平台邮件通道发出，收件人必须等于客户档案邮箱，不回落到任何个人邮箱；已发过则拒发；成功写审计 `install.warranty.sent` 并通知销售，失败通知批准人。
- 新审批类型登记为"对外发送"：微信回数字与 Muse 都不能批，只能在网页看完预览后批。
- "待收尾款"页签的"最近已确认"每行显示质保邮件状态（未生成及原因 / 待批准 / 已发送 / 发送失败 / 已拒绝或过期），可重新生成；页签内"质保设置"面板（老板可编辑，会计只读）。
- 写 `docs/QINGYAN_INSTALL-2c_REPORT.md`，TASKFLOW INSTALL-2c 改 `[G]`。

## Capabilities

### New Capabilities
- `installation/warranty-email`：质保设置与种子、收口单元品类、邮件内容与不输出、生成条件与阻断、尾款确认后生成审批与重新生成、批准后的发送规则（发件身份、收件人、只发一封）、审批渠道限制、状态展示与通知。

### Modified Capabilities
（无。尾款确认的既有行为不变；生成审批是确认成功之后的附加动作，规格写在新能力里。）

## Impact

- 新：`src/lib/install/warranty.ts`（纯：设置清洗 / 种子 / 渲染 / 阻断 / 状态）、`src/lib/install/warranty-service.ts`、`src/lib/pending-actions/exec-install-warranty-email.ts`、`src/app/api/install/warranty-settings/route.ts`、`src/app/api/accounting/balance/[orderId]/warranty/route.ts`、`src/components/accounting/warranty-*.tsx`。
- 改：`src/lib/install/closeout.ts`（单元品类）、`src/lib/fulfillment/category.ts`（导出外采购段映射）、`src/lib/install/balance-service.ts`（确认后生成审批、列表带质保状态）、`src/lib/pending-actions/types.ts` 与 `executor.ts`（新类型与分发）、`src/lib/ai-grader/actions/wechat-confirm-policy.ts`（分类为对外发送）、`src/components/accounting/balance-tab.tsx`、通知类型登记与落点（`src/lib/notifications/*`、`src/components/notification/*`、`src/lib/install/balance.ts` 落点函数）。
- 数据库：零 schema。设置在 `Organization.settingsJson.sunnyWarranty`；审批在 `PendingAction`；发送结果在 `AuditLog(install.warranty.sent)`；通知在 `Notification`。
- 测试：新增 `src/lib/install/__tests__/warranty.test.ts`、`warranty-db.isolated.test.ts`（注册）；`closeout-units.test.ts`、`wechat-confirm-policy.test.ts` 补断言。
- 对外行为：尾款确认响应多出质保邮件信息；新增两个接口；客户第一次会从系统收到邮件（批准后）。

## Out of scope

- PDF 质保证书附件（现有发信通道无附件能力）。
- 中文 / 法文质保邮件（只发英文）。
- 维修单、返修、二次安装（INSTALL-2d / 2e）；返修完成后的质保邮件沿用本 change 的生成规则，在 2e 接入。
- 抄送销售（改为站内通知）。
- 修改报价单 PDF 上的质保文字或官网条款。
- 给未配置组织发件身份的企业回落到个人邮箱或平台地址发信。
