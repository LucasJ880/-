# Spec Delta

## ADDED Requirements

### Requirement: 缺中文译文的提醒
询价单里有要求没有中文译文时，询价入口状态的不阻断提醒里 SHALL 多一句「有 {N} 条要求还没有中文译文，询价单里会按原文印出并注明。可以先到「招标要求」的投标合规矩阵点「翻译成中文」再发。」，{N} 为这样的要求条数。这一句 SHALL NOT 改变入口可发与否，SHALL NOT 阻止送审；N 为 0 时 SHALL NOT 出现。

#### Scenario: 两条要求没有译文
- **WHEN** 已确认的供应商侧要求里有 2 条的中文一栏不是中文，其它条件都可发，读询价入口状态
- **THEN** 入口可发，提醒里有「有 2 条要求还没有中文译文」那一句；全部有译文时没有这一句（`npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts`）
