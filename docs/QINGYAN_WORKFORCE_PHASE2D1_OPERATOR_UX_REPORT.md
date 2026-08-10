# Qingyan Workforce — Phase 2D-1 Operator / Job Center Read-Only UX 交付报告（Lane B / P1）

- 日期：2026-08-10
- 分支：`feature/workforce-operator-job-center-2d1`（基于 verified main `2c33ad6`，含 #84 Job Read Model）
- 性质：**READ-ONLY OPERATOR UX**。零 Human Control mutation、零 Runtime core 修改、零 schema 变更。
- 上游依据（冻结，未做新研究）：
  - `docs/QINGYAN_WORKFORCE_OBSERVABILITY_JOB_TIMELINE_DESIGN.md`（§5 状态词汇、§6 Progress、§7 CurrentTask、§9 NeedsYou、§18 Job Center 过滤、§24 API contract）
  - `docs/QINGYAN_WORKFORCE_JOB_READ_MODEL_REPORT.md`（#84 交付基线：`WorkforceJobViewModel` / `getWorkforceJobView` / `resolveWorkforceApiOrg`）
  - `docs/QINGYAN_WORKFORCE_PHASE2B_HANDOFF_PARALLEL_DESIGN.md`（worker/taskKind 可选契约、2B-2 并行前向兼容）

一句话：把已 merge 的 `WorkforceJobViewModel` 变成用户能理解的产品界面——**Job Center（列表）→ Job Detail（详情）**，全链路只读；用户看到"AI 在做什么、完成多少、哪里需要我、最终结果是什么"，永远看不到 AgentRun / lease / fence / trace 等 runtime 内部。

---

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `src/lib/workforce-runtime/read-model/list-service.ts` | **新增** `listWorkforceJobViews`：org 内分页列表投影（状态过滤 → internal status 集合、keyset 游标 updatedAt DESC/id DESC、limit clamp 1..50、批量子查询防 N+1、Lite 列表项契约）+ 游标 encode/decode（篡改 fail-closed） |
| `src/lib/workforce-runtime/read-model/api-org.ts` | **新增** `resolveWorkforceApiOrgForUser`：org 解析的生产装配（懒加载 db；两个 API 路由共用一份 org access 逻辑，零复制）+ 403 响应数据字典 |
| `src/lib/workforce-runtime/read-model/types.ts` | **增量** `finalSummary?`（最终结果摘要）+ `WorkforceJobListItem` / `WorkforceJobStatusFilter` 契约 |
| `src/lib/workforce-runtime/read-model/projection.ts` | **增量** `projectFinalSummary`：唯一结构化来源 = 最新 user-visible `job.completed` payload.summary；`job.failed` payload.report 结构性排除 |
| `src/app/api/workforce/jobs/route.ts` | **新增** `GET /api/workforce/jobs`（withAuth → org 重授权 → 列表；status/limit/cursor 全 fail-closed 校验） |
| `src/app/api/workforce/jobs/[id]/route.ts` | **收敛** org 解析装配到共享入口（响应形状不变；#84 语义原样） |
| `src/app/(main)/workforce/page.tsx` | **新增** Job Center：All / Working / Needs You / Completed 四 Tab、Job Card 列表、加载更多、刷新；loading / empty / 403 org selection / 403 no org / 5xx 状态齐备 |
| `src/app/(main)/workforce/[id]/page.tsx` | **新增** Job Detail：Header / Status / Progress / Current Tasks / All Tasks / Timeline / Needs You / Final Result / Business Refs；活跃任务 15s 轻量轮询（终态停止、页面不可见跳过）；loading / 404 / 403 / 5xx 状态齐备 |
| `src/app/(main)/workforce/job-card.tsx` | **新增** Job Card + 进度条 + Worker 徽标（复用组件） |
| `src/app/(main)/workforce/presentation.ts` | **新增** 纯展示层字典（零 React/零 I/O/零 LLM）：七态中文映射、任务状态映射、worker 职能名、timeline 文案选择、Needs You 卡片模型、最终结果占位、进度/时间格式化 |
| `src/lib/navigation/registry.ts` + `src/lib/i18n/{messages,zh,en}.ts` | **增量** WORK 组导航入口「AI 任务」（`/workforce`，桌面侧栏 + 移动抽屉自动生效） |
| `__tests__/list-service.test.ts` | L1-L9：过滤/排序/分页/租户隔离/只读/Lite 契约/finalSummary（36 断言，零 DB） |
| `src/app/(main)/workforce/__tests__/operator-ux.test.ts` | D1-D10：展示层契约 + 响应式静态审计 + §21 无 mutation 静态审计（85 断言，零 DB） |
| `scripts/test-all.sh` / `scripts/test-ci-unit.sh` | 注册两个新套件（纯逻辑零 DB，CI 子集可跑） |

