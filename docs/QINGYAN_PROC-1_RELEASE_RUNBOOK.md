# PROC-1 上线 Runbook（采购情报与政府资料申请）

| 项 | 值 |
|---|---|
| 迁移 | `20261105120000_add_procurement_records_foundation`（只 CREATE 16 张 `Procurement*` / `Records*` 表；sha256 `4e2df98d…f6857`） |
| 例外 | 硬纪律 1 / 3：PROC-1 限定例外（决定 C，Lucas 2026-11-05 批准，写入 `openspec/config.yaml`） |
| 执行人 | 持生产 / staging 库凭证的人（本开发会话**没有**生产凭证，不能代为执行） |
| 批准人 | Evan（合并）；Lucas（业务启用） |
| 依据 | `docs/PHASE5_PRODUCTION_MIGRATION_RUNBOOK.md`（受控迁移流程）、`scripts/safe-migrate-deploy.ts`（双确认闸）、`scripts/predeploy-migration-gate.ts`（生产构建迁移闸） |

## 0. 推荐时间窗

- **生产迁移 + 合并：2026-11-08（周日）20:00–21:00 America/Toronto。** 周日晚使用量最低；完成后第一个生产定时扫描槽位是 **2026-11-09（周一）08:00**，由每小时 :25 的 `tender-watch` 在约 08:25 执行——正好作为业务验收第一步。
- 若周日来不及：任一工作日 20:00 后执行；之后等下一个周一 / 周四 08:00 槽位，或在页面点「立即扫描」。
- **顺序不能反**：先迁移生产库，再合并 PR 到 main。迁移已登记 `EXPECTED_ACTIVE_MIGRATIONS`，生产库缺这条迁移时 `predeploy-migration-gate` 会让生产构建失败（有意设计）。迁移只新增表，旧代码对新表零访问，先迁移是安全的。

## 1. 发布前（T-1 天内）

