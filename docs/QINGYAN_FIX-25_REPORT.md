# FIX-25 报告 — 目标毛利只给有财务查看权的人（`target-margin-finance-gate`）

合并后，没有财务查看权的人（只读成员、不是负责人的投标同事、没有财务键的组织管理员等）在工作台「报价表助手」卡上看不到、也改不了目标毛利：那一格变成「需要财务查看权才能看目标毛利。」，成本加成提示不再出现。项目负责人和持全企业「查看项目结算」的人看到的一切照旧。项目列表和调查室读取两个接口对所有人不再带报价表助手的输入和投标文件草稿的内部注——界面上谁都看不出这一点。**没有开关，合并即在生产生效。**

| 项 | 值 |
|---|---|
| TASKFLOW | FIX-25（CHAIN-2d #538 交叉验证 F4，属 CHAIN-2b #532 范围，优先） |
| 起因 | 只读成员从 `GET /api/projects/:id/bid-intelligence` 拿到 `pricingInputs.targetMarginPct = 23.7` 与 `ourPriceCad = 114881.15`，114,881.15 × (1 − 0.237) = 87,654.32，正好是我方成本（报价按报价表助手「成本 + 目标毛利」底价定时精确反推，`src/lib/tender-pricing/calc.ts:213-215`） |
| GATE | 七条由协调会话 2026-11-23 按推荐定（Lucas 2026-11-22 授权「都按照你的推荐来」），见 §7 |
| OpenSpec change | `openspec/changes/target-margin-finance-gate/`（`tender/pricing-helper`：新增 1 条、改 6 条；`tender/pricing-compare-cost-source`：改 1 条） |
| 基线 | 四件套 main `2a0eb964`；实施时合入 main `c376be86`（含 #564 BIDPAGE-3、#559 TREE-1），收尾时再合入 `fc321a7d`（含 #538 CHAIN-2d、#572 BIDPAGE-3 归档） |
| 分支 | `claude/zen-turing-azudvx-fix25`（未开 PR） |
| 开关 | 没有；合并即生效 |

## 1. 合并后谁会发现什么变了

- **没有财务查看权、能编辑项目的人**：报价表助手卡「我方假设」里，原来能改的目标毛利输入框换成标签加「需要财务查看权才能看目标毛利。」；「相当于成本加成 x%」与「目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。」不再出现。对手价与评分模型照常保存。情景表数字不变（没有成本时目标毛利本来就不参与计算）。
- **上线前打开着旧页面的这批人**：点「保存并重算」会得到红字「页面已更新，没有保存：需要财务查看权才能修改我方成本和目标毛利。请刷新页面，重新填写后再保存。」（旧卡片每次都带目标毛利）；表单里刚填的值保留，刷新后正常。
- **只读成员**：那一格同样换成一句话（原来是禁用的输入框，显示已存的值）。
- **项目负责人、持组织范围 `project.finance.read` / `manage` 的人、平台超级管理员**：没有变化。
- **任何人**：`GET /api/projects` 与 `GET /api/projects/:id/bid-intelligence` 返回的 `summaryJson` 不再带 `pricingInputs`（对手价、成本、目标毛利、成本来源、镜像的我方报价）和 `bidDraft`（投标文件草稿元信息，含起草模型写的内部注）。这两个接口的界面（项目列表页、调查室区块）都不读这两个键，看不出变化。草稿卡片走自己的 `GET …/bid-draft`，照旧。

## 2. 改了什么

