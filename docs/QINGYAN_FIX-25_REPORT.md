# FIX-25 报告 — 目标毛利只给有财务查看权的人（`target-margin-finance-gate`）

合并当天起，项目负责人和有全企业「查看项目结算」权限的人在报价表助手里看到的、能改的都和以前一样。其他人在报价表助手卡上看不到、也改不了目标毛利，那一格换成一句「需要财务查看权才能看目标毛利。」；合并前就开着页面的人点「保存并重算」会看到红字叫他刷新，刷新后把对手价再填一次就能存上。项目列表和调查室在后台少传了一组报价数据，页面上看不出变化。

**没有开关，合并即在生产生效。**

| 项 | 值 |
|---|---|
| TASKFLOW | FIX-25（CHAIN-2d #538 交叉验证 F4，属 CHAIN-2b #532 范围，优先） |
| 起因 | 只读成员从 `GET /api/projects/:id/bid-intelligence` 拿到 `pricingInputs.targetMarginPct = 23.7` 与 `ourPriceCad = 114881.15`，114,881.15 × (1 − 0.237) = 87,654.32，正好是我方成本（报价按报价表助手「成本 + 目标毛利」底价定时精确反推，`src/lib/tender-pricing/calc.ts:213-215`） |
| GATE | 七条由协调会话 2026-11-23 按推荐定（Lucas 2026-11-22 授权「都按照你的推荐来」），第 ④ 条措辞按多维审查的文案意见调整，见 §7 |
| OpenSpec change | `openspec/changes/target-margin-finance-gate/`（`tender/pricing-helper`：新增 1 条、改 7 条；`tender/pricing-compare-cost-source`：改 1 条） |
| 基线 | 四件套 main `2a0eb964`；实施与修订时依次合入 `c376be86`（#564 BIDPAGE-3）、`fc321a7d`（#538 CHAIN-2d）、`fbacf6bd`（#569 FIX-14）、`71a86a0a`（#574 FIX-26a）、`4b6c3dd4`（#581 BIDPAGE-4、#579 FIX-26a 归档）、`9ff1b29e`（#582 BIDPAGE-4 归档）、`58508ecc`（#575 TREE-2）；本分支最后合入的 main 提交是 `58508ecc` |
| 分支 / PR | `claude/zen-turing-azudvx-fix25`；PR #578（2026-11-23 合并，合并提交 `c339cb40`）；归档 PR 见 TASKFLOW FIX-25 行（archive `2026-11-23-target-margin-finance-gate`） |
| 开关 | 没有；合并即生效 |

## 1. 合并后谁会发现什么变了

- **没有财务查看权、能编辑项目的人**：报价表助手卡「我方假设」里，原来能改的目标毛利输入框换成「目标毛利」四个字加「需要财务查看权才能看目标毛利。」；「相当于成本加成 x%」与「目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。」不再出现。对手价与评分模型照常保存。情景表数字不变（没有成本时目标毛利本来就不参与计算）。
- **合并前就开着项目页的这批人**：点「保存并重算」会看到红字「没有保存：页面已更新，目标毛利现在和我方成本一样，只给有财务查看权的人改。请刷新页面，重新填写后再保存。」（旧卡片每次都带目标毛利）；表单里刚填的值留在页面上，但没存。刷新页面后把对手价再填一次保存就好。旧卡片上点「从文件重新推导评分模型」成功后，目标毛利框会变空——库里的值没动，同样刷新即可。
- **只读成员**：那一格同样换成一句话（原来是禁用的输入框，显示已存的值）。
- **项目负责人、持组织范围 `project.finance.read` / `manage` 的人、平台超级管理员**：没有变化。
- **任何人**：`GET /api/projects` 与 `GET /api/projects/:id/bid-intelligence` 返回的 `summaryJson` 不再带 `pricingInputs`（对手价、成本、目标毛利、成本来源、镜像的我方报价）和 `bidDraft`（投标文件草稿元信息，含起草模型写的内部注）。这两个接口的界面（项目列表页、调查室区块）都不读这两个键，看不出变化。草稿卡片走自己的 `GET …/bid-draft`，照旧。
- **顺带修好**：改动前，没有财务查看权的编辑者发一个非法的目标毛利（如字符串），会把负责人存的目标毛利清成 `null`；现在带目标毛利这个键就 403，库不变。

