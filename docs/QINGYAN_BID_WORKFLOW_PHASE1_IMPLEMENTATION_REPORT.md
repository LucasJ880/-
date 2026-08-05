# 投标工作流 Phase 1 — 实施报告

**分支：** `feature/bid-workflow-optimization`  
**工作区：** `/Users/user/Desktop/青砚-bid-workflow`  
**基线：** `origin/main` @ `f277518`  
**日期：** 2026-08-04  
**状态：** Draft PR / `READY_FOR_REVIEW`（不自行 Ready、不 merge、不跑生产 migrate）  
**修复 Head（推送前以 git 为准）：** 见 PR #53 最新 commits

---

## 0. ADOPT_AFTER_CLEANUP 修复轮次（2026-08-04）

决策：采用 PR #53，不重建、不混入 PR #52 / agent-runtime-2 / Bid Data Lock。

### P0 修复结果

| 项 | 结果 |
|---|---|
| GO/HOLD/NO_GO 后 start 回退 `INTELLIGENCE_IN_PROGRESS` | **已修** — `phase-transition.ts` 保护终态/后续态 |
| 隔离库 migration 验证 | **PASS** — Neon 临时空项目 greenfield deploy |

### P1 完成情况

| 项 | 结果 |
|---|---|
| 幂等/并发（Room/Module/Task/Activity） | 已硬化；`started` vs `ensured` |
| 调查室可读性（去 raw JSON、可信度中文） | 已完成 |
| GO/HOLD/NO_GO + 备注 + Audit | 已完成；不写 `aiAdviceStatus`/`tenderStatus` |
| Supplier M2M POST/PATCH/DELETE | 已完成 |
| JoinBrief UI 入口 | 已完成 |
| China Supplier Brief 交付流 | 已完成（Helvetica 中文限制保留） |
| 列表筛选分桶 + 无关 engines/`orderBy` 清理 | 已完成 |

### 隔离数据库验证证据（无 Secret）

| 字段 | 值 |
|---|---|
| 数据库类型 | PostgreSQL 16 / Neon **ephemeral project**（验证后已删除） |
| 环境标签 | `DATABASE_ENVIRONMENT=isolated` |
| Host hint | `ep-morning-sky-au82j7fo`（非 `ep-super-field` / 非 Staging 名） |
| URL fingerprint (sha256前12) | `d1476e0f5643` |
| 开始/结束 (UTC) | `2026-08-04T05:15:15Z` → `2026-08-04T05:16:20Z` |
| `prisma migrate deploy` #1 | PASS（6 migrations 全量应用，含 `20260803200000_bid_workflow_phase1`） |
| `prisma migrate deploy` #2 | PASS（No pending） |
| `prisma generate` | PASS |
| 表/约束抽查 | PASS（`BidIntelligenceRoom_projectId_key`、`moduleKey` unique、SupplierLink unique 等） |
| Cotton Towelling fixture | PASS（见下） |
| 脚本 | `scripts/bid-workflow-isolated-migrate-verify.ts`、`scripts/bid-workflow-cotton-iso-fixture.ts` |

### Cotton Towelling 隔离验收

在临时库执行 domain 流程：**1 Room / 8 Modules**；二次 start `ensuredOnly`；Cox’s Bazar + CAD 886,410 上限说明 + INFERRED 供应链事实；两供应商关联→SHORTLISTED→解绑且 Supplier 保留；JoinBrief；人工 HOLD 后重启不回退；`ProjectGeneratedDocument` + fileUrl；模拟 AI 失败后 Project 仍可读。

### 门禁（本机 worktree）

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS |
| `npm run verify:migration-history` | PASS |
| `npm run build` | PASS |

### 已知限制（仍存在）

1. `china_supplier_brief` 中文 PDF 仍为 Helvetica（未嵌入中文字体）
2. 情报子页（周期/中标等）为「尚未启用」空状态
3. Cotton 验收为隔离库 **domain/fixture** 级，非完整 HTTP E2E 浏览器流
4. 判定 **不得** 自行标 `READY_FOR_MERGE` / 切换 PR Ready / merge

---

## 1. 审计结论

- **唯一主对象：** 复用既有 `Project`（`workDomain=tender`），**不**新建 `BidWorkspace`。
- **状态：** 新增 additive 字段 `Project.bidPhaseStatus`，不覆盖 `tenderStatus`。
- **供应商：** 复用 `Supplier`，新增 `ProjectSupplierLink` M2M，不新建第二套 Vendor 表。
- **PDF：** 扩展既有 `generate-docs.ts`（`china_supplier_brief`），不新建 PDF 引擎。
- **权限：** 沿用现有 org/project RBAC，不另建权限体系。
- **导航：** 项目 / 项目智能 / 供应商升为独立一级栏目，脱离「业务运营」。

详见 `docs/QINGYAN_BID_WORKFLOW_CURRENT_STATE_AUDIT.md` 与 `docs/QINGYAN_BID_WORKFLOW_PHASE1_PLAN.md`。

---

## 2. 最终数据模型

| 模型 | 作用 |
|---|---|
| `Project.bidPhaseStatus` | Phase1 投标阶段状态 |
| `BidIntelligenceRoom` | 每项目唯一调查室（1:1） |
| `BidIntelligenceModule` | 八个固定调查模块 |
| `BidIntelligenceFact` | 带来源与可信度的事实 |
| `ProjectSupplierLink` | 项目↔供应商多对多 |
| `ProjectJoinBrief` | 内部成员加入简报（幂等） |

---

## 3. 复用的现有模块