| 文件 | 改动 |
|---|---|
| `src/lib/tender-pricing/finance-view.ts` | 没有财务查看权时读取视图与保存返回的 `targetMarginPct` 与 `ourCostCad` 一起置 `null`（共用 `costHidden`）；新增共用的「请求里有没有这个键」`hasKey`；「这次保存碰了受限的键」加上 `inputs.targetMarginPct`；房间 JSON 裁剪改为去掉整个 `pricingInputs`、`bidDraft` 与备忘；403 那句改字，新增目标毛利格那句，删掉「目标毛利只用于…」；文件头写明只 import `./calc` 与类型 |
| `src/app/api/projects/[id]/pricing-helper/route.ts` | 保存里三项输入与成本来源的「请求里带了没有」改用 `hasKey`（与 403 判定同一个；对 JSON 解析出的普通对象与原来的 `in` 结果相同）；注释 |
| `src/components/tender/pricing-helper-card.tsx` | `costHidden` 时目标毛利格换成标签 + 那句话（`data-testid="pricing-margin-hidden"`）、不渲染成本加成提示、保存不带目标毛利；去掉那句说明 |
| `src/app/api/projects/route.ts`、`src/app/api/projects/[id]/bid-intelligence/route.ts` | 只改注释 |
| 测试 | 新增 `target-margin-finance-view.test.ts`（不连库）、`target-margin-finance-db.isolated.test.ts`（隔离库），登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`finance-view.test.ts`、`pricing-helper-finance-db.isolated.test.ts`、`compare-cost-source.test.tsx` 只改随行为变的断言 |

零 schema、零依赖、零新增模型调用、没有新增出站。不碰 `src/lib/muse-bridge/**`、BIDPAGE 的 `bid-page-summary` 金额门与 `src/app/api/projects/[id]/bid-page/**`、`src/lib/project-finance/access.ts`。

## 3. 出口清单与去向

本 change 处理（都没有开关、生产在跑）：

| # | 出口 | 改动前给谁 | 改动后 |
|---|---|---|---|
| 1 | `GET …/bid-intelligence` 的 `room.summaryJson.pricingInputs.targetMarginPct`（同一份里有镜像的我方报价） | 项目读者（含不是成员的组织管理员） | 对所有人不带 `pricingInputs` |
| 2 | `GET /api/projects` 每个项目的 `intelligenceRoom.summaryJson.pricingInputs.targetMarginPct`（项目行另有 `ourBidPrice`） | **本组织任一 active 成员**（`src/lib/projects/visibility.ts:57-61`，不必是项目成员；隔离库改动前对照证实） | 对所有人不带 `pricingInputs` |
| 3 | `GET …/pricing-helper` 的 `inputs.targetMarginPct` | 项目读者 | 没有财务查看权时 `null` |
| 4 | `POST …/pricing-helper` 保存返回的 `inputs.targetMarginPct`；没有财务查看权的编辑者能改目标毛利 | 项目编辑者 | 返回 `null`；带目标毛利 403 |
| 5 | 报价表助手卡的目标毛利输入框与成本加成提示 | 项目读者 | 没有财务查看权时换成一句话 |
| 5b | 两个房间 JSON 接口里的 `bidDraft.internalNotesZh`（起草模型写的内部注，起草输入含旧版备忘） | 同 #1、#2 | 对所有人不带 `bidDraft`（审查 F6） |

不在本 change（归属已定）：

| 出口 | 归属 |
|---|---|
| 报价引擎的毛利率、定价比例、估算成本（main 上五个项目角色都能看，开关生产未设） | CHAIN-2e #556 |
| #564 BIDPAGE-3 逐行报价写进 `ProjectQuote.pricingRate` 的目标毛利：自己的接口按金额门，但旧报价单详情接口整行给出 | FIX-26 |
| 旧报价单 `GET …/quotes` / `GET …/quotes/:id` 直接给内部成本与利润率；报价单 PDF 打印「Profit Margin」（`src/lib/quote/export-pdf.ts:137-138`，最严重）、Excel（`export-excel.ts:45-46`）、AI 审查（`quotes/[quoteId]/ai/review/route.ts:11,53-54`）、`src/lib/agent/skills/quote.ts:253-254` | FIX-26（原 FIX-21 后续 8） |
| 询价列表 / 明细 / 旧比价接口给项目读者供应商报价原价（`src/lib/inquiry/service.ts:191-201`、`…/compare/route.ts:6-11`） | FIX-26 |
| 问青砚 `project_get_project_quotes` 给组织成员 `profitMargin` + `totalAmount` | FIX-26 |
| 投标策略备忘送进模型的目标毛利（`2a0eb964` 上 `orchestrate.ts:425-439`）；`GET …/bid-draft` 返回的 `internalNotesZh` | CHAIN-2d #538（已合并 `fc321a7d`，编排只取对手价）；`bid-draft` 那项是它列的后续 |
| 项目财务的实际利润与预算利润百分比（`GET …/finance/budget`、`/api/org/tender-portfolio`；`TENDER_FINANCIAL_CONTROL_ENABLED` 生产关） | CHAIN-2e Out of scope「另开任务」 |

