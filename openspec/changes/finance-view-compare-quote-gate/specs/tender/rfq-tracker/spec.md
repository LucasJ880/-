## MODIFIED Requirements

### Requirement: 价格只有一个出处
已报价的行 SHALL 显示原币种单价 / 总价、交期、有效期，以及比价矩阵给出的落地价（CAD）与「最便宜」标记；矩阵换算不出时 SHALL 写原因。落地价 SHALL 只给对该行所在项目有财务查看权的人（见「追踪页落地价按项目的财务查看权」）。追踪 SHALL NOT 自己换汇或算落地价。一次最多为 50 轮取比价矩阵，其余轮次对有财务查看权的人写明请到比价面板查看。返回 SHALL NOT 含项目估值、我方报价、中标价、毛利、价格情景。

#### Scenario: 与比价面板一致
- **WHEN** 同一轮两家报价进表，一家缺运费参数
- **THEN** 追踪页的落地价与「最便宜」与该轮比价矩阵逐家相同；缺参数的那家写「落地价未换算（…）」（`tracker-pure.test.tsx`；`tracker-db.isolated.test.ts`）

#### Scenario: 白名单
- **WHEN** 读取追踪接口
- **THEN** 返回里没有估值、我方报价、中标价、毛利（`tracker-db.isolated.test.ts`）

## ADDED Requirements

### Requirement: 追踪页落地价按项目的财务查看权
落地价 SHALL 按每行所在项目判定（与比价矩阵同一口径）。没有财务查看权的那一格 SHALL 写「落地价只给有财务查看权的人看」，SHALL NOT 给「去比价」链接；这一轮超过上限没取矩阵时也写这一句，不写「请到比价面板查看」；换算不出时照常写原因并给链接；「最便宜」照常。响应 SHALL NOT 含那几家的落地价。有行被隐藏时整页 SHALL 带 `landedHidden: true`，页面顶部 SHALL 显示一次比价面板那一句（被隐藏的项目都没有真人负责人、部分没有、授权查询出错时按 `projects/finance-access`「没有真人负责人与暂时无法确认时的提示」换句）。汇总卡不取矩阵，SHALL 不受影响。

#### Scenario: 没有财务查看权
- **WHEN** 组织管理员（没有财务键）打开追踪页，页里有本人负责的项目和别人负责的项目
- **THEN** 本人负责的项目那几行照常显示落地价；别人负责的项目那几行写「落地价只给有财务查看权的人看」，没有去比价链接，响应里搜不到那几家的落地价，「最便宜」与换算不出的原因照常，整页带 `landedHidden`（`npx tsx src/lib/tender-rfq/__tests__/tracker-pure.test.tsx`；`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/tracker-db.isolated.test.ts`）

#### Scenario: 负责人是系统账号
- **WHEN** 只读成员看的被隐藏的项目里，有的负责人是导入用的系统账号
- **THEN** 都是系统账号时 `hintReason` 为 `no_owner`，一部分是时为 `mixed`；有真人负责人时不带（`tracker-db.isolated.test.ts`；`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

#### Scenario: 页面顶部提示
- **WHEN** 追踪接口带 `landedHidden`
- **THEN** 页面顶部显示一次提示，每格仍是那一短句（`tracker-pure.test.tsx` 源码断言）
