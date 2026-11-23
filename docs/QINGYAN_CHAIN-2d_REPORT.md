# CHAIN-2d 报告 — 投标策略备忘送进模型前去掉我方成本（`strategy-memo-cost-strip`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-2d（Phase F（续）— 情报串联的后续） |
| 起因 | CHAIN-2b（#532）留给 GATE 的第 ③ 条；Lucas 2026-11-20 答「可以」 |
| OpenSpec change | `strategy-memo-cost-strip`（已归档到 `openspec/changes/archive/2026-11-23-strategy-memo-cost-strip/`；新能力 `tender/bid-strategy-memo`，4 条要求） |
| PR | #538，2026-11-23 合并（合并提交 `fc321a7d`）；归档后 `openspec validate --specs --strict` 158 / 158 |
| 基线 | origin/main `91d928e4` |
| 合入 main | `325cbdc0`（2026-11-23，合并提交 `b54a1c30`；之前 `c376be86` → `9c3ba172`，见 §8.5）；更早：`51865685`（`a908e6d7`，见 §8）、`5a4d2760`（先合 `d94e4323`（合并提交 `4e58826f`，解决冲突），复核期间 main 又进了只改文档的 #565 / #566，再合 `5a4d2760`（合并提交 `545cd025`，无冲突）；复核见 §7） |
| 合并顺序 | **须在 CHAIN-2b（#532）之后**：项目列表与调查室读取两个原样返回房间 JSON 的接口由 #532 处理，本 change 不改。#532 已于 2026-11-23 合并（`d9de8490`），已含在本次合入的 main 里 |
| 开关 | 没有新开关，已随合并（2026-11-23）在生产生效 |

## 1. 做了什么

| 场景 | 以前 | 现在 |
|---|---|---|
| 外部情报运行时给策略备忘装配的报价演算 | 读调查室的 `pricingInputs`（对手价、**我方成本**、**目标毛利**），算出含「成本 + 目标毛利」/「成本价」情景与每个情景**毛利**的演算，原样交给模型 | 只取对手价（调查室人工填的 > 本次运行的联邦对标中位 > 现任价格带中位）；不读我方成本、成本来源、目标毛利、我方报价；没有成本底价情景与毛利；附一句 `我方成本、成本底价与毛利不在这里提供；不要推测。` |
| 备忘提示词 | 第 2 条要求逐字引用每个情景的「price/total-score delta/margin」 | 第 2 条只引用价格与总分差；新增第 8 条：不得陈述、估算、推测我方成本、毛利、成本底价，不把缺成本列为缺口，不提成本被隐去或谁能看。提示词版本 3 → 4，备忘版本 `tender-bid-strategy-memo/v2` → `v3`（v3 = 输入里没有成本） |
| 模型调用 | 每次运行一次合成（不合格时有界重试一次） | 不变；每一次请求（含重试）都不含成本 |
| 已存的旧版备忘（v3 以前） | 情报页签、工作台摘要、投标文件草稿的输入、澄清问题文件原样使用 | 先过同一个裁剪：评分演算、报价策略置空；其余自由文字段（摘要、竞争格局、teaming、数据缺口、风险门名称与依据及任何别的字段）不看内容整段换成 `（内容涉及成本，已隐藏）`，风险门状态照旧；RFI 一律不列入、只记条数（交叉验证 F1 与独立复核 B1 后的做法，见 §8）；版本号逐字认 v3，形状不对的备忘不出 |
| 情报页签卡片 | 显示摘要、风险门、「报价策略：」前 160 字 | 旧版：第一行说明旧版与怎样生成新版，摘要、数据缺口与名称被隐藏的风险门不显示，「报价策略：已隐藏（旧版）」；新版：报价策略之后对所有人写「成本与毛利情景见工作台「报价表助手」（需要财务查看权）。」 |
| 工作台摘要 | 旧版摘要原样 | 旧版写固定说明、带 `legacyCostRedacted`，名称被隐藏的风险门不列（旧版一条都不列） |
| 投标文件草稿的输入 | 旧版摘要、风险门依据、teaming 原样交给起草模型 | 裁剪后交，被隐藏的段落送 `null`、名称被隐藏的风险门不送（不送占位句） |
| 澄清问题文件（对外） | 旧版 RFI 原样进表 | 旧版的 RFI 一律不列入；提交表外写「旧版策略备忘里有 N 条问题可能涉及我方成本，未列入；重新检索外部情报后再导出可补齐。」，此时不写「均未产出 RFI」 |