核对后不是出口：Muse `price_scenario` 传 `targetMarginPct: null`；BIDPAGE 汇总接口规格写明不出毛利率；成本核算只给财务查看权、不落库；投标工作区成本草稿只在本人浏览器；官方价格表导出不含毛利；通知、项目动态、审计日志列表都不带毛利。逐条文件:行号见 design「出口清单」。

## 4. 与我方报价配对即可反推成本的字段（GATE ①：我方报价不收）

我方报价（`Project.ourBidPrice`、房间镜像 `pricingInputs.ourPriceCad` / `ourPrice`、报价引擎 `sellingPrice`、旧报价单 `totalAmount` / `subtotal`、投标文件草稿输入的 `ourPriceCad`）照旧给项目读者。下面这些只要再拿到一个，就能和我方报价算出成本：

| 字段 | 在哪 | 本 change 后对没有财务查看权的人 | 归属 |
|---|---|---|---|
| 目标毛利 `pricingInputs.targetMarginPct` | 报价表助手、两个房间 JSON 接口 | **拿不到** | FIX-25 |
| 我方成本 `pricingInputs.ourCostCad`（直接就是成本） | 同上 | 拿不到 | CHAIN-2b（已合并） |
| 报价引擎 `grossMarginPct` / `markupPct` / `pricingRate` / `estimatedCost` / `grossProfit` | `…/quote-engine/**` | main 上五个项目角色都拿得到（开关生产未设） | CHAIN-2e #556 |
| `ProjectQuote.profitMargin` / `internalCost` / `pricingRate` / `summaryJson` | 旧报价单接口、编辑器、PDF、Excel、AI 审查 | 拿得到（生产在用） | FIX-26 |
| `profitMargin`（问青砚 `project_get_project_quotes`） | 问青砚 | 组织成员即可拿到 | FIX-26 |
| 预算的利润百分比 | `GET …/finance/budget` | 项目角色带成本读即可（财务开关生产关） | 另开任务（CHAIN-2e Out of scope） |
| 投标策略备忘里转述的毛利 / 底价 | 情报页签、工作台摘要等 | 新备忘不带；旧版备忘在每个读取处先裁剪（#538 已合并） | CHAIN-2d #538 |

所以「项目读者拿不到我方成本」要等 CHAIN-2e 与 FIX-26 也合并才成立（CHAIN-2d 已合并）。

## 5. 怎么验证的

| 测试 | 改动前（`origin/main` 版本的 `finance-view.ts`、路由、卡片） | 改动后 |
|---|---|---|
| `npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts`（新，不连库） | 23 过 19 不过 | 45 过 |
| `NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`（新，隔离库 `qy_iso_c`） | 16 过 26 不过 | 42 过 |
| `finance-view.test.ts` | 47 过 | 48 过（一条拆成两条） |
| `pricing-helper-finance-db.isolated.test.ts` | 34 过 | 36 过（夹具目标毛利 15 → 17.3 并加进搜索、先去掉时间戳；w4 / w5 改期望 403；「只带对手价」另起一次保存；`FINREAD` 带目标毛利 100 得 400） |
| `compare-cost-source.test.tsx` | 83 过 | 83 过（一条接线字符串） |
| `pricing-helper.test.ts` / `pricing-helper-save-db` / `pricing-helper-lock-db` / `compare-cost-source-db` / `room-summary-merge-db` | 13 / 17 / 17 / 42 / 15 | 原样 |

