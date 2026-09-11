# QYANE SUPPLIER INTELLIGENCE M1 — S3-A 交付报告

> 国内采购工作台第一个可用切片：Tender 入口 + 中文采购阅读视图 + 搜索运行工作台 + 线索收件箱 + 人工身份确认。
> **S3-A 完成 ≠ 整个 S3 完成**：S3-B / S4 未开始（见 §9 接续清单）。
> 零 schema、零 migration、生产库零触碰、生产 flag 保持关闭。

---

## 0. 基线与启动条件

| 项 | 值 |
|---|---|
| S2 合并提交 | `4070d6d83842427e6318ab92ad7d19f0cc76fbae`（PR #190 已 MERGED，复核确认） |
| 分支基点 | `origin/main` = `4070d6d8…`（`merge-base --is-ancestor` = YES，漂移 0） |
| 合并后 main 的 CI | run **34286886862** @ `4070d6d8` **completed success**（不复用旧 PR HEAD 的成功记录） |
| 新分支 | `feature/supplier-intelligence-m1-s3-a-workspace`（独立 worktree，自有 `node_modules` + 自有 Prisma client） |
| 用户工作区 | `feature/sales-quote-cost-foundation @ 9f9a43bb` 未触碰；无 reset/clean/stash/force |

启动六条要求逐条满足：#190 已合并 ✓；S2_MERGE_SHA 是 origin/main 祖先 ✓；读的是合并后 main 的 CI ✓；main 未变化故无增量需检查 ✓；CI 已 success 后才进入实现 ✓；无阻塞 ✓。

---

## 1. 本轮真正实现了什么

### A. Tender 内的采购入口
`src/components/supplier-intel/tender-sourcing-entry.tsx` 挂在「标书与报价」页签（该页签已托管国内供应商简报与供应商关联，是「找供应商」的既有家），带 `projectId` 跳转到唯一工作台。**没有**在 Tender 与工作台各建一套状态与 API。

### B. 中文采购阅读视图
- 服务：`src/lib/supplier-intel/procurement-view.ts` + `GET /api/supplier-intel/projects/[projectId]/procurement-view`
- 三值 mandatory 用**与开搜同一个函数** `classifyUncertainRequirementSource` 还原：`强制要求` / `强制性待确认` / `非强制要求`，**绝不出现「可选」**。
- 每条保留 requirement code、英文原文、中文译文、来源引文（沿用 `serializeSourceRef` 的定位口径：非 PDF 用 `sectionLabel`，**不伪造 p.N**；无来源显示「来源未定位」）。
- 中文缺失时显示「中文未生成」+ 英文原文，指向既有翻译入口；**本轮零新增 LLM 调用面**，不写回权威需求。
- 关键事实取 `summaryJson.criticalFacts`，UNKNOWN 一律「未提取」。
- **数量/单位**：持久层无该列（V2 mapper 落库时丢弃），页面明说这一点，不按品类推断。
- canonical 来源不可证完整 → 整页显示阻断原因与复核指引，**不回退旧分析、不改判 false**。

### C. 搜索运行工作台
- 「开始找供应商」是唯一写入口：服务端读 canonical 需求建 Run → 执行发现。客户端只提交项目指针。
- 逐来源状态五态可分：有结果 / 无结果 / 未启用 / 该来源失败 / 未执行；外部未启用时如实展示原因。
- **COMPLETED 且有失败源 → 「搜索已结束，部分来源失败（n/m）」**，不写成全部成功。
- 历史 Run 只渲染自带快照；当前分析已更新时提示「基于旧版需求」，只能新建 Run。
- 展示本次实际使用的搜索词、需求条数、内部/外部来源分列。

### D. 线索收件箱与人工确认
- 系统发现与人工提交统一走 `SupplierDiscoverySignal`，**没有**新建平行模型。
- 状态文案：待查看 / 已查看待处理 / 已关联供应商 / 不采用；解析结论：待人工确认 / 未匹配 / 需人工判断；扫描不完整时明说「不可用作强匹配」。
- 「核对是否已有供应商」→ 展示命中依据、冲突、扫描完整性 → 人工点「关联这家供应商」。解析命中的那家**直接可选并标注「系统命中」**。
- 不可信文本纯文本渲染；外链 `rel="noopener noreferrer nofollow"`；不因用户提交 URL 发起抓取；不把 contentUrl 写成 `Supplier.website`。

