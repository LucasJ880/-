# VIS-1b 报告：首页、底栏、索引页按同一张表

change：`vis-1b-home-and-shell`（任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`；design「审核关注点」Q1–Q10 Lucas 2026-11-09 全部按推荐拍板，Q3 按判断点 5 原样执行）。分支 `claude/vis-1b-home-and-shell`，依赖 VIS-1a（#393、归档 #395）。

## 1. 用户现在会怎么看到

- **老板首页**只剩自己企业用得上的岗位卡：Sunny 是 投标、营销增长、项目交付、内容。梦馨的「询盘销售」、平台专属的「运维与知识」、随微信开关的「客服」都不再出现，也不再为它们取数。
- **「等你拍板」**：每条点进去直接到要处理的地方：
  - 折扣与签约改价 → 报价单；折扣设置变更 → 销售驾驶舱；
  - 质保邮件 → 会计待收尾款；返修邮件 → 维修单；取消订单 → 工艺单；
  - 询价与催单 → 项目的该轮询价；
  - 其余 → 审批详情。

  落点打不开的条目不列，例如 Sunny 的营收脊柱。
- **「AI 任务」**只列你看得懂的作业：招投标看投标与交付，运营看交付，老板看全部。会计、安装工、出单、无岗位成员的侧栏不再有这一项。
- **纯销售**（Lynn / Alex）：侧栏没有「AI 任务」「数字员工」。直接敲 `/workforce`、`/assistant`、`/inbox` 回到 `/sales/home`。
- **手机底栏**：每个页签都按路由门判定，出单没有「AI」，会计没有「招投标」。
- **`/help`**：只列你侧栏里看得到的入口，每项带一句说明。
- **`/operations`**：只列你打得开的卡片。
- **站内链接**：工艺单「返回」在列表打不开时回客户详情或你的落地页；维修单链接、工作台的销售按钮、`/tasks` 的「进入协同空间」、投标分析卡的「查看执行详情」，打不开的都不再出现。

## 2. 改了什么

- **路由门拆分**：
  - `route-gate-core.ts`：门表与判定；
  - `landing.ts`：岗位卡可见、落地页、302 目标、`canOpenHref`、工艺单返回链；
  - `filter-context.ts`：服务端与客户端共用的判定输入拼装；
  - `route-gate.ts` 只留请求处理并重新导出前三者。
- **客户端钩子** `use-navigation-access.ts`；底栏纯函数 `mobile-tabs.ts`；帮助地图纯函数 `help-map.ts`；索引卡片 `operations-index.ts`；服务端页面取输入 `page-context-server.ts`。
- **首页与路由门共用落地页**：管理层零可见卡 → `/tasks`，一跳到位。首页改用路由门 loader 的输入。
- **岗位总览**：判定输入只在 posts 接口产出（时间线、工作量不多查）；只为可见岗位读 KPI、自动化与动作数；横幅不显示不可见岗位的岗位名；副标题与骨架不写死「七」。
- **「等你拍板」**：落点表、编码后的审批详情退回、落点放行才列（super_admin 全放行）、截断时 `total` = 已取到且放行 + 未取到、需要你作业按可读域。
- **workforce**：
  - `readable-domains.ts`：工作域 → 导航入口；销售另认「外贸」；通用与解析不出只给管理层；
  - 列表分批补扫，至多 5 批 × (limit + 1) 行，游标规则见 spec；
  - 详情不可读 404；页面有游标时不显示空态；
  - 「AI 任务」岗位键 `POSITION_WORKFORCE`。
- **导航注册表**：`work-ai-jobs`、`work-assistant` 去掉 `salesWorkspaceVisible`；`NavigationItem.description`，72 项各一句。
- **硬纪律**：零 schema、不新增权限键、零 LLM 调用、不触碰出站、不新增队列 / cron。

## 3. 按身份的结果（按真实实现计算；Sunny 模块 = `DEFAULT_SUNNY_MODULES`，微信开关关）

| 身份 | 落地页 | 首页岗位卡 | 可读工作域 | 侧栏「AI 任务」 | 手机底栏 | 帮助地图项数 | `/operations` 卡片 |
|---|---|---|---|---|---|---|---|
| 老板（Bill / Miki / Lucas / Bob，owner） | / | 投标、营销增长、项目交付、内容 | 投标、交付、销售、通用、未解析 | 有 | 总览、运营、招投标、安装 | 45 | 10 |
| 销售（Lynn / Alex，sales_rep） | /sales/home | — | 销售 | 无 | 销售：首页、客户、报价、日历 | 8 | 0 |
| 合价（pricing_lead） | /sales/home | — | 销售 | 无 | 销售：首页、客户、报价、日历 | 8 | 0 |
| 运营主管（Marty，ops_lead） | /ops | 营销增长、内容 | 交付 | 有 | 运营、安装、助手 | 19 | 9 |
| 运营（Maggie，ops_staff） | /ops | 营销增长、内容 | 交付 | 有 | 运营、助手 | 17 | 9 |
| 招投标（蒋晨，bids） | /bids | 投标、项目交付 | 投标、交付 | 有 | 招投标、助手 | 20 | 1 |
| 会计（只持 accounting） | /accounting | — | — | 无 | 总览、安装、助手 | 11 | 0 |
| 出单（yee，fulfillment_shades） | /tasks | — | — | 无 | 总览、安装、助手 | 12 | 0 |
| 安装工（installation） | /install | — | — | 无 | 安装、助手 | 10 | 0 |
| 无岗位成员 | /tasks | — | — | 无 | 总览、助手 | 9 | 0 |
| 梦馨 Cathy（owner + trade_rep） | / | 询盘销售、营销增长、内容 | 交付、销售、通用、未解析 | 有 | 总览、运营、AI、助手 | 44 | 9 |
| 梦馨外贸（trade_rep） | /tasks | 询盘销售 | 销售 | 有 | 总览、助手 | 25 | 0 |
| 平台 super_admin（微信关） | / | 询盘销售、投标、营销增长、项目交付、运维与知识、内容 | 投标、交付、销售、通用、未解析 | 无 | 总览、运营、招投标、安装 | 19 | 10 |

说明：
- 「首页岗位卡」只对管理层有意义，非管理层不进首页。
- 平台 super_admin 在微信开关打开时再多「客服」，共七张。

## 4. 侧栏快照差异（`position-nav.test.ts`）

- `sales_rep`、`pricing_lead`、旧模式平台 `sales`：去掉 `work-ai-jobs`、`work-assistant`。
- `accounting`、`installer`、`fulfillment_vinyl / drapery / shades`、无岗位：去掉 `work-ai-jobs`。
- 其余岗位快照不变；梦馨 `trade_rep` 仍有「AI 任务」与「外贸」。

## 5. 测试与门禁（实际运行）

GATE_RESULTS

## 6. 独立审查与处理

REVIEW_RESULTS

## 7. 拍板结果（design「审核关注点」）

Q1–Q10 全部按推荐执行（Lucas 2026-11-09）：
- Q1：按落点放行过滤，不与可见岗位卡取交集。
- Q2：可读域按导航入口；销售另认外贸。
- Q3：判断点 5 原样执行，「AI 任务」「数字员工」都从销售侧栏去掉。
- Q4：梦馨 Cathy 首页 3 张卡。
- Q5：卡片按跳转页放行。
- Q6：零卡管理层落 `/tasks`，与路由门共用。
- Q7：Bob 保留投标卡与底栏招投标。
- Q8：通用与解析不出只给管理层；「AI 任务」只给有可读域的人。
- Q9：`/operations` 过滤页内静态卡片。
- Q10：底栏其余页签也按判定。

## 8. 合并后生产核对清单

1. Bill / Miki / Lucas / Bob 打开 `/`：四张卡（投标、营销增长、项目交付、内容）。「等你拍板」里折扣审批点进去是报价单，不出现「询盘销售」字样。
2. Lynn：侧栏没有「AI 任务」「数字员工」；`/workforce`、`/assistant`、`/inbox` → `/sales/home`；打开一张工艺单，「返回」到客户详情。
3. Maggie（ops_staff）：`/workforce` 只有交付作业；`/operations` 九张卡；投标分析卡片没有「查看执行详情」。
4. yee（出单）、installation（安装工）、只持会计的账号：侧栏没有「AI 任务」；手机底栏出单没有「AI」，会计没有「招投标」。
5. 任一非管理层打开 `/help`：只列自己侧栏里的入口。
6. Lucas（super_admin）：所有页面照旧。

## 9. 已知局限

- 主规格 `cockpit/posts-overview` 与 `cockpit/home-view` 的 Purpose 仍写着「七个岗位」：归档只合并 Requirement、不改 Purpose（OpenSpec 1.15.0 忽略增量里的 Purpose），规格不手写，留给以后改这两份规格的 change。
- 「AI 任务」按岗位键判定，与可读域有三类已知例外（测试断言）：
  - Sunny 里持系统岗位 `trade_rep`、梦馨里持 `project_manager`：入口在、列表为空；
  - 梦馨平台角色 `trade` 未绑岗位：可读销售域但无入口，绑上 `trade_rep` 即有。
- 岗位模式下没绑岗位的平台 super_admin，侧栏不显示「AI 任务」。这和 VIS-1a 起其他按岗位键显示的入口（如「项目列表」）同一口径；路由门对 super_admin 本来就放行，页面照常能进。
- 无专属落点的营销 / 草稿 / 日历类审批落审批详情，详情页对全体成员放行，所以照样列出；收窄等 VIS-1d。
- 旧作业逐条解析工作域；列表一页最多补扫 5 批。