隔离库新测试覆盖：复现数据（成本 87,654.32、目标毛利 23.7、镜像我方报价与 `ourBidPrice` 114,881.15、带内部注的 `bidDraft`）；只读成员、项目编辑者、没有财务键的 `org_admin`、只在分配范围持 `project.finance.read` 的投标同事读调查室、项目列表、报价表助手、项目详情——四个响应都没有目标毛利，`summaryJson` 没有 `pricingInputs` 与 `bidDraft`，去掉时间戳后搜不到 `23.7`、`87654`、`87,654` 与内部注，项目列表与详情照旧带 `ourBidPrice`；本组织普通成员（不是项目成员）在项目列表看到该项目、带 `ourBidPrice`、没有 `pricingInputs`，另外三个 403；负责人、组织范围 `project.finance.read`、平台超级管理员读报价表助手得 23.7 且逐字节相同；编辑者带成本 / 成本来源 / 目标毛利数字 / 目标毛利 `null` 保存都 403、库不变，只带对手价成功且目标毛利保留、返回置空；409 → 403 → 400。改动前对照里「本组织普通成员读项目列表没有 pricingInputs」不过，证实审查 F1：改动前不是项目成员的组织成员也能从项目列表拿到目标毛利。

## 6. 门禁

（本机。第二轮是收尾时合入 main `fc321a7d`（含 #538 CHAIN-2d）之后重跑，以它为准；第一轮是合入 `c376be86` 后。）

第二轮（`91d80797` + 文档修订，全新库 `qy_full_fix25`）：

| 命令 | 结果 |
|---|---|
| `npm test` | **738/748 通过，10 失败，与 main 基线 10 项逐条相同**（来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB）；typecheck 0 错误 |
| CI 子集 `npm run test:ci` | PASS |
| `npm run typecheck` / `npm run lint:baseline` / `bash scripts/test-runtime-architecture.sh` | 通过 / PASS（errors 38，基线 53） / PASS |
| `bash scripts/check-test-registry.sh` | OK（已注册 713，基线剩余 66） |
| `npx openspec validate target-margin-finance-gate --strict` | valid |
| 不改的文件（`prisma/`、`vercel.json`、`package*.json`、`.claude/`、`openspec/specs/`、`openspec/config.yaml`） | 与 `origin/main` 无差异 |
| CHAIN-2d 的三个测试（合入后） | `memo-pricing` 52 过、`memo-legacy-db` 11 过、`memo-orchestrate-db` 8 过 |

第一轮（`ff602829`，合入 `c376be86` 后）：

| 命令 | 结果 |
|---|---|
| `npm test`（全新库 `qy_full_fix25`，`prisma migrate deploy` 后；`ff602829`） | 734/745 通过，11 失败：main 基线 10 项逐条相同（来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB）+ 「FLOW-H1 项目页「下一步」DB」1 项：它的「金额不出现」正则含 `11\.5`，撞上响应里 `closesAt` 时间戳的「11.520Z」（与本 change 无关），在 `qy_iso_c` 单独重跑 103 过 0 不过。本 change 的 5 个测试都在全量里通过（`finance-view` 48、`pricing-helper-finance-db` 36、`target-margin-finance-view` 45、`target-margin-finance-db` 42） |
| CI 子集 `npm run test:ci`（CI 同款环境变量） | PASS（第一次跑被 `check-swc-nullish-logical` 拦下：新隔离库测试两处 `ok(…&&…, …, item ?? …)` 没加括号，加括号后该测试 42 过，CI 子集重跑 PASS） |
| `npm run typecheck` | 通过（0 个错误） |
| `npm run lint:baseline` | PASS（errors 38 / 基线 53，无新增 fingerprint） |
| `bash scripts/check-test-registry.sh` | OK（已注册 710，基线剩余 66） |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `npx openspec validate target-margin-finance-gate --strict` | valid |
| `git diff origin/main -- prisma/ vercel.json package.json package-lock.json .claude/ openspec/specs/ openspec/config.yaml` | 空 |
| 含 `bidStrategyMemo` 字样的非测试源文件 | 与 `origin/main` 相同的 8 个（CHAIN-2d `memo-pricing.test.ts` 的遍历只放行 `finance-view.ts`，本 change 没有新增） |

## 7. GATE（已定）