## 2. 改了什么

| 文件 | 改动 |
|---|---|
| `src/lib/tender-pricing/finance-view.ts` | 没有财务查看权时读取视图与保存返回的 `targetMarginPct` 与 `ourCostCad` 一起置 `null`（共用 `costHidden`）；共用的「请求里有没有这个键」`hasKey`；「这次保存碰了受限的键」加上 `inputs.targetMarginPct`；房间 JSON 裁剪改为去掉整个 `pricingInputs`、`bidDraft` 与备忘；卡片保存请求体的纯函数 `buildPricingSaveBody`（多审 T7）；403 那句与目标毛利格那句，删掉「目标毛利只用于…」；模块说明符只有 `./calc` 与 `./compare-cost-source`（后者只 `import type`） |
| `src/app/api/projects/[id]/pricing-helper/route.ts` | 保存里三项输入与成本来源的「请求里带了没有」改用 `hasKey`（与 403 判定同一个；多维审查对三个键核对过与原来的 `in` 结果 0 处不同）；注释 |
| `src/components/tender/pricing-helper-card.tsx` | 展示部分抽成纯组件 `PricingHelperCardView`（多审 T7）；`costHidden` 时目标毛利格换成固定标签「目标毛利」+ 那句话（`data-testid="pricing-margin-hidden"`）、不渲染成本加成提示、去掉那句说明；保存请求体由 `buildPricingSaveBody` 给出，没有财务查看权时只带对手价 |
| `src/app/api/projects/route.ts`、`src/app/api/projects/[id]/bid-intelligence/route.ts` | 只改注释 |
| 测试 | 新增 `target-margin-finance-view.test.ts`（不连库，60 项）、`target-margin-finance-db.isolated.test.ts`（隔离库，135 项），登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`finance-view.test.ts`、`pricing-helper-finance-db.isolated.test.ts`、`compare-cost-source.test.tsx` 只改随行为变的断言（另按多审补了几条） |

零 schema、零依赖、零新增模型调用、没有新增出站。不碰 `src/lib/muse-bridge/**`、BIDPAGE 的 `bid-page-summary` 金额门与 `src/app/api/projects/[id]/bid-page/**`、`src/lib/project-finance/access.ts`。

**改过的用户可见文字（原文）**

- 403：`没有保存：页面已更新，目标毛利现在和我方成本一样，只给有财务查看权的人改。请刷新页面，重新填写后再保存。`（原 CHAIN-2b：`没有保存：需要财务查看权才能修改我方成本。请刷新页面，重新填写后再保存。`）
- 目标毛利格：标签 `目标毛利`，下面一行 `需要财务查看权才能看目标毛利。`
- 删掉：`目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。`

## 3. 出口清单与去向

本 change 处理（都没有开关、生产在跑）：

| # | 出口 | 改动前给谁 | 改动后 |
|---|---|---|---|
| 1 | `GET …/bid-intelligence` 的 `room.summaryJson.pricingInputs.targetMarginPct`（同一份里有镜像的我方报价） | 项目读者（含不是成员的组织管理员） | 对所有人不带 `pricingInputs` |
| 2 | `GET /api/projects` 每个项目的 `intelligenceRoom.summaryJson.pricingInputs.targetMarginPct`（项目行另有 `ourBidPrice`） | **本组织任一 active 成员**（`src/lib/projects/visibility.ts:57-61`，不必是项目成员；隔离库改动前对照证实） | 对所有人不带 `pricingInputs` |
| 3 | `GET …/pricing-helper` 的 `inputs.targetMarginPct` | 项目读者 | 没有财务查看权时 `null` |
| 4 | `POST …/pricing-helper` 保存返回的 `inputs.targetMarginPct`；没有财务查看权的编辑者能改目标毛利 | 项目编辑者 | 返回 `null`；带目标毛利 403 |
| 5 | 报价表助手卡的目标毛利输入框与成本加成提示 | 项目读者 | 没有财务查看权时换成一句话 |
| 5b | 两个房间 JSON 接口里的 `bidDraft.internalNotesZh`（起草模型写的内部注，起草输入含旧版备忘） | 同 #1、#2 | 对所有人不带 `bidDraft` |