## 2. 信息架构与产品词汇（任务书 §3-§5）

```
Job Center（/workforce）
  Tabs: 全部 · 进行中 · 需要你 · 已完成
  Job Card: Title / Status / Progress / Current Task(s) / Last Activity / Needs You
    ↓
Job Detail（/workforce/:id）
  Header · Status · Progress · Current Tasks · All Tasks · Timeline
  · Needs You · Final Result · Business Refs
```

用户面七态 → 友好中文（内部 status string 永不直出）：

| user status | 中文 | 语义色 |
|---|---|---|
| QUEUED | 排队中 | pending |
| WORKING | 进行中 | in-progress |
| NEEDS_YOU | 需要你 | warning |
| COMPLETED | 已完成 | success |
| PARTIAL | 部分完成 | warning |
| FAILED | 未能完成 | danger |
| CANCELLED | 已取消 | neutral |

任务级（AgentRunStep.status 透传值）同样全量字典映射；未知/未来值 fail-safe 显示「处理中」，绝不透传内部词汇。

## 3. List API（任务书 §12-§13）

```
GET /api/workforce/jobs?status=all|working|needs_you|completed|failed|cancelled&limit=1..50&cursor=<opaque>
→ 200 { jobs: WorkforceJobListItem[], nextCursor: string | null }
→ 400 非法 status / limit / cursor（fail-closed，不猜测）
→ 403 { needsSelection: true }（多可用 org 未选择）/ 403 无组织
```

- **org access 零复制**：列表与单 Job 路由共用 `resolveWorkforceApiOrgForUser` → `resolveWorkforceApiOrg`（#84 Final Review FIX A 原语义：activeOrgId 仅偏好、`canUserUseOrg` 现查重授权、stale/revoked/archived 拒用、多可用 org 绝不代选）。
- **过滤在 DB 层**按 internal status 集合完成（走 `[orgId, status]` 索引、分页语义稳定）：`working = {queued, acknowledged, planning, planned, executing, verifying, repairing, running}`（QUEUED/WORKING 细分由投影层逐行推导，同属一个 Tab）；`needs_you = {awaiting_approval, needs_human}`；`completed = {completed, partially_executed}`；`failed` / `cancelled` 独立词汇（UI 本期四 Tab，FAILED/CANCELLED 在「全部」可见）。
- **有界分页**：keyset 游标（updatedAt DESC, id DESC；行更新最坏造成重复出现，绝不漏 org 边界）；limit 强制 clamp 1..50；游标 base64url(JSON)，篡改/非法一律 400。
- **防查询放大**：页内子行 3 条 IN 批量查询（steps / `job.waiting_human` 定向事件 / pendingActions），零 N+1；列表项为 Lite 契约（无 timeline、无 tasks 全量）。

## 4. Tenant isolation（任务书 §14）

- 列表：每条查询强制 orgId；空 orgId fail-closed 返回空页零查询（测试 L6）。
- 详情：#84 原语义不变（orgId+runId+runType 三条件；跨 org = 404 不区分）。
- stale activeOrg：`canUserUseOrg` 现查失败 → 落 membership fallback；多可用 org → 403 needsSelection（UI 引导 `/select-org`）。

