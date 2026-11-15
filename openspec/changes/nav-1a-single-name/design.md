# Design：一个入口一个名字（NAV-1a）

## Context

动机见 proposal.md。以下是核对到的现状（main `dd0e99d`，2026-11-12；任务书依据的就是这个提交，main 没有前移）。

**名称现在有三个出处**

| 出处 | 取法 | 位置 |
|---|---|---|
| 桌面侧栏 | 有翻译键且翻译表有值 → 翻译表；否则注册表名称 | `src/components/sidebar.tsx:49` `itemLabel` |
| 手机导航抽屉 | 同上，另写了一份 | `src/components/mobile-nav-drawer.tsx:299-302` |
| `/help` 功能地图 | 直接取注册表名称 | `src/lib/navigation/help-map.ts:22` |
| 页面大标题 | 各页面自己写死 | `PageHeader title=` 或 `<h1>` |

**实测数字**（脚本遍历 `NAVIGATION_REGISTRY` + `SYSTEM_NAV_ITEMS`，与任务书一致）

- 72 项；62 项有翻译键，10 项没有（`ws-ops-projects`、`ws-install`、`sales-performance`、`sales-email-settings`、`biz-accounting`、`nav-intel-awards / -competitors / -agencies / -supply / -monitor`）。
- 62 项里中文翻译 ≠ 注册表名称的 18 项，正是任务书定名表列的那些；没有两个入口共用同一个翻译键。
- 改值涉及的 20 个翻译键，在 `src/`、`scripts/` 里除注册表与两份翻译表外没有别的引用（`grep` 核对）。
- 仓库测试身份的可见入口：`mx_cathy`（老板 + 外贸业务员）主区 38 个一级 + 5 个子项，加系统区「使用说明」共 44 行；`mx_trade_rep` 24 项；`sales_rep`（Lynn）8 项。

**界面语言只在浏览器里**：`src/lib/i18n/context.tsx` 用 `localStorage` 的 `qingyan-locale`，服务端取不到。`/help` 是服务端组件。

**规格现状**：`navigation/entry-visibility`「/help 功能地图从可见导航生成」只说「每项显示入口名称与一句说明」，没规定名称取哪一个；`identity/wechat-entry`、`navigation/route-gate`、`navigation/position-based-visibility` 里把 `/wechat` 入口叫「微信集成」，与本次定名一致，没有规格需要改写。

## Goals / Non-Goals

**Goals**

- 三处显示面（侧栏、手机抽屉、`/help`）用同一个取名函数，同一界面语言下名字相同。
- 注册表名称是中文名的唯一事实源，翻译表与它不一致时测试失败。
- 按任务书定名表落 20 个入口的名称。
- Cathy、梦馨纯外贸业务员、Lynn 三种身份可见入口的页面大标题与入口名对齐，对不齐的逐个登记原因。

**Non-Goals（具体到文件）**

- `src/lib/navigation/registry.ts` 里除 4 处 `label` 外的任何字段（`description`、`href`、`moduleKey`、`positionPermissions`、`displayOrder`、`NAV_GROUP_META`、`NAV_SECTION_LABEL`、`MOBILE_TOP_CATEGORIES`）。
- `src/lib/navigation/filter.ts`、`route-gate-core.ts`、`trade-layout.ts`、`mobile-tabs.ts`、`src/components/mobile-tab-bar.tsx`。
- `src/lib/i18n/messages.ts`（翻译键名与类型不变，只改两份表里的值）。
- `/help` 的结构、副标题、页尾三块开发者文字（NAV-1b 删）；本 change 只动它的大标题与名称单元格。
- 例外清单里 7 个页面的标题：`/capabilities`、`/operations/intelligence`、`/reports`、`/`、`/sales/home`、`/assistant`、`/trade/chat`。
- 只对 Sunny 老板或平台管理员可见的入口的页面标题（如 `/sales/cockpit`「销售分析」、`/projects`「项目」、`/blinds-orders`「工艺单管理」、`/wechat`「微信消息」、`/memory`「组织知识管理」、`/admin/invite-codes`「邀请码管理」）——任务书只要求核对 Cathy 与 Lynn 可见的入口。
- 站内其他提到入口名字的文字（清单见「审核关注点」Q3）。
- 数据里存的名字：`src/lib/trade/intelligence-service.ts:827` `INTELLIGENCE_CAMPAIGN_NAME = "企业情报"`（按名字查找既有活动，改了会重复建活动）、`src/lib/revenue-spine/source-labels.ts`。
- 接口、Prisma schema、`vercel.json`、权限键、模块、岗位模板。

