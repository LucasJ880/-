# Proposal：常用入口置顶 + 白话说明页（NAV-1b）

TASKFLOW：NAV-1b（Phase N；任务书 `docs/QINGYAN_NAV-1_PLAIN_NAV_REPLY_TASKBRIEF.md` §NAV-1b，Lucas 2026-11-14 拍板「常用 8 项取推荐」「三条改法全部执行」）。依赖 NAV-1a（#453 已合并，取名函数 `navEntryLabel` 与能力 `navigation/entry-naming`）。核对基线：main `d46730e`（2026-11-15，含 NAV-1a）；任务书引用的文件相对 `dd0e99d` 只有 NAV-1a 自己改过的那些。四件套审核：Lucas 2026-11-15「按照你推荐的走」，design「审核关注点」Q1–Q6 全部按推荐，Q4 并入本 change。推送时 main 已到 `982527b`（含 NAV-1a 归档 #457 与招投标线 #454），本 change 涉及的文件没有再变。

## Why

Cathy 的侧栏有 38 个一级入口，日常用的排在第四组，本该给外贸员的「常用 + 更多」布局因为她同时是老板而没生效；说明页是「一个入口一句名词解释」，读完不知道回复询盘该点哪个。把常用的 8 项置顶、其余收进「更多」，说明页先回答「我想做什么 → 点哪里 → 进去后点什么」。

## What Changes

**侧栏两段式（BREAKING · 布局）**
- 改两段式判定为按判定输入的纯函数，侧栏与说明页共用，不再读岗位派生的平台角色：岗位模式下 = 外贸模块已开 ∧ 持 `trade.read` ∧ 企业未开窗饰模块 ∧ 非平台 super_admin；旧模式下 = 平台角色 `trade`（与现状相同）。
- 改「常用」段为固定 8 项、固定顺序（缺项跳过）：今日询盘 → 询盘收件箱 → 线索资产 → 外贸报价 → 寄样 → 货号 → 客户与商机 → 知识库。清单是一个代码常量。
- 改「更多」：其余入口全部在这里，默认折叠，展开状态按浏览器记住（沿用现有存储键）；展开后按原分组排列并带分组小标题，不再是一长串混排。
- 改第一段标题「外贸工作」为「常用」（英文 Trade Work → Frequently Used）。
- 新增：当前页面的入口在「更多」里时，「更多」在本次访问中自动展开，不改浏览器里记住的展开状态；仍可手动收起（Q4，Lucas 2026-11-15 并入）。
- 改侧栏分组小标题的字号与颜色为 12px、侧栏弱化色（`DESIGN.md` 登记的分组标题色），对所有企业、两种布局都生效。
- 保持可达入口集合不变：任何身份改动前能在侧栏点到的入口，改动后都还在（常用 ∪ 更多 = 原全量）。
- 梦馨持外贸键的成员（含 Cathy）侧栏变为两段式；纯外贸业务员的第一段由「询盘收件箱、线索资产、外贸报价、寄样、外贸 AI 对话、外贸获客、知识库」变为「今日询盘、询盘收件箱、线索资产、外贸报价、寄样、货号、知识库」，「外贸 AI 对话」「外贸获客」进「更多」。

**说明页 `/help`**
- 新增顶部「我想做什么」：三列（我想… / 点哪里 / 进去后），外贸首批 12 行，每行绑定一个入口；该入口对当前用户不可见时整行不出现，一行都没有时整节不出现。「点哪里」显示入口名称（NAV-1a 的取名函数）并链接到该入口。
- 改「全部入口」的顺序与分段，与该用户的侧栏一致：两段式用户先「常用」再「更多」（按分组）；其他用户按分组（现状）。
- 删页尾三块开发者文字（「组织与项目」「部署」「发布前手工回归」）。
- 改页首副标题：有「我想做什么」一节时为「先看『我想做什么』；找不到再看下面的全部入口。」，没有时保持现在的「你在侧栏能看到的全部入口，以及每个入口是做什么的。」

**入口说明改白话（BREAKING · 文案）**
- 改 19 个入口的一句说明（每条不超过 40 字，清单见 specs）。其中 `work-calendar`、`sales-crm`、`work-inbox`、`work-notifications`、`mgmt-knowledge` 五条 Sunny 的成员也看得到。

**测试**
- 重写 `trade-layout.test.ts`（判定真值表、常用顺序、更多按分组、两段互斥且覆盖全部可见项、Cathy 入口集合不变），注册进 `scripts/test-all.sh` 并从 `ci/test-registry-baseline.txt` 删掉它那一行。
- 改 `mengxin-positions.test.ts` 里 Cathy 的断言为两段式；改 `trade-recipients.test.ts:152` 对侧栏源码的断言；扩 `entry-visibility.test.ts`（全部入口顺序 = 侧栏顺序、「我想做什么」可见规则、页面不含开发者文字）。

## Capabilities

### New Capabilities
- `navigation/focused-sidebar`: 侧栏「常用 + 更多」两段式——谁用、常用清单与顺序、更多的折叠与分组、入口集合不变、分组小标题的可读性。

### Modified Capabilities
- `navigation/entry-visibility`: 「/help 功能地图从可见导航生成」改为与侧栏同分段同顺序，并删去对旧页尾的保留；新增「我想做什么」的可见规则与内容、副标题、页面不含开发者文字、19 条入口说明。

## Impact

- 代码：`src/lib/navigation/trade-layout.ts`（判定、常用清单、分区）、`src/components/sidebar.tsx`、`src/lib/navigation/help-map.ts`、`src/app/(main)/help/page.tsx`、`src/lib/navigation/registry.ts`（19 条 `description`）、新增 `src/lib/navigation/help-tasks.ts`（「我想做什么」常量与过滤）、`src/lib/i18n/zh.ts` / `en.ts`（`nav_trade_primary` 的值）。
- 测试：`trade-layout.test.ts`、`mengxin-positions.test.ts`、`trade-recipients.test.ts`、`entry-visibility.test.ts`；`entry-naming.test.ts`（NAV-1a）对 `/help` 页面源码的一条断言随页面结构调整；`scripts/test-all.sh`、`ci/test-registry-baseline.txt`（删一行）。`position-nav.test.ts` 的 Sunny 各岗位侧栏 key 快照不变。
- 接口、数据库、权限键、路由门映射表、模块、岗位模板、入口的可见条件：不动。
- Muse：不触碰 `muse-bridge`，无受影响意图。
- 上线后可见变化：梦馨持外贸键成员的侧栏布局；所有企业的侧栏分组小标题样式；`/help` 页面结构；19 条说明文字。没有开关，合并即生效；回滚 = revert。

## Out of scope

- 隐藏或下线任何入口（NAV-4）；入口的可见条件。
- 手机抽屉与底栏的排序（NAV-5）；本 change 不动 `mobile-nav-drawer.tsx`、`mobile-tabs.ts`。
- 窗饰企业的「我想做什么」内容（NAV-2）；Lynn 的 `/help` 本期没有这一节。
- 回复入口与「写回复」按钮（NAV-1c）。「我想做什么」里提到「写回复」的两行，本 change 只写现在已有的按钮，NAV-1c 合并时补全（见 design D6）。
- 其余 53 个入口的说明文字；英文界面的说明翻译。
- 侧栏首屏先按全量分组渲染、取到企业信息后才切成两段式的闪动（既有行为，侧栏的判定输入是浏览器里取的）。
- NAV-1a 报告 §7 列的 13 处旧叫法。
