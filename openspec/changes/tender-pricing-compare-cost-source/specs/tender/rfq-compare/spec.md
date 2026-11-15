## ADDED Requirements

### Requirement: 落地价写明含什么、不含什么
落地价换算 SHALL 在返回里带逐项金额（货值、内陆、海运、保险、关税、清关；按贸易条款不加的项为空；DDP 写明已含在报价里）。比价矩阵结论 SHALL 写「到目的地，含关税，不含 GST/HST」，SHALL NOT 写「含税」。落地价 SHALL NOT 计入 GST/HST。落地总价、排序、推荐与最低价 SHALL 与改动前相同。

#### Scenario: FOB 报价
- **WHEN** 一家 FOB 报价，海运、保险、关税、清关参数齐全
- **THEN** 逐项金额加起来等于落地总价；总价与改动前相同（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`；`npx tsx src/lib/tender-rfq/__tests__/landed-cost.test.ts`）

#### Scenario: 结论措辞
- **WHEN** 生成比价矩阵结论
- **THEN** 结论里有「含关税，不含 GST/HST」，没有「含税」（`compare-cost-source.test.tsx`）
