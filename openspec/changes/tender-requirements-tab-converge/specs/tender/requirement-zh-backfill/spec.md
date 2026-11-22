## ADDED Requirements

### Requirement: 读到英文就自动补翻
有项目读权限的人读取投标合规矩阵时，若同时满足以下条件，系统 SHALL 在矩阵接口返回之后自动补翻一次：
- 这次分析已完成（等待审核或已批准）；
- 要求译文、事实或关键事实里还有英文，判定与「翻译成中文」相同；
- 自动补翻还有次数；
- 没有补翻在进行。

矩阵接口 SHALL NOT 等补翻做完才返回。分析未完成时 SHALL NOT 自动补翻。

#### Scenario: 落库前的中文化被跳过
- **WHEN** 一份等待审核的分析有 20 条要求译文仍是英文，有读权限的人打开矩阵
- **THEN** 矩阵接口先返回，中文化状态为「自动补翻中」；随后这 20 条被替换为中文，原文不变（`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge-db.isolated.test.ts`，用假的模型调用）

#### Scenario: 已经是中文
- **WHEN** 分析里所有译文都已是中文
- **THEN** 不发起补翻，没有模型调用，中文化状态为「无需补翻」（同一测试）

### Requirement: 用的是既有的补翻调用
自动补翻 SHALL 与「翻译成中文」用同一个翻译调用：同一提示词与版本、同样每批 50 条、每次最多 400 条、总预算 100 秒。系统 SHALL NOT 为自动补翻新增提示词、模型调用类型、定时任务、队列或后台扫描。

#### Scenario: 调用一致
- **WHEN** 读自动补翻与手动补翻两处的源码
- **THEN** 两处都调用同一个中文化服务、总预算都是 100 秒；没有新的提示词名称，`vercel.json` 没有新的定时任务（`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts`）

### Requirement: 自动补翻次数有上限
每次分析的自动补翻 SHALL 最多 2 次，第 2 次 SHALL 只在第 1 次至少译成 1 条、且还有英文时发生。次数在开始补翻之前计入，补翻中途中断也算 1 次。次数用完后，系统 SHALL NOT 再自动补翻，也 SHALL NOT 由定时任务、后台扫描或别的请求重试。

#### Scenario: 第 1 次一条也没译成
- **WHEN** 第 1 次自动补翻时模型调用全部失败，之后又有人打开矩阵
- **THEN** 不再自动补翻，中文化状态为「自动补翻没译完」（`requirements-tab-converge-db.isolated.test.ts`）

#### Scenario: 第 1 次译了一部分
- **WHEN** 第 1 次自动补翻译成 100 条、预算用完时还剩 60 条英文，之后有人打开矩阵
- **THEN** 发起第 2 次；第 2 次之后不论结果都不再自动补翻（同一测试）

### Requirement: 同一次分析同时只补翻一份
多人同时读取同一次分析的矩阵时，系统 SHALL 只开始一次补翻。一次补翻（自动或手动）开始后 150 秒内，系统 SHALL NOT 为同一次分析再开始补翻。这时手动补翻接口 SHALL 返回 409 与「正在自动翻译，请稍候」。开始后超过 150 秒仍没记下结束的，记为已中断。

#### Scenario: 两个人同时打开
- **WHEN** 两个请求同时读取同一次有英文的分析
- **THEN** 只有一次补翻、只计 1 次（`requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 补翻进行中的显示
自动补翻进行中或即将开始时，矩阵 SHALL 显示「正在自动翻译成中文…」，并 SHALL 每 15 秒重读一次矩阵，最多 12 次；补翻结束后，行上 SHALL 显示译好的中文。这时 SHALL NOT 显示「翻译成中文」按钮。

#### Scenario: 补翻中
- **WHEN** 矩阵接口返回的中文化状态为「自动补翻中」
- **THEN** 卡片显示「正在自动翻译成中文…」、没有「翻译成中文」按钮，并按 15 秒一次重读、最多 12 次（`requirements-tab-converge.test.ts`）

### Requirement: 「翻译成中文」只作兜底
以下条件全部满足时，「翻译成中文」按钮 SHALL 显示，且只对有项目写权限的人显示，其它情况 SHALL NOT 显示：
- 这次分析已完成；
- 自动补翻次数已用完；
- 仍有英文；
- 没有补翻在进行。

条件满足但看页面的人没有写权限时，SHALL 显示「有 N 条还是英文，自动翻译没有译完，请项目负责人点「翻译成中文」」。按钮背后的手动补翻接口、60 秒频控与返回字段 SHALL 不变。

#### Scenario: 四种情形
- **WHEN** 分别构造：没有英文；有英文、还能自动补翻；有英文、正在补翻；有英文、次数用完
- **THEN** 只有最后一种对有写权限的人显示「翻译成中文」；对没有写权限的人，最后一种显示那句说明（`requirements-tab-converge.test.ts`）

### Requirement: 手动补翻取同一次分析
`POST /api/projects/{id}/bid-fit/translate` SHALL 翻译矩阵这时显示的那次分析，也就是该项目最新的一条。它未完成时，接口 SHALL 返回 409「本次分析未完成，完成后再翻译」，SHALL NOT 改去翻译更早的一份。接口的写权限、60 秒频控与成功时返回的字段 SHALL 不变。

#### Scenario: 最新一条未完成
- **WHEN** 最新一条分析为「AI 分析未完成」，更早有一份等待审核的分析，有人调用手动补翻
- **THEN** 返回 409，两份分析都没有被翻译（`requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 补翻写回不覆盖别人的改动
补翻写回时，SHALL 只改：
- 要求的中文译文；
- 事实的中文内容；
- 关键事实的文字；
- 自己的补翻记录与频控戳。

补翻进行期间别人写入的五态标注、审阅状态与这次分析的其它摘要字段 SHALL 原样保留。矩阵的标注写入 SHALL NOT 盖掉补翻写回的内容。

#### Scenario: 补翻期间有人标注
- **WHEN** 补翻开始后、写回之前，有人在矩阵上把一条要求标为「已有」
- **THEN** 补翻写回后，这条要求仍是「已有」且已确认，其余要求的译文是中文（`requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 补翻只改译文
补翻 SHALL NOT 改动要求原文、是否强制、是否需证据、合规判定、审阅状态、五态标注与事实原文。补翻 SHALL NOT 发出模型调用以外的任何外部请求。矩阵接口与手动补翻接口 SHALL NOT 返回模型的原始输出与内部错误码。分析落库前的那一次中文化 SHALL 保持不变。

#### Scenario: 语义字段不动
- **WHEN** 对一份已标注过的分析做一次补翻
- **THEN** 补翻前后，每条要求的原文、是否强制、是否需证据、合规判定、审阅状态与五态标注都相同（`requirements-tab-converge-db.isolated.test.ts`）
