# 组织驾驶舱 × Inbound Sales FDE — 交接记录（换会话从这里接）

> 每完成一个 change 的一个阶段就更新本文件并推送。新会话开工顺序：先读 `CLAUDE.md` §1，再读本文件"当前位置"，再 `openspec list` 看进行中的 change，用 `/opsx:continue <change>` 接着做，不凭记忆重写。

| 项 | 值 |
|---|---|
| 任务书 | `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md`（状态列是 A / B 阶段的事实源） |
| 工作分支 | A-1：`claude/awesome-turing-dorqeg`（基线 `origin/main` @ `51cc62c`，PR #243 合并后）；A-2 起见 PR 策略 |
| PR 策略 | **已定（用户，2026-10-26）**：每个 change 一个独立分支、一个 PR。A-1 用 `claude/awesome-turing-dorqeg`；之后的 change 用 `claude/<change-name>`，从前一个 change 的分支切出（叠加），PR base 指向前一个 change 的分支，前一个合并进 `main` 后把 base 改回 `main`。archive 另走 `claude/archive-<change-name>` 小 PR |
| 每个 change 的完成定义 | 四件套 `openspec validate --strict` 通过 → apply 全部 task 打勾 → 本 change 测试 + typecheck + lint:baseline 绿 → `/opsx:verify` 报告 → 独立审查代理交叉验证（只给代码与规格）并处理发现 → 写 REPORT + 状态列 `[G]` → 提交推送 → 更新本文件 |

## 当前位置

- **A-1 `org-cockpit-posts`**：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_A-1_REPORT.md`；PR 见进度表。合并后另开 `claude/archive-org-cockpit-posts` 做 `/opsx:archive org-cockpit-posts --yes`。
- **A-2 `org-cockpit-read-model`**（分支 `claude/org-cockpit-read-model`，叠在 A-1 上）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_A-2_REPORT.md`（含 staging 待验项：时间线 `EXPLAIN ANALYZE`、sunny-home-deco 人工对账）。
- **下一步：A-3 `org-cockpit-home`**，从 `claude/org-cockpit-read-model` 切出 `claude/org-cockpit-home`。输入：首页 `src/app/(main)/page.tsx` 是服务端组件（`resolveWorkspaceContextFromCookies` + `resolveHomeRedirect`，非管理层重定向，保留）；客户端用 `apiFetch` 调 `/api/cockpit/posts` 与 `/api/cockpit/timeline`（这两个前缀不在 `ORG_SCOPED_API_PREFIXES`，服务端按 DB 活动组织解析，与 `/workforce` 一致）；"等你 N 件"跳 `/capabilities/approvals`；卡片标注心跳平台级、`unattributed` 计数、KPI 的 `window` 口径；视觉按 `DESIGN.md`（宣纸 #f2f0eb / 玉白 #faf8f4、半透明边框、黛青仅用于交互、最重 600、44px 触控）。D-2：直接替换旧首页 `ManagementDashboardClient`。
- A-2 实施中发现并已修到 A-1（PR #244 分支 `1776263`，再合进 A-2）：`Project.workDomain` 默认 `general` = 未分类项目，不能按工作域规则归到 `ops_knowledge`。

## 进度表

