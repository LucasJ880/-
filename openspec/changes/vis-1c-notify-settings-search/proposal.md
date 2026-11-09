# Proposal：通知、设置、搜索、AI 工具按同一张表收口（VIS-1c）

TASKFLOW：VIS-1c（Phase V「可见性收口」；任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`，Lucas 2026-11-08 拍板判断点 1–7）。并入 VIS-1b 留下的三项（Lucas 2026-11-09「把 B 也做了」）：首页时间线、「总览」入口、拆分「等你 N 件」规格。依赖 VIS-1a / 1b（#393、#400）与搜索修复 #409。

## Why

路由门和首页已经按「看得见 ⇔ 打得开」收口，但通知开关、`/settings`、全局搜索、AI 助手工具表、营销数字员工卡片、首页时间线和「总览」入口仍按各自的规则（或不判定）出现，销售照样看到询价通知开关、搜得到打不开的项目、被递上营销工具。这些入口要改用同一张门表判定。

## What Changes

**通知类型**
- 新增「通知类型 → 处理页面」对照（代码常量）：每个类型对应收件人点开或处理它的站内页面，任一对当前用户放行，该类型才出现在通知设置的开关列表与通知页的类型筛选里。
- 保留隐藏类型的已存偏好与投递：开关列表不显示的类型照旧按原偏好投递，保存设置时其开关状态不变；铃铛图标表与跳转表不改。

**设置**
- 改读组织设置判定发信文案：`/settings` 与 `/settings/email` 不再按 `MENGXIN_ORG_CODE` 硬编码，改读组织 `settingsJson.ui.senderCopy`（零 schema，既有 JSON 位）。
- 新增回填脚本：给指定企业写入 `settingsJson.ui.senderCopy`（需显式开关与平台管理员执行者，支持 `--dry-run`）。
- 隐藏打不开的设置卡片：「邮箱绑定」卡只在 `/settings/email` 对当前用户放行时出现。

**全局搜索**
- 收窄项目结果：只返回当前用户可读的项目（负责人、本企业 org_admin / org_owner、项目 active 成员），且只在项目详情页对其放行时搜项目。
- 固化任务范围：任务结果只含可见项目里的任务与本人的无项目任务（#409 的修复写进规格）。

**AI 助手工具**
- 共用模块映射：工具列表与执行期授权用同一个「工具 → 所需模块」函数和同一份企业模块输入，列表不再出现执行期会因模块拒绝的工具。
- 收窄营销工具：`marketing_*` 所需模块改为 `marketing`；人类对话里只在「品牌增长」入口对当前用户放行时进入工具列表。

**营销数字员工**
- 改判工作台「营销增长数字员工」卡片：只在营销数字员工页对当前用户放行时出现，不再按「派生角色 ≠ sales」。

**VIS-1b 遗留**
- 收口首页时间线：
  - 平台级自动化运行只列可见岗位的；
  - workforce 作业条目只在作业可读时带链接；
  - 不可见岗位的条目不显示岗位名。
- 收窄「管理总览」：岗位模式下侧栏「管理总览」只对管理层（平台 super_admin 或老板岗位）出现；手机底栏首格在落地页不是 `/` 时改指落地页。**BREAKING**（非管理层侧栏少一项）
- 拆分规格：把 `cockpit/posts-overview` 里过长的「等你 N 件…」需求拆成「组成与去重」「计数与截断」与两条落点（只改规格，行为不变）。

**测试**
- 新增与更新表驱动测试：通知类型对照、设置卡片与发信文案、搜索范围、工具列表模块过滤、营销卡片、时间线收口、「管理总览」与底栏首格。新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## Capabilities

### New Capabilities
- `notifications/type-visibility`：通知类型在设置开关与通知页筛选里只对能打开其处理页面的人出现；隐藏不改偏好、不停投递。
- `search/global-search`：全局搜索的任务与项目范围。
- `settings/sender-copy`：发信文案按组织设置显示，及其回填脚本。

### Modified Capabilities
- `navigation/entry-visibility`：新增「`/settings` 索引只列放行的卡片」「营销数字员工卡片只在其页面放行时出现」「底栏首格指向落地页」。
- `navigation/position-based-visibility`：新增「管理总览只对管理层」。
- `agents/tool-authorization`：新增「工具列表按模块过滤且与执行同一映射」「营销工具随营销模块与品牌增长入口」。
- `cockpit/company-log`：新增「时间线按可见岗位与可读作业收口」；「条目的岗位归属只用结构化字段」「来源范围有界」各改一个场景的前提（调用者可读 / 调用者为 super_admin）。
- `cockpit/home-view`：「company.log 时间线」补「不可见岗位不显示岗位名」，场景「时间线条目」补前提。
- `cockpit/posts-overview`：移除「等你 N 件按现成"待我审批"口径并与需要你去重」，新增「等你 N 件的组成与去重」「等你 N 件的计数与截断」「销售与安装审批的落点」「其余审批的落点」四条（内容不变，只拆开）。

受影响的 Muse 意图：无（不触碰 muse-bridge）。

## Impact

- 新增：
  - `src/lib/notifications/type-visibility.ts`（类型 → 入口页面对照）；
  - `src/lib/settings/sender-copy.ts`（发信文案读写）；
  - `scripts/set-org-sender-copy.ts`（回填脚本）；
  - 对应测试。
- 修改：
  - 通知：`src/components/notification/notification-type-toggle-list.tsx`、`src/app/(main)/notifications/page.tsx`；
  - 设置：`src/app/(main)/settings/page.tsx`、`settings/email/page.tsx`、`src/app/api/organizations/route.ts`、`src/lib/hooks/use-organizations.ts`、`scripts/seed-org-mengxin-home-textile.ts`；
  - 搜索：`src/app/api/search/route.ts`、`src/lib/search/where.ts`；
  - 工具：`src/lib/tenancy/tool-auth.ts`（导出模块映射）、`src/lib/agent-core/tool-registry.ts`、`src/lib/agent-core/engine.ts`、`src/lib/agent-core/types.ts`、`src/app/api/agent-core/tools/route.ts`、`src/app/api/agent-core/chat/route.ts`、`src/app/api/ai/threads/[threadId]/messages/route.ts`；
  - 营销卡片：`src/app/(main)/assistant/digital-employee-workbench.tsx`；
  - 时间线：`src/lib/cockpit/timeline.ts`、`posts-read-model.ts`（company log 部分）、`src/lib/navigation/landing.ts`（可见自动化键）、`src/app/api/cockpit/timeline/route.ts`、`src/components/cockpit/org-cockpit-view.tsx`；
  - 入口：`src/lib/navigation/types.ts`（`managementOnly`）、`filter.ts`、`registry.ts`（`work-home`）、`mobile-tabs.ts`；
  - 测试与 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 硬纪律：零 schema（发信文案落在既有 `Organization.settingsJson`）、不新增权限键、零新增 LLM 调用、不触碰出站、不新增队列 / cron。

## Out of scope

- 审批中心可见集合与 AI「待我确认」：VIS-1d。以岗位预览：VIS-1e。
- API 层按模块拦截：营销接口（`requireMarketingReadAccess`）、通知读取接口照旧，只改入口与列表。
- 人类调用工具的执行期权限键判定（`agents/tool-authorization`「人类调用的过渡回退」不变）。
- 人类对话「只许调用本次工具列表里的工具」的执行期白名单（design Q5，建议另立）。
- 通知的生成与投递规则（谁收到什么）、铃铛图标表、跳转表、未登记类型（如 `project_dispatched`）的登记。
- 全局搜索的大小写、排序、结果条数与移动端入口。
- 首页工作量面板与岗位日报。
- 主规格 Purpose 里「七个岗位」的说法（归档不改 Purpose）。
