# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: 七个岗位卡片`
- TO: `### Requirement: 岗位卡片`

## MODIFIED Requirements

### Requirement: 首页对管理层展示岗位视图，访问规则不变
`/` SHALL 保持既有的服务端规则：未登录跳登录页，非管理层按既有规则重定向到各自的默认工作区；管理层 SHALL 看到岗位视图，SHALL NOT 再看到旧的管理仪表盘。管理层在当前企业一张可见岗位卡片都没有时，`/` SHALL 302 到 `/tasks`，SHALL NOT 渲染空的岗位视图。首页 SHALL NOT 新增顶层导航项。

#### Scenario: 管理层打开首页
- **WHEN** 组织 `org_admin` 打开 `/`
- **THEN** 渲染岗位视图组件，不渲染旧管理仪表盘组件

#### Scenario: 重定向逻辑保留
- **WHEN** 运行 `npx tsx src/components/cockpit/__tests__/org-cockpit-view.test.tsx`
- **THEN** 静态断言 `src/app/(main)/page.tsx` 仍调用 `resolveHomeRedirect` 与登录检查，且不再引用 `ManagementDashboardClient`，退出码 0

#### Scenario: 没有可见卡片
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts`，以一家只启用 `sales` 模块的岗位模式企业、持 `owner` 岗位、微信入口开关关闭的输入计算可见岗位
- **THEN** 可见岗位为空；首页据此 302 到 `/tasks`（源码断言 `page.tsx` 在可见岗位为空时调用 `redirect("/tasks")`），测试通过

### Requirement: 岗位卡片
页面 SHALL 按接口顺序显示接口返回的岗位卡片（只含可见岗位），组件 SHALL NOT 自行排序或补齐；每张 SHALL 显示：岗位名；健康度标签与色调（失败 / 配额已满为危险色，迟到 / 未运行过为警示色，正常为成功色，未配置 / 按需为中性色）；心跳的相对时间；下次应跑时间；三个 KPI 数值及其口径（或"未接入 / 未开启 / 暂不可用"）；待审批数与需要你数；近 7 天 AI 运行数与平台自动化运行数（分开显示，SHALL NOT 相加）；失败 / 迟到 / 未运行过的自动化名称（按此顺序，最多 3 个，未配置与按需不列）。计数 SHALL 带千分位。页头 SHALL 注明心跳与自动化次数为平台级。卡片 SHALL 链接到岗位的既有页面。卡片列数 SHALL 按内容区宽度（而非视口宽度）在一列、两列、三列之间切换。

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

#### Scenario: 只显示接口给的卡片
- **WHEN** 运行 `npx tsx src/components/cockpit/__tests__/org-cockpit-view.test.tsx`，接口只返回 `tender`、`marketing`、`projects`、`content` 四个岗位
- **THEN** 页面只渲染这四张卡片，不渲染占位卡片，测试通过
