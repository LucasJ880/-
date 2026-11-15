# NAV-1a 报告：一个入口一个名字

change：`nav-1a-single-name`（任务书 `docs/QINGYAN_NAV-1_PLAIN_NAV_REPLY_TASKBRIEF.md` §NAV-1a；四件套 Lucas 2026-11-15 审核通过，design「审核关注点」Q1–Q5 全部按推荐，Q3 并入）。基线 main `dd0e99d`；开 PR 后发现 main 已前移到 `a747467`，已合并进本分支（见 §8）。零 schema、零出站、零 LLM、不动权限与路由门。

| 项 | 值 |
|---|---|
| 状态 | #453，2026-11-15 合并；archive `openspec/changes/archive/2026-11-15-nav-1a-single-name`；没有开关，已随合并生效 |
| 新能力 | `navigation/entry-naming`（8 条要求），已归档进 `openspec/specs/navigation/entry-naming/spec.md` |
| 新测试 | `src/lib/navigation/__tests__/entry-naming.test.ts`，31 项；`scripts/test-all.sh:248`「入口名称单一来源（NAV-1a）」，`scripts/test-ci-unit.sh:157` |
| 截图 | `docs/acceptance/nav-1a/01–16`（本机临时库 + `next dev`，虚构企业与账号） |
| BREAKING | 文案：所有企业侧栏与使用说明里 20 个入口名称、16 个页面大标题、20 处站内文字 |

## 1. 用户现在会怎么看到

- **侧栏、手机抽屉、使用说明三处同名。** 以前侧栏读翻译表、说明页读注册表，72 个入口里 18 个对不上；现在三处调同一个取名函数。
- **Cathy（梦馨老板 + 外贸业务员）**：侧栏里「海外业务」→「外贸获客」、「企业情报」→「竞品溯源」、「收件箱」→「微信客服」；「供应商」→「供应商库」、「组织」→「成员与组织」、「设置」→「企业设置」。`/help` 里是同一批名字。
- **点进去的页面大标题也是这个名字。** 例如侧栏点「履约协同」，页面标题不再是「履约控制台」；「市场监测」不再是「页面监控信号」；「线索资产」不再是「外贸全部线索」；「待处理事项」不再是「通知中心」。
- **Lynn（Sunny 销售）**：侧栏「电子报价单 / 全部报价」→「报价 / 报价记录」，`/help` 相同，两个页面的大标题相同；编辑已保存的报价单时标题仍是「编辑报价单 · vN」。
- **页面里指路的文字跟着改了**：「进入外贸获客」「前往待处理事项」「返回品牌增长」「保存后可在『报价记录』查看」；铃铛下拉标题是「待处理事项」；由竞品溯源转入的线索，来源显示「竞品溯源」。
- **英文界面**：使用说明里的入口名现在跟侧栏一样是英文（以前恒为中文）；一句说明仍是中文。

## 2. 改了什么

- **取名函数** `src/lib/navigation/entry-label.ts` `navEntryLabel(入口, 文案表)`：有翻译键且文案表有非空值取它，否则取注册表名称。纯函数，不依赖 React。
- **三处接线**：`src/components/sidebar.tsx` 删掉自己的 `itemLabel`；`src/components/mobile-nav-drawer.tsx` 删掉内联写法；`src/lib/navigation/help-map.ts` 的条目带上翻译键；`src/app/(main)/help/page.tsx` 的名称单元格换成客户端小组件 `help/entry-name.tsx`（界面语言只存在浏览器里，服务端取不到）。
- **定名**：`registry.ts` 4 处名称、`zh.ts` 19 个翻译键、`en.ts` 18 个翻译键的值；翻译键名不变。
- **页面大标题** 16 处（§4）、**站内文字** 20 处（§6）。
- **`scripts/nav-visual-smoke.mjs`**：四处找侧栏文字「海外业务」改为「外贸获客」。

代码、脚本与测试共 44 个文件（新增 3 个：取名函数、名称组件、测试），另有本报告与截图 16 张。

## 3. 改名清单（20 个入口）

「Sunny 谁会看到」列按仓库测试身份（真实岗位模板）实跑侧栏得出；「—」= 窗饰企业看不到这个入口。

