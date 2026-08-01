# 青砚核心业务链审计（Core Flow Audit）

**基准：** `80c76e4` | **日期：** 2026-07-31 | **只读**

对每条链：入口 → 模型 → API → Service → 状态 → 权限 → 错误 → 刷新 → 断点 → 测试。

---

## 业务链 A：客户 → 商机 → 报价 → 项目 → 任务 → 文件

### 入口页面
- 销售工作台：`src/app/(main)/sales/page.tsx`
- 客户详情：`src/app/(main)/sales/customers/[id]/page.tsx`
- 报价列表：`src/app/(main)/sales/quotes/page.tsx`
- 公开报价：`src/app/quote/[token]/page.tsx`
- 项目：`src/app/(main)/projects/page.tsx`, `projects/[id]/page.tsx`
- 任务：`src/app/(main)/tasks/page.tsx`, `tasks/[id]/page.tsx`

### 数据模型
- `SalesCustomer`, `SalesOpportunity`, `SalesQuote`, `SalesQuoteItem`, `CustomerInteraction`（`prisma/schema.prisma`）
- `Project`, `Task`, `ProjectDocument`
- 并行：`ProjectQuote`（项目报价，非 SalesQuote）
- **未发现** 强制 FK：`SalesOpportunity` → `Project` 一体转换（商机与项目耦合偏松）

### API / Service
- API：`/api/sales/customers`, `/opportunities`, `/quotes` …
- Org+Authz：`src/lib/sales/org-context.ts`（`resolveSalesOrgIdForRequest`, `resolveSalesAuthorizedWhere`）
- 阶段推进：`src/lib/sales/opportunity-lifecycle.ts`（`STAGE_ORDER`, `shouldAdvance`）
- 文件：`src/lib/files/*` + `/api/files` + `ProjectDocument`

### 状态变化
- 商机 stage：`new_lead → … → completed`（及 `lost`/`on_hold`）— `opportunity-lifecycle.ts`
- 报价 status：字符串字段（多处；前后端枚举需对照）— **NEEDS_VERIFICATION** 全量枚举一致性
- 任务 status：`Task.status`（schema）

### 权限检查位置
- Sales GET/POST：`authorize` / `resolveSalesAuthorizedWhere`（例：`src/app/api/sales/opportunities/route.ts`）
- data-scope：`src/lib/rbac/data-scope.ts`

### 错误处理
- `withAuth` 捕获 → `{ error: "服务器内部错误", requestId }`
- 业务 403/404 由各 route 返回

### 前端刷新
- 各销售页 `apiFetch` + 本地 `useState`/`load`；无统一 query cache（React Query 未见）

### 潜在中断点
1. **销售→项目断层：** 无单一「签约后一键建项目」主链（检索未见稳定 convert API）；运营可能手工建项目。  
2. **双报价：** `SalesQuote` vs `ProjectQuote` 易造成按钮/报表指错对象。  
3. **外贸并行链：** `TradeProspect` / `TradeQuote` 与销售链并存（`/trade`）。  
4. 工作区 `build` 失败阻断本地完整验证（见静态报告）。

### 已存在测试
- `src/lib/sales/__tests__/security1-sales-authz.test.ts`（本轮 PASS）
- 审计脚本：`npm run audit:sales-org` 等

### 缺失测试
- 端到端：客户→商机→报价→签约→项目→任务→上传文件  
- `opportunity-lifecycle` 自动化事件的集成测试（`test-all.sh` 注释曾移除「商机生命周期」虚挂项）

---

## 业务链 B：投标上传 → 解析 → Requirement → Evidence → Compliance → Approval → Lock → 输出

### 入口页面
- `src/app/(main)/projects/[id]/bid-data/page.tsx`
- `src/app/(main)/projects/[id]/bid-data/[revisionId]/page.tsx`
- 组件：`src/components/project-bid-data/*`

