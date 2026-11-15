# Spec Delta

## Purpose

一个导航入口只有一个名字：桌面侧栏、手机导航抽屉、使用说明与该入口页面的大标题显示同一个名称，名称只有一个来源，改名只改一处。

## ADDED Requirements

### Requirement: 侧栏、手机抽屉与使用说明显示同一个名称
对同一个导航入口，桌面侧栏、手机导航抽屉与 `/help` 功能地图 SHALL 在同一界面语言下显示同一个名称。`/help` 功能地图的入口名称 SHALL 随当前界面语言显示，SHALL NOT 固定为中文名称；入口的一句说明不在本要求范围内。

#### Scenario: 三处共用同一个取名规则
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts`
- **THEN** 源码断言通过：桌面侧栏、手机导航抽屉、`/help` 功能地图的入口名称都经同一个取名函数得出，三处没有各自拼名称的代码

#### Scenario: 英文界面下使用说明与侧栏一致
- **WHEN** 界面语言为英文的成员打开 `/help`
- **THEN** 功能地图里每个入口的名称与其侧栏里的名称相同（有英文名的显示英文名，没有的显示中文名）

### Requirement: 入口名称只有一个来源
导航注册表与系统底栏里每一个带翻译键的入口（含子项），其中文翻译 SHALL 等于注册表登记的名称，其英文翻译 SHALL 存在且非空。没有翻译键的入口 SHALL 在任何界面语言下显示注册表登记的名称。

#### Scenario: 注册表名称与翻译表一致
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts`
- **THEN** 72 个入口里带翻译键的 62 项，中文翻译与注册表名称逐项相等、英文翻译非空，不一致项为 0，测试通过

#### Scenario: 只改一处会被测试拦住
- **WHEN** 只改注册表里某个带翻译键入口的名称而不改中文翻译表（或反过来），再运行同一测试
- **THEN** 测试失败，并列出不一致的入口 key

### Requirement: 入口定名
下列入口的中文名称 SHALL 为：`work-calendar` 预约日历；`work-inbox` 微信客服；`biz-trade` 外贸获客；`biz-trade-intel` 竞品溯源；`biz-quotes` 报价；`biz-all-quotes` 报价记录；`biz-cockpit` 团队销售分析；`nav-projects` 项目列表；`nav-project-intel` 智能调查室；`nav-suppliers` 供应商库；`mgmt-orgs` 成员与组织；`mgmt-memory` 组织记忆；`mgmt-wechat` 微信集成；`mgmt-settings` 企业设置；`plat-invites` 邀请码；`plat-audit` 平台审计；`autopilot-overview` 总览；`autopilot-runs` Runs；`autopilot-evaluations` Evaluations；`autopilot-telemetry` Telemetry。其余入口的中文名称 SHALL 保持注册表现有名称不变。

#### Scenario: 定名表逐项成立
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts`
- **THEN** 上列 20 个入口经取名函数得到的中文名称与定名逐项相等，测试通过

#### Scenario: 旧名字不再出现在侧栏与使用说明
- **WHEN** 运行同一测试，对注册表全部 72 项取中文名称
- **THEN** 结果里没有「海外业务」「企业情报」「收件箱」「日历」「电子报价单」「全部报价」「销售分析」「项目」「项目智能」「供应商」「组织」「组织知识」「微信消息」「设置」「邀请码管理」「审计日志」「Autopilot 总览」「Autopilot Runs」「Autopilot Evaluations」「Telemetry Health」这 20 个旧名称（整名相等才算出现；「询盘收件箱」「预约日历」等不算）

#### Scenario: Sunny 销售的报价入口
- **WHEN** 只持 `sales_rep` 岗位的成员（窗饰企业）加载侧栏与 `/help`
- **THEN** 两处都显示「报价」「报价记录」，不显示「电子报价单」「全部报价」

#### Scenario: 梦馨老板兼外贸业务员的入口
- **WHEN** 持 `owner` 与 `trade_rep` 岗位的成员（家纺外贸企业）加载侧栏与 `/help`
- **THEN** 两处都显示「外贸获客」「竞品溯源」「微信客服」「预约日历」「供应商库」「成员与组织」「企业设置」，不显示「海外业务」「企业情报」「收件箱」

### Requirement: 改名入口的英文名称
界面语言为英文时，中文名称在本能力「入口定名」里列出的入口 SHALL 显示与中文定名对应的英文名称，SHALL NOT 继续显示改名前的英文名称（如 Inbox、Global Business、Company Intelligence）。

#### Scenario: 英文定名逐项成立
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts`，用英文文案表对下列入口取名
- **THEN** 结果逐项为：`work-inbox` WeChat Service；`biz-trade` Buyer Prospecting；`biz-trade-intel` Competitor Tracing；`biz-quotes` Quotes；`biz-all-quotes` Quote Records；`biz-cockpit` Team Sales Analytics；`nav-projects` Project List；`nav-project-intel` Intelligence Room；`nav-suppliers` Supplier Directory；`mgmt-orgs` Members & Organization；`mgmt-memory` Organization Memory；`mgmt-wechat` WeChat Integration；`mgmt-settings` Organization Settings；`plat-audit` Platform Audit；`autopilot-overview` Overview；`autopilot-runs` Runs；`autopilot-evaluations` Evaluations；`autopilot-telemetry` Telemetry，测试通过

