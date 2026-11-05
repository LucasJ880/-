# PROC-1 交接（采购情报与政府资料申请）— 可恢复进度清单

> 用途：长任务换会话时从这里续做，不凭记忆。每完成一个阶段就更新本文件并提交。
> 任务书副本：`docs/QINGYAN_PROC-1_RECORDS_TASKBRIEF.md`；OpenSpec change：`openspec/changes/procurement-records-requests/`。
> 分支：`claude/tender-dijkstra-1i94ag`（只在此分支开发与推送；未经许可不开 PR、不合并）。

## 0. 续做步骤（新会话照做）

1. 读 `CLAUDE.md` → `openspec/config.yaml` → 本文件 → `openspec/changes/procurement-records-requests/{proposal,design,tasks}.md`。
2. `git log --oneline -20` 对照下面「进度」表，确认最后完成到哪一项。
3. `npx -y @fission-ai/openspec@1.15.0 validate procurement-records-requests`（应通过）。
4. 本地验证：`npm ci`（Node 24，`.nvmrc`）；单文件测试 `npx tsx <file>`；隔离库测试见 §4。

## 1. 已拍板 / 待拍板

| 项 | 状态 | 说明 |
|---|---|---|
| 硬纪律 1「零 schema」例外 | **待 Evan 拍板** | 任务书要求持久化模型、唯一约束、decimal 金额与迁移；本 change 只**新增表**，不改任何既有表与列，生产迁移不执行。未拍板不得合并（GATE 不过）。先例：KPI-2 的第 7 条例外。 |
| 硬纪律 3「不新增队列/租约」 | 遵守 | 扫描挂在既有 `tender-watch` cron 里作为受跟踪步骤；单轮认领 = 扫描运行行的唯一槽位键 + 心跳超时接管（与 AutomationRun 的陈旧运行关闭同型），不建通用队列 / worker 注册表。 |
| 硬纪律 7「不增 LLM 调用」 | 遵守 | V1 正文模板、优先级、去重、READY、金额计算、表格 / PDF 文本抽取全部确定性；模型辅助抽取留作后续并需单独拍板。 |
| 硬纪律 2「出站先审批」 | 遵守 | V1 零出站：不发邮件、不代交、不代付；对外跟进信只生成草稿。 |
| 硬纪律 5「不爬登录页」 | 遵守 | 只用开放数据 / 公开页面；政府申请门户只给链接，不抓取。 |

## 2. 环境事实（2026-11-05 本会话）

- 本会话网络策略拒绝 `open.canada.ca`、`canadabuys.canada.ca`、`search.open.canada.ca`（代理 403）。适配器按官方开放数据格式实现，测试用**标注为 fixture** 的样本；**尚无真实只读运行证据**。放行这些域名后执行 §4 的真实只读命令。
- Node：容器为 22，仓库要求 24（engines 只告警，测试可跑）。
- 本地 PostgreSQL 16 可用于隔离库测试（`DATABASE_ENVIRONMENT=isolated`）。

## 3. 进度（与 TaskList 同步）

| # | 阶段 | 状态 | 提交 |
|---|---|---|---|
| 0 | 勘察、复用清单、任务书副本、OpenSpec 四件套、TASKFLOW 行 | 完成 | 6f… docs(PROC-1) propose |
| 1a | Prisma 16 张新表 + 增量迁移 + schema-ready 闸 + 迁移登记 | 完成 | 5ae07d5 |
| 1b | 纯函数：编号 / 机构规范化、去重键、多伦多排程、来源解析、优先级（80 项测试） | 完成 | 4a911ac |
| 1c | 扫描执行器 scan-run.ts、source-fetch.ts、instruments.ts、watch-service.ts、seed.ts + 脚本、tender-watch cron 第二步、cockpit 登记 | 代码完成，待 DB 测试 | WIP |
| 2-3 | request-pure / duplicate-check / ready-gate / case-pure（纯）；requests.ts / events.ts / rules.ts / applicants.ts / tasks.ts（DB） | 代码完成，待测试 | WIP |
| 4 | extract-pure.ts / analysis-pure.ts 完成；attachments.ts / analysis.ts / export.ts 进行中 | 进行中 | — |
| 4b | UI：采购监控 / 候选 / 申请台账 / 申请详情 / Tender 情报页卡片 | 未开始 | — |
| 5 | 全量测试、typecheck、lint 基线、隔离演示与截图、报告 | 未开始 | — |

