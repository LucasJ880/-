# Proposal：一个入口一个名字（NAV-1a）

TASKFLOW：NAV-1a（Phase N「导航与说明白话化 + 回复入口」；任务书 `docs/QINGYAN_NAV-1_PLAIN_NAV_REPLY_TASKBRIEF.md` §NAV-1a，Lucas 2026-11-14 拍板「三条改法全部执行」）。无前置依赖；NAV-1b 依赖本 change 的取名函数。核对基线：main `dd0e99d`（与任务书依据相同，未前移）。四件套审核：Lucas 2026-11-15 通过，design「审核关注点」Q1–Q5 全部按推荐，Q3 并入本 change。

## Why

同一个入口在侧栏、使用说明、页面大标题上有三套名字：侧栏取翻译表、说明页取注册表，72 项里有 18 项对不上，页面大标题又是另一套，梦馨（账号 Cathy）反馈「左栏和右边的指南对不上号」。名字只留一个来源，并用测试守住，以后改名只改一处。

## What Changes

**取名**
- 新增一个共用的取名函数（入参：入口 + 当前界面语言的文案表），桌面侧栏、手机导航抽屉、`/help` 功能地图三处都改用它；`/help` 不再直接读注册表名称。
- 改 `/help` 功能地图的入口名称为按当前界面语言显示（与侧栏同一语言、同一名字）；一句说明仍是中文。
- 新增断言测试：注册表每一项（含子项）有翻译键时，中文翻译必须等于注册表名称，英文翻译必须存在且非空；测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

**定名（BREAKING · 文案）**
- 统一 18 处不一致，全部取注册表名称，两处例外按任务书取页面标题：`work-calendar` → 预约日历，`biz-trade` → 外贸获客。
- 改名 2 处原本一致的入口：`work-inbox` 收件箱 → 微信客服；`biz-trade-intel` 企业情报 → 竞品溯源。
- 所有企业的侧栏随之变化；Sunny 销售的「电子报价单 / 全部报价」显示为「报价 / 报价记录」。完整定名表见 specs `navigation/entry-naming`。
- 同步 `en.ts` 里对应翻译键的英文名（英文定名表见 design D5）。

**页面大标题（改标题，不改路由）**
- 改任务书列出的 7 个页面标题：`/trade/fulfillment` → 履约协同；`/trade/signals` → 市场监测；`/trade/prospects` → 线索资产；`/knowledge` → 知识库；`/notifications` → 待处理事项；`/trade/import` → 展会导入；`/service-inbox` → 微信客服。`/trade`（外贸获客）、`/trade/intelligence`（竞品溯源）现标题已与定名一致，不改。
- 改逐页核对多出的 9 个页面标题（Cathy、梦馨外贸业务员、Lynn 可见入口里标题与入口名不一致、且能一对一对齐的）：`/ops` → 运营中心；`/suppliers` → 供应商库；`/organizations` → 成员与组织；`/settings` → 企业设置；`/operations/growth` → 品牌增长；`/operations` → 内容生产；`/help` → 使用说明；`/sales/quotes` → 报价记录；`/sales/quote-sheet`（新建态）→ 报价。
- 登记 7 个不对齐的例外（一页两个入口、页面本来没有大标题、入口名与页面功能不符），本 change 不改，见 design D6。
- 新增源码断言测试：上述三种身份可见的每个入口，页面大标题等于入口名称，或在例外清单里。

**站内指向改名入口或页面的界面文字（Q3，Lucas 2026-11-15 并入）**
- 改 12 处链接 / 按钮文字：「进入海外业务」→「进入外贸获客」；两处「全部报价」→「报价记录」；「前往通知中心」→「前往待处理事项」；外贸获客页的「页面监控信号」→「市场监测」；品牌增长 7 个子页与营销数字员工页的「返回增长中心」→「返回品牌增长」；「送内容运营」→「送内容生产」（及其操作提示）。
- 改 4 处提示语：报价页两处「保存后…『全部报价』」→「报价记录」；外贸获客页选组织提示里的「海外业务」→「外贸获客」；管理模块卡片说明「客服收件箱与发布运营」→「微信客服与发布运营」。
- 改铃铛下拉标题（中文）「通知中心」→「待处理事项」。
- 改线索来源标签「企业情报」→「竞品溯源」。

