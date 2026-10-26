# Proposal: org-cockpit-home

**TASKFLOW：** A-3（工作台首页 → 岗位卡片），状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表。依赖 A-2 `org-cockpit-read-model`（PR #245，本分支叠在其上）。
**受影响的 Muse 意图：** 无。

## Why

首页 `/` 现在是通用管理仪表盘（简报 / 日历 / 任务 / AI 建议），与 `/revenue`、`/workforce`、`/capabilities` 各看一角，老板打开首页看不到"每个岗位在不在干活、哪里卡住、等我拍板几件"。A-2 已把这些数据收成两个只读 API，A-3 把首页直接替换为岗位视图（D-2）。

## What Changes

- 替换 `src/app/(main)/page.tsx` 渲染的客户端组件：保留既有的服务端登录检查与非管理层重定向（`resolveHomeRedirect`），把 `ManagementDashboardClient` 换成新的 `OrgCockpitHome`。
- 新增 `src/components/cockpit/`：
  - `OrgCockpitHome`：客户端容器，首屏只并发调用 `GET /api/cockpit/posts` 与 `GET /api/cockpit/timeline` 两个接口；时间线"加载更多"按需翻页；手动刷新。
  - `OrgCockpitView`：无状态展示组件，从上到下依次为：
    - 顶部"等你 N 件"横幅（点击跳 `/capabilities/approvals`，列出前几条，每条跳各自页面）；
    - 七个岗位卡片网格（健康度色标、心跳时间、下次应跑、KPI 三个数及口径、待审批 / 需要你、近 7 天动作、异常自动化），卡片点击跳岗位的既有页面；
    - 底部 company.log 时间线。
  - 加载、无组织、需选择组织、无权限、出错、无数据各有明确的空态 / 错误态，不报错白屏。
- 新增 `src/lib/cockpit/presentation.ts`：健康度标签与色调、KPI 数值格式化（计数 / 比率 / 百分比字符串 / 分钟 / 得分）、窗口口径文案、相对时间、时间线操作者文案等纯函数。
- 新增测试：`src/lib/cockpit/__tests__/presentation.test.ts`（纯函数）与 `src/components/cockpit/__tests__/org-cockpit-view.test.tsx`（服务端静态渲染 + 源码静态断言），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 视觉核对：用 A-2 接口形状的夹具数据离线渲染，配合项目自己的 Tailwind 主题编译出样式，用 Playwright 截桌面 / iPad / 手机三种宽度，截图随报告附上（不入库）。
- 写 `docs/QINGYAN_ORG_COCKPIT_A-3_REPORT.md` 并更新状态列。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **"等你 N 件"跳 `/capabilities/approvals`，不跳 `/inbox`**：`/inbox` 是快速捕获页，与审批无关；A-2 的口径就是 `/capabilities/approvals` 的待我审批 ∪ workforce 需要你（见 A-2 proposal 偏差 4）。GATE-A 第 3 条"数字与 `/inbox` 一致"相应改为"与 `/capabilities/approvals` 待我审批 + `/workforce` 需要你一致"。
2. **心跳标注"平台级"**：A-2 的心跳是平台级运行流，卡片上明示，避免老板误以为是本组织专属。
3. **旧首页组件不在本 change 删除**：`src/components/dashboard/**` 只被 `ManagementDashboardClient` 用到，替换后成为未引用代码；删除（约 20 个文件）另开清理 change，避免本 PR 膨胀并与他人的改动冲突。首页上原有的简报 / 日历 / 任务 / AI 建议入口随替换一并消失（D-2 已决定）；已核实对应能力在既有页面仍有入口：秘书简报在 `/assistant` 数字员工工作台与销售 AI 提醒面板（`/api/secretary/briefing`），日历在 `/sales/calendar`（`/api/calendar`），任务在 `/tasks`。
4. **"Lighthouse 首屏请求 ≤ 2 个 API 调用"**：容器里没有数据库，真实页面无法登录跑 Lighthouse；改为源码静态断言首屏只调用两个接口，加上渲染测试与截图核对；Lighthouse 列为 staging 验证项。

## Capabilities

### New Capabilities
- `cockpit/home-view`：管理层首页的岗位视图——数据来源与请求数、等你 N 件横幅、七个岗位卡片、company.log 时间线、空态 / 错误态、只读、跳转目标。

### Modified Capabilities
（无。`cockpit/posts-overview` 与 `cockpit/company-log` 尚未归档，本 change 只消费它们的接口，不改其要求。）

## Impact

- 改动：`src/app/(main)/page.tsx`（只换渲染的组件，重定向逻辑不变）。
- 新文件：`src/components/cockpit/{org-cockpit-home,org-cockpit-view}.tsx`、`src/lib/cockpit/presentation.ts`、两个测试、`docs/QINGYAN_ORG_COCKPIT_A-3_REPORT.md`。
- `scripts/test-all.sh` / `scripts/test-ci-unit.sh`：各追加 2 条。
- 行为变化：管理层打开 `/` 看到岗位视图而不是旧仪表盘；非管理层的重定向不变；其余页面与 API 零变化。
- 不新增顶层导航项，不改侧栏。

## Out of scope

- 页面内零 mutation：不放任何审批 / 执行 / 重试按钮，所有处理都跳到既有页面完成。
- 不做移动端专版（响应式即可）；不做实时推送 / 轮询（手动刷新）。
- 不删除 `src/components/dashboard/**`（另开清理 change）；不改 A-2 的接口与读模型；不做工作量面板（A-4）。
- 不改侧栏、不加顶层导航、不改 `src/app/(main)/layout.tsx`。
