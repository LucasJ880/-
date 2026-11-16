# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_NAV-3_REPORT.md`。四件套 Lucas 2026-11-16 审核通过（Q1–Q6 全部按推荐）。

受影响测试基线（2026-11-16，main `43be745f`，Node 24）：

| 测试 | 通过数 |
|---|---|
| reply-entry | 45 |
| reply-clarity | 36 |
| reply-entry-db（隔离库，本机 Postgres） | 28 |
| entry-visibility | 92 |
| trade-access | 128（守卫处理器 111 个） |

## 1. 草稿原文的取得

- [x] 1.1 在 `src/lib/trade/reply-target.ts` 加「待批草稿是否可用」的判定与带草稿 id 的深链地址（design D1 / D2）；新增 `src/lib/trade/__tests__/approval-draft-edit.test.ts` 的纯函数组，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。验证：该组全过；`bash scripts/check-test-registry.sh` 通过、基线不增。
- [x] 1.2 `GET /api/trade/inbox/focus` 支持 `approvalId` 并返回 `approvalDraft`（design D1）；回复接口正文上限改为 10000（D6）；在 `reply-entry-db.isolated.test.ts` 加第 5 组（specs 里标了隔离库的全部场景）。验证：本机 Postgres 上原 28 项 + 新增一组全过；无库时跳过并退出 0；`trade-access` 仍是 128 通过、守卫处理器 111 个。

## 2. 页面

- [x] 2.1 询盘收件箱页面：深链带草稿 id、回复窗口的第三种开法、草稿失效的提示、收件邮箱不同的提示（design D3 / D4）。在 `approval-draft-edit.test.ts` 加源码断言，并调整 `reply-clarity.test.ts` 里钉着深链分支形状的断言。验证：`approval-draft-edit` 全过；`reply-clarity` 通过数 ≥ 36；`npm run typecheck` 通过。
- [x] 2.2 今日询盘与商机详情：链接文字、带草稿 id、今日询盘上移进展开的草稿区块（design D5）。在 `approval-draft-edit.test.ts` 加断言，并调整 `reply-entry.test.ts` 里钉着旧链接文字的断言。验证：两个测试全过，`reply-entry` 通过数 ≥ 45；`entry-visibility` 仍是 92 通过。

## 3. 交付

- [x] 3.1 跑 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`npm test`、`openspec validate nav-3-approval-draft-editable --strict`，以及 design「验证」表里的既有隔离库测试；本机起应用截图放 `docs/acceptance/nav-3/`。验证：命令全部通过（`npm test` 的环境类失败与 main 逐项相同）；`git diff --stat main -- prisma vercel.json src/lib/pending-actions src/lib/revenue-spine src/lib/trade/outbound-sync.ts` 无输出；截图里从待批草稿点进去的窗口正文是草稿原文。
- [x] 3.2 写 `docs/QINGYAN_NAV-3_REPORT.md`（入口与窗口的变化、接口变化、与审批执行那条路的差异、与四件套不一致的地方、各命令真实输出、staging 发信验收步骤）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase N 的 NAV-3 状态列。验证：报告文件存在且含上述各节；TASKFLOW 的 NAV-3 行状态为 `[G]`。

## Workflow follow-up

- 四件套经 Lucas 审核通过后才 `/opsx:apply`。
- 实施完 `/opsx:verify nav-3-approval-draft-editable`，开 PR（一个 change = 一个 PR）。
- PR 合并后 `/opsx:archive nav-3-approval-draft-editable --yes`，走独立小 PR，同步 TASKFLOW 状态列为 `[x]`。
