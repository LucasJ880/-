## ADDED Requirements

### Requirement: 页签上两处读同一次分析
「招标要求」页签上的分析面板与投标合规矩阵 SHALL 显示同一次分析：该项目最新创建的一条分析记录，不分它来自哪条流程、处于什么状态。矩阵 SHALL 用面板这一次加载到的那一条；面板重新加载换了一条时，矩阵 SHALL 跟着换。矩阵接口不带分析 id 时 SHALL 按同一口径自己取。矩阵 SHALL NOT 再只取「等待审核 / 已批准」里最新的一条。

#### Scenario: 12-3 的情形
- **WHEN** 项目有一份较早的等待审核分析（73 条要求）和一份较新的「AI 分析未完成」分析（54 条要求）
- **THEN** 矩阵接口不带分析 id 时取的是较新那份，返回 54 条要求、状态为「AI 分析未完成」、标明未完成（`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge-db.isolated.test.ts`）

#### Scenario: 面板换了一条分析
- **WHEN** 卡片上的一键分析完成，面板重新加载到新的一条
- **THEN** 矩阵改读新的那一条（`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts` 的接线断言：矩阵的分析 id 来自面板加载的那一条）

### Requirement: 分析未完成时写明可能不全
状态为等待审核或已批准的分析为「已完成」；其余状态（等待分析、正在提取、正在分析、AI 数字员工分析中、分析失败、AI 分析未完成、已由新分析替代）为「未完成」。分析未完成时，矩阵 SHALL 在顶部显示「本次分析未完成，以下可能不全」；下一行在前四种状态写「分析完成后才能标注」，在后三种（分析失败、AI 分析未完成、已由新分析替代）写「重新分析完成后才能标注」。这次分析还没有要求时，矩阵 SHALL 照样显示，写这两句并加「这次分析还没有摘出要求」。分析已完成时 SHALL NOT 显示这几句。

#### Scenario: 九种状态逐一判定
- **WHEN** 分别给出上面九种状态
- **THEN** 只有等待审核与已批准判为已完成；其余七种判为未完成，前四种的第二句是「分析完成后才能标注」，后三种是「重新分析完成后才能标注」（`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts`）

#### Scenario: 分析中还没有要求
- **WHEN** 最新一条分析为「AI 数字员工分析中」，还没有要求
- **THEN** 矩阵显示「本次分析未完成，以下可能不全」「分析完成后才能标注」「这次分析还没有摘出要求」，没有任何标注控件（同一测试）

### Requirement: 未完成的分析只读
分析未完成，或矩阵这时显示的分析已不是该项目最新的一条时，矩阵 SHALL NOT 显示五态选择、「这不是要求」、批量标注、「采纳全部历史建议」、「把这 N 条一并确认」、「批准分析」与「翻译成中文」。矩阵写入接口收到这样的分析时 SHALL 返回 409 与一句白话，SHALL NOT 改动任何标注、审阅状态，SHALL NOT 写审计。

#### Scenario: 分析中的那一份
- **WHEN** 最新一条分析为「AI 数字员工分析中」且已有要求，有写权限的人对其中一条提交「已有」
- **THEN** 返回 409「本次分析未完成，完成后才能标注」；这条要求的审阅状态与摘要 JSON 都没有变化，没有新审计（`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge-db.isolated.test.ts`）

#### Scenario: 已有更新的一条
- **WHEN** 甲的页面停在分析 A 上，之后项目新建了分析 B，甲对 A 的一条要求提交标注
- **THEN** 返回 409「页面上的分析已有更新，请刷新后再标注」，A 的记录不变（同一测试）

### Requirement: 要求只在矩阵一处列出
「招标要求」页签上 SHALL 只有投标合规矩阵逐条列出要求。分析面板在这里 SHALL 只显示进度：一键分析卡片、分析状态、文件纳入情况、增量变更待确认、出错提示。分析面板 SHALL NOT 显示要求列表、勾选框、逐条确认 / 驳回、批量确认、「批准分析」与它旁边的提示。分析面板在「提交」页签上的挂载与显示 SHALL 不变。