### 数据模型
- `BidDataRevision`（status: DRAFT|IN_REVIEW|APPROVED|LOCKED|SUPERSEDED|REJECTED）
- `TenderRequirement`, `ProductEvidence`, `ComplianceResponse`, `ComplianceResponseEvidence`
- `PricingScenario`, `PricingScenarioLineItem`
- 上游：`ProjectDocument` + orchestrator runs（source*RunId 字段）

### API / Service
- API 前缀：`/api/projects/[id]/bid-data/**`
- 入口上下文：`loadBidDataProjectContext`（`src/lib/project-bid-data/api-helpers.ts`）
- 状态机：`state-machine.ts`
- 服务：`review/requirement-service.ts`, `evidence-service.ts`, `compliance-service.ts`, `lock-revision.ts`, `approve-technical.ts`, `approve-financial.ts`
- 投影：`projection-service.ts`

### 状态变化
- Revision：`assertRevisionMutable` / `canSubmitForReview` / lock 仅 `APPROVED→LOCKED`（`lock-revision.ts`）
- 子对象 `reviewStatus`：DRAFT|NEEDS_REVIEW|APPROVED|REJECTED
- Compliance `status`：COMPLIANT|…|NOT_EVALUATED

### 权限
- `resolveBidDataAccess`（`access.ts`）— `canEdit` / `canLock` 等
- API 经 `withAuth` + project 成员上下文

### 错误处理
- `BidDataReviewError` + HTTP 映射（`api-error.ts`）
- 乐观锁：`expectedUpdatedAt`（`concurrency.ts`）

### 前端刷新
- Bid workspace 组件在 mutation 后重新拉取 revision（需页面级确认；**NEEDS_VERIFICATION** 每一按钮后是否统一 invalidate）

### 潜在中断点
1. Orchestrator 投影失败 → revision PARTIAL/BLOCKED（readiness）  
2. Lock 前 technical/financial 未 APPROVED → `blockingReasons`（`lock-revision.ts`）  
3. 工作区 build 失败文件：`orchestrator/.../approvals/route.ts` 语法错误可能拖垮相关审批 UI  
4. 「输出文件」生成路径分散在 `lib/projects/generate/*` — 与 LOCK 的强制耦合 **NEEDS_VERIFICATION**

### 已存在测试
- `phase4a1-bid-data.test.ts`, `phase4a2-approval-lock.test.ts`, `phase4a2-review-mid.test.ts`（抽样 lock 测试 PASS）
- orchestrator phase3 compliance/pricing 测试一组

### 缺失测试
- 真实文件上传→parse→投影→人工改 compliance→approve→lock→导出 的 E2E  
- 并发编辑冲突（expectedUpdatedAt）API 级测试

---

## 业务链 C：消息 → AI 判断 → Pending Action → 确认 → 副作用

### 入口页面
- 助手/收件箱：`src/app/(main)/assistant/page.tsx`, `inbox/page.tsx`
- 微信：`src/app/(main)/wechat/page.tsx`
- Capabilities 审批：`capabilities/approvals/*`（并行审批面）

### 数据模型
- `PendingAction`（status: pending|approved|rejected|executed|failed — `types.ts`）
- `WeChatMessage` / `WeChatContext` / `WeChatGraderContext`
- 副作用目标：`Task`, 讨论消息, Gmail draft（外部）, Sales 字段更新

### API / Service
- 列表/决策：`/api/ai/pending-actions`, `/api/ai/pending-actions/[id]`（`decision: approve|reject`）
- 执行：`src/lib/pending-actions/executor.ts` → `executePendingAction`
- 审批端口：`src/lib/approval/port.ts`（`approveApprovalItem`）
- Grader：`src/lib/ai-grader/*` + `actions/to-pending-action.ts`
- 类型：`grader.project_task`, `grader.email_draft`, `grader.internal_note`, sales/marketing/project.*（`types.ts`）

### 状态变化
- pending → approved/executed 或 rejected/failed  
- unsupported 类型：标记 failed，**不写业务数据**（executor 注释）