## Decisions

### D1 取名函数放进 `src/lib/navigation/`，做成不依赖 React 的纯函数

新增 `src/lib/navigation/entry-label.ts`：入参是「带 `label` 与可选 `labelKey` 的入口」与「一份文案表」，有翻译键且文案表有非空值就取它，否则取 `label`。`sidebar.tsx` 的 `itemLabel` 与 `mobile-nav-drawer.tsx:299-302` 的内联写法都删掉，改调它。

- 否决：把 `sidebar.tsx` 的 `itemLabel` 直接 `export` 给另外两处用。`sidebar.tsx` 是 `"use client"` 模块且带一串 hooks 依赖，服务端的 `help-map` 与 `npx tsx` 跑的测试引它会把整个侧栏拖进来。
- 否决：把函数放 `src/lib/i18n/`。它的入参是导航入口，归导航模块；`i18n` 目录只放文案表与语言上下文。

### D2 `/help` 的名称单元格改成客户端小组件，随界面语言取名

`buildHelpMap` 的每个条目多带一个 `labelKey`（`label` 保留，仍是注册表名称，既有测试继续用 `key` 比对）。`/help` 页面把名称那一格交给一个客户端小组件：读当前界面语言的文案表，调 D1 的函数，渲染成原来的链接或纯文字。页面其余部分仍是服务端渲染。

- 否决：服务端直接用中文文案表调取名函数。中文界面下结果正确，但英文界面的成员侧栏是英文名、说明页是中文名，又成了两个名字。
- 否决：把界面语言改存 cookie 让服务端能读。改动面是整个语言机制，超出本 change。
- 代价：首屏服务端输出的是中文名，英文界面的成员在客户端接管后换成英文名（与侧栏现在的行为相同——侧栏也是先中文后切换）。

### D3 中文名的事实源是注册表，翻译表向它对齐，测试守住

把 `zh.ts` 里 18 个翻译键的值改成注册表名称（其中 `work-calendar`、`biz-trade` 两项反过来改注册表，见 D4）。新测试断言：每个带翻译键的入口 `zh[翻译键] === 注册表名称`、`en[翻译键]` 非空。

- 否决：删掉注册表的 `label`，只留翻译键。`route-gate`、`help-map`、十几个测试都读 `label`，10 个入口没有翻译键，改动面远超任务书。
- 否决：以翻译表为准、注册表向它对齐。任务书定名表「默认取注册表名」，且注册表名称是 VIS-1b 时逐条过过的。
- 否决：删掉 62 个中文翻译键、中文界面直接读注册表。`Messages` 类型要求两种语言键齐全，删键要改 `messages.ts` 与英文回退逻辑，收益只是少一份可对不上的表，而测试已经能守住。

### D4 四处改名同时改注册表、中文表、英文表；翻译键名不改

| key | 注册表现名 | 中文表现值 | 定名 | 改哪里 |
|---|---|---|---|---|
| `work-calendar` | 日历 | 预约日历 | 预约日历 | 注册表 |
| `biz-trade` | 外贸 | 海外业务 | 外贸获客 | 注册表 + 中文表 |
| `work-inbox` | 收件箱 | 收件箱 | 微信客服 | 注册表 + 中文表 |
| `biz-trade-intel` | 企业情报 | 企业情报 | 竞品溯源 | 注册表 + 中文表 |

其余 16 项只改中文表的值。翻译键名（如 `nav_wechat_messages` 现在的值变成「微信集成」）不改。