没有开关，已随合并（2026-11-23）生效。零 schema、零新增模型调用、没有新增出站。已在 CHAIN-2b（#532，`d9de8490`）之后合并（原要求「须在 #532 之后合并」）：main 上项目列表与调查室读取两个接口原样返回房间 JSON（含旧版备忘与 `pricingInputs`），由 #532 去掉；本 change 不改这两个接口。

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
| `src/components/tender-intel/org-award-intel-slots.tsx` | 旧版的第一行说明与报价策略一行、不列名称被隐藏的风险门、不显示被隐藏的数据缺口；新版的成本指引 |
| `scripts/bid-strategy-memo-e2e.ts` | 认 v3；核对备忘文字里没有调查室的成本数字 |
| 测试 | 新 `src/lib/tender-intel/__tests__/memo-pricing.test.ts`（52）、隔离库 `memo-legacy-db.isolated.test.ts`（11）与 `memo-orchestrate-db.isolated.test.ts`（8），都已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；33 + 48 句探针在 `__tests__/fixtures/legacy-memo-probes.ts`（两个测试共用）；`intel-auto-flow.test.ts` 只改一个测试名里的 v2 |

## 3. 测试

| 测试 | 结果 |
|---|---|
| `memo-pricing.test.ts`（新） | 52 通过（交叉验证前 40，交叉验证后 55，独立复核后删掉只测规则判断的 5 条、加 2 条）：调查室带我方成本 87654.32、目标毛利 23.7、成本来源落地价 91234.56、我方报价 96543.21，由 `calc.ts` 现算的成本底价与各情景毛利一并列为禁出；演算结果与（假模型捕获的）每一次请求的整段输入里都搜不到；只请求一次，第一次不合格时两次请求都干净；对照组（复刻改动前的装配）恰好带出成本、目标毛利、成本底价与五个情景毛利这 8 个数；提示词逐字断言；旧版裁剪（整段替换、23 个探针句放进字段与 RFI、字符串 RFI、去掉条数、v3 原样；交叉验证与独立复核后加：33 + 48 句探针 × 6 个位置经裁剪结果与澄清问题文件渲染都不出现、每一段「干净的话也整段换掉」、旧版 RFI 全部不列入且条数计对、v3 的 RFI 照旧进澄清问题文件、像 v3 的版本号按旧版、不是对象的备忘不出、形状不对的输入、没有对手价时不顶替）；澄清问题文件渲染；卡片 / 工作台 / 草稿输入 / 编排源码断言；遍历 src 核对读备忘的文件 |
| 隔离库 `memo-legacy-db.isolated.test.ts`（新） | 11 通过（交叉验证前 8）：经真实 `GET` 情报页签与工作台摘要（只读成员）与真实 `gatherBidDraftInputs`，v2 被裁剪、整个响应与草稿输入里搜不到成本数字、草稿输入里被隐藏的段落为 `null`；v3 原样；33 + 48 句探针 × 6 个位置 × 3 个读取处（18 份输出）一句都不出现，旧版 RFI 一条都不出、条数计对，v3 的 RFI 原样 |
| 隔离库 `memo-orchestrate-db.isolated.test.ts`（新，交叉验证 F3） | 8 通过：真实跑 `runExternalIntelForProject`，模型地址换成 `.invalid`、`fetch` 被替换，截获交给备忘模型的请求；报价演算键集合恰好是允许的那些、与纯函数结果相同；没有对手价、联邦对标与价格带时对手价为 null，整段请求里搜不到我方报价与成本 |
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
5. **旧版裁剪宁可多换**：交叉验证（§8）后，旧版备忘的自由文字段一律整段换掉，卡片上旧版只剩说明、「报价策略：已隐藏（旧版）」与导出按钮；独立复核（§8.5）后旧版的 RFI 一条都不进澄清问题文件，买方本身合理的问题也要等旧版备忘重跑后才补齐（澄清问题文件写明有几条未列入）。只有备忘合成成功时才换成 v3。
6. **有财务查看权的人失去「改我方成本 → 重跑 → 备忘更新」**（Lane 3 的行为）；底价情景在报价表助手里看。
7. **（交叉验证 F4，中，#532 范围，优先）项目读者可由「我方报价 + 目标毛利」反推我方成本**：调查室读取 `GET /api/projects/:id/bid-intelligence` 的 `room.summaryJson.pricingInputs` 仍带 `targetMarginPct` 与 `ourPriceCad`（`src/lib/tender-pricing/finance-view.ts:114` 只去掉 `ourCostCad` / `ourCostSource`），报价表助手 `GET`（`src/app/api/projects/[id]/pricing-helper/route.ts:97`）也给没有财务查看权的人 `targetMarginPct`，`Project.ourBidPrice` 同样可见。成本 87654.32、目标毛利 23.7、报价 114881.15 时，只读成员算 114881.15 × (1 − 0.237) = 87654.32；报价正好按「成本 + 目标毛利」底价情景定（`src/lib/tender-pricing/calc.ts:213-214`）时精确反推。与硬纪律第 4 条「Muse 不传目标毛利，避免用两价反推」相反。已登记为 TASKFLOW「待定」一行（依赖 CHAIN-2b），本 change 不改。
8. **（交叉验证 F5，低）合并前用旧版备忘导出、已存进项目文件的澄清问题文件**（`src/lib/projects/generate/generate-docs.ts:338` `persistGeneratedHtml`）不会被重新裁剪；已登记为 TASKFLOW「待定」一行，本 change 不改。

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