### 权限
- `withAuth` + `resolveAssistantOrgId`  
- `canConfirmPendingActionInActiveOrg`  
- `getOrgMembership`  
- `canDecideTeamApproval`  
- executor 内 orgId / metadata.orgId 二次校验

### 错误处理
- 403 跨组织；执行失败返回 error；Gmail OAuth 专项错误

### 前端刷新
- 决策后 API 可 reconcile AgentRun；UI 依赖卡片策略测试（`assistant-task-card-policy.test.ts`）  
- **NEEDS_VERIFICATION：** inbox 批准后是否总是移除卡片（无 E2E）

### 潜在中断点
1. **Capabilities Approval vs PendingAction** 双面审批，用户可能点错入口。  
2. Gmail scope/绑定失败 → draft 失败（历史 acceptance docs 提及 blockers）。  
3. `orgId` 为空的历史 PendingAction：列存在时强制 org；旧数据行为 **NEEDS_VERIFICATION**。  
4. 微信 worker 未运行 → 消息积压。

### 已存在测试
- `pending-action-bridge.test.ts`, `pending-action-run-integration.test.ts`, `gmail-draft-scenario.test.ts`, `thread-org-policy.test.ts`（抽样 PASS）
- `verify:enterprise-pending-loop` 脚本

### 缺失测试
- 微信真实回调→grader→pending→approve→Task 的集成（需 gateway）  
- 重复点击 approve 幂等（API 有 `duplicate` 分支，缺系统化 E2E）

---

## 业务链 D：登录 → 选组织 → 角色权限 → 读写 → 审计

### 入口页面
- `src/app/(auth)/login/page.tsx`, `register/page.tsx`, `select-org/page.tsx`
- 组织：`organizations/*`, `OrgSwitcher`, `OrgSelectBanner`
- 审计：`admin/audit-logs/page.tsx`

### 数据模型
- `User`, `Organization`, `OrganizationMember`, Role Profile 相关表  
- `AuditLog`

### API / Service
- `/api/auth/login|logout|me|active-org|switch-org|register`  
- Middleware JWT：`src/middleware.ts`  
- `authorize` / `resolve-effective-permissions`  
- `writeAuditLog` / `logAudit`：`src/lib/audit/logger.ts`

### 状态变化
- 会话 cookie；activeOrg 切换；成员 status `active`

### 权限检查位置
- Edge：middleware（仅登录，**不做 RBAC**）  
- Route：`withAuth` + 各域 org/authorize  
- 部分 route **未**用 `withAuth`（自建 `getCurrentUser` 或 token）— 见权限专项报告

### 错误处理
- 401 未登录；403 停用/无成员；审计写入失败可抛错中断事务（logger 注释）

### 前端刷新
- `ActiveOrgHydrator`；切换组织后依赖页面重载/重新 fetch

### 潜在中断点
1. Middleware 公开前缀过宽（如 `/api/cron`, `/api/v1`）— 依赖路由内二次鉴权。  
2. Super admin scope `null` 跨组织读取。  
3. 审计非所有写路径强制调用（覆盖率 **NEEDS_VERIFICATION**）。  
4. 双轨权限导致「页面能见、API 拒绝」或反向。

### 已存在测试
- `authorize.test.ts`, `org-access.test.ts`, `org-switch-audit.test.ts`, `security1-owner-manager.test.ts`（抽样 PASS）

### 缺失测试
- 跨组织 IDOR 模糊测试矩阵（全 API）  
- switch-org 后缓存串数据的前端测试

---

## 链间耦合小结

| 从 → 到 | 耦合强度 | 说明 |
|---|---|---|
| A 销售 → Project | 弱 | 无强制转换主链 |
| B Bid → Project | 强 | revision.projectId |
| C AI → A/B | 中 | PendingAction 写入 Task/Sales/Note |
| D 横切 | 强 | 所有链依赖 org + auth |
