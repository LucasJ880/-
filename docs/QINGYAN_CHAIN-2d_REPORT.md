# CHAIN-2d 报告 — 投标策略备忘送进模型前去掉我方成本（`strategy-memo-cost-strip`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-2d（Phase F（续）— 情报串联的后续） |
| 起因 | CHAIN-2b（#532）留给 GATE 的第 ③ 条；Lucas 2026-11-20 答「可以」 |
| OpenSpec change | `openspec/changes/strategy-memo-cost-strip/`（新能力 `tender/bid-strategy-memo`，4 条要求） |
| 基线 | origin/main `91d928e4` |
| 合入 main | `5a4d2760`（2026-11-23；先合 `d94e4323`（合并提交 `4e58826f`，解决冲突），复核期间 main 又进了只改文档的 #565 / #566，再合 `5a4d2760`（合并提交 `545cd025`，无冲突）；复核见 §7） |
| 合并顺序 | **须在 CHAIN-2b（#532）之后**：项目列表与调查室读取两个原样返回房间 JSON 的接口由 #532 处理，本 change 不改。#532 已于 2026-11-23 合并（`d9de8490`），已含在本次合入的 main 里 |
| 开关 | 没有新开关，合并即生效 |

## 1. 做了什么

| 场景 | 以前 | 现在 |
|---|---|---|
| 外部情报运行时给策略备忘装配的报价演算 | 读调查室的 `pricingInputs`（对手价、**我方成本**、**目标毛利**），算出含「成本 + 目标毛利」/「成本价」情景与每个情景**毛利**的演算，原样交给模型 | 只取对手价（调查室人工填的 > 本次运行的联邦对标中位 > 现任价格带中位）；不读我方成本、成本来源、目标毛利、我方报价；没有成本底价情景与毛利；附一句 `我方成本、成本底价与毛利不在这里提供；不要推测。` |
| 备忘提示词 | 第 2 条要求逐字引用每个情景的「price/total-score delta/margin」 | 第 2 条只引用价格与总分差；新增第 8 条：不得陈述、估算、推测我方成本、毛利、成本底价，不把缺成本列为缺口，不提成本被隐去或谁能看。提示词版本 3 → 4，备忘版本 `tender-bid-strategy-memo/v2` → `v3`（v3 = 输入里没有成本） |
| 模型调用 | 每次运行一次合成（不合格时有界重试一次） | 不变；每一次请求（含重试）都不含成本 |
| 已存的旧版备忘（v3 以前） | 情报页签、工作台摘要、投标文件草稿的输入、澄清问题文件原样使用 | 先过同一个裁剪：评分演算、报价策略置空；摘要与风险门依据整段换成 `（内容涉及成本，已隐藏）`；其余段落碰到成本类字眼（简繁、英文）或像金额 / 百分比的数字整段换掉；碰到的 RFI 去掉 |
| 情报页签卡片 | 显示摘要、风险门、「报价策略：」前 160 字 | 旧版：第一行说明旧版与怎样生成新版，摘要不显示，「报价策略：已隐藏（旧版）」；新版：报价策略之后对所有人写「成本与毛利情景见工作台「报价表助手」（需要财务查看权）。」 |
| 工作台摘要 | 旧版摘要原样 | 旧版写固定说明、带 `legacyCostRedacted`，名称被隐藏的风险门不列 |
| 投标文件草稿的输入 | 旧版摘要、风险门依据、teaming 原样交给起草模型 | 裁剪后交，被隐藏的段落送 `null`（不送占位句） |
| 澄清问题文件（对外） | 旧版 RFI 原样进表 | 碰到成本的去掉；提交表外写「旧版策略备忘里有 N 条问题可能涉及我方成本，未列入；重新检索外部情报后再导出可补齐。」，此时不写「均未产出 RFI」 |

没有开关，合并即生效。零 schema、零新增模型调用、没有新增出站。**须在 CHAIN-2b（#532）之后合并**：main 上项目列表与调查室读取两个接口原样返回房间 JSON（含旧版备忘与 `pricingInputs`），由 #532 去掉；本 change 不改这两个接口。