不在本 change（归属已定）：

| 出口 | 归属 |
|---|---|
| 报价引擎的毛利率、定价比例、估算成本（main 上五个项目角色都能看，开关生产未设） | CHAIN-2e #556 |
| #564 BIDPAGE-3 逐行报价、#581 BIDPAGE-4 只报总价写进 `ProjectQuote.pricingRate` 的目标毛利：自己的接口按金额门，但旧报价单详情接口整行给出 | FIX-26 主体 |
| 旧报价单 `GET …/quotes` / `GET …/quotes/:id` 直接给内部成本与利润率；Excel（`src/lib/quote/export-excel.ts:45-46`）、AI 审查（`quotes/[quoteId]/ai/review/route.ts:11,53-54`）、`src/lib/agent/skills/quote.ts:253-254` | FIX-26 主体（原 FIX-21 后续 8）；报价单 PDF 的「Profit Margin」已由 FIX-26a（#574，`71a86a0a`）去掉 |
| **审计日志详情** `GET /api/audit-logs/:id`（`src/app/api/audit-logs/[id]/route.ts:46-55,72`）原样返回 `beforeData` / `afterData` 给本组织任一组织管理员与该项目 `project_admin`，不看财务查看权；报价引擎另起新版时往审计写 `sourceSellingPrice`、`sourceCost`、`sourceMargin`（`src/lib/quote-engine/service.ts:351`）；审计 id 可从审计列表或项目动态（`src/lib/activity/formatter.ts:143`）拿到；接口本身没有开关 | FIX-26 主体（多审 S1；FIX-26 四件套由协调会话另补） |
| 询价列表 / 明细 / 旧比价接口给项目读者供应商报价原价（`src/lib/inquiry/service.ts:191-201`、`…/compare/route.ts:6-11`） | FIX-26b（等 Lucas） |
| 问青砚 `project_get_project_quotes` 给组织成员 `profitMargin` + `totalAmount` | FIX-26 主体 |
| 投标策略备忘送进模型的目标毛利（`2a0eb964` 上 `orchestrate.ts:425-439`）；`GET …/bid-draft` 返回的 `internalNotesZh`；生成的投标文件草稿文件本身带「内部审阅注（提交前删除）」（`src/lib/tender-bid-draft/render.ts:68-70` 写进文件，`src/lib/projects/generate/generate-docs.ts:446-467` 存成项目文件，项目读者能看） | CHAIN-2d #538（已合并 `fc321a7d`，编排只取对手价）；草稿那两项是它列的后续（多审 S3），TASKFLOW「待定」「投标文件草稿的内部注给项目读者」 |
| 项目财务的实际利润与预算利润百分比（`GET …/finance/budget`、`/api/org/tender-portfolio`；`TENDER_FINANCIAL_CONTROL_ENABLED` 生产关） | CHAIN-2e Out of scope「另开任务」 |
| 离开组织、但岗位绑定与项目成员身份还在的人仍有财务查看权（软移除不撤绑定与项目成员身份：`src/app/api/organizations/[orgId]/members/[memberId]/route.ts:176`；`src/lib/projects/access.ts:160` 只看项目成员；岗位判定只看绑定） | 范围外，即 TASKFLOW「待定」「财务特权 / 岗位绑定跟着组织成员身份走（CHAIN-2c 交叉验证 F3）」那一行（多审 S2） |

核对后不是出口：Muse `price_scenario` 传 `targetMarginPct: null`；BIDPAGE 汇总接口规格写明不出毛利率；成本核算只给财务查看权、不落库；投标工作区成本草稿只在本人浏览器；官方价格表导出不含毛利；通知、项目动态不带毛利；审计日志**列表**不返回 `afterData`、不取 `beforeData`（但**详情**返回，见上表）。逐条文件:行号见 design「出口清单」。

## 4. 与我方报价配对即可反推成本的字段（GATE ①：我方报价不收）

我方报价（`Project.ourBidPrice`、房间镜像 `pricingInputs.ourPriceCad` / `ourPrice`、报价引擎 `sellingPrice`、旧报价单 `totalAmount` / `subtotal`、投标文件草稿输入的 `ourPriceCad`）照旧给项目读者。下面这些只要再拿到一个，就能和我方报价算出成本：

