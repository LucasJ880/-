# Spec Delta：tender/research-tree

## MODIFIED Requirements

### Requirement: 分支在额度内自己决定下一步

每一支 SHALL 是一个循环：每一轮由一次模型请求提出下一步（搜索 / 读页 / 结束）及针对刚读到那一页的事实，代码执行并扣减额度。每支上限 SHALL 为搜索 16、读页 12、模型请求 30（③ 初查各取一半：8、6、15；同一次请求里的重试与换备用模型不另算）；往期同标查联邦合同公开数据每次算一次搜索。因额度停下时 SHALL 记「到上限，未查完」；模型自己说结束的 SHALL NOT 记到上限。条款一支不走这个循环（见 `tender/research-branches`）。

#### Scenario: 每支额度调到 2 次搜索
- **WHEN** 组织把每支搜索额度调到 2，模型一直要求搜索
- **THEN** 只发出 2 次搜索，交「到上限，未查完」（`src/lib/web-reader/__tests__/tree2-research-branch.test.ts`）

#### Scenario: 模型自己结束
- **WHEN** 搜索额度恰好用满、还能读页时模型说结束
- **THEN** 交「没查到」，不记到上限（同上测试）

#### Scenario: 联邦数据占搜索额度
- **WHEN** 往期同标每支搜索额度为 2，联邦数据查了 2 次
- **THEN** 网页搜索一次都不发，交单里搜索计 2（`src/lib/web-reader/__tests__/tree3-research-branches.test.ts`）

### Requirement: 外发的搜索词与网址不带内部内容

系统 SHALL NOT 发出：含现有外发敏感词（毛利、利润、成本、预算、margin、profit、cost、budget 等，含全角、零宽、拆开、编码写法）的搜索词与联邦数据检索词；含本项目估值、我方报价、中标价（整数部分 ≥3 位，含千分位、空格、编码与 230k / 230 thousand / 1.25m / 125万 / 2.3e5 写法）或 0–9 以外数字的搜索词、检索词与网址。被拦的 SHALL NOT 发请求、SHALL NOT 记进审计。交给模型的项目资料 SHALL 只有项目名、采购方、招标编号、地点、类别、截标年份、数量与合同期天数。

#### Scenario: 搜索词里带我方报价
- **WHEN** 模型提出的搜索词里有本项目的我方报价（含编码与缩写写法）
- **THEN** 一次都不发出，审计里也没有这个数（`tree2-research-branch.test.ts`）

#### Scenario: 联邦数据检索词被拦
- **WHEN** 项目名里带着本项目的估值
- **THEN** 那个检索词不发、不记审计（`tree3-research-branches.test.ts`）

### Requirement: 只收逐字核对过的事实

`found[]` 每条 SHALL 来自这一支刚读到的那一页；摘录 12–200 字、逐字（不计空白多少与大小写）出现在正文里；值逐字出现在摘录里（币种与口径的值是枚举，币种的摘录要有对应写法，口径的摘录要有对应提示词）；只含 0–9 的数字，值里的数都在摘录里；金额、数量、年份的值带数。事实类型往期同标为往期标名、中标方、采购方、品项、合同额、数量、年份、币种、口径，同类项目同上去掉往期标名；可带组名。有跳转时网址记跳转后的；跳到别的站且不在搜索结果里的页 SHALL NOT 收事实。每支最多 40 条。

#### Scenario: 摘录或值对不上
- **WHEN** 模型交回的摘录不在正文里、值不在摘录里、摘录只有几个字
- **THEN** 这几条都不进 `found[]`，丢弃数相应增加（`src/lib/tender-research-tree/__tests__/research-tree-pure.test.ts`、`tree2-research-branch.test.ts`）

#### Scenario: 跳转到别的站
- **WHEN** 搜索结果里的网址 302 跳到另一个站读到正文
- **THEN** 这一页的事实不收（`tree2-research-branch.test.ts`）

#### Scenario: 币种与口径
- **WHEN** 币种事实的摘录里没有 CAD / $ 一类写法，口径事实标「含安装」而摘录里没有 install
- **THEN** 两条都不收（`src/lib/tender-research-tree/__tests__/research-branches-pure.test.ts`）

### Requirement: 交接单 research-handoff/v1

每一支完成时 SHALL 在步骤业务输出 `researchHandoff` 里交一张 `research-handoff/v1`：`branchKey`、`kind`、`labelZh`、`status`、`statusZh`（短标签：查到 N 条 / 写明了 N 项 / 都未写明 / 没查到 / 被挡 / 到上限 / 未接通 / 无需追查 / 未开启）、`reasonZh`、`found[]`、`records[]`（授标记录）、`clauses`（条款结论，别的支为 null）、`notFound[]`、`suggestedBranches[]`、`usage`、`blockedSites[]`、`rejectedFacts`。授标支的 N 是记录数；没有这两项的旧单按空处理。

#### Scenario: 交单字段
- **WHEN** 一支跑完
- **THEN** 业务输出里有字段齐全的交接单（`tree2-research-branch.test.ts`、`tree3-research-branches.test.ts`）

