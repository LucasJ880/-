# CHAIN-3b 报告 — 投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录（`bid-readiness-import-leads`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-3b（Phase F（续）— 情报串联的后续） |
| 起因 | CHAIN-3 的 Out of scope；交接文档第四十四次 §0.5h「之后还有什么」第 4 条 |
| 拍板 | Lucas 2026-11-20：「投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录。」 |
| OpenSpec change | `openspec/changes/bid-readiness-import-leads/`（修改 `tender/bid-workspace` 1 条、`tender/stage-policy` 1 条（只改正文措辞）、`tender/bid-workspace-panel` 1 条） |
| 基线 | origin/main `91d928e4` |
| 开关 | 没有新开关：跟随进口线索导入（`TENDER_IMPORT_LEADS_ENABLED` + 白名单）与投标工作区的既有开关 |

## 1. 做了什么

| 场景 | 以前 | 现在 |
|---|---|---|
| 项目有 CHAIN-3 导入的进口记录（未被标为不采用），组织开了导入 | 「进口线索」阶段：未接通，「授权贸易 / 提单数据未接通；这不表示没有记录，而是没有查」，列在「未接通的来源」 | 「手头材料」多一项「进口线索」，阶段为「执行」，说明「只处理人工提供的进口线索」，从未接通 / 仅人工清单里消失 |
| 开关关、或项目没有导入记录 | — | 读取结果与以前逐字节相同（纯函数与隔离库都核对） |
| 面板 | 清单标题「未接通的来源」；取决于来源的阶段说明只在悬停提示里 | 标题「未接通、也没有人工材料的来源」；历史授标与采购、进口线索两个阶段在阶段标签下面写出 `{阶段}：{说明}`（触屏、读屏也看得到） |

「有没有」的口径与 CHAIN-3 槽里「已导入 N 条」（`storedLeadCount`）相同：本组织、本项目、平台 `TRADE_DATA`、`rawMetadataJson.kind = import_lead_v1`、状态不是 `REJECTED`。用 `findFirst`，找到一条就停；读取结果只多一个布尔推导出的材料，**不含**进口记录的条数或内容。

阶段策略表（`src/lib/tender-bid-readiness/stage-policy.ts`）不改。主规格 `tender/stage-policy`「未接通的来源不询问、不执行」的正文写「未接通 → 未接通」，而既有场景与代码是「有人工材料 → 执行」；这条路径本次第一次在线上出现，所以用 MODIFIED 把正文改成与场景、代码一致（场景逐字保留）。

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/tender-import-leads/readiness-count.ts`（新） | `hasImportLeadsForReadiness({ orgId, projectId })`：开关关不查库；只依赖 `@/lib/db` 与 `./flags`（被投标工作区、成本核算、「下一步」卡带进去，不拖进导入服务）；平台与 kind 写成字面量，测试核对与 `service.ts` 相同 |
| `src/lib/tender-bid-workspace/workspace-view.ts` | `WorkspaceContext.hasImportLeads`（可选，缺省按没有）；`deriveMaterials` 为 true 时加 `IMPORT_LEADS` |
| `src/lib/tender-bid-workspace/store.ts` | `loadWorkspaceContext` 与其它查询并行取这一项 |
| `src/components/tender/bid-workspace-panel.tsx` | 清单标题；取决于来源的阶段写出说明 |
| 测试 | `workspace-view.test.ts`、`import-leads.test.ts`、`panel-helpers.test.ts` 加用例与源码断言；新隔离库 `readiness-count-db.isolated.test.ts`（已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`） |

`loadWorkspaceContext` 的其它调用方也多这一次查询：成本核算接口（不用材料，输出不变）、项目页「下一步」卡（只用价格表与可投标判定的阻断项，输出不变）、投标工作区保存（`PUT` 返回的 `view` 随之变化）。

## 3. 测试

