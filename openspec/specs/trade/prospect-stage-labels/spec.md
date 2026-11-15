# trade/prospect-stage-labels Specification

## Purpose
外贸线索阶段在界面、接口与助手文字里叫什么：线索详情、列表、漏斗、询盘收件箱，以及外贸助手与数字员工读到的阶段文字。同一个阶段只有一个名字、一个来源，名字说清是谁做了什么，不与「我方已回复」这类我方动作混用同一个词。

## Requirements

### Requirement: 「买家已来信」阶段的显示名
外贸线索阶段 `replied`（买家来过信；我方回复之后仍停在这个阶段，直到报价或转入其他阶段）的显示名 SHALL 为「买家已来信」，并在以下各处一致：线索详情、外贸获客首页的线索列表与概览卡、询盘收件箱的会话卡片、活动详情、外贸看板接口与活动统计接口返回的漏斗、驾驶舱漏斗、外贸助手与数字员工读到的阶段文字。这个阶段 SHALL NOT 在以上任何一处显示为「已回复」。

#### Scenario: 显示名与同源
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-clarity.test.ts`
- **THEN** 阶段 `replied` 的显示名等于「买家已来信」；外贸看板接口、活动统计接口、外贸获客首页概览卡、外贸助手阶段分布这四处的源码里不再有写死的「已回复」，测试通过

### Requirement: 改名不改阶段本身
本能力 SHALL NOT 改变阶段的取值、阶段之间的流转规则、漏斗各档的统计口径与返回结构；外贸看板接口与活动统计接口返回的漏斗里，这一档的 `stage` / `key` 仍为 `replied`，数字不变，只有 `label` 的文字变化。

#### Scenario: 取值与统计不变
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-clarity.test.ts`
- **THEN** 阶段取值清单、阶段先后顺序、漏斗展示顺序与改名前逐项相同；两个接口的漏斗定义里这一档的 `stage` / `key` 为 `replied`、包含的阶段集合与改名前相同
