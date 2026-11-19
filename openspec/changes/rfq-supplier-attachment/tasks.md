# Tasks：询价邮件带一份重排的 PDF 附件（CHAIN-4a）

开工前跑一遍要触碰模块的已注册测试并记下基线（`tender-rfq/__tests__` 的 build / round-pure / web-entry-pure / auto-draft-pure / chase-execute，隔离库 supplier-identity-guard-db / auto-draft-db），写进报告。

## 1. 发信管道

- [x] 1.1 `src/lib/google-email.ts`：`SendEmailParams.attachments`，`buildRawEmail` 有附件时 `multipart/mixed`（RFC 2231 / 2047 文件名、76 字符换行、内容哈希分隔线），无附件走原路径；新增 `src/lib/__tests__/google-email-mime.test.ts`（含一份旧实现做逐字节对照）并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/__tests__/google-email-mime.test.ts` 全部通过

## 2. 附件内容与载荷

- [x] 2.1 新增 `src/lib/tender-rfq/attachment-flags.ts` 与 `src/lib/tender-rfq/attachment.ts`（渲染 HTML、内容指纹、文件名、模板身份段、页数、大小文案、载荷字段类型）；`types.ts` 载荷加 `attachment`；`round-pure.ts` 的 `hashRfqPayloadItems` 覆盖附件、`previewRfqPayload` 加附件行；`build.ts` `renderRfqEmail` 加附件那一句；新增 `src/lib/tender-rfq/__tests__/attachment.test.ts` 并注册（test-all + test-ci-unit）；verify：该测试通过，`build.test.ts`、`round-pure.test.ts` 不改期望值通过

## 3. 起草与执行

- [x] 3.1 新增 `src/lib/tender-rfq/attachment-service.ts`（起草时生成与检查、按载荷重排与核对、PDF 生成可注入）；`service.ts` 在建轮次前生成附件、失败返回 `ATTACHMENT_FAILED`；`execute.ts` 发信前核对并随信发出、写审计；verify：`npm run typecheck` 通过，`supplier-identity-guard-db.isolated.test.ts` 在隔离库不改期望值通过
- [x] 3.2 入口说明：`web-entry-pure.ts`（`ATTACHMENT_FAILED` 两种原因的说明与出路；`friendlyExecutionError` 对「一封都没有发」的说明原样显示）、`rounds/route.ts`（422）、`auto-draft-pure.ts` / `auto-draft-service.ts`（新原因码）；verify：`web-entry-pure.test.ts` 通过，`auto-draft-pure.test.ts` 改原因码计数后通过

## 4. 显示与预览

- [x] 4.1 `previewEmailsFromPayload` / `loadRfqSendEmails` 带附件与预览链接；`rfq-approval-panel.tsx` 附件行与对不上时只给驳回；`next.config.ts` 给起草 / 执行 / 预览路由带上 Chromium 与中文字体；新增 `src/app/api/projects/[id]/tender-rfq/attachment/route.ts`（只读预览）；verify：`attachment.test.ts` 的预览字段用例通过，`npm run typecheck` 与 `npm run lint:baseline` 通过

## 5. 端到端与收尾

- [x] 5.1 新增隔离库 `src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts`（开关关、送审带附件、联邦标不含身份、生成失败 / 超限零轮次、执行发出与审计、改要求拒发、执行时生成失败、预览权限 / 409 / 只读）并注册；真实 Chromium 抽检一份联邦标附件；verify：本机隔离库全部通过，抽检结果写进报告
- [x] 5.2 全量门禁：`npm test`（与 main 对照失败名单）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate rfq-supplier-attachment --strict`；`git diff origin/main -- prisma/ vercel.json` 为空；verify：输出写进报告
- [x] 5.3 写 `docs/QINGYAN_CHAIN-4a_REPORT.md` + 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` CHAIN-4a 状态列；verify：两个文件在 PR diff 里

## Workflow follow-up

- `/opsx:verify` → 交叉审查 → PR → 合并 → `/opsx:archive rfq-supplier-attachment --yes`（独立小 PR）。
- staging：开关只对测试组织打开，用测试邮箱收一封，打开 PDF 核对中文与条目、与卡上预览一致后再对 Sunny 打开（需要有 Vercel 权限的人）。
