## MODIFIED Requirements

### Requirement: 价格只有一个出处
已报价的行 SHALL 显示原币种单价 / 总价、交期、有效期，以及比价矩阵给出的落地价（CAD）与「最便宜」标记；矩阵换算不出时 SHALL 写原因。落地价 SHALL 只给对该行所在项目有财务查看权的人（与比价矩阵同一口径）；其余人的那一格 SHALL 写「落地价只给有财务查看权的人看」，换算不出的原因与「最便宜」照常。追踪 SHALL NOT 自己换汇或算落地价。一次最多为 50 轮取比价矩阵，其余写明请到比价面板查看。返回 SHALL NOT 含项目估值、我方报价、中标价、毛利、价格情景。

#### Scenario: 与比价面板一致
- **WHEN** 同一轮两家报价进表，一家缺运费参数
- **THEN** 追踪页的落地价与「最便宜」与该轮比价矩阵逐家相同；缺参数的那家写「落地价未换算（…）」（`tracker-pure.test.tsx`；`tracker-db.isolated.test.ts`）

#### Scenario: 白名单
- **WHEN** 读取追踪接口
- **THEN** 返回里没有估值、我方报价、中标价、毛利（`tracker-db.isolated.test.ts`）

#### Scenario: 没有财务查看权
- **WHEN** 组织管理员（没有财务键）打开追踪页，页里有本人负责的项目和别人负责的项目
- **THEN** 本人负责的项目那几行照常显示落地价；别人负责的项目那几行写「落地价只给有财务查看权的人看」，响应里搜不到那几家的落地价，「最便宜」与换算不出的原因照常（`npx tsx src/lib/tender-rfq/__tests__/tracker-pure.test.tsx`；`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/tracker-db.isolated.test.ts`）
