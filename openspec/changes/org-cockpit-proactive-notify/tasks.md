# Tasks

## 1. 补发逻辑

- [x] 1.1 扫描选项与补发模块：
  - `src/lib/proactive/run-scan.ts`：可选 `{ autoActions?: boolean }`，默认 `true`；
  - 新建 `src/lib/proactive/manager-notify.ts`：`managerCandidateWhere`、`planManagerNotifyRun`（去重、排除、轮转、上限）、依赖可注入的 `runManagerNotify`（时间预算、单人失败隔离、只提醒）。
  - 新建 `src/lib/proactive/__tests__/manager-notify.test.ts`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：测试退出 0，覆盖 spec 全部 scenario。

## 2. 定时任务接入

- [x] 2.1 `/api/cron/proactive-scan`：
  - 自动化一轮结果加 `mode`；
  - 补发一轮（排除已处理、时间预算）；
  - 合并结果与元数据。
  - 测试补静态断言：两轮顺序、`autoActions: false`、`POST` 接口未改。
  - verify：测试退出 0；`npm run typecheck` 退出 0。

- [x] 2.2 交叉审查修正（阻塞 1 + 应修 3 + 可选 O1–O5）：
  - `src/lib/proactive/notify.ts`：sourceKey 带 userId，旧格式在本人名下视为已发，返回实际新建条数，依赖可注入；
  - `manager-notify.ts`：游标续排（记在本定时任务运行记录 metadata）替换按小时轮转；候选按 userId 排序、读满标截断、组织须在用；两轮主体 `runProactiveScanCron` 依赖可注入，整轮出错失败计数 +1；
  - `route.ts` 改为调用两轮主体；proposal / spec / design 同步（偏差 5、6，D2 / D3 / D5，新增 4 个 scenario）。
  - verify：`manager-notify.test.ts` 20 条全过；6 处变异（旧 key、计数、失败计入、游标、enabledUsers 位置、游标沿用）各至少 1 条断言失败；scoped `tsc` 退出 0；`openspec validate org-cockpit-proactive-notify --strict` 通过。

## 3. 门禁与交付

- [ ] 3.1 跑全部门禁并做独立交叉审查：
  - 门禁：`npm test` 与基线比较新增失败为 0；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline` 通过；`bash scripts/check-test-registry.sh` 无新增未注册；`openspec validate org-cockpit-proactive-notify --strict` 通过；`git diff --stat` 无 `prisma/`、`vercel.json`。
  - 交叉审查：独立审查代理审查实现，处理其阻塞与应修项。
  - verify：上述命令输出与审查结论写进报告。
- [ ] 3.2 写 `docs/QINGYAN_ORG_COCKPIT_A-3b_REPORT.md`，同步 `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`。
  - verify：两个文件已提交，报告包含门禁结果、staging 验证步骤与 GATE 待确认项。

## Workflow follow-up

- 归档：新增独立能力 `cockpit/manager-proactive-notify`，A-3 归档后再归档本 change，独立小 PR。
- staging：见 design「验证方式」最后一行。