#### Scenario: 两个英文名称不变
- **WHEN** 运行同一测试
- **THEN** `work-calendar` 仍为 Appointments，`plat-invites` 仍为 Invite Codes

### Requirement: 页面大标题与入口名称一致
下列页面的大标题 SHALL 等于其入口的中文名称：`/trade` 外贸获客；`/trade/intelligence` 竞品溯源；`/trade/fulfillment` 履约协同；`/trade/signals` 市场监测；`/trade/prospects` 线索资产；`/trade/import` 展会导入；`/knowledge` 知识库；`/notifications` 待处理事项；`/service-inbox` 微信客服；`/ops` 运营中心；`/suppliers` 供应商库；`/organizations` 成员与组织；`/settings` 企业设置；`/operations/growth` 品牌增长；`/operations` 内容生产；`/help` 使用说明；`/sales/quotes` 报价记录；`/sales/quote-sheet` 报价。路由与页面其余内容 SHALL NOT 因本要求改变。

#### Scenario: 列出的页面标题逐个成立
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts`
- **THEN** 源码断言通过：上列 18 个页面的大标题字符串等于对应入口的中文名称，且源码里不再有「履约控制台」「页面监控信号」「外贸全部线索」「展会/名片导入」「组织知识库」「客服收件箱」「今日运营工作台」「增长中心 Growth Center」这些旧标题作为大标题

#### Scenario: 编辑已保存的报价单时标题不变
- **WHEN** 销售在 `/sales/quote-sheet` 打开一张已保存的报价单编辑
- **THEN** 大标题仍为「编辑报价单」加版本号；只有新建态的大标题为「报价」

#### Scenario: 梦馨成员从侧栏点进页面
- **WHEN** 持 `owner` 与 `trade_rep` 岗位的成员在侧栏点「履约协同」「市场监测」「线索资产」「展会导入」「知识库」「待处理事项」「微信客服」中任一项
- **THEN** 到达页面的大标题与所点的入口名称相同

### Requirement: 三种身份可见入口的大标题全覆盖
对家纺外贸企业的「老板 + 外贸业务员」、家纺外贸企业的纯外贸业务员、窗饰企业的销售三种身份，侧栏可见的每一个入口 SHALL 满足其一：页面大标题等于入口的中文名称；或登记在例外清单里并写明原因。例外清单 SHALL 只含：`/capabilities`（「AI 工作中心」与其子项「中台总览」指向同一页）、`/operations/intelligence`（入口「营销分析」）、`/reports`（入口「经营简报」）、`/`、`/sales/home`、`/assistant`、`/trade/chat`（后四个页面没有大标题）。例外清单里的页面标题 SHALL NOT 在本要求下改动。

#### Scenario: 每个可见入口要么对齐要么登记
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts`，对三种测试身份各自的侧栏可见入口逐个核对
- **THEN** 每个入口要么在「大标题 = 入口名称」的核对表里且断言通过，要么在例外清单里；既不在核对表也不在例外清单的入口数为 0，例外清单恰为上列 7 个页面，测试通过

#### Scenario: 新增入口没登记会被测试拦住
- **WHEN** 给上述任一身份新增一个可见的导航入口，既不加进核对表也不加进例外清单，再运行同一测试
- **THEN** 测试失败，并列出未登记的入口 key

### Requirement: 站内指向改名入口或页面的界面文字用新名称
页面与组件里指向本能力改名入口或改标题页面的链接文字、按钮文字，以及引用其名称的提示语，SHALL 使用新名称：外贸获客、报价记录、待处理事项、市场监测、品牌增长、内容生产、微信客服。铃铛下拉面板的中文标题 SHALL 为「待处理事项」。由竞品溯源转入的线索，其来源标签 SHALL 显示「竞品溯源」。

#### Scenario: 清单里的文字逐处成立
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts`
- **THEN** 源码断言通过：管理总览的外贸快捷入口为「进入外贸获客」；待收定金横幅与快速报价面板里指向 `/sales/quotes` 的链接为「报价记录」；报价页与快速报价面板的保存提示写「报价记录」；通知偏好页指向 `/notifications` 的按钮为「前往待处理事项」；外贸获客页指向 `/trade/signals` 的链接为「市场监测」、选组织提示写「外贸获客」；品牌增长 7 个子页与营销数字员工页指向 `/operations/growth` 的返回链接写「品牌增长」；营销分析里把信号送去做内容的按钮与提示写「内容生产」；管理模块的运营卡片说明写「微信客服与发布运营」；这些位置不再有对应的旧叫法

#### Scenario: 铃铛下拉标题
- **WHEN** 中文界面的成员点开顶栏铃铛
- **THEN** 下拉面板标题为「待处理事项」，与侧栏入口、`/notifications` 页面大标题同名（同一测试断言中文文案表的值）

#### Scenario: 线索来源标签
- **WHEN** 运行同一测试，取来源为竞品溯源的线索来源标签
- **THEN** 结果为「竞品溯源」

### Requirement: 改名不动已存数据里的名称
竞品溯源确认买家后转入线索时使用的活动名称 SHALL NOT 因入口改名而改变：系统 SHALL 继续按原名称「企业情报」查找并复用该企业已有的活动，SHALL NOT 另建一个新名称的活动。

#### Scenario: 活动名称保持不变
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts`
- **THEN** 源码断言通过：竞品溯源转入线索所用的活动名称仍是「企业情报」
