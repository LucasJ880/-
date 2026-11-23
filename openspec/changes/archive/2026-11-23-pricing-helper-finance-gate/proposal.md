# Proposal：报价表助手的我方成本只给有财务查看权的人（CHAIN-2b）

TASKFLOW：CHAIN-2b（新增一行；Phase F（续）— 情报串联的后续；CHAIN-2 第一轮多维审查发现、交接文档第四十四次 §0.5h「之后还有什么」第 4 条）。Lucas 2026-11-20 原话：「报价助手里的落地成本与节省成本，改成只对有财务查看权的人显示，口径与其它页面一致。」本 change 把「节省成本」读作「已保存的我方成本」（交接文档的说法；代码里没有「节省」这个字段）；若指毛利，毛利一栏同样只给有财务查看权的人，两种读法都覆盖。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

报价表助手只要求项目读权限，就把已保存的我方成本、比价矩阵算出的落地价（含明细与已记来源里的落地价）返回给任何项目成员；项目列表与调查室读取接口还把同一份数字放在原样返回的房间 JSON 里——而成本核算接口与 CHAIN-2 寻源建议卡对同类数字只给有财务查看权的人。

## What Changes

- 判定财务查看权：报价表助手的读取与保存用与成本核算、寻源建议卡相同的判定（平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read`、项目负责人）。
- 裁剪读取结果：没有财务查看权的人拿到的 `inputs.ourCostCad` 为 `null`、带 `costHidden: true`；不返回比价矩阵的成本建议（开关开着时只带 `compareCostHidden: true`，不带任何数字，也不去取数）；情景表按没有成本计算（毛利为空、没有成本底价情景）；假设说明里不再有「未填我方成本」那句，改写「需要财务查看权才能看我方成本；毛利一栏和「成本 + 目标毛利」「成本价」两种情景也不显示。」。
- 拒绝越权保存：没有财务查看权的人保存时带了我方成本或成本来源 → 403「没有保存：需要财务查看权才能修改我方成本。请刷新页面，重新填写后再保存。」，不写库；不带时照常保存对手价、目标毛利与评分模型，已保存的成本与来源原样保留，返回同样裁剪、不带成本来源。
- 改卡片：`costHidden` 时「我方成本」输入框换成「需要财务查看权才能看我方成本。」，保存不带我方成本，情景表不显示毛利一栏；情景表上方写明少了什么、谁能看、找谁；目标毛利下面说明它在这里不影响情景表；目标毛利的标签与成本加成提示照旧（开关开着时按 `compareCostHidden` 显示）；保存被拒时红字写明、保留刚填的值。
- 去掉房间 JSON 里的成本：项目列表（`GET /api/projects`）与调查室读取（`GET /api/projects/{项目}/bid-intelligence`）返回的 `summaryJson` 对所有人都不再带 `pricingInputs.ourCostCad`、`pricingInputs.ourCostSource` 与投标策略备忘 `bidStrategyMemo`（备忘由含成本与毛利的情景写成；这两个接口的界面都不读这三样）。
- 有财务查看权的人在报价表助手看到与保存的一切不变；`derive`（重新推导评分模型）不变，不做财务判定。

## Out of scope

- 不改比价矩阵（`…/inquiries/{询价}/compare/matrix`、`…/compare/analysis`）：它们对项目读者显示每家的落地价，口径不同（是否收口另议，报告里列出）。
- 不改报价引擎卡（`quote-engine`）：它按 `canViewInternal`（任何带 `project:cost:read` 的项目角色）显示估算成本与毛利，口径不同（报告里列出）。
- 不改 Muse `price_scenario`（决定 A：落地价可以出 Muse；本 change 不触碰 muse-bridge）。
- 不改投标策略备忘的生成与显示：`src/lib/tender-intel/orchestrate.ts` 把含我方成本、成本底价情景与毛利的 `pricingAnalysis` 交给 `strategy.ts` 写进模型输入（提示词要求逐字引用情景的价格与毛利），备忘经 `workbench-summary`、`generate-docs.ts`、`external-intel/award-history`（情报页签的卡上显示定价策略）与投标文件草稿（`tender-bid-draft/gather.ts`）给项目读者，可能转述成本或毛利。根本修法是送进模型前去掉成本相关的部分，另立 change（GATE 问题，报告列出）。
- 不改目标毛利、对手价、评分模型的可见与可改范围；不新增权限键；不改 `src/lib/project-finance/access.ts` 的判定规则。
- 不改项目负责人的变更：能编辑项目的人可以把项目负责人改成自己（`PATCH /api/projects/{项目}` 的 `ownerId`），从而按负责人拿到财务查看权——这对成本核算接口、寻源卡同样成立，另立 change（GATE 问题，报告列出）。
- 同一个工作台页面上「报价与成本」卡（报价引擎）仍对几乎所有项目角色显示估算成本与毛利率；与本 change 的口径冲突照实写给 GATE，本次不改。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/pricing-helper`：新增「我方成本只给有财务查看权的人」「没有财务查看权的人改不了成本」「卡片上没有财务查看权时的显示」「没有财务查看权时不带出的内容」「调查室 JSON 不带出我方成本」；修改「保存只改人工输入」「保存的对外行为」。
- `tender/pricing-compare-cost-source`：修改「来自比价矩阵的成本建议」「只建议，人保存才生效」「来源由服务端核对后才记」「矩阵变了只提示」「毛利率与成本加成写清楚」（都限定为有财务查看权的人；没有的人按 `tender/pricing-helper` 的规定）。

## Impact

- 新增：`src/lib/tender-pricing/finance-view.ts`（纯函数：读取视图、保存返回、房间 JSON 的裁剪，「这次保存是否碰了成本」）。
- 修改：`src/app/api/projects/[id]/pricing-helper/route.ts`、`src/components/tender/pricing-helper-card.tsx`、`src/app/api/projects/route.ts`、`src/app/api/projects/[id]/bid-intelligence/route.ts`。
- 测试：新增 `src/lib/tender-pricing/__tests__/finance-view.test.ts` 与 `pricing-helper-finance-db.isolated.test.ts`（注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）；`compare-cost-source.test.tsx` 里几条接线断言随接线改动更新（tasks 列出）。
- 零 schema、零依赖、零新增模型调用。
