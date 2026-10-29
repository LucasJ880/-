# Proposal: install-2g-warranty-update

**TASKFLOW：** INSTALL-2g（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）。依赖 INSTALL-2c（质保设置、质保邮件审批与执行器）。来源：Lucas 2026-10-29——官网新质保条款已生效，Shutters 按新条款；条款链接保留；报修邮箱用 service@sunnyshutter.ca，质保邮件同时抄送 miki@sunnyshutter.ca。官网原文见 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` §0a。
**受影响的 Muse 意图：** 无。不改 `src/lib/muse-bridge/**`。

## Why

官网新质保条款已生效，Shutters 改为人工 1 年、五金部件 15 年、框架与叶片 25 年，系统和报价单仍写"人工 1 / 部件 5"，客户收到的质保邮件与报价单都会少写年限；报修联系方式已确认却还要老板手填，质保邮件也没有抄送给内部跟进人。

## What Changes

- 质保部件新增"框架与叶片"（`frame`，邮件里为 "Frame & Panels"）；设置页质保表多一列。
- 质保设置种子改为：Shutters 人工 1 / 部件 15 / 框架与叶片 25 年；报修电话 647-857-8669、报修邮箱 service@sunnyshutter.ca；新增"质保邮件抄送"，种子为 miki@sunnyshutter.ca。帘类、窗帘年限不变。
- 质保设置读写接口接受并校验抄送地址（格式有效、去重、最多 5 个）；设置页加"质保邮件抄送"输入框。
- 生成质保邮件审批时把抄送地址（去掉与收件人相同的）定稿进审批内容；审批预览与会计页预览显示抄送。
- 批准后发送时按审批里的抄送地址抄送，发送审计记录抄送地址；抄送地址不合法时拒发。
- 报价单 PDF 的 Shutters 段质保文字改为 "Warranty: 1 year labour / 15 years components / 25 years frame & panels."，与质保设置种子一致。
- 写 `docs/QINGYAN_INSTALL-2g_REPORT.md`，TASKFLOW 增 INSTALL-2g 行并改 `[G]`；更新质保邮件模板文档与 HANDOFF。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `installation/warranty-email`：修改「质保设置」「质保设置读写」「邮件内容」「尾款确认后生成审批」「批准后发送」；新增「抄送来源」「报价单质保文字」。

## Impact

- 改：`src/lib/install/warranty.ts`（部件、种子、抄送设置与校验）、`src/lib/install/warranty-service.ts`（审批内容与预览带抄送）、`src/lib/pending-actions/exec-install-warranty-email.ts` 与 `types.ts`（按审批抄送发送、审计）、`src/lib/trade/email.ts` 与 `email-sender.ts`（发信支持抄送，不传时行为不变）、`src/components/accounting/warranty-panel.tsx`（抄送输入框、预览显示抄送）、`src/app/(main)/sales/quote-sheet/quote-pdf.ts`（Shutters 质保文字）。
- 数据库：零 schema。抄送存 `Organization.settingsJson.sunnyWarranty.cc`；审批内容是既有 `PendingAction.payload`。
- 已保存过质保设置的企业：已存的年限与（空的）抄送不被覆盖，由老板在「质保设置」里改。
- 权限：不加新键，沿用 `sales.settings.manage`（写设置）与 `install.balance.confirm`（生成 / 批准）。
- 测试：`warranty.test.ts`、`warranty-db.isolated.test.ts`、`email-sender.test.ts` 补断言；不新增测试文件；`email-sender.test.ts` 登记进 `scripts/test-all.sh` 并移出历史欠账基线。

## Out of scope

- 帘类 / 窗帘按新条款细分（无绳升降机构 3 年、电机 5 年、电机配件 5 年、电池 1 年）及报价单帘类文字——Lucas 本次只定了 Shutters。
- 按签单日期区分新旧条款版本：Lucas 定为 Shutters 一律按新条款，本 change 之后生成的质保邮件都按当前设置。
- 已生成、待批准的质保审批不重渲（内容在生成时定稿）；要按新条款发，会计拒绝后重新生成。
- 自动改写企业已保存的质保设置。
- 给 Order Form（`order-shutters.tsx`）加质保文字；质保 PDF 附件；中文质保邮件。
