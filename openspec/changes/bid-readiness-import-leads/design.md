# Design：投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录

## Context

- 阶段决定（TI-3b，`decideStages`）是纯函数：输入「手头材料」与来源连接状态。「进口线索」阶段取决于来源 `LICENSED_TRADE_DATA`（缺省未接通），手头有 `IMPORT_LEADS` 时决定为「执行」，说明「只处理人工提供的进口线索」。
- 投标工作区读取（TI-4a）由 `deriveMaterials` 从实际数据推导材料：文件数、已存价格表、已存领取方名单、已报价的供应商行数；`IMPORT_LEADS` 从没被推导过。
- CHAIN-3 把进口记录存为 `SupplierDiscoverySignal`：`orgId`、`projectId`、`platform = "TRADE_DATA"`、`rawMetadataJson.kind = "import_lead_v1"`；挂上 / 待确认 / 否决按最新的别名裁决在读的时候算；信号本身的 `status` 由既有供应链流程改（NEW / REVIEWED / LINKED / REJECTED）。开关 `TENDER_IMPORT_LEADS_ENABLED` 关时接口 404、槽位是规划占位。

## Goals / Non-Goals

**Goals**：项目有导入的进口记录时，阶段表如实说「执行（只处理人工提供的进口线索）」；开关关或没有记录时与现在逐字节相同。

**Non-Goals**：
- `src/lib/tender-bid-readiness/stage-policy.ts`（策略表与说明文字；主规格只改正文措辞，见 Risks）。
- `src/lib/tender-import-leads/service.ts`、`match-pure.ts`、`aggregate-pure.ts`（导入、匹配、汇总）。
- 「历史授标与采购」阶段的 `AWARD_RECORDS` 推导。
- `src/components/tender/bid-workspace-panel.tsx` 只改两处：未接通清单的标题、取决于来源的阶段写出说明（其余照旧）。

## Decisions

### D1：材料「进口线索」= 本项目有一条未被标为不采用的导入记录（CHAIN-3 的 `storedLeadCount` 口径）

条件：`orgId` = 项目组织、`projectId` = 本项目、`platform = "TRADE_DATA"`、`rawMetadataJson.kind = "import_lead_v1"`、`status ≠ "REJECTED"`（供应链页上的「不采用」）。这就是 CHAIN-3 读视图里 `storedLeadCount`（「已导入 N 条」）的口径：对 CHAIN-3 导入写入的记录，材料存在 ⇔ `storedLeadCount > 0`（隔离库测试在开关开着的各步核对；`storedLeadCount` 另要求元数据完整、只看最早 5000 条，CHAIN-3 写入的记录都满足）。CHAIN-3 导入写 `NEW`，加入供应商库后变 `LINKED`（也算）。

- 备选 A：只数当前「挂上」的（读时按别名裁决与中标者名单重算）。否决：要加载中标者名单与裁决、重跑比对，读取工作区的代价变大；阶段表回答的是「该不该处理」，人已经提供了线索就该处理——哪几条挂上、哪几条待确认是供应链槽的事，阶段说明「只处理人工提供的进口线索」也没有说「都已挂上」。
- 备选 B：连 `REJECTED` 也算。否决：在供应链页被人标为不采用的线索，不应再让阶段说「有材料」。
- 备选 C：不看 `rawMetadataJson.kind`、数所有 `TRADE_DATA` 信号。否决：供应链发现流程（`createDiscoveredSignal`）也能写 `TRADE_DATA` 信号（带的是搜索来源的元数据），那不是人工提供的进口线索；授权数据接通应由来源状态表达。

### D2：跟随进口线索导入开关

组织没开 `TENDER_IMPORT_LEADS_ENABLED`（或不在白名单）时不查、不算——与 CHAIN-3「关时零影响」一致；关掉开关后历史导入的记录也不再让阶段变「执行」。

- 备选：不看开关，只看有没有记录。否决：开关关时用户看不到这些记录，阶段却说「执行」，对不上。

### D3：「有没有」放进 `src/lib/tender-import-leads/` 的一个轻量新文件，工作区只拿一个布尔

新增 `src/lib/tender-import-leads/readiness-count.ts`：`hasImportLeadsForReadiness({ orgId, projectId })` → 布尔（开关判定在里面；开关关时不查库）。用 `findFirst({ select: { id: true } })` 判存在，找到一条就停。这个文件只依赖 `@/lib/db` 与 `./flags`：平台与 kind 两个值写成字面量，单测断言它们与 `service.ts` 的 `IMPORT_LEAD_PLATFORM`、`IMPORT_LEAD_KIND` 相等，并用源码断言锁住 import（工作区读取会被成本核算、「下一步」卡带进来，不能拖进 `service.ts` 的整串依赖——先例：`tender-submission/read.ts` 的 import 断言）。`loadWorkspaceContext` 与其它查询并行调用它，结果放进 `WorkspaceContext.hasImportLeads`（可选，缺省按没有）；`deriveMaterials` 在为 true 时加 `IMPORT_LEADS`。出错不另外兜底：与 `loadWorkspaceContext` 里其它查询相同，抛错就让读取失败。

