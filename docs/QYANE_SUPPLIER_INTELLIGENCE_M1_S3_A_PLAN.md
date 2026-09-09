# QYANE SUPPLIER INTELLIGENCE M1 — S3-A 实施说明

> 范围：S3-A（Tender 入口 + 中文采购阅读视图 + 搜索运行工作台 + 线索收件箱 + 人工身份确认）。
> 不做 S3-B/S4：无 Offering/Certification 登记流、无能力评估、无 RequirementMatch/Gate 执行、
> 无评分排名推荐、无 RFQ/询价/外发、无自动 Memory 写入、无新爬虫/新 Agent 编排。
> 零 schema、零 migration、生产 flag 保持关闭。

---

## 1. 复用位置（先定位、后实现）

### 1.1 页面与组件

| 需要的东西 | 复用什么 | 位置 |
|---|---|---|
| 工作台落点 | 既有 `notEnabled` 占位页（刻意留的 UI 家） | `src/app/(main)/projects/intelligence/supply-chain/page.tsx` |
| 页面外壳 + 兄弟页导航 | `IntelHubShell` | `src/components/bid-workflow/intel-hub-shell.tsx` |
| 应用外壳 / 容器宽度 | `(main)/layout.tsx` → `AppShell` | `src/components/app-shell.tsx` |
| 页头 | `PageHeader` | `src/components/page-header.tsx` |
| 侧栏详情 | `Drawer`（既有 5 处用法，含 focus trap / Esc / 滚动锁） | `src/components/ui/drawer.tsx` |
| 按钮 / 徽章 / 空态 / 弹窗 / 输入 / 分页 / Toast | `Button` `Badge` `StatusBadge` `EmptyState` `Dialog` `Input` `Label` `Pagination` `useToast` | `src/components/ui/*` |
| 来源引文渲染口径 | `serializeSourceRef` 的 `locationLabel` 优先级（非 PDF 用 `sectionLabel`，**不显示 p.N**） | `src/lib/tender-auto-analysis/serializers.ts:51-79` |
| 引文弹窗 | `SourceSnippetDialog` | `src/components/tender-analysis/source-snippet-dialog.tsx` |
| Tender 内入口 | `BidTab`（已托管国内供应商简报 + 供应商关联，是「找供应商」的既有家） | `src/components/project-detail/tabs/bid-tab.tsx` |
| 客户端请求 | `apiFetch` / `apiJson`（`/api/supplier-intel/` 已在 `ORG_SCOPED_API_PREFIXES`，orgId 自动附加） | `src/lib/api-fetch.ts:15-33` |
| 当前组织 | `useCurrentOrgId()`（含 `ambiguous` 多组织未选态） | `src/lib/hooks/use-current-org-id.ts` |

**不新造设计系统**：仓库无 card/table/tabs/skeleton 组件，卡片=`rounded-xl border border-border bg-card`，表格=原生 `<table>`，标签页=`<button>` 数组——沿用。
**不引入数据层**：全仓库无 React Query/SWR，沿用 `useState + useCallback + useEffect + apiJson`。
**颜色**：accent 上的文字用 `text-[color:var(--on-accent)]`（暗色主题会翻转 accent，`text-white` 会读不清）。

### 1.2 服务与 API（S2 已建好、零 UI 消费者）

`src/lib/supplier-intel/`：`access` `flags` `errors` `http` `signal-scope` `signal-service`
`run-service` `project-run-service` `discovery-service` `entity-resolution` `canonical-requirements`
`requirement-snapshot` `search-brief` `adapters` `providers` `internal-adapters`。
既有路由：`runs`(GET/POST) `runs/[id]`(GET) `runs/[id]/discover`(POST) `signals`(GET/POST) `signals/[id]`(GET/PATCH) `signals/[id]/resolve`(POST)。

---

## 2. 必要的 API 差量（最小扩展，不新建平行系统）

| # | 差量 | 为什么必须 |
|---|---|---|
| A | **新增** `GET /api/supplier-intel/projects/[projectId]/procurement-view` | 中文采购阅读视图无任何现成读接口；`loadCanonicalSupplierRequirementSnapshot` 只给三值与英文原文，不带中文/来源引文/关键事实 |
| B | **扩展** `GET /api/supplier-intel/signals`：`projectId` / `searchRunId` 过滤 + 稳定游标分页 + `total` | 既有列表无项目过滤、无分页、无计数；收件箱必须项目内、可翻页、列表与计数同口径 |
| C | **扩展** `POST /api/supplier-intel/runs/[id]/discover`：服务端重复执行保护 | 刷新/重复点击/重试不得并发跑两轮 provider；不能只靠按钮 disabled |
| D | **加固** `resolutionJson` 追加：行锁 + 锁内重读 | S3 开放多人操作入口，S2 已披露的非事务追加会丢审计条目 |
| E | 复用 `POST /api/suppliers`（canonical 人工建档）+ `GET /api/suppliers?search=` | 新供应商必须走既有 canonical 路径，不在情报域另建建档流 |

差量 A 的返回口径（诚实优先，缺失即显示「未提取 / 待确认」）：
- `requirements[]`：`code` / `category`+中文分组 / `textZh`（`chineseTranslation`）/ `textZhIsChinese`（`needsChineseTranslation` 反向判定）/ `textEn`（`originalRequirement`，永不覆盖）/ `mandatory` 三值 / `sources[]`（含 `locationLabel`）
- `mandatory` 三值来自 `classifyUncertainRequirementSource(RISKS)` 还原，**与 canonical loader 同一函数**；来源非 VALID 时整页显示阻断原因，不回退旧分析、不改判 false
- `criticalFacts[]`：从 `summaryJson.criticalFacts` 取 `{status, text}`，UNKNOWN 显示「未提取」
- **数量/单位**：`TenderExtractedRequirement` **无该列**（V2 mapper 在落库时丢弃），只呈现 `criticalFacts.quantity` 与需求原文，绝不按品类推断
- `analysis`：`runId` / `status` / `createdAt`，供「该搜索基于旧版需求」对比