| ID | change | 四件套 | apply | 测试 | verify | 交叉验证 | 状态列 |
|---|---|---|---|---|---|---|---|
| A-1 | `org-cockpit-posts`（[PR #244](https://github.com/LucasJ880/-/pull/244)，base `main`） | ✅（修订 `1482019`） | 4/4 | ✅ 412/426，失败清单 = 基线；test:ci PASS | ✅ 无 WARNING | ✅ 10 条全部处理 | `[G]` |
| A-2 | `org-cockpit-read-model`（PR 见下） | ✅（修订 `4aa5183`） | 6/6 | ✅ 416/430，失败清单 = 基线；test:ci PASS | ✅ 无 WARNING | ✅ 1 阻塞 + 5 应修全部处理 | `[G]` |
| A-3 | `org-cockpit-home` | — | — | — | — | — | `[ ]` |
| A-4 | `org-cockpit-workload` | — | — | — | — | — | `[ ]` |
| B-1 | `fde-feedback-loop` | — | — | — | — | — | `[ ]` |
| B-2 | `fde-fact-proposals` | — | — | — | — | — | `[ ]` |
| B-3 | `fde-preferences-in-draft` | — | — | — | — | — | `[ ]` |
| B-4 | `fde-score-calibration` | — | — | — | — | — | `[ ]` |
| B-5 | `fde-internal-autonomy` | — | — | — | — | — | `[ ]` |

A-5、B-6 是决策项，不开 change（D-1：A-5 只做模板版，需另行决定是否启动）。

## 已做的判断（GATE 审核时逐条确认；详见各 change 的 proposal "偏差"一节）

1. 代码现状是 28 项自动化、14 种 PendingAction（任务书写 23 / 12）；A-1 按代码现状穷举。
2. `approval-timeout` 归 `ops_knowledge`，不归 `tender`（它处理全组织所有类型的审批过期）。**已认可（用户，2026-10-26）**。
3. ~~`grader.*` 与 `calendar.create_event` 归 `projects`~~（交叉审查证伪：多条链路产出）→ 改为**通用动作类型**，按行上下文归属（项目工作域 → 目标类型 → 产出 runType → 未归属）。`runtime_v2` 归 `inbound_sales`。
4. 工作域：`sales`→`inbound_sales`、`tender`→`tender`、`delivery`→`projects`、`general`→`ops_knowledge`。
5. `service`、`content` 没有既有只读读函数，A-1 的 KPI 标"未接入"；A-2 决定是否把路由里的内联查询原样抽成读函数。
6. `tender` 的 KPI 来源 `getTenderPortfolioSummary`、`marketing` 的 `getMarketingDashboard` 返回值含毛利 / 利润 / 估值 / 中标金额，KPI 只取白名单计数字段。
7. `ops_knowledge` 卡片跳 `/ai-activity`（不跳 `/ai/autopilot`，后者有权限门与开关）。
8. （A-2）心跳是平台级（AutomationRun 不带 orgId）；健康度多 `n/a` / `not_configured`；迟到按类型化调度表（对照 vercel.json）判断。
9. （A-2）"等你 N 件" = `/capabilities/approvals` 待我审批（PendingAction + ApprovalRequest + 产品内容审批，带决策权）∪ workforce 需要你，作业的审批已列出则去重；通知不另计。**A-3 的跳转目标是 `/capabilities/approvals`，不是 `/inbox`**（`/inbox` 是快速捕获页）。
10. （A-2）两个 API 只对首页同口径管理层开放；时间线无 `(orgId, createdAt)` 索引，靠 7 天窗口 + limit+1 + 事件白名单，`EXPLAIN` 留到 staging。

## 环境（云端容器每次都是新的，照做即可）

```bash
# Node 24（容器自带 v22，项目要求 >=24 <25）
mkdir -p /opt/node24 && cd /opt/node24 \
  && curl -sS -O https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz \
  && tar -xJf node-v24.22.1-linux-x64.tar.xz && rm node-v24.22.1-linux-x64.tar.xz
export PATH=/opt/node24/node-v24.22.1-linux-x64/bin:$PATH

cd <repo> && npm ci
# npm 11 默认不跑依赖的 install 脚本，手动补三步：
(cd node_modules/esbuild && node install.js)
(cd node_modules/@prisma/engines && node scripts/postinstall.js)
npx prisma generate

npm i -g @fission-ai/openspec@1.15.0   # openspec CLI
```

## 已知的既有问题（不是本任务引入，不在本任务修）

- `bash scripts/check-test-registry.sh` 在 `main` 上已失败：PR #242 带入 `src/lib/trade/__tests__/inbound-org.test.ts`、`src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts` 未注册。另一会话的 `register-acquisition-hub-tests` change（分支 `claude/affectionate-ptolemy-81vzuy`）在处理。
- 容器里没有 Postgres：DB 集成测试会以 MISSING_DATABASE_URL 失败或跳过；`npm test` 的失败项要与基线逐条比对，只认新增失败。
