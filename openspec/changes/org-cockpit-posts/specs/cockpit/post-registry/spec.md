# Spec Delta

## Purpose

组织驾驶舱的岗位注册表：把自动化、待审批动作、workforce 工作域、AgentRun 类型归到固定的七个岗位，并为每个岗位指定 KPI 来源与跳转页面，供岗位读模型、首页岗位卡片与工作量面板做聚合。

## ADDED Requirements

### Requirement: 岗位集合固定为七个
系统 SHALL 恰好定义七个岗位，键与顺序固定为 `inbound_sales`、`tender`、`marketing`、`service`、`projects`、`ops_knowledge`、`content`；每个岗位 SHALL 有含汉字的中文名，键 SHALL NOT 重复。该顺序即岗位卡片的展示顺序。`content` 与 `marketing` SHALL 是两个独立岗位。

#### Scenario: 岗位键与顺序
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/posts.test.ts`
- **THEN** 断言岗位键列表等于上述七个且顺序一致，每个中文名含汉字，退出码 0

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

### Requirement: 每个待审批动作类型恰好有一种归属方式
PendingAction 类型联合中的每一个类型 SHALL 恰好满足以下之一：(a) 固定归属一个岗位；(b) 属于"通用动作类型"，按每条待审批动作自身的上下文归属。类型 SHALL NOT 同时属于 (a) 与 (b)，也 SHALL NOT 在 (a) 中出现于两个岗位。注册表 SHALL NOT 包含联合之外的类型。当前通用动作类型为 `calendar.create_event`、`grader.email_draft`、`grader.internal_note`、`grader.project_task`（它们由销售跟进、助手场景、技能、ai-grader 等多条链路产出）。

#### Scenario: 当前 14 种动作类型全部有归属方式
- **WHEN** 运行岗位注册表测试
- **THEN** 从 PendingAction 类型定义源码读出的 14 个类型中，10 个各自恰好固定归属一个岗位，4 个属于通用动作类型，退出码 0

#### Scenario: 新增动作类型未归属
- **WHEN** PendingAction 类型联合新增一个成员而岗位注册表既未固定分配、也未列为通用动作类型
- **THEN** 岗位注册表测试失败并打印该类型；`npm run typecheck` 失败并在错误中报出该类型

#### Scenario: 通用动作类型没有固定岗位
- **WHEN** 只按类型反查 `grader.email_draft` 的固定岗位
- **THEN** 返回"无固定归属"

### Requirement: 通用动作类型按行上下文确定性归属
对一条通用动作类型的待审批动作，系统 SHALL 按以下顺序确定岗位，第一条命中即停：(1) 所属项目的工作域 → 该工作域的岗位（项目工作域为默认值 `general`，即未分类时，跳过本条）；(2) 动作目标类型 `PROJECT` → `projects`，`CUSTOMER` / `OPPORTUNITY` / `QUOTE` → `inbound_sales`（不区分大小写）；(3) 产出它的 AgentRun 类型所归属的岗位；(4) 都不命中 → "未归属"。系统 SHALL NOT 用标题、正文或任何自然语言推断岗位；固定归属的类型 SHALL 始终返回其固定岗位，不受上下文影响。

#### Scenario: 按项目工作域归属
- **WHEN** 一条 `grader.project_task` 所属项目的工作域为 `tender`
- **THEN** 归属 `tender`

#### Scenario: 未分类项目不归运维与知识
- **WHEN** 一条 `grader.internal_note` 所属项目的工作域为默认值 `general`，目标类型为 `PROJECT`
- **THEN** 归属 `projects`，不是 `ops_knowledge`

#### Scenario: 按目标类型归属
- **WHEN** 一条 `grader.email_draft` 没有项目、目标类型为 `customer`
- **THEN** 归属 `inbound_sales`

#### Scenario: 按产出 run 类型归属
- **WHEN** 一条 `calendar.create_event` 没有项目、没有目标类型，产出它的 AgentRun 类型为 `runtime_v2`
- **THEN** 归属 `inbound_sales`

#### Scenario: 无上下文
- **WHEN** 一条 `calendar.create_event` 没有项目、没有目标类型、没有产出 run
- **THEN** 返回"未归属"，不回退到任何默认岗位

#### Scenario: 固定类型不受上下文影响
- **WHEN** 一条 `tender.send_rfq` 带有工作域为 `sales` 的项目上下文
- **THEN** 仍归属 `tender`

### Requirement: 每个 workforce 工作域恰好归属一个岗位
workforce 的每一个工作域（`sales`、`tender`、`delivery`、`general`）SHALL 恰好归属一个岗位：`sales` → `inbound_sales`，`tender` → `tender`，`delivery` → `projects`，`general` → `ops_knowledge`。未知工作域 SHALL 返回"无归属"。

#### Scenario: 四个工作域的归属
- **WHEN** 运行岗位注册表测试
- **THEN** 四个工作域各自恰好命中上述岗位；新增工作域未归属时测试与 `npm run typecheck` 都失败

### Requirement: AgentRun 类型的归属清单覆盖代码里写入的全部取值
代码里写入 AgentRun 的每一个 runType 取值 SHALL 恰好落在以下之一：归属一个岗位，或列为"不归属"。当前归属为 `fde_inbound_sales` → `inbound_sales`、`runtime_v2`（销售跟进分诊）→ `inbound_sales`；不归属为 `workforce_job`（按工作域归属）、`conversation`、`assistant_dispatch`、`background_conversation`、`supervisor`。不归属或未知的 runType SHALL 返回"无归属"，SHALL NOT 被猜测或回退到任何岗位。

#### Scenario: 询盘 FDE 与销售跟进分诊运行归属
- **WHEN** 按 `fde_inbound_sales` 或 `runtime_v2` 反查岗位
- **THEN** 都返回 `inbound_sales`

#### Scenario: 不归属的运行类型
- **WHEN** 按 `workforce_job`、`conversation`、`assistant_dispatch`、`background_conversation`、`supervisor` 反查岗位
- **THEN** 都返回"无归属"

#### Scenario: 代码里新写入一个 runType
- **WHEN** 源码中出现一个新的 runType 字面量写入，而注册表既未归属也未列为不归属
- **THEN** 岗位注册表测试失败并打印该取值

### Requirement: 每个岗位的 KPI 指向既有读函数或明确标为未接入
每个岗位 SHALL 声明 KPI 来源，二选一：(a) 一个仓库内已存在的、按组织只读的导出函数，加统计窗口说明与恰好三个指标，每个指标有返回值内的属性路径、中文标签与格式；(b) "未接入"并附非空原因。指标路径 SHALL 在该函数返回值类型上解析为标量（数字、字符串或空），否则 `npm run typecheck` 失败。岗位注册表 SHALL NOT 新增任何数据库查询。当前 `service` 与 `content` SHALL 为"未接入"。

#### Scenario: KPI 来源真实存在
- **WHEN** 运行岗位注册表测试
- **THEN** 每个 (a) 类 KPI 的模块文件存在且导出了声明的 async 函数，类型映射里的模块路径与声明一致，退出码 0

#### Scenario: 指标路径写错
- **WHEN** 某个指标路径在读函数返回值类型上不存在，或指向对象而非标量
- **THEN** `npm run typecheck` 失败并在错误中报出 `<岗位>:<路径>`

#### Scenario: 无既有读函数的岗位
- **WHEN** 读取 `service` 或 `content` 的 KPI 声明
- **THEN** 得到"未接入"与原因说明，不得到任何模块或指标

### Requirement: 岗位 KPI 不输出敏感字段
岗位 KPI 指标的格式 SHALL 只能是计数、比率（0..1）、百分比字符串、分钟数或得分之一，不存在金额格式。指标 SHALL NOT 指向毛利 / 毛利率、利润、营收、成本、花费、项目估值（含标的额 / 预估值）、我方报价或最终报价（`winningBidPrice` / `ourBidPrice`）、中标金额。按 KPI 声明从读函数结果取值时 SHALL 只返回声明的三个路径的值，SHALL NOT 透出结果对象里的其他字段。

#### Scenario: 敏感词拦截
- **WHEN** 运行岗位注册表测试
- **THEN** 所有 KPI 指标的路径与标签都不匹配敏感词正则（覆盖 margin / profit / revenue / cost / spend / bidPrice / bidAmount / awardedValue / estimatedValue / indicativeTenderValue / 以 Cad 结尾 / 毛利 / 利润 / 营收 / 成本 / 估值 / 标的额 / 报价 / 中标金额），且格式都在允许集合内，退出码 0

#### Scenario: 只取声明的路径
- **WHEN** 对一个同时含有 `wonCount` 与 `wonProjects.finalizedMarginPercentage` 的投标汇总结果按 `tender` 的 KPI 声明取值
- **THEN** 只得到三个声明指标的值，结果里不出现毛利率字段

### Requirement: 每个岗位跳转到已存在的页面
每个岗位 SHALL 声明一个以 `/` 开头的跳转路径，且该路径 SHALL 对应 `src/app/(main)/` 下一个已存在的页面；岗位注册表 SHALL NOT 引入新的顶层导航项。

#### Scenario: 跳转页面存在
- **WHEN** 运行岗位注册表测试
- **THEN** 七个跳转路径各自对应的 `src/app/(main)/<路径>/page.tsx` 都存在，退出码 0

### Requirement: 岗位注册表是代码事实
岗位归属 SHALL 只由代码定义；岗位注册表 SHALL NOT 读取数据库、`Organization.settingsJson`、环境变量或任何租户配置，同一份代码对所有组织给出相同的归属。注册表模块 SHALL NOT 有运行时导入（只允许类型导入与类型位置的 `typeof import(...)`）。

#### Scenario: 注册表模块零运行时依赖
- **WHEN** 运行岗位注册表测试
- **THEN** 断言 `src/lib/cockpit/posts.ts` 的每条 import 语句都是 `import type`，每个 `import(` 都紧跟在 `typeof ` 之后，不出现 `require(`、`export … from`、`process.env`、`settingsJson`、`@/lib/db`
