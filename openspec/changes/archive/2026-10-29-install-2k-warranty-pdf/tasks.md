# Tasks

## 1. 证书

- [x] 1.1 新建 `src/lib/install/warranty-certificate.ts`：`renderWarrantyCertificate`（D3，与邮件同入参，确定性、转义）与附件名（只保留 `[A-Za-z0-9._-]`）；`warranty.ts` 邮件正文加"证书见 PDF 附件"；`warranty.test.ts` 覆盖 spec「质保证书 PDF 附件」证书内容、「邮件内容」、「邮件不输出的内容」。verify：`npx tsx src/lib/install/__tests__/warranty.test.ts` 0 失败。

## 2. 发信与执行器

- [x] 2.1 `SendEmailInput.attachments` 透传给 Resend；`sendAsOrg` 带附件（D4）；`email-sender.test.ts` 补附件断言。verify：`npx tsx src/lib/trade/__tests__/email-sender.test.ts` 通过。
- [x] 2.2 `InstallSendWarrantyEmailPayload` 加证书与附件名；生成审批时定稿、预览带附件名与证书（D1）；执行器发送前渲染 PDF（`renderHtmlToPdf`，测试注入 D6），失败 `PDF_FAILED`（D2），旧审批不带附件（D5），审计记附件名与字节数；`warranty-db.isolated.test.ts` 补对应场景。verify：`npm run typecheck` 0 error；`warranty-db.isolated` 0 失败。

## 3. 页面与真实渲染

- [x] 3.1 会计页预览显示附件名，可展开看证书；本地用真实 Chromium 渲染含中文产品名的证书并提取文本核对；Playwright 走查截图存 `docs/install-2k-screenshots/`。verify：`npx eslint src/components/accounting` 0 error；走查与真实渲染检查全部通过。

## 4. 收尾

- [x] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2k-warranty-pdf --strict` 通过；全量 `npm test`（隔离库）与 2j 基线比对；写 `docs/QINGYAN_INSTALL-2k_REPORT.md` + `docs/QINGYAN_PERMISSION_TASKFLOW.md` 增 INSTALL-2k 行并改 `[G]` + 更新 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` 与 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2k .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- 2j 合并后本 change 才能开 PR（同一分支串行）。
- PR 合并后在最新 main 上 `openspec archive install-2k-warranty-pdf --yes`（独立小 PR），TASKFLOW INSTALL-2k 改 `[x]`；archive 后对 `installation/` 全部 spec 跑 `--strict`。