| key | 侧栏原名 | 说明页原名 | 定名 | 英文 | Sunny 谁会看到 |
|---|---|---|---|---|---|
| `work-calendar` | 预约日历 | 日历 | 预约日历 | Appointments（不变） | 销售、合价、老板（侧栏不变，说明页由「日历」变「预约日历」） |
| `work-inbox` | 收件箱 | 收件箱 | **微信客服** | WeChat Service | 老板、招投标、运营、会计、安装、出单（销售与合价看不到） |
| `biz-trade` | 海外业务 | 外贸 | **外贸获客** | Buyer Prospecting | —（未开外贸模块） |
| `biz-trade-intel` | 企业情报 | 企业情报 | **竞品溯源** | Competitor Tracing | — |
| `biz-quotes` | 电子报价单 | 报价 | 报价 | Quotes | **销售、合价、老板** |
| `biz-all-quotes` | 全部报价 | 报价记录 | 报价记录 | Quote Records | **销售、合价、老板** |
| `biz-cockpit` | 销售分析 | 团队销售分析 | 团队销售分析 | Team Sales Analytics | 老板 |
| `nav-projects` | 项目 | 项目列表 | 项目列表 | Project List | 老板、招投标 |
| `nav-project-intel` | 项目智能 | 智能调查室 | 智能调查室 | Intelligence Room | 老板、招投标 |
| `nav-suppliers` | 供应商 | 供应商库 | 供应商库 | Supplier Directory | 老板、招投标 |
| `mgmt-orgs` | 组织 | 成员与组织 | 成员与组织 | Members & Organization | 老板、招投标、运营、会计、安装、出单 |
| `mgmt-memory` | 组织知识 | 组织记忆 | 组织记忆 | Organization Memory | 平台 super_admin |
| `mgmt-wechat` | 微信消息 | 微信集成 | 微信集成 | WeChat Integration | 微信入口开关打开时才有（现为关） |
| `mgmt-settings` | 设置 | 企业设置 | 企业设置 | Organization Settings | 老板、招投标、运营、会计、安装、出单 |
| `plat-invites` | 邀请码管理 | 邀请码 | 邀请码 | Invite Codes（不变） | 平台 super_admin |
| `plat-audit` | 审计日志 | 平台审计 | 平台审计 | Platform Audit | 平台 super_admin |
| `autopilot-overview` | Autopilot 总览 | 总览 | 总览 | Overview | 开了 Autopilot 的账号 |
| `autopilot-runs` | Autopilot Runs | Runs | Runs | Runs | 同上 |
| `autopilot-evaluations` | Autopilot Evaluations | Evaluations | Evaluations | Evaluations | 同上 |
| `autopilot-telemetry` | Telemetry Health | Telemetry | Telemetry | Telemetry | 同上 |

前 4 行是任务书定的改名或例外；其余 16 行取注册表名称。

## 4. 页面大标题（16 处）

任务书列出的 7 处：

| 页面 | 原标题 | 现标题 |
|---|---|---|
| `/trade/fulfillment` | 履约控制台 | 履约协同 |
| `/trade/signals` | 页面监控信号 | 市场监测 |
| `/trade/prospects` | 外贸全部线索 | 线索资产 |
| `/knowledge` | 组织知识库 | 知识库 |
| `/notifications` | 通知中心 | 待处理事项 |
| `/trade/import` | 展会/名片导入 | 展会导入 |
| `/service-inbox` | 客服收件箱 | 微信客服 |

逐页核对后额外对齐的 9 处（Q1）：

| 页面 | 原标题 | 现标题 | 谁看得到 |
|---|---|---|---|
| `/ops` | 今日运营工作台 | 运营中心 | Cathy；Sunny 老板、运营 |
| `/suppliers` | 供应商 | 供应商库 | Cathy；Sunny 老板、招投标 |
| `/organizations` | 组织 | 成员与组织 | Cathy、梦馨外贸业务员；Sunny 除销售与合价外的各岗位 |
| `/settings` | 设置 | 企业设置 | Cathy、梦馨外贸业务员；Sunny 除销售与合价外的各岗位 |
| `/operations/growth` | 增长中心 Growth Center | 品牌增长 | Cathy；Sunny 老板、运营 |
| `/operations` | 内容运营 | 内容生产 | Cathy；Sunny 老板、运营 |
| `/help` | 使用说明 · 功能地图 | 使用说明 | 所有人 |
| `/sales/quotes` | 全部报价 | 报价记录 | Sunny 销售、合价、老板 |
| `/sales/quote-sheet` | 电子报价单（新建态） | 报价 | Sunny 销售、合价、老板 |

