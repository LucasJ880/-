## REMOVED Requirements

### Requirement: 原地审批与待批轮次保护
**Reason**: 正文 522 字超过 500 字上限；拆成两条，行为不变。
**Migration**: 规范性语句与场景逐字搬到本 change 新增的「询价卡的原地审批与待批轮次保护」（末尾多一句不含 SHALL 的指引）与「询价单 PDF 对不上时只给驳回」（开头补明是哪一条的例外、哪种卡）。

## ADDED Requirements

### Requirement: 询价卡的原地审批与待批轮次保护
对 `canApprove` 为 true 的用户，送审结果页与待批轮次卡片 SHALL 提供「批准并发送」与「驳回」，并调用既有 `POST /api/capabilities/approvals/{approvalId}/approve|reject`（带 `idempotencyKey`、`expectedPayloadHash` 与卡所属企业 `orgId`），不跳转页面。`canApprove` SHALL 按项目所属企业解析审批中心上下文后取同一判定；为 false 时 SHALL 显示「需要组织管理员批准」与审批中心链接，SHALL NOT 声称已通知任何人。一个轮次有待批发送卡、或入口数据尚未成功加载时，草稿轮次 SHALL NOT 显示「标记发送」「开始询价」「添加供应商」。带询价单 PDF 的卡对不上时的例外，见「询价单 PDF 对不上时只给驳回」。

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

### Requirement: 询价单 PDF 对不上时只给驳回
本条是「询价卡的原地审批与待批轮次保护」的例外（CHAIN-4a）：待批的发询价卡带询价单 PDF、且读卡时核对出 PDF 与现在的项目资料对不上（或暂时核对不了）时，SHALL NOT 显示「批准并发送」，有驳回权限的人 SHALL 仍看到「驳回」，没有的人看到「需要组织管理员驳回这张卡。」；说明文字见 `tender/rfq-supplier-attachment`「卡上提前说附件已变」。

#### Scenario: 询价单 PDF 对不上时只给驳回
- **WHEN** 一张带询价单 PDF 的待批卡起草后改了一条已确认要求，组织管理员打开这一轮
- **THEN** 没有「批准并发送」，有「驳回」与「起草后项目资料有改动……请点「驳回」……」的说明（`npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts` 源码断言；`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts` 读卡标记）