- 备选 A：在 `store.ts` 里直接查信号表。否决：「什么算一条导入记录」（平台、kind、不采用）是 CHAIN-3 的约定，应留在 CHAIN-3 目录里。
- 备选 B：直接 import `service.ts` 的常量。否决：会把匹配、汇总、供应商服务等一整串模块带进工作区读取。
- 备选 C：出错时按「没有」处理并 warn。否决：`loadWorkspaceContext` 里其它查询都不兜底，只给这一条兜底会让口径不一致；真出错时现在的行为（读取失败）更容易被发现。
- 备选 D：数条数（`count`）。否决：只需要「有没有」，`count` 要扫完本组织所有 `TRADE_DATA` 行。

## 八条硬纪律

1. 零 schema：遵守（只读既有 `SupplierDiscoverySignal`，不改 `prisma/`）。
2. 出站先审批：不涉及（只读）。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及（读取结果只多一个材料键，不带任何线索内容或金额）。
5. 不爬登录页：不涉及（不访问任何网站）。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守（一次存在性查询，零模型调用）。
8. 测试注册：新隔离库测试登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- 纯函数：`npx tsx src/lib/tender-bid-workspace/__tests__/workspace-view.test.ts`（`hasImportLeads` 缺省 / false / true 时的材料与「进口线索」阶段决定；缺省与 false 的读取结果 `JSON.stringify` 相同；既有断言原样不动）。
- 隔离库：`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/readiness-count-db.isolated.test.ts`——经 CHAIN-3 真实导入接口导入一条（开 T4 授标开关与授标 fixture）；开关关 → false 且读取结果不变；开关开、无记录 → false；有一条 → true；标为不采用 → false；别的项目、别的组织的记录、非 `import_lead_v1` 的 `TRADE_DATA` 信号不算；每一步都核对与 `loadImportLeadsView().storedLeadCount > 0` 一致；并经 `GET` 投标工作区读取看到「进口线索」阶段为执行、不在未接通清单里。单测断言两个字面量与 `service.ts` 常量相等、`readiness-count.ts` 只 import `@/lib/db` 与 `./flags`。
- 既有不改期望：`stage-policy.test.ts`、`workspace-view.test.ts` 既有断言、`bid-workspace-db.isolated.test.ts`、`readiness-submission-db.isolated.test.ts`、CHAIN-3 的 `import-leads.test.ts` 与 `import-leads-db.isolated.test.ts`。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`。

## Risks / Trade-offs

- 存着但在供应链槽里不显示的情形，阶段仍说「执行」：导入的记录全部因别名被否决、采购方改了名、中标者读不出或授标情报开关关着（槽里写「已导入 N 条……」）。说明是「只处理人工提供的进口线索」，没有说有几条挂上，与槽里「已导入 N 条」一致；可接受（D1 备选 A）。
- 「未接通的来源」清单里不再出现「授权贸易 / 提单数据」，但这个来源本身仍没接通（进口线索面板照旧写明「未接通」）。
- 读取工作区多一次查询：信号表没有带 `projectId` 的索引（只有 `[orgId, platform]` 等），按 `orgId + platform` 走索引再过滤；`findFirst` 找到一条就停，没有导入记录的项目要扫完本组织的 `TRADE_DATA` 行（上限约为每项目 5000 条 × 有导入的项目数，另加发现流程写的信号）；两个开关都开时，投标工作区读写、成本核算、项目页「下一步」卡都会跑这一次。零 schema，不加索引。
- 阶段策略主规格「未接通的来源不询问、不执行」的正文写「未接通 → 未接通」，场景与代码是「有人工材料 → 执行」；本 change 让这条路径第一次在线上出现，所以一并用 MODIFIED 把正文改成与场景、代码一致（不改 `stage-policy.ts`）。面板的未接通清单标题改为「未接通、也没有人工材料的来源」，取决于来源的阶段在下面写出说明（触屏、读屏看不到悬停提示）。
- 已被移出组织、但项目成员记录还在的人能读投标工作区（只要项目读权限），能从阶段变「执行」看出「有导入记录」（看不到内容）；影响可忽略。
