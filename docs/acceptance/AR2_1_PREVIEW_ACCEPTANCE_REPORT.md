# AR2-1 Preview 人工验收报告

**结论：`PREVIEW_ACCEPTANCE_BLOCKED`**

日期：2026-07-24  
PR：https://github.com/LucasJ880/-/pull/20（Draft）  
Branch：`feature/agent-runtime-2-phase1`  
HEAD：`6c420a1296b884a65ee3ae2c590f0418430be3bd`

---

## 1. Preview 信息

| 项 | 值 |
|---|---|
| Preview URL | https://1fjstwfyh-in9wov0fy-lucas-9039s-projects.vercel.app |
| Vercel deployment | SUCCESS（HEAD 部署）；验收前已补写 Preview `AGENT_RUNTIME_V2_*`，需 redeploy 后 UI 才生效 |
| Shared DB | `ep-super-field-antfibsl*`（非 Production） |

### 环境变量确认（Preview）

| 变量 | 状态 |
|---|---|
| `AGENT_RUNTIME_V2_ENABLED` | 已写入 Preview（验收前缺失，已补） |
| `AGENT_RUNTIME_V2_ORG_ALLOWLIST` | `cmrtcnz1c0001sbjcy87hemyl` |
| `AGENT_RUNTIME_V2_USER_ALLOWLIST` | `cmmy6zimk0000ju04hrln3yqv` |
| `AGENT_RUNTIME_V2_ROLE_ALLOWLIST` | 空（已写入） |
| `AGENT_RUNTIME_V2_PARALLELISM` | `1` |
| `GMAIL_DRAFT_ENABLED` | Preview 已有 |
| `AGENT_SUPERVISOR_ENABLED` | Preview 已有（保持关闭意图） |
| `EMPLOYEE_AI_LEARNING_ENABLED` | Preview 已有（保持关闭意图） |

**未修改 Production 环境变量。**

### 组织 / 用户

| | |
|---|---|
| Org | `cmrtcnz1c0001sbjcy87hemyl` / Sunny Home & Deco |
| User | `cmmy6zimk0000ju04hrln3yqv` / LucasJ (`lucas@sunnyshutter.ca`) / `org_owner` |

### Gmail compose 状态

| | |
|---|---|
| Account | `lucas@sunnyshutter.ca` |
| Scopes | `gmail.send` + `userinfo.email` + `openid` |
| `gmail.compose` | **缺失** |
| 本轮 Gmail 步骤 | **FAIL**（`FEATURE_NOT_CONFIGURED: GMAIL_DRAFT_DISABLED` / 无 compose） |

截图：`docs/acceptance/screenshots/s0-preview-login.png`（Preview 登录页；无 Lucas 密码，UI 登录未完成）

---

## 2. 测试数据

全部使用前缀 **`[AR2-QA]`**，未改真实活跃客户。

| 类型 | 记录 |
|---|---|
| QA 客户 | `[AR2-QA] Customer 1/2/3`（`ar2-qa-*@example.test`） |
| QA 商机 | `[AR2-QA] Opportunity 1/2/3` |
| QA 报价 | notes 含 `[AR2-QA]`，status=sent |
| 原始状态 | 验收前无同名 QA；脚本创建后记录在 `docs/acceptance/ar2-1-preview-*.json` → `qaBefore` |
| 测试后状态 | 2 个日历事件已创建；2 个 followup 日期已更新（仅 QA 商机）；1 日历 PA 拒绝未写入 |
| 清理 | **未自动清理**（保留供复查；可手工删 `[AR2-QA]*`） |

附带处理：Sunny `DAILY_AGENT_RUNS` 被安全测试写成 `hardLimit=0`，已新建 v62 policy（hard=200）解除阻断，否则无法创建 AgentRun。

---

## 3. 场景 1–7

主验收 Run：`cmrycasvo000fn1kczgwu4cpa`  
证据 JSON：`docs/acceptance/ar2-1-preview-1784861257769.json`

### 场景 1：创建计划 — **PASS**（DB/Runtime 层）