- 否决：顺手把翻译键改成贴合新名字的键名。要同时改 `messages.ts`、两份表与注册表 62 处引用里的若干处，纯改名、没有对外效果，还会让本 PR 的 diff 难审。

### D5 英文名

任务书只说「`en.ts` 同步改对应英文名」，没给具体英文。按中文定名直译，写进 specs「改名入口的英文名称」：

| 翻译键 | 现英文 | 改为 |
|---|---|---|
| `nav_service_inbox` | Inbox | WeChat Service |
| `nav_trade_dashboard` | Global Business | Buyer Prospecting |
| `nav_trade_intelligence` | Company Intelligence | Competitor Tracing |
| `nav_quote_sheet` | Quote Sheet | Quotes |
| `nav_all_quotes` | All Quotes | Quote Records |
| `nav_cockpit` | Sales Analytics | Team Sales Analytics |
| `nav_projects` | Projects | Project List |
| `nav_project_intelligence` | Project Intelligence | Intelligence Room |
| `nav_suppliers` | Suppliers | Supplier Directory |
| `nav_organizations` | Organizations | Members & Organization |
| `nav_ai_memory` | Organization Knowledge | Organization Memory |
| `nav_wechat_messages` | WeChat Messages | WeChat Integration |
| `nav_settings` | Settings | Organization Settings |
| `nav_audit_logs` | Audit Logs | Platform Audit |
| `nav_autopilot_overview` | Autopilot Overview | Overview |
| `nav_autopilot_runs` | Autopilot Runs | Runs |
| `nav_autopilot_evaluations` | Autopilot Evaluations | Evaluations |
| `nav_autopilot_telemetry` | Telemetry Health | Telemetry |

`nav_appointment_calendar`（Appointments）、`nav_invite_codes`（Invite Codes）已与中文定名对应，不改。

- 否决：英文表不动。中文改了名而英文还叫 Inbox / Global Business，英文界面的成员看到的仍是被判定为会带错路的旧名字。

### D6 页面大标题：对齐范围、清单与例外

范围 = 三种测试身份（`mx_cathy`、`mx_trade_rep`、`sales_rep`）侧栏可见入口的并集，共 46 个入口。逐个看了页面与其外壳组件的大标题（`PageHeader title` 或 `<h1>`）。

**改（16 处；前 7 处任务书已列，后 9 处是逐页核对多出来的）**

| 入口 | 页面 | 现标题 | 改为 | 位置 |
|---|---|---|---|---|
| `biz-fulfillment` | `/trade/fulfillment` | 履约控制台 | 履约协同 | `trade/fulfillment/page.tsx:206` |
| `biz-signals` | `/trade/signals` | 页面监控信号 | 市场监测 | `trade/signals/page.tsx:78` |
| `biz-prospects` | `/trade/prospects` | 外贸全部线索 | 线索资产 | `trade/prospects/page.tsx:408` |
| `mgmt-knowledge` | `/knowledge` | 组织知识库 | 知识库 | `knowledge/page.tsx:152` |
| `work-notifications` | `/notifications` | 通知中心 | 待处理事项 | `notifications/page.tsx:208` |
| `biz-trade-import` | `/trade/import` | 展会/名片导入 | 展会导入 | `trade/import/page.tsx:82` |
| `work-inbox` | `/service-inbox` | 客服收件箱 | 微信客服 | `service-inbox/page.tsx:144` |
| `ws-ops` | `/ops` | 今日运营工作台 | 运营中心 | `src/components/ops/ops-workspace-shell.tsx:274`（及 `:250` 加载提示） |
| `nav-suppliers` | `/suppliers` | 供应商 | 供应商库 | `suppliers/page.tsx:184` |
| `mgmt-orgs` | `/organizations` | 组织 | 成员与组织 | `organizations/page.tsx:133` |
| `mgmt-settings` | `/settings` | 设置 | 企业设置 | `settings/page.tsx:119` |
| `growth-hub` | `/operations/growth` | 增长中心 Growth Center | 品牌增长 | `operations/growth/page.tsx:161` |
| `growth-content` | `/operations` | 内容运营 | 内容生产 | `operations/page.tsx:23` |
| `sys-help` | `/help` | 使用说明 · 功能地图 | 使用说明 | `help/page.tsx:18` |
| `biz-all-quotes` | `/sales/quotes` | 全部报价 | 报价记录 | `sales/quotes/page.tsx:207` |
| `biz-quotes` | `/sales/quote-sheet` | 电子报价单（新建态） | 报价 | `sales/quote-sheet/page.tsx:1606`；编辑态「编辑报价单 · vN」不动 |