有财务查看权的人也失去了「改我方成本 → 重跑外部情报 → 备忘随之更新」（Lane 3 的行为）：备忘不再引用成本底价与毛利，底价情景在报价表助手里看。

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/tender-intel/memo-pricing.ts`（新） | `buildMemoPricingAnalysis`（只取对手价的演算）、`memoCompetitorPrice`、「输入里没有成本」的版本集合、`redactLegacyMemo`、`looksCostRelated`、`placeholderToNull`、固定文字 |
| `src/lib/tender-intel/orchestrate.ts` | 报价演算改用 `buildMemoPricingAnalysis`；评分模型的取得与首次推导落库照旧 |
| `src/lib/tender-intel/strategy.ts` | 提示词第 2 条、第 8 条；提示词版本 4；备忘版本取自版本集合（v3）；类型名 `BidStrategyMemoV3` |
| `src/app/api/projects/[id]/external-intel/award-history/route.ts` | 返回备忘前裁剪 |
| `src/app/api/projects/[id]/workbench-summary/route.ts` | 读备忘先裁剪；旧版的固定说明与标记 |
| `src/lib/tender-bid-draft/gather.ts`、`contract.ts` | 读备忘先裁剪；被隐藏的段落送 `null`（`basisZh` 放宽为 `string \| null`） |
| `src/lib/projects/generate/generate-docs.ts`、`rfi-export.ts` | 读备忘先裁剪；提交表外的内部说明 |
| `src/components/tender-intel/org-award-intel-slots.tsx` | 旧版的第一行说明与报价策略一行；新版的成本指引 |
| `scripts/bid-strategy-memo-e2e.ts` | 认 v3；核对备忘文字里没有调查室的成本数字 |
| 测试 | 新 `src/lib/tender-intel/__tests__/memo-pricing.test.ts`（40）、隔离库 `memo-legacy-db.isolated.test.ts`（8），都已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`intel-auto-flow.test.ts` 只改一个测试名里的 v2 |

## 3. 测试

| 测试 | 结果 |
|---|---|
| `memo-pricing.test.ts`（新） | 40 通过：调查室带我方成本 87654.32、目标毛利 23.7、成本来源落地价 91234.56、我方报价 96543.21，由 `calc.ts` 现算的成本底价与各情景毛利一并列为禁出；演算结果与（假模型捕获的）每一次请求的整段输入里都搜不到；只请求一次，第一次不合格时两次请求都干净；对照组（复刻改动前的装配）恰好带出成本、目标毛利、成本底价与五个情景毛利这 8 个数；提示词逐字断言；旧版裁剪（整段替换、23 个探针句放进字段与 RFI、字符串 RFI、去掉条数、v3 原样）；澄清问题文件渲染；卡片 / 工作台 / 草稿输入 / 编排源码断言；遍历 src 核对读备忘的文件 |
| 隔离库 `memo-legacy-db.isolated.test.ts`（新） | 8 通过：经真实 `GET` 情报页签与工作台摘要（只读成员）与真实 `gatherBidDraftInputs`，v2 被裁剪、整个响应与草稿输入里搜不到成本数字、草稿输入里被隐藏的段落为 `null`；v3 原样 |
| 既有：`bid-strategy-memo` / `intel-auto-flow` / `intel-slots-p1p2` / `obs-p5-intel-loop` / `intel-ops` / `tender-detail-ia` / `rfi-export` / `import-leads` / `pricing-helper` / `bid-draft` / `b4-memory-gate-static` | 12 / 16 / 13 / 14 / 11 / 36 / 9 / 101 / 13 / 11 / 18 通过，期望不改 |
| 既有隔离库：`room-summary-writers-db` / `b4-memory-gate` | 14 / 21 通过 |

## 4. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（本机，带隔离库，`d005fc74`；跑前删掉了测试库里 Mention Gateway M2-A 上次留下的平台级网关那一行） | `704/714 通过, 10 失败`，10 项全是 main 上同样失败的既有项（Autopilot A2-P0、Phase3A-3 Approvals、Phase3A-4 Acceptance、Phase3A-4 Governance、Phase3A-5 Overview、客户报价 PDF 分页布局、Sunny 工艺单 DB、T4 授标情报 Postgres 矩阵、招标询价自动起草 DB 75 / 76、来信观察 DB）；全量里 `memo-pricing` 40 全过 |
| `npm run test:ci`（不带数据库，与 CI 相同） | PASS（注册校验：已注册 681 个，历史欠账 66 条） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增指纹） |
| `openspec validate strategy-memo-cost-strip --strict` | valid（4 条要求，最长 400 字） |
| `git diff origin/main -- prisma/ vercel.json` | 空 |

## 5. 多维审查

**开工前（一个子 agent，只给四件套与代码）**——逐条核实后并入（`d7af03a4`）：计划的测试是自证（纯函数拿不到成本）→ 纯函数改为接收调查室 `summaryJson`，测试输入带成本、目标毛利、成本来源、我方报价，假模型捕获每一次请求，加对照组；旧版只隐藏两段不够（摘要、风险门依据也复述成本，且进投标文件草稿的模型）→ 一个共用裁剪用在全部读取处；规格第 2 条不能承诺模型输出 → 改为约束输入与提示词；第 3 条改用真实路由测；E2E 脚本认 v3；D2 否决理由改正（读取端要判别字段，仓库惯例是比版本常量）；文案、文件重叠、回归清单。

**实现后（四个维度，各一个子 agent）**——逐条核实后：

| 维度 | 意见 | 处理 |
|---|---|---|
| 正确性与回归 | 规格写「模型调用只有一次」，但 `callStructured` 输出不合格会再请求一次（阻塞） | **已改**：每次运行合成一次、有界重试照旧、每一次请求都不含成本；加「第一次不合格、第二次合格」用例，两次请求都干净 |
| 安全 / 隐私 / 硬纪律 | 依赖未合并的 #532：main 上项目列表与调查室读取原样返回房间 JSON（阻塞） | **写明合并顺序**：本 change 须在 #532 之后合并，不改那两个接口；单测遍历 src 时放行 #532 的 `finance-view.ts` |
| | 旧版裁剪按字眼匹配会漏（底线、保本、盈亏、会亏、落地价、进价、加价、加成、我们的报价、我司报、利潤、profit、markup、floor、landed、「不低于 CAD 114,881」） | **已修**：摘要与风险门依据整段换掉（不看字眼）；其余字段与 RFI 字眼扩到这些（含繁体），像金额 / 百分比的数字也算；字符串形式的 RFI 也处理；每个探针一条测试 |
| | 澄清问题文件（对外）悄悄少了问题 | **已修**：提交表外写一行内部说明「旧版策略备忘里有 N 条……」，这时不写「均未产出 RFI」；渲染结果测试 |
| 规格—代码—测试一致性 | 对照组断言 `>= 7` 太松 | **已改**：与改动前装配恰好带出的 8 个数（成本、目标毛利、成本底价、五个情景毛利）做集合相等 |
| | 隔离库只测了 v2 的工作台摘要；规格「联邦对标」的来源写错；E2E 没核对备忘文字 | **已补 / 已改** |
| 使用流畅与文案 | 旧版卡片与工作台说法、草稿输入里的占位句、第 8 条可能让模型写「成本被隐去」、新版卡片不知道去哪看成本、`MEMO_COST_EXCLUDED_ZH` 说目标毛利只给财务（不实） | **已改**：用审查给的文字；草稿输入送空值；第 8 条加「不提成本被隐去或谁能看」；新版卡片指向报价表助手；那句改为「我方成本、成本底价与毛利不在这里提供；不要推测。」 |
| | 注释与测试名里的 v2、多余空行 | **已改** |

## 6. 留给 GATE / 后续

1. **合并顺序**：须在 CHAIN-2b（#532）之后合并（项目列表与调查室读取两个原样返回房间 JSON 的接口由 #532 处理）。TASKFLOW 两边都在 CHAIN-2 行后加一行，后合并的保留两行（2b 在前）。
2. **已存的投标文件草稿**（`summaryJson.bidDraft`）若由旧版备忘生成，可能已经写进成本；草稿读取接口照旧返回——要不要清理或重生成，另立 change。
3. **我方报价**（`pricing.ourPriceCad`，不是成本）照旧交给投标文件草稿的模型。
4. **评分模型里人工填的各项依据**（`otherCriteria[].basisZh`，自由文字）照旧进备忘输入，不过滤。
5. **旧版裁剪宁可多换**：提到「成本评分」「Cost Proposal」等的买方合理问题、含年份 / 编号的段落，在旧版备忘重跑之前也会被去掉 / 换掉（澄清问题文件写明去掉了几条）。只有备忘合成成功时才换成 v3。
6. **有财务查看权的人失去「改我方成本 → 重跑 → 备忘更新」**（Lane 3 的行为）；底价情景在报价表助手里看。

## 7. 合入 main 后复核（2026-11-23）

把 origin/main 合进本分支（`git merge`，不 rebase，两次）：先合 `d94e4323`（合并提交 `4e58826f`，解决下面两处冲突）；复核期间 main 又合进 #565（FIX-23 归档）与 #566（交接文档第五十次），只改 `docs/` 与 openspec 归档（新主规格 `agents/agent-tasks-recent-view`），再合 `5a4d2760`（合并提交 `545cd025`，无冲突；`git diff 4e58826f 545cd025 -- src scripts prisma package.json package-lock.json vercel.json` 为空）。这之间 main 合进了 #532 CHAIN-2b、#535 CHAIN-3b、#534 CHAIN-3c、#533 CHAIN-4c、#544 RFQ-PDF-1、FIX-12 / 13 / 17 / 21 / 23、BIDPAGE-1（#557）及各自的归档。本节之外的内容（§1–§6）仍以 `5f7d5c46` 为准，本 change 的行为没有变化。

### 7.1 冲突与处理

| 文件 | 冲突 | 处理 |
|---|---|---|
| `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` | 情报串联表 CHAIN-2 之后：本分支加了 CHAIN-2d 一行；main 加了 CHAIN-2b、CHAIN-3b、CHAIN-3c、FIX-12 / 13 / 17 / 21 / 23 与十几行「待定」，并改了 CHAIN-3 行（别名裁决已由 CHAIN-3c 落实） | 取 main 的整块（含 main 改过的 CHAIN-3 行；本分支的 CHAIN-3 行与合并基相同），CHAIN-2d 行放在 CHAIN-2b 之后（2b、2d、3、3b、3c……）；没有删任何一行。CHAIN-2c（#539）的行还没进 main，合并时放在 2b 与 2d 之间 |
| `src/lib/projects/generate/generate-docs.ts` | 导入：本分支加了 `redactLegacyMemo`；main（RFQ-PDF-1）去掉了身份禁出相关的三个导入、改导询价单生成器 | 取 main 的导入，再加 `redactLegacyMemo` 一行；澄清问题文件那一段（`:304`、`:324`）自动合并，与合入前相同 |

`scripts/test-all.sh`、`scripts/test-ci-unit.sh` 自动合并，两边的注册行都在。`openspec/config.yaml`、`.claude/launch.json`、`docs/` 下的文件都没有删改（除本报告与 TASKFLOW）。

### 7.2 兼容核对

| 项 | 结论 |
|---|---|
| a. 四个读取处仍过裁剪 | 是。情报页签 `src/app/api/projects/[id]/external-intel/award-history/route.ts:85`；工作台摘要 `src/app/api/projects/[id]/workbench-summary/route.ts:102`（`:117`、`:119`、`:122` 用裁剪结果）；投标文件草稿输入 `src/lib/tender-bid-draft/gather.ts:136`；澄清问题文件 `src/lib/projects/generate/generate-docs.ts:304`（`:324` 把去掉的条数交给 `rfi-export.ts:130`）。卡片 `src/components/tender-intel/org-award-intel-slots.tsx:390`、`:391`、`:408` 只用接口给的裁剪结果。`memo-pricing.test.ts` 遍历 src 的那条在合入后的树上照样通过 |
| a. main 新增的读取处 | **没有发现绕过裁剪的地方，没有补代码。** 全仓 grep `bidStrategyMemo` / `strategyMemo`：除编排、提示词、本模块与上面四处外只有 #532 的 `src/lib/tender-pricing/finance-view.ts`（`:103` 起，把备忘整个删掉）。房间 JSON 的读取逐个看过：BIDPAGE-1 的 `bid-page-summary` 路由与 `src/lib/bid-page-v2/service.ts` 不读调查室（只读询价、供应商关联、待批卡、报价引擎、生成文件）；`src/components/bid-page-v2/**` 不读 `summaryJson`；FIX-21 改过的 `ai-bid-package`、`ai-bid-package/run-step`、`intelligence/regenerate`、`intelligence/review` 不读调查室；`analyst-memo`（只给分析师备忘录 v2 的段落）、`bid-draft`（只给 `bidDraft`，旧版草稿见 §6 第 2 条）、`tender-watch`、`external-intel/run`（只读状态键，返回的 outcome 不含备忘）、项目详情（只选 `summaryText` 等，不选 `summaryJson`）都不带备忘。`researchStateJson` 在仓库里不存在；`rsj` 只在 `gather.ts`（已裁剪）、`generate-docs.ts`（那是分析 run 的 JSON）、`bid-draft` 路由与编排里 |
| b. #532 的两个接口 | 是。调查室读取 `src/app/api/projects/[id]/bid-intelligence/route.ts:33`、项目列表 `src/app/api/projects/route.ts:110` 都经 `redactRoomSummaryCost`（`finance-view.ts:103`）：`bidStrategyMemo` 整个去掉，`pricingInputs` 去掉 `ourCostCad` 与 `ourCostSource`。注意 `pricingInputs` 本身还在（对手价、目标毛利、报价引擎镜像的我方报价照旧给项目读者），这是 #532 规格的范围，本 change 只依赖「备忘与我方成本不出这两个接口」。全量里 `finance-view` 47 过、隔离库 `pricing-helper-finance-db` 34 过（含「两个接口的 JSON 里都搜不到成本与落地价的数字」「没有投标策略备忘」） |
| c. FIX-21 目录守卫 | 通过（98 过；严格通过 249 个处理函数、守卫前预处理名单 3 个、例外 1 个、不过 0 个）。本 change 改的两个路由都只加了导入与守卫之后的取值：`award-history` 守卫在 `:36-37`（GET）、`:100-101`（POST），`workbench-summary` 在 `:22-23`；守卫前没有新增任何东西 |
| d. 模型输入里没有成本 | 成立。`orchestrate.ts`、`strategy.ts`、`src/lib/tender-pricing/calc.ts` 在 main 上都没改过；`memo-pricing.test.ts` 40 过，其中对照组「改动前的装配恰好带出 8 个数」「整段输入里恰好搜得到那 8 个数」与禁出「每一次请求（含重试）都搜不到」照旧成立 |

### 7.3 门禁

全量、CI 子集与 lint 跑在 `4e58826f` 上；它与最终提交的 src / scripts / prisma / package 逐字相同（只差文档与 openspec 归档），这几项的结果对最终提交同样成立。typecheck、注册校验、`memo-pricing`、守卫、openspec 校验与归档演练在 `545cd025` 上重跑过。

| 项 | 结果 |
|---|---|
| `memo-pricing.test.ts` | 40 通过 |
| 隔离库 `memo-legacy-db.isolated.test.ts`（`qy_iso_d`） | 8 通过 |
| `project-routes-guard.test.ts` | 98 通过 |
| `bash scripts/check-test-registry.sh` | OK：已注册 698 个，历史欠账 66 条 |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（current errors 38 / baseline 53，无新增指纹）。本机是浅克隆，`sourceCommit...HEAD` 没有合并基，「PR 改动文件」附加检查被跳过（main 上同样）；另对本 change 相对 main 改的 ts / tsx 单独跑 `eslint`：0 error、0 warning |
| `openspec validate strategy-memo-cost-strip --strict` | valid |
| 归档演练（scratchpad 里 `git archive HEAD` 的副本） | `openspec archive strategy-memo-cost-strip --yes`：新建 `tender/bid-strategy-memo`，+4；之后 `openspec validate --specs --strict` 154 过 0 不过（main `5a4d2760` 153 过 0 不过；在 `4e58826f` 上是 153 / 152）；四条要求 281 / 218 / 342 / 400 字 |
| `git diff origin/main -- prisma/ vercel.json package.json package-lock.json` | 空 |
| CI 子集 `npm run test:ci`（`ci` 假库、不带 `DATABASE_ENVIRONMENT`） | PASS（`memo-pricing` 40、守卫 98 都在；隔离库测试按设计跳过） |
| 全量 `npm test`（新建的 `qy_full_chain2d`，`migrate deploy` 后） | `722/732 通过, 10 失败`，10 项与 main 基线逐条相同：来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB（75 / 76）。全量里 `memo-pricing` 40、`memo-legacy-db` 8、守卫 98、`finance-view` 47、`pricing-helper-finance-db` 34 都过 |
