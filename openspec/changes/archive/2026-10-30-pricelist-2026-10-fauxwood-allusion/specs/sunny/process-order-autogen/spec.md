# Spec Delta

## ADDED Requirements

### Requirement: Fauxwood 行进外采购行
签字自动生成工艺单时，报价 Shades 表中产品为 `Fauxwood` 的行 SHALL 不做工艺计算，按销售填写原值生成外采购行，品类文字为"仿木百叶 Fauxwood"，SHALL NOT 产生阻断项；导出的「外采购单」工作表 SHALL 含该行。

#### Scenario: 一行仿木百叶
- **WHEN** 已签报价含一行 Fauxwood 36" × 48"、Mount I、Lift L
- **THEN** 工艺单外采购行一条，品类"仿木百叶 Fauxwood"，宽高原样，待核对为提示级；`npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts` 覆盖
