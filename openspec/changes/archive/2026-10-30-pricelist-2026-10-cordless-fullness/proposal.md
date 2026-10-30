# Proposal

## Why

2026-10-28 价表（任务书 `docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md` §2 D3–D6）把无绳改成独立折扣 30%、最低价 Zebra 159 / Roller 129、不再限 75"，并给布帘 / 纱帘加了褶皱率查表；青砚还在用"产品折扣 + 100 最低价 + 75" 上限"，而且 Order Form 把 Lift L/R 当无绳计价、工艺单却按有绳生产（Q4，Lucas 2026-10-30 选 A：无绳改为显式开关）。

TASKFLOW：PRICE-2（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase P）。

## What Changes

- **BREAKING** Order Form Shades 表每行新增"Cordless"开关（只对 Zebra / Roller 可用，默认关）；无绳计价只看这个开关，Lift L/R 只表示拉杆位置。已保存报价的表单数据没有该字段时按关处理：重算时原来按 L/R 判成无绳的行不再 ×1.15。
- 无绳定价改为：折扣取无绳折扣（默认 30%）而非产品折扣，行级覆盖仍优先；折后与最低价比较时用无绳最低价（Zebra 159 / Roller 129）；最后 ×1.15；取消 75" × 75" 上限，只受矩阵范围约束。
- 无绳折扣与最低价可按企业覆盖，存 `Organization.settingsJson.pricing.cordless`（零 schema），走既有折扣设置接口与 `sales.update_quote_settings` 审批；驾驶舱折扣卡多三格。
- 服务端套企业折扣时跳过无绳行，无绳折扣由引擎按企业无绳设置套用；客户端预览开始把无绳传给引擎（此前预览从不按无绳计价，与服务端不一致）。
- 布帘 / 纱帘查表宽 = 实际窗宽 × 褶皱率 ÷ 2（Door Screen Sheer 除外）；褶皱率只接受 1 到 4，非法整行报错；安装费与面积仍按实际窗宽；超范围报错写明"此褶皱率下最大窗宽"。Order Form / Part A 的 Fullness 180 / 230 作为 1.8 / 2.3 传给定价（与工艺单同一来源）；量房、AI 解析、Muse 等不带褶皱率的入口按 2。**BREAKING**：Order Form 默认 Standard 180% 的布帘 / 纱帘行查表宽变为实际宽 × 0.9。
- 无绳行生成工艺单时操控方式为"无绳"（Blinds 工艺引擎已有无绳减尺表），拉杆位置仍取 Lift。
- 修复量房「生成报价」在写库时必然 500 的既有问题（报价行同时挂报价与房间），使量房入口能实际生成报价（apply 中发现，Lucas 2026-10-30 同意并入）。
- 黄金对照测试把 `cordless-*` / `fullness-*` / `door-screen-no-fullness` 110 条从 `DEFERRED` 转入 `MUST_MATCH`，`DEFERRED` 清空。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `sales/price-list`：新增无绳定价规则、无绳企业设置落点、无绳开关来源、褶皱率查表与校验、褶皱率来源五条要求；修改「黄金用例对照」要求（全部标签进"本次必须一致"组）。
- `sales/quote-settings-approval`：新增要求——企业设置 JSON 中的无绳折扣 / 最低价同样经 PUT 折扣接口提交、进入审批、批准后才生效。
- `sunny/process-order-autogen`：修改「报价到工艺字段的映射」——Cordless 开 → 操控方式无绳（仅 Zebra / Roller），Lift L/R 仍为拉杆位置。

## Impact

- 定价：`src/lib/blinds/{pricing-types,pricing-data,pricing-engine,discount-settings}.ts`
- 报价入口：`src/app/api/sales/quotes/route.ts`、`src/lib/sales/quote-update.ts`、`src/app/api/sales/quotes/preview/route.ts`、`src/app/api/sales/measurements/[id]/generate-quote/route.ts`
- 折扣设置：`src/app/api/sales/quote-settings/discounts/route.ts`、`src/lib/sales/quote-settings-approval.ts`、`src/app/(main)/sales/cockpit/discount-settings-card.tsx`
- 报价单 UI：`src/app/(main)/sales/quote-sheet/{types,order-shades,order-drapes,part-a,pricing-helpers,page,rough-quote-panel}.tsx`
- 工艺单：`src/lib/sunny-process/quote-mapping.ts`
- 测试：`pricelist-2026-10-golden`（分组变更）、`cost-rates`、`quote-settings-approval`、`quote-settings-db.isolated`、`quote-mapping`、`sunny-motor`
- 不触碰 muse-bridge：无受影响 Muse 意图

## Out of scope

- 附加项目目录、Downtown 服务费（PRICE-3）；按人报价清单（STAT-1）。
- 企业级默认褶皱率设置（Order Form 行上已有 180 / 230，其它入口固定 2，不再加设置项）。
- Door Screen Sheer 的企业折扣套用方式（沿用现状）。
- 已落库报价行的金额回填；"快速报价"内嵌旧 HTML 工具。
- 黄金用例文件本身不改。