### E. 必要的服务端加固（S3 多人操作的直接支撑）
1. **重复搜索保护**：`claimRunExecution` / `releaseRunExecution`（短锁 CAS + TTL，写在既有 `statusDetailJson`），并让 `updateRunWorkingData` 在整块重写状态档时**保留执行声明**，堵住「写状态档 → 收口」之间的可重入窗口。新错误码 `RUN_EXECUTION_IN_PROGRESS`（409）。
2. **追加完整性**：`signal-write-lock.ts` 提供行锁 + 锁内重读的短事务追加；自动预填与人工 review/link/reject 两条写路径**同时**改用它。网络与身份扫描仍在锁外。
3. **收件箱查询**：`listSignalsPage`（项目过滤 + 稳定游标分页 + total，列表/计数同口径），项目筛选在**服务层与路由层各断言一次**读权限。

---

## 2. 复用了什么（没有重建）

`IntelHubShell` 页面外壳与兄弟页导航 · `Drawer` / `Button` / `Badge` 等既有原语（仓库无 card/table/tabs 组件，沿用手写卡片与原生表格）· `apiFetch`（`/api/supplier-intel/` 已在 org-scoped 前缀内）· `useCurrentOrgId`（含多组织未选态）· `serializeSourceRef` 引文口径 · `classifyUncertainRequirementSource` 三值还原 · `SupplierSearchRun` / `SupplierDiscoverySignal` / discovery / entity-resolution / 内部源优先 / provider 策略门 / egress 过滤 · canonical 项目权限 `requireProjectRead/WriteAccess` + `assertProjectAccessForActor` · canonical 供应商建档 `POST /api/suppliers` · 既有 `scripts/*-smoke` 的 Playwright 登录模式。

**没有引入**：新前端框架、新数据层、新设计系统、新任务队列、新爬虫/搜索客户端、新 Agent 编排、新审计框架。

---

## 3. 模拟 provider 与真实 provider 的区别（必须说清楚）

本轮**没有**接通任何真实外部搜索。验收环境里 `TENDER_EXTERNAL_INTEL_ENABLED` 未开、无 `TAVILY_API_KEY`，因此四个外部 adapter 全部如实显示「未启用」并给出原因；实际产生结果的只有**内部来源**（已存供应商 2 条）。
夹具里的「厂家」全部是**合成演示数据**（`[演示]` 前缀），**不是真实搜到的厂家**。真实外呼行为未验证。

---

## 4. 测试与真实运行验证

### 4.1 新增测试

| 套件 | 覆盖 | 结果 |
|---|---|---|
| `__tests__/procurement-view.test.ts`（纯核，进 `test:ci`） | 采购分组、三值文案、Run 收口文案、来源五态、平台能力、阻断原因 | **全部通过** |
| `__tests__/supplier-intel-s3a-db.isolated.test.ts`（服务 + HTTP，隔离库） | T2–T11 | **64 通过 / 0 失败** |
| `scripts/s3a-workspace-acceptance.mjs`（Playwright 真实浏览器） | T1 入口、三档视口、四类权限态 | **21 通过 / 0 失败** |

T2–T11 逐项落点：T2 中英文/三值/来源一致；T3 阻断且 Run=0、LLM=0、provider=0；T4 旧 Run 用旧快照且终态不可写；T5 重复执行保护（含状态档重写后仍拦截、TTL 过期可恢复）；T6 手工线索不抓取/不自动 LINK/不自动 VERIFIED；T7 review→link 真实持久化且不改写 `Supplier.website`；T8 只读/无项目/org_admin 权限矩阵；T9 跨项目列表·计数·详情一致 + 分页稳定 + 服务端页大小上界 + 越权筛选被拒（服务层与 HTTP 各一次）；T10 并发 resolve 与 resolve×link 追加完整性（4 条条目齐全、拒绝态不复活）；T11 三值 HTTP 透传、403 零内容、`Supplier.website` 全程未被覆盖。

