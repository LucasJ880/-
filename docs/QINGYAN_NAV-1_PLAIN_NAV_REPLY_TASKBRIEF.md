# NAV-1 导航与说明白话化 + 回复入口「看得懂、找得到、回得了」— 任务书

TASKFLOW：新增 Phase N（登记到 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`）：NAV-1a、NAV-1b、NAV-1c 三个 change，一个 change = 一个 PR，按下文「上线顺序」合并。本任务书合并时同步放一份到 `docs/QINGYAN_NAV-1_PLAIN_NAV_REPLY_TASKBRIEF.md`。
需求方：梦馨（使用账号 Cathy，由 Lucas 2026-11-14 转述）：
1. "左栏和右边的指南对不上号，要简易一点。"
2. "有的要写得白话文一点，我都不知道从哪里进去找。"
3. "没地方点击去回复。"

依据（均在 `github.com/LucasJ880/-` main `dd0e99d`（2026-11-12）核对；用仓库自带的 Cathy 测试身份 `mx_cathy`（`src/lib/navigation/__tests__/identity-fixtures.ts:58`，老板 + 外贸业务员、默认梦馨模块）实际跑了 `resolveNavigationTree` 与 `buildHelpMap`，输出与客户截图一致；未登录生产）：
- 侧栏：`src/components/sidebar.tsx`；说明页：`src/app/(main)/help/page.tsx` + `src/lib/navigation/help-map.ts`（VIS-1b 产物）；名称与说明：`src/lib/navigation/registry.ts`（72 项）与 `src/lib/i18n/zh.ts`。
- 两条回复通路已存在且状态互通：询盘收件箱人工发送会作废同商机的待批草稿（`src/lib/trade/outbound-sync.ts`），审批发送会反向写入收件箱时间线（`src/lib/pending-actions/exec-sales-inquiry-reply.ts:192`）。设计记录：`docs/QINGYAN_MENGXIN_FDE_V1_TRADE_OUTBOUND_SYNC.md`。

## 一条规则

**一个入口只有一个名字；说明按「我想做什么」写；看到客户来信的地方就有回复按钮。**

- 名字：侧栏、使用说明、页面大标题三处取同一个名字，来源只有一处。
- 说明：先回答"我要做某件事，点哪里、进去点什么"，再列全部入口；全部入口的顺序与侧栏一致。
- 回复：不新增发信通路，只把入口接到既有的询盘收件箱回复；没有 AI 草稿也能自己写。
- 不减功能：本期只调顺序、名字、文案和入口，任何人改动前能进的页面改动后都还能进。

## Why

**1. 同一个入口有三个名字。**
- 侧栏取翻译表（`sidebar.tsx:49` `itemLabel` → `zh.ts`），说明页取注册表（`help-map.ts:22` `label: item.label`），两边不一致的共 18 项。Cathy 能看到其中 5 项：海外业务 / 外贸、预约日历 / 日历、供应商 / 供应商库、组织 / 成员与组织、设置 / 企业设置。Sunny 销售同样中招：侧栏「电子报价单」「全部报价」，说明页「报价」「报价记录」。
- 页面大标题是第三套：侧栏「海外业务」点进去标题是「外贸获客」；「企业情报」→「竞品溯源」；「履约协同」→「履约控制台」；「市场监测」→「页面监控信号」；「线索资产」→「外贸全部线索」；「知识库」→「组织知识库」；「待处理事项」→「通知中心」；「展会导入」→「展会/名片导入」。

**2. Cathy 的入口太多，精简布局没生效。**
- 她的侧栏有 38 个一级入口加 5 个子项，分 7 组；说明页照抄成 44 行，从「工作区 · 管理总览」讲起，她日常用的在第 4 组。
- 外贸员本有「核心 + 更多」两段式侧栏（`src/lib/navigation/trade-layout.ts`），但判定用的是派生平台角色（`sidebar.tsx:411`）。Cathy 同时绑了老板岗位，派生结果是 `boss`，于是走全量布局；这一点还被测试钉住了（`src/lib/authorization/__tests__/mengxin-positions.test.ts:88-93`「非外贸布局」）。
- 侧栏分组小标题是 10px、30% 透明度（`sidebar.tsx:486`），几乎看不见，而说明页用分组做大标题，更难对上。

**3. 说明是名词解释，不是指路；还有写错的。**
- 现在是"一个入口一句定义"：外贸「外贸业务的总览」、询盘收件箱「海外询盘的收件与分拣」、线索资产「外贸线索与客户资产」。读完不知道回复询盘该点哪个。
- 与页面实际功能不符：企业情报写「目标企业的背景情报」，页面实际是按 UPC / 品牌找候选买家（`trade/intelligence/page.tsx:150`）；履约协同写「外贸订单的履约协同」，页面实际是处理指派工单、传图出图回传微信（`trade/fulfillment/page.tsx:205`）。
- 会带错路：「收件箱 — 客户在各渠道发来的消息，统一回复」（`registry.ts:200`）实际是微信机器人客服队列（`service-inbox/page.tsx:4`），没接微信的企业点进去是空的。想回复询盘的人第一眼会点它。
- 窗饰文案露给家纺客户：日历写「量房、安装与会议日程」。
- 说明页页尾是开发者文字（`help/page.tsx:47-63`）：「组织与项目…Prompt 与知识库」「部署见 docs/DEPLOY_VERCEL.md」「发布前手工回归 docs/QA_P0_CHECKLIST.md」。

**4. 客户来信的地方没有回复按钮。**
- 客户截图是「客户与商机 → 客户详情 → 互动时间线」（`sales/customers/[id]/interaction-timeline.tsx`）。时间线只读，旁边只有「导入对话」「记录」（`page.tsx:1083,1092`）。
- 「CATHY LI · 收到」是"负责人 + 方向"（`interaction-timeline.tsx:43-48`；来信的 `createdBy` 是询盘负责人，`inquiry-intake.ts:187,216`），读起来像 Cathy 已收到。
- 能回复的两处互不相通，客户页也不链过去：
  - 询盘收件箱 `/trade/inbox`：「查看回复草稿」→ 可改 →「发送邮件」。但按钮只在 AI 草稿生成后出现（`trade/inbox/page.tsx:477-508`）；草稿生成中、失败或没有草稿时，卡片上只有「已回复，标记」，没有地方自己写。
  - 今日询盘 `/revenue/today` 与商机详情 `/revenue/[id]`：只能「批准发送 / 拒绝」，不能改内容。
- 商机详情页有开发者文案：输入框占位「记录客户来信内容（触发 CUSTOMER_REPLIED + 重跑 FDE）」（`revenue/[id]/page.tsx:334`）。

## What（三个 change）

### NAV-1a `nav-1a-single-name`：一个入口一个名字

- 侧栏、手机抽屉（`src/components/mobile-nav-drawer.tsx:300`）、说明页改用同一个取名函数（把 `sidebar.tsx` 的 `itemLabel` 提为共用）；说明页不再直接读 `item.label`。
- 新增断言测试：注册表每一项（含子项）有 `labelKey` 时，`zh[labelKey]` 必须等于 `label`；`en[labelKey]` 必须存在且非空。以后改名只改一处，另一处不同步测试就挂。
- 按下表定名（默认取注册表名，三处例外已标出）：

  | key | 侧栏现名 | 说明页现名 | 定名 |
  |---|---|---|---|
  | `work-calendar` | 预约日历 | 日历 | **预约日历**（例外：与页面标题一致） |
  | `biz-trade` | 海外业务 | 外贸 | **外贸获客**（例外：与页面标题、实际功能一致） |
  | `work-inbox` | 收件箱 | 收件箱 | **微信客服**（改名：与「询盘收件箱」区分） |
  | `biz-trade-intel` | 企业情报 | 企业情报 | **竞品溯源**（改名：与页面标题、实际功能一致） |
  | `biz-quotes` | 电子报价单 | 报价 | 报价 |
  | `biz-all-quotes` | 全部报价 | 报价记录 | 报价记录 |
  | `biz-cockpit` | 销售分析 | 团队销售分析 | 团队销售分析 |
  | `nav-projects` | 项目 | 项目列表 | 项目列表 |
  | `nav-project-intel` | 项目智能 | 智能调查室 | 智能调查室 |
  | `nav-suppliers` | 供应商 | 供应商库 | 供应商库 |
  | `mgmt-orgs` | 组织 | 成员与组织 | 成员与组织 |
  | `mgmt-memory` | 组织知识 | 组织记忆 | 组织记忆 |
  | `mgmt-wechat` | 微信消息 | 微信集成 | 微信集成 |
  | `mgmt-settings` | 设置 | 企业设置 | 企业设置 |
  | `plat-invites` | 邀请码管理 | 邀请码 | 邀请码 |
  | `plat-audit` | 审计日志 | 平台审计 | 平台审计 |
  | `autopilot-overview / -runs / -evaluations / -telemetry` | Autopilot 总览 / Autopilot Runs / Autopilot Evaluations / Telemetry Health | 总览 / Runs / Evaluations / Telemetry | 取注册表名 |

- 页面大标题与入口名对齐（改页面标题，不改路由）：`/trade/fulfillment` → 履约协同；`/trade/signals` → 市场监测；`/trade/prospects` → 线索资产；`/knowledge` → 知识库；`/notifications` → 待处理事项；`/trade/import` → 展会导入；`/service-inbox` → 微信客服。`/trade`（外贸获客）、`/trade/intelligence`（竞品溯源）改名后自然一致。
- 实现者逐页核对 Cathy 与 Lynn 可见的其余入口，大标题与入口名不一致的一并对齐，清单写进报告。
- `en.ts` 同步改对应英文名。

### NAV-1b `nav-1b-focused-sidebar-task-help`：常用入口置顶 + 白话说明页

**侧栏两段式**
- 判定改为判定输入的纯函数（侧栏与说明页共用，不再读派生平台角色）：
  - 岗位模式：外贸模块已开 ∧ 持 `trade.read` ∧ 企业未开窗饰模块 ∧ 非平台 `super_admin`；
  - 旧模式：平台角色 `trade`（与现状一致）。
- 「常用」段固定顺序（缺项跳过）：今日询盘 `biz-revenue-today` → 询盘收件箱 `biz-inbox` → 线索资产 `biz-prospects` → 外贸报价 `biz-trade-quotes` → 寄样 `biz-trade-samples` → 货号 `biz-trade-products` → 客户与商机 `sales-crm` → 知识库 `mgmt-knowledge`。清单是一个代码常量，梦馨确认后要调整只改这一处。
- 其余全部进「更多」（默认折叠，展开状态按浏览器记住，沿用现有 `qingyan-sidebar-trade-more`）。展开后按原分组排列并带分组小标题，不再是按 `displayOrder` 混排的一长串。
- 段标题「外贸工作」改为「常用」。分组小标题提高可读性（字号与对比度不低于未选中的入口文字的次一级，按 `DESIGN.md`）。
- 侧栏可达入口集合不变：测试断言 Cathy 改动前后的入口 key 集合相等（常用 ∪ 更多 = 原全量）。

**说明页 `/help`**
- 顶部新增「我想做什么」：三列（我想… / 点哪里 / 进去后）。内容是代码常量，每行绑定一个入口 key；该入口对当前用户不可见时整行不出现；一行都没有时整节不出现。「点哪里」的名字走 NAV-1a 的取名函数并链接到该入口。外贸首批 12 行：

  | 我想… | 点哪里 | 进去后 |
  |---|---|---|
  | 看今天要处理什么 | 今日询盘 | 四栏：新询盘、回复超时、待审批回复、样品与报价到期 |
  | 回复买家 | 询盘收件箱 | 找到买家，点「查看回复草稿」或「写回复」，改好后点「发送邮件」 |
  | 批准 AI 写好的回复 | 今日询盘 | 在「待审批回复」里先点「查看草稿」，再点「批准发送」；不想用就去询盘收件箱自己写 |
  | 已经在邮箱或 WhatsApp 回过了 | 询盘收件箱 | 点「已回复，标记」，系统不再催 |
  | 查一个买家的全部往来 | 线索资产 | 点开买家，看「对话记录」 |
  | 给买家报价 | 外贸报价 | 新建报价；询盘收件箱里每个买家也有「新建报价」 |
  | 寄样并盯回音 | 寄样 | 新建寄样；只记底账、不自动发邮件，寄出 5 个工作日后提醒跟进 |
  | 查货号、价格、起订量 | 货号 | 在售货号、FOB 价、起订量和交期 |
  | 展会回来批量录名片 | 展会导入 | 上传 CSV 或 Excel |
  | 让 AI 回得更准 | 知识库 | 上传公司资料和常见问答 |
  | 绑定发信邮箱 | 邮箱绑定 | 按页面提示绑定 |
  | 加同事、调岗位 | 成员与组织 | 在成员列表里操作 |

- 「全部入口」放在下面，顺序与分段和该用户的侧栏一致：两段式用户先「常用」再「更多」（按分组）；其他用户按分组（现状）。
- 删除页尾三块开发者文字（`help/page.tsx:46-66` 的「组织与项目」「部署」「发布前手工回归」）。
- 页首副标题改为：「先看『我想做什么』；找不到再看下面的全部入口。」

**入口说明改白话**（每条不超过 40 字，现有测试 `entry-visibility.test.ts:245` 会校验；已逐条核对长度与页面实际功能）

| key | 现在 | 改为 |
|---|---|---|
| `biz-revenue-today` | 今天进来的询盘 | 今天要处理的：新询盘、超时没回的、等你批的回复 |
| `biz-inbox` | 海外询盘的收件与分拣 | 所有买家来信；在这里看 AI 草稿、改好后发出回复 |
| `biz-prospects` | 外贸线索与客户资产 | 全部买家名单；点开看往来记录、背景调查并报价 |
| `biz-trade-quotes` | 外贸报价单 | 做报价单、发给买家、看对方有没有回 |
| `biz-trade-samples` | 寄样记录与跟进 | 登记寄出的样品，到期提醒你跟进买家 |
| `biz-trade-products` | 产品货号与资料 | 在售货号、FOB 价、起订量和交期；不记库存 |
| `biz-trade-chat` | 与外贸 AI 助手对话 | 有外贸问题直接问 AI 助手 |
| `biz-trade` | 外贸业务的总览 | 找海外买家：AI 帮你发现、调查和发开发信 |
| `biz-trade-intel` | 目标企业的背景情报 | 输入品牌或产品线索，AI 找出可能的买家和渠道 |
| `biz-fulfillment` | 外贸订单的履约协同 | 处理指派给你的客户工单：传图、AI 出图、回传客户 |
| `biz-trade-import` | 展会名片与线索导入 | 上传名片表格（CSV / Excel），批量建买家 |
| `biz-signals` | 市场动态与机会监测 | 监控目标网页的变化，提示可能的商机（需人工核对） |
| `biz-channels` | 外贸消息通道的配置 | 接通 WhatsApp、微信等，让买家消息进到青砚 |
| `biz-revenue` | 询盘到收入的整体漏斗与时效 | 从询盘到成交，每一步有多少单、卡在哪 |
| `sales-crm` | 客户与商机的管理和跟进 | 客户档案，以及每个客户谈到哪一步 |
| `mgmt-knowledge` | 企业资料与常见问答，供 AI 引用 | 上传公司资料和常见问答，AI 回复时会引用 |
| `work-notifications` | 需要你处理或知晓的提醒 | 系统给你的提醒：要你处理或知道的事 |
| `work-inbox` | 客户在各渠道发来的消息，统一回复 | 客户发到企业微信机器人的消息，在这里回 |
| `work-calendar` | 量房、安装与会议日程 | 预约与日程安排 |

其余入口的说明本期不改。

**测试**
- `trade-layout.test.ts`：新判定的真值表（模块 × 键 × 窗饰模块 × super_admin × 旧模式）；「常用」顺序；「更多」按分组；两段互斥且覆盖全部可见项。该文件目前在 `ci/test-registry-baseline.txt:28`，本次改动时注册进 `scripts/test-all.sh` 并从基线删除。
- `mengxin-positions.test.ts:88-93`：Cathy（老板 + 外贸业务员）改为断言两段式；管理层身份与首页停在 `/` 的断言不变。
- `entry-visibility.test.ts`：说明页「全部入口」顺序 = 侧栏顺序；「我想做什么」每行的 key 都在注册表里、目标不可见时不出现；页面源码不含 `DEPLOY_VERCEL`、`QA_P0_CHECKLIST`。
- `position-nav.test.ts` 的 Sunny 各岗位侧栏 key 快照不变。

### NAV-1c `nav-1c-reply-entry`：看到来信就能回

**客户详情 · 互动时间线**
- 客户详情接口（`src/app/api/sales/customers/[id]/route.ts:25`）给每条来信互动补一个只读字段：能否回复及回复目标（线索 id）。解析方式与既有反向镜像相同：互动的商机 → `convertedToSalesOpportunityId` 等于该商机的线索（`exec-sales-inquiry-reply.ts:228-234`）。只在「外贸模块已开 ∧ 当前用户持 `trade.manage` ∧ 询盘收件箱对其放行」时返回目标，否则为空（遵守 spec navigation/entry-visibility「站内链接与按钮只在目标放行时出现」）。零 schema。
- 有目标的来信条目显示「回复」按钮；时间线页签右上「导入对话」「记录」旁加「回复客户」（取最近一条有目标的来信）。点击跳到询盘收件箱并直接打开该买家的回复窗口。
- 文案：来信显示「客户来信」，发出显示「我方发出」；人名前加「经手人：」。不再出现「人名 · 收到」。
- 没有目标的互动（窗饰客户、手工记录）界面不变。

**询盘收件箱 `/trade/inbox`**
- 支持深链：带线索 id 或商机 id 打开时，定位到该买家并打开回复窗口；该会话不在当前筛选、90 天窗口或 200 条上限内时也要能打开（`src/lib/trade/inbox-service.ts:129-171`、`src/app/api/trade/inbox/route.ts:22-23`）。
- 每张会话卡片始终有回复按钮：有 AI 草稿时是「查看回复草稿」（现状）；草稿生成中、失败或没有时是「写回复」，打开同一个窗口、正文留空、主题预填 `Re: 〈最后一封来信主题〉`。已回复的会话按钮改为「再写一封」。
- 回复窗口在编辑框上方显示买家最后一封来信的主题与全文（只读），边看边回。
- 发送仍走既有 `POST /api/trade/inbox/[prospectId]/reply`（人工点击发送；`docs/QINGYAN_MENGXIN_FDE_V1_TRADE_OUTBOUND_SYNC.md` 已定「Trade sends stay human-click actions」）。唯一改动：该路由现在把留底消息一律记为 AI 草稿（`aiDraft: true`），改为只在正文来自 AI 草稿时记 true，手写的记 false。

**审批面（今日询盘、商机详情）**
- 每张待批草稿卡加一行链接：「不想用这份？去询盘收件箱自己写（发出后这份草稿自动作废）」→ 同一深链。作废是既有行为（`outbound-sync.ts` `supersedePendingInquiryReplies`），本期不改。
- 商机详情「尚无草稿」处加「去询盘收件箱写回复」链接。
- 商机详情输入框占位（`revenue/[id]/page.tsx:334`）改为：「把买家在别处发来的内容贴到这里，AI 会重新起草回复」。

**测试**（全部注册进 `scripts/test-all.sh`）
- 纯函数：回复目标解析（有商机有线索 / 有商机无线索 / 无商机 / 无 `trade.manage` / 外贸模块未开 → 有或空）；时间线文案映射。
- 隔离库：网站询盘进线 → 客户详情接口对该来信返回目标；无 AI 草稿的线索经回复路由发出手写回复 → 留底消息 `aiDraft=false`、会话变已回复、同商机待批草稿被作废、客户时间线多一条「我方发出」；深链打开一个超出默认窗口的会话能取到。
- 源码断言：`trade/inbox/page.tsx` 的回复按钮不再以 AI 草稿存在为前提。

## 拍板结果 · NAV-1（2026-11-14，Lucas："可以，按照你推荐的做吧"）

1. Cathy 的常用入口取推荐的 8 项：今日询盘、询盘收件箱、线索资产、外贸报价、寄样、货号、客户与商机、知识库，其余进「更多」。
2. 回复以询盘收件箱为主（可改可发）；今日询盘保留为老板审批视图。
3. 三条改法（名称统一、菜单与说明页精简、回复入口）全部执行。

以下是为落实上面三条由任务书补的默认值，未单独问过，有异议在 `/opsx:propose` 回传审核时改：
- 四处改名：收件箱 → 微信客服；海外业务 → 外贸获客；企业情报 → 竞品溯源；日历 → 预约日历。
- 两段式判定加「企业未开窗饰模块」这一条，避免 Sunny 将来开外贸模块时老板的侧栏被改成外贸布局。
- 「外贸 AI 对话」「外贸获客」从常用段移到「更多」（纯外贸业务员的侧栏也随之变化）。

## Impact

- 修改（1a）：`src/components/sidebar.tsx`、`src/components/mobile-nav-drawer.tsx`、`src/lib/navigation/help-map.ts`、`src/app/(main)/help/page.tsx`、`src/lib/navigation/registry.ts`（四处 label）、`src/lib/i18n/zh.ts` / `en.ts`、上表列出的页面标题、新增一个名称一致性测试。
- 修改（1b）：`src/lib/navigation/trade-layout.ts`、`sidebar.tsx`、`help-map.ts`、`help/page.tsx`、`registry.ts`（说明文案）、新增「我想做什么」常量文件、`trade-layout.test.ts`、`mengxin-positions.test.ts`、`entry-visibility.test.ts`、`scripts/test-all.sh`、`ci/test-registry-baseline.txt`（删一行）。
- 修改（1c）：`src/app/api/sales/customers/[id]/route.ts`、`sales/customers/[id]/interaction-timeline.tsx` / `page.tsx` / `types.ts`、`trade/inbox/page.tsx`、`src/app/api/trade/inbox/route.ts`、`src/lib/trade/inbox-service.ts`、`src/app/api/trade/inbox/[prospectId]/reply/route.ts`（`aiDraft` 标记）、`revenue/today/page.tsx`、`revenue/[id]/page.tsx`。
- 八条硬纪律：1（零 schema）遵守，回复目标读时计算；2（出站先审批）不新增出站通路，沿用既有人工点击发送的收件箱回复与既有审批发送；3（不新增队列）不涉及；4（脱敏）不涉及；5 不涉及；6（邮箱分离）不动发信实现；7（确定性优先）零新增 LLM 调用，「写回复」留空不调模型；8（测试注册）每个 change 遵守，并消掉 `trade-layout.test.ts` 的历史欠账。
- 不新增权限键、模块、岗位模板；路由门映射表不变（不新增页面路由）。

## 上线顺序与 BREAKING

1. NAV-1a（BREAKING · 文案：所有企业的侧栏有若干入口改名，见定名表；Sunny 销售的「电子报价单 / 全部报价」变为「报价 / 报价记录」）。
2. NAV-1b（BREAKING · 布局：梦馨持外贸键的成员侧栏变为「常用 + 更多」；纯外贸业务员的常用段内容变化）。
3. NAV-1c（无 BREAKING）。

1a、1c 互不依赖，可并行；1b 依赖 1a 的取名函数。每个 change 合并后 archive 一个小 PR，更新 Phase N 状态列，各出一份报告 `docs/QINGYAN_NAV-1a_REPORT.md` 等。

上线后通知梦馨一次：入口没有少，常用的在最上面，其余在「更多」；改了名字的四个入口。

## Out of scope

- 隐藏或下线任何入口（运营中心、执行项目、管理模块、微信客服、预约日历、销售首页、我的业绩对梦馨是否有用，见「不确定处」）。
- 手机抽屉与底栏的排序（本期只统一名字）。
- 窗饰企业的「我想做什么」内容（见后续队列 NAV-2）。
- 在审批卡里直接改草稿、把待批草稿带进收件箱编辑框（见后续队列 NAV-3）。
- 合并两套 AI 草稿（收件箱分析草稿与审批草稿）为一套。
- 英文界面的完整翻译（只同步本次改名的键）。
- U-8「报价工作台 / 报价列表」命名（另立；届时只改一处）。
- MAIL-1 / MAIL-2 的邮箱读信与来信提醒（另一份任务书；其「让助手读这封信」入口与本期的「回复」按钮都落在客户时间线条目上，后合并的一方负责排版共存）。

## 验收

用 VIS-1e「以岗位预览」在梦馨企业勾选老板 + 外贸业务员核对；发信类步骤在 staging 用测试买家邮箱做。

**Cathy（老板 + 外贸业务员）**
- 侧栏第一段「常用」依次是：今日询盘、询盘收件箱、线索资产、外贸报价、寄样、货号、客户与商机、知识库；其下「更多」默认折叠，展开后按分组排列、带分组标题；改动前能点到的入口一个不少。
- `/help` 第一屏是「我想做什么」12 行；任取一行，「点哪里」的名字在侧栏里能原样找到，点击到达的页面大标题也是这个名字。
- `/help`「全部入口」的顺序与侧栏逐项一致；页面没有「部署」「发布前手工回归」「Prompt」字样。
- 侧栏没有「海外业务」「企业情报」「收件箱」，对应为「外贸获客」「竞品溯源」「微信客服」。
- 客户与商机 → 打开一位由网站询盘建档的客户 → 互动时间线里该来信显示「客户来信 · 经手人：…」和「回复」按钮；点击后进入询盘收件箱并弹出该买家的回复窗口，窗口上方是买家原文。
- 找一条没有 AI 草稿的询盘：卡片上有「写回复」；写两句点「发送邮件」→ 测试邮箱收到；会话显示已回复；客户时间线多一条「我方发出」；今日询盘里该商机原有的待批草稿消失。
- 今日询盘的待批草稿卡上有「不想用这份？去询盘收件箱自己写」的链接，点击到达同一买家的回复窗口。

**梦馨纯外贸业务员（`trade_rep`）**
- 常用段为上面 8 项中她可见的那些（没有「客户与商机」时跳过）；「外贸 AI 对话」「外贸获客」在「更多」里。

**Lynn（Sunny `sales_rep`）**
- 侧栏入口集合与改动前相同，布局仍按分组；「电子报价单 / 全部报价」显示为「报价 / 报价记录」，与 `/help` 一致。
- `/help` 没有「我想做什么」一节（本期无窗饰内容），没有开发者页尾。
- 客户详情时间线没有「回复」按钮，文案为「客户来信 / 我方发出 · 经手人：…」。

**Lucas（`super_admin`）**
- 在梦馨企业仍是全量分组布局。

**工程**
- `npm run test:ci`、`npm run typecheck` 通过；新增与改动的测试全部在 `scripts/test-all.sh` 注册；`ci/test-registry-baseline.txt` 少一行、无新增。
- Prisma schema 无 diff；`vercel.json` 无 diff；无新增 LLM 调用点。
- `openspec validate <change>` 通过；specs 增量覆盖：入口名称单一来源、两段式判定与常用清单、说明页结构与「我想做什么」可见规则、回复目标的可见条件、收件箱深链与无草稿回复、时间线文案。

## 不确定处（实现前先核对，结果写进各自的 design.md）

- Cathy 在生产的实际岗位与企业模块：本任务书按仓库测试身份（老板 + 外贸业务员、`org_admin`、默认梦馨模块）推算，截图顺序与之吻合；生产若改过模块或岗位，入口集合会不同。
- 常用 8 项未经梦馨本人确认；上线前请 Lucas 向梦馨确认一次，调整只改常量。
- 运营中心、执行项目、管理模块、微信客服、预约日历、销售首页、我的业绩对梦馨是否有实际用途不清楚；本期只折进「更多」。
- 截图里两条 10 月的测试询盘在生产是否还有草稿、是否在收件箱 90 天窗口内，未核对。
- 手机底栏（`src/components/mobile-tab-bar.tsx`、`src/lib/navigation/mobile-tabs.ts`）用的是自己的短名（任务 / 总览 / 会计等），本期不改；若其中有与定名表冲突的，并入 1a。
- 除定名表列出的页面外，其余页面大标题只抽查了有 `PageHeader` 的页面，没有逐页看完。
- 客户详情接口一次取 50 条互动，逐条解析回复目标的查询成本未评估；按商机 id 批量查一次即可，写进 design。

---

## 附录 · 后续队列（不属于本任务书的 change）

| ID | Why | What | 前置 |
|---|---|---|---|
| NAV-2 窗饰「我想做什么」 | Sunny 的说明页本期只统一了名字，没有按任务指路 | 给销售、安装、会计、出单各写 6–8 行，按钮名逐页核对 | NAV-1b |
| NAV-3 审批草稿可改 | 今日询盘只能批准或拒绝，想小改一句也得去收件箱重写 | 从待批草稿卡进入收件箱时预填这份草稿的主题与正文；发出后原草稿按既有规则作废 | NAV-1c；核对草稿载荷里是否存有可直接复用的原文 |
| NAV-4 按企业隐藏用不到的入口 | 「更多」里仍有与梦馨业务无关的入口 | 向梦馨逐项确认后，按模块或企业设置隐藏 | 「不确定处」第三条有结论 |
| NAV-5 手机端常用置顶 | 手机抽屉仍按全量分组 | 抽屉与底栏沿用同一份常用清单 | NAV-1b |