**已一致，不改（22 个入口）**：`/trade` 外贸获客、`/trade/intelligence` 竞品溯源（改名后自然一致）；`/sales` 客户与商机、`/operations/center` 管理模块、`/capabilities/catalog` 能力目录、`/capabilities/approvals` 审批中心、`/capabilities/governance` 治理中心、`/capabilities/config-health` 配置健康、`/ops/projects` 执行项目、`/sales/performance` 我的业绩、`/settings/email` 邮箱绑定、`/tasks` 我的工作、`/trade/inbox` 询盘收件箱、`/trade/quotes` 外贸报价、`/trade/samples` 寄样、`/trade/products` 货号、`/trade/channels` 消息通道、`/revenue` 收入驾驶舱、`/revenue/today` 今日询盘、`/product-content` 产品内容、`/sales/calendar` 预约日历、`/workforce` AI 任务。（`/tasks?layout=classic` 的旧版视图标题是「任务管理」，不是入口的默认落点，不改。）

**例外，不改（7 个页面 / 8 个入口）**

| 页面 | 入口 | 现状 | 为什么不机械对齐 |
|---|---|---|---|
| `/capabilities` | `capabilities` AI 工作中心 + 子项 `cap-overview` 中台总览 | 标题「企业能力中台」 | 两个入口指向同一页，一个标题对不上两个名字 |
| `/operations/intelligence` | `growth-intel` 营销分析 | 两个页签，其中一个的工作区标题「竞品监听」 | 入口名与页面功能不符，是改入口名还是改页面要按功能定，不是照抄 |
| `/reports` | `growth-reports` 经营简报 | 标题「项目周报」，内容是按项目生成的周报 | 同上 |
| `/` | `work-home` 管理总览 | 没有大标题（岗位总览直接铺开） | 加标题是版面改动 |
| `/sales/home` | `sales-home` 销售首页 | 大标题是问候语，上方小字「Sales Command Center」 | 同上 |
| `/assistant` | `work-assistant` 数字员工 | 对话界面，没有大标题 | 同上 |
| `/trade/chat` | `biz-trade-chat` 外贸 AI 对话 | 对话界面，没有大标题（空态小标题「海外业务协同」） | 同上 |

- 否决：只改任务书列的 7 处。任务书明确要求「逐页核对 Cathy 与 Lynn 可见的其余入口，大标题与入口名不一致的一并对齐」。
- 否决：把例外里的 7 个也硬对齐。`/reports`、`/operations/intelligence` 照抄入口名会让标题与页面内容不符；给对话页和首页加标题超出「改标题」的范围。这 7 个列在「审核关注点」Q2 请拍板。
- 否决：让页面从注册表读标题（真正的单一来源）。16 个页面里多数是各写各的客户端页面，接入要逐页加导航依赖；本 change 用源码断言测试把「标题 = 入口名」守住，成本低一个量级。

### D7 测试：一个新文件，三组断言

`src/lib/navigation/__tests__/entry-naming.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`：

1. **名称一致**：72 项里 62 项带翻译键，中文相等、英文非空；20 项中文定名、18 项英文定名逐项相等；20 个旧名字不再是任何入口的名称。
2. **三处共用**：源码断言 `sidebar.tsx`、`mobile-nav-drawer.tsx`、`/help` 的名称组件都调 D1 的函数；`sidebar.tsx` 不再有自己的 `itemLabel`；抽屉里不再有内联的 `item.labelKey && m[...]`；`/help` 页面不再直接渲染条目的 `label`。
3. **大标题**：一张核对表（入口 key → 源文件 → 期望标题）加一张例外表（入口 key → 原因）；对三种身份的可见入口逐个断言「在核对表里且源码含该标题」或「在例外表里」，两表都不在即失败；例外表恰为 D6 的 8 个入口。

