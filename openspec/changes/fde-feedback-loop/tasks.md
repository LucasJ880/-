# Tasks

## 1. 结构化 diff 与买家信息替换（纯函数）

- [x] 1.1 新建 `src/lib/revenue-spine/fde/draft-diff.ts`：
  - 内容：正文归一（与执行器一致）、段落分类、行级 diff（改动段落类型 / 改动占比）、事实段新增行的数值捕获、`maskBuyerPii`。
  - 新建 `src/lib/revenue-spine/fde/__tests__/draft-diff.test.ts`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：`npx tsx src/lib/revenue-spine/fde/__tests__/draft-diff.test.ts` 退出 0，覆盖 spec「草稿结构化 diff」全部 scenario 与「草稿创建时留存脱敏快照」的买家信息替换 scenario。

## 2. 终态反馈记录

- [ ] 2.1 新建 `src/lib/revenue-spine/fde/draft-feedback.ts`：
  - 快照内容构造与写入；
  - 终态映射；
  - 幂等键；
  - 记录器（依赖可注入）；
  - 尽力而为包装；
  - 补漏扫描及其查询条件。
  - `src/lib/employee-ai/feedback-service.ts` 增加 `systemRecorded` 与 `diffSummary` 两个可选参数。
  - 新建 `src/lib/revenue-spine/fde/__tests__/draft-feedback.test.ts` 并注册。
  - verify：测试退出 0，覆盖以下 spec 的全部 scenario：「终态自动产生反馈事件」「驳回原因原样带入」「同一审批同一终态只产一条事件」（重复调用、记录失败不影响）「不存买家个人信息与正文」「手工反馈入口行为不变」。

## 3. 接入

- [ ] 3.1 接入点如下，均为尽力而为：
  - `inbound-sales.ts` 与 `no-reply-followup.ts`：审批新建成功（非复用）后写快照；
  - `approval/port.ts`：批准 / 驳回的非重复分支与过期赢家调用记录器；
  - `api/cron/approval-timeout/route.ts`：追加补漏扫描。
  - 在 `draft-feedback.test.ts` 里补源码静态断言。
  - verify：静态断言通过（接入在非重复分支、包在异常保护里，复用草稿不写快照，`vercel.json` 无改动），覆盖 spec「接入点覆盖全部审批入口并有补漏」「复用草稿不重复写」「重复批准请求」；既有 `src/lib/approval/__tests__` 与 FDE 相关测试仍全部通过；`npm run typecheck` 退出 0。

## 4. 门禁

- [ ] 4.1 跑全量门禁。verify：
  - `npm run lint:baseline` 退出 0；
  - `npm run test:ci` 输出 `CI unit subset PASS`；
  - `npm test` 中新测试全部 PASS，其余失败项与 `origin/main` 基线逐条一致；
  - `git diff --stat origin/main -- prisma/ vercel.json` 为空；
  - `openspec validate fde-feedback-loop --strict` 通过。

## 5. 收尾

- [ ] 5.1 写 `docs/QINGYAN_ORG_COCKPIT_B-1_REPORT.md`（做了什么 / 怎么验 / 与任务书的偏差含 GATE 决策项 / 交叉审查发现与处理 / staging 待验项）+ 在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase B 表把 B-1 状态列更新为 `[G]`。
  - verify：报告文件存在；`grep -n "^| B-1 " docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的状态列为 `[G]`。

## Workflow follow-up

- GATE-B1 在 staging：
  - 批准一封、驳回一封（有备注 / 无备注各一）、放过期一封 FDE 询盘回复，确认各产一条团队范围反馈事件；
  - 事件与快照不含买家个人信息；
  - 两小时后补漏扫描不重复写。
- 等用户 / Evan 对 proposal 偏差 1（改稿来源）拍板后再开 B-2。
- PR（base = `claude/org-cockpit-workload`）合并后 `/opsx:archive fde-feedback-loop --yes`（独立小 PR）。
