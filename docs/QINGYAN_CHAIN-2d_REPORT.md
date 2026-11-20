# CHAIN-2d 报告 — 投标策略备忘送进模型前去掉我方成本（`strategy-memo-cost-strip`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-2d（Phase F（续）— 情报串联的后续） |
| 起因 | CHAIN-2b（#532）留给 GATE 的第 ③ 条；Lucas 2026-11-20 答「可以」 |
| OpenSpec change | `openspec/changes/strategy-memo-cost-strip/`（新能力 `tender/bid-strategy-memo`，4 条要求） |
| 基线 | origin/main `91d928e4` |
| 合并顺序 | **须在 CHAIN-2b（#532）之后**：项目列表与调查室读取两个原样返回房间 JSON 的接口由 #532 处理，本 change 不改 |
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
