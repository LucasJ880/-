# Spec Delta

## Purpose

管理层首页 `/` 的岗位视图：一屏看到"等你拍板几件、七个岗位各自在不在干活、最近发生了什么"，所有数据来自岗位总览与 company.log 两个只读接口，页面本身不做任何写操作，处理动作一律跳到既有页面完成。

## ADDED Requirements

### Requirement: 首页对管理层展示岗位视图，访问规则不变
`/` SHALL 保持既有的服务端规则：未登录跳登录页，非管理层按既有规则重定向到各自的默认工作区；管理层 SHALL 看到岗位视图，SHALL NOT 再看到旧的管理仪表盘。首页 SHALL NOT 新增顶层导航项。

#### Scenario: 管理层打开首页
- **WHEN** 组织 `org_admin` 打开 `/`
- **THEN** 渲染岗位视图组件，不渲染旧管理仪表盘组件

#### Scenario: 重定向逻辑保留
- **WHEN** 运行 `npx tsx src/components/cockpit/__tests__/org-cockpit-view.test.tsx`
- **THEN** 静态断言 `src/app/(main)/page.tsx` 仍调用 `resolveHomeRedirect` 与登录检查，且不再引用 `ManagementDashboardClient`，退出码 0

### Requirement: 首屏只调用两个只读接口
首屏 SHALL 只并发调用 `GET /api/cockpit/posts` 与 `GET /api/cockpit/timeline` 两个接口，页面上的全部数据 SHALL 来自这两个接口的响应，SHALL NOT 使用写死或模拟数据。时间线后续页 SHALL 只在用户点击"加载更多"时按 `nextCursor` 请求。页面 SHALL NOT 发出任何非 GET 请求。

#### Scenario: 首屏请求
- **WHEN** 首页客户端组件挂载
- **THEN** 只发出上述两个 GET 请求；源码静态断言组件里没有其他接口地址、没有 `POST` / `PUT` / `PATCH` / `DELETE`

### Requirement: 等你 N 件横幅
页面顶部 SHALL 显示去重后的待处理总数（来源被截断时显示为"N+"），点击 SHALL 跳 `/capabilities/approvals`；SHALL 列出接口返回的前几条（标题、所属岗位、时间），每条点击跳该条自己的页面；未归属岗位的条数大于 0 时 SHALL 注明。总数为 0 时 SHALL 显示"暂无待你处理的事项"。

#### Scenario: 有待处理
- **WHEN** 接口返回 `waitingForYou.total = 5`、`truncated = false`
- **THEN** 横幅显示 5，链接到 `/capabilities/approvals`

#### Scenario: 被截断
- **WHEN** 接口返回 `total = 100`、`truncated = true`
- **THEN** 横幅显示"100+"

### Requirement: 七个岗位卡片
页面 SHALL 按接口顺序显示七张岗位卡片，组件 SHALL NOT 自行排序；每张 SHALL 显示：岗位名；健康度标签与色调（失败 / 配额已满为危险色，迟到 / 未运行过为警示色，正常为成功色，未配置 / 按需为中性色）；心跳的相对时间；下次应跑时间；三个 KPI 数值及其口径（或"未接入 / 未开启 / 暂不可用"）；待审批数与需要你数；近 7 天 AI 运行数与平台自动化运行数（分开显示，SHALL NOT 相加）；失败 / 迟到 / 未运行过的自动化名称（按此顺序，最多 3 个，未配置与按需不列）。计数 SHALL 带千分位。页头 SHALL 注明心跳与自动化次数为平台级。卡片 SHALL 链接到岗位的既有页面。卡片列数 SHALL 按内容区宽度（而非视口宽度）在一列、两列、三列之间切换。

#### Scenario: 卡片内容
- **WHEN** 接口返回投标岗位 `health = "failed"`、KPI `{tenderSubmittedCount: 12, wonCount: 3, winRatePercentage: "25.0"}`
- **THEN** 投标卡片显示危险色"失败"、"12 / 3 / 25.0%"，链接到 `/bids`

#### Scenario: 动作数分开显示
- **WHEN** 询盘岗位 `actions7d = {agentRuns: 2048, automationRuns: 12345}`
- **THEN** 卡片显示"AI 2,048 次"与"平台自动化 12,345 次"，不显示两者之和

#### Scenario: KPI 不可用
- **WHEN** 客服岗位 KPI 为 `unavailable`，投标 KPI 为 `disabled`，营销 KPI 为 `error`
- **THEN** 三张卡片的 KPI 区分别显示"未接入""未开启""暂不可用"，不显示任何数字

#### Scenario: 配额已满
- **WHEN** 接口返回 `quotaHit = true`
- **THEN** 页面显示今日 AI 运行配额已满的提示

### Requirement: company.log 时间线
页面底部 SHALL 按接口顺序显示时间线条目（时间、岗位、操作者——"系统" / "AI" / 用户名、摘要），有 `href` 的条目 SHALL 可点击；有 `nextCursor` 时 SHALL 显示"加载更多"；"加载更多"失败时 SHALL 保留已加载条目并提供重试；刷新后 SHALL 丢弃刷新前发出的"加载更多"响应；无条目时 SHALL 显示"最近 7 天暂无记录"。相对时间 SHALL 以接口的 `generatedAt` 为基准计算。

#### Scenario: 时间线条目
- **WHEN** 接口返回一条 `actor = "ai"`、`post = "tender"`、`href = "/workforce/run-1"` 的条目
- **THEN** 显示"AI"、"投标"，并链接到 `/workforce/run-1`

#### Scenario: 加载更多失败
- **WHEN** 时间线已显示若干条目，点击"加载更多"后接口失败
- **THEN** 已显示的条目保留，按钮变为"加载失败，点此重试"

### Requirement: 空态与错误态
接口返回 403 且 `needsSelection` 时 SHALL 显示"请先选择工作组织"；返回 403 且 `error` 为"无组织"时 SHALL 显示无组织提示；其他 403（非管理层）SHALL 显示无权限提示；返回 401 时 SHALL 显示"登录已过期"与重新登录链接；其他失败（含响应不是 JSON）时 SHALL 显示可重试的错误态；岗位总览与时间线 SHALL 各自独立显示错误，时间线 SHALL 可单独重试；加载中 SHALL 显示骨架。任何状态下页面 SHALL NOT 白屏或抛出未捕获异常。

#### Scenario: 需要选择组织
- **WHEN** 岗位总览接口返回 403 `{needsSelection: true}`
- **THEN** 显示"请先选择工作组织"，不显示卡片

#### Scenario: 服务端错误
- **WHEN** 岗位总览接口返回 500
- **THEN** 显示错误态与"重试"按钮

#### Scenario: 登录过期
- **WHEN** 接口返回 401
- **THEN** 显示"登录已过期"与指向 `/login` 的重新登录链接

#### Scenario: 无组织
- **WHEN** 接口返回 403 `{error: "无组织"}`
- **THEN** 显示"你还没有加入任何组织"，不显示重试按钮

### Requirement: 页面只读且不展示接口以外的内容
页面 SHALL NOT 提供审批、执行、重试、关停等任何改变数据的操作入口；页面 SHALL NOT 展示接口响应之外的业务数据，展示的文本 SHALL 原样使用接口已脱敏的字段，SHALL NOT 自行拼接金额、毛利、估值或报价。

#### Scenario: 只读
- **WHEN** 运行岗位视图渲染测试
- **THEN** 渲染结果里没有表单提交、没有"批准 / 驳回 / 执行"按钮；给定含脱敏提示的条目，页面原样显示提示文本，不出现毛利 / 估值 / 报价数值