- 否决：把这些断言加进既有 `entry-visibility.test.ts`。那个文件对应 `navigation/entry-visibility` 规格，NAV-1b 还要改它；新能力单独一个测试文件，1a 与 1b 的 diff 不打架。

### D8 `scripts/nav-visual-smoke.mjs` 同步

该脚本 `:168`、`:173`、`:188`、`:192` 在真实页面上找侧栏文字「海外业务」。它不在 `npm test` 与 CI 里（`package.json`、`scripts/*.sh`、`.github/workflows` 都没引用），但改名后会失效，本 change 把这四处改成「外贸获客」。

- 否决：不管它。它是导航的手工冒烟脚本，留着过期断言等于埋雷。

## 任务书「不确定处」里与本 change 有关的条目

| 条目 | 核对结论 |
|---|---|
| Cathy 在生产的实际岗位与企业模块 | 没有生产访问，未核对。仓库里两处口径不同：`src/lib/navigation/__tests__/identity-fixtures.ts:58` 是「老板 + 外贸业务员、企业内 `org_admin`」，`src/lib/authorization/__tests__/mengxin-positions.test.ts:88` 的注释写「Cathy 生产实情：平台 boss + trade_rep + owner」、企业内 `org_member`。对本 change 无影响：定名对所有身份生效，大标题核对用的是测试身份的可见入口；生产若多开了模块，多出来的入口可能有未核对的标题。 |
| 手机底栏的短名是否与定名表冲突 | 核对了 `src/lib/navigation/mobile-tabs.ts:51-82` 全部 12 个短名。没有一个短名是另一个入口的名字。「报价」→ `/sales/quote-sheet` 与定名一致。「日历」→ `/sales/calendar`，定名是「预约日历」，属于简称（同类：「首页」= 销售首页、「客户」= 客户与商机）。按任务书「本期不改」处理，见 Q4。 |
| 其余页面大标题没有逐页看完 | 已对三种身份的 46 个可见入口逐页看完，结果见 D6。Sunny 老板与平台管理员才可见的入口没有核对，列为 Non-Goal。 |

## 与八条硬纪律的关系

1. **零 schema**：遵守。不动 Prisma schema，不写 migration，不往任何 JSON 位写数据。
2. **出站先审批**：不涉及。没有任何发送路径的改动。
3. **禁止第三套队列**：不涉及。
4. **脱敏**：不涉及。不触碰 Muse 通道与金额字段。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。「邮箱绑定」入口名称与页面都不动。
7. **确定性优先**：遵守。取名是查表，零新增 LLM 调用。
8. **测试注册**：遵守。新增 `entry-naming.test.ts` 在同一个 task 里注册进 `scripts/test-all.sh`；`ci/test-registry-baseline.txt` 不增行（`trade-layout.test.ts` 那一行按任务书留给 NAV-1b 删）。

## Risks / Trade-offs

- [Sunny 成员熟悉的名字变了：「电子报价单」→「报价」，页面标题同步变] → 任务书已定为 BREAKING · 文案；上线前在 PR 描述与报告里列全 20 个改名与 16 个标题；U-8 之后报价两项还会再改一次名，届时只改注册表一处，测试会带着其它几处一起失败。
- [改了页面标题，但页面里别处还叫旧名字（如报价单页的提示「保存后可在『全部报价』查看」、增长中心子页的「← 返回增长中心」）] → 本 change 不改，清单在 Q3；拍板并入的话补一条 spec 要求再改。
- [竞品溯源转入线索时建的活动名仍是「企业情报」，梦馨在活动列表里还会看到这个旧名字] → 这是按名字查找的数据，改名需要迁移既有活动，本 change 不动，记入报告。
- [英文界面成员打开 `/help` 时名称先中文后英文闪一下] → 与侧栏现有行为一致；英文界面目前没有实际用户。
- [源码断言测试按字符串找标题，页面重构（如标题改成变量）会误报] → 核对表写明文件与期望字符串，失败信息指到具体入口；这类测试在仓库里已有先例（`entry-visibility.test.ts` 的接线断言）。
- [1a 与 1b 都改 `help/page.tsx`、`help-map.ts`、`sidebar.tsx`] → 1b 依赖 1a，按顺序合并；1a 只动名称相关的行。

