# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_NAV-1c_REPORT.md`。实施前先等 design「审核关注点」Q1–Q6 拍板。

受影响测试基线（2026-11-15，main `0925ec9d`，Node 24）：

| 测试 | 通过数 |
|---|---|
| trade-recipients | 70 |
| entry-visibility | 91 |
| inbox-service | inbox-service: 7 通过 |
| 外发同步 / 审批发送的隔离库测试（本机 Postgres） | 实施前记录 |

## 1. 回复目标与时间线

- [ ] 1.1 新增 `src/lib/trade/reply-target.ts`（回复目标解析、时间线文字映射、主题预填，design D1 / D2 / D5）与 `src/lib/trade/__tests__/reply-entry.test.ts` 的纯函数组，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。验证：纯函数组全过；`bash scripts/check-test-registry.sh` 通过、基线不增。
- [ ] 1.2 客户详情接口给每条互动加 `replyTarget`（批量查一次，放行条件见 D1）；时间线组件改文字、加「回复」，页签右上加「回复客户」；`types.ts` 同步。在 `reply-entry.test.ts` 加源码断言。验证：断言通过；`npm run typecheck` 通过。

## 2. 询盘收件箱

- [ ] 2.1 `inbox-service.ts` 加单会话读取，新增 `GET /api/trade/inbox/focus`（design D4）；回复接口读 `fromAiDraft`（D6）。验证：`inbox-service` 既有测试通过数不变；`reply-entry.test.ts` 的「不含发信与模型调用」断言通过。
- [ ] 2.2 收件箱页面：深链（D3）、卡片的「写回复 / 再写一封」、回复窗口草稿可选并显示来信原文（D5）。在 `reply-entry.test.ts` 加源码断言（按钮不依赖草稿、原文块在输入框之前、深链参数）。验证：断言通过；`npm run typecheck` 通过。

## 3. 审批面与使用说明

- [ ] 3.1 今日询盘与商机详情加链接、改占位文字（design D7）；`help-tasks.ts` 第 2、3 行补回任务书原文并调整 `entry-visibility.test.ts`（D8）。验证：`reply-entry.test.ts` 的链接与占位文字断言通过；`entry-visibility` 全过。

## 4. 端到端与交付

- [ ] 4.1 新增 `src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`（specs 里标了隔离库的全部场景），注册进 `scripts/test-all.sh`。验证：本机 Postgres 16 上全过；无库时跳过并退出 0；基线里的外发同步 / 审批发送隔离库测试通过数不变。
- [ ] 4.2 跑 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`npm test`、`openspec validate nav-1c-reply-entry --strict`；本地起应用截图放 `docs/acceptance/nav-1c/`。验证：命令全部通过（`npm test` 的环境类失败与 main 逐项相同）；`git diff --stat main -- prisma vercel.json ci/test-registry-baseline.txt` 无输出；截图里从时间线点「回复」到达的窗口上方是买家原文。
- [ ] 4.3 写 `docs/QINGYAN_NAV-1c_REPORT.md`（三处入口、接口变化、与任务书的差异、各命令真实输出、staging 发信验收步骤）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase N 的 NAV-1c 状态列。验证：报告文件存在且含上述各节；TASKFLOW 的 NAV-1c 行状态为 `[G]`。

## Workflow follow-up

- 四件套经 Lucas 审核通过后才 `/opsx:apply`。
- 实施完 `/opsx:verify nav-1c-reply-entry`，开 PR（一个 change = 一个 PR）。
- PR 合并后 `/opsx:archive nav-1c-reply-entry --yes`，走独立小 PR，同步 TASKFLOW 状态列为 `[x]`。
- 三个 change 都上线后，由 Lucas 通知梦馨一次（任务书「上线顺序」末段）。