## 8. 交叉验证与修订（2026-11-23）

挑错交叉验证（在 `c9586909` 上）的结论：**可以合并、没有阻断项**，但 F1 要在合并前修。协调会话定了修法，本节是落实结果。代码改动在 `2d36e638`；之前先把 origin/main `51865685`（含 #559 TREE-1 `99bd7e18` 与 #536 CHAIN-1b）合进本分支（合并提交 `a908e6d7`，无冲突；`openspec/config.yaml` 取 main，本分支没有改过它）。

### 8.1 各条去向

| 编号 | 交叉验证的发现 | 去向 |
|---|---|---|
| F1（合并前修） | 旧版备忘按字眼裁剪漏网严重：33 句探针放进竞争格局、teaming、数据缺口、风险门名称、RFI 问题、RFI 理由 6 个位置，26 句原样留在接口输出（`COST_WORDS` / `AMOUNT_LIKE` 列不全）；字符串形式的风险门、数组形式的段落、自由文字的风险门状态也原样留下 | **已修**（`src/lib/tender-intel/memo-pricing.ts`）：旧版备忘除版本、标签、生成时间、模型名外，所有字段不看内容整段换成 `（内容涉及成本，已隐藏）`；风险门只留对象，名称与依据换掉，状态只认「已满足 / 需解决 / 高风险」；RFI 理由一律 `null`；RFI 问题按加强后的规则判断（先 NFKC、去掉数字里的空格与千分位；补万 / k / 中文数字与大写数字、百分之 / 百分点 / 个点 / pts / bps、亏损 / 进货 / 采购价 / 供应商报价 / 盈利 / 赚 / 让利 / 让价 / 下限 / bottom line / mark-up / COGS / GP / 我方的报价 / 我们报价等字眼，含繁体），碰到的整条去掉并计数（**独立复核后改为旧版 RFI 一律不列入、规则判断删掉，见 §8.5**）。卡片与投标文件草稿的输入不列名称被隐藏的风险门、卡片不显示被隐藏的数据缺口（不然旧版卡片满屏「（内容涉及成本，已隐藏）（需解决）」）；卡片与工作台的文案没改。规格「旧版备忘先裁剪再用」「旧版备忘的显示与导出」、design D3、proposal 同步 |
| F2（随 F1） | 去掉 whyZh / 数据缺口 / 风险门名称 / teaming 的裁剪（变异 X2 / X3 / X4 / X7）测试抓不住 | **已补测试**：每一段都断言「干净的话也整段换掉」、RFI 理由为 `null`；33 句探针 × 6 个位置经裁剪结果与澄清问题文件渲染（单测）、经情报页签 / 工作台摘要 / 草稿输入三个真实读取处（隔离库）都不出现；干净的 RFI 问题留下；每条规则单独一句。见 8.2 |
| F3（合并前补测试） | 编排接线只有源码正则断言；变异 M4c（用拼出来的键名把整块 `pricingInputs` 塞进 `pricingAnalysis`）与 M6b（没有对手价、对标价、价格带时用 `ourPriceCad` 顶替）都存活 | **已补测试**，不改源码：新隔离库 `memo-orchestrate-db.isolated.test.ts` 真实跑 `runExternalIntelForProject`，模型地址换成 `.invalid` 的假地址、`fetch` 被替换（没有真实出站），截获交给备忘模型的请求：报价演算键集合恰好是允许的那些、与 `buildMemoPricingAnalysis` 的结果相同；调查室没有对手价、联邦对标与价格带时对手价为 `null`，整段请求里搜不到我方报价与成本。单测另加「没有对手价时不顶替」 |
| F4（登记后续） | 项目读者可由「我方报价 + 目标毛利」反推我方成本（#532 范围） | **已登记** TASKFLOW「待定」一行（CHAIN-2d 行之后，依赖 CHAIN-2b，标「优先」）与 §6 第 7 条；不改代码 |
| F5（登记后续） | 合并前用旧版备忘导出、已存进项目文件的澄清问题文件不会被重新裁剪 | **已登记** TASKFLOW「待定」一行与 §6 第 8 条；不改代码 |
| F6 | 合入最新 main | **已做**：`51865685`（`a908e6d7`，无冲突）；TASKFLOW 两边的行都在（CHAIN-1b 在 CHAIN-1 之后，CHAIN-2d 仍在 CHAIN-2b 之后，两行「待定」紧跟 CHAIN-2d） |