## 5. Final Result（任务书 §15）

- 唯一结构化来源：最新 user-visible `job.completed` 事件的 `payload.summary`（2B `aggregateJobResult` 落地后自动出现）。
- 今天（2B 前）该字段不存在 → UI 显示「尚未生成最终结果」（COMPLETED/PARTIAL）/「任务未能完成，暂无最终结果」（FAILED）/「任务完成后，这里会展示最终结果」（进行中）——全部字典占位，**前端零 LLM 拼装**。
- **深思后的 fail-closed 决定**：`job.failed` 的 `payload.report` 不透出——processor 失败分支可能把 `round.error`（内部错误原文/堆栈）写进该字段，透出即违反 §10；测试 L9 结构性锁定该行为。

## 6. Worker display（任务书 §7）

- `workerKey`（`inputJson.worker.id`，2B-1 落地后自动出现）→ 友好职能名：research=资料研究 / tender=投标 / sales=销售 / synthesis=综合汇总 / marketing=营销 / analytics=数据分析 / operations=运营。
- 缺失（存量 Job）→ 不渲染徽标；未知 key → 「数字员工」，内部 key 永不直出（D7）。
- scope / capabilities / authorized / permissions：展示层零出现（#84 读模型已结构性排除，UI 层不新增）。

## 7. Timeline 泄漏防线（任务书 §10）

三重闸门：

1. **读模型白名单**（#84）：类别白名单 ∩ visibleToUser，`tool.* / job.claimed / job.lease_renewed / step.started` 等 fail-closed 排除，条目不携带 payload；
2. **展示层文案选择**（本期）：PROGRESS / NEEDS_YOU 用事件人话标题（步骤标题/等待原因）；生命周期类（开始/恢复/终态/取消/调整）一律字典文案——runtime 写入的工程话术标题（如 "Workforce Job 已恢复"）不进用户面；
3. **渲染输出级测试**（D8）：对用户最终看到的字符串断言 `lease/租约/fence/trace/correlation/internalArgs/tool./stack/Workforce Job` 等词汇零出现；UI 源码审计禁止引用内部时间线字段。

## 8. Multi current task（任务书 §6）

`currentTasks[]` 数组契约从第一天生效（#84 投影既有）：卡片与详情全部按数组渲染，多任务标题「正在执行 N 项」，startedAt 升序；D6 用 3 并行任务验证（2B-2 落地零改动）。

## 9. Needs You（任务书 §11）

- 卡片：读模型字典标题（等待你审批 / 审批被拒绝，需要你决定后续 / 需要补充信息后继续 / 权限或账号状态发生变化，需要确认 / 需要人工处理）+ 结构化 detail + 涉及审批数。
- 只读入口：审批类 →「前往审批中心」（`/capabilities/approvals`，已有成熟 PendingAction 审批面）；其余类型本期无提交入口（详情已在卡片）。
- **零新增 mutation**：无 Approve / Reject / Resume / Clarification Submit / Replan 任何入口（§21 审计强制）。

## 10. Responsive / 状态完备（任务书 §16-§18）

- Job Center：单列卡片流（max-w-3xl），Tab 栏窄屏横滑；Job Detail：移动单列 → 桌面（lg+）主列 + 时间线侧栏双栏。
- 状态齐备：loading（骨架屏）/ empty（分 Tab 文案）/ 403 org selection（引导选组织）/ 403 无组织 / 404 / 5xx（重试）。
- 无 mock 数据：两页全部来自真实 API；fixture 只存在于测试进程。
- 视觉沿用青砚 Design System（既有 token：accent/success/warning/danger、StatusBadge、EmptyState、PageHeader），产品语气为「AI 幕僚」而非 runtime console。

## 11. Runtime core 边界（硬约束遵守证明）

```
RUNTIME_CORE_MODIFIED = NO
```

