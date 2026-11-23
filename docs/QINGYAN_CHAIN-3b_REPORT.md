# CHAIN-3b 报告 — 投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录（`bid-readiness-import-leads`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-3b（Phase F（续）— 情报串联的后续） |
| 起因 | CHAIN-3 的 Out of scope；交接文档第四十四次 §0.5h「之后还有什么」第 4 条 |
| 拍板 | Lucas 2026-11-20：「投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录。」 |
| OpenSpec change | `openspec/changes/bid-readiness-import-leads/`（修改 `tender/bid-workspace` 1 条、`tender/stage-policy` 1 条（只改正文措辞）、`tender/bid-workspace-panel` 1 条） |
| 基线 | origin/main `91d928e4` |
| PR | #535，2026-11-23 合并（合并提交 `595fb896`）；归档 `openspec/changes/archive/2026-11-23-bid-readiness-import-leads/`；归档后 `openspec validate --specs --strict` 149 / 149 |
| 开关 | 没有新开关：跟随进口线索导入（`TENDER_IMPORT_LEADS_ENABLED` + 白名单）与投标工作区的既有开关 |

## 1. 做了什么

| 场景 | 以前 | 现在 |
|---|---|---|
| 项目有 CHAIN-3 导入的进口记录（未被标为不采用），组织开了导入 | 「进口线索」阶段：未接通，「授权贸易 / 提单数据未接通；这不表示没有记录，而是没有查」，列在「未接通的来源」 | 「手头材料」多一项「进口线索」，阶段为「执行」，说明「只处理人工提供的进口线索」，从未接通 / 仅人工清单里消失 |
| 开关关、或项目没有导入记录 | — | 读取结果与以前逐字节相同（纯函数与隔离库都核对） |
| 面板 | 清单标题「未接通的来源」；取决于来源的阶段说明只在悬停提示里 | 标题「未接通或仅人工的来源」；历史授标与采购、进口线索两个阶段在阶段标签下面写出 `{阶段}：{说明}`（触屏、读屏也看得到） |

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
| `tender-bid-workspace/__tests__/workspace-view.test.ts` | 34 通过（新：有导入记录 → 材料多一项、阶段执行、不在未接通清单；面板那一行「进口线索：只处理人工提供的进口线索」；缺省与 false 的结果相同） |
| `tender-import-leads/__tests__/import-leads.test.ts`（本分支，不含 CHAIN-3c） | 109 通过（新：字面量与 `service.ts` 相同；`readiness-count.ts` 只 import 两个模块；`store.ts` 只引这个轻量模块） |
| `tender-bid-workspace/__tests__/panel-helpers.test.ts` | 43 通过（新：清单标题、说明行） |
| 隔离库 `readiness-count-db.isolated.test.ts`（新） | 19 通过：经真实导入接口导入一条前后，开关开着的五处核对与 CHAIN-3 读视图的「已导入 N 条」一致；经真实 `GET` 投标工作区读取看到阶段执行、不在未接通与缺材料两张清单；整个读取响应里搜不到进口商、出口商、品名与来源网址；除材料与阶段外导入前后整个响应逐字相同（不带条数）；别的项目、别的组织、别的平台、别的 kind（`search_hit_v1`）的信号都不算；开关关时库里有记录也不算，读取结果（`view`）与没有导入记录的项目完全相同；唯一一条标为不采用后回到未接通，整个响应与导入前逐字相同；外部请求 0 |
| `tender-bid-readiness/__tests__/stage-policy.test.ts`、隔离库 `bid-workspace-db` / `readiness-submission-db` / `import-leads-db` | 25 / 49 / 24 / 34 通过，不改期望 |

## 4. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（本机，带隔离库） | `702/713 通过, 11 失败`，11 项全是 main 上同样失败的既有项（与 `docs/QINGYAN_CHAIN-3_REPORT.md` §4 同一批）；全量里 `readiness-count-db` 16、`bid-workspace-db` 49 全过 |
| `npm run test:ci`（不带数据库，与 CI 相同） | PASS（注册校验：已注册 680 个，历史欠账 66 条） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增指纹） |
| `openspec validate bid-readiness-import-leads --strict` | valid |
| `git diff origin/main -- prisma/ vercel.json` | 空 |

全量 `npm test` 是在补派规格一致性审查之前跑的；之后的修改只加测试与改文档，补完后重跑了 `npm run test:ci`（PASS）、`npm run typecheck`、`npm run lint:baseline`（PASS），以及改到的单测与隔离库测试（见 §3 / §5 的条数）。

### 2026-11-23 合入 main `003e0d6a` 后复跑（合并提交 `e3ecdfb2`）

