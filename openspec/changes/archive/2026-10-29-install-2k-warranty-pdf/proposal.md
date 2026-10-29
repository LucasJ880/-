# Proposal: install-2k-warranty-pdf

**TASKFLOW：** INSTALL-2k（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）。依赖 INSTALL-2c / 2g / 2h（质保邮件审批、执行器、质保设置）与既有服务端 HTML → PDF 转换层（`src/lib/pdf/html-to-pdf.ts`，报价单 PDF 在用）。来源：Lucas 2026-10-29——"质保邮件附上 PDF"。
**受影响的 Muse 意图：** 无。不改 `src/lib/muse-bridge/**`。

## Why

质保邮件只有正文：客户要存档或报修时得翻邮件，转发、打印都不方便；一份可保存的质保证书 PDF 是客户的正式凭证。

## What Changes

- 生成质保邮件审批时同时定稿一份英文质保证书（A4，与邮件同一份数据：质保编号、单号、客户、地址、安装日、各单元、各品类各部件年限与到期日、条款链接、报修联系方式）与附件名 `Warranty-W-<单号>.pdf`。
- 批准后执行器把证书渲染为 PDF（既有服务端 Chromium 转换层，中文字体已注入），作为附件随邮件发出；PDF 生成失败拒发 `PDF_FAILED`，不发不带附件的邮件；审计记附件名与大小。
- 邮件正文加一句"质保证书见 PDF 附件"。
- 会计页预览显示附件名，可展开看证书。
- 发信底层支持附件（不传时行为不变）。
- 本功能上线前生成、内容里没有证书的审批照常发送、不带附件。
- 写 `docs/QINGYAN_INSTALL-2k_REPORT.md`，TASKFLOW 增 INSTALL-2k 行并改 `[G]`。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `installation/warranty-email`：新增「质保证书 PDF 附件」；修改「邮件内容」「邮件不输出的内容」「尾款确认后生成审批」。

## Impact

- 新增：`src/lib/install/warranty-certificate.ts`（证书 HTML 纯函数）。
- 改：`src/lib/install/warranty.ts`（邮件正文一句）、`warranty-service.ts`（审批内容带证书与附件名、预览带附件）、`src/lib/pending-actions/exec-install-warranty-email.ts` 与 `types.ts`（发送前渲染 PDF、附件、`PDF_FAILED`、审计）、`src/lib/trade/email.ts` 与 `email-sender.ts`（附件透传）、`src/components/accounting/warranty-panel.tsx`（预览附件）。
- 数据库：零 schema。证书 HTML 在既有 `PendingAction.payload`；PDF 不落库，发送时生成。
- 依赖：不新增依赖（`puppeteer-core`、`@sparticuz/chromium`、Noto Sans SC 已在用）。
- 测试：`warranty.test.ts`、`warranty-db.isolated.test.ts`、`email-sender.test.ts` 补断言；不新增测试文件。

## Out of scope

- 返修时间确认邮件附 PDF；中文证书。
- PDF 存档 / 下载入口（会计页或客户分享页）。
- 已发送质保邮件补发证书。
