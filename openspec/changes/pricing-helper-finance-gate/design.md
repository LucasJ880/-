# Design：报价表助手的我方成本只给有财务查看权的人

## Context

- `GET /api/projects/[id]/pricing-helper` 只做 `requireProjectReadAccess`，返回 `inputs.ourCostCad`（已保存的我方成本）、按它算的情景表（毛利一栏、「成本 + 目标毛利」或「成本价」情景——价格 ÷ (1 − 毛利) 或价格本身就是成本），开关 `TENDER_PRICING_COMPARE_SOURCE_ENABLED` 开着时还返回 `compareCost`（比价矩阵选定那一家的落地价与逐项金额、已记来源里的落地价、带已保存成本的「矩阵变了」提示）。
- `POST save`（`requireProjectWriteAccess`）保存三项人工输入与评分模型，返回里也带 `inputs.ourCostCad` 与（开关开着时）`ourCostSource`。卡片每次保存都带三项输入（`pricing-helper-card.tsx` 的 `save`）。卡片是这个接口唯一的调用方。
- 房间 JSON：`GET /api/projects`（项目列表，`intelligenceRoom.summaryJson`）与 `GET /api/projects/[id]/bid-intelligence`（整个房间）原样返回 `summaryJson`，其中 `pricingInputs.ourCostCad`、`pricingInputs.ourCostSource.landedCadTotal` 就是我方成本；两处的界面（`src/app/(main)/projects/page.tsx`、`src/components/bid-workflow/project-intel-sections.tsx`）都不读 `pricingInputs`。成本核算接口的文件头早就写明「情报室的 JSON 位对所有项目读者敞开，成本数据不能放进去」。
- 同类数字在别处的口径：成本核算接口 `bid-workspace/cost-sheet` 没有 `resolveFinancePrivilege(...).canReadAll` 就 403；CHAIN-2 寻源建议卡没有就不带落地价一栏（`loadLanded`，判定出错按无权）。`canReadAll` = 平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read`、项目负责人（`src/lib/project-finance/access.ts`，PERM-4c1 起不再认 `org_admin`；`bids` 岗位的 `project.finance.read` 只在 ASSIGNED 范围，不算）。
- 口径不同的页面（不在本次）：比价矩阵对项目读者显示每家的落地价；报价引擎卡按 `canViewInternal`（任何带 `project:cost:read` 的项目角色，含查看者）显示估算成本与毛利。

## Goals / Non-Goals

**Goals**：没有财务查看权的人从报价表助手的读、写接口与两个房间 JSON 接口都拿不到我方成本、落地价，也不能从情景表反推；有财务查看权的人在报价表助手看到与保存的一切照旧。

**Non-Goals**：
- `src/lib/muse-bridge/**`（Muse `price_scenario` 的落地价出口是决定 A）。
- `src/lib/tender-intel/orchestrate.ts`、`strategy.ts`、`src/app/api/projects/[id]/workbench-summary/route.ts`、`src/lib/tender-intel/generate-docs.ts`（投标策略备忘的模型输入与显示，另立 change）。
- `src/app/api/projects/[id]/inquiries/[inquiryId]/compare/**`（比价矩阵）、`src/app/api/projects/[id]/quote-engine/**`（报价引擎卡）。
- `src/lib/project-finance/access.ts`、`src/lib/tender-pricing/calc.ts`、`src/lib/tender-pricing/compare-cost-source*.ts`（判定规则、情景计算、建议与来源核对都不改）。
- 目标毛利、对手价、评分模型的可见与可改范围；`derive`。

## Decisions

### D1：判定沿用 `resolveFinancePrivilege(...).canReadAll`，出错只收「组织键」

与成本核算接口、寻源建议卡同一个函数、同样的参数（用户、项目组织、项目负责人）。`resolveFinancePrivilege` 抛错时，按「不持组织键」重算一次（`decideFinancePrivilege`：平台超级管理员与项目负责人仍有，其余人没有）——比寻源卡的「一律无权」少误伤负责人与超级管理员，对其余人同样失败即收。项目没有组织时同样按「不持组织键」判定。只在读取与 `save` 时判定，`derive` 不判定。

- 备选 A：新增权限键「报价表助手看成本」。否决：多一套口径；新增权限键要走岗位目录登记。
- 备选 B：按项目角色（能写项目的人可看）。否决：与成本核算、寻源卡不一致。
- 备选 C：出错时一律按无权（与 `loadLanded` 逐字相同）。否决：授权查询一时出错就让项目负责人看不到自己填的成本，没有必要；负责人与超级管理员的判定不依赖授权查询。

### D2：读取：裁剪而不是 403，裁剪写在纯函数里

`finance-view.ts` 的 `buildPricingHelperView({ model, inputs, canSeeCost, compareEnabled, compareCost })`：`canSeeCost` 为 true 时调用 `buildScenarios(model, inputs)` 并原样返回（与改动前同一个结果）；为 false 时用 `ourCostCad = null` 调用 `buildScenarios`，再把假设说明里「未填我方成本——毛利列为空；成本底价情景未生成」那句去掉、在末尾加「需要财务查看权才能看我方成本；毛利一栏与成本底价情景也不显示。」（有情景结果时才加；没有评分模型时没有结果，也就没有假设说明），返回 `inputs.ourCostCad = null`、`costHidden: true`，开关开着时 `compareCostHidden: true`、不带 `compareCost`。路由在 `canSeeCost` 为 false 时不调用 `loadCompareCostSuggestionSafe`（源码断言）。

- 备选 A：整个接口 403。否决：评分模型、对手价、打平价不是财务数据，投标的人照样要用。
- 备选 B：去掉 `inputs.ourCostCad` 这个键。否决：`inputs` 的形状由「保存的对外行为」固定为三项；`null` + `costHidden` 更清楚。
- 备选 C：情景表照旧带成本、只隐藏毛利一栏。否决：成本底价情景的价格可直接反推成本。
- 备选 D：在路由里算完再删字段。否决：要在路由里重复「按无成本重算」，单测覆盖不到；纯函数一处定义、GET 与 POST 共用。

### D3：保存：碰了成本就 403，不碰照常；判定顺序 409 → 403 → 400

「碰了成本」= 请求 `inputs`（按对象读，不是对象当作没有）里有 `ourCostCad` 这个键（不论值），或请求顶层有 `ourCostSource` 这个键（含 `null`）。没有财务查看权且碰了成本 → 403「需要财务查看权才能修改我方成本。」，不写库。判定在锁外、在「项目没有投标调查室 → 409」之后、在「目标毛利不小于 100 → 400」（锁内）之前。不碰时照常保存（`buildSave` 对请求里没有的键沿用原值，成本与来源原样保留——`compareEnabled` 照旧按开关算，保证已记来源不被当成「开关关了」清掉）；返回用 `buildSavedInputsView` 裁剪：`inputs.ourCostCad = null`、`costHidden: true`、不带 `ourCostSource`。

- 备选 A：静默忽略请求里的成本。否决：人以为存上了。
- 备选 B：允许「只写不读」。否决：能覆盖一个自己看不见的数，等于能清掉别人填的成本。

### D4：卡片

`costHidden` 时：「我方成本」输入框换成「需要财务查看权才能看我方成本。」（假设说明列表里那句同义长句不再重复显示）；保存请求不带 `ourCostCad`；情景表不显示毛利一栏。目标毛利的标签与成本加成提示（`MarkupHint`，只由目标毛利算出）照旧：开关开着（`compareCost` 或 `compareCostHidden`）时显示「毛利率（按售价）」与「相当于成本加成 x%」，关着时与现在相同。卡片的数据在 `useEffect` 里取，不能静态渲染测试，用源码断言（与 `compare-cost-source.test.tsx` 同样的接线断言方式）。

- 备选：输入框保留但禁用。否决：禁用的空框读起来像「还没填」。

### D5：房间 JSON 对所有人都去掉成本

`redactRoomSummaryCost(summaryJson)`：返回一份去掉 `pricingInputs.ourCostCad` 与 `pricingInputs.ourCostSource` 的副本（其余键原样，不改库）。`GET /api/projects` 对每个项目的 `intelligenceRoom.summaryJson`、`GET /api/projects/[id]/bid-intelligence` 对 `room.summaryJson` 调用它。对所有人都去掉：两处界面都不读这两个键，有财务查看权的人从报价表助手拿成本；项目列表若按项目逐个判定财务权，每页要多几十次授权查询。

- 备选：只对没有财务查看权的人去掉。否决：没有读者需要这两个键，逐个判定只是代价。

## 八条硬纪律

1. 零 schema：遵守（不改 `prisma/`；成本仍在 `BidIntelligenceRoom.summaryJson.pricingInputs`）。
2. 出站先审批：不涉及（不新增任何出站）。
3. 禁止第三套队列：不涉及。
4. 脱敏：本 change 就是收口——报价表助手对没有财务查看权的人不带出我方成本、落地价与能反推成本的情景；两个房间 JSON 接口对所有人不带出成本；见规格「没有财务查看权时不带出的内容」「调查室 JSON 不带出我方成本」的 SHALL NOT。口径不同、不在本次的页面（比价矩阵、报价引擎卡、投标策略备忘）在报告里列出。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守（零新增模型调用；`derive` 不变）。
8. 测试注册：两个新测试登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`scripts/check-test-registry.sh` 通过。

## 验证方式

- 纯函数与源码断言：`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`——有权限时与直接 `buildScenarios` 的结果 `JSON.stringify` 相同；无权限时 `ourCostCad` 为 null、`costHidden`、没有毛利、没有成本底价情景、假设说明换句（有对手价与没有对手价两种）、开关开时 `compareCostHidden`；「碰了成本」的判定（`inputs` 不是对象、`ourCostSource: null`）；房间 JSON 裁剪不改其它键；路由在无权时不取比价建议、卡片的四处接线（源码断言）。
- 隔离库：`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`——只读成员、项目编辑者（无财务键）、`org_admin`（无财务键）、`bids` 岗位 ASSIGNED 范围持 `project.finance.read` 的成员：都看不到；持组织范围 `project.finance.read` 的成员、项目负责人、平台超级管理员：都看得到且三者结果一致、带成本与 `compareCost`、没有 `costHidden`；开关开与关；编辑者带成本保存 403 且库不变、不带成本保存成功且成本与来源保留、返回里没有 `ourCostSource`；两次响应 JSON 里搜不到成本与落地价的数字；`GET /api/projects` 与 `GET …/bid-intelligence` 的 `summaryJson.pricingInputs` 没有 `ourCostCad`、`ourCostSource`，其它键还在。
- 既有：`pricing-helper.test.ts`、`pricing-helper-save-db.isolated.test.ts`、`pricing-helper-lock-db.isolated.test.ts`、`compare-cost-source-db.isolated.test.ts` 原样通过（它们用项目负责人读写）；`compare-cost-source.test.tsx` 的行为断言原样通过，接线断言里随接线改动的几条按 tasks 2.3 更新。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`。

## Risks / Trade-offs

- 做标的人看不到成本了：`bids` 岗位的 `project.finance.read` 只在 ASSIGNED 范围，不算财务查看权；不是项目负责人的投标同事要看、要改成本，需要组织给他组织范围的 `project.finance.read` 或 `manage`（这会让他看到全组织的财务数据）。这与成本核算接口、寻源卡一致，但对现有用法是收紧，PR 里写明请 GATE 确认。
- 口径不同的页面仍对项目读者显示成本或落地价（比价矩阵、报价引擎卡、投标策略备忘）——本 change 不改，报告列出，要不要统一另议。
- 多一次授权查询：每次读取与保存多 2 次 `authorize`（与成本核算接口相同代价）。