## Migration Plan

无数据迁移。合并即生效；回滚 = revert 本 PR。上线顺序按任务书：1a → 1b → 1c；通知梦馨放在三个都上线之后做一次。

## 验证方式

- `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts`：三组断言全过；先在改动前的代码上跑一遍确认会失败（18 处不一致、16 个标题）。
- 受影响的既有测试通过数不变（基线见 tasks.md）：`entry-visibility` 73、`navigation-ia` 64、`navigation-workspace` 34、`position-nav` 101、`trade-layout` 5、`wechat-entry-nav` 19、`tenant-context` 28。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`npm test`、`bash scripts/check-test-registry.sh`。
- `git diff --stat main -- prisma vercel.json ci/test-registry-baseline.txt` 无输出。
- `openspec validate nav-1a-single-name` 通过。
- 真实应用截图（本地起应用，测试身份）：Cathy 的侧栏与 `/help` 并排、Lynn 的侧栏与 `/help` 并排、7 个任务书列出的页面标题，放 `docs/acceptance/nav-1a/`。

## 审核关注点（偏离或补充任务书之处，请拍板）

- **Q1 逐页核对多出的 9 个标题**（D6 表后 9 行）按规则对齐。其中 `/sales/quote-sheet`「电子报价单」→「报价」、`/sales/quotes`「全部报价」→「报价记录」是 Sunny 销售每天用的页面，U-8 之后还要再改一次。推荐：照任务书对齐。
- **Q2 对不齐的 7 个页面**（D6 例外表）本 change 不动。推荐：不动；其中 `/reports` 与 `/operations/intelligence` 是入口名与页面功能不符，另行决定改哪一边。
- **Q3 站内其他提到旧名字的文字**，任务书没覆盖，本 change 默认不改。核对到的：
  - 指向改名入口的链接 / 按钮：`src/components/dashboard/management-dashboard-client.tsx:259`「进入海外业务」；`src/app/(main)/sales/quote-sheet/rough-quote-panel.tsx:327`、`src/components/sales/pending-deposit-banner.tsx:97`「全部报价」；`src/app/(main)/settings/notifications/page.tsx:285`「前往通知中心」；`src/app/(main)/trade/page.tsx:203`「页面监控信号」。
  - 提示语里引用入口名：`sales/quote-sheet/page.tsx:1612`、`rough-quote-panel.tsx:301`「全部报价」；`trade/page.tsx:169`「海外业务」；`operations/center/page.tsx:65`「客服收件箱与发布运营」。
  - 铃铛下拉标题 `src/lib/i18n/zh.ts:139`「通知中心」（页面标题改成「待处理事项」后两处不同名）。
  - 增长中心子页的返回链接「← 返回增长中心」5 处（`operations/growth/{metrics,brand,mmm,audit}/page.tsx`、`marketing/employee/page.tsx:155`）；「送内容运营」按钮（`monitoring-workspace.tsx:676`）。
  - 线索来源标签 `src/lib/revenue-spine/source-labels.ts:15`「企业情报」（`trade/page.tsx:410` 同一来源已写「竞品溯源」）。
  - 推荐：并入 1a，只改上面这些指向本次改名入口或页面的文字，不动数据里存的名字；拍板后补一条 spec 要求与对应断言。
- **Q4 手机底栏「日历」**（→ 预约日历的简称）不改。推荐：不改。
- **Q5 英文名**（D5）是直译，没有来源。推荐：按表执行。
