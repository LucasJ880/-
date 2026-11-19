## MODIFIED Requirements

### Requirement: 原地审批与待批轮次保护
对 `canApprove` 为 true 的用户，送审结果页与待批轮次卡片 SHALL 提供「批准并发送」与「驳回」，并调用既有 `POST /api/capabilities/approvals/{approvalId}/approve|reject`（带 `idempotencyKey`、`expectedPayloadHash` 与卡所属企业 `orgId`），不跳转页面。`canApprove` SHALL 按项目所属企业解析审批中心上下文后取同一判定；为 false 时 SHALL 显示「需要组织管理员批准」与审批中心链接，SHALL NOT 声称已通知任何人。例外（CHAIN-4a）：卡带询价单 PDF、且读卡时核对出 PDF 与现在的项目资料对不上（或暂时核对不了）时，SHALL NOT 显示「批准并发送」，有驳回权限的人 SHALL 仍看到「驳回」，没有的人看到「需要组织管理员驳回这张卡。」；说明文字见 `tender/rfq-supplier-attachment`「卡上提前说附件已变」。一个轮次有待批发送卡、或入口数据尚未成功加载时，草稿轮次 SHALL NOT 显示「标记发送」「开始询价」「添加供应商」。

#### Scenario: 决策结果留在轮次卡片上
- **WHEN** 批准后执行结果为「已发出 2/3：A、B；失败：C（invalid_grant）」
- **THEN** 决策按钮消失，结果以「已发出 2/3：A、B；失败：C（Gmail 授权失效）」留在该轮卡片上直到手动关闭（审批面板随刷新卸载也不丢）；执行失败时说明这张卡已失效、需重新发起；`web-entry-pure.test.ts` 覆盖文案替换

#### Scenario: 非待批状态的卡
- **WHEN** 卡处于已批准未执行完（APPROVED）或已过期未清理（EXPIRED）
- **THEN** 面板不显示决策按钮，分别显示「已批准，正在发出…稍后刷新」与「已过期……2 小时内自动作废，之后可以重新发起」

#### Scenario: 创建人原地批准
- **WHEN** 创建人（审批中心对该卡 `canApprove` 为 true）点「批准并发送」
- **THEN** 前端调用既有 approve 接口，展示「已发出 N/N：…」，刷新后该轮状态为进行中、各家为已发送

#### Scenario: 待批轮次不能手工标记发送
- **WHEN** 某轮有待批 `tender.send_rfq`
- **THEN** 该轮询价明细里没有「标记发送」「开始询价」按钮，只显示审批面板

#### Scenario: 询价单 PDF 对不上时只给驳回
- **WHEN** 一张带询价单 PDF 的待批卡起草后改了一条已确认要求，组织管理员打开这一轮
- **THEN** 没有「批准并发送」，有「驳回」与「起草后项目资料有改动……请点「驳回」……」的说明（`npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts` 源码断言；`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts` 读卡标记）

### Requirement: 预览不含敏感商务数字
entry 与 rounds 的响应、抽屉与结果页 SHALL NOT 包含毛利率、项目估值（`estimatedValue`）、我方报价（`ourBidPrice` / `winningBidPrice`）；预览只含发件抬头与地址、回复截止、要求条数、供应商名称与收件邮箱、询价正文（正文已由询价生成器做敏感内容整单拦截），以及（CHAIN-4a）发询价卡所带询价单 PDF 的文件名、页数、字节数、预览链接与读卡核对结果。

#### Scenario: 预览字段白名单
- **WHEN** 读取 entry 响应
- **THEN** 响应对象中不存在 `estimatedValue`、`ourBidPrice`、`winningBidPrice`、`margin` 字段（实现按白名单组装）

#### Scenario: 询价单 PDF 的预览字段
- **WHEN** 读一张带询价单 PDF 的发询价卡的邮件预览
- **THEN** 每封预览的附件信息只有文件名、页数、字节数、预览链接与核对结果五个字段（`npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts`）