| 字段 | 在哪 | 本 change 后对没有财务查看权的人 | 归属 |
|---|---|---|---|
| 目标毛利 `pricingInputs.targetMarginPct` | 报价表助手、两个房间 JSON 接口 | **拿不到** | FIX-25 |
| 我方成本 `pricingInputs.ourCostCad`（直接就是成本） | 同上 | 拿不到 | CHAIN-2b（已合并） |
| 报价引擎 `grossMarginPct` / `markupPct` / `pricingRate` / `estimatedCost` / `grossProfit` | `…/quote-engine/**` | main 上五个项目角色都拿得到（开关生产未设） | CHAIN-2e #556 |
| `ProjectQuote.profitMargin` / `internalCost` / `pricingRate` / `summaryJson` | 旧报价单接口、编辑器、Excel、AI 审查 | 拿得到（生产在用；PDF 已不印） | FIX-26 主体 |
| 审计里的 `sourceCost` / `sourceMargin`（另起新版时写） | 审计日志详情 | 组织管理员与项目管理员拿得到 | FIX-26 主体 |
| `profitMargin`（问青砚 `project_get_project_quotes`） | 问青砚 | 组织成员即可拿到 | FIX-26 主体 |
| 预算的利润百分比 | `GET …/finance/budget` | 项目角色带成本读即可（财务开关生产关） | 另开任务（CHAIN-2e Out of scope） |
| 投标策略备忘里转述的毛利 / 底价 | 情报页签、工作台摘要等 | 新备忘不带；旧版备忘在每个读取处先裁剪（#538 已合并） | CHAIN-2d #538 |

所以「项目读者拿不到我方成本」要等 CHAIN-2e 与 FIX-26 也合并才成立。

## 5. 怎么验证的

| 测试 | 改动前（`origin/main` 版本的 `finance-view.ts`、路由、卡片三个文件） | 改动后 |
|---|---|---|
| `npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts`（新，不连库） | 23 过 21 不过（另 16 项依赖新导出，在旧代码上没跑到）；第一版 45 项时是 23 过 19 不过 | 60 过 |
| `NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`（新，隔离库 `qy_iso_c`） | 44 过 91 不过；第一版 42 项时是 16 过 26 不过 | 135 过 |
| `finance-view.test.ts` | 47 过 | 48 过 |
| `pricing-helper-finance-db.isolated.test.ts` | 34 过 | 38 过（夹具目标毛利 15 → 17.3 并加进搜索、先去掉时间戳；w4 / w5 改期望 403 且库不变；「只带对手价」另起一次保存；项目列表逐身份搜；403 句写字面量） |
| `compare-cost-source.test.tsx` | 83 过 | 83 过（两条接线字符串） |
| `pricing-helper.test.ts` / `pricing-helper-save-db` / `pricing-helper-lock-db` / `compare-cost-source-db` / `room-summary-merge-db` / `memo-pricing` | 13 / 17 / 17 / 42 / 15 / 52 | 原样 |

隔离库新测试覆盖：复现数据（成本 87,654.32、目标毛利 23.7、成本来源里的落地价 76,543.21、镜像我方报价与 `ourBidPrice` 114,881.15、带内部注的 `bidDraft`）；读取在比价成本来源开关关、开下各跑一遍；七种没有财务查看权的项目读者（只读成员、项目编辑者、没有财务键的 `org_admin`、只在分配范围持 `project.finance.read` 的投标同事、组织负责人 `org_owner`、项目级 `accounting`、项目级 `operator`）读调查室、项目列表、报价表助手、项目详情——四个响应都没有目标毛利，`summaryJson` 没有 `pricingInputs` 与 `bidDraft`，报价表助手的顶层键在白名单内、`inputs` 恰好三项、与「成本、目标毛利都没填」的项目逐字节相同，去掉时间戳后搜不到目标毛利、成本、落地价与内部注，项目列表与详情照旧带 `ourBidPrice`；本组织普通成员（不是项目成员）在项目列表看到该项目、带 `ourBidPrice`、没有 `pricingInputs`，另外三个 403；负责人、组织范围 `project.finance.read`、平台超级管理员读报价表助手得 23.7 且逐字节相同，负责人读两个房间 JSON 接口同样没有那三个键；编辑者带成本 / 成本来源 / 只带顶层成本来源不带 inputs / 目标毛利数字 / 目标毛利 `null` / 与库里相同的 23.7 保存都 403、库不变；`org_admin` 与组织负责人带目标毛利 403、只带对手价 200 且返回置空；只带对手价成功且目标毛利、成本、成本来源保留；409 → 403 → 400。