下一步（按序）：attachments.ts（上传 / 解析 / 抽取）→ analysis.ts → export.ts → access.ts + `/api/procurement/**` 路由 → 两组纯测试（records-request-pure、disclosure-analysis-pure）→ 隔离库端到端 → UI → 截图 → 报告。

## 4. 运行与验证命令

- 本地隔离库（本会话做法）：`apt-get install -y postgresql-16-pgvector` → `pg_createcluster 16 qyiso -p 5544 --start` → 建库 `qy_isolated` / 角色 `qy`；
  `DATABASE_URL=postgresql://qy:qy@localhost:5544/qy_isolated DIRECT_URL=同上 npx prisma migrate deploy`。
- 纯测试：`npx tsx src/lib/procurement-records/__tests__/procurement-pure.test.ts`。
- typecheck：`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`（新增 automation key 须同时登记 `src/lib/cockpit/posts.ts` 与 `schedule.ts`）。

## 5. 复用与新增清单（勘察结论，2026-11-05）

| 领域 | 既有能力 | 复用位置 | 新增 | 真实阻塞 |
|---|---|---|---|---|
| 入口 / UI | `/projects/intelligence/*` 情报中枢（`IntelHubShell`），其中「情报监控」「周期采购」是 notEnabled 占位；Tender 详情 5 个一级 Tab（情报 Tab） | `/projects/intelligence/monitor` 改为采购监控与候选；新增 `/projects/intelligence/records` 台账与详情；情报 Tab 加「历史采购与资料申请」卡 | 监控 / 候选 / 台账 / 详情组件 | — |
| 鉴权与组织隔离 | `requireOrgRole`、`requireProjectRead/WriteAccess`、`resolveRequestOrgIdForUser`（显式 orgId 必须是本人 active 成员） | 所有新 API；申请按服务端载入行的 orgId 校验 | — | — |
| 调度 | `tender-watch` cron（每小时 :25 UTC）+ `runTrackedAutomation`（AutomationRun）；`getLocalTimeParts` | 扫描作为该 cron 的第二步；手动扫描用 `after()` 后台执行，cron 兜底续跑 | 运行行唯一槽位认领 + 心跳接管 | — |
| 官方来源 | `tender-intel/canadabuys.ts`：open.canada CKAN 合同数据集（资源 fac950c0…，仓库已实证字段） | 复用 CKAN 查询约定与外部情报总闸 | CanadaBuys 招标公告开放数据 CSV（发现）、已知合同 / call-up 刷新、Completed ATI 摘要检索、合同历史页变更检测 | 本会话网络拒绝官方域名 |
| 文件 | `putPrivateBlob` / `readBlobStream`（私有 Blob）、`upload-guard`、unpdf / xlsx 解析、页级 `OCR_REQUIRED` 约定 | 回执、来信、披露文件上传与解析 | 资料附件表、页 / 表单元表 | 无 OCR → 显示阻塞并允许人工录入 |
| 通知 / 待办 | `createNotification`（sourceKey 幂等）、`Task`（`sourceId + sourceTemplateKey` 唯一） | 扫描结果通知、案件待办 | — | — |
| 金额 / 证据 | `AwardRecord` 词表（HUMAN_CONFIRMED / NEEDS_REVIEW）、Decimal 存储纪律 | 证据等级与复核状态词表 | 明细与分析表（Decimal） | — |
| 数据模型 | 硬纪律 1 零 schema；`T4_AWARD_INTELLIGENCE_SCHEMA_READY` 暗合并闸；`EXPECTED_ACTIVE_MIGRATIONS` 生产构建迁移闸 | 同型 `PROCUREMENT_RECORDS_SCHEMA_READY` 闸 | 增量迁移（仅新表） | 需 Evan 拍板例外；生产迁移按 Owner Gate |
