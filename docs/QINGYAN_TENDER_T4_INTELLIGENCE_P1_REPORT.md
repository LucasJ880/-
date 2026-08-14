# 青砚 Tender T4 — Intelligence Foundation P1 报告

日期：2026-08-14 ｜ 分支：`feature/tender-t4-p1-t5-convergence`（基线 main @ `48200b9`）｜ 状态：**P1_COMPLETE + 终验 PASS + Final Review 整改完成**

## 0. 生产激活 Runbook（冻结；merge 后按序执行，本轮零生产操作）

**前提事实（隔离演练实证）**：main merge → Vercel 项目 `-` **自动生产部署**（近期 production
deployments `source=git, branch=main`）。生产库存在 **marketing_economics drift**：
`MarketingEconomicsSetting` 表+全部索引已存在，但 `_prisma_migrations` 未登记 →
`migrate deploy` 恒在该迁移 42P07 失败，T2/T3/T4 迁移全部被卡。

因此 PR #107 以 **schema-ready gate**（`T4_AWARD_INTELLIGENCE_SCHEMA_READY`，默认 OFF，
复用 T2 `project-ledger/flags.ts` canonical 模式）保证 dark-merge 安全：
gate OFF 时对 AwardRecord/AwardRecordSource **0 次访问**（org API 返回
`available:false, reason:"SCHEMA_NOT_READY"`；组织页显示「尚未启用」；人工确认走兼容策略 B）。

**人工确认兼容策略 = B（已批准语义）**：gate OFF 时保持 merge 前行为——仅写
`room.summaryJson.externalConfirmed`（项目级调查结论照常可用），响应
`awardRecordId:null, canonical:"SCHEMA_NOT_READY"`。一致性契约：externalConfirmed 保留
vendor/value/date/sourceUrl 全量结构化上下文，schema ready 后可按同一 sourceKey 推导规则
**幂等补偿 materialize**（确定性 sweep，非双 source-of-truth）。

**激活步骤（每步有 gate，禁止 blind resolve）**：
1. 只读取证 marketing_economics drift：`SELECT ... information_schema.tables / pg_indexes`
   逐对象列出生产实际状态（本轮隔离演练脚本可复用）
2. 逐对象确认生产 schema 与 `20260805090000_marketing_economics/migration.sql` **等价**
   （表 + 唯一索引 + 普通索引一一对应；不等价 → STOP，人工裁决）
3. 仅当等价：`prisma migrate resolve --applied 20260805090000_marketing_economics`
4. `prisma migrate deploy` → 依序应用 T2（20260811002000）/ T3（20260811040000）/
   T4（20260814150000）——隔离演练已验证此路径全绿
5. 验证：AwardRecord / AwardRecordSource 存在，
   `AwardRecordSource_orgId_sourceType_sourceKey_key` 唯一约束 + 全部索引 + FK(RESTRICT) 存在
6. 生产环境置 `T4_AWARD_INTELLIGENCE_SCHEMA_READY=1` 并 redeploy
7. 生产烟测：org awards API `available:true`；一次真实检索→确认→组织页可见；
   （可选）对既有 externalConfirmed 执行幂等补偿 sweep

## 1. 本轮之前已有什么（审计结论）

| 层 | 现状（PR #106 后） |
|---|---|
| SEARCH RESULT | `room.summaryJson.externalCandidates`（M1 CanadaBuys 交叉验证候选）+ `summaryJson.webIntel`（M2 Tavily） |
| AI INFERENCE | `summaryJson.externalAnalysis`（M2.5 分析师，八模块 AI_RESEARCHED 态） |
| HUMAN CONFIRMED FACT | `summaryJson.externalConfirmed` —— **仅项目级**，且金额在确认瞬间被折叠成展示字符串（`CAD 40,000（2024-05-01）`），结构化数据丢失 |
| CANONICAL ORG INTELLIGENCE | **不存在**（AWARD_RECORD_BEFORE = MISSING；`/projects/intelligence/awards` = notEnabled 占位） |

T3 corporate-memory 提供：词表（confidence HIGH/MEDIUM/LOW；verificationStatus AI_EXTRACTED/HUMAN_CONFIRMED/
SYSTEM_VERIFIED/NEEDS_REVIEW）、`normalizeBuyerName` 纯 normalizer、schema 纪律（cuid/无 FK 逻辑引用/String
词表+/// 注释/service 层 org 隔离）。**无受控 resolveBuyer 读 API**（T3 已知缺口，本轮不补、不绕）。

## 2. 本轮新增

**Schema（ADDITIVE ONLY，迁移 `20260814150000_add_tender_t4_award_record_foundation`）**
- `AwardRecord`：orgId 隔离；buyerId 逻辑引用（本轮恒 null，见 §5）+ buyerNameRaw/Normalized 文本身份；
  winnerName/Normalized；solicitationNumber；awardDate；`contractAmount Decimal(18,2)`（结构化，不再折叠字符串）；
  confidence/verificationStatus 复用 T3 词表；status ACTIVE/NEEDS_REVIEW/RETRACTED + possibleDuplicateOfId；
  confirmedById/At 人工留痕；createdByType user|system
