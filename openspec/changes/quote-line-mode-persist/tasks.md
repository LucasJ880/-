# Tasks：报价做法一「逐行报价」，成本存进系统（BIDPAGE-3）

- [x] 1. 报价配置加可选做法字段（不认识的值只丢自己）、导出 `nextQuoteNumber`；`src/lib/bid-page-v2/quote-line/` 的契约与校验、成本行映射（只动自己管的行、专业模式改过的读出与提示）、按引擎结果分摊、草稿导入、数字输入解析（verify：`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts` 全过，含旧配置解析不变、模板对照、往返、分摊不变量与差额上限、四个数与 `computeQuote` 相同）
- [x] 2. 服务与五个处理函数（列表 / 新建 / 读 / 存 / 导出）：第一步报价权限守卫并紧接着检查，再开关与招投标项目、财务查看权；只按加元；并发 409、冻结 409；改过定价方式时先填目标毛利率（verify：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts` 在隔离库全过；`npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts` 全过）
- [x] 3. ② 的报价区组件：列表与专业模式入口、新建两问、逐行表 7 列、共用参数与预置说明、四个数与差额说明、询价回复点选、粘贴 / 招标分析带入 / 加一行、旧草稿提示、保存、导出；没有编辑权限时的白话说明（verify：`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx` 全过）
- [x] 4. `bid-page-v2.tsx` 的 ② 换成新区块（我方报价卡保留、`#bid-quote-area` 保留、不再挂投标工作区面板与旧报价区、旧版报价单折叠在金额门里）；「已定」的按钮按我方报价的做法与看的人去 ② / ③（verify：`npx tsx src/lib/bid-page-v2/__tests__/next-step.test.ts` 与 `npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx` 全过，BIDPAGE-1 的开关关零变化断言照过；「已定」三种做法与看不到金额的人：`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts` 的 7a 节全过）
- [x] 5. 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`bash scripts/check-test-registry.sh` 输出 OK、历史欠账不增）
- [ ] 6. 变基到最新 origin/main 后跑门禁（verify：`npm test` 失败名单与 main 逐条相同；CI 同款环境变量下 `npm run test:ci` 输出 `CI unit subset PASS`；`npm run lint:baseline` PASS；`npx -y @fission-ai/openspec@1.15.0 validate quote-line-mode-persist --strict` valid；`git diff origin/main -- prisma/ vercel.json` 为空）
- [x] 7. 浏览器抽检（本地合成数据，开关开）：新建逐行报价、两行报价（逐键输入一个带小数的汇率）、共用参数、四个数、差额说明、导出；开关关时页签与 main 截图一致（verify：截图存 `docs/acceptance/bidpage-3/`）
- [x] 8. 写 `docs/QINGYAN_BIDPAGE-3_REPORT.md`（改了什么、与任务书的出入、门禁、审查意见与去向、要 Lucas / Evan 确认的、未验证、回退）+ 更新 TASKFLOW 状态列与 BIDPAGE-3 行的义务文字（「恢复编辑报价」改判为不恢复）+ 交接文档（verify：报告存在；TASKFLOW BIDPAGE-3 为 `[~]`）

## Workflow follow-up

- 本 change 的 `tender/bid-page` 增量是 MODIFIED，主规格由 `bid-page-v2-shell` 归档（#561）建出：先合并 #561，再归档本 change。
- 合并后 `/opsx:archive quote-line-mode-persist --yes`（独立小 PR）。
