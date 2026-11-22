## MODIFIED Requirements

### Requirement: 只在人的审核动作成功之后判定
系统 SHALL 只在以下四个动作成功之后判定是否自动起草：批准招标分析、确认一条要求、批量确认要求、驳回一条要求。这四个动作都要求操作者对项目有写权限。投标合规矩阵上的标注即使改了审阅状态，也 SHALL NOT 触发判定：它只在分析等待审核时改审阅状态，这时的判定总是「分析还没批准」。系统 SHALL NOT 由定时任务、后台扫描或 Muse 消息触发自动起草。重复批准（幂等返回）SHALL NOT 触发判定。自动起草的判定或执行出错时，触发它的审核动作 SHALL 仍然成功，响应里的 `rfqAutoDraft` SHALL 说明没有起草及原因。

#### Scenario: 起草失败不影响审核动作
- **WHEN** 批准招标分析成功，但建轮次时出错
- **THEN** 批准仍然成功（状态为已批准），`rfqAutoDraft.drafted` 为 false，原因为起草失败（`auto-draft-db.isolated.test.ts`）

#### Scenario: 矩阵标注不触发
- **WHEN** 招标分析等待审核，操作者在投标合规矩阵上把最后一条待确认的要求选为「已有」
- **THEN** 没有新的询价轮次与审批卡，矩阵写入接口的响应里没有 `rfqAutoDraft`（`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge-db.isolated.test.ts`）

### Requirement: 结果写进响应并显示在界面上
开关开启时，四个审核接口的成功响应 SHALL 含 `rfqAutoDraft`：起草了则给出轮次号、收件家数、被跳过的家数、没有带上的未确认要求数、一句中文说明与审批卡所在的链接；没起草则给出原因码、一句中文说明与一个去处（如「去发询价」「去连接邮箱」「去需求」，没有合适去处时为空）。`rfqAutoDraft` SHALL 带一个 `quiet` 标记：审核过程中必然反复出现的情形（分析还没批准、项目已有轮次）为 true，其余为 false。投标合规矩阵 SHALL 在「批准分析」成功后显示 `quiet` 为 false 的结果，SHALL NOT 显示 `quiet` 为 true 的结果。项目页的轮次列表 SHALL 对自动起草的轮次显示「自动起草」标记，并 SHALL 在这一轮待批的审批卡上方显示卡摘要里的那句说明（供应商取自谁的常用供应商、带了几条已确认的要求、有几条没带上）。`rfqAutoDraft` SHALL NOT 含供应商邮箱以外的联系信息、我方价格、项目估值或毛利率。

#### Scenario: 没起草时给出去处
- **WHEN** 操作者没有就绪的常用供应商
- **THEN** `rfqAutoDraft` 为 `{ drafted: false, reason: "NO_DEFAULT_SUPPLIERS", quiet: false, … }`，说明里写明去哪里选供应商，链接指向既有的询价入口（`auto-draft-pure.test.ts`）

#### Scenario: 逐条确认时不反复提示
- **WHEN** 招标分析还在等待审核，操作者调用逐条确认接口确认了一条要求
- **THEN** 这次确认的响应里 `rfqAutoDraft` 为 `{ drafted: false, reason: "RUN_NOT_APPROVED", quiet: true, … }`（`auto-draft-pure.test.ts`；`auto-draft-db.isolated.test.ts`）

#### Scenario: 界面显示
- **WHEN** 在投标合规矩阵顶部批准分析并自动起草成功
- **THEN** 矩阵顶部显示「已为你起草第 1 轮询价：N 家常用供应商……还没有发出，批准后才发」，点「去批准」到项目页的这一轮；轮次上有「自动起草」标记，审批卡上方有那句说明（截图 `docs/acceptance/fix-22/04-matrix-auto-draft.png`、`docs/acceptance/rfq-auto-2/round-auto-drafted.png`）
