# Spec Delta

## ADDED Requirements

### Requirement: 从链接直达询价轮次
打开项目「标书与报价」时，地址带 `#rfq-round-{轮次 id}` 且该轮属于这个项目的，询价列表加载完后 SHALL 展开这一轮并滚动到它，优先于默认展开（最新一轮，或待批的那一轮）。轮次 id 不属于该项目、格式不对或没有锚点时，SHALL 按默认展开，不报错。

#### Scenario: 从通知点进来
- **WHEN** 用户打开 `/projects/P?tab=bid#rfq-round-R`，R 是项目 P 的第 1 轮，第 2 轮正在待批
- **THEN** 第 1 轮展开并滚到可见位置，第 2 轮不自动展开

#### Scenario: 轮次不属于该项目
- **WHEN** 用户打开 `/projects/P?tab=bid#rfq-round-X`，X 不是项目 P 的轮次
- **THEN** 按默认规则展开，页面不报错

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts`
- **THEN** 锚点解析（合法 id、空、错前缀、含多余字符）与"锚点轮次优先于默认展开"的断言通过，退出码 0

### Requirement: 待批催单卡的原地审批
「标书与报价」的轮次卡片 SHALL 显示本轮待批（含已批准、还在发出中）的催单与缺字段追问审批卡：卡片头部加 `催单待批 {N}`；展开后每张卡一块面板，写明哪家、是第几次催单还是缺字段追问，并能看将在原邮件线程里发出的正文。已过期没人批的卡不显示（下次定时检查会按规则重新起草）。

对审批中心判定能批准的用户，面板 SHALL 提供「批准并发送」与「驳回」，调用审批中心既有接口，批准后显示执行结果。驳回 SHALL 只让这一封不发出，SHALL NOT 取消该轮或影响其它供应商。不能批准的用户看到 `需要组织管理员批准` 与审批中心链接。

#### Scenario: 从催单待批通知点进来
- **WHEN** 定时检查为第 2 轮起草了丙厂、丁厂的催单，项目负责人打开 `/projects/P?tab=bid#rfq-round-R`
- **THEN** 第 2 轮展开，卡片头显示「催单待批 2」，丙厂、丁厂各有一块带「批准并发送」的面板

#### Scenario: 驳回一封催单
- **WHEN** 负责人驳回丙厂的催单
- **THEN** 丙厂这封不发出，第 2 轮的状态不变，丁厂的面板仍在

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts`
- **THEN** 催单面板标题与驳回文案、单封催单的正文预览、卡片头计数的断言通过，退出码 0
