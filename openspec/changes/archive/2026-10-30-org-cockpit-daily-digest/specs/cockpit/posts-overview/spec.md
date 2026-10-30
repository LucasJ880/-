## MODIFIED Requirements

### Requirement: 自动化调度表与线上调度一致
系统 SHALL 为每个自动化维护一条调度：随 cron 每次触发都记录运行的、按 cron 计划；按本地时刻门控的（在本地某些小时才记录运行）、给出门控小时与时区（组织时区或固定时区）；按需运行的。每条 cron 计划 SHALL 与 `vercel.json` 中该自动化路由的 `schedule` 一致，每组门控小时 SHALL 与路由源码中的门控数组一致。

#### Scenario: 调度表与 vercel.json 对照
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/schedule.test.ts`
- **THEN** 31 个自动化各有一条调度；非按需的每一条都能在 `vercel.json` 找到同路径同 `schedule` 的 cron；门控小时与路由源码一致，退出码 0

#### Scenario: 新增自动化未配调度
- **WHEN** 自动化注册表新增一个键而调度表未配
- **THEN** `npm run typecheck` 失败，调度测试失败

#### Scenario: 岗位日结按组织本地 0 点与 1 点门控
- **WHEN** 读取 `post-daily-digest` 的调度
- **THEN** 为本地时刻门控：路由 `/api/cron/daily-brief`、门控小时 `[0, 1]`、组织时区，与路由源码一致
