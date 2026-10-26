# Tasks

## 1. 调度与健康度（纯函数）

- [ ] 1.1 新建 `src/lib/cockpit/schedule.ts`：`AUTOMATION_SCHEDULES`（`Record<AutomationKey, AutomationSchedule>`，按 design Context 的真实调度）、受支持子集的 cron 解析、`nextDueAt` / 最长正常间隔 / 单自动化健康度 / 岗位健康度纯函数；新建 `src/lib/cockpit/__tests__/schedule.test.ts` 并在同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：`npx tsx src/lib/cockpit/__tests__/schedule.test.ts` 退出 0，含调度表 vs `vercel.json` / 路由源码交叉核对、上海 / 多伦多 / 2026-11-01 DST / 周一门控 / 按需 / 迟到 / 卡住 / 未配置 / 配额抬升各用例。

## 2. 等你 N 件（纯函数）

- [ ] 2.1 新建 `src/lib/cockpit/waiting.ts`：`redactCockpitText`（复用 `containsOutboundSensitive` strict，整段替换）、待我审批条目与需要你作业的岗位归属、去重、按时间倒序取前 10、`unattributed` / `truncated` 计算、岗位 `pendingApprovals` / `needsYou` 计数；新建 `src/lib/cockpit/__tests__/waiting.test.ts` 并注册。verify：`npx tsx src/lib/cockpit/__tests__/waiting.test.ts` 退出 0，覆盖 spec「等你 N 件」「按岗位归属」「不输出敏感字段」的全部 scenario。

## 3. company.log 时间线（纯函数）

- [ ] 3.1 新建 `src/lib/cockpit/timeline.ts`：三路信封构造（含岗位归属与 `href`）、AgentRunEvent 事件白名单、AutomationRun 入选规则、`(at, id)` 倒序归并、游标编解码、`limit` / `days` / `cursor` 参数校验、摘要脱敏；新建 `src/lib/cockpit/__tests__/timeline.test.ts` 并注册。verify：`npx tsx src/lib/cockpit/__tests__/timeline.test.ts` 退出 0，含 7 条交错数据以 `limit=3` 翻页 3/3/1 不重不漏、越界参数返回校验错误。

## 4. 读模型装配与 API

- [ ] 4.1 新建 `src/lib/cockpit/posts-read-model.ts`：`getOrgPostsCockpit` / `getOrgCompanyLog`（依赖可注入；默认实现只读、按 orgId 限定的 Prisma 查询；类型化 KPI 加载器，投标先过财务开关）；新建 `src/app/api/cockpit/posts/route.ts` 与 `src/app/api/cockpit/timeline/route.ts`（`withAuth` → `resolveWorkforceApiOrgForUser` → 管理层判定）；新建 `src/lib/cockpit/__tests__/posts-read-model.test.ts` 并注册。verify：`npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts` 退出 0，含假依赖装配（七岗位顺序、KPI ok / unavailable / disabled / error、配额抬升、财务开关关闭时投标加载器未被调用）与静态断言（只读、`db.<model>.` 查询带 `orgId`（AutomationRun 除外）、无 `resolvePreferredOrgId`、路由三段式访问控制）；`npm run typecheck` 退出 0。

## 5. 门禁

- [ ] 5.1 跑全量门禁。verify：`npm run lint:baseline` 退出 0；`npm run test:ci` 输出 `CI unit subset PASS`；`npm test` 中 A-1 与本 change 的 4 个新测试全部 PASS，其余失败项与 `origin/main` 基线逐条一致；`npm run test:runtime-architecture` 通过；`git diff --stat origin/main -- prisma/ vercel.json` 为空；`openspec validate org-cockpit-read-model --strict` 通过。

## 6. 收尾

- [ ] 6.1 写 `docs/QINGYAN_ORG_COCKPIT_A-2_REPORT.md`（做了什么 / 怎么验 / 与任务书的偏差 / 交叉审查发现与处理 / staging 待验项 / 已知限制）+ 更新 TASKFLOW 状态列（`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表 A-2 → `[G]`）。verify：报告文件存在；`grep -n "^| A-2 " docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的状态列为 `[G]`。

## Workflow follow-up

- GATE 审核时在 staging 跑时间线三条查询的 `EXPLAIN ANALYZE`，并以 `seed:org:sunny-home-deco` 管理员调用两个接口核对数字。
- PR（base = `claude/awesome-turing-dorqeg`）合并后再 `/opsx:archive org-cockpit-read-model --yes`（独立小 PR），确认 `openspec list --specs` 列出 `cockpit/posts-overview` 与 `cockpit/company-log`，A-2 状态列改为 `[x]`。