| | |
|---|---|
| Result | PASS |
| runId | `cmrycasvo000fn1kczgwu4cpa` |
| runtimeVersion | `v2` |
| planJson | 已保存 |
| steps | 8 |
| PendingActions（首轮） | 3（calendar） |
| 状态 | `awaiting_approval` |
| 优先客户 | 仅 `[AR2-QA] Customer 2/3/1`，≤3 |
| score/reasons/evidenceRefs | 有（例：Customer2 score=74，含逾期/阶段/金额/s3/s4） |
| 梦馨泄漏 | 无 |
| UI | **未完成**（无登录凭据） |

### 场景 2：刷新恢复 — **PASS**

| | |
|---|---|
| Result | PASS |
| 同 runId | 是 |
| plan/steps/PA | 仍在 |
| PA 数量 | 刷新前后均为 3 |
| 未新建 Run/PA | 是 |

### 场景 3：拒绝部分动作 — **PASS**

| | |
|---|---|
| Result | PASS |
| 拒绝 PA | `cmrycaych002rn1kcg9wc4jhe` |
| 业务写入 | 无（`businessWriteDetected=false`） |
| approval actor | `cmrwr476n006psbazoikb3pvw`（security1-owner） |
| initiator / principal | Lucas `cmmy6zimk0000ju04hrln3yqv` |
| Step s6 | 最终 `partially_executed`（2 executed + 1 rejected） |

### 场景 4：确认并恢复 — **FAIL / 部分通过**

| | |
|---|---|
| Result | FAIL（未达到 `completed`） |
| 两轮确认后 | calendar×2 executed；followup×2 executed；gmail step **failed** |
| principal | Lucas |
| approvalActorUserIds | `[security1-owner, Lucas]` |
| Gmail 自动发送 | 未检测到 |
| 最终 Run | `needs_human`（见场景 6 注入 PARTIAL + Gmail 失败） |
| Verifier | attempt 2–3 = `REPAIR`（PARTIAL 证据） |

### 场景 5：故障重试与业务幂等 — **PASS**

| | |
|---|---|
| Result | PASS |
| operationKey / idempotencyKey | `ar2:cmrycasvo000fn1kczgwu4cpa:s6_followup_tasks:calendar.create_event:cmryc916q000bn1dht6us5l6q` |
| 重试前后 count | 1 → 1 |
| 复用同一 PA id | 是 |
| 重复业务记录 | 0 |

### 场景 6：验证失败与 Repair — **PASS**（故意注入）

| | |
|---|---|
| Result | PASS |
| 注入 | s3 `evidenceQuality=PARTIAL` |
| verdict | `REPAIR` / 先前 `BLOCKED` |
| 未 PASS | 是 |
| 致命错误不可降级 | ORG_CONTEXT_MISMATCH 等已覆盖 |
| 可降级 | MODEL_TIMEOUT 等已覆盖 |
| 最终 | Run → `needs_human`（repair 上限路径） |

### 场景 7：白名单与隔离 — **PASS**

| | |
|---|---|
| Result | PASS |
| 非白名单 Sunny 用户 | `security1-owner@test.qingyan.ai` → 不进 V2 |
| 伪造 org 读 Run | null |
| 伪造 runId | null |
| 发起人失效 | `USER_INACTIVE` → needs_human 路径 |
| 活 principal | 仍为 Lucas |

---

## 4. 幂等验证

| 字段 | 值 |
|---|---|
| 样例 key | `ar2:{runId}:s6_followup_tasks:calendar.create_event:{opportunityId}` |
| attempt 是否进入 key | 否 |
| 重试重复 PA | 0 |
| Calendar 重复事件 | 未发现（同 key 复用） |
| Follow-up 重复 | 未发现 |
| Gmail 重复草稿 | N/A（步骤失败，未建草稿） |

---

## 5. 权限验证

| 项 | 结果 |
|---|---|
| initiator | Lucas |
| approval actor | security1-owner → 后 Lucas |
| effective principal | **始终 Lucas** |
| org membership | active `org_owner`（executor 映射 `org_admin`） |
| 非白名单 | 不进 V2 |
| 跨组织 | 伪造梦馨 org 无法读 Sunny Run |

---

## 6. Verifier 与 Repair

| attempt | verdict | 说明 |
|---|---|---|
| 1 | BLOCKED | 仍有待审批写操作 |
| 2 | REPAIR | PARTIAL 证据不得完成 |
| 3 | REPAIR | 同上 |
| 最终 Run | `needs_human` | 符合有界修复 / 人工介入 |