### 4.2 既有回归（本轮实跑，非引用）

| 套件 | 结果 |
|---|---|
| Supplier Intel 纯核 13 套 | 全部 exit 0 |
| S1 审计脊柱 DB | **86 / 0** |
| S2 发现编排 DB | **32 / 0** |
| S2-FR 终审回归 DB | **38 / 0** |
| S2-REM 整改回归 DB | **42 / 0** |
| S2-TB 信任边界 DB+HTTP | **118 / 0** |
| S3-A 工作台 DB+HTTP（新） | **64 / 0** |
| Tender Intel / Understanding 8 套 | 全部 exit 0 |
| T4 授标情报 DB | **18 passed / 0 failed** |

B4/B5/F1、R1/R2、列表一致性、指针对称、取消晚到结果、来源失败分级、内部优先、egress 的既有断言**全部原样保留并通过**：无删除、无跳过、未升级测试角色、未放宽权限或事务约束、未扩大 lint baseline。

**环境注意**：DB 套件与 dev server 争用同一隔离分支会触发 Prisma 事务超时（P2028）——先停 dev server 再跑回归，本轮即如此。

### 4.3 真实浏览器验收（本地隔离环境）

`scripts/s3a-workspace-acceptance.mjs`（Playwright，真实登录 + 真实 UI + 隔离库）：**21 项断言全过**，截图落 `.s3a-screenshots/`：

| 场景 | 截图 |
|---|---|
| 中文采购阅读视图 | `requirements-desktop-1440x900.png` / `-laptop-1024x768.png` / `-mobile-390x844.png` |
| 搜索记录（逐来源状态） | `runs-desktop-1440x900.png` |
| 线索收件箱 | `signals-desktop-1440x900.png` / `-laptop-1024x768.png` / `-mobile-390x844.png` |
| 只读用户（无写按钮） | `viewer-signals-desktop-1440x900.png` |
| 无项目权限 | `forbidden-desktop-1440x900.png` |
| 无项目上下文 | `no-project-desktop-1440x900.png` |

三档视口均无横向溢出。

**关键写操作的持久化回查**（不止截图）——手工提交线索 → 核对身份 → 关联供应商后直接查库：

```
status                 = LINKED
linkedSupplier         = 佛山市演示家具有限公司（fixture）
Supplier.website       = https://demo-furniture.example   ← 未被 contentUrl 覆盖
rawText                = 展会认识的佛山办公椅厂 <img src=x onerror=alert(1)> 联系人王经理  ← 原样保存
resolutionJson 条目     = [AUTO_PREFILL, AUTO_PREFILL, HUMAN_LINKED]（3 条，无覆盖丢失）
```
注入的 HTML 在页面上以**文本**出现，DOM 里 `img[src="x"]` 计数为 0，未执行。

### 4.5 构建捕获的真实缺陷（已修）

`next build` 报 `UnhandledSchemeError: node:crypto`：客户端面板从 `procurement-view.ts` 取分组与文案，
而该模块经 `access → tenancy/context → trade/access → cron/auth` 依赖 `node:crypto`，属 server-only。
修法：把纯展示映射抽到 `procurement-display.ts`（无 DB、无 server-only 依赖），
客户端与服务端共用同一份口径；`procurement-view` 再导出，服务端调用方不变。
**这条缺陷只有真实 build 能抓到**——`tsc` 与单测都不检查客户端包边界。

### 4.4 三类业务验收场景（合成夹具）

`scripts/s3a-fixture-seed.ts` 造三个项目：标准成品采购（办公椅）／需要定制规格（实验台）／国内供货 + 加拿大安装（储物柜），每个都含 true/false/uncertain 三值需求。采购同事可在页面上回答「买什么、哪些条件不能忽略、找到哪些线索、哪些身份已确认」。
**未以「必须找到三家合格工厂」为验收条件**；没有结果时页面如实显示无结果。

---

## 5. 未实现 / 未验证

