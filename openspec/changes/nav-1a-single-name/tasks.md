# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_NAV-1a_REPORT.md`。四件套 Lucas 2026-11-15 审核通过（Q1–Q5 按推荐，Q3 并入，见 design D9）。

受影响测试基线（2026-11-15，main `dd0e99d`，Node 24）：

| 测试 | 通过数 |
|---|---|
| entry-visibility | 73 |
| navigation-ia | 64 |
| navigation-workspace | 34 |
| position-nav | 101 |
| trade-layout | 5 |
| wechat-entry-nav | 19 |
| tenant-context | 28 |

## 1. 取名函数与名称守卫

- [x] 1.1 新增 `src/lib/navigation/entry-label.ts`（纯函数，design D1）与 `src/lib/navigation/__tests__/entry-naming.test.ts` 的「名称一致」组（62 项中文相等 / 英文非空、20 项中文定名、18 项英文定名、20 个旧名字不出现），并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。验证：在未改名的代码上 `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts` 失败并列出 18 个不一致的 key；`bash scripts/check-test-registry.sh` 通过。
- [x] 1.2 按 design D4 / D5 改 `registry.ts` 四处名称、`zh.ts` 与 `en.ts` 的 20 个翻译键的值（键名不动）。验证：1.1 的「名称一致」组全过；上表 7 个既有测试通过数不变。

## 2. 三处显示面共用取名函数

- [x] 2.1 `sidebar.tsx` 与 `mobile-nav-drawer.tsx` 改调取名函数，删掉各自的写法；`help-map.ts` 的条目带上翻译键；`/help` 名称单元格改为随界面语言取名的客户端小组件（design D2）。在 `entry-naming.test.ts` 加「三处共用」源码断言。验证：该组断言通过；`npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts` 仍 73 通过；`npm run typecheck` 通过。

## 3. 页面大标题

- [x] 3.1 按 design D6 改 16 处页面大标题（不改路由与页面其它内容），在 `entry-naming.test.ts` 加「大标题」组：核对表 + 例外表 + 三种身份可见入口全覆盖。验证：在未改标题的代码上该组失败并列出 16 个入口；改后全过，例外表恰为 8 个入口。
- [x] 3.2 按 design D9 改 20 处站内界面文字，在 `entry-naming.test.ts` 加「站内文字」组（逐处含新文字、不含旧文字；活动名称仍为「企业情报」）；把 `scripts/nav-visual-smoke.mjs` 四处「海外业务」改为「外贸获客」（design D8）。验证：在未改文字的代码上该组失败；改后全过；`grep -n "海外业务" scripts/nav-visual-smoke.mjs` 无输出；`owner-today` / `phone-match` 两个读来源标签的测试仍通过。

## 4. 整体核对与交付

- [ ] 4.1 跑 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`npm test`、`openspec validate nav-1a-single-name`。验证：全部通过；`git diff --stat main -- prisma vercel.json ci/test-registry-baseline.txt` 无输出。
- [x] 4.2 本地起应用，用测试身份截图：Cathy 侧栏与 `/help` 并排、Lynn 侧栏与 `/help` 并排、任务书列出的 7 个页面标题，放 `docs/acceptance/nav-1a/`。验证：截图里侧栏与说明页同名，没有「海外业务」「企业情报」「收件箱」「电子报价单」「全部报价」。
- [ ] 4.3 写 `docs/QINGYAN_NAV-1a_REPORT.md`（20 个改名、16 个标题、8 个例外入口、20 处站内文字、未改的 13 处与 `src/lib` / 接口里的旧叫法清单、各命令真实输出）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase N 的 NAV-1a 状态列。验证：报告文件存在且含上述各节；TASKFLOW 的 NAV-1a 行状态为 `[G]`。

## Workflow follow-up

- 四件套经 Lucas 审核通过后才 `/opsx:apply`。
- 实施完 `/opsx:verify nav-1a-single-name`，开 PR（一个 change = 一个 PR）。
- PR 合并后 `/opsx:archive nav-1a-single-name --yes`，走独立小 PR，同步 TASKFLOW 状态列为 `[x]`。