`/trade`（外贸获客）、`/trade/intelligence`（竞品溯源）原标题就是定名，没改。

## 5. 没对齐的 7 个页面（Q2，登记为例外）

| 页面 | 入口 | 现状 | 原因 |
|---|---|---|---|
| `/capabilities` | AI 工作中心、中台总览 | 标题「企业能力中台」 | 两个入口指向同一页 |
| `/operations/intelligence` | 营销分析 | 其中一个页签的工作区标题「竞品监听」 | 入口名与页面功能不符，改哪边另定 |
| `/reports` | 经营简报 | 标题「项目周报」 | 同上 |
| `/` | 管理总览 | 没有大标题 | 加标题是版面改动 |
| `/sales/home` | 销售首页 | 大标题是问候语，上方小字「Sales Command Center」 | 同上 |
| `/assistant` | 数字员工 | 对话界面 | 同上 |
| `/trade/chat` | 外贸 AI 对话 | 对话界面，空态小标题「海外业务协同」 | 同上 |

测试把这张例外清单钉死：三种身份（Cathy、梦馨纯外贸业务员、Lynn）可见的 46 个入口，每个要么「大标题 = 入口名」，要么在这张清单里；以后新增入口两边都没登记，测试失败。

## 6. 站内文字（20 处，Q3）

| 位置 | 原文字 | 现文字 |
|---|---|---|
| 管理总览的外贸快捷入口 | 进入海外业务 | 进入外贸获客 |
| 外贸获客页：选组织提示 | …再使用海外业务。 | …再使用外贸获客。 |
| 外贸获客页：指向 `/trade/signals` 的链接 | 页面监控信号 | 市场监测 |
| 待收定金横幅：指向 `/sales/quotes` 的链接 | 全部报价 | 报价记录 |
| 快速报价面板：链接与保存提示（2 处） | 全部报价 | 报价记录 |
| 报价页：保存提示 | 保存后可在「全部报价」查看 | 保存后可在「报价记录」查看 |
| 通知偏好页：指向 `/notifications` 的按钮 | 前往通知中心 | 前往待处理事项 |
| 管理模块：运营卡片说明 | 客服收件箱与发布运营 | 微信客服与发布运营 |
| 铃铛下拉标题（中文） | 通知中心 | 待处理事项 |
| 品牌增长 7 个子页 + 营销数字员工页的返回链接（8 处） | 返回增长中心 / ← 增长中心 | 返回品牌增长 / ← 品牌增长 |
| 营销分析：把信号送去做内容的按钮与操作提示 | 送内容运营 | 送内容生产 |
| 线索来源标签 | 企业情报 | 竞品溯源 |

拍板清单当时写「返回增长中心 5 处」，全量核对是 8 处，同一项补齐；「送内容运营」按钮带一条配对的操作提示，一起改了。

## 7. 没改的旧叫法（留给后续决定）

**全量扫描多扫到、不在拍板清单里的 13 处界面文字**：

- 提示语里的「通知中心」3 处：`src/components/notification/project-notification-rule-card.tsx:167`、`src/app/(main)/sales/quote-sheet/page.tsx:1169`、`src/app/(main)/settings/notifications/page.tsx:194`。
- 品牌增长各页提示语与加载失败文字里的「增长中心」6 处：`operations/growth/page.tsx:69,71,81`、`operations/growth/metrics/page.tsx:251`、`operations/growth/brand/page.tsx:238`、`src/components/market-intelligence/manual-analysis-panel.tsx:472`。
- 折扣设置卡里的「电子报价单」3 处：`sales/cockpit/discount-settings-card.tsx:434,475,797`（当名词用，换成「报价」要重写句子）。
- `knowledge/page.tsx:74`「已写入组织知识库」。

**范围外**：