**每个新断言的变异对照**（`qy_iso_c`；每次只放一个变异，跑五个测试，记下失败条数，再用 `git checkout` 还原；还原后五个测试是 60 / 48 / 83 / 135 / 38 全过）：

| 变异（对应审查条目） | 抓住它的测试：失败条数 |
|---|---|
| X1 403 那句改回旧句 | tmv 1、fv 1、tmdb 8、fdb 6 |
| X2 隐藏时目标毛利格标签改回按开关的写法 | tmv 3 |
| T7 卡片展示 `costHidden` 写死 false（审查 M43） | tmv 4 |
| T7 保存请求体没有财务查看权时多带一份目标毛利（M44 的纯函数版） | tmv 3 |
| T7 卡片保存时再拼一份带目标毛利的 inputs（M44 的卡片版） | tmv 1 |
| T8 `export { db } from "../db"`（M49）/ `import("node:fs")`（M50）/ `export * from "../projects/access"`（M52）/ `require("../db")` | 各 tmv 1 |
| T1 读取：组织负责人拿到目标毛利（M56） | tmdb 6 |
| T1 项目列表：只对组织负责人原样（M67） | tmdb 4 |
| T2 读取：项目级 accounting 拿到目标毛利（M57）/ 项目级 operator | tmdb 6 / 6 |
| T3 保存返回：`org_admin` / 组织负责人拿到原样 inputs（M59） | tmdb 1 / 1 |
| T3 `org_admin` / 组织负责人只带目标毛利时放行并写库（M60） | tmdb 3 / 2 |
| T4 目标毛利与库里相同则当没带（M61） | tmdb 1 |
| T5 读取多带成本加成率（M69）/ 回显 0.237（M74）/ inputs 里多带一个键 | tmdb 28 / 28 / 28（最后一个 fv 也 1） |
| T6 读取多带「填没填」标记（M68）/ 填了时 note 换一句 | tmdb 28 / 14 |
| T9 开关开着时另一个字段回显目标毛利（M73）/ 只在开关开着时漏给只读成员 | tmdb 21、fdb 4 / tmdb 6、fdb 4 |
| P7 调查室对负责人多带回显 / 项目列表对负责人多带回显 | tmdb 2、fdb 1 / tmdb 2、fdb 2 |
| P8 403 前先把目标毛利写进库 | fv 1、tmdb 2、fdb 1 |
| 可选：项目列表对不是负责人的人多带回显目标毛利 / 回显成本 | tmdb 16 / tmdb 16、fdb 1（正是新加的「项目列表（只读成员）…搜不到」） |
| 交叉验证 X14：有财务查看权时目标毛利 `n(form.margin) \|\| null`（填 0 存成 null） | tmv 1（新加的「填 0 就存 0」） |
| 交叉验证 X09：路由的 403 判定只看 `inputs`、漏掉顶层 `ourCostSource` | tmdb 2（含新加的「只带顶层成本来源、不带 inputs」）、fdb 1、tmv 1、fv 3 |
| 交叉验证 X12：只读、没有财务查看权时目标毛利格回到（禁用的）输入框 | tmv 2（含新加的「只读、没有财务查看权」渲染） |

（tmv = `target-margin-finance-view.test.ts`，fv = `finance-view.test.ts`，tmdb = `target-margin-finance-db.isolated.test.ts`，fdb = `pricing-helper-finance-db.isolated.test.ts`。审查列的等价变异 M16–M19 不做。）

## 6. 门禁

（本机。以第五轮为准：交叉验证补测试、合入 main `58508ecc`（带进 #575 TREE-2 源码）后。）

第五轮（`50eae3a3` + 文档，全新库 `qy_full_fix25`，`prisma migrate deploy` 后）：

