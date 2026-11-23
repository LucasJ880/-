# Tasks：「标书与报价」页改版骨架（BIDPAGE-1）

## 1. 开关与「下一步」查表（纯函数）

- [x] 1.1 写 `src/lib/bid-page-v2/flags.ts`（`TENDER_BID_PAGE_V2_ENABLED` 总闸 + `TENDER_BID_PAGE_V2_ORG_ALLOWLIST`，写法照 `tender-bid-workspace/flags.ts`）与 `src/lib/bid-page-v2/next-step.ts`（事实类型、`decideBidPageNextStep`、去处对应表、三个分区的状态写法、金额门 `canViewBidAmounts`、金额写法），并写 `src/lib/bid-page-v2/__tests__/next-step.test.ts`，在 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` 注册，`.env.example` 登记两个开关（verify：`npx tsx src/lib/bid-page-v2/__tests__/next-step.test.ts` 全过——规格「下一步是确定性的查表」「下一步指向哪里」「分区状态的写法」「金额门」各场景；`bash scripts/check-test-registry.sh` 通过）

## 2. 汇总接口

- [x] 2.1 写 `src/lib/bid-page-v2/service.ts`（复用 `loadWebNextStepInput`，另查供应商、全部轮次明细、待批询价卡张数、引擎报价、`resolveTenderBid`、生成文件种类）与 `src/app/api/projects/[id]/bid-page-summary/route.ts`（总闸在鉴权之前、组织与项目检查在取数之前；金额门 = `canViewInternal` 且 `resolveFinancePrivilege(...).canReadAll`；不透传 `resolveTenderBid` 的结果），并写隔离库测试 `src/lib/bid-page-v2/__tests__/bid-page-summary-db.isolated.test.ts`、注册（verify：`NODE_ENV=test npx tsx src/lib/bid-page-v2/__tests__/bid-page-summary-db.isolated.test.ts` 在隔离库全过——规格「汇总接口」「只把金额给有成本与财务查看权的人」「对任何人都不出成本」各场景，五种身份）

## 3. 新页面与入口

- [x] 3.1 写 `src/components/bid-page-v2/`：`bid-tab-entry.tsx`（没拿到「已开启」时原样渲染旧 `BidTab`，不在浏览器里记标记）、`bid-page-v2.tsx`（「更多」与版本历史、「下一步」横条、三个可折叠分区，收起用 `hidden`，`#位置` 优先展开并自己滚一次，带金额的旧组件只给看得到金额的人挂）与分区内容，并写渲染测试 `src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx`、注册（verify：`npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx` 全过——规格「三步分区」「新页面不给看不到金额的人显示带金额的旧组件」「更多里的版本历史」「页内位置照常可达」「下一步的按钮只导航」各场景）
- [x] 3.2 改 `src/app/(main)/projects/[id]/page.tsx`：只换 `BidTab` 的 import 与 `<BidTab …/>` 那一行为 `BidTabEntry`，属性不变；零变化测试断言开关关时入口的服务端渲染与 `BidTab` 逐字节相同、入口的旧分支原样渲染 `<BidTab {...props} />`、`page.tsx` 的页签渲染入口且属性不变、入口在 404 / 500 / 失败 / 未开启时都渲染旧页面（verify：同一渲染测试全过；`git diff origin/main --stat` 没有 `bid-tab.tsx`；`git diff origin/main -- 'src/app/(main)/projects/[id]/page.tsx'` 只有两行改动）

## 4. 门禁与验证

- [x] 4.1 全量门禁（verify：`npm test` 与 main 基线比对没有新增失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`npx -y @fission-ai/openspec@1.15.0 validate bid-page-v2-shell --strict` valid；`git diff origin/main -- prisma/ vercel.json` 为空；`git diff --name-only origin/main` 只有 design「验证方式」列的白名单文件）
- [x] 4.2 真实浏览器抽检（verify：本地起应用、用隔离库的种子数据，开关关 / 开各截一张「标书与报价」页的图，开关关时与 main 的截图像素一致或说明差别；截图放 `docs/acceptance/bidpage-1/`）

## 5. 报告与 TASKFLOW

- [x] 5.1 写 `docs/QINGYAN_BIDPAGE-1_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含做了什么、与任务书的出入（规则顺序、金额门）、门禁结果、多维审查与交叉验证每条意见的去向、没验证到的地方、回退办法；TASKFLOW BIDPAGE-1 行改为 `[~]`（PR 待合）或合并后的实际值）

## Workflow follow-up

- 合并后看 GitHub 上合并提交的部署状态；更新 `docs/QINGYAN_BIDPAGE_HANDOFF.md`。
- `/opsx:archive bid-page-v2-shell --yes` 走独立小 PR（至少一个子 agent 核对主规格与 delta 一致、TASKFLOW 状态与合并记录一致）。