- `/operations` 索引卡片名「增长中心」「市场情报」——由 `navigation/entry-visibility` 的场景与 `entry-visibility.test.ts:264` 钉住。点「增长中心」卡片进去，页面标题现在是「品牌增长」。
- 接口错误信息、定时任务名、AI 工具说明、推送消息正文、权限定义名称里的「增长中心」「销售分析」「审计日志」等（`src/app/api/**`、`src/lib/**`）。
- 英文的铃铛下拉标题仍是 Notifications（侧栏英文是 To-dos）。
- **数据里的名字**：竞品溯源确认买家后转入线索时建的活动，名称仍是「企业情报」（`src/lib/trade/intelligence-service.ts:827`，按名字查找复用）。梦馨在活动列表里还会看到这个旧名字；改它需要迁移既有活动。测试断言它不变。
- 只对 Sunny 老板或平台管理员可见的页面标题没有核对：`/sales/cockpit`「销售分析」（入口「团队销售分析」）、`/projects`「项目」（入口「项目列表」）、`/blinds-orders`「工艺单管理」（入口「工艺单」）、`/wechat`「微信消息」（入口「微信集成」）、`/memory`「组织知识管理」（入口「组织记忆」）、`/admin/invite-codes`「邀请码管理」（入口「邀请码」）、`/admin/audit-logs`「审计日志」（入口「平台审计」）。
- 没有翻译键的 10 个入口（`ws-ops-projects`、`ws-install`、`sales-performance`、`sales-email-settings`、`biz-accounting`、`nav-intel-*` 五项）英文界面下显示中文。

## 8. 验证

本机 Node 24.22.1。

| 命令 | 结果 |
|---|---|
| `npx tsx src/lib/navigation/__tests__/entry-naming.test.ts` | 31 通过 |
| 同一测试在改动前的代码上 | 10 通过 / 21 失败：列出 18 个名称不一致的 key、13 个标题不符的入口，站内文字逐处不符 |
| 变异：从核对表删掉 `biz-inbox` 一行 | 失败，列出 `mx_cathy:biz-inbox`、`mx_trade_rep:biz-inbox` 未登记 |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（errors 38 ≤ 基线 53，无新增 fingerprint）；本次新增与改接线的 7 个文件单独 `eslint` 无输出。浅克隆下「PR 改动文件」附加检查被脚本跳过 |
| `npm run test:ci` | `CI unit subset PASS`（退出码 0） |
| `npm test` | 622/635。13 个失败都是环境类（无数据库连接 / Chromium / Gmail / Agent Trace）：Agent Trace 只读查询、Phase3A-2 Ledger DB、Phase3A-2 Smoke Access、Phase3A-3 Approvals Smoke、Governance Hygiene Gate、Governance Hygiene Concurrency Gate、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Phase3A-5 Settle DB、Phase3A-5 Overview Acceptance、Gmail Draft OAuth Compose Scope、T4 授标情报真实 Postgres 矩阵、Quote Operations 客户报价 PDF 分页布局。在 main `dd0e99d` 的干净检出上把这 13 项逐个重跑，13 项同样失败 |
| `bash scripts/check-test-registry.sh` | 已注册 617 个（合并 main 之后）；基线 68 条（未增未减，`trade-layout.test.ts` 那一行留给 NAV-1b） |
| `git diff --stat main -- prisma vercel.json ci/test-registry-baseline.txt` | 无输出 |
| `openspec validate nav-1a-single-name --strict` | valid |

**main 前移**：上表的 `npm test` / `npm run test:ci` / `lint:baseline` 是在 `dd0e99d` 之上跑的。实施期间 main 合入了 #446、#447、#450、#452（都是招投标线，56 个文件），与本 change 同改的只有 TASKFLOW、`scripts/test-all.sh`、`scripts/test-ci-unit.sh` 三个文件，自动合并无冲突；任务书引用的文件（导航、翻译表、说明页、外贸收件箱、客户时间线等）在 main 上都没有变。合并后重跑：`entry-naming` 31 通过、`entry-visibility` 73 通过、测试注册校验通过、`npm run typecheck` 通过；其余由 PR 的 CI 跑。之后 main 又合入 #445（归档 FIX-4 / FLOW-H1b / FLOW-H1c / FIX-6 / FIX-7 / FLOW-H4a，只动 TASKFLOW、招投标交接文档与 `openspec/`），TASKFLOW 有一处冲突：FLOW-H1b / FLOW-H1c / FIX-4 三行取 main 的归档状态，Phase N 保留。第二次合并后重跑 `entry-naming` 31 通过、测试注册校验通过、`openspec validate nav-1a-single-name --strict` 通过。

受影响的既有测试，通过数与改动前相同：`entry-visibility` 73、`navigation-ia` 64、`navigation-workspace` 34、`position-nav` 101、`trade-layout` 5、`wechat-entry-nav` 19、`tenant-context` 28、`owner-today` 8、`phone-match` 13。