| 命令 | 结果 |
|---|---|
| `npm test`（`< /dev/null`） | **748/758 通过，10 失败，与 main 基线 10 项逐条相同**；偶发项没出现；全量里 typecheck 0 错误；本 change 的五个测试 60 / 48 / 83 / 135 / 38 全过 |
| CI 子集 `npm run test:ci` | PASS（含 `check-swc-nullish-logical`） |
| `npm run typecheck` / `npm run lint:baseline` / `bash scripts/test-runtime-architecture.sh` | 0 错误 / PASS（errors 38，基线 53） / PASS |
| `bash scripts/check-test-registry.sh` | OK（已注册 722，基线剩余 66） |
| `npx openspec validate target-margin-finance-gate --strict` | valid |
| 归档演练 | + 1、~ 8，`--specs --strict` 161/161 |
| 不改的文件 | 与 `58508ecc` 无差异（之后 main 只多了 #583 TREE-2 归档的文档与主规格，已合入） |

第四轮（`e05d789a` + 文档，合入 `4b6c3dd4` 后）：

| 命令 | 结果 |
|---|---|
| `npm test`（`< /dev/null`） | **744/754 通过，10 失败，与 main 基线 10 项逐条相同**（来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB）；偶发项（Supplier Intel S1 T20、网站询盘并发认领、CAL-1、FLOW-H1）这一轮都没出现；全量里的 typecheck 0 错误；本 change 的五个测试 57 / 48 / 83 / 134 / 38 全过 |
| CI 子集 `npm run test:ci`（CI 同款环境变量） | PASS（含 `check-swc-nullish-logical`） |
| `npm run typecheck` | 0 错误 |
| `npm run lint:baseline` | PASS（errors 38 / 基线 53，无新增 fingerprint） |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `bash scripts/check-test-registry.sh` | OK（已注册 718，基线剩余 66） |
| `npx openspec validate target-margin-finance-gate --strict` | valid |
| 不改的文件（`prisma/`、`vercel.json`、`package*.json`、`.claude/`、`openspec/specs/`、`openspec/config.yaml`） | 与 `4b6c3dd4` 无差异（之后 main 只多了 #582 BIDPAGE-4 归档的文档与主规格，已合入） |
| 含 `bidStrategyMemo` 字样的非测试源文件 | 与 main 相同的 8 个 |

第三轮（`a9bcd7c6`，合入 `71a86a0a` 后）：全量 741/751、10 项与基线逐条相同；CI 子集 PASS；typecheck 0 错误、lint:baseline PASS、runtime-architecture PASS、测试注册 OK（716 / 66）。

归档演练：在临时 worktree 里 `openspec archive target-margin-finance-gate --yes`（`tender/pricing-helper` + 1、~ 7，`tender/pricing-compare-cost-source` ~ 1）后 `openspec validate --specs --strict` 全过（第三轮 159/159，合入 `4b6c3dd4` 后 160/160）；主规格里有新 403 句、没有「目标毛利 15%」；演练后删掉 worktree。

第二轮（合入 `fc321a7d` 后，修订前的代码）：全量 738/748、10 项与 main 基线逐条相同；CI 子集 PASS；typecheck、lint:baseline（errors 38 / 基线 53）、runtime-architecture、测试注册、openspec validate 都过；CHAIN-2d 三个测试 52 / 11 / 8 过。合入 `fbacf6bd` 后复核 typecheck、CI 子集、测试注册、validate 与本 change 五个测试。

第一轮（合入 `c376be86` 后）：全量 734/745，10 项与基线相同，另 1 项「FLOW-H1 项目页「下一步」DB」——它的「金额不出现」正则含 `11\.5`，撞上响应里 `closesAt` 时间戳的「11.520Z」（与本 change 无关），单独重跑 103 过；CI 子集第一次被 `check-swc-nullish-logical` 拦下（新隔离库测试两处 `??` 没加括号），加括号后 PASS。

## 7. GATE（已定）

