## MODIFIED Requirements

### Requirement: 供应商只取操作者保存的常用供应商
自动起草的收件供应商 SHALL 只来自触发动作的操作者本人保存的名单：他没有生效的供应商分组时是他的常用供应商；有分组时是按项目名称恰好对上的那一组，SHALL NOT 混入常用供应商或别的组。两种情况都按他保存的顺序取在用且有联系邮箱的，最多 8 家；审批卡上收件人的顺序 SHALL 与保存的顺序一致。系统 SHALL NOT 按供应商自身的品类字段、标签、评分、历史报价或任何模型输出增补或替换供应商。名单里不在用或没有邮箱的 SHALL 被跳过，并在结果里列出被跳过的家数。贸易条款 SHALL 取操作者保存的默认贸易条款（没有则留空），其余栏目（目的地、补充说明、追加问题）SHALL 留空。例外（CHAIN-2）：`TENDER_RFQ_INTEL_RECIPIENTS_ENABLED` 对该组织打开且供应商情报开着时，系统 SHALL 在上述名单之后并入本项目推荐排名里主选 / 备选、强制闸通过、在用且有邮箱的供应商（按名次，已在名单里的不重复），合计仍最多 8 家；名单为空或分组里没有就绪的供应商时，只用这些推荐也可以起草；有分组但按项目名称确定不了用哪一组时仍不起草。审批卡摘要与结果说明 SHALL 写明其中几家、是哪几家来自供应商情报推荐。

#### Scenario: 跳过未就绪的常用供应商
- **WHEN** 操作者的常用供应商有 4 家，其中 1 家已停用
- **THEN** 起草的卡收件人是另外 3 家，结果里写明跳过 1 家（`auto-draft-db.isolated.test.ts`）

#### Scenario: 别人的常用供应商不被使用
- **WHEN** 操作者没有常用供应商，同组织的另一位成员有
- **THEN** 不起草，原因为没有就绪的常用供应商（`auto-draft-db.isolated.test.ts`）

#### Scenario: 按分组起草
- **WHEN** 操作者有分组「窗饰」（关键词 `blind`，供应商甲、乙）与分组「家具」（关键词 `furniture`，供应商丙），常用供应商是丙、丁；他批准了一个名为 `Window Blinds Replacement` 的项目的招标分析
- **THEN** 起草的卡收件人是甲、乙，顺序与组内一致，不含丙、丁（`supplier-groups-db.isolated.test.ts`）

#### Scenario: 别人的分组不被使用
- **WHEN** 操作者没有分组、有 2 家就绪的常用供应商；同组织另一位成员有一个对得上这个项目的分组
- **THEN** 起草的卡收件人是操作者自己的 2 家常用供应商（`supplier-groups-db.isolated.test.ts`）

#### Scenario: 并入情报推荐
- **WHEN** 情报推荐开关打开；操作者常用供应商 2 家（甲、乙）；本项目推荐排名里主选为乙、备选为丙（都通过强制闸、在用、有邮箱），另一个强制闸未通过的丁
- **THEN** 起草的卡收件人依次是甲、乙、丙，不含丁；摘要写明「其中 1 家来自供应商情报推荐：丙」（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/sourcing-suggestions-db.isolated.test.ts`；合并规则 `npx tsx src/lib/tender-rfq/__tests__/intel-recipients.test.ts`）

#### Scenario: 情报推荐开关关闭
- **WHEN** 同样的数据，情报推荐开关关闭
- **THEN** 起草的卡收件人只有甲、乙（同一测试）