- `processor.ts / executor.ts / persist.ts / resume.ts / handoff 语义 / PendingAction executor`：git diff 零触碰；
- 本期全部改动 ∈ read-model 目录（附加投影）+ API 路由（只读）+ UI + 导航/i18n + 测试脚本；
- 既有目录级源码审计（service-read-only.test.ts）自动覆盖新文件：零 mutation API、零 Runtime core import、零顶层 db import 全通过；
- UI 层审计（operator-ux.test.ts）：零 mutation fetch、零 Runtime core import、不消费内部时间线。

## 12. 无 Mutation 审计（任务书 §21）

静态审计（测试强制，CI 长期执行）：

- `src/app/api/workforce/**` 全部 route.ts：仅 `export const GET`；POST/PUT/PATCH/DELETE 方法导出零出现；DB 写入标记（.create(/.update(/.delete(/$transaction 等）零出现；内部视图开关零出现；
- `src/app/(main)/workforce/**`：mutation fetch（method: POST/PUT/PATCH/DELETE）零出现。

## 13. 前向兼容

| 场景 | 表现 |
|---|---|
| 2B-1（worker/taskKind 落地） | 徽标自动出现（D7；契约可选字段） |
| 2B-2（并行多 running） | currentTasks 数组渲染 + 「正在执行 N 项」（D6） |
| 2B aggregateJobResult（payload.summary） | Final Result 自动从占位切换为真实摘要（L9） |
| 未知 internal run status | 列表不崩，fail-safe WORKING（L8） |
| 未知 step status / timeline kind / worker key / ref type | 字典 fail-safe（D7/D8），内部词汇不直出 |

## 14. 验证

| 套件 | 结果 |
|---|---|
| Workforce 列表服务 L1-L9（新增） | 36/36 |
| Workforce Operator UX D1-D10（新增） | 85/85 |
| 黄金投影 O1-O9（既有，增量后回归） | 74/74 |
| 只读/租户隔离（既有；目录审计自动覆盖新文件） | 37/37 |
| API org 访问解析 A1-A6（既有） | 13/13 |
| navigation IA/workspace/active（既有，注册表增量回归） | 99/99 |
| `tsc --noEmit` | PASS |
| `npm run lint:baseline` | PASS（零新增 error fingerprint；本期新文件 eslint 零告警） |
| `next build` | PASS（`/workforce` static shell + `/workforce/[id]` dynamic 产出） |
| `bash scripts/test-ci-unit.sh`（CI 子集全量本地执行） | PASS |

D1-D10 与套件映射：D1/D3/D4/D5/D6/D7/D8/D10 → operator-ux.test.ts；D2 → operator-ux.test.ts + list-service L2；D9 → list-service L6 + 既有 service-read-only 跨 org 契约。

## 15. 已知边界 / Debt（不在本期范围，记录在案）

| 项 | 说明 |
|---|---|
| `P2D1_BUSINESS_REF_LABEL_DEBT` | businessRefs 仅 type+id（#84 契约），UI 显示类型徽标（id 进 title 提示）；显示名 JOIN 属后续 2D 增量 |
| `P2D1_FINAL_RESULT_DEBT` | finalSummary 依赖 2B `aggregateJobResult` writer；落地前 COMPLETED Job 显示「尚未生成最终结果」占位（任务书 §15 预期行为） |
| `P2D1_VISUAL_VERIFICATION_DEBT` | 响应式以静态审计 + build 验证（worktree 无 .env，未起 dev server 做浏览器级回归）；Final Review 建议在 staging 预览走一遍 D10 手工核对 |
| `P2D1_NEEDS_YOU_BADGE_DEBT` | 导航/Tab 上的 Needs You 未读计数徽标需要轻量 count 端点，本期未做（避免超范围） |
| `P2D1_RUNTYPE_INDEX_DEBT` | 设计 §18 既有结论：`[orgId, runType, status, updatedAt]` 复合索引推迟到 Job 量产后实测（本期查询走 `[orgId, status]` 后过滤 runType，MVP 量级可接受） |

---

*本报告对应 Draft PR（保持 DRAFT，不 merge）；merge 前需 rebase 最新 main 确保包含 #85 / #86（任务书 §2）。*
