# Design: install-2k-warranty-pdf

## Context

动机见 proposal.md。现状：质保邮件在生成审批时把收件人 / 抄送 / 主题 / 正文 / HTML 定稿进 `PendingAction.payload`，批准后执行器校验再经 `sendAsOrg` → Resend 发出；`SendEmailInput` 没有附件。仓库已有服务端 HTML → PDF 转换层 `renderHtmlToPdf`（puppeteer-core + 本机 / `@sparticuz/chromium`，注入 Noto Sans SC，输出校验 `%PDF-`，失败抛 `HtmlToPdfError`），报价单 PDF 在生产使用。产品名可能含中文（如 "Vinyl 百叶"、"斑马帘"），纯 pdf-lib 标准字体无法编码中文。

## Goals / Non-Goals

**Goals**
- 客户收到的质保邮件带一份与正文一致的质保证书 PDF。
- 批准人批准的就是将要发出的证书内容（定稿进审批）。
- 证书生成失败不静默降级。

**Non-Goals**
- 不改质保邮件的生成条件、审批渠道、抄送、一单一封等既有规则（`warranty-service.ts` 只追加证书字段）。
- 不改 `src/lib/pdf/html-to-pdf.ts`（直接复用）。
- 不改返修时间确认邮件（`repair-visit-email*`）。
- 不加依赖、不碰 Prisma schema 与 `src/lib/muse-bridge/**`。

## Decisions

### D1 证书 HTML 定稿进审批，PDF 在发送时生成
生成审批时用与邮件同一份入参渲染证书 HTML（`renderWarrantyCertificate`），连同附件名写进 payload（受 `payloadHash` 保护）；执行器发送前把这段 HTML 交给 `renderHtmlToPdf` 生成 PDF。
- 否决：生成审批时就生成 PDF 存进 payload——base64 体积大（数百 KB），审批列表与 payload 校验都变重。
- 否决：执行时按当前设置重渲证书——批准人看到的与发出的可能不同。

### D2 失败拒发，不降级
PDF 渲染失败 → `PDF_FAILED`（不发送），沿用既有失败通知与"重新生成"。
- 否决：失败时发不带附件的邮件——客户与公司都以为有证书，问题被掩盖。代价：Chromium 故障期间质保邮件发不出，但失败原因与通知立即可见。

### D3 证书版式
A4 单页为主：抬头公司名 + "Warranty Certificate"；质保编号 / 单号 / 客户 / 地址 / 安装日；单元表（位置、产品、面料）；各品类覆盖（部件、年限、到期日）；报修联系方式与条款链接；页脚说明"本证书确认上述产品的质保范围，完整条款见链接"。字体栈含 "Noto Sans SC"（转换层注入）。不含金额、内部备注、照片、员工信息。

### D4 附件透传
`SendEmailInput.attachments?: { filename; content: Buffer }[]`，非空时传给 Resend；`sendAsOrg` 原样透传（含平台地址代发重试）。附件名只保留 `[A-Za-z0-9._-]`。
- 否决：执行器直接调 Resend——会丢掉代发规则。

### D5 旧审批兼容
payload 没有证书字段 → 不生成 PDF、不带附件，照常发送。

### D6 测试注入
执行器提供 `__setWarrantyPdfRendererForTest`（与既有 `__setWarrantySenderForTest` 同模式）；DB 测试不依赖 Chromium。真实渲染在本地用 `CHROME_EXECUTABLE_PATH` 走查验证（含中文产品名）。

## 与八条硬纪律

1. 零 schema：证书 HTML 在既有 `PendingAction.payload`；PDF 不落库。
2. 出站先审批：附件随已批准的邮件发出；生成时零出站。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及 Muse；证书与邮件同样不含金额（spec「邮件不输出的内容」扩到证书）。
5. 不爬登录页：不涉及。
6. 邮箱分离：发件身份不变，只读组织设置。
7. 确定性优先：证书 HTML 确定性渲染；不加 LLM 调用。
8. 测试注册：不新增测试文件；改动的测试均已注册。

## Risks / Trade-offs

- [Chromium 冷启动耗时（数秒）] → 在发送事务前生成 PDF，事务内只发信与写审计；执行器总超时沿用 60 秒事务上限。
- [Chromium 不可用] → `PDF_FAILED` + 批准人失败通知；会计可稍后重新生成。
- [payload 变大] → 证书 HTML 约 10–20 KB，远低于既有 200 KB 上限。

## Migration Plan

部署即生效；之前生成的待批准审批没有证书，照常发送不带附件（D5）。回滚 = 回退本 PR；回滚后带证书字段的审批在旧代码里被忽略附件，照常发送。

## 验证方式

- `npx tsx src/lib/install/__tests__/warranty.test.ts`：证书内容、确定性、转义、不出金额；邮件正文写明附件。
- `npx tsx src/lib/trade/__tests__/email-sender.test.ts`：附件透传（含代发重试）与不传附件。
- 隔离库 `warranty-db.isolated.test.ts`：预览带附件名与证书；带附件发送与审计；PDF 失败 `PDF_FAILED`；旧审批不带附件。
- 本地真实渲染：`CHROME_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` 渲染含中文产品名的证书，`unpdf` 提取文本核对。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate install-2k-warranty-pdf --strict`；全量 `npm test`。
- 本地浏览器走查：会计确认尾款后预览显示附件名，展开看证书；截图存 `docs/install-2k-screenshots/`。
