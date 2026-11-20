# Design：投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录

## Context

- 阶段决定（TI-3b，`decideStages`）是纯函数：输入「手头材料」与来源连接状态。「进口线索」阶段取决于来源 `LICENSED_TRADE_DATA`（缺省未接通），手头有 `IMPORT_LEADS` 时决定为「执行」，说明「只处理人工提供的进口线索」。
- 投标工作区读取（TI-4a）由 `deriveMaterials` 从实际数据推导材料：文件数、已存价格表、已存领取方名单、已报价的供应商行数；`IMPORT_LEADS` 从没被推导过。
- CHAIN-3 把进口记录存为 `SupplierDiscoverySignal`：`orgId`、`projectId`、`platform = "TRADE_DATA"`、`rawMetadataJson.kind = "import_lead_v1"`；挂上 / 待确认 / 否决按最新的别名裁决在读的时候算；信号本身的 `status` 由既有供应链流程改（NEW / REVIEWED / LINKED / REJECTED）。开关 `TENDER_IMPORT_LEADS_ENABLED` 关时接口 404、槽位是规划占位。

## Goals / Non-Goals

**Goals**：项目有导入的进口记录时，阶段表如实说「执行（只处理人工提供的进口线索）」；开关关或没有记录时与现在逐字节相同。

**Non-Goals**：
- `src/lib/tender-bid-readiness/stage-policy.ts`（策略表与说明文字）。
- `src/lib/tender-import-leads/service.ts`、`match-pure.ts`、`aggregate-pure.ts`（导入、匹配、汇总）。
- 「历史授标与采购」阶段的 `AWARD_RECORDS` 推导。
- `src/components/tender/bid-workspace-panel.tsx`（面板照旧按读取结果显示）。

## Decisions

### D1：材料「进口线索」= 本项目有一条未被标为不采用的导入记录

计数条件：`orgId` = 项目组织、`projectId` = 本项目、`platform = "TRADE_DATA"`、`rawMetadataJson.kind = "import_lead_v1"`、`status ≠ "REJECTED"`。有一条就算有这份材料。

- 备选 A：只数当前「挂上」的（读时按别名裁决与中标者名单重算）。否决：要加载中标者名单与裁决、重跑比对，读取工作区的代价变大；阶段表回答的是「该不该处理」，人已经提供了线索就该处理——哪几条挂上、哪几条待确认是供应链槽的事，阶段说明「只处理人工提供的进口线索」也没有说「都已挂上」。
- 备选 B：连 `REJECTED` 也算。否决：在供应链页被人标为不采用的线索，不应再让阶段说「有材料」。
- 备选 C：数 `rawMetadataJson.kind` 以外的所有 `TRADE_DATA` 信号。否决：`TRADE_DATA` 将来可能有授权数据写入的信号，那应由来源状态（接通）表达，不是人工材料。

### D2：跟随进口线索导入开关

组织没开 `TENDER_IMPORT_LEADS_ENABLED`（或不在白名单）时不查、不算——与 CHAIN-3「关时零影响」一致；关掉开关后历史导入的记录也不再让阶段变「执行」。

- 备选：不看开关，只看有没有记录。否决：开关关时用户看不到这些记录，阶段却说「执行」，对不上。

### D3：计数放进 `src/lib/tender-import-leads/` 的一个新文件，工作区只拿一个数

新增 `src/lib/tender-import-leads/readiness-count.ts`：`countImportLeadsForReadiness({ orgId, projectId })` → 数字（开关判定在里面）。`loadWorkspaceContext` 并行调用它，结果放进 `WorkspaceContext.importLeadCount`（可选，缺省按 0）；`deriveMaterials` 在 `importLeadCount > 0` 时加 `IMPORT_LEADS`。计数出错时按 0 处理并记一条 warn（与工作区里其它可选读取相同：不让整个读取失败）。

- 备选：在 `store.ts` 里直接查信号表。否决：「什么算一条导入记录」（平台、kind）是 CHAIN-3 的约定，应留在 CHAIN-3 目录里，一处定义。
- 备选：计数出错时让读取 500。否决：阶段表只是辅助判断，一项材料读不到不该让整个工作区打不开；按「没有」处理就回到现在的行为。

## 八条硬纪律

1. 零 schema：遵守（只读既有 `SupplierDiscoverySignal`，不改 `prisma/`）。
2. 出站先审批：不涉及（只读）。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及（读取结果只多一个材料键，不带任何线索内容或金额）。
5. 不爬登录页：不涉及（不访问任何网站）。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守（一次计数查询，零模型调用）。
8. 测试注册：新隔离库测试登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- 纯函数：`npx tsx src/lib/tender-bid-workspace/__tests__/workspace-view.test.ts`（`importLeadCount` 缺省 / 0 / 1 时的材料与「进口线索」阶段决定；缺省时与现在逐字节相同）。
- 隔离库：`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/readiness-count-db.isolated.test.ts`——开关关 → 0；开关开、无记录 → 0；有一条 → 1；`REJECTED` 不算；别的项目、别的组织的记录不算；非 `import_lead_v1` 的 `TRADE_DATA` 信号不算；并经 `GET` 投标工作区读取看到「进口线索」阶段为执行、不在未接通清单里。
- 既有不改期望：`stage-policy.test.ts`、`workspace-view.test.ts` 既有断言、`bid-workspace-db.isolated.test.ts`、`readiness-submission-db.isolated.test.ts`、CHAIN-3 的 `import-leads.test.ts` 与 `import-leads-db.isolated.test.ts`。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`。

## Risks / Trade-offs

- 导入的记录全部因别名被否决而在供应链槽里不显示时，阶段仍说「执行」：说明是「只处理人工提供的进口线索」，没有说有几条挂上；可接受（D1 备选 A）。
- 读取工作区多一次计数查询（走 `orgId` / `projectId` / `platform` 过滤，数据量受 CHAIN-3 每项目 5000 条上限约束）。