- `AwardRecordSource`：1→N provenance（sourceType/sourceKey/sourceUrl/verbatim evidenceSnippet/capturedAt），
  **幂等锚点 `@@unique([orgId, sourceType, sourceKey])`**，IMMUTABLE 只 create，onDelete: Restrict

**Canonical service（`src/lib/tender-intel/awards.ts`——唯一合法写路径）**
- `createOrObserveAwardRecord`：幂等（同源重放→ALREADY_OBSERVED）；确定性同一性
  （solicitationNumber+winner 或 winner+date+amount 精确 → 挂源既有记录；同 winner+buyer 弱信号 →
  NEEDS_REVIEW+possibleDuplicateOfId 留人工，**绝不 fuzzy merge**）；verificationStatus 只升不降
- `confirmAwardRecord`：user actor 专属，白名单 patch，HUMAN_CONFIRMED+actor/time
- `listAwardsForOrg` / `listAwardsForBuyer` / `getAwardEvidence`：org 隔离 fail-closed
- Gates：ai/agent actor → `AWARD_AI_WRITE_DISABLED`；system 冒充人工 → `HUMAN_CONFIRM_REQUIRES_USER`；
  非权威来源冒充 SYSTEM_VERIFIED → 拒绝

**Read model（`award-intelligence.ts`，纯函数确定性投影）** —— 七域：
1 历史授标（未确认记录金额不进数字层）；2 买家采购模式；3 采购周期（evidence-backed 日期样本 <3 → UNKNOWN/
INSUFFICIENT_SAMPLES）；4 竞争对手（confirmed 仅来自 evidence-backed；AI 提及=线索）；5 价格历史
（evidence-backed only，按币种分组绝不合并）；6 可比项目 = UNKNOWN（数据源未接，诚实）；7 供应链 = UNKNOWN（M3）

**接线**
- 人工确认路由（`POST /api/projects/[id]/external-intel/award-history`）：**同一 `$transaction`** 写
  AwardRecord + summaryJson 投影，任一失败整体回滚（无静默半成功）；确认幂等键确定性，重复点击不产生重复记录
- 面板直通结构化上下文（buyerName/referenceNumber/verbatim snippet）
- `GET /api/org/tender-awards`（READ-ONLY）+ `/projects/intelligence/awards` 真实页面
  （verificationStatus 分层徽标、买家/中标方/时间过滤、confirmed/线索永不混排）
- `scripts/tender-t4-award-backfill-dry-run.ts`：已结 Tender 只读盘点（拒生产端点），零写入

**测试**：T4-01..T4-10（20 断言，内存 fake 注入）全绿；tender-intel 既有 28 + T3 纯测回归全绿；tsc/eslint 干净。

## 3. Source of truth 边界（强制定义）

```
BidIntelligenceRoom.summaryJson = 项目级调查工作台（临时投影，项目死则弃）
AwardRecord                    = 组织级 canonical 授标情报（长期，跨 Tender 复用）
AI_RESEARCHED                  → 永不自动进入 AwardRecord confirmed truth
human confirmed                → 经 canonical service 物化（HUMAN_CONFIRMED + actor 留痕）
权威公开记录（CanadaBuys+ref#） → SYSTEM_VERIFIED 落地，provenance 完整保留
竞争对手提及 ≠ 授标事实         → 不落 AwardRecord；canonical 竞争对手只能由 evidence-backed 记录推导
数字（金额/周期/次数）           → 只能溯源到 AwardRecord/Project/公开来源；AI 只解释，不产数字
```

## 4. 仍未完成（诚实清单）

- **DB 实库演练**：迁移 SQL 与 service 均通过纯测/typecheck，但未在隔离 Neon 分支跑真实
  `prisma migrate` + 实库幂等回归（DB_VALIDATION = NOT_RUN_THIS_SESSION；merge 前建议补）
- buyerId 受控 linkage（等 T3 提供 sanctioned resolveBuyer 读 API；文本身份已可支撑分组/检索）
- 项目情报页「按 Buyer 自动带出组织授标历史」的最小连接（BUYER_HISTORY 服务层已通，项目 Tab 未接）
- own-project backfill 实际执行（本轮仅 dry-run 盘点；materialize 须人工批准 + 隔离演练）
- `/projects/intelligence/competitors` 读 canonical 投影（awards 页已含竞争对手块，独立页未动）
- 分析完成时自动把 CanadaBuys 强候选以 AI_EXTRACTED/SYSTEM_VERIFIED 观察落 AwardRecord
  （当前仅人工确认路径写入；自动观察是安全增量，留下轮）