**本轮范围外（按任务书 §3 明确不做）**：Offering / Certification 登记流、能力评估、RequirementMatch 与 Mandatory Gate 执行、评分排名与 PRIMARY/BACKUP 推荐、RFQ 与任何对外发送、PO/付款/到岸成本、新 PDF 生成、自动写 Corporate Memory、直连抖音/小红书/视频号登录态内容。

**未验证**：
- 真实外部 provider 行为（本轮外部来源全程「未启用」）；
- staging 运行时（部署保护墙，见 §7）；
- 真实采购同事 UAT — **NOT_RUN**；
- 全量 `scripts/test-all.sh`（任务书未要求）。

---

## 6. 已知债务

| 项 | 说明 |
|---|---|
| 逐条需求无 quantity/unit | 持久层缺列（V2 mapper 丢弃）。页面明示「未提取」。根治需 tender 侧 schema（与既有 SCHEMA_REQUIRED 同一批） |
| 中文译文可能仍是英文 | 旧分析未跑翻译时 `chineseTranslation` 存英文；本页显示「中文未生成」并指向既有翻译入口，不在此新增 LLM 面 |
| `POST /api/suppliers` 无审计 | 既有 canonical 建档路径本身不写审计（与情报域逐写审计形成反差）。本轮复用未改，记为跟踪项 |
| 执行声明依赖 `statusDetailJson` | 无 schema 可用的独立列；已用 TTL + 保留逻辑覆盖崩溃与整块重写两种情况 |
| S2 遗留 | 第 4 份 Tavily、`internalPoolLimit` 无上限、`Supplier.website` 无 scheme 不参与对质、org_admin 列表 `in` 规模、tender 三值列 SCHEMA_REQUIRED — 全部**保持跟踪**，本轮未处理也未宣称已解决 |

---

## 7. 环境、回滚与生产状态

- 生产 `SUPPLIER_INTEL_ENABLED` **未设置**（`vercel env ls production` 无任何 `SUPPLIER_INTEL*`），全部入口 404-dark；本轮**未改任何生产配置**。
- 验证只用隔离 Neon 分支 `s3a-20260909`（`PROD_PREFIX_MATCH=false`），dev server 通过 worktree 本地 `.env.local` 指向它（该文件被 `.gitignore` 覆盖，未提交）。
- **回滚方式**：本 PR 未合并即无影响；若已合并需回滚，`git revert` 该 merge 即可——零 schema、零 migration、零生产开关，回滚不涉及数据迁移。功能层面另有一道保险：生产 flag 未开，代码上线也是暗态。

---

## 8. 操作说明（给采购同事）

1. 打开招标项目 →「标书与报价」→「国内采购 / 找供应商」→ 进入采购工作台。
2. **采购要求**：先看「关键信息」（缺的会写「未提取」），再按分组看逐条要求。红色「强制要求」和橙色「强制性待确认」都不能忽略；「查看来源」能看到原文出处。中文没生成时下面就是英文原文。
3. **开始找供应商**：点一次就够，页面会自己刷新状态；关掉页面不会取消服务器上的搜索。
4. **供应商线索**：系统找到的和你自己加的都在这里。点「添加厂家线索」可以粘贴链接或直接写情况——系统只存文字，不会去打开那个网页。
5. 点开一条线索 →「核对是否已有供应商」→ 看命中依据和冲突提示 → 确认无误再点「关联这家供应商」。**关联只表示这是同一家公司，不代表这家厂通过了采购审核。**
6. 库里没有这家 → 到「供应商」页按既有流程建档，再回来关联。

---

## 9. S3-B 接续清单（本轮不实现）

1. SupplierOffering 登记/编辑工作流（型号、价格状态 UNKNOWN 合法）。
2. SupplierCertification 登记与人工验证（VERIFIED 只能人工 + 独立证据）。
3. capability 标注（人工为主、AI 辅助必须带标且 confidence ≤ 0.8）。
4. 供应商详情页的 Sources / Social Evidence 区块。
5. 线索批量处理与更强的筛选（按来源、按 Run、按平台组合）。
6. 视频号等 USER_ASSISTED 来源的引导式录入。
7. 采购要求 → 供应商能力的**人工**对照视图（评估执行属 S4）。