合入的 main 含 #540 FIX-12、#546 FIX-13、#548 FIX-17、#533 CHAIN-4c、#532 CHAIN-2b 及其归档。冲突只有 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 一处，两边新增的行都保留（CHAIN-3b 接在 CHAIN-3 之后，FIX-12 / FIX-13 / FIX-17 跟在后面）；`scripts/test-all.sh`、`scripts/test-ci-unit.sh` 自动合并，两边的注册行都在。本分支改的 4 个源码文件与 4 个测试文件、`readiness-count.ts` 的依赖（`@/lib/db`、`./flags`）、`store.ts` / `workspace-view.ts` / 面板的依赖闭包，main 在分叉后都没改过；三个调用方（投标工作区读写接口、成本核算接口、项目页「下一步」卡）本身也没改。main 改到的、被调用方或测试间接带进来的模块是 FIX-12 / FIX-13 的模型调用截止与解析文字（与「手头材料」推导无关，测试不发模型请求）；CHAIN-2b 在两个接口上去掉房间 JSON 里的 `pricingInputs.ourCostCad` / `ourCostSource` 与 `bidStrategyMemo`，不碰 `bidWorkspace` 键，投标工作区走自己的接口。没有实质冲突，也没有行为变化。

| 项 | 命令 | 结果 |
|---|---|---|
| 本 change 单跑（隔离库 `qy_iso_b`，迁移已是最新） | `NODE_ENV=test npx tsx <file>` | `readiness-count-db` 19、`workspace-view` 34、`import-leads` 109、`panel-helpers` 43、`stage-policy` 25、`bid-workspace-db` 49、`readiness-submission-db` 24、`import-leads-db` 34，全过 |
| 全量（新库 `qy_full_chain3b`，`npx prisma migrate deploy`） | `npm test` | `710/720 通过, 10 失败`；10 项与 main 既有失败逐条相同：来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB；上面八个套件在全量里的条数与单跑相同 |
| CI 子集（不带数据库） | `npm run test:ci`（CI 的环境变量） | PASS（`readiness-count-db` 照例跳过；注册校验：已注册 687 个，历史欠账 66 条） |
| 类型 | `npm run typecheck` | 通过 |
| lint | `npm run lint:baseline` | PASS（errors 38 / 基线 53，无新增指纹） |
| 测试注册 | `bash scripts/check-test-registry.sh` | 通过（687 / 66） |
| 运行时架构 | `bash scripts/test-runtime-architecture.sh` | PASS（59 / 61 / 19 / 134 / 26 / 18 / 9） |
| OpenSpec | `openspec validate bid-readiness-import-leads --strict` | valid |
| 受保护文件 | `git diff origin/main -- prisma/ vercel.json package.json package-lock.json` | 空 |

## 5. 多维审查

**开工前（一个子 agent，只给四件套与代码）**——逐条核实后并入四件套（`09c87f09`）：不吞异常（要么不 catch、要么写进规格——选了不 catch，与同一 `Promise.all` 里的其它查询一致）；轻量模块只依赖 `@/lib/db` 与 `./flags`，口径与 CHAIN-3 的 `storedLeadCount` 一致；用 `findFirst` 判有没有、字段是布尔；信号表没有 `projectId` 索引写进 Risks；测试注册写进 1.1；What 每条一个动词；`loadWorkspaceContext` 的其它调用方写进 Impact。

**实现后（四个维度；起初派了三个子 agent，其中一个同时审安全与规格一致性，不合「每个子 agent 只管一个维度」，开 PR 后补派一个只审规格—代码—测试一致性的，见表末）**——逐条核实后（`81688e40`）：

| 维度 | 意见 | 处理 |
|---|---|---|
| 正确性与回归 | 隔离库在 CI 里跳过，接线改回去 CI 抓不到 | **已修**：源码断言 `store.ts` 只引 `readiness-count`、调用 `hasImportLeadsForReadiness({ orgId, projectId })` 并返回 `hasImportLeads`；`readiness-count.ts` 的条件逐项断言 |
| | `storedLeadCount` 等价的说法要限定在 CHAIN-3 写入的记录；性能说法；import 正则漏 `export … from` 与 `import(` | **已改** |
| 安全 / 规格一致性 | 主规格 `tender/stage-policy` 正文与场景矛盾，这条路径第一次上线 | **已改**：MODIFIED 只改正文，场景逐字保留；proposal 的 Modified Capabilities 补上 |
| | 规格要写明读取结果不含进口记录的条数或内容 | **已改**：SHALL NOT 一句；测试核对读取结果里搜不到进口商名与网址 |
| | 开关关时比较整个读取结果；平台过滤（同 kind 不同平台）测试 | **已补** |
| 使用流畅与文案 | 「未接通的来源」标题在导入之后不准 | **已改**：「未接通或仅人工的来源」（面板规格 MODIFIED） |
| | 取决于来源的阶段说明只在悬停提示里 | **已改**：写在阶段标签下面 |
| | 槽里显示「等确认 / 中标者读不出」时阶段也是「执行」 | 不改：D1 备选 A（说明只说处理人工提供的进口线索，与槽里「已导入 N 条」一致），写进 Risks |
| | 「历史授标与采购」写「仅人工」而进口线索写「执行」，看起来矛盾 | 不改：`AWARD_RECORDS` 不从授标记录推导是既有问题，Out of scope，列为后续 |
| | 面板没有指向导入入口；测试名写「未接通」实际是「仅人工」 | 前者另议；测试名**已改** |