#### Scenario: 面板里不再有要求列表
- **WHEN** 读分析面板与「招标要求」页签的源码
- **THEN** 面板里没有要求列表、勾选框、确认 / 驳回要求的请求、批量确认的请求、批准的请求；页签挂的分区里没有「requirements」；「提交」页签的挂载与改动前相同（`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts`；`npx tsx src/components/project-detail/__tests__/tender-detail-ia.test.ts`）

### Requirement: 其余分区收在矩阵下方
矩阵下方 SHALL 有一块默认收起的分区。展开后依次是「风险」「澄清问题」「中文分析」「来源」四个页签，每个页签的内容与改动前相同。分析带「项目解读」时，展开后是「项目解读」「风险与缺口」「澄清 / RFI」「来源」，默认停在「项目解读」。「全部条款」「关键要求」两个页签 SHALL NOT 出现在这里。「项目解读」里原来指向关键要求的两个按钮 SHALL 改为「去投标合规矩阵逐条看」，点后滚到矩阵。

#### Scenario: 两种分析各自的页签
- **WHEN** 分别打开一份不带「项目解读」与一份带「项目解读」的分析，展开矩阵下方的分区
- **THEN** 前者是风险、澄清问题、中文分析、来源；后者是项目解读、风险与缺口、澄清 / RFI、来源；都没有「Requirement」「全部条款」「关键要求」（`requirements-tab-converge.test.ts`；截图 `docs/acceptance/fix-22/03-folded-tabs.png`）

### Requirement: 每行有来源
矩阵每一行 SHALL 有「来源」。这条要求有来源记录时，点开显示文件名、页码或单元标签与原文摘录，写法与改动前要求列表里的「来源」相同；没有来源记录时 SHALL 显示「来源未记录」，不可点。矩阵 SHALL 列出这次分析的全部要求；超过 300 条时，SHALL 写明「共 N 条，这里只列出前 300 条」。

#### Scenario: 有来源与没来源
- **WHEN** 一条要求有一条来源记录（《RFP.pdf》第 12 页），另一条没有
- **THEN** 矩阵接口给前一条返回定位「RFP.pdf · p.12」与原文摘录，给后一条返回空的来源；卡片上前一条有可点的「来源」，后一条显示「来源未记录」（`requirements-tab-converge-db.isolated.test.ts`；`requirements-tab-converge.test.ts`）

### Requirement: 标注五态即确认
分析等待审核时，人在矩阵上给一条要求选五态（已有 / 可开发 / 需 Partner / 需 RFI / No-Go）的任一项，系统 SHALL 在同一次写入里记下这一项，并把这条要求的审阅状态改为「已确认」。两项改动 SHALL 同时成功或同时不做。原来是「已驳回」的要求改选五态，SHALL 回到「已确认」。矩阵 SHALL NOT 提供把要求改回「待确认」的选项。

#### Scenario: 选「已有」
- **WHEN** 等待审核的分析里一条待确认的要求被选为「已有」
- **THEN** 这条要求的五态为「已有」、审阅状态为「已确认」（`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge-db.isolated.test.ts`）

#### Scenario: 驳回后又改选
- **WHEN** 一条已驳回的要求改选为「可开发」
- **THEN** 五态为「可开发」，审阅状态回到「已确认」（同一测试）

### Requirement: 「这不是要求」即驳回
分析等待审核时，矩阵每一行 SHALL 有「这不是要求」。选它时，系统 SHALL 在同一次写入里把审阅状态改为「已驳回」，并去掉这一行的五态标注；两项改动 SHALL 同时成功或同时不做。系统 SHALL NOT 把「这不是要求」记成第六种五态，SHALL NOT 把它写进合规记忆。

