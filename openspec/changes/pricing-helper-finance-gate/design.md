# Design：报价表助手的我方成本只给有财务查看权的人

## Context

- `GET /api/projects/[id]/pricing-helper` 只做 `requireProjectReadAccess`，返回 `inputs.ourCostCad`（已保存的我方成本）、按它算的情景表（毛利一栏、「成本 + 目标毛利」或「成本价」情景——由价格与目标毛利可直接反推成本），开关 `TENDER_PRICING_COMPARE_SOURCE_ENABLED` 开着时还返回 `compareCost`（比价矩阵选定那一家的落地价与逐项金额、已记来源里的落地价）。
- `POST`（`requireProjectWriteAccess`）保存三项人工输入，返回里也带 `inputs.ourCostCad`。
- 同一份数字在别处的口径：成本核算接口 `bid-workspace/cost-sheet` 没有 `resolveFinancePrivilege(...).canReadAll` 就 403；CHAIN-2 寻源建议卡没有就不带落地价一栏。`canReadAll` = 平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read`、项目负责人（`src/lib/project-finance/access.ts`，PERM-4c1 起不再认 org_admin）。

## Goals / Non-Goals

**Goals**：没有财务查看权的人从报价表助手的读、写接口都拿不到我方成本、落地价，也不能从情景表反推；有财务查看权的人一切照旧。

**Non-Goals**：
- `src/lib/muse-bridge/**`（Muse `price_scenario` 的落地价出口是决定 A，不在本次）。
- `src/lib/tender-intel/orchestrate.ts`、`src/lib/tender-intel/strategy.ts`（投标策略备忘的模型输入里有成本与毛利，另立 change）。
- `src/lib/project-finance/access.ts`（判定规则不改）；`src/lib/tender-pricing/calc.ts`（情景计算不改）；`src/lib/tender-pricing/compare-cost-source*.ts`（建议与来源核对不改）。
- 目标毛利、对手价、评分模型的可见与可改范围。

## Decisions

### D1：判定沿用 `resolveFinancePrivilege(...).canReadAll`

与成本核算接口、寻源建议卡同一个函数、同一个参数（用户、项目组织、项目负责人）。项目没有组织时按「不持组织键」判定（只剩平台超级管理员与项目负责人）。判定抛错时按没有财务查看权处理（与寻源建议卡 `loadLanded` 相同，失败即收）。

- 备选 A：新增权限键「报价表助手看成本」。否决：多一套口径，用户要的就是「与其它页面一致」；新增权限键要走岗位目录登记。
- 备选 B：按项目角色（能写项目的人可看）。否决：与成本核算、寻源卡不一致，项目编辑者不一定有财务权。

### D2：读取：裁剪而不是 403

没有财务查看权时接口照常返回评分模型、对手价、打平价与情景表，只是：`inputs.ourCostCad` 为 `null`、加 `costHidden: true`；不返回 `compareCost`（开关开着也不返回，也不去取数）；情景表按 `ourCostCad = null` 计算（毛利为空、不生成成本底价情景）；假设说明里「未填我方成本——毛利列为空；成本底价情景未生成」那一句换成「需要财务查看权才能看我方成本；毛利一栏与成本底价情景也不显示。」（不论成本填没填，同一句话，不泄露「填没填」）。

- 备选 A：整个接口 403。否决：评分模型、对手价、打平价不是财务数据，投标的人照样要用。
- 备选 B：去掉 `inputs.ourCostCad` 这个键。否决：`inputs` 的形状由「保存的对外行为」固定为三项，前端类型也是三项；用 `null` + `costHidden` 更清楚。
- 备选 C：情景表照旧带成本、只隐藏毛利一栏。否决：「成本 + 目标毛利」情景的价格 ÷ (1 − 毛利) 就是成本，「成本价」情景的价格就是成本。

### D3：保存：带成本就 403，不带照常

没有财务查看权的人，请求 `inputs` 里有 `ourCostCad` 这个键（不论值），或带了 `ourCostSource` → 403「需要财务查看权才能修改我方成本。」，不写库。不带这两样时照常保存对手价、目标毛利与评分模型（已保存的成本与来源原样保留——`buildSave` 本来就是「请求里没有这个键就保留原值」）。返回同样裁剪：`inputs.ourCostCad` 为 `null`、`costHidden: true`，不带 `ourCostSource`。判定在锁外做（不在事务里调授权）。

- 备选 A：静默忽略请求里的成本。否决：人以为存上了。
- 备选 B：允许「只写不读」。否决：能覆盖一个自己看不见的数，等于能清掉别人填的成本。

### D4：卡片

`costHidden` 时：「我方成本」输入框换成同一句说明（`aria` 不需要额外处理，是普通文字）；保存请求不带 `ourCostCad`；「用这个作为我方成本」的块本来就因为没有 `compareCost` 不出现；情景表不显示毛利一栏；成本加成提示（`MarkupHint`）不显示。

- 备选：输入框保留但禁用。否决：禁用的空框读起来像「还没填」。

### D5：裁剪写成纯函数

新增 `src/lib/tender-pricing/finance-view.ts`：输入 GET 的视图（或保存的返回）与 `canReadAll`，输出裁剪后的视图；另一个纯函数判定「这次保存是否碰了成本」。路由只负责取判定结果并调用；纯函数单测覆盖裁剪的每一项。

- 备选：直接在路由里写 if。否决：路由的 GET 与 POST 两处都要裁，写成纯函数一处定义两处用，测试不必起库。

## 八条硬纪律

1. 零 schema：遵守（不改 `prisma/`；成本仍在 `BidIntelligenceRoom.summaryJson.pricingInputs`）。
2. 出站先审批：不涉及（不新增任何出站）。
3. 禁止第三套队列：不涉及。
4. 脱敏：本 change 就是收口——没有财务查看权的人拿不到我方成本、落地价，也拿不到能反推成本的情景；见规格「我方成本只给有财务查看权的人」的 SHALL NOT。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守（零新增模型调用；`derive` 路径不变）。
8. 测试注册：新测试登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`scripts/check-test-registry.sh` 通过。

## 验证方式

- 纯函数：`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`（裁剪每一项；有权限时原样返回、逐字节相同；保存是否碰成本的判定）。
- 隔离库：`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`——只读成员 / 项目编辑者（无财务键）/ 持 `project.finance.read` 的成员 / 项目负责人 / 平台超级管理员各读一次；开关开与关；编辑者带成本保存 403 且库不变，不带成本保存成功且成本保留。
- 既有不改期望：`pricing-helper.test.ts`、`pricing-helper-save-db.isolated.test.ts`、`pricing-helper-lock-db.isolated.test.ts`、`compare-cost-source.test.tsx`、`compare-cost-source-db.isolated.test.ts` 原样通过（它们用项目负责人读写）。
- 卡片：`compare-cost-source.test.tsx` 同类的渲染断言（`costHidden` 时没有成本输入框、没有毛利一栏、有那句说明）。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`。

## Risks / Trade-offs

- 投标策略备忘仍可能转述成本与毛利（Non-Goals，另立 change）。
- 多一次授权查询：每次读取与保存各多 2 次 `authorize`（与成本核算接口相同代价）。
- 项目负责人以外的编辑者存不了成本：这是本次要的行为；他们要先拿到 `project.finance.read` 或 `manage`。