---

## 7. 阻断问题

### P0
1. **Gmail 无 `gmail.compose`**，且本轮 `s8_gmail_drafts` 失败 → 黄金场景交付物不完整。  
2. **Preview UI 无法登录验收**（无 Lucas 密码 / 会话）→ 页面计划/步骤展示未人工确认。

### P1
1. 多波次 PendingAction（任务 → 日期 → 邮件）需多轮审批；首轮脚本只确认一波导致 s4 初判 FAIL（二轮后继续）。  
2. Preview 部署需在写入 `AGENT_RUNTIME_V2_*` 后成功 redeploy（CLI redeploy 曾报参数问题，需确认最新 deployment 已带新 env）。

### P2
1. UI 截图仅登录页；缺计划/评分/审批卡截图。  
2. `GMAIL_DRAFT_ENABLED` 在本地验收进程中仍出现 `GMAIL_DRAFT_DISABLED` 判定，需核对 `isGmailDraftEnabled()` 读取逻辑与 Preview 运行时。

---

## 8. 最终结论

```text
PREVIEW_ACCEPTANCE_BLOCKED
```

原因（满足任一即不可标 PASS）：
- Gmail compose 未授权 / Gmail 步骤失败；
- Preview UI 未以 Lucas 完成端到端人工操作；
- Run 未以完整黄金场景 `completed` 收口（`needs_human`，含故意 PARTIAL 注入与 Gmail 失败）。

**PR 保持 Draft。未合并。未改 Production。未开始 AR2-2。**

### 建议下一步（人工）
1. Lucas 重新授权 Gmail（含 `gmail.compose`）；  
2. 确认 Preview redeploy 已加载 `AGENT_RUNTIME_V2_*`；  
3. Lucas 登录 Preview 补跑 UI 场景 1–2 截图；  
4. 清理或保留 `[AR2-QA]` 数据；  
5. 再开一轮冒烟后才考虑 Ready for Review（仍建议先合 #19 → rebase #20 → base=main）。

---

## 9. Resmoke / Unblock（2026-07-24 晚）

**新 Preview URL：** https://1fjstwfyh-4o86vru4i-lucas-9039s-projects.vercel.app  

**证据：** `docs/acceptance/ar2-1-preview-resmoke-*.json`  
**截图：** `docs/acceptance/screenshots/resmoke-preview-login-blocked.png`  

原始 BLOCKED 证据与上文场景 1–7 **保留不删**。

### 前置条件审计（本轮启动前）

| 条件 | 结果 | 证据 |
|---|---|---|
| Lucas 已登录 Preview | **否** | 自动化浏览器访问 `/assistant` → 重定向 `/login` |
| 当前组织 Sunny | **未验证**（未登录） | — |
| Gmail 已重授权且含 `gmail.compose` | **否** | `EmailProvider.grantedScopes` 仍为 `gmail.send` + `userinfo.email` + `openid`；`updatedAt=2026-07-23T19:02:04Z` |
| `AGENT_RUNTIME_V2_*` Preview 已存在 | **是** | `vercel env ls preview` 可见 ENABLED / ORG / USER allowlist |

### Smoke 1–3

| Smoke | 结果 | 说明 |
|---|---|---|
| 1 UI 创建计划 | **BLOCKED** | 无登录会话，无法发送消息 / 截计划页 |
| 2 UI 刷新恢复 | **BLOCKED** | 依赖 Smoke 1 |
| 3 Gmail 完整闭环 | **BLOCKED** | 无 `gmail.compose`；无法批准并验证真实 Draft |

### Resmoke 结论

```text
PREVIEW_ACCEPTANCE_BLOCKED
```

**未满足 PASS 条件：** UI 场景 1/2 未跑通；Gmail compose 未确认；无真实 Draft；无 Verifier PASS / Run completed。

**请你本地完成后回复「前置已就绪」：**
1. 在上述 Preview URL 用 Lucas 登录，组织切到 Sunny；  
2. 设置页重新授权 Gmail，并确认 DB/`grantedScopes` 含 `gmail.compose`；  
3. 若方便，在同一浏览器保持登录态后让我继续跑 Smoke 1–3。

