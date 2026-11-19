## ADDED Requirements

### Requirement: 情报推荐并入收件人
`TENDER_RFQ_INTEL_RECIPIENTS_ENABLED` 为真（`1`、`true`、`on`、`yes`，不分大小写）且组织在 `TENDER_RFQ_INTEL_RECIPIENTS_ORG_ALLOWLIST`（留空 = 所有组织）里、该组织的供应商情报开着、操作者的名单里至少有一家在用且有邮箱时，系统 SHALL 在名单之后并入本项目推荐排名里首选 / 备选、强制项通过、在用且有邮箱的供应商（按名次；已在名单里的不重复；就绪规则与建轮次时相同），合计仍最多 8 家。名单里没有能发的（含有分组但确定不了用哪一组）时 SHALL NOT 只凭推荐起草。审批卡摘要与结果说明 SHALL 写明 `另外补了 N 家供应商情报推荐的：{名称}`；结果的字段 SHALL NOT 变。开关关闭时与本功能之前相同。

#### Scenario: 并入情报推荐
- **WHEN** 情报推荐开关打开；操作者常用供应商 2 家（甲、乙）；本项目推荐排名里首选为乙、备选为丙（都通过强制项、在用、有邮箱），另一个强制项没通过的丁
- **THEN** 起草的卡收件人依次是甲、乙、丙，不含丁；摘要写明「另外补了 1 家供应商情报推荐的：丙」，结果说明写明「3 家供应商——2 家常用供应商，另外补了 1 家供应商情报推荐的：丙」（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/sourcing-suggestions-db.isolated.test.ts`；合并规则与文案 `npx tsx src/lib/tender-rfq/__tests__/intel-recipients.test.ts`）

#### Scenario: 情报推荐开关关闭
- **WHEN** 同样的数据，情报推荐开关关闭
- **THEN** 起草的卡收件人只有甲、乙，摘要与结果说明与本功能之前相同（同一测试）

#### Scenario: 名单为空时不只凭推荐起草
- **WHEN** 情报推荐开关打开，操作者没有常用供应商，本项目推荐排名里有一家可并入的
- **THEN** 不起草，原因为没有就绪的常用供应商（同一测试）

## MODIFIED Requirements

### Requirement: 供应商只取操作者保存的常用供应商
自动起草的收件供应商 SHALL 只来自触发动作的操作者本人保存的名单：他没有生效的供应商分组时是他的常用供应商；有分组时是按项目名称恰好对上的那一组，SHALL NOT 混入常用供应商或别的组。两种情况都按他保存的顺序取在用且有联系邮箱的，最多 8 家；审批卡上收件人的顺序 SHALL 与保存的顺序一致。除「情报推荐并入收件人」一条所述的情形外，系统 SHALL NOT 按供应商自身的品类字段、标签、评分、历史报价或任何模型输出增补或替换供应商。名单里不在用或没有邮箱的 SHALL 被跳过，并在结果里列出被跳过的家数。贸易条款 SHALL 取操作者保存的默认贸易条款（没有则留空），其余栏目（目的地、补充说明、追加问题）SHALL 留空。

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

### Requirement: 自动起草留审计
每次自动起草成功，系统 SHALL 写一条审计，记下：触发的动作、操作者、轮次、审批卡、选中的供应商、被跳过的供应商及原因、供应商来源（「操作者的常用供应商」或「操作者的供应商分组」）、没有带上的未确认要求数；来源是分组时 SHALL 另记分组的名字、对上的关键词与当时那一版分组的标识；并入了供应商情报推荐时 SHALL 另记并入的那几家供应商的标识（没有并入时不记这一项）。

#### Scenario: 审计内容
- **WHEN** 自动起草成功
- **THEN** 有一条审计，操作者是触发动作的人，内容含审批卡与供应商清单（`auto-draft-db.isolated.test.ts`）

#### Scenario: 按分组起草的审计
- **WHEN** 按分组「窗饰」自动起草成功
- **THEN** 审计里的供应商来源是「操作者的供应商分组」，并有分组名「窗饰」与对上的关键词（`supplier-groups-db.isolated.test.ts`）

#### Scenario: 并入情报推荐的审计
- **WHEN** 情报推荐开关打开，自动起草并入了 1 家情报推荐的供应商
- **THEN** 审计里另记了这 1 家的标识（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/sourcing-suggestions-db.isolated.test.ts`）