**中文来源纪律**：优先用既有 `chineseTranslation`；仍是英文时显示「中文未生成」+ 英文原文，并指向既有 `招标要求` 页的翻译入口（`POST /api/projects/[id]/bid-fit/translate`，受控 LLM + 写权限 + 频率限制）。**S3-A 不新增任何 LLM 调用面**，不写回权威需求。

---

## 3. 用户操作流程

```
Tender 详情 →「标书与报价」页签 →「国内采购 / 找供应商」卡片 →
  进入 /projects/intelligence/supply-chain?projectId=<id>
    ├─ 采购要求：看懂买什么、哪些不能忽略（三值 + 来源引文 + 英文原文）
    ├─ 供应商线索：系统发现 + 手工添加，统一收件箱
    │    └─ 线索详情侧栏 → 核对是否已有供应商 → 关联 / 不采用
    │         └─ 无匹配 → 走 canonical 建档 → 再明确关联
    └─ 搜索记录：每次 Run 的需求版本、实发搜索词、逐来源状态与失败原因
```

按钮文案（不用 resolve/run/gate 等内部术语）：`开始找供应商` `查看搜索记录` `添加厂家线索` `核对是否已有供应商` `关联这家供应商` `不采用`。

---

## 4. 状态与权限矩阵

### 4.1 权限（全部服务端裁决，前端只做展示）

| 操作 | 级别 | 落点 |
|---|---|---|
| 打开工作台 / 读采购要求 / 读线索列表与详情 / 读搜索记录 | 项目 **read** | `requireProjectReadAccess` + `assertProjectAccessForActor(…, "read")` |
| 开始找供应商（建 Run + 执行发现） | 项目 **write** | 既有 `runs` POST / `discover` POST 双门 |
| 添加厂家线索 / review / reject / link / 核对身份 | 项目 **write** | `assertSubmitSignalAccess` / `assertSignalAccess(…, "write")` |
| 新建供应商 | 既有 `/api/suppliers` org 门 | 不放宽 |

flag 关闭 / org 不在 allowlist → 全部 404-dark，页面显示「本组织尚未启用」，不泄露项目数据。

### 4.2 状态文案（身份关联 ≠ 采购批准）

| 机器状态 | 页面文案 |
|---|---|
| 信号 `NEW` / `REVIEWED` / `LINKED` / `REJECTED` | 待查看 / 已查看待处理 / 已关联供应商 / 不采用 |
| 解析 `MATCHED_EXISTING` | 可能对应现有供应商，待人工确认 |
| 解析 `NEW_SUPPLIER_CANDIDATE` | 未匹配到现有供应商 |
| 解析 `NEEDS_HUMAN_REVIEW` | 身份存疑/冲突/扫描不完整，需人工判断 |
| `scan.complete === false` | 身份扫描未覆盖全部记录，结论不可用作强匹配 |
| Run `PLANNED/RUNNING/COMPLETED/FAILED/CANCELLED` | 待开始 / 搜索中 / 搜索已结束 / 搜索失败 / 已取消 |
| 源 `SUCCESS/EMPTY/DISABLED/FAILED/PLANNED` | 有结果 / 无结果 / 未启用 / 该来源失败 / 未执行 |
| COMPLETED 但有 FAILED 源 | 「搜索已结束，部分来源失败」——**不写成全部来源成功** |

一律不出现「认证通过 / 本标合格 / 首选供应商 / 可下单」。

---

## 5. 测试与风险

**自动化**：纯逻辑（分组/文案映射/分页游标/重复执行判定）→ `__tests__/*.test.ts`（进 `test:ci`）；
服务与 HTTP（T1–T11）→ 隔离库 `supplier-intel-s3a-db.isolated.test.ts`；
既有 S1/S2/S2-FR/S2-REM/S2-TB 与 Tender 回归全部保留。

**真实浏览器**：Playwright 驱动真实应用 + 隔离库（沿用 `scripts/*-smoke.mjs` 的 `POST /api/auth/login` + `PATCH /api/auth/active-org` + `localStorage qy_active_org_id` 模式），
覆盖 1440×900 / 1024×768 / 390×844，关键写操作回查数据库实际持久化结果。

**风险与对策**：

| 风险 | 对策 |
|---|---|
| 刷新/轮询/重复点击触发重复搜索 | 服务端执行声明（短锁 + 声明过期），GET 永不触发写；轮询只读、终态即停 |
| 多人同时 resolve/link 丢审计条目 | 行锁 + 锁内重读追加（网络与身份扫描保持锁外） |
| 历史 Run 被新需求污染 | 只渲染 Run 自带快照；当前 canonical 更新时提示「基于旧版需求」，只能新建 Run |
| 社媒文本注入 | 一律按不可信数据渲染（纯文本，不解释 HTML/指令）；不因用户提交 URL 发起抓取 |
| 内容域名被当成官网 | 展示层不写 `Supplier.website`；建档表单默认不预填 contentUrl |
| 组织/项目切换串数据 | 请求键含 org+project+run，切换即失效并放弃在途响应 |
| 数量/单位缺列被误当已知 | 显示「未提取」，不按品类推断 |