---

## 10. 汇报键值块

```
QYANE_SUPPLIER_INTELLIGENCE_M1_S3_A_DELIVERY

S2_MERGE_SHA = 4070d6d83842427e6318ab92ad7d19f0cc76fbae
S3_BASE_MAIN_SHA = 4070d6d83842427e6318ab92ad7d19f0cc76fbae（merge-base --is-ancestor = YES）
BASE_MAIN_CI = PASS（run 34286886862 @ 4070d6d8，push 事件，completed success——读的是合并后 main，不复用旧 PR HEAD）
BRANCH = feature/supplier-intelligence-m1-s3-a-workspace
PR = #208
PR_STATE = DRAFT

CODE_HEAD_SHA = 20df0bc3bf7105b7469cc85f0138bd6c3d458744
FINAL_PR_HEAD_SHA = 本报告所在的 docs-only 提交（sha 与其 CI 见交付说明；报告无法自述自身 sha）
REMOTE_MAIN_SHA_AT_FINISH = 4070d6d83842427e6318ab92ad7d19f0cc76fbae
MAIN_DRIFT = NO（0 提交）

TENDER_ENTRY = DONE（「标书与报价」页签入口卡片，带 projectId 进入唯一工作台）
CANONICAL_WORKSPACE_REUSED = YES（激活既有 /projects/intelligence/supply-chain 占位页，未新建平行入口）
CHINESE_PROCUREMENT_VIEW = DONE（分组 + 三值 + 英文原文 + 关键事实；缺失即「未提取」，不推断）
SOURCE_CITATIONS = DONE（复用 serializeSourceRef 定位口径；非 PDF 用 sectionLabel，不伪造 p.N；无来源显示「来源未定位」）
MANDATORY_TRISTATE = DONE（强制要求 / 强制性待确认 / 非强制要求；纯核与 DB/HTTP 双重断言「绝不显示成可选」）
HISTORICAL_SNAPSHOT_INTEGRITY = DONE（历史 Run 用自带快照；新分析不改写；终态不可写；提示「基于旧版需求」）

SEARCH_RUN_UI = DONE（唯一写入口；内部源优先；客户端只提交项目指针，不暴露 finalize/internalPoolLimit）
DUPLICATE_SEARCH_PROTECTION = DONE（服务端短锁 CAS + TTL；状态档整块重写后仍拦截；不依赖前端 disabled）
SOURCE_STATUS_TRANSPARENCY = DONE（五态可分；COMPLETED 有失败源说「部分来源失败」；未启用来源给出原因）
MANUAL_SIGNAL_INGESTION = DONE（链接/文字；不抓取、不自动 LINK、不自动 VERIFIED）
SIGNAL_INBOX = DONE（系统发现与人工提交统一模型；项目过滤 + 有界游标分页 + 计数同口径）
HUMAN_SUPPLIER_LINK = DONE（展示命中依据/冲突/扫描完整性；命中那家标「系统命中」并可直接关联；409 提示刷新不覆盖他人）
CANONICAL_MANUAL_SUPPLIER_CREATE = REUSED（沿用 POST /api/suppliers 既有建档流；本轮不在情报域另建）
CONCURRENT_REVIEW_AUDIT_INTEGRITY = DONE（行锁 + 锁内重读；并发 resolve 与 resolve×link 条目齐全、拒绝态不复活）

PROJECT_ORG_ACL = PASS（读=项目 read，写=项目 write；服务层与路由层各断言一次）
LIST_COUNT_DETAIL_PARITY = PASS（同一 where；越权项目筛选服务层与 HTTP 均拒绝）
ORG_PROJECT_CACHE_ISOLATION = PASS（请求键含 org+project+run；切换即 abort 在途请求并清空数据）
CONTENT_URL_OWNERSHIP_REGRESSION = PASS（全流程后 Supplier.website 未被 contentUrl 覆盖，DB 回查确认）
SOCIAL_TRUST_BOUNDARY = PASS（注入 HTML 以文本呈现，DOM 中 img[src=x] 计数 0；外链 nofollow；不自动抓取）

UNIT_COMPONENT_TESTS = PASS（procurement-view.test.ts 纯核，已进 test:ci）
API_DB_TESTS = PASS（supplier-intel-s3a-db.isolated.test.ts 64/0，覆盖 T2–T11）
BROWSER_E2E = PASS（s3a-workspace-acceptance.mjs 21/0，真实登录 + 真实 UI + 隔离库）
REGRESSION = PASS（S1 86/0 · S2 32/0 · S2-FR 38/0 · S2-REM 42/0 · S2-TB 118/0 · 纯核 13 套 · Tender 8 套 · awards-db 18/0）
SCREENSHOT_EVIDENCE = DONE（.s3a-screenshots/ 共 10 张，含 1440×900 / 1024×768 / 390×844 三档）
LOCAL_RUNTIME_SMOKE = PASS（本地 dev server + 隔离库跑通完整流程，关键写操作回查数据库持久化结果）
REAL_PROCUREMENT_USER_UAT = NOT_RUN（无真实采购同事试用）

TYPECHECK = PASS（tsc --noEmit --incremental false）
LINT_CHANGED_FILES = PASS（23 个改动/新增文件，0 problems）
LINT_BASELINE = PASS（current 41/137 vs baseline 53/111；无新增 fingerprint；未扩大 baseline）
BUILD = PASS（npm run build exit 0；TypeScript 78s；361/361 静态页。首次构建曾捕获客户端包边界缺陷，已修后通过）
CI_HEAD_SHA = 20df0bc3bf7105b7469cc85f0138bd6c3d458744（代码 HEAD；报告 docs-only 提交的 CI 见交付说明）
CI = PASS（run 34303796519，全部步骤 success，2026-09-09T02:42:52Z；含新增的 procurement-view 纯核与 S3-A DB 套件——后者在 CI 无隔离库时按设计跳过）
STAGING_HEAD_SHA = 20df0bc3bf7105b7469cc85f0138bd6c3d458744
STAGING = READY（dpl_5wrEUMD9LFrhbsxqaEUkJaYq3Rhs，preview，`vercel ls --meta githubCommitSha=20df0bc3…` 唯一命中）
STAGING_RUNTIME_SMOKE = NOT_RUN（部署保护墙；未解除保护、未切生产开关制造 PASS）

SCHEMA_CHANGED = NO
MIGRATION_CHANGED = NO
PRODUCTION_DB_TOUCHED = NO（仅生产 project 的临时子分支 s3a-20260909，PROD_PREFIX_MATCH=false）
PRODUCTION_FLAGS_CHANGED = NO（生产无任何 SUPPLIER_INTEL* 变量，全部入口 404-dark）
ISOLATED_DB_CLEANUP = DONE（br-nameless-wind-an4bsro6 已删；复核 s3a-/r1-s2/tb-s2/rem-s2/reval-s2 前缀剩余 0；连接串文件与 .env.local 已删除）
ORIGINAL_WORKTREE_PRESERVED = YES（feature/sales-quote-cost-foundation @ 9f9a43bb 未触碰；未 reset/clean/stash/force）

BLOCKERS = NONE
DEFERRED_ITEMS = S3-B 七项接续清单（§9）；逐条 quantity/unit 缺列（tender 侧 SCHEMA_REQUIRED）；中文译文可能仍是英文；POST /api/suppliers 无审计；执行声明寄存 statusDetailJson；S2 遗留六项（第 4 份 Tavily / internalPoolLimit 无上限 / website 无 scheme / org_admin in 列表规模 / staging 冒烟 / 三值列）
UNVERIFIED_ITEMS = 真实外部 provider 行为（本轮外部来源全程未启用，夹具厂家为合成数据）；staging 运行时；真实采购同事 UAT；全量 scripts/test-all.sh
RECOMMENDATION = READY_FOR_S3_A_FINAL_REVIEW

S3_A_IMPLEMENTED = YES
S3_ALL_COMPLETE = NO
S3_B_STARTED = NO
S4_STARTED = NO
PR_MERGED = NO
PRODUCTION_ENABLED = NO
```
