# Tasks

## 1. 日结逻辑

- [ ] 1.1 新建 `src/lib/cockpit/daily-digest.ts`：常量（动作名、自动化键、门控小时 0、十个计数字段）、`digestDayFor`、`buildPostDailyDigest`（D2）、`runPostDailyDigest`（D3 / D5，依赖可注入）、默认依赖（`getOrgWorkload` + 事务内 advisory lock 先查后写 `writeAuditLog`）。新建 `src/lib/cockpit/__tests__/daily-digest.test.ts` 并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：测试退出 0，覆盖 spec「日结只含按岗位的计数」「写入审计且同日幂等」「单个组织失败不影响其它」全部 scenario。

## 2. 接入定时任务与驾驶舱

- [ ] 2.1 `src/lib/automation/registry.ts` 注册 `post-daily-digest`；`src/lib/cockpit/posts.ts` 归 `ops_knowledge`；`src/lib/cockpit/schedule.ts` 配调度（D4）；`/api/cron/daily-brief` 路由按 D4 改造；`src/lib/cockpit/audit-labels.ts` 加标签与系统来源（D6）。`posts.test.ts`、`schedule.test.ts`、`audit-labels.test.ts`、`daily-digest.test.ts` 补断言（路由门控 `[0]`、两组都空才 skipped、简报逻辑未变）。verify：上述测试退出 0；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0。

## 3. 隔离库端到端

- [ ] 3.1 新建 `src/lib/cockpit/__tests__/daily-digest-db.isolated.test.ts`（注册进 `scripts/test-all.sh`）：造组织与前一天的审批 / AI 运行 → 写一条日结、内容与计数一致；重跑 `exists`；无活动组织 `empty`；只新增一条审计（无 MemoryClaim、通知、审批）。verify：隔离库执行 0 失败。

## 4. 收尾

- [ ] 4.1 门禁：`npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate org-cockpit-daily-digest --strict`、`git diff --stat prisma/ vercel.json` 为空、隔离库全量 `npm test` 与基线比对；写 `docs/QINGYAN_ORG_COCKPIT_A-5_REPORT.md`；任务书 A-5 行 → `[G]`；更新 `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`。verify：命令退出 0；`grep -c "| A-5 .*\[G\]" docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 为 1。

## Workflow follow-up

- PR 合并后在最新 main 上 `openspec archive org-cockpit-daily-digest --yes`（独立小 PR），任务书 A-5 → `[x]`。