#### Scenario: 原来标了「需 RFI」
- **WHEN** 一条已标「需 RFI」的要求改选「这不是要求」
- **THEN** 审阅状态为「已驳回」，这一行不再有五态标注；矩阵上「需 RFI」的计数减 1（`requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 询价单取已确认要求的口径不变
询价单、自动起草、提交清单 SHALL 仍只按审阅状态「已确认」取要求。五态标注本身 SHALL NOT 决定一条要求进不进询价单。矩阵上的确认与逐条确认接口写的 SHALL 是同一个审阅状态。

#### Scenario: 矩阵上确认的要求进询价单
- **WHEN** 等待审核的分析里，一条产品类要求在矩阵上选「已有」，另一条选「这不是要求」；之后批准分析并生成询价单
- **THEN** 前一条在询价单行项里；后一条不在，排除清单里记 `not_confirmed`（`requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 批准之后确认状态不再变
分析已批准后，已确认的行 SHALL 仍可在五态之间改，这时 SHALL NOT 改变审阅状态。待确认的行 SHALL 只读，并标「批准前没确认，不进询价单」；已驳回的行 SHALL 只读，显示「这不是要求」。已批准时 SHALL NOT 提供「这不是要求」、批量标注、「采纳全部历史建议」与「把这 N 条一并确认」。标注写入与批准同时发生时，系统 SHALL 按两者实际的先后处理，结果 SHALL 与依次发生相同。

#### Scenario: 批准后改五态
- **WHEN** 已批准的分析里一条已确认的要求从「已有」改为「需 Partner」
- **THEN** 五态为「需 Partner」，审阅状态仍是「已确认」（`requirements-tab-converge-db.isolated.test.ts`）

#### Scenario: 批准后标待确认的行
- **WHEN** 已批准的分析里，有人对一条待确认的要求提交「已有」
- **THEN** 返回 409「批准前没确认的要求不能再标注」，五态与审阅状态都不变（同一测试）

### Requirement: 行上显示的状态
矩阵每一行 SHALL 按下面的先后决定显示什么：
- 审阅状态为已驳回 → 「这不是要求」；
- 有五态标注 → 该项；
- 已确认而没有五态 → 「已确认（未标）」；
- 其余 → 「未标」。

本能力上线前标过五态、审阅状态仍是待确认的行，SHALL 显示该项并加「待确认」。系统 SHALL NOT 自动把这些行改成已确认。

#### Scenario: 上线前的四种组合
- **WHEN** 一份等待审核的分析里有四条要求：已驳回且标过「已有」、已确认没标、待确认标过「需 RFI」、待确认没标
- **THEN** 依次显示「这不是要求」「已确认（未标）」「需 RFI · 待确认」「未标」；库里的记录没有被改（`requirements-tab-converge.test.ts`；`requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 把上线前已标的一并确认
分析等待审核、看页面的人有项目写权限，且有标过五态而仍待确认的要求时，矩阵顶部 SHALL 写「已标的 N 条还没算确认」，并给「把这 N 条一并确认」。点后 SHALL 先弹确认框，确认后把这 N 条的审阅状态改为「已确认」，五态不变。没有这样的要求时 SHALL NOT 显示这一行。

#### Scenario: 一并确认
- **WHEN** 等待审核的分析里有 3 条标过五态、仍待确认，有写权限的人点「把这 3 条一并确认」并确认
- **THEN** 这 3 条变为已确认，五态不变，有一条审计；这一行消失（`requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 批量标注先确认
「未标 N 条全部设为已有」「本组全部已有」「采纳全部历史建议（N）」三个按钮点后 SHALL 先弹确认框，写明条数与「这些要求会算作已确认，属于供应商侧的会进询价单」，确认后按「标注五态即确认」写入。批量标注 SHALL 只作用于没有五态标注、也不是「这不是要求」的行。

