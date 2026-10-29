# Tasks

## 1. 质保设置

- [x] 1.1 `warranty.ts`：部件加 `frame`（D1，顺序 labour → fabric → components → frame → motor）；种子改为 Shutters 1 / 15 / 25、电话 647-857-8669、邮箱 service@sunnyshutter.ca、抄送 [miki@sunnyshutter.ca]（D2）；设置加顶层 `cc` 与校验（D3：数组或分隔字符串、小写去重、格式、最多 5 个；缺 `cc` 视为空）；`warranty.test.ts` 覆盖 spec「质保设置」「质保设置读写」（非法抄送）「邮件内容」（Shutters 单）「报价单质保文字」（读 `quote-pdf.ts` 源文本与种子交叉比对）。verify：`npx tsx src/lib/install/__tests__/warranty.test.ts` 0 失败。

## 2. 发信与审批

- [x] 2.1 发信底层抄送（D4）：`SendEmailInput.cc` 非空时传给 Resend；`sendAsOrg` 消息参数带 `cc` 并在每次尝试（含平台地址代发）带上；`email-sender.test.ts` 补带抄送 / 不带抄送两种，并登记进 `scripts/test-all.sh`、从 `ci/test-registry-baseline.txt` 删除。verify：`npx tsx src/lib/trade/__tests__/email-sender.test.ts` 通过；`bash scripts/check-test-registry.sh` 通过。
- [x] 2.2 审批与执行器（D3）：`InstallSendWarrantyEmailPayload.cc`；生成时 `cc` = 设置抄送去掉收件人，预览（`WarrantyPreview`）与审批预览文字带抄送；执行器校验 `cc`（格式、≤ 5，否则 `INVALID_PAYLOAD`）、发送带抄送、审计 `install.warranty.sent` 记 `cc`；生成 / 重新生成不读请求体里的 `cc` / `to`。verify：`npm run typecheck` 0 error。
- [x] 2.3 `warranty-db.isolated.test.ts` 补：经接口读出新种子；老板保存抄送（合并重复）与非法抄送 400；缺联系方式场景改为先保存空电话 / 邮箱；预览与审批带抄送且去掉收件人；请求体带 `cc` / `to` 被忽略；批准后发送带抄送、审计记录抄送；抄送为空时不带抄送。verify：本地隔离库 0 失败。

## 3. 页面与报价单

- [x] 3.1 `warranty-panel.tsx`：质保表随部件多出"框架与叶片"列；加"质保邮件抄送"输入框（逗号分隔，保存后显示合并结果）；待批准预览显示"抄送"。`quote-pdf.ts` Shutters 段改为 "Warranty: 1 year labour / 15 years components / 25 years frame & panels."。本地 Playwright：老板打开质保设置看到新年限与抄送、会计确认尾款后预览显示抄送，截图存 `docs/install-2g-screenshots/`。verify：`npx eslint src/components/accounting src/app/(main)/sales/quote-sheet/quote-pdf.ts` 0 error；走查全部检查通过。

## 4. 收尾

- [x] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2g-warranty-update --strict` 通过；全量 `npm test`（隔离库）与 2f 基线比对；写 `docs/QINGYAN_INSTALL-2g_REPORT.md` + `docs/QINGYAN_PERMISSION_TASKFLOW.md` 增 INSTALL-2g 行并改 `[G]` + 更新 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md`（实现状态）与 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2g .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后在最新 main 上 `openspec archive install-2g-warranty-update --yes`（独立小 PR），TASKFLOW INSTALL-2g 改 `[x]`。
- 上线后：老板打开「质保设置」，若提示"当前为默认值"则无需操作；若已保存过，把 Shutters 改为人工 1 / 部件 15 / 框架与叶片 25 并填抄送 miki@sunnyshutter.ca。
