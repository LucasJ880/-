# Tasks — procurement-records-requests（PROC-1）

## 1. 持久化与暗合并闸

- [x] 1.1 在 `prisma/schema.prisma` 末尾追加 design D1 的 16 个 model（只新增，不改既有 model）；新建迁移 `prisma/migrations/20261105120000_add_procurement_records_foundation/migration.sql`（只 CREATE TABLE / INDEX / 外键到新表）；登记 `src/lib/release/expected-migrations.ts`、`scripts/verify-migration-history.ts`（sha256）、`scripts/check-release-safety.test.ts`；新建 `src/lib/procurement-records/flags.ts`（`PROCUREMENT_RECORDS_SCHEMA_READY`，fail-closed）。verify：`npx prisma validate` 退出 0；隔离库 `npx prisma migrate deploy` 成功且 `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url …` 为空；`npx tsx scripts/verify-migration-history.ts` 与 `npx tsx scripts/check-release-safety.test.ts` 通过。

## 2. 纯函数：身份、排程、来源、优先级

- [x] 2.1 新建 `src/lib/procurement-records/{identity,schedule,sources-pure,priority,watch-config,flags,labels}.ts`：编号 / 机构规范化与去重键、多伦多本地槽位（DST）、CanadaBuys CSV / CKAN 合同 / ATI 摘要解析（前缀列匹配、PARSE_FAILED）、关键词与排除词匹配（含法语同义词）、五维优先级、配置校验与服务端上限。写 `__tests__/procurement-pure.test.ts` 并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：该测试 `npx tsx …` 退出 0；`bash scripts/check-test-registry.sh` 通过。

## 3. 扫描执行器、种子与定时任务

- [x] 3.1 新建 `src/lib/procurement-records/{scan-run,instruments,source-fetch,seed,watch-service}.ts` 与 `scripts/procurement-records-seed.ts`：槽位认领、心跳与接管、预算待续、来源抓取（fetch 可注入、外部情报总闸）、采购工具 / 证据 / 关系幂等写入、自动申请卡（autoDraftKey）、变化集合通知；`tender-watch` 路由追加 `runTrackedAutomation("procurement-watch", …)` 并登记 `AUTOMATION_REGISTRY`（同步 `src/lib/cockpit/posts.ts` 与 `schedule.ts` 的穷举登记）。verify：`npm run typecheck` 退出 0；`git diff src/app/api/cron/tender-watch/route.ts` 中既有盯梢步骤无改动。

## 4. 申请卡、规则、申请人、重复检查与 READY

- [x] 4.1 新建 `src/lib/procurement-records/{request-pure,duplicate-check,ready-gate,case-pure}.ts`（纯；模板 / 指纹在 request-pure，状态 / 期限 / 回执比对 / 旧状态映射在 case-pure）与 `requests.ts`、`rules.ts`、`applicants.ts`、`tasks.ts`（DB：版本只插入、事务内 advisory lock 重算、台账确认、规则核实、申请人版本）。写 `__tests__/records-request-pure.test.ts` 并注册。verify：该测试退出 0，含 10-31 / 11-05 用例与渠道改写用例。

## 5. 自助交接、回执、案件事件与待办

- [x] 5.1 在 `requests.ts` / `events.ts` 实现交接（非状态事件：复制 / 打开入口）、提交登记（user_reported / document_verified / SUBMISSION_UNKNOWN 及解除）、受理与案件编号、来信事件（澄清、费用、延期、转交、部分披露、最终回应、更正）、期限三分、站内待办（`Task` sourceId + sourceTemplateKey 幂等）。verify：`npm run typecheck` 退出 0；5.x 行为在任务 8 的隔离库测试中逐条断言。

## 6. 附件、抽取与分析、导出

- [x] 6.1 新建 `src/lib/procurement-records/{attachments,extract-pure,analysis-pure,analysis,export,views,access}.ts`：私有 Blob 上传与哈希去重、后台解析（NEEDS_OCR / ENCRYPTED / CORRUPT）、表格与 PDF 行抽取、明细复核、按口径分析、Markdown / CSV 导出。写 `__tests__/disclosure-analysis-pure.test.ts` 并注册。verify：该测试退出 0，含跨阶段、修订总额、SO 值 0、恶意文字用例。

## 7. 接口与界面

- [x] 7.1 新建 `src/app/api/procurement/**` 路由（监控、运行、候选、Tender 关联、申请人、规则、台账确认、申请、版本、READY、交接、提交、事件、附件、明细、分析、导出）；界面：`/projects/intelligence/monitor`（采购监控 + 候选）、`/projects/intelligence/records`（台账）与 `/projects/intelligence/records/[id]`（详情），`IntelHubShell` 加链接（侧栏只加 matchPaths，岗位侧栏快照不变），Tender 情报 Tab 加「历史采购与资料申请」卡；隔离环境演示脚本 `scripts/procurement-records-demo.ts`。verify：`npm run typecheck` 与 `npm run lint:baseline` 通过；隔离环境截图存 `docs/acceptance/proc-1/`。

## 8. 端到端测试、报告与 TASKFLOW

- [ ] 8.1 写 `src/lib/procurement-records/__tests__/procurement-records-db.isolated.test.ts`（真实路由 + 注入 fetch + 隔离库，覆盖任务书第十五节 1–18）并注册；全量 `npm test`；写 `docs/QINGYAN_PROC-1_REPORT.md` + 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 状态列 + 交接文件。verify：隔离库测试退出 0；`npm test` 结果写入报告；`openspec validate procurement-records-requests --strict` 通过。
