# Tasks：定报价只点一次（BIDPAGE-6）

- [x] 1. 服务层：
  - `src/lib/quote-engine/service.ts` 抽出 `assertQuoteTransitionAllowed` / `applyQuoteTransitionTx` / `transitionAuditAction`，`transitionQuote` 改为调用它们，库写语句与顺序不变；
  - `quote-ops-contract.test.ts` B2-S4 与 `b3-ledger-producer.test.ts` 的事务内位置断言按 design D11 的对照表改成断言抽出后的结构，被断言的性质不变；
  - `src/lib/bid-page-v2/quote-confirm/`：契约与中文（按钮矩阵、不可点原因、确认框、通知文字、通知结果、我方报价一行、请求体 schema）与服务（一次定价、提交 + 通知、退回、另起新版、我方报价一行的数）；
  - 只收逐行与总价报价；锁的顺序报价行 → 项目行；改选时不写同步的中间结果审计；通知前自己判负责人在职；
  - `quote-line/service.ts` 列表带 `ourBid`（金额用现算的税前报价）、导出原因与按状态写的锁定说明；
  - `notifications/href.ts` 加 `bid_quote`；
  - 新测试 `quote-confirm.test.ts` 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；
  - 不改 `next-step.ts` 与 `next-step.test.ts`（design D8、「与在途轨道」）。

  verify：
  - `npx tsx src/lib/bid-page-v2/__tests__/quote-confirm.test.ts` 全过；
  - `npx tsx src/lib/quote-engine/__tests__/quote-ops-contract.test.ts`、`npx tsx src/lib/quote-engine/__tests__/b3-ledger-producer.test.ts`、`npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts`、`npx tsx src/lib/bid-page-v2/__tests__/next-step.test.ts`（不改、照样全过）、`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`、`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`、`npx tsx src/lib/notifications/__tests__/notification-href.test.ts` 全过。
- [x] 2. 四个处理函数 `…/{quoteId}/confirm`、`submit`、`return`、`revise`：
  - 第一步报价权限守卫，级别固定，并紧接着检查；
  - 再开关与招投标项目、金额门、请求体校验；
  - 新测试 `quote-confirm-db.isolated.test.ts` 注册进两个脚本；
  - `docs/acceptance/bidpage-6/prod-check.sql`（只读）。

  verify：
  - `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts` 在隔离库全过，覆盖：
    - 0 份 / 1 份 / 另一份我方报价 / 两份已批准没选 / 另一份已中标；
    - 审计各一条、台账两条、镜像与金额；
    - 同一份并发两次、同一项目两份并发（4 组，不出 500）、修改时间不同、报价合计不同、未定价 409、同步失败与写镜像失败回滚；
    - 提交与四种通知结果（已通知、关掉了、负责人不是在职成员、自己就是负责人）、通知无金额、退回、另起新版；
    - 专业模式的报价 409、开关关 404 且不读请求体、无财务查看权与无批准权限 403；
    - 专业模式状态接口的迁移与改动前相同；
  - 去掉「提前锁项目行」的变异体跑这份测试时，两份并发那条失败（证明它抓得到互锁）；
  - `npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts` 全过；
  - `quote-line-db`、`lump-sum-db`、`bid-page-summary-db`、`b3-ledger-producer.isolated` 在隔离库全过；
  - `scripts/quote-ops-golden-e2e.ts` 在隔离库分别对 main 与本分支跑：通过 / 失败条目与条数相同（除首行时间戳与 PDF 字节数外逐行相同）。
- [x] 3. 界面：
  - `src/components/bid-page-v2/quote-actions.tsx`：主按钮、不可点原因、确认、退回原因、提交结果、我方报价一行、另起新版；
  - 逐行与总价编辑器用它代替「提交、批准在专业模式里做」，锁定说明改写；
  - `QuoteStep` 最上面放我方报价一行，按 `#bid-quote-{id}` 打开报价，操作后刷新列表、视图与汇总；
  - `bid-page-v2.tsx` 不挂 `TenderOurBidCard`、传刷新回调，`bid-tab-entry.tsx` 给回调，`entry-mode.ts` 认 `#bid-quote-…`；
  - 新测试 `quote-actions.test.tsx` 注册进两个脚本；
  - BIDPAGE-1 的 `bid-page-v2.test.tsx` 改：
    - `:179` 组件清单去掉 `TenderOurBidCard`，另加一条断言：新页面不挂卡、② 里是我方报价一行、改版前的页面与工作台照旧挂卡；
    - `:217-219` 金额分支里的组件换成报价区与旧版报价单；
    - `:85`（入口渲染新页面）、`:188`（新页面一定带着汇总渲染）两条正则按多传的刷新回调改：它们证明的「只有拿到已开启才渲染新页面、没有读取中的新页面」不变，开关关时入口与 `BidTab` 逐字节相同的断言照旧；
    - `:194` 的对照渲染不改。
  - BIDPAGE-3 的 `quote-step.test.tsx:188`（② 的报价区挂在 `#bid-quote-area` 里）按多传的回调改。

  verify：
  - `npx tsx src/components/bid-page-v2/__tests__/quote-actions.test.tsx` 全过；
  - `npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx` 全过，开关关时入口与 `BidTab` 逐字节相同；
  - `npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`、`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx` 全过；
  - `bash scripts/check-test-registry.sh` 输出 OK、历史欠账不增。
- [x] 4. 合入最新 origin/main 后跑门禁。

  verify：
  - `npm test` 失败名单与 main 逐条相同；
  - CI 同款环境变量下 `npm run test:ci` 输出 `CI unit subset PASS`；
  - `npm run typecheck` 通过；`npm run lint:baseline` PASS；
  - `openspec validate quote-one-step-confirm --strict` valid；
  - `git diff origin/main -- prisma/ vercel.json` 为空。
- [x] 5. 浏览器抽检（本地合成数据，开关开）：
  - 有批准权限的账号对草稿点「定为我方报价」一次 → 标题行显示版本与金额，审计提交、批准、选定各一条；
  - 已有另一份我方报价时再定一份 → 改选；
  - 操作员只看到「提交给负责人」，负责人收到通知，点开回到这份报价，看到「批准并定为我方报价 / 退回」；
  - 另起新版后新草稿在页内打开；
  - 开关关时页签与 main 截图一致。

  verify：截图存 `docs/acceptance/bidpage-6/`。
- [x] 6. 写 `docs/QINGYAN_BIDPAGE-6_REPORT.md` + 更新 TASKFLOW 状态列 + 交接文档。报告写：改了什么、与任务书的出入、门禁、审查意见与去向、要 Lucas / Evan 确认的、未验证、回退。

  verify：报告存在；TASKFLOW BIDPAGE-6 为 `[~]`。

## Workflow follow-up

- 合并后确认部署（`release-drift.yml` 的 `main=… deployed=…` 一致）。
- 再 `/opsx:archive quote-one-step-confirm --yes`（独立小 PR，至少一个子代理核对主规格与增量一致）。