1. 我方报价不另收（§4 留清单）。
2. 没有财务查看权的人带目标毛利的写请求 403。
3. 两个房间 JSON 接口去掉整个 `pricingInputs`（顺带 `bidDraft`）。
4. 文案按推荐：403「页面已更新，没有保存：需要财务查看权才能修改我方成本和目标毛利。请刷新页面，重新填写后再保存。」；目标毛利格「需要财务查看权才能看目标毛利。」。
5. 不加开关，合并即生效。
6. 范围外出口另开 FIX-26，紧接本 change（TASKFLOW 已加一行；原「待定」FIX-21 后续 8 标「并入 FIX-26」）。
7. 合并顺序不等 CHAIN-2e，见 §11。

## 8. 多维审查

（由协调会话补）

## 9. 没验证到的

- 生产里有多少项目受影响（存了目标毛利的、同时有我方报价的、能精确反推的）：只读 SQL 在 design「GATE（已定）」之后，要有生产权限的人跑。
- 生产里有没有报价引擎写过的报价（有的话旧报价单详情接口会把定价比例与内部成本给项目读者，FIX-26 的优先级随之更高）：同一段 SQL。
- 仓库外有没有调用方读这两个接口的 `pricingInputs` 或 `bidDraft`：代码里没有，看不到服务端日志。
- 浏览器里实际点一遍卡片：卡片的数据在 `useEffect` 里取，用源码断言核对接线（与 CHAIN-2b 同法），没有起页面截图。

## 10. 回退办法

回退本 change 的合并提交即可（一个 PR，只改代码与测试，不改库、不迁移数据；已存的目标毛利一直在库里）。回退后目标毛利重新对项目读者可见。

## 11. 合并后要人做的事、与其它 change 的关系

- 跑 design 里的只读 SQL，看生产里能精确反推成本的项目有多少。
- 告诉投标同事：不是负责人的人在报价表助手里看不到、也改不了目标毛利（与成本同一批人、同一句找谁）。
- **CHAIN-2e #556**：不等它（GATE ⑦）。两边没有共同业务文件，只共用 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 的登记行与 TASKFLOW；谁后合谁先把 main 合进来重跑门禁。约束：`src/lib/project-finance/view-hint.ts:9` 用的 `COST_ACCESS_HINT_ZH` 没改；`finance-view.ts` 不引用 `node:`、`@/lib/db`、`next/`，也不 import `project-finance/access`（新测试有源码断言）。
- **CHAIN-2d #538**：已于 2026-11-23 先合并（`fc321a7d`）。本分支合入时 TASKFLOW 一处冲突，按 tasks 4.3「#538 先合时改它带进来的那一行」解决：只留一行 FIX-25，在它带进来的位置（CHAIN-2d 行之后），前三列不变、后两列取本 change，FIX-26 紧随其后。它的遍历测试只放行 `finance-view.ts` 出现 `bidStrategyMemo` 字样，本 change 没有新增别的文件出现它；合入后重跑它的三个测试：`memo-pricing.test.ts` 52 过、`memo-legacy-db` 11 过、`memo-orchestrate-db` 8 过（`qy_iso_c`）。
- **BIDPAGE**：不碰 `bid-page-summary` 金额门与 `bid-page/**`。

## 12. 与四件套的出入

- 实施前按独立审查 F1–F11 修订了四件套（`93bd6021`）：项目列表受众、旧隔离库测试改法、FIX-26 范围、预算利润百分比、`bidDraft`、TASKFLOW 位置、目标毛利格标签、共用「有没有这个键」、403 句首、D3 的否决理由；GATE 七条标「已定」。
- 实施中没有发现与代码不符、需要改范围的地方。四件套写的「`buildSave` 对请求里没有的键沿用原值」不变，只是判断改用 `hasKey`。
- 合入 main `c376be86` 带进来 #564 BIDPAGE-3：它的逐行报价把目标毛利写进 `ProjectQuote.pricingRate`，自己的接口按金额门；已补进 design 出口表 #6 与本报告 §3、§4（归 FIX-26），不改本 change 范围。
- 顺带发现：FLOW-H1「下一步」隔离库测试的金额正则会撞时间戳（§6），没改，留作另开小改动。
