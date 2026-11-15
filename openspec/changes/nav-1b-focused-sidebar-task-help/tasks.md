# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_NAV-1b_REPORT.md`。实施前先等 design「审核关注点」Q1–Q6 拍板；Q4 若要加，先用 `/opsx:update` 补 spec 要求再动代码。

受影响测试基线（2026-11-15，main `d46730e`，Node 24）：

| 测试 | 通过数 |
|---|---|
| trade-layout | 5 |
| entry-visibility | 73 |
| entry-naming | 31 |
| position-nav | 101 |
| navigation-ia | 64 |
| mengxin-positions | 42 |
| trade-recipients | 70 |

## 1. 两段式判定与侧栏

- [ ] 1.1 在 `src/lib/navigation/trade-layout.ts` 实现判定、常用清单常量与分区函数（design D1、D2），删掉旧的按平台角色判定；重写 `trade-layout.test.ts`（真值表、常用顺序、更多按分组、两段互斥且覆盖、Cathy 与纯外贸业务员的入口集合与全量布局相等），注册进 `scripts/test-all.sh` 并从 `ci/test-registry-baseline.txt` 删掉它那一行；同步 `mengxin-positions.test.ts` 与 `trade-recipients.test.ts` 的断言。验证：新用例在旧代码上失败；改后 `trade-layout` 全过，`mengxin-positions`、`trade-recipients` 通过；`bash scripts/check-test-registry.sh` 报基线 67 条。
- [ ] 1.2 `sidebar.tsx` 接线（design D3–D5）：「常用」段、「更多」开关行与展开后的分组、图标栏下的「更多」、段标题改「常用」（`zh.ts` / `en.ts` 的值）、分组小标题 12px + 侧栏弱化色；在 `trade-layout.test.ts` 加侧栏源码断言（调新判定、不再读派生平台角色、小标题样式）。验证：断言通过；`position-nav` 仍 101 通过；`npm run typecheck` 通过。

## 2. 说明页与入口说明

- [ ] 2.1 改 `registry.ts` 的 19 条 `description`（specs「入口说明用白话」）；在 `entry-visibility.test.ts` 加逐条断言与「其余 53 条不变」。验证：新断言通过；「72 项每项不超过 40 字」仍通过。
- [ ] 2.2 新增 `src/lib/navigation/help-tasks.ts`（12 行常量与按可见入口过滤，design D6），`help-map.ts` 按侧栏分段输出（design D7）；在 `entry-visibility.test.ts` 加断言：全部入口顺序 = 侧栏顺序、每行绑定的 key 在注册表里、目标不可见的行不出现、窗饰销售为空、各行引用的按钮名在目标页面源码里。验证：新断言通过；既有「每种身份：地图 = 侧栏可见入口」仍通过。
- [ ] 2.3 改 `/help` 页面：顶部「我想做什么」、「全部入口」分段、副标题二选一、删页尾三块开发者文字；把 `entry-visibility.test.ts` 里「其余段落不动」的断言改为「不含 `DEPLOY_VERCEL`、`QA_P0_CHECKLIST`、组织与项目、Prompt」，并按 design D9 调整 `entry-naming.test.ts` 对页面源码的一条断言。验证：`entry-visibility`、`entry-naming` 全过；`npm run typecheck` 通过。

## 3. 整体核对与交付

- [ ] 3.1 跑 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`npm test`、`openspec validate nav-1b-focused-sidebar-task-help --strict`。验证：全部通过（`npm test` 的环境类失败与 main 逐项相同）；`git diff --stat main -- prisma vercel.json` 无输出。
- [ ] 3.2 本地起应用，用虚构账号截图：Cathy 侧栏（「更多」折叠 / 展开 / 图标栏）、Cathy 的 `/help` 第一屏与全部入口、纯外贸业务员侧栏、Lynn 的侧栏与 `/help`，放 `docs/acceptance/nav-1b/`。验证：Cathy 第一段依次是 8 个常用入口；`/help` 的「全部入口」顺序与侧栏逐项一致；Lynn 的 `/help` 没有「我想做什么」与页尾。
- [ ] 3.3 写 `docs/QINGYAN_NAV-1b_REPORT.md`（判定真值表、常用与更多的实际清单、「我想做什么」12 行与任务书原文的差异、19 条说明、各命令真实输出、给 NAV-1c 留的两行）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase N 的 NAV-1b 状态列。验证：报告文件存在且含上述各节；TASKFLOW 的 NAV-1b 行状态为 `[G]`。

## Workflow follow-up

- 四件套经 Lucas 审核通过后才 `/opsx:apply`。
- 实施完 `/opsx:verify nav-1b-focused-sidebar-task-help`，开 PR（一个 change = 一个 PR）。
- PR 合并后 `/opsx:archive nav-1b-focused-sidebar-task-help --yes`，走独立小 PR，同步 TASKFLOW 状态列为 `[x]`。
- NAV-1c 的 tasks 里补回「我想做什么」第 2、3 行的任务书原文（「写回复」与「去询盘收件箱自己写」）。