1. 我方报价不另收（§4 留清单）。
2. 没有财务查看权的人带目标毛利的写请求 403。
3. 两个房间 JSON 接口去掉整个 `pricingInputs`（顺带 `bidDraft`）。
4. 文案按推荐，措辞按文案审查调整（Lucas 2026-11-22 授权按推荐）：403「没有保存：页面已更新，目标毛利现在和我方成本一样，只给有财务查看权的人改。请刷新页面，重新填写后再保存。」；目标毛利格固定标签「目标毛利」加「需要财务查看权才能看目标毛利。」。
5. 不加开关，合并即生效。
6. 范围外出口另开 FIX-26，紧接本 change（TASKFLOW 已加一行；原「待定」FIX-21 后续 8 标「并入 FIX-26」）。协调会话随后拆为 FIX-26a（报价单 PDF，#574 已合并 `71a86a0a`）、FIX-26 主体（叠在 CHAIN-2e 上，另加审计日志详情）、FIX-26b（询价明细的供应商原价，等 Lucas）。
7. 合并顺序不等 CHAIN-2e，见 §11。

## 8. 多维审查

五个维度各一个子 agent，各自在 `234d4304` 的干净快照上做，互相不看结论——**都没有阻断项**：

| 维度 | 主要发现 | 处理 |
|---|---|---|
| 正确性与回归（有财务查看权的 248 个用例改前改后对照、`in` → `hasKey` 13 种请求体、D2 用 20000 组随机验证） | 有财务查看权的人 0 处不同；没有的人唯一差别是目标毛利为 null；带目标毛利的 8 种值全部 403、库不变；顺带修好「编辑者发非法目标毛利会清掉负责人存的值」；两个房间 JSON 接口去掉的键没有读者；与 #538 兼容、与 CHAIN-2e 代码 0 冲突、不成环 | 写进报告 |
| 安全 / 隐私与八条硬纪律（约 150 个项目 GET + 10 个组织级接口 + 30 多个问青砚工具 + Muse，开关全关 / 全开两轮，8 种没有财务权的身份） | 本 change 的五个出口都搜不到目标毛利与成本；403 不能用来试探已存值；**审计日志详情接口返回报价引擎另起新版写的 `sourceCost` / `sourceMargin`，出口表漏了**；离开组织仍有财务查看权（既有）；生成的草稿文件带内部审阅注 | 审计详情补进出口表 #11、归 FIX-26 主体（FIX-26 四件套已补读取侧裁剪与写入侧少写）；其余写进范围外与出口表 #9 |
| 规格—代码—测试一致性（改前数字重跑、既有测试期望逐条核对、归档演练） | 数字都对；既有测试的期望改动都比原来严，没有把泄露写成期望；几处文档漂移与两个场景引用不全 | 全部改正 |
| 使用流畅与文案 | 403 那句先说「页面已更新」易被扫成「存上了」；隐藏时标签还带「%（按售价）」；报告白话太长；上线当天旧卡片要刷新后再填一次对手价 | 403 改成「没有保存：页面已更新，……」；标签固定「目标毛利」；白话三句；§11 给同事的话 |
| 测试质量（73 个变异：58 抓住、15 存活，1 个等价） | org_owner、项目 accounting / operator 角色、org_admin / org_owner 的写路径没测；值相同时 200 / 403 可当探针；派生值（0.237、加成率）子串搜不到；卡片没有行为测试；导入约束能被 `export … from` 绕过；隔离库测试只在开关关着时跑 | 补身份与写路径、值相同也 403、响应键白名单与逐字节对照、卡片抽纯函数 / 纯组件并测、导入说明符集合断言、开关两种状态各跑一遍；每条在对应变异下失败 |

**交叉验证**（另起一个没参与实现与上面审查的子 agent，在 `534e29f8` 上亲自跑：15 种身份 × 本 change 五个出口与 BIDPAGE-4 新接口、开关两轮，252 个没有财务权的响应扫目标毛利与成本的各种形式 0 命中，改动前同一探针每种身份都漏；有财务查看权的人 96 步保存 / 读取与 96 份卡片 HTML 改前改后逐字相同；上线当天旧卡片回放 403、库不变、刷新后能存；23 个自设变异抓 21（1 个等价）；与 main `58508ecc`、与 CHAIN-2e 试合无新冲突、不成环；归档演练通过）：**可以合并**。它提的三个测试缺口（有财务权时目标毛利 0、只带顶层成本来源的 403、只读的人的卡片渲染）与两处文档（基线行、`…/bid-draft` 内部注没有 TASKFLOW 行）都已补上。

## 9. 没验证到的