### 8.2 探针与变异

**探针**（交叉验证员的脚本 `redact-probe.ts` 原样复制到本会话的 scratchpad 里跑）：

| | 留在输出里的句数（33 句中） | 留在输出里的「句 × 位置」（198 个中） | 字符串风险门 / 数组段落 / 自由文字状态 |
|---|---|---|---|
| 改前（`a908e6d7`，即 `c9586909` 的代码） | **26** | 156 | 三种都原样留下 |
| 改后（`2d36e638`） | **0** | 0 | 丢掉 / 换掉 / 换掉 |

**变异**（在 scratchpad 的副本里改一处、跑测试、还原；「被抓住」= 至少一个测试失败）：

| 变异 | 改前（当时的代码与测试） | 改后（抓住它的测试） |
|---|---|---|
| X2 RFI 理由不裁剪 / 不去掉 | 存活 | 抓住（`memo-pricing`、`memo-legacy-db`） |
| X3 数据缺口不裁剪 / 不整段换掉 | 存活 | 抓住（`memo-pricing`、`memo-legacy-db`） |
| X4 风险门名称不裁剪 / 不换掉 | 存活 | 抓住（`memo-pricing`、`memo-legacy-db`） |
| X7 teaming 不裁剪 / 不整段换掉 | 存活 | 抓住（`memo-pricing`、`memo-legacy-db`） |
| M4c 整块 `pricingInputs` 塞进演算（编排里，键名拼出来） | 存活 | 抓住（`memo-orchestrate-db`） |
| M6b 没有对手价时用我方报价（`memoCompetitorPrice`） | 存活 | 抓住（`memo-pricing`、`memo-orchestrate-db`） |
| M6c 没有对手价时把我方报价当对标价（编排里） | 存活 | 抓住（`memo-orchestrate-db`） |
| 新代码另加：X8 竞争格局、X9 风险门依据、X10 状态不查取值、X11 RFI 问题不判断；R1 去掉 NFKC、R2 去掉数字分隔符归一、R3 去掉「万」、R4 去掉 k、R5 去掉中文大写数字、R6 去掉「百分之」、R7 去掉「个点」、R8 去掉 GP | — | 12 个全部抓住（R6、R8 第一轮存活——探针句里另有别的字眼——补了「每条规则单独一句」后抓住） |

合计：改前 7 个变异 7 个存活；改后 19 个变异 19 个被抓住。

### 8.3 行为变化

- **只影响旧版备忘（v3 以前）**；v3 备忘、模型输入、提示词都没变。
- 旧版：情报页签返回的备忘里，竞争格局、teaming、数据缺口、风险门名称也换成短句（以前不碰成本的照旧给出）；卡片只剩旧版说明、「报价策略：已隐藏（旧版）」与导出按钮（风险门、数据缺口不再列出）；工作台摘要不再列风险门；投标文件草稿的输入不再带风险门与 teaming；澄清问题文件里旧版 RFI 一条都不列入（独立复核 B1 后；提交表外照旧写有几条、怎样补齐）。
- 宁可多换的代价见 §6 第 5 条。