**补派：规格—代码—测试一致性（一个子 agent，只审这一个维度）**——没有阻塞；逐条核实后：

| 意见 | 处理 |
|---|---|
| 场景「开关关闭或没有记录」说读取结果与没有本功能时相同，只有开关关那一支比对了整份结果 | **已补**：标为不采用后整个响应与导入前逐字相同 |
| 「不含进口记录的条数」没有断言；内容检查只看了 `view` | **已补**：整个响应查内容；除材料与阶段外导入前后逐字相同 |
| 面板那一行整串没有断言；「保存返回的视图」规格没写 | **已补**：单测断言整串；规格加「保存返回的结果与读取相同」 |
| 「别的 kind」的夹具其实没有 kind；报告「两张清单」「整份读取结果」「每一步」说过头；proposal「不改该目录既有文件」；tasks 3.3 的说法过时 | **已改**：夹具带 `kind: "search_hit_v1"`，加缺材料清单断言，说法改准 |
| 面板场景「渥太华项目」引用的截图 `docs/acceptance/ti-4b/overview.png` 是改动前拍的（旧标题、没有说明行） | 不改：截图是 TI-4b 的验收记录；新文字由源码断言守住，列入已知限制 |

## 6. 留给 GATE / 后续

1. **「历史授标与采购」阶段的 `AWARD_RECORDS` 材料**同样不从授标记录推导（组织有授标记录时仍说「仅人工」）；要不要照本次做法补上，另立 change。
2. 导入记录全部被否决、采购方改名或中标者读不出时，阶段仍是「执行」（槽里照实说「已导入 N 条……」）；可接受与否请 GATE 看一眼。

## 7. 已知限制

- 面板规格场景「渥太华项目」引用的截图 `docs/acceptance/ti-4b/overview.png` 是本次改动前拍的（清单标题是旧的「未接通的来源」、没有说明行）；新文字由 `panel-helpers.test.ts` 的源码断言守住，没有重拍。

- 每次读取投标工作区（以及成本核算、「下一步」卡）多一次查询；信号表没有带 `projectId` 的索引，按 `orgId + platform` 走索引再过滤，没有导入记录的项目要扫完本组织的 `TRADE_DATA` 行。零 schema，不加索引。
- 「未接通的来源」清单里不再出现「授权贸易 / 提单数据」，但这个来源本身仍没接通（进口线索面板照旧写明）。

## 2026-11-23 合并前交叉验证（接手会话「青砚招投标线交接」）

另起一个没参与实现与之前审查的子 agent，只看需求、四件套、diff，在 `6b7f1bbb` 与 PR head `b3bc61d2`（又合入 main `22a87fb7`）的干净快照上亲自跑：**可以合并，没有阻断项**。
- 本 change 测试（`6b7f1bbb`）：readiness-count-db 19、workspace-view 34、import-leads 109、panel-helpers 43、stage-policy 25、bid-workspace-db 49、readiness-submission-db 24、schedule-prefill-db 40、import-leads-db 34、web-next-step-db 103，全部通过；head 上前四个照样通过；测试注册 689 / 66；typecheck 0；归档演练 `--specs --strict` 149 / 149，改到的三条要求 363 / 155 / 220 字。
- 查询口径与 `storedLeadCount` 实际一致；组织隔离有跨组织 / 跨项目用例；开关关时读取结果与改动前逐字相同；stage-policy 的 MODIFIED 是修正正文与场景的自相矛盾，行为不变。
- 9 个变异被抓住；4 个没被抓住（说明行前加 `false &&`、给说明行加 `hidden`、开关判断前多发一次查询、叠加 `NOT` kind 条件只有隔离库测试能抓）——记为已知限制（panel-helpers 是源码正则，没有渲染测试）。
- 性能：一个组织 20 万条 `TRADE_DATA` 时，没有导入记录的项目冷缓存约 123 ms（走 `orgId_platform_idx` 再过滤），有记录时约 0.1 ms；与 CHAIN-3 自己的扫描同一量级，零 schema 下不加索引；「下一步」卡上这次查询是白跑的，记为后续可跳过。
- 查询出错会让投标工作区 GET / PUT、成本核算、「下一步」卡整体 500——与同一个 `Promise.all` 里的其它查询一致（design D3 的有意选择）。
- **采纳并已改**：面板标题原为「未接通、也没有人工材料的来源」，但「历史授标与采购」从来不从授标记录推导（`workspace-view.ts:78-86`），组织录了授标记录面板照样说「没有」——改为中性的「**未接通或仅人工的来源**」（面板、panel-helpers 断言、面板规格、proposal、本报告同步）。
- 流程：「规格—代码—测试一致性」子 agent 是开 PR 之后补派的（报告 §5 已如实写）。
- 注：面板在投标工作区里，投标工作区开关 `TENDER_BID_WORKSPACE_ENABLED` 生产未开，面板文字的变化在生产上目前看不到。