1. PR 通过审查（`openspec validate procurement-records-requests --strict`、GATE 项）。
2. 本地 / CI：`npm run verify:migration-history`、`bash scripts/test-runtime-architecture.sh`、`npm run lint:baseline`、`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 全部通过。
3. 放行出站域名后跑一次真实只读核对（不连库、不写数据）：

   ```bash
   npx tsx scripts/procurement-records-live-check.ts --out docs/acceptance/proc-1/live-check.json
   ```

   核对：CanadaBuys CSV `missing` 为空；合同披露有返回；记下 Completed ATI 摘要的 datastore 资源 ID（`hasExpectedFields: true` 的那个）。若 CSV 列名不符，先修适配器再上线。
4. 确认 Vercel 生产环境变量现状：`TENDER_EXTERNAL_INTEL_ENABLED`（外部情报总闸，既有开关）当前值。

## 2. staging（先于生产）

```bash
export DATABASE_URL="<staging 库>"   # 勿提交
export DIRECT_URL="<staging 库 direct>"
npm run db:migrate:status                       # 预期：只有 20261105120000_add_procurement_records_foundation 待应用
export ALLOW_DATABASE_MIGRATION=true
npm run db:migrate:deploy
npm run db:migrate:status                       # 预期：up to date
```

Vercel staging：设 `PROCUREMENT_RECORDS_SCHEMA_READY=1`（及第 1 步核实的 `PROCUREMENT_ATI_SUMMARIES_RESOURCE_ID`），部署本分支，烟测第 4 节。

## 3. 生产迁移（受控）

1. 备份：Neon 生产项目建分支 `pre-proc1-prod-20261108`（parent = production）。
2. 记录计数（只读）：`Project`、`Task`、`Notification`、`AutomationRun`。
3. 预检：

   ```bash
   export DATABASE_URL="<生产>"   # 勿提交
   export DIRECT_URL="<生产 direct>"
   npm run db:migrate:status      # 预期：只有 20261105120000_add_procurement_records_foundation 待应用；有其它待应用迁移 → 停止
   ```

4. 执行（双确认闸）：

   ```bash
   export ALLOW_DATABASE_MIGRATION=true
   export CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION
   npm run db:migrate:deploy
   npm run db:migrate:status      # 预期：Database schema is up to date
   ```

5. 验表（只读）：

   ```sql
   SELECT count(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name IN (
     'ProcurementWatch','ProcurementScanRun','ProcurementInstrument','ProcurementInstrumentRelation',
     'ProcurementTenderLink','ProcurementSourceEvidence','RecordsApplicantProfile','RecordsRuleProfile',
     'RecordsLedgerAttestation','RecordsRequest','RecordsRequestVersion','RecordsRequestEvent',
     'RecordsAttachment','RecordsAttachmentUnit','ProcurementLineItem','ProcurementAnalysis');   -- 预期 16
   ```

   再核对第 2 步计数不变。

**禁止**：`migrate reset`、`db push`、删除 `_prisma_migrations` 行、改迁移 SQL、借 `npm run build` 触发迁移。

## 4. 置位、合并与烟测

1. Vercel 生产：设 `PROCUREMENT_RECORDS_SCHEMA_READY=1`；确认 `TENDER_EXTERNAL_INTEL_ENABLED=1`；如已核实，设 `PROCUREMENT_ATI_SUMMARIES_RESOURCE_ID`。
2. Evan 合并 PR → 生产自动部署（迁移闸此时通过）。
3. 烟测：
   - 登录后打开 `/projects/intelligence/monitor`：显示「未启用」，无报错；
   - `GET /api/procurement/watch?orgId=<orgId>` 返回 `available: true`；
   - `/projects/intelligence/records` 可打开；任一 Tender 详情「情报」Tab 显示「历史采购与资料申请」卡（或无关联时的提示）。

## 5. 业务启用（Lucas）

1. 种子（先 dry-run，确认后 `--write`；需生产库凭证与 `PROCUREMENT_RECORDS_SCHEMA_READY=1`）：

   ```bash
   npx tsx scripts/procurement-records-seed.ts --org <Sunny orgId> --user <Lucas userId> --with-history-case
   ```

2. 「资料申请」→ 机关申请规则：打开 S1 / S2 / S5 官方页面核对联邦 ATI 入口、CAD 5、30 个日历日，填入口与核实方法，标为已核实（非正式副本规则同样核实）。
3. 申请人资料：填写当前公司 / 代表人 / 地址 / 邮箱（不要从旧回复信复制），核对后确认。
4. 历史台账：导入其它历史申请（JSON），或确认「此范围没有历史申请」。
5. 三条种子合同：按所需记录核实资料持有机关（PSPC 还是 CSC / CORCAN / DND）并填写依据。
6. 「情报监控（采购）」→ 编辑配置 →「保存并启用监控」。

## 6. 业务验收（不能用 fixture 代替）

- 周一 08:25 左右第一个生产定时扫描完成：页面「最近一次实际成功运行」有时间，来源表有真实结果（或明确的 PARTIAL / UNAVAILABLE 原因）；`AutomationRun` 有 `procurement-watch` 记录。
- 一张申请卡走到 READY → 交接 → 你在官方门户自行提交并付款 → 回来登记提交并上传真实回执 → 核对为 SUBMITTED（document_verified）。
- 结果写入 `docs/QINGYAN_PROC-1_REPORT.md` §10，TASKFLOW PROC-1 改为 `[x]`，随后 `/opsx:archive procurement-records-requests`（独立小 PR）。

## 7. 回滚

- **功能回滚（首选）**：删除 / 置空 `PROCUREMENT_RECORDS_SCHEMA_READY` 并重新部署 → 所有入口回到「尚未启用」，cron 步骤跳过，新表零访问；数据全部保留。
- **停扫描不停功能**：页面「停用」→ 排队运行取消、运行中的在下一个来源前收尾，候选与案件保留。
- **应用回滚**：回滚到上一个部署；新表保留（向前兼容，不 drop）。
- **迁移失败**：停止；`npm run db:migrate:status` 查看失败状态；对照备份分支确认只涉及新表；形成修复方案并经批准后再 `prisma migrate resolve` / 前向修复。不删除 `_prisma_migrations`、不 drop 既有表。