### 8.4 门禁（`2d36e638`；之后只改了本报告与 TASKFLOW）

| 项 | 结果 |
|---|---|
| `memo-pricing.test.ts` | 55 通过（交叉验证前 40） |
| 隔离库 `memo-legacy-db.isolated.test.ts`（`qy_iso_d`） | 11 通过（交叉验证前 8） |
| 隔离库 `memo-orchestrate-db.isolated.test.ts`（`qy_iso_d`，新） | 8 通过 |
| `project-routes-guard.test.ts`（FIX-21 守卫） | 98 通过 |
| `bash scripts/check-test-registry.sh` | OK：已注册 707 个，历史欠账 66 条 |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（current errors 38 / baseline 53，无新增指纹；浅克隆下「PR 改动文件」附加检查照旧被跳过）；本 change 相对 main 改的 ts / tsx 单独跑 `eslint`：0 error、0 warning |
| `openspec validate strategy-memo-cost-strip --strict` | valid（四条要求 281 / 218 / 383 / 427 字） |
| 归档演练（scratchpad 副本） | `openspec archive strategy-memo-cost-strip --yes` 新建 `tender/bid-strategy-memo` +4；之后 `openspec validate --specs --strict` 154 过 0 不过（main `51865685` 153 过 0 不过） |
| `git diff origin/main -- prisma/ vercel.json package.json package-lock.json openspec/config.yaml .claude/launch.json` | 空 |
| CI 子集 `npm run test:ci`（`ci` 假库、不带 `DATABASE_ENVIRONMENT`） | PASS（`memo-pricing` 55、守卫 98；两个隔离库测试按设计跳过） |
| 全量 `npm test`（`qy_full_chain2d` 删库重建 + `migrate deploy`，`< /dev/null`） | `730/741 通过, 11 失败`：10 项与 main 基线逐条相同（来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB 75 / 76）；另 1 项 Supplier Intel S1 审计脊柱 DB 是 T20 计时断言偶发（`holderCommittedAt` 比 `childSettledAt` 晚 1 毫秒），单独重跑两次都 86 通过 0 失败。全量里 `memo-pricing` 55、`memo-legacy-db` 11、`memo-orchestrate-db` 8、守卫 98 都过；网站询盘相关测试都过 |

### 8.5 独立复核后修订（2026-11-23）

独立复核（在 `4b22aab2` 上；协调会话把 main `2a0eb964` 合进本分支，含 #539 CHAIN-2c）的结论：其余修订都对，有 1 个阻断项 B1。按协调会话定的修法落实如下。之前先把 origin/main `c376be86`（含 #564 BIDPAGE-3）合进本分支（合并提交 `9c3ba172`，无冲突，TASKFLOW 两边的行都在，prisma 没有变化）；代码与四件套改动在 `790475de`。

| 编号 | 复核的发现 | 去向 |
|---|---|---|
| B1（阻断） | 旧版备忘的 RFI 问题仍按规则判断，会进**对外**澄清问题文件（英文列标「可直接提交」）与情报页签接口；复核员自写 48 句成本句漏 30 句（裸数字、币种在后、量级、成数折扣、字眼），40 句正当买方问题误删 18 句（45%）；裸数字与「交货期 30 天」靠规则分不开 | **已修**：旧版备忘的 RFI 一律不列入（`strategicRfis` 为空数组，原来的条数记在 `legacyRfisRemoved`）。澄清问题文件提交表外的内部说明、表为空时「暂无可提交的问题。」、卡片「立即检索外部情报」提示都照旧。规则判断 `looksCostRelated`、`normalizeForCostCheck` 与 `COST_WORDS` / `AMOUNT_LIKE` / `PERCENT_LIKE` 再没有调用方（全仓 grep 只剩测试），连同只为它写的 5 条单测一起删掉。规格「旧版备忘先裁剪再用」改写（402 字）、新增场景「旧版 RFI 一律不列入，v3 照旧」；design 加被否决的备选 F「保留规则判断」及复核数字；proposal、tasks 同步 |
| N2（应修） | v3 判定改成子串 / 前缀时三个测试都过 | **已补用例**：`tender-bid-strategy-memo/v3-draft`、`…/v30`、`…/v3 `（尾空格）、前空格、大写、带前缀等 8 种写法都按旧版处理；判定本身本来就是逐字相等，没改代码（加了注释） |
| N3（可选→做） | 不是对象的备忘（数组 / 字符串）原样返回 | **已改**：`null` / `undefined` 原样，数组、字符串、数字返回 `null`（按旧版处理、不出）；加用例 |