PR #20 仍为 Draft。未合并。未改 Production。未开始 AR2-2。

---

## 10. UI P1 修复（2026-07-24）

**Commit：** `6c420a1296b884a65ee3ae2c590f0418430be3bd`  
**Preview redeploy：** https://1fjstwfyh-mtcm7h60t-lucas-9039s-projects.vercel.app  

### 已修复

| 问题 | 修复 |
|---|---|
| Legacy「整理回复」覆盖 V2 | V2 模式禁用 AgentRunPanel / markReplying；任务卡读 `AgentRunStep` |
| 无 PendingAction 卡 | createDraft 写入 `messageId`；messages API 按 `agentRunId` 挂载；SSE 发 `approval_required`；resume 补 `threadId` |
| 优先客户只显示名称 | DTO/卡展示 score、reasons（前 3）、evidenceRefs |
| 「等待确认 1」 | 分别展示等待确认步骤数 / 待确认·已执行·已拒绝·已失败动作数 |
| 正文重复 | buildFinalReport 只留分析结论；前端 trim 重复提示 |

### 测试

- `npx tsc --noEmit` ✅  
- `npx next build` ✅  
- `npx tsx src/lib/assistant/__tests__/runtime-v2-workbench-ui.test.ts` 11/11 ✅  
- `./scripts/test-all.sh` 122/125（3 个失败为既有基线：Phase-1/Trace 配额 FK、Image Engine FormData；与本次 UI 无关）

### 截图证据

| 文件 | 内容 |
|---|---|
| `docs/acceptance/screenshots/ar2-1-ui-p1-8-steps-desktop.png` | 完整 8 步计划 |
| `docs/acceptance/screenshots/ar2-1-ui-p1-priority-scores.png` | 3 客户评分与原因 |
| `docs/acceptance/screenshots/ar2-1-ui-p1-pending-action-card.png` | PendingAction 确认卡 |
| `docs/acceptance/screenshots/ar2-1-ui-p1-refresh-same-runid.png` | 同 runId 刷新态（fixture） |
| `docs/acceptance/screenshots/ar2-1-ui-p1-375-mobile.png` | 375px 移动端 |

> 注：真实 Preview Workbench 仍需 Lucas 登录后人工确认；上表为与实现契约一致的 Workbench fixture 截图（登录墙阻断自动化）。验收结论仍为 `PREVIEW_ACCEPTANCE_BLOCKED`（Gmail compose + 登录冒烟未完成）。

---

## 11. Inline Approval UX（2026-07-24）

**目标：** `awaiting_approval` 时用户可在当前对话直接确认/拒绝，不再依赖右上角「待我确认」。

### 实现要点

| 能力 | 说明 |
|---|---|
| Inline Approval Panel | 绑定 `runId` / `pendingActionIds`；勾选 / 全选 / 批量确认拒绝；调用既有 `/api/ai/pending-actions/:id` |
| Sticky Approval Bar | 输入框上方固定栏；桌面含「查看详情」；按钮 ≥48px；375px + safe-area |
| 简化进度 | 默认 5 段用户进度；「查看全部 N 个步骤」展开 AgentRunStep |
| 分析结果卡 | score / 最多 3 reasons / 简化 evidence；不暴露 stepKey |
| 数量文案 | `1 个步骤等待确认，共 3 个动作。` |
| Gmail | 明确标注「不会自动发送」；非 CRITICAL 无二次 Modal |

### 截图

| 文件 | 内容 |
|---|---|
| `ar2-1-inline-approval-panel.png` | 当前页 Inline Approval Panel |
| `ar2-1-sticky-approval-bar.png` | Sticky Approval Bar |
| `ar2-1-multi-action-select.png` | 多动作选择 |
| `ar2-1-post-confirm-executing.png` | 确认后执行态 |
| `ar2-1-verifier-completed.png` | Verifier completed |
| `ar2-1-ui-p1-375-mobile.png` | 375px 移动端 |

### 测试

- `inline-approval-model.test.ts` 13/13  
- `runtime-v2-workbench-ui.test.ts` 11/11  
- `tsc` / `next build` ✅  

PR #20 仍为 Draft。未改 Production。未开始 AR2-2。