- `Project` / `Supplier` / `Task` / `AuditLog`
- `lib/activity/*` 活动流
- `lib/projects/generate/generate-docs.ts` PDF
- `lib/navigation/*` 导航注册与过滤
- `lib/tender/stage.ts` 倒计时
- `requireProject*Access` 权限门禁

---

## 4. 主要新增/修改文件

### Schema / Migration
- `prisma/schema.prisma`
- `prisma/migrations/20260803200000_bid_workflow_phase1/migration.sql`
- `scripts/verify-migration-history.ts`
- `scripts/check-release-safety.test.ts`

### Domain
- `src/lib/bid-workflow/*`（constants / labels / summary / start-intelligence / go-decision / join-brief）

### API
- `POST/GET .../bid-intelligence/*`
- `GET|POST .../supplier-links`
- `POST .../join-brief`
- `GET /api/projects` 支持 `bidListFilter` + `intelligenceRoom`
- members `POST` 自动 `ensureProjectJoinBrief`

### UI / Nav
- 项目列表投标筛选与字段
- 调查室页 + `StartIntelligencePanel` / `IntelligenceRoomClient`
- `IntelHubShell` + 智能子路由空状态
- `ProjectSupplierLinks`
- 供应商库分桶筛选
- 侧边栏一级栏目 `PROJECTS` / `PROJECT_INTEL` / `SUPPLIERS`

---

## 5. Schema 与 Migration

- Migration：`20260803200000_bid_workflow_phase1`
- **Additive only**，不 DROP；不绑 build
- Checksum 已写入 `verify-migration-history.ts`
- **禁止在生产/共享 Staging 直接 migrate**；合并前应用隔离库验证

---

## 6. 三个一级栏目

| 栏目 | 入口 | 职责 |
|---|---|---|
| 项目 | `/projects` | 投标/执行推进、列表阶段筛选、详情启动调查 |
| 项目智能 | `/projects/intelligence` + 子路由 | 调查室汇总 + 周期/中标/竞品等 IA |
| 供应商 | `/suppliers` | 公共供应商库 + 分桶筛选 |

---

## 7. 调查室自动创建（幂等）

`startBidIntelligence`（`POST .../bid-intelligence/start`）：

1. **仅当**当前阶段允许时才写入 `INTELLIGENCE_IN_PROGRESS`（GO/HOLD/NO_GO/BID_PREPARATION/SUBMITTED/AWARDED/LOST/WITHDRAWN **不回退**）
2. upsert 唯一 `BidIntelligenceRoom`（P2002 后重读）
3. 创建缺失的八模块（P2002 安全回收）
4. 初始 Task 以 `sourceId + sourceTemplateKey` 幂等
5. Activity：首次 `bid_intelligence_started`，重复 `bid_intelligence_ensured`
6. 重复点击 `created: false` / `ensuredOnly: true`，不重复造模块/任务

---

## 8. 八模块数据

固定 keys：`project_understanding` … `deliverables`；存于 `BidIntelligenceModule.dataJson` + `status`。

---

## 9. AI 对话与事实沉淀

- 调查室保留主 AI 入口（既有项目 AI tab / 调查室 client）
- `POST .../bid-intelligence/facts` 写入 `BidIntelligenceFact`（来源、URL、置信度、是否人工确认）
- Phase1 不做全量高成本摘要重算队列（事件触发可 Phase2）

---

## 10. 供应商跨项目复用

- `Supplier` 属 org 公共库
- `ProjectSupplierLink` 挂项目角色/询价/入选状态
- 详情页 `ProjectSupplierLinks` 组件可关联

---

## 11. PDF

- docType：`china_supplier_brief`
- 复用 jspdf；中文字体仍为 helvetica（已知限制，Phase2 增强）
- 生成前可走既有 generate 预览菜单

---

## 12. 权限

- 读写沿用 `requireProjectReadAccess` / `Write` / `Manage`
- 金额字段仍走既有隐藏策略，本轮不扩大权限双轨
- GO/HOLD/NO_GO **仅人工**，AI 不可自动批准

---

## 13. 测试结果

见上文 **§0** 门禁与隔离验证。额外：

- `src/lib/bid-workflow/__tests__/bid-workflow-phase1.test.ts`（状态机 / 幂等语义 / 筛选分桶 / 显示标签）
- navigation IA / workspace 测试已更新 key
- `npm run verify:migration-history` checksum 含 `20260803200000_bid_workflow_phase1`

---

## 14. 延后内容

- 付费海关库、完整全球供应链图
- 外部供应商/客户门户
- 自动提交 Bonfire/Ariba
- 全量摘要刷新队列与 Firecrawl/Apify 深度编排
- Bid Data Layer（Requirement/Lock）应用层全面接线
- 中文 PDF 字体嵌入
- 完整 HTTP/浏览器 E2E（权限否定路径浏览器断言）

---

## 15. 已知风险

1. ~~Migration 未在隔离库验证~~ → 本轮 ephemeral Neon 已 PASS；**生产仍禁止自动 migrate**  
2. 超长会话 Remote Control 可能因 missing blob 失败（与本功能无关）  
3. `china_supplier_brief` 中文渲染受限  
4. 供应商分桶为启发式（region/tags），非严格 companyType 字段  
5. `bidPhaseStatus` 与 `tenderStatus` 并存，UI 需持续区分「阶段」vs「决定」

---

## 16. 下一阶段建议

1. 人工审查 Draft PR #53 → 再决定是否 Ready / merge  
2. 调查室模块写入/编辑 API 与事实「建议保存」UX  
3. 摘要刷新去抖队列  
4. 中文 PDF 字体  
5. 情报子页从「尚未启用」接到真实 Trade Intelligence 数据  