**探针（改后）**：
- 交叉验证的 33 句 × 6 个位置（`redact-probe.ts`）：0 句留在输出里。
- 复核的 48 句成本句（`probe.ts`，写成 RFI 问题）：改前漏 30 句，改后 0 句。40 句正当问题改前误删 18 句，改后 40 句都不列入——这是定下的做法（旧版 RFI 等重新检索后补齐），不算误删。
- `probe2.ts` 的 23 句（原来直接调规则判断）改成经 `redactLegacyMemo` 跑：改前 14 句漏网，改后 0 句。
- 单测与隔离库：33 + 48 句 × 6 个位置经裁剪结果与澄清问题文件渲染（单测）、经情报页签 / 工作台摘要 / 草稿输入三个真实读取处（隔离库，18 份输出）都是 0 句。

**变异（改后，scratchpad 副本里改一处、跑 `memo-pricing` 与 `memo-legacy-db`）**：7 个全部被抓住。分别是：版本判定改成前缀、改成子串、去空格且不分大小写；不是对象的原样返回；旧版 RFI 原样留下；只去理由；条数不计。

**行为变化**：只影响旧版备忘的 RFI（以前不碰成本的问题会进澄清问题文件，现在一条都不进，表外写明条数与补齐办法），以及形状不对的备忘（以前原样给出，现在不出）。v3 备忘及其 RFI 不变。

**门禁（`790475de`；之后只改本报告与 TASKFLOW）**：

| 项 | 结果 |
|---|---|
| `memo-pricing.test.ts` | 52 通过 |
| 隔离库 `memo-legacy-db.isolated.test.ts`（`qy_iso_d`） | 11 通过 |
| 隔离库 `memo-orchestrate-db.isolated.test.ts`（`qy_iso_d`） | 8 通过 |
| `bid-strategy-memo.test.ts` | 12 通过 |
| `project-routes-guard.test.ts`（FIX-21 守卫） | 98 通过 |
| `bash scripts/check-test-registry.sh` | OK：已注册 711 个，历史欠账 66 条 |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（current errors 38 / baseline 53，无新增指纹）；本 change 相对 main 改的 ts / tsx 单独跑 `eslint`：0 error、0 warning |
| `openspec validate strategy-memo-cost-strip --strict` | valid（四条要求 281 / 218 / 402 / 427 字） |
| 归档演练（scratchpad 副本，`b54a1c30`） | `openspec archive strategy-memo-cost-strip --yes` 后 `openspec validate --specs --strict` 158 过 0 不过（main `325cbdc0` 157 过 0 不过） |
| `git diff origin/main -- prisma/ vercel.json package.json package-lock.json openspec/config.yaml .claude/launch.json` | 空 |
| CI 子集 `npm run test:ci` | PASS（`memo-pricing` 52、守卫 98；两个隔离库测试按设计跳过） |
| 全量 `npm test`（`qy_full_chain2d` 删库重建 + `migrate deploy`，`< /dev/null`，`790475de`） | `736/746 通过, 10 失败`，10 项与 main 基线逐条相同（来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB 75 / 76）；这次 Supplier Intel S1、网站询盘并发认领、CAL-1 日历观察 DB（80 / 0）都过。全量里 `memo-pricing` 52、`memo-legacy-db` 11、`memo-orchestrate-db` 8、`bid-strategy-memo` 12、守卫 98 都过 |

全量跑完后 main 又进了 `325cbdc0`（#572 BIDPAGE-3 归档与交接，只改 `docs/` 与 `openspec/`），已合进本分支（`b54a1c30`，无冲突）；它与 `790475de` 的 src / scripts / prisma / package 逐字相同，全量与 CI 结果对它同样成立，归档演练与校验在它上面重跑过。
