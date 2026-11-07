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
