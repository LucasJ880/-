# Proposal：报价表助手的比价落地价只给有财务查看权的人

TASKFLOW：FIX-12（Phase F 续，接 FLOW-H2 #476；本 change 新登记一行）
来源：审查发现——`GET …/pricing-helper` 在开关 `TENDER_PRICING_COMPARE_SOURCE_ENABLED` 开启时，把比价矩阵里选定那一家的落地价（`compareCost.suggestion.landedCadTotal` 与逐项金额）返回给任何有项目读权限的人；项目里别处把我方成本当财务数据，由财务查看权（`resolveFinancePrivilege(...).canReadAll`）把关，例如 TI-4a 成本核算表（`…/bid-workspace/cost-sheet`）没有这个权限就 403。

## Why

报价表助手这一项是 FLOW-H2 新加的成本数据出口，却只看项目读权限，没有财务查看权的项目成员（如投标岗 `bids`、普通成员）也能拿到落地价、逐项运费关税与换算依据。它要与成本核算表用同一条财务查看权口径。

## What Changes

- 判定财务查看权：开关开启时，读取与保存都按当前登录者、服务端鉴权得到的项目组织与项目负责人求一次财务查看权（平台超级管理员 / 持企业级 `project.finance.manage` 或 `project.finance.read` / 项目负责人）；开关关闭时不求，行为与现在完全相同。
- 读取（GET）对没有财务查看权的人不再取比价建议：`compareCost.suggestion` 换成不带任何金额的一项「落地价只对有财务查看权的人显示」，`compareCost.source` 为 `null`，`compareCost.staleNoteZh` 为 `null`；`runId`、`model`、`modelOrigin`、`benchmark`、`inputs`、`result`、`note` 不变。
- 保存（POST save）对没有财务查看权的人不采信请求里的来源声明、不取比价建议，响应里不带 `ourCostSource`；成本照常保存，来源按原规则记手填或保留原来的来源。
- 卡片对这一项显示一句说明、不显示金额与填入按钮；「毛利率（按售价）」与成本加成提示照旧显示。
- 有财务查看权的人：读取与保存的请求、返回、存库内容与现在逐字段相同。
- 新增隔离库测试：同一项目里项目负责人、持 `accounting` 岗位的只读成员、持 `bids` 岗位的只读成员、持 `bids` 岗位的项目管理员（有写权限）分别读取与保存；在改动前的代码上「没有财务查看权的人拿不到金额」几项失败。
- 调整 `compare-cost-source.test.tsx` 里对这个路由的源码断言，并补纯函数与卡片呈现的断言。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/` 下任何文件；`price_scenario` / `compare` 按决定 A 输出所选供应商落地价的口径不变。

## Out of scope

- 已保存的「我方成本」（`inputs.ourCostCad`）与情景表（`result`）：它们是报价表助手原有的人工输入与计算，对所有项目读者可见，本次不改。已保存的成本若是从比价矩阵填进来的，数字本身仍等于当时的落地价——要把它也收进财务查看权，需要另立 change（会让没有权限的人看不到情景表）。
- 询价区的比价矩阵（`GET …/inquiries/[inquiryId]/compare/matrix`、`…/compare/analysis`）：按项目读权限返回每一家报价的落地价，本次不改。
- Muse 通道的 `compare` / `price_scenario`：按决定 A（#237）允许输出所选供应商落地价，本次不改。
- CHAIN-2 的价格对照卡（`tender-auto-supplier-run`，尚未实施）：它的「没有财务查看权看不到我方落地价一栏」由它自己的 change 落实。
- 财务查看权的判定本身（`src/lib/project-finance/access.ts`）：复用，不改；不为非项目成员开读取入口（报价表助手仍先过项目读权限）。
- schema 变更、新开关、模型调用、对外动作、队列：没有。本修复跟随既有开关 `TENDER_PRICING_COMPARE_SOURCE_ENABLED`（默认关，生产未启用），不另加开关。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/pricing-compare-cost-source`：「来自比价矩阵的成本建议」「来源由服务端核对后才记」「矩阵变了只提示」三条加上财务查看权的条件；新增一条「没有财务查看权的人拿不到落地价」（SHALL NOT 写明不输出什么）。
- `tender/pricing-helper`：已核对，不改。它规定的保存只改三项人工输入、`inputs` 只含三项、校验与权限、写入与报价同步串行，本次都不变；`compareCost` 与 `ourCostSource` 由 `tender/pricing-compare-cost-source` 规定。

## Impact

- 修改：`src/app/api/projects/[id]/pricing-helper/route.ts`（GET 与 POST save 各求一次财务查看权）；`src/lib/tender-pricing/compare-cost-source.ts`（建议多一个无金额的状态与说明文字、过时提示对它不出）；`src/components/tender/pricing-compare-source.tsx`（这一状态只显示说明）。
- 复用：`src/lib/project-finance/access.ts` 的 `resolveFinancePrivilege`（不改）。
- 测试：新增 `src/lib/tender-pricing/__tests__/compare-cost-finance-gate-db.isolated.test.ts`（注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；修改 `src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`。
- 文档：`docs/QINGYAN_FIX-12_REPORT.md`；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 加 FIX-12 一行。
- 对外接口：开关开启时，没有财务查看权的人读取得到的 `compareCost` 形状变化（见上）、保存响应少了 `ourCostSource`；有财务查看权的人与开关关闭时不变。
