# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_NAV-6_REPORT.md`。四件套 Lucas 2026-11-15 审核通过（Q1–Q5 全部按推荐）。

受影响测试基线（2026-11-15，main `59ab1837`，Node 24）：

| 测试 | 通过数 |
|---|---|
| reply-entry | 45 |
| reply-entry-db（隔离库，本机 Postgres） | 21 |
| entry-visibility | 92 |
| trade-access | 128（守卫处理器 111 个） |
| inbox-service | 7 |

## 1. 说法

- [x] 1.1 把阶段 `replied` 的显示名改为「买家已来信」（`src/lib/trade/stage.ts`），并把概览卡、看板漏斗、活动漏斗、助手阶段分布四处写死的「已回复」改为读阶段表（design D1 / D2）。新增 `src/lib/trade/__tests__/reply-clarity.test.ts` 的「阶段显示名与同源、取值与漏斗定义不变」一组，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。验证：该组全过；`bash scripts/check-test-registry.sh` 通过、基线不增。
- [x] 1.2 把询盘收件箱卡片下方的状态文字改为「我方已回复」（design D3），在 `reply-clarity.test.ts` 加「卡片上的两种说法」断言。验证：断言通过；`entry-visibility` 仍是 92 通过（按钮「已回复，标记」未改名）。

## 2. 回复能力

- [x] 2.1 给 `GET /api/trade/inbox` 与 `GET /api/trade/inbox/focus` 的 `capabilities` 加 `reply`（design D4）；在 `reply-entry-db.isolated.test.ts` 加「只持 `trade.read` 的成员」一组（测试岗位只建在隔离库）。验证：本机 Postgres 上原 21 项 + 新增一组全过；无库时跳过并退出 0；`trade-access` 仍是 128 通过、守卫处理器 111 个。
- [x] 2.2 询盘收件箱页面按 `reply` 决定回复操作是否出现：三个卡片按钮、只读的草稿窗口、深链提示（design D5）。在 `reply-clarity.test.ts` 加出现条件的源码断言，并调整 `reply-entry.test.ts` 里断言按钮渲染条件的两条。验证：`reply-clarity` 全过；`reply-entry` 通过数 ≥ 45；`npm run typecheck` 通过。

## 3. 交付

- [x] 3.1 跑 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`npm test`、`openspec validate nav-6-inbox-reply-clarity --strict`；本机起应用截图放 `docs/acceptance/nav-6/`（design「验证」表最后一行列的画面）。验证：命令全部通过（`npm test` 的环境类失败与 main 逐项相同）；`git diff --stat main -- prisma vercel.json src/lib/authorization` 无输出；截图里同一张卡片上不再有两个「已回复」。
- [x] 3.2 写 `docs/QINGYAN_NAV-6_REPORT.md`（改名出现的各处、接口变化、只读成员部分目前无人受影响的说明、与四件套不一致的地方、各命令真实输出）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase N 的 NAV-6 状态列。验证：报告文件存在且含上述各节；TASKFLOW 的 NAV-6 行状态为 `[G]`。

## Workflow follow-up

- 四件套经 Lucas 审核通过后才 `/opsx:apply`。
- 实施完 `/opsx:verify nav-6-inbox-reply-clarity`，开 PR（一个 change = 一个 PR）。
- PR 合并后 `/opsx:archive nav-6-inbox-reply-clarity --yes`，走独立小 PR，同步 TASKFLOW 状态列为 `[x]`。
