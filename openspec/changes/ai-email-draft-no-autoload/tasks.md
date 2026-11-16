# Tasks

开工前记基线：仓库里没有直接引用这次要改的文件的已注册测试（已 grep），所以基线取整套——跑一遍 `npm run test:ci` 与 `npm run typecheck`，记下通过数；另跑 `npx tsx src/components/__tests__/ai-markdown.test.tsx`（它对 `src/` 做源码扫描）。

## 1. 规范化规则

- [ ] 1.1 新增 `src/lib/email-draft-html/normalize.ts`（纯函数，不引任何其它模块、不读环境：按 design D2 的允许清单重新生成 HTML；同时返回移除报告 `{ count, hosts }`，计数口径按 design D4；提示文字拼装）与 `src/lib/email-draft-html/__tests__/normalize.test.ts`（表驱动，覆盖 spec 前四条 Requirement 与「生成接口报告被移除的内容」「移除报告不带出地址内容」「预览告诉审核人移除了什么」里以该测试为准的全部 Scenario，含 design Context 第 1 点实测到的 13 种写法与 D2 的变形写法；全部用例二次规范化结果不变；源码里没有 `process.env` / `window` / `document` / `fetch` / `import`），并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：`npx tsx src/lib/email-draft-html/__tests__/normalize.test.ts` 通过；`bash scripts/check-test-registry.sh` 通过

## 2. 生成出口

- [ ] 2.1 在 `src/lib/sales/email-composer.ts` 里把「模型正文 / 降级模板 → 套版式 → 规范化」收成一个导出的纯步骤，`composeEmail` 与 `refineEmail` 都走它并把移除报告带出来；`wrapEmailLayout`、`getFallbackEmail` 只加 `export`，内容与提示词不动。`src/app/api/sales/email-compose/route.ts` 的生成与改写两个响应加 `removedAutoLoad`。`src/app/api/projects/[id]/questions/route.ts` 在入库前规范化模型正文，响应与既有审计记录的内容加 `removedAutoLoad`。新增 `src/lib/email-draft-html/__tests__/wiring.test.ts`（spec「生成出口返回并保存规范化后的正文」「正常草稿与现有版式不变 · 品牌版式与降级模板」，以及另两条 Requirement 里以该测试为准的生成侧 Scenario），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：`npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts` 通过；`git diff main -- src/lib/sales/email-composer.ts` 里版式模板、降级模板、提示词三段没有内容改动；`npm run typecheck` 通过

## 3. 发送出口

- [ ] 3.1 在 `src/app/api/projects/[id]/questions/[questionId]/send/route.ts` 与 `src/app/api/sales/email-compose/route.ts` 的 `send-approved` 分支里，对收到的正文做同一规范化（共用一个导出的纯步骤），发信与写发信记录用同一个结果；既有的校验与拒绝条件、响应形状不动，规范化放在既有校验之后。在 `wiring.test.ts` 里补 spec「发送出口发出规范化后的正文」两个 Scenario。verify：`npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts` 通过；`git diff main -- "src/app/api/projects/[id]/questions/[questionId]/send/route.ts" src/app/api/sales/email-compose/route.ts` 里没有删掉任何既有的校验分支

## 4. 预览

- [ ] 4.1 `src/lib/common/sanitize.ts`：先规范化再净化；净化配置导出为常量，去掉 `img` 与 `src`，补上规范化会输出的表格属性；服务端分支返回规范化结果。`project-question-dialog.tsx` 与 `ai-alert-panel.tsx`：正文预览之外加一行提示（文字来自 1.1 的提示拼装；移除数取接口报告与本地对当前正文规范化所得的较大者），`src/app/(main)/sales/types.ts` 的草稿类型加可选的 `removedAutoLoad`。在 `wiring.test.ts` 里补 spec「预览与发出的正文一致且不产生加载」前三个 Scenario、「预览告诉审核人移除了什么 · 两处预览都显示提示」、「没有绕开规则的 HTML 预览」两个 Scenario（登记清单四个文件：两处预览、`src/app/layout.tsx`、`src/components/project-detail/analyst-memo-card.tsx`）。verify：`npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts` 通过；`npx tsx src/components/__tests__/ai-markdown.test.tsx` 通过数不低于基线；`npm run typecheck`、`npm run lint:baseline` 通过

## 5. 真实浏览器

- [ ] 5.1 新增 `scripts/email-draft-preview-browser-e2e.ts`（`puppeteer-core`；没设 `CHROME_EXECUTABLE_PATH` 时打印 SKIP 并以 0 退出；默认模式断言预览与整封邮件两种放法都零请求；`--before` 用改动前的净化配置、不做规范化，列出发出的请求），注册进 `scripts/test-all.sh`（标题写明「Chromium；缺失则 SKIP」）。把两种模式的完整输出存 `docs/acceptance/ai-email-draft-no-autoload/browser-e2e.txt`。verify：设了 `CHROME_EXECUTABLE_PATH` 时默认模式以 0 退出且输出里请求数为 0，`--before` 模式输出里请求数大于 0；没设时输出含 `SKIP` 且以 0 退出
- [ ] 5.2 整页实测：本地起应用（隔离库），用浏览器端拦截把两个生成接口的响应换成含外部图片与带地址样式的草稿（不调模型），打开两处预览，确认正文上方出现提示、正文里没有图片、没有发往草稿里地址的请求。verify：两处预览各一张截图存 `docs/acceptance/ai-email-draft-no-autoload/`；起不了本地应用时在 PR 描述里写明「整页实测未做」及原因，不以测试通过代替

## 6. 文档与全量验证

- [ ] 6.1 在 `docs/QINGYAN_MAIL-1_REPORT.md` §9 第 1 点与 `docs/QINGYAN_MAIL-2_REPORT.md` §3.3 各追加一条带日期的补记：邮件 HTML 预览这条路由 change `ai-email-draft-no-autoload` 关闭、关的是什么（预览与发出的邮件都不再带图片与带地址的样式）、没关的是什么（全站 CSP；design「发现」第 1、2 点）。原有文字保留。verify：`git diff main -- docs/QINGYAN_MAIL-1_REPORT.md docs/QINGYAN_MAIL-2_REPORT.md` 只有新增行、没有删除行
- [ ] 6.2 全量验证。verify：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate ai-email-draft-no-autoload --strict` 全部通过（`npm test` 里因本机没有 `DATABASE_URL` 等原因失败的既有项，逐个与未改动的 `main` 对照并在 PR 描述里列出，不笼统写「与本 change 无关」）；`git diff --stat main -- prisma vercel.json next.config.ts src/proxy.ts src/lib/ai/prompts package.json package-lock.json` 为空

## Workflow follow-up

- `/opsx:verify ai-email-draft-no-autoload`，然后开 PR（一个 change = 一个 PR）；PR 描述写明 design「发现」四条都没有在本 change 里改，其中第 1 点（两个网页发送接口不经过 PendingAction）需要 Evan 决定。
- PR 合并后 `/opsx:archive ai-email-draft-no-autoload --yes`（独立小 PR），确认 `openspec list --specs` 列出 `agents/ai-email-draft-html`；同一个 PR 里在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 MAIL-1 行状态列补一句「邮件 HTML 预览的自动加载已由 #PR 号关闭」。
- 全站 CSP（先只报告、清点、再转强制）另开 change。