#### Scenario: 全部设为已有
- **WHEN** 当前可见的 12 条里有 9 条未标、1 条「这不是要求」、2 条已标，有写权限的人点「未标 9 条全部设为已有」并确认
- **THEN** 那 9 条为「已有」且已确认；「这不是要求」那条与已标的 2 条不变（`requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 没人操作时不写标注
系统 SHALL NOT 在没有人操作时写入任何五态标注或审阅状态。与历史确认逐字一致的候选 SHALL NOT 在打开页面时自动带入；它与相似的候选一起列在「合规记忆」那一行，由人点「采纳全部历史建议（N）」带入。

#### Scenario: 打开页面
- **WHEN** 一份等待审核的分析有 4 条要求与本组织历史确认逐字一致，有写权限的人打开「招标要求」页签
- **THEN** 这 4 条仍是未标、待确认；「合规记忆」那一行写着可采纳的条数（`requirements-tab-converge.test.ts` 的源码断言：卡片加载后不调用带入）

### Requirement: 批准分析在矩阵顶部
分析等待审核、看页面的人有项目写权限时，矩阵顶部 SHALL 显示「批准分析」。它调用既有的批准接口，权限（项目写权限）与可批准的条件（仅等待审核）SHALL 与改动前相同。还有待确认的要求时，旁边 SHALL 显示既有的那句提示。批准成功后，矩阵与分析面板 SHALL 都刷新为已批准。没有写权限的人 SHALL NOT 看到这个按钮。

#### Scenario: 批准
- **WHEN** 有写权限的人在矩阵顶部点「批准分析」
- **THEN** 走既有的批准接口、请求体仍是 `{ confirmAllRequirements: false }`；之后面板状态为「已批准」，矩阵按批准后的规则显示（`requirements-tab-converge.test.ts` 的接线断言；截图 `docs/acceptance/fix-22/02-matrix-approve.png`）

### Requirement: 矩阵写入留审计
矩阵的一次写入只要改了至少一条要求的审阅状态，系统 SHALL 写一条审计。审计记下操作者、所属分析、动作（五态的哪一项、「这不是要求」或「一并确认」）、涉及的要求号与实际改了几条；要求号最多 300 个，每个不超过 64 字。审计写不进去 SHALL NOT 让这次写入失败。只改五态、没改审阅状态的写入 SHALL NOT 写这条审计。

#### Scenario: 选「已有」留审计
- **WHEN** 有写权限的人把 2 条待确认的要求批量设为「已有」
- **THEN** 有一条审计，记下他、这份分析、「已有」、这 2 条要求号与改了 2 条（`requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 矩阵读接口
`GET /api/projects/{id}/bid-fit` SHALL 要求项目读权限，可带 `runId`。带的分析不属于本项目或本组织时 SHALL 返回 404。响应 SHALL 含：
- 这次分析的 id、状态、是否已完成、是否为该项目最新的一条；
- 要求总条数；
- 每条要求的审阅状态与来源；
- 五态标注、合规记忆给出的候选；
- 中文化状态（能力 `tender/requirement-zh-backfill`）。

#### Scenario: 读别的项目的分析
- **WHEN** 带上另一个项目的分析 id 调用
- **THEN** 返回 404，响应里没有那份分析的任何内容（`requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 矩阵写入接口
`POST /api/projects/{id}/bid-fit` SHALL 要求项目写权限，接受以下取值：
- `fit` 取五态之一，或 `NOT_A_REQUIREMENT` 表示「这不是要求」；
- `action: "confirm-marked"`：一并确认这次分析里标过五态、仍待确认的要求；
- `action: "apply-memory"`：既有的「采纳全部历史建议」。

涉及的要求 SHALL 全部属于这次分析，有一条不属于就整体拒绝（404）。成功响应 SHALL 带更新后的五态标注，以及已确认、待确认、已驳回的条数。

#### Scenario: 混进别的分析的要求
- **WHEN** 批量提交的 3 条要求里有 1 条属于另一份分析
- **THEN** 返回 404，3 条都没有变化（`requirements-tab-converge-db.isolated.test.ts`；`npx tsx src/lib/tender-auto-analysis/__tests__/bid-fit-usability.test.ts` 的 BF-09a）

### Requirement: 矩阵接口不输出什么
矩阵的读、写接口 SHALL NOT 输出：
- 模型的原始返回、内部错误码、补翻记录的原始内容；
- 毛利率、项目估值与我方最终报价；
- 其他项目的分析内容。

合规记忆给出的候选 SHALL 仍只带来源项目名称与要求号。

#### Scenario: 响应字段
- **WHEN** 读一份正在自动补翻、带合规记忆候选的分析
- **THEN** 响应里没有模型原文、错误码、补翻记录原文，也没有价格与毛利字段（`requirements-tab-converge-db.isolated.test.ts`）
