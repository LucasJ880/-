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
| 硬纪律 1「零 schema」例外 | **已批准**（决定 C，Lucas 2026-11-05） | 只新增 16 张表；已写入 `openspec/config.yaml` 第 1 条；合并仍由 Evan 拍板；生产迁移按 `docs/QINGYAN_PROC-1_RELEASE_RUNBOOK.md`。 |
| 硬纪律 3「不新增队列/租约」 | **已批准限定例外**（决定 C） | `ProcurementScanRun` 认领令牌 + 心跳只服务 tender-watch 里的扫描；3 个新表名已手工登记 R1 baseline；写入 config.yaml 第 3 条。 |
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
| 0 | 勘察、复用清单、任务书副本、OpenSpec 四件套、TASKFLOW 行 | 完成 | docs(PROC-1) propose |
| 1a | Prisma 16 张新表 + 增量迁移 + schema-ready 闸 + 迁移登记 | 完成 | 5ae07d5 |
| 1b | 纯函数：编号 / 机构规范化、去重键、多伦多排程、来源解析、优先级（80 项测试） | 完成 | 4a911ac |
| 1c | 扫描执行器、来源抓取、采购工具幂等写入、种子 + 脚本、tender-watch 第二步、cockpit 登记 | 完成 | 1057f0e |
| 2-3 | 申请卡 / 重复检查 / READY / 状态 / 期限 / 回执 / 旧状态映射（纯）+ requests / events / rules / applicants / tasks（DB） | 完成 | 1057f0e |
| 4 | 附件解析 / 抽取 / 分析 / 导出 / 读模型 / 鉴权 / `/api/procurement/**` 路由 | 完成 | 1057f0e |
| 测试 | 纯测试 80 + 86 + 50；隔离库端到端 138（fixture） | 通过 | 1057f0e |
| 4b | UI：采购监控 / 候选 / 申请台账 / 申请详情 / Tender 情报页卡片；演示脚本与截图 | 完成 | 81466e0 |
| 5 | typecheck 通过；隔离库端到端 142；报告 `docs/QINGYAN_PROC-1_REPORT.md`；全量 npm test 与 lint 基线结果见报告 §3.1 | 完成（待 GATE） | 701e325 |
| 6 | 省级机关规则种子（安省 FIPPA + 多伦多 MFIPPA、BC、曼省、魁省、阿省），纯数据拆到 `rule-seeds.ts`；辖区加 `CA-QC` / `CA-AB`；纯测试 108、隔离库 146 | 完成（种子未核实，来源为网络检索摘要，见报告 §6a） | 76b5ddb |
| 6b | 萨省种子由占位改为 FOIP 省政府机关缺省（免申请费、30 个日历日；地方机关 LA FOIP 另行核实）；纯测试 110 | 完成（未核实） | 本提交 |

下一步：Draft PR https://github.com/LucasJ880/-/pull/382 已开 → Evan 审查合并前，先按 `docs/QINGYAN_PROC-1_RELEASE_RUNBOOK.md` 在 staging / 生产执行受控迁移（迁移先于合并，否则生产构建被迁移闸拦住）；放行官方域名后跑 `scripts/procurement-records-live-check.ts` 做首次真实只读核对；然后种子、规则核实、申请人确认、台账确认、启用监控，做业务验收。

## 4. 运行与验证命令

- 本地隔离库（本会话做法）：`apt-get install -y postgresql-16-pgvector` → `pg_createcluster 16 qyiso -p 5544 --start` → 建库 `qy_isolated` / 角色 `qy`；
  `DATABASE_URL=postgresql://qy:qy@localhost:5544/qy_isolated DIRECT_URL=同上 npx prisma migrate deploy`。
- 纯测试：`npx tsx src/lib/procurement-records/__tests__/{procurement-pure,records-request-pure,disclosure-analysis-pure}.test.ts`。
- 隔离库端到端：`DATABASE_URL=postgresql://qy:qy@localhost:5544/qy_isolated DIRECT_URL=同上 NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/procurement-records/__tests__/procurement-records-db.isolated.test.ts`（自带清理，可重复运行）。
- 首次真实只读核对（不连库、不写数据）：`npx tsx scripts/procurement-records-live-check.ts --out docs/acceptance/proc-1/live-check.json`（需放行官方域名；本会话 2026-11-05 复测仍被拒）。
- 上线：`docs/QINGYAN_PROC-1_RELEASE_RUNBOOK.md`（推荐 2026-11-08 周日 20:00 多伦多迁移 + 合并；周一 08:25 首个生产扫描）。
- 演示：`scripts/procurement-records-demo.ts`（仅隔离库、全部 fixture）→ 输出 cookie；`next dev` 需同 JWT_SECRET 与 `PROCUREMENT_RECORDS_SCHEMA_READY=1 PRODUCT_CONTENT_LOCAL_STORE=1`；截图脚本思路见报告 §4。
- 注意：路由里的 `after()` 在测试进程外无请求上下文，端到端测试对「立即扫描 / 上传」直接调服务函数（enqueueManualRun + executeScanRun、saveAttachment + processAttachment），路由层只测鉴权分支。
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
