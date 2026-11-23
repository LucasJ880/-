# Tasks：询价单模板第 2 版（RFQ-PDF-2）

开工前跑一遍要触碰模块的已注册测试并记下基线通过数，写进报告：`tender-rfq/__tests__` 的 build / attachment / inbound-parse / round-pure / web-entry-pure / auto-draft-pure / sheet-download，`bid-workflow/__tests__/project-identity-deny`；隔离库 attachment-db / sheet-download-db / supplier-identity-guard-db / auto-draft-db / tracker-db / analysis-update-note-db，`tender-pricing/__tests__/compare-cost-source-db`。

## 1. 询价单的内容规则

- [ ] 1.1 `src/lib/tender-rfq/build.ts`：行项去掉序号与来源页码，加类型用词、分组与排序、缺译文标记与条数（design D1 / D9）；数量三种写法（D2）；固定问题与附加问题分开、材料清单加固定一组（D1）；联系人与邮箱入参（D8）；回复截止按组织时区且不晚于截标前一天（D6）；内部字段词表加词并查要求编号与数量（D7）。`build.test.ts` 加用例（打乱类别的分组与顺序、三种数量、数量事实含采购方 / 门牌地址 / 内部成本、回复截止五种日期与当地前一天、译文 / 编号 / 数量里的内部字样与 `at no additional cost` 反例、缺译文条数）；verify：`npx tsx src/lib/tender-rfq/__tests__/build.test.ts` 通过
- [ ] 1.2 `build.ts` `renderRfqEmail` 与带附件那一句按 design D5 改写；`inbound-contract.ts` `rfqContextFromBody` 两种写法都认；`build.test.ts` 加「新正文」用例，`inbound-parse.test.ts` 加「新旧正文都读得出编号与数量」；verify：两个测试通过，`chase-pure.test.ts`、`followup-coverage.test.ts` 不改期望值通过

## 2. 模板第 2 版

- [ ] 2.1 `src/lib/tender-rfq/attachment.ts`：首屏、询价内容、报价表（`RFQ_QUOTE_FIELD_LABELS`，D3）、规格确认表、请另外回答、勾选清单、回复方式、带边框的签章栏；版式数值与 `englishPt` 入参（D4）；版式版本 2（D11）；`rfqAttachmentTextBlocks` 同步。`attachment.test.ts` 更新并加用例（固定文字里没有「招标文件 p.」「序号」「评分」「拍照」「扫描作为附件」；六栏与回信字段对应；联系人为空不印、邮箱是展示发件人；分组与条数；勾选框；清单同序同条数；签章栏不拆页的样式；同输入同输出；定版指纹；旧版本走 template 分支）；verify：`npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts` 通过

## 3. 接线与提醒

- [ ] 3.1 联系人、邮箱、时区接到五个调用方：`service.ts`（起草；载荷 `attachment.draft.contactName`）、`attachment-view.ts`（读载荷）、`attachment-service.ts`（重排）、`web-entry.ts`（入口预判）、`sheet-download.ts` / `sheet-download-service.ts`（菜单）；隔离库测试更新期望并把依赖真实时钟的夹具改为注入时刻（`attachment-db`、`sheet-download-db`、`supplier-identity-guard-db`、`auto-draft-db`；正文夹具含旧写法的 `tracker-db`、`analysis-update-note-db`、`compare-cost-source-db` 保持旧写法不动，作为「旧正文仍读得出」的证据）；verify：七个隔离库测试在本机隔离库通过，`npm run typecheck` 通过
- [ ] 3.2 缺译文提醒与两句说明（D9 / D10）：`web-entry-pure.ts` / `web-entry.ts` 的入口提醒；`sheet-download*.ts`、`generate-docs.ts`、`generate-pdf/route.ts`、`project-generate-menu.tsx` 的 `notices`；`sheet-download.ts` 的「没有已确认的要求」新说明；`project-identity-messages.ts` 的身份命中说明。`web-entry-pure.test.ts`、`sheet-download.test.ts`、`sheet-download-db.isolated.test.ts`、`project-identity-deny.test.ts` 更新；verify：四个测试通过，`npm run lint:baseline` 通过

## 4. 样张与收尾

- [ ] 4.1 新增 `scripts/rfq-sheet-sample.ts`（design D12）并实跑：14 条与 60 条的页数、内嵌 Noto Sans SC、长编号不重叠、8pt 与 7.5pt 两份的页数与首页截图，产物存 `docs/acceptance/rfq-pdf-2/`；verify：`npx tsx scripts/rfq-sheet-sample.ts` 的输出写进报告，14 条 ≤ 3 页、60 条 ≤ 8 页
- [ ] 4.2 全量门禁：`npm test`（失败项与 main 基线逐项对照）、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate rfq-sheet-template-v2 --strict`；`git diff origin/main -- prisma/ vercel.json` 为空；verify：输出写进报告
- [ ] 4.3 写 `docs/QINGYAN_RFQ-PDF-2_REPORT.md`（含改了期望的既有测试清单、两份样张）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` RFQ-PDF-2 状态列与 `docs/QINGYAN_RFQ-PDF_HANDOFF.md`；verify：三个文件在 PR diff 里

## Workflow follow-up

- `/opsx:verify rfq-sheet-template-v2` → 多维审查两轮（做法见交接文档 §5）→ 开 PR（正文含「多维审查」）→ **停下，把样张交 Evan 定字号**；定之前不合并。
- Evan 定 7.5pt 的话：改 `englishPt` 缺省值与定版指纹，重跑 `attachment.test.ts` 与样张脚本，版式版本仍是 2。
- 合并后 `/opsx:archive rfq-sheet-template-v2 --yes`（独立小 PR）。归档前先跑一遍 `openspec validate --specs --strict` 的预演：MODIFIED 的每条正文都要 ≤ 500 字（RFQ-PDF-1 归档时踩过）。
