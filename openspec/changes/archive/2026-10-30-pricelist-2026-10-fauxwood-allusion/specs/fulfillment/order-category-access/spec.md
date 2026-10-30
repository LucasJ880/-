# Spec Delta

## MODIFIED Requirements

### Requirement: 品类判定
系统 SHALL 把工艺单每一行按产品类型映射到品类 `vinyl` / `drapery` / `shades`：`卷帘`、`斑马帘`、`香格里拉` → `shades`；报价产品 `Drapery`、`Sheer` → `drapery`，`Shutters` → `vinyl`，`Zebra`、`Roller`、`SHANGRILA`、`Cordless Cellular`、`SkylightHoneycomb`、`Roman Shade`、`Roman`、`Allusion`、`Fauxwood` → `shades`。未知产品类型 SHALL 判为无品类。签字自动生成的工艺单参数行（`sunny/process-order-autogen`）SHALL 同样计入：国内下单表行 → `shades`，窗帘行 → `drapery`，Vinyl 行 → `vinyl`，外采购行按段（百叶 → `vinyl`，窗帘 → `drapery`，帘子 → `shades`）。一张单的品类集合 SHALL 是工艺单行与参数行品类去重后的集合。

#### Scenario: 工艺单全为斑马帘
- **WHEN** 工艺单 4 行产品类型均为 `斑马帘`
- **THEN** 品类集合为 `{shades}`

#### Scenario: 未知产品类型
- **WHEN** 某行产品类型为 `百叶窗X`
- **THEN** 该行无品类，不计入集合

#### Scenario: 自动生成单含参数行
- **WHEN** 自动生成的工艺单有 1 个斑马帘行，参数里有 1 个 Vinyl 窗与 1 个窗帘行
- **THEN** 品类集合为 `{vinyl, drapery, shades}`；只持 `fulfillment_shades` 的人修改返回 403，`missingCategories` 为 `["vinyl","drapery"]`

#### Scenario: 全部发给国内后
- **WHEN** 自产行全部发给国内（工艺单行为空，国内下单表有行）
- **THEN** 品类集合仍含 `shades`，不退化为空集合

#### Scenario: Fauxwood 报价行
- **WHEN** 报价行产品为 `Fauxwood`
- **THEN** 品类为 `shades`；`npx tsx src/lib/fulfillment/__tests__/category.test.ts` 覆盖