## 9. 截图（`docs/acceptance/nav-1a/`）

本机临时 PostgreSQL 16（`prisma db push`）+ `next dev`，虚构企业 Example Textiles（家纺外贸）/ Example Blinds（窗饰）与虚构账号，岗位经 `seedOrgAuthorizationProfiles` 与真实岗位模板绑定。

| 文件 | 内容 | 页面上实际读到的 |
|---|---|---|
| `01-cathy-sidebar-and-help.png` | Cathy 的侧栏与 `/help` | 侧栏 38 个一级入口的名称全部出现在 `/help` 的 44 行里，逐字相同 |
| `02-lynn-sidebar-and-help.png` | Lynn 的侧栏与 `/help` | 侧栏 7 项：预约日历、销售首页、客户与商机、报价、报价记录、我的业绩、邮箱绑定；`/help` 多一项「使用说明」 |
| `03`–`09` | 任务书列出的 7 个页面 | `<h1>` 依次为 履约协同、市场监测、线索资产、知识库、待处理事项、展会导入、微信客服 |
| `10`、`11` | `/trade`、`/trade/intelligence` | 外贸获客、竞品溯源 |
| `12`、`13` | Lynn 的 `/sales/quote-sheet`、`/sales/quotes` | 报价、报价记录 |
| `14-trade-rep-sidebar-and-help.png` | 梦馨纯外贸业务员 | 两段式侧栏第一段：询盘收件箱、线索资产、外贸报价、寄样、外贸 AI 对话、外贸获客、知识库、更多（布局未改，属 NAV-1b） |
| `15-cathy-english-sidebar-and-help.png` | Cathy 切到英文界面 | 侧栏与 `/help` 的名称同为英文（Management Overview、WeChat Service、To-dos…），没有翻译键的「执行项目」两边都是中文 |
| `16-cathy-bell-dropdown.png` | 铃铛下拉 | 标题「待处理事项」 |

截图过程中页面错误：Cathy 0 条、Lynn 0 条。梦馨纯外贸业务员有 1 条 React hydration 提示：侧栏段标题服务端渲染「工作区」、客户端是「外贸工作」（`src/components/sidebar.tsx` 的两段式布局按客户端取到的用户判定）。这是既有行为，本 change 没动那段代码；NAV-1b 会重写两段式判定，到时一并处理。

## 10. 与任务书不一致、或值得知道的

1. 任务书引用的 `registry.ts:200` 实际在 `:202`；其余行号与「72 项里 18 项不一致」都吻合。
2. 任务书 1a 的 Impact 没列：`scripts/nav-visual-smoke.mjs`、`scripts/test-ci-unit.sh`、`src/components/ops/ops-workspace-shell.tsx`（`/ops` 的标题在外壳组件里）。
3. `/help` 是服务端组件、界面语言只在浏览器里，所以名称单元格改成了客户端小组件；任务书没提。
4. Cathy 的身份在仓库里有两个口径（`identity-fixtures.ts:58` 企业内 `org_admin`；`mengxin-positions.test.ts:88` 注释「生产实情：平台 boss」、企业内 `org_member`），生产未核对。对 1a 无影响。
5. 登记 Phase N 时，TASKFLOW 里 FLOW-H1b / FLOW-H1c / FIX-4 三行写「PR 待审」而 #443 / #449 / #444 已合并，当时按合并记录改成了「已合并；尚未 archive」。之后 #445 在 main 上把这三个 change 归档并更新了状态，本分支合并 main 时取了 main 的写法；本 PR 对 TASKFLOW 的净改动只剩新增 Phase N。
6. 手机底栏的 12 个短名与定名表无冲突，「日历」是「预约日历」的简称，按 Q4 不改。

## 11. 上线注意

- 合并即生效，没有开关，没有数据迁移；回滚 = revert。
- Sunny 销售会看到「电子报价单」变成「报价」、「全部报价」变成「报价记录」（侧栏、说明页、页面标题、几处指路文字）。U-8 之后这两项还会再改一次名，届时只改注册表一处，测试会带着其它几处一起失败。
- 任务书要求的「上线后通知梦馨一次」放在 1a / 1b / 1c 都上线之后；只上 1a 时，梦馨能看到的变化是名字统一与四个入口改名，常用置顶与回复入口还没有。
- 后续：NAV-1b（依赖本 change 的取名函数）、NAV-1c。