| 测试 | 结果 |
|---|---|
| `tender-bid-workspace/__tests__/workspace-view.test.ts` | 33 通过（新：有导入记录 → 材料多一项、阶段执行、不在两张清单；缺省与 false 的结果相同） |
| `tender-import-leads/__tests__/import-leads.test.ts`（本分支，不含 CHAIN-3c） | 109 通过（新：字面量与 `service.ts` 相同；`readiness-count.ts` 只 import 两个模块；`store.ts` 只引这个轻量模块） |
| `tender-bid-workspace/__tests__/panel-helpers.test.ts` | 43 通过（新：清单标题、说明行） |
| 隔离库 `readiness-count-db.isolated.test.ts`（新） | 16 通过：经真实导入接口导入一条前后，每一步与 CHAIN-3 读视图的「已导入 N 条」一致；经真实 `GET` 投标工作区读取看到阶段执行、不在未接通清单；读取结果里搜不到进口商、出口商、品名与来源网址；别的项目、别的组织、别的平台、别的 kind 的信号都不算；开关关时库里有记录也不算，整份读取结果与没有导入记录的项目完全相同；唯一一条标为不采用后回到未接通；外部请求 0 |
| `tender-bid-readiness/__tests__/stage-policy.test.ts`、隔离库 `bid-workspace-db` / `readiness-submission-db` / `import-leads-db` | 25 / 49 / 24 / 34 通过，不改期望 |

## 4. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（本机，带隔离库） | 待跑（见下次更新） |
| `npm run test:ci` | 待跑 |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增指纹） |
| `openspec validate bid-readiness-import-leads --strict` | valid |
| `git diff origin/main -- prisma/ vercel.json` | 空 |

## 5. 多维审查

**开工前（一个子 agent，只给四件套与代码）**——逐条核实后并入四件套（`09c87f09`）：不吞异常（要么不 catch、要么写进规格——选了不 catch，与同一 `Promise.all` 里的其它查询一致）；轻量模块只依赖 `@/lib/db` 与 `./flags`，口径与 CHAIN-3 的 `storedLeadCount` 一致；用 `findFirst` 判有没有、字段是布尔；信号表没有 `projectId` 索引写进 Risks；测试注册写进 1.1；What 每条一个动词；`loadWorkspaceContext` 的其它调用方写进 Impact。

**实现后（三个子 agent，各审一个维度）**——逐条核实后（`81688e40`）：

| 维度 | 意见 | 处理 |
|---|---|---|
| 正确性与回归 | 隔离库在 CI 里跳过，接线改回去 CI 抓不到 | **已修**：源码断言 `store.ts` 只引 `readiness-count`、调用 `hasImportLeadsForReadiness({ orgId, projectId })` 并返回 `hasImportLeads`；`readiness-count.ts` 的条件逐项断言 |
| | `storedLeadCount` 等价的说法要限定在 CHAIN-3 写入的记录；性能说法；import 正则漏 `export … from` 与 `import(` | **已改** |
| 安全 / 规格一致性 | 主规格 `tender/stage-policy` 正文与场景矛盾，这条路径第一次上线 | **已改**：MODIFIED 只改正文，场景逐字保留；proposal 的 Modified Capabilities 补上 |
| | 规格要写明读取结果不含进口记录的条数或内容 | **已改**：SHALL NOT 一句；测试核对读取结果里搜不到进口商名与网址 |
| | 开关关时比较整个读取结果；平台过滤（同 kind 不同平台）测试 | **已补** |
| 使用流畅与文案 | 「未接通的来源」标题在导入之后不准 | **已改**：「未接通、也没有人工材料的来源」（面板规格 MODIFIED） |
| | 取决于来源的阶段说明只在悬停提示里 | **已改**：写在阶段标签下面 |
| | 槽里显示「等确认 / 中标者读不出」时阶段也是「执行」 | 不改：D1 备选 A（说明只说处理人工提供的进口线索，与槽里「已导入 N 条」一致），写进 Risks |
| | 「历史授标与采购」写「仅人工」而进口线索写「执行」，看起来矛盾 | 不改：`AWARD_RECORDS` 不从授标记录推导是既有问题，Out of scope，列为后续 |
| | 面板没有指向导入入口；测试名写「未接通」实际是「仅人工」 | 前者另议；测试名**已改** |

## 6. 留给 GATE / 后续

1. **「历史授标与采购」阶段的 `AWARD_RECORDS` 材料**同样不从授标记录推导（组织有授标记录时仍说「仅人工」）；要不要照本次做法补上，另立 change。
2. 导入记录全部被否决、采购方改名或中标者读不出时，阶段仍是「执行」（槽里照实说「已导入 N 条……」）；可接受与否请 GATE 看一眼。

## 7. 已知限制

- 每次读取投标工作区（以及成本核算、「下一步」卡）多一次查询；信号表没有带 `projectId` 的索引，按 `orgId + platform` 走索引再过滤，没有导入记录的项目要扫完本组织的 `TRADE_DATA` 行。零 schema，不加索引。
- 「未接通的来源」清单里不再出现「授权贸易 / 提单数据」，但这个来源本身仍没接通（进口线索面板照旧写明）。