#### Scenario: 只有零散事实
- **WHEN** 同类项目一支只收下了采购方名，凑不成记录
- **THEN** 状态「没查到」，原因句写只收下了零散的事实（`tree3-research-branches.test.ts`）

### Requirement: 第二波按分叉规则确定性决定

分叉规则 SHALL 是确定性的纯函数：② 一条授标记录都没有 → 第二波甲跑；② 的记录里有中标方 → 中标方名记入「待反查」，本批不长分支；③ 与甲能算出单价的同类记录（按记录号去重）不足 3 条 → 第二波乙跑（数量不限、近 6 年、加上美国）；否则交「无需追查」并在 `reasonZh` 写明查到了几条。跑的支 SHALL 在 `reasonZh` 写明为什么跑。子代理提出的分支 SHALL NOT 自动长出来。

#### Scenario: 分叉真值表
- **WHEN** 分别给出 ② 有 / 无记录、有 / 无中标方，③ 0 / 2 / 3 条能算单价的记录（另有 1 条没数量的）
- **THEN** 第二波甲乙是否跑、待反查与理由与规则一致（`research-tree-pure.test.ts`）

### Requirement: 树干汇总只写摘要

树干 SHALL 确定性地汇总（不调模型），写进情报室 `summaryJson.researchTree`：版本、jobId、状态、起止时间、每支的键、类别、中文名、短状态、理由、查到条数、记录数、未查到原因与用量、条款三问的答案（枚举）、待反查、未追的线索（只有类别）、全树用量。它 SHALL NOT 含金额、单价、摘录、页码、正文、网址、被挡站或模型写的自由文字；待反查 SHALL NOT 收带数字、货币、@ 或域名的名字。没有情报室时 SHALL NOT 新建，树干结果 `researchTrunk` 写明没写入。

#### Scenario: 树干写摘要
- **WHEN** 一棵树跑完
- **THEN** `summaryJson.researchTree` 有每支状态、记录数、条款答案与用量，没有网址、金额、单价、页码与摘录，情报室别的键不变（`src/lib/web-reader/__tests__/tree2-research-tree-job-db.isolated.test.ts`）

### Requirement: 调研游标审计

每一支的进度 SHALL 记在审计 `research.branch_step`（targetType `research_job`、targetId 为 jobId、记在发起人名下），每行一种：模型请求、模型决定（动作、搜索词或网址、收下的事实、丢弃数、建议）、搜索发出（网页或联邦数据）、搜索结果（网址与标题）、联邦数据结果（状态、行数、收下的记录）、读页发出、读页结果、被拦、交单。审计 SHALL NOT 含网页正文、搜索摘要、标书正文、被外发闸拦下的词与网址或不在本支可读网址里的网址；摘录 SHALL 不超过 200 字。

#### Scenario: 被拦的不记
- **WHEN** 模型提出的搜索词被外发闸拦下
- **THEN** 那一轮的审计只记「被拦」，没有搜索词（`tree2-research-branch.test.ts`）

### Requirement: 开关关时零变化

开关对组织关着时：发起与读取接口 SHALL 返回 404（没有权限的人照样得到守卫的结果）；执行到调研工具时 SHALL 先判开关，SHALL NOT 发任何搜索、读页或模型请求，SHALL NOT 读库、写审计或情报室，只交「未开启」；招标要求页的条款卡片 SHALL NOT 渲染；一键分析的计划、工具面与结果，情报页签，任何定时任务 SHALL 与没有本功能时一致。

#### Scenario: 开关关着执行分支
- **WHEN** 开关关着时执行一支或一整条调研 Job
- **THEN** 搜索、读页、模型调用都是 0，整库只有运行时自己的表变化（`tree2-research-branch.test.ts`、`tree2-research-tree-job-db.isolated.test.ts`）

#### Scenario: 开关关着打开招标要求页
- **WHEN** 开关关着读取接口
- **THEN** 返回 404，卡片什么都不渲染（`research-branches-db.isolated.test.ts`、`src/components/tender-analysis/__tests__/research-clauses-card.test.tsx`）

### Requirement: 调研树零出站

调研树 SHALL NOT 建待批卡、发邮件或通知、写授标权威记录、供应商库、询价或报价，SHALL NOT 改项目，SHALL NOT 写分析运行、要求、事实或标书文件。它只写运行时自己的 Job 与步骤、`research.branch_step` 与读页审计、情报室 `summaryJson.researchTree`（另有运行时与模型调用的通用记账）；只读本项目的标书页与最新一次可用分析的关键事实。

#### Scenario: 跑完一棵树
- **WHEN** 一棵树从发起跑到树干完成
- **THEN** 整库快照里只有运行时的表、审计与情报室有变化，新增审计只有调研游标、读页与配额记账（`tree2-research-tree-job-db.isolated.test.ts`、`research-branches-db.isolated.test.ts`）

## REMOVED Requirements

### Requirement: 条款一支本批不查

**Reason**：TREE-3 接通了条款员。

**Migration**：条款一支的行为见 `tender/research-branches` 的「条款员只读本项目已解析的标书」「关键词规则先找段落」「条款员每棵树最多一次模型请求」「条款判断要有核对过的出处」「未写明时给澄清问题草稿」「子代理出错不编结果」。