- 生产里有多少项目受影响（存了目标毛利的、同时有我方报价的、能精确反推的）：只读 SQL 在 design「GATE（已定）」之后，要有生产权限的人跑。
- 生产里有没有报价引擎写过的报价（有的话旧报价单详情接口会把定价比例与内部成本给项目读者，FIX-26 主体的优先级随之更高）：同一段 SQL。
- 仓库外有没有调用方读这两个接口的 `pricingInputs` 或 `bidDraft`：代码里没有，看不到服务端日志。
- Vercel 有没有开 Skew Protection：开了的话，上线当天旧卡片的请求会打到旧版本、不会 403，但旧卡片在刷新前仍显示目标毛利。
- 浏览器里实际点一遍卡片：卡片的展示部分与保存请求体有行为测试（`renderToStaticMarkup`、纯函数），读取与保存的接线用源码断言，没有起页面截图。

## 10. 回退办法

回退本 change 的合并提交即可（一个 PR，只改代码与测试，不改库、不迁移数据；已存的目标毛利一直在库里）。回退后目标毛利重新对项目读者可见。

## 11. 合并后要人做的事、与其它 change 的关系

- 跑 design 里的只读 SQL，看生产里能精确反推成本的项目有多少。
- 把下面这段转给投标同事：

  > 今天起，报价表助手里的目标毛利和我方成本一样，只有项目负责人和有全企业「查看项目结算」权限的人能看、能改，其他人那一格会显示一句说明。如果你今天之前就开着项目页，点「保存并重算」看到红字「没有保存……请刷新页面……」，刷新页面、把对手价再填一次保存就好。

- **CHAIN-2e #556**：不等它（GATE ⑦）。两边没有共同业务文件，只共用 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 的登记行与 TASKFLOW；谁后合谁先把 main 合进来重跑门禁。约束：`src/lib/project-finance/view-hint.ts:9` 用的 `COST_ACCESS_HINT_ZH` 没改；`finance-view.ts` 的模块说明符只有 `./calc` 与 `./compare-cost-source`（后者只 `import type`），不引用 `node:`、`@/lib/db`、`next/`，也不 import `project-finance/access`（新测试按全部模块说明符断言）。
- **CHAIN-2d #538**：已于 2026-11-23 先合并（`fc321a7d`）。本分支合入时 TASKFLOW 只留一行 FIX-25（它带进来的位置，CHAIN-2d 行之后），FIX-26 紧随其后。它的遍历测试只放行 `finance-view.ts` 出现 `bidStrategyMemo` 字样，本 change 没有新增别的文件出现它；合入后重跑它的三个测试：`memo-pricing.test.ts` 52 过、`memo-legacy-db` 11 过、`memo-orchestrate-db` 8 过（`qy_iso_c`）。
- **BIDPAGE**：不碰 `bid-page-summary` 金额门与 `bid-page/**`。

## 12. 与四件套的出入

- 实施前按独立审查 F1–F11 修订了四件套（`93bd6021`）：项目列表受众、旧隔离库测试改法、FIX-26 范围、预算利润百分比、`bidDraft`、TASKFLOW 位置、目标毛利格标签、共用「有没有这个键」、403 句首、D3 的否决理由；GATE 七条标「已定」。
- 多维审查后按修订清单改了代码（X1 403 句、X2 固定标签、T7 保存请求体纯函数与展示纯组件）、测试（T1–T9、P7、P8 与可选两条）和四件套（S1 审计日志详情进出口表、S3、P1–P6；P5 把主规格「我方成本只给有财务查看权的人」场景里的目标毛利 15% 改成 17.3%，作为一条 MODIFIED）。没有会改变范围的地方。
- 交叉验证后只补了测试与文档（不改源码）：有财务查看权时目标毛利 0、只带顶层成本来源的 403、只读的人的卡片渲染三条用例；报告基线行；TASKFLOW「投标文件草稿的内部注给项目读者」一行「待定」与 design 出口表 #9 的指向。
- 合入 main 带进来 #564 BIDPAGE-3 与 #581 BIDPAGE-4：逐行报价、只报总价都把目标毛利存在 `ProjectQuote.pricingRate`，自己的接口按金额门；已补进 design 出口表 #6 与本报告 §3、§4（归 FIX-26 主体），不改本 change 范围。
- 顺带发现：FLOW-H1「下一步」隔离库测试的金额正则会撞时间戳（§6），没改，留作另开小改动。
