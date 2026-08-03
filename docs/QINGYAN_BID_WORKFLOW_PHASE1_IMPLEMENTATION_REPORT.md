# 投标工作流 Phase 1 — 实施报告

**分支：** `feature/bid-workflow-optimization`  
**工作区：** `/Users/user/Desktop/青砚-bid-workflow`  
**基线：** `origin/main` @ `f277518`  
**日期：** 2026-08-04  
**状态：** Draft PR / 待审查（不合并 main，不跑生产 migrate）

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

1. 设 `bidPhaseStatus = INTELLIGENCE_IN_PROGRESS`
2. upsert 唯一 `BidIntelligenceRoom`
3. 创建缺失的八模块（已存在跳过）
4. 写初始摘要 / 任务 / Activity Log
5. 重复点击 `created: false`，不重复造模块/任务

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

（本地门禁运行结果见 PR 描述 / 下方验收节；以 CI 与本机命令输出为准。）

最低覆盖：
- `src/lib/bid-workflow/__tests__/bid-workflow-phase1.test.ts`（Cotton Towelling 结构 + 幂等语义常量 + 列表筛选）
- navigation IA / workspace 测试已更新 key
- migration history checksum

---

## 14. 延后内容

- 付费海关库、完整全球供应链图
- 外部供应商/客户门户
- 自动提交 Bonfire/Ariba
- 全量摘要刷新队列与 Firecrawl/Apify 深度编排
- Bid Data Layer（Requirement/Lock）应用层全面接线
- 中文 PDF 字体嵌入

---

## 15. 已知风险

1. Migration 未在隔离库验证前不可上生产  
2. 超长会话 Remote Control 可能因 missing blob 失败（与本功能无关）  
3. `china_supplier_brief` 中文渲染受限  
4. 供应商分桶为启发式（region/tags），非严格 companyType 字段  
5. `bidPhaseStatus` 与 `tenderStatus` 并存，UI 需持续区分「阶段」vs「决定」

---

## 16. 下一阶段建议

1. 隔离库跑 migration + Cotton Towelling E2E  
2. 调查室模块写入/编辑 API 与事实「建议保存」UX  
3. 摘要刷新去抖队列  
4. 中文 PDF 字体  
5. 情报子页从空状态接到真实 Trade Intelligence 数据  
