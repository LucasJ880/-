# 青砚按钮与交互失效风险审计

**基准：** `80c76e4` | **日期：** 2026-07-31 | **只读**  
**方法：** 抽样关键页面调用链（非穷尽全部 Button）。完整 UI 穷举标记为 NEEDS_VERIFICATION。

---

## 1. 审计范围与方法

已核对：

- 发布审核队列 `operations/review`
- Pending Action 决策 API
- 销售客户/商机 API 与 org banner
- Bid Data lock/approve 服务边界
- Build 失败对交互面的阻塞

未做：全站 Playwright 点击矩阵（无 CI E2E 默认跑通）。

---

## 2. 高风险交互清单

### BI-001 | 发布审核队列状态过滤过窄（P1，工作区）

| 项 | 内容 |
|---|---|
| 页面 | `src/app/(main)/operations/review/page.tsx` |
| 调用 | `GET /api/operations/publish-jobs?status=review,blocked` |
| 问题 | 工作区仅拉 `review,blocked`。`main` Phase C 引入 `pending_human_approval` 等状态后，若工作区代码对生产 tip，会**漏显示待审任务**（表现为「队列空」而非报错）。 |
| 事件绑定 | 有：`handleAction` → `POST .../approve|reject`；`busyId` finally 释放 |
| 错误提示 | 有 page-level / row-level |
| 重复提交 | `if (busyId) return` 防护 |
| 对照 | main tip 页面扩展了 status 列表（worktree 已改） |
| 分级 | **P1**（流程中断/漏审）；若生产已是 tip 则工作区问题为主 |

### BI-002 | 生产 Schema 落后时审核 API 500（P0，已在生产发生过）

| 项 | 内容 |
|---|---|
| 现象 | 「服务器内部错误」 |
| 机制 | `withAuth` catch → 通用 500；Prisma `P2022` 列不存在 |
| 依据 | 会话记录 + `api-helpers.ts` L100-110；Phase C 列依赖 |
| 当前 tip | 生产 migration DONE（报告记载）；**工作区代码仍可能与 tip 不一致** |
| 分级 | **P0**（核心功能不可用）— 部署/库版本漂移类 |

### BI-003 | Orchestrator Approvals 路由语法错误导致 Build 失败（P0，工作区）

| 项 | 内容 |
|---|---|
| 文件 | `src/app/api/projects/[id]/orchestrator/workflows/[rootTaskId]/approvals/route.ts:92` |
| 错误 | `??` 与 `&&` 混用缺括号 — Turbopack parse fail |
| 影响 | `npx next build` 失败；相关审批按钮在生产构建链上不可交付 |
| 前端 | 项目 orchestrator 审批 UI 依赖该 API |
| 分级 | **P0**（阻塞发布） |

### BI-004 | Org 歧义时操作被 Banner 阻断（P1，预期行为但易被误认为按钮坏了）

| 项 | 内容 |
|---|---|
| 组件 | `OrgSelectBanner` + `useCurrentOrgId` |
| 模式 | `ambiguous === true` 时多页 `load` early-return |
| 例 | review 页 `useEffect`：`if (orgLoading \|\| ambiguous) return` |
| 分级 | **P1** UX/流程中断（非权限 bug，但是高频「点了没反应」来源） |

### BI-005 | Pending Action 批准成功但执行失败（P1）

| 项 | 内容 |
|---|---|
| API | `POST /api/ai/pending-actions/[id]` |
| 链 | `approveApprovalItem` → executor |
| 风险 | 前端可能显示决策完成，executor 返回 `failed`/`GmailOAuthError` |
| 防护 | API 检查 `result.ok`；需确认所有 UI 卡片都读 `ok:false` |
| 分级 | **P1**；UI 全覆盖 **NEEDS_VERIFICATION** |

### BI-006 | Capabilities 审批页 vs Inbox 卡片双入口（P1）

| 项 | 内容 |
|---|---|
| 入口 A | `/capabilities/approvals` |
| 入口 B | assistant/inbox PendingAction 卡片 |
| 风险 | 同一业务审批概念两套 UI；一侧已处理后另一侧仍显示可点 → 重复提交或 409 |
| 分级 | **P1** |

### BI-007 | 静默 catch 导致「前端当成功」（P1/P2）

已见空/吞错 catch 示例：

- `src/app/api/sales/cockpit/weekly-report/route.ts`（`catch {}`）
- `src/app/api/sales/daily-briefing/route.ts`
- `src/app/api/sales/quotes/share/[token]/sign/route.ts`（`catch {}`）
- `src/lib/sales/insight-extractor.ts`（多处 `catch {}`）

全局约 **27** 处 `catch {}`（src）。  
分级：涉及签约/报价分享路径偏 **P1**；分析管道偏 **P2**。

### BI-008 | Loading 永久锁定（抽样）

| 页面 | 结论 |
|---|---|
| review | `busyId`/`loading` 均有 `finally` — 低风险 |
| 一般模式 | 多数自研 `useState`；若 `apiFetch` hang 无 timeout — **NEEDS_VERIFICATION** 全局 |

---

## 3. 交互审计检查表（模板结论）

| 检查项 | 抽样结论 |
|---|---|
| 是否绑定事件 | 关键 CTA 大多绑定；未发现明显「裸 Button」于 review |
| 权限隐藏/禁用 | Org banner / authz 403；前端未必禁用按钮 |
| 调用有效接口 | 多数有效；状态枚举漂移是主风险 |
| 参数与接口一致 | review 传 `orgId`；pending 传 `decision`+`orgId` |
| 返回后刷新 | review `await load()`；其它不一致 |
| loading 锁死 | 抽样有 finally |
| 错误提示 | withAuth 500 文案过于笼统 |
| 重复提交 | 部分有 busy 旗标 |
| overlay/CSS 阻挡 | 未做视觉审计 — **NEEDS_VERIFICATION** |
| 删除字段引用 | Phase C 字段在 tip 存在；工作区类型可能旧 |
| 前端成功后端失败 | 静默 catch + 双审批面 |

---

## 4. 建议的下一轮交互穷举（修复阶段，未经批准不执行）

1. Playwright：login → select-org → sales CRUD → pending approve → bid lock  
2. 对比 main tip 与工作区分支的页面 status 字符串  
3. 扫描 `onClick={() => {}}` / `href="#"` / 死链