**随改**
- 改 `scripts/nav-visual-smoke.mjs` 里对侧栏文字「海外业务」的断言为「外贸获客」。

## Capabilities

### New Capabilities
- `navigation/entry-naming`: 入口名称的单一来源——侧栏、手机抽屉、使用说明显示同一个名字；定名表；页面大标题与入口名一致及其例外；站内指向改名入口或页面的界面文字用新名称。

### Modified Capabilities

无。`navigation/entry-visibility`「/help 功能地图从可见导航生成」的要求文字（按侧栏分组与顺序、每项显示入口名称与一句说明、72 项说明非空）本 change 不改，名称取哪一个由新能力规定；该要求的结构改动属 NAV-1b。

## Impact

- 代码：`src/lib/navigation/`（新增取名函数文件；`registry.ts` 四处名称；`help-map.ts` 输出带翻译键）、`src/components/sidebar.tsx`、`src/components/mobile-nav-drawer.tsx`、`src/app/(main)/help/page.tsx`（名称单元格改为客户端小组件）、`src/lib/i18n/zh.ts` / `en.ts`（20 个翻译键的值，键名不变）、16 个页面或其外壳组件的标题字符串（清单见 design D6）、20 处站内界面文字所在的 17 个页面 / 组件与 `src/lib/revenue-spine/source-labels.ts`（清单见 design D9）、`scripts/nav-visual-smoke.mjs`。
- 测试：新增 `src/lib/navigation/__tests__/entry-naming.test.ts`；既有 `entry-visibility` / `navigation-ia` / `navigation-workspace` / `position-nav` / `trade-layout` / `wechat-entry-nav` / `tenant-context` 断言不改，通过数不变。
- 接口、数据库、权限键、路由门映射表、模块、岗位模板：不动。
- Muse：不触碰 `muse-bridge`，无受影响意图。
- 上线后可见变化：所有企业侧栏与使用说明里 20 个入口名称、16 个页面大标题、20 处站内界面文字。回滚 = 回退本 PR，无数据迁移。

## Out of scope

- 入口的一句说明（`description`）改白话、`/help`「我想做什么」、删 `/help` 开发者页尾、侧栏两段式与分组小标题——NAV-1b。
- 回复入口——NAV-1c。
- 入口的增删、隐藏、排序、可见条件；路由与路由门映射表。
- 手机底栏的短名（任务 / 总览 / 会计 / 首页 / 客户 / 报价 / 日历 / 运营 / 招投标 / 安装 / AI / 助手）与手机抽屉的一级分类名。
- 侧栏分组小标题、`NAV_GROUP_META` / `NAV_SECTION_LABEL` 的分组名。
- design D9 清单以外的旧叫法：接口错误信息、`src/lib/**` 里的定时任务名 / AI 工具说明 / 推送消息正文 / 权限定义名称、`/operations` 索引卡片名（「增长中心」「市场情报」，由 `navigation/entry-visibility` 规定并有测试）、英文的铃铛下拉标题；以及全量扫描多扫到、不在拍板清单里的 13 处界面文字（提示语里的「通知中心」3 处、「增长中心」6 处、「电子报价单」3 处、「组织知识库」1 处），记入报告留待后续。
- 数据里存的名字：`INTELLIGENCE_CAMPAIGN_NAME`（竞品溯源转入线索时建的活动名「企业情报」）、线索来源标签表。
- 给没有翻译键的 10 个入口补翻译键；英文界面的完整翻译。
- U-8「报价工作台 / 报价列表」命名。
