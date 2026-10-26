# Spec Delta

## Purpose

组织驾驶舱的岗位注册表：把自动化、待审批动作、workforce 工作域、AgentRun 类型归到固定的七个岗位，并为每个岗位指定 KPI 来源与跳转页面，供岗位读模型、首页岗位卡片与工作量面板做聚合。

## ADDED Requirements

### Requirement: 岗位集合固定为七个
系统 SHALL 恰好定义七个岗位，键与顺序固定为 `inbound_sales`、`tender`、`marketing`、`service`、`projects`、`ops_knowledge`、`content`；每个岗位 SHALL 有非空的中文名，键 SHALL NOT 重复。该顺序即岗位卡片的展示顺序。`content` 与 `marketing` SHALL 是两个独立岗位。

#### Scenario: 岗位键与顺序
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/posts.test.ts`
- **THEN** 断言岗位键列表等于上述七个且顺序一致，每个中文名非空，退出码 0

#### Scenario: 按键查找不存在的岗位
- **WHEN** 用一个不在七个之内的字符串查找岗位
- **THEN** 返回"无此岗位"，不抛异常、不回退到任何默认岗位

### Requirement: 每个自动化恰好归属一个岗位
自动化注册表里的每一个自动化键 SHALL 恰好出现在一个岗位的自动化清单中；岗位清单 SHALL NOT 引用自动化注册表中不存在的键。按自动化键反查岗位 SHALL 返回唯一岗位；未知键 SHALL 返回"无归属"。

#### Scenario: 当前 28 个自动化全部归属
- **WHEN** 运行岗位注册表测试
- **THEN** 自动化注册表中 28 个键各自恰好命中一个岗位，退出码 0

#### Scenario: 新增自动化未归属
- **WHEN** 自动化注册表新增一个键而岗位注册表未把它分给任何岗位
- **THEN** 岗位注册表测试失败并打印该键；`npm run typecheck` 失败并在错误中报出该键

#### Scenario: 同一自动化归属两个岗位
- **WHEN** 同一自动化键同时出现在两个岗位的清单中
- **THEN** 岗位注册表测试失败并打印该键与两个岗位

#### Scenario: 审批超时检查归属运维与知识岗位
- **WHEN** 按 `approval-timeout` 反查岗位
- **THEN** 返回 `ops_knowledge`

### Requirement: 每个待审批动作类型恰好归属一个岗位
PendingAction 类型联合中的每一个类型 SHALL 恰好出现在一个岗位的动作类型清单中；岗位清单 SHALL NOT 包含联合之外的类型。按动作类型反查岗位 SHALL 返回唯一岗位；未知类型 SHALL 返回"无归属"。

#### Scenario: 当前 14 种动作类型全部归属
- **WHEN** 运行岗位注册表测试
- **THEN** 从 PendingAction 类型定义源码读出的 14 个类型各自恰好命中一个岗位，退出码 0

#### Scenario: 新增动作类型未归属
- **WHEN** PendingAction 类型联合新增一个成员而岗位注册表未分配它
- **THEN** 岗位注册表测试失败并打印该类型；`npm run typecheck` 失败并在错误中报出该类型

#### Scenario: ai-grader 产出的动作归属项目岗位
- **WHEN** 按 `grader.internal_note`、`grader.project_task`、`grader.email_draft`、`calendar.create_event` 反查岗位
- **THEN** 都返回 `projects`

### Requirement: 每个 workforce 工作域恰好归属一个岗位
workforce 的每一个工作域（`sales`、`tender`、`delivery`、`general`）SHALL 恰好归属一个岗位：`sales` → `inbound_sales`，`tender` → `tender`，`delivery` → `projects`，`general` → `ops_knowledge`。未知工作域 SHALL 返回"无归属"。

#### Scenario: 四个工作域的归属
- **WHEN** 运行岗位注册表测试
- **THEN** 四个工作域各自恰好命中上述岗位；新增工作域未归属时测试与 `npm run typecheck` 都失败

### Requirement: AgentRun 类型至多归属一个岗位
每个 AgentRun runType SHALL 至多出现在一个岗位中；`fde_inbound_sales` SHALL 归属 `inbound_sales`。`workforce_job` SHALL NOT 按 runType 归属任何岗位（它按工作域归属）。未列出的 runType（如 `conversation`、`assistant_dispatch`、`supervisor`）SHALL 返回"无归属"，SHALL NOT 被猜测或回退到任何岗位。

#### Scenario: 询盘 FDE 运行归属
- **WHEN** 按 `fde_inbound_sales` 反查岗位
- **THEN** 返回 `inbound_sales`

#### Scenario: workforce 作业不按 runType 归属
- **WHEN** 按 `workforce_job` 或 `conversation` 反查岗位
- **THEN** 返回"无归属"；测试断言没有任何岗位的 runType 清单包含 `workforce_job`

### Requirement: 每个岗位的 KPI 指向既有读函数或明确标为未接入
每个岗位 SHALL 声明 KPI 来源，二选一：(a) 一个仓库内已存在的、按组织只读的导出函数，加恰好三个指标（每个指标有返回值内的属性路径与中文标签）；(b) "未接入"并附非空原因。岗位注册表 SHALL NOT 新增任何数据库查询。当前 `service` 与 `content` SHALL 为"未接入"。

#### Scenario: KPI 来源真实存在
- **WHEN** 运行岗位注册表测试
- **THEN** 每个 (a) 类 KPI 的模块文件存在且导出了声明的函数名，三个指标路径的每一段都出现在该模块源码中，退出码 0

#### Scenario: 无既有读函数的岗位
- **WHEN** 读取 `service` 或 `content` 的 KPI 声明
- **THEN** 得到"未接入"与原因说明，不得到任何模块或指标

### Requirement: 岗位 KPI 不输出敏感字段
岗位 KPI 指标 SHALL NOT 指向毛利 / 毛利率、利润、项目估值（含标的额 / 预估值）、我方最终报价（`winningBidPrice`）或中标金额；即使所指向的读函数返回值里含有这些字段，KPI 声明也只能取白名单内的计数 / 比率字段。

#### Scenario: 敏感词拦截
- **WHEN** 运行岗位注册表测试
- **THEN** 所有 KPI 指标的路径与标签都不匹配 `margin|profit|毛利|利润|估值|valuation|winningBidPrice|最终报价|awardedValue|indicativeTenderValue|estimatedValue`（不区分大小写），退出码 0

### Requirement: 每个岗位跳转到已存在的页面
每个岗位 SHALL 声明一个以 `/` 开头的跳转路径，且该路径 SHALL 对应 `src/app/(main)/` 下一个已存在的页面；岗位注册表 SHALL NOT 引入新的顶层导航项。

#### Scenario: 跳转页面存在
- **WHEN** 运行岗位注册表测试
- **THEN** 七个跳转路径各自对应的 `src/app/(main)/<路径>/page.tsx` 都存在，退出码 0

### Requirement: 岗位注册表是代码事实
岗位归属 SHALL 只由代码定义；岗位注册表 SHALL NOT 读取数据库、`Organization.settingsJson`、环境变量或任何租户配置，同一份代码对所有组织给出相同的归属。

#### Scenario: 注册表模块零运行时依赖
- **WHEN** 运行岗位注册表测试
- **THEN** 断言 `src/lib/cockpit/posts.ts` 源码中的每条 import 都是 `import type`，且不出现 `process.env`、`settingsJson`、`@/lib/db`
