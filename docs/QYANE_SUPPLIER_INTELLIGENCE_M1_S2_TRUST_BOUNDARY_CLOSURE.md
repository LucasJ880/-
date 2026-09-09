# QYANE_SUPPLIER_INTELLIGENCE_M1 — S2 Trust-Boundary Closure（R1 项目信号 ACL / R2 canonical 来源）

> 本轮范围：上一轮《S2 Final Remediation》报告第 10 节里，与**既有权限模型**和 **uncertain fail-closed 边界**冲突的两项。
> 不重做 BL1–BL4，不重新全盘审计，不动 schema/migration/生产库/生产 flag，不开 S3，不恢复 Tender Procurement V2。
> 约定：行号取自本轮 HEAD 检出；「实跑」= 在隔离 worktree（自有 node_modules + 自有 Prisma client）与隔离 Neon 分支上真实执行并留有日志（`scratchpad/s2-tb/*`，已复核无连接串）。未实跑一律 NOT_RUN。

---

## 0. 基线与工作区

| 项 | 值 |
|---|---|
| 仓库 / PR | `LucasJ880/-` #190（`feature/supplier-intelligence-m1-s2`），全程 **DRAFT** |
| 上轮已审 PR HEAD（BASE_PR_HEAD） | `25deada7211995bb4d58a17cfe44fff3c83596b5`（docs-only 提交） |
| 上轮已测代码 HEAD | `fb7f91cf865062583aca6754885b1f8b5c3401d1` |
| 重新 fetch 后的实际 PR HEAD | `25deada7…`（与 LAST_REVIEWED_PR_HEAD 一致，**期间无他人新增提交**：`rev-list 25deada7..origin/…` = 0） |
| 重新 fetch 后的实际 main | `5933ff7a0b17b343982cbe836ffb4931122e2e69`（与 LAST_OBSERVED_MAIN 一致，漂移 0） |
| 工作区 | 独立 worktree `scratchpad/s2-tb-wt`（新建，用完移除）；用户检出 `feature/sales-quote-cost-foundation @ 9f9a43bb` 未被触碰 |
| 依赖隔离 | worktree 内 `npm ci` + `prisma generate`（**不复用、不覆盖**用户检出的 `node_modules`/生成客户端——共享客户端相对 S2 分支已陈旧，缺 main 的 4 个模型） |

「代码 HEAD 与 PR HEAD 不混用」：本轮所有验证跑在**代码 HEAD**（见 §8）上；报告自身的 docs-only 提交另记 FINAL_PR_HEAD_SHA，CI 以实际 PR HEAD 为准。

---

## 1. R1：项目级授权贯穿信号读写

### 1.1 最小复现（修复前）

同一个 org、两个项目 A/B、一个只在 B 有 `project_admin` 的用户：

```
# 项目 A 的信号（甚至 projectId 为 null、只挂在项目 A 的 Run 上）
getSignal(actorInB, sigA)        → 返回完整正文（含 rawText / capability）
listSignals(actorInB)            → 列表里照单全收
reviewSignal / rejectSignal /
linkSignalToSupplier(actorInB)   → 状态、关联被改写
POST /signals/[id]/resolve       → resolutionJson 被 append（写操作走成了「只算不动状态」）
POST /signals {searchRunId: runA} → 借项目 A 的 Run 建信号
```

根因：5 个 HTTP 入口只调用了 `requireSupplierIntelAccess`（flag + 租户 + org allowlist），**没有**接 canonical 项目门；服务层 `signal-service.ts` 的查询条件只有 `orgId`。而 Run 面在 S2 B3 已经收口到 `requireProjectRead/WriteAccess` + `assertProjectAccessForActor`——信号恰恰是 Run 的产物（供应商线索、平台账号、预填结论），可见性却比 Run 宽一整级。

第二个根因：`signal.projectId` 可以为 null，旧代码据此把信号当成「组织公共线索」；但 `createDiscoveredSignal` 自己就用 `projectId ?? run.projectId` 继承 Run 归属，`createSubmittedSignal` 也允许只传 `searchRunId`。于是「projectId 为空」既可能是真·组织线索，也可能是项目信号——旧实现一律按最宽松的那一种处理。

### 1.2 有效归属规则（服务端解析，客户端不可断言）

新增 `src/lib/supplier-intel/signal-scope.ts`。一条信号的**治理项目集合** = 下列非空指针的并集：

| 来源 | 说明 |
|---|---|
| `signal.projectId` | 直挂项目 |
| `signal.tenderId` | 既有语义即 Project 指针（`assertProjectPointerInOrg(orgId, tenderId, "招标项目")`；`createSearchRun` 对 projectId 与 tenderId **各自**断言写权限） |
| `run.projectId` | 经 `searchRunId` 继承 |
| `run.tenderId` | 同上 |

判定纪律：

- **集合内每一个项目都要过相应级别授权**——不取最宽松的那一个，也不自动重新归类；
- `searchRunId` 指向本 org 内解析不到的 Run → **fail-closed**（`NOT_FOUND`），绝不降级成组织级线索；
- 创建时客户端指针互相冲突（`projectId=B` + `searchRunId` 属于 A）→ 明确拒绝（`INVALID_INPUT`），**即使两个项目该用户都有权**也拒绝；
- 集合为空 = 真正的组织级线索 → 沿用既有组织级授权，不强行绑定项目。

### 1.3 权限矩阵（按操作，不按页面按钮）

| 入口 | 服务函数 | 级别 | 依据 |
|---|---|---|---|
| `GET /signals` | `listSignals` / `countSignals` | read（集合过滤） | 列表/筛选/计数同口径 |
| `GET /signals/[id]` | `getSignal`（含 capability） | read | 附带能力信息一并保护 |
| `POST /signals` | `createSubmittedSignal` | write | 创建 |
| `PATCH /signals/[id]` | `reviewSignal` / `rejectSignal` / `linkSignalToSupplier` | write | 状态与关联变更 |
| `POST /signals/[id]/resolve` | `resolveSignalEntity` | **write** | append `resolutionJson`，不是无副作用读取 |
| （内部）capability 挂靠 | `createCapabilitySignal` | write | 对该信号的业务写入 |

顺序不变量（路由 → 服务两层，defense-in-depth，与 B3 同形）：

```
flag 404-dark → 租户 → 归属解析（只读 projectId/tenderId/searchRunId 元数据）
→ canonical requireProjectRead/WriteAccess → org 交叉校验 → 服务层再断言一次
```

「为授权读取最小归属元数据可以，但不得在授权前返回受保护内容或执行业务写入」：`readSignalScopePointers` 的 `select` 只有 4 个 id 字段；`getSignal` 先按元数据鉴权再读正文；`resolveSignalEntityWithPagination` 先断言写权限，再读信号行。

### 1.4 列表保护（零 N+1）

`listAccessibleProjectIdsForActor(actor, level)` 是 `assertProjectAccessForActor` 判定树的**批量投影**（同一批 canonical 原语：`getOrgMembership` / `getProjectMembership` / `hasOrgRole` / `hasProjectRole` / `isSuperAdmin` / `intakeStatus=dispatched`），最多 3 次查询：

- `super_admin` / `org_admin` → `unrestricted`（org 内不再按项目收窄）
- 其余 → owner 项目 ∪ active `projectRole` 项目（write 还需 `project_admin`）

`buildSignalProjectVisibilityFilter(scope, orgId)` 把它翻译成 where 片段，**单条 SQL**（Run 侧走关系过滤 = join，不是逐条鉴权）：

1. 归属可解析性（**所有角色**都适用）：`searchRunId is null` 或 `searchRun.orgId = 当前 org`——否则会出现「单条 fail-closed 拒绝、列表照样可见」的裂缝；
2. `projectId` 为 null 或 ∈ 允许集合；
3. `tenderId` 为 null 或 ∈ 允许集合；
4. `searchRunId` 为 null，或其 Run 的两个指针都满足同一约束。

`countSignals` 复用同一片段，避免「列表看不到但计数暴露」。

### 1.5 B5 完整身份裁决不被破坏（项目可见性 ≠ 裁决完整性）

`resolveSignalEntityWithPagination` 里的两类扫描（供应商行、LINKED 历史）**保持 org 全量**，并在代码里写成显式不变量注释：按「当前用户可见项目」裁剪会让扫描仍自称 `complete` 然后返回强匹配——那正是把授权过滤伪装成完整宇宙。

不泄露的依据：这些行只被用于计算身份键，而身份键来自**当前信号自带的线索**；返回值只含 org 级实体（`supplierId`）与冲突摘要，不含其他项目的正文、备注或证据。冲突存在时由 F1 分支降级 `NEEDS_HUMAN_REVIEW`、不返回 `supplierId`。

---

## 2. R2：canonical 来源不可证完整时明确阻断

### 2.1 最小复现（修复前）

`canonical-requirements.ts` 的 `readUncertainIds(structuredJson)` 对**所有**异常来源返回 `[]`：

```
RISKS 节不存在 / structuredJson 为 null / 非对象 /
risks 字段缺失或不是数组 / MANDATORY_UNCERTAIN 条目的 relatedRequirementIds 非法
        → []  →  uncertainSet 为空  →  所有 Boolean=false 的行被解释成「可选」
```

于是被封禁的塌缩换了个入口回来：只有「聚合表打满 12 条」这一种情况会 fail-closed，其余不可证的来源全部被当成「可证零 uncertain」。一个连 RISKS 章节都没有的分析，会安静地产出一份「全部 false」的需求快照并开搜。

### 2.2 writer 契约核对（本轮复核，不是推测）

| writer | 落库形状 | 能否证明 uncertain 完整 |
|---|---|---|
| canonical V2（`v2-map.ts` → `persistV2CanonicalTx`） | `{ risks: RiskV2[], conflicts: ConflictV2[] }`，RiskV2 逐条带 `severity` / `description` | **能**：`deriveRisks` 只要 `uncertain.length > 0` 就必产一条 `reasonCode=MANDATORY_UNCERTAIN` 的聚合；`persistV2CanonicalTx` 对 `SECTION_KEYS` 全量 upsert，RISKS 必然存在 |
| legacy `report.ts` | `{ kind: "risks", inventedHistoricalAwards: false }`（**无** risks 数组） | 不能 |
| workforce `upsertWorkforceRiskSection` | `{ version: "tender-workforce-risks/v1", risks: [{ statement }] }` | 不能 |
| 人工编辑 `review.ts` | `{ ...prev, _edits }`（保留 risks/conflicts） | 能（仍是 canonical 形状） |

判别口径与既有 `tender-workforce/tools.ts` 的 `readCanonicalV2Risks` 一致（`version` 字符串即非 canonical；逐条 `severity`/`description`），**不新造第二套判别**。

### 2.3 四级判定（纯函数 `classifyUncertainRequirementSource`）

| status | reasonCode | 触发 |
|---|---|---|
| `MISSING` | `RISKS_SECTION_MISSING` / `STRUCTURED_JSON_NULL` | 无 RISKS 节；structuredJson 为空 |
| `MALFORMED` | `STRUCTURED_JSON_NOT_OBJECT` | 非对象 / 是数组 |
| `MALFORMED` | `NON_CANONICAL_WRITER_SHAPE` | 带 `version` 字符串（workforce 形状） |
| `MALFORMED` | `RISKS_NOT_ARRAY` | 无 risks 数组（legacy 形状） |
| `MALFORMED` | `RISK_ENTRY_NOT_CANONICAL` | 条目缺 `severity`/`description` |
| `MALFORMED` | `MULTIPLE_UNCERTAIN_AGGREGATES` | 出现多条聚合（**不取第一条**） |
| `MALFORMED` | `RELATED_IDS_NOT_ARRAY` / `RELATED_IDS_MEMBER_INVALID` | 关联 id 缺失/非数组/含非字符串或空串（**不过滤非法成员**） |
| `MALFORMED` | `EMPTY_UNCERTAIN_AGGREGATE` | 聚合存在但关联 id 为空（与 writer 契约自相矛盾） |
| `POSSIBLY_TRUNCATED` | `UNCERTAIN_LIST_AT_CAP` | 关联 id **原始**长度 ≥ 12（**不先去重再比长度**） |
| `VALID` | `NO_UNCERTAIN_AGGREGATE` | 结构合法且无聚合 ⇒ **可证零 uncertain**（合法空集合，正常放行） |
| `VALID` | `UNCERTAIN_LIST_COMPLETE` | 结构合法、单条聚合、长度 < 12 |

非 `VALID` → 抛**既有** `BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE`（未新增错误码、未加数据库列/表）。判定结果随快照返回并写进 `sourceConfigJson.canonicalUncertainSourceStatus/Reason`（审计留痕）。

### 2.4 阻断位置

`loadCanonicalSupplierRequirementSnapshot` 由 `createProjectSearchRun` 在**第一步项目 ACL 之后、brief/LLM 之前**调用（顺序不变量由 BL-3 的 AST 守卫机械保证）。因此阻断早于：可执行 `SupplierSearchRun` 创建、brief 的 LLM 调用、任何外部 provider 查询。HTTP 面经 `mapSupplierIntelError` 返回 **409 + code**，不是通用 500。客户端 `requirements` / `complete` / `uncertainComplete` 等字段在路由层根本不被读取（AST 守卫 `ROUTE_READS_BODY_REQUIREMENTS` / 白名单 `RUN_CREATE_ALLOWED_KEYS`）。

保留项：可证的 `mandatory=true`；有效来源中的 false/uncertain 区分；≥12 截断保护；最新 canonical 分析选择规则（`REVIEW_REQUIRED`/`APPROVED` + `createdAt desc`）；历史 Run 快照不可变。

---

## 3. 修改范围

| 文件 | 性质 | 内容 |
|---|---|---|
| `src/lib/supplier-intel/signal-scope.ts` | 新增 | 有效归属解析、混合指针冲突、列表可见性 where、按级别断言（纯函数 + 服务函数分离） |
| `src/lib/supplier-intel/access.ts` | 改 | 新增 `listAccessibleProjectIdsForActor`（单条断言判定树的批量投影） |
| `src/lib/supplier-intel/signal-service.ts` | 改 | 创建/读取/列表/计数/状态流转/capability 接入项目 ACL；`createDiscoveredSignal` 零额外查询的指针一致性校验 |
| `src/lib/supplier-intel/entity-resolution.ts` | 改 | resolve 前置写权限断言；org 全量扫描不变量注释 |
| `src/app/api/supplier-intel/signals/route.ts` | 改 | GET 走服务集合过滤；POST 归属解析 → canonical 写门 |
| `src/app/api/supplier-intel/signals/[id]/route.ts` | 改 | GET 读门 / PATCH 写门 |
| `src/app/api/supplier-intel/signals/[id]/resolve/route.ts` | 改 | 写门（resolve 是写） |
| `src/lib/supplier-intel/canonical-requirements.ts` | 改 | 四级来源判定 + 非 VALID 阻断（零新错误码、零 schema） |
| `src/lib/supplier-intel/project-run-service.ts` | 改 | sourceConfig 增加来源判定审计指针 |
| `__tests__/signal-scope.test.ts` · `canonical-source.test.ts` · `supplier-intel-s2tb-db.isolated.test.ts` · `fixtures/canonical-risks-writer.ts` | 新增 | R1/R2 测试与真实 writer 夹具 |
| `__tests__/supplier-intel-s2fr-db` · `s2rem-db` | 改 | RISKS 夹具改由真实 writer 产出（断言未删减） |
| `scripts/test-ci-unit.sh` · `scripts/test-all.sh` | 改 | 注册 3 个新套件（无重复行，`bash -n` 通过） |

**零 schema、零 migration、零生产库、零生产 flag、零 UI、零 RFQ/消息/PO/付款/评分扩展。**

---

## 4. 新测试

### 4.1 R1（`signal-scope.test.ts` 纯核 + `supplier-intel-s2tb-db.isolated.test.ts` 服务/HTTP）

夹具是**同一个 org 的两个项目 + 不同权限用户**（不是只测 cross-org）：`org_admin` owner、项目 A 的 `project_admin`、项目 A 的 `viewer`、项目 B 的 `project_admin`、无项目角色的 `org_member`、失效 `projectMember`、非 active 用户、跨 org `org_admin`。

| 用例 | 断言要点 |
|---|---|
| R1-T1 | 项目 B 用户读不到 A 的信号（直挂与 Run 继承两种）；列表/计数同口径排除；列表载荷零受保护正文 |
| R1-T2 | 同一用户 review/reject/link/resolve/capability 全被拒；事后核对 status、linkedSupplierId、resolutionJson、capability 计数**均未变化** |
| R1-T3 | 项目 viewer 可读单条与列表；四种写操作全被拒 |
| R1-T4 | `projectId=null` + `searchRunId→项目 A`：无权用户读/resolve 均被拒；项目 A 的 viewer 可读 |
| R1-T5 | 有权项目 B 的 `projectId` + 无权项目 A 的 `searchRunId` → 冲突拒绝；只带无权 Run → 按 A 鉴权拒绝；**owner（两项目都有权）同样拒绝**；冲突路径零落库 |
| R1-T6 | 项目写用户创建/review/link 正常；无项目角色成员的组织级线索创建/读取/人审**保留既有行为**；但仍读不到项目 A 的信号 |
| R1-T7 | 跨 org 读=不存在、写=NOT_FOUND、列表空；失效 projectMember 拒；非 active 用户拒；本 org 解析不到的 Run 引用 → 单条与列表**一致** fail-closed（含 owner）；授权失败路径 **provider 调用数 = 0** |
| R1-T8 | 受保护项目里的同身份冲突 → `NEEDS_HUMAN_REVIEW`、无 `supplierId`、`scan.complete=true`、冲突元数据含全部候选；响应零泄露受保护项目的标题/描述/备注/正文；**对照**：无冲突时仍按 org 全量宇宙给出 `MATCHED_EXISTING`（证明扫描没被裁剪） |
| HTTP 1–12 | 403/200/403（GET/GET/PATCH）、resolve 403 且零 append、列表不含无权项目、混合指针 400 + `INVALID_INPUT`、借 Run 越权创建 403 |

### 4.2 R2（`canonical-source.test.ts` 纯核 + DB/HTTP）

正常路径夹具由**真实 writer**产出：`fixtures/canonical-risks-writer.ts` 调用 canonical 的 `deriveRisks`，再包成 `v2-map` 落库形状；`supplier-intel-s2fr-db` / `s2rem-db` 的既有 RISKS 夹具也一并改用它（断言未删减）。

| 用例 | 断言要点 |
|---|---|
| R2-T1 | Boolean=false 需求存在但 RISKS 缺失 → 阻断，不生成静默 false 快照（纯核 + DB 两面） |
| R2-T2 | structuredJson=null / 非对象 / legacy 形状 / workforce 形状 / 条目非 canonical / 关联 id 非法（5 类）→ 逐条判 MALFORMED 且给出各自 reasonCode |
| R2-T3 | 真实 writer 的完整分析正常读取；**可证零 uncertain**（有其它风险条目、无聚合）正常放行，不被全体阻断 |
| R2-T4 | 有效来源同时含 true/false/uncertain → 三值准确保留（持久层已塌缩为 false 的 uncertain 行仍被还原） |
| R2-T5 | 12 条 → 截断拒绝；11 条 → 放行；**12 条里只有 6 个不同值**仍判截断（去重不得用来掩盖）；多条聚合 → MALFORMED（不取第一条）；真实 writer 对 13 条 uncertain 的 `.slice(0,12)` 行为与判定一致 |
| R2-T6 | 阻断场景：可执行 Run 创建数 = 0、LLM 调用数 = 0、provider 调用数 = 0（零 Run ⇒ 零发现执行 ⇒ 零信号落库） |
| R2-T7 | HTTP POST `/runs` 带伪造 `requirements` + `complete` + `uncertainComplete` + `canonicalUncertainSourceStatus:"VALID"` → 仍 **409 + `BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE`**（非 500/201）；有效项目仍能开搜且客户端 requirements 未进入服务端快照、服务端三值仍生效 |

---

## 5. 旧套件实际结果（本轮实跑，非引用上轮）

| 套件 | 结果 |
|---|---|
| Supplier Intel 纯核 12 套（含新增 2 套） | 全部 exit 0 |
| S1 审计脊柱 DB（`supplier-intel-db`） | **86 通过 / 0 失败** |
| S2 发现编排 DB | **32 / 0** |
| S2-FR 终审回归 DB | **38 / 0** |
| S2-REM 整改回归 DB | **42 / 0** |
| S2-TB 本轮新增 DB+HTTP | **87 / 0** |
| Tender Intel / Understanding 回归 16 套 | 全部 exit 0 |
| T4 授标情报 DB（`awards-db`） | **18 passed / 0 failed** |

BL2 / B4 / B5 / F1 / 无自动 LINK / 内部源优先 / 共享 Tavily client / egress 过滤 / provider 失败分级与全源失败收口 / 网络不占行锁 / 取消后晚到结果丢弃 / 社媒证据不自动 VERIFIED / S1 终态不可写 / 评分契约——全部由上述既有套件原样通过，无断言删除、无跳过、无「升级测试用户为 org_admin」式规避（本轮新用户全部是 `org_member` + 项目角色）。

---

## 6. 静态门与构建

| 门 | 结果 |
|---|---|
| `tsc --noEmit --incremental false` | exit 0 |
| 改动文件 ESLint（15 个 .ts） | **0 problems** |
| `npm run lint:baseline` | **PASS**（current errors=41 / warnings=137，baseline 53/111；无新增 error fingerprint；未扩大 baseline） |
| `npm run build` | **exit 0**（`prisma generate` → 预览库隔离检查 → 迁移闸跳过（零 DB 连接）→ `next build --webpack`；361/361 静态页生成） |

## 7. 数据库与凭据

| 项 | 值 |
|---|---|
| 隔离分支 | `tb-s2-20260908`（id `br-jolly-base-anb9aqie`，parent `br-green-boat-ann7k5yf`） |
| 生产前缀比对 | host 前缀 `ep-crimson-grass-…`，`PROD_PREFIX_MATCH=false` → `assertSafeTestDatabase` 放行 |
| 迁移 | `prisma migrate deploy` → No pending migrations（父分支已含 S1 脊柱与 main 最新） |
| 生产库 | **零触碰**；`DATABASE_ENVIRONMENT=isolated` + `NODE_ENV=test` 双门 |
| 清理 | 已删除（`neonctl branches delete` exit 0）；复核 `branches list`：本轮/上轮前缀（`tb-s2*` / `rem-s2*` / `reval-s2*`）剩余 **0**，项目分支总数 16 |
| 凭据 | 连接串只存在于 0600 的临时 env 文件，用后删除；日志与本报告经 `grep -vE 'postgres[a-z]*://'` 复核无连接串；未提交任何 `.env` |

---

## 8. 提交与远端

按关注点拆分 4 个提交（无 rebase、无 force、无 `git add .`；每次 `git add` 只列本轮文件）：

| sha | 提交 | 文件 |
|---|---|---|
| `3646b24d` | feat: R1 信号有效项目归属解析与项目授权批量投影 | `signal-scope.ts`(新) `access.ts` |
| `7fa2deab` | feat: R1 信号读写贯穿项目级授权（服务层 + HTTP 边界） | `signal-service.ts` `entity-resolution.ts` + 3 个 signals 路由 |
| `e521ebb3` | fix: R2 canonical uncertain 来源四级判定，不可证完整即阻断 | `canonical-requirements.ts` `project-run-service.ts` |
| `b597e5aa` | test: R1/R2 回归 + 真实 writer 夹具 + 测试注册 | 3 个新套件、1 个夹具、2 个既有套件夹具、2 个测试脚本 |

| 项 | 值 |
|---|---|
| CODE_HEAD_SHA（代码终态） | `b597e5aa2528ef05b1dfe85edc32311f7109d5e9` |
| FINAL_PR_HEAD_SHA（含本报告 docs-only 提交） | 见本文件所在提交（docs-only，仅本文件；其 CI 结果在交付说明中单独记录） |
| 推送方式 | 普通 push（**无 rebase、无 force**），远端 HEAD 已复核等于本地 |
| main 漂移 | **0**（`rev-list 5933ff7a..origin/main` = 0，与基线同值） |
| PR 状态 | #190 **DRAFT**（`isDraft=true`，未改）；`MERGEABLE`，base `5933ff7a`，head `b597e5aa` |
| CI | run `34240381303`（event=pull_request，headSha=`b597e5aa…`，completed **success** @ 2026-09-08T14:57:09Z）；步骤全部 success：Guard(no migrate) / Prisma validate / Prisma generate / Lint(full log) / **ESLint baseline gate** / Typecheck / **Unit tests (CI subset)**（含新增 signal-scope / canonical-source / S2-TB DB 三个套件；DB 套件按设计跳过）/ Next.js build(no migrate) / Fail-if-any-required-failed |
| staging | `vercel ls qingyan-staging --meta githubCommitSha=b597e5aa…` 唯一命中 `qingyan-staging-6ac148mif-…vercel.app`；`vercel inspect` → id `dpl_BFtNYRZeKFo861T6562Mo47mArqj`，target=preview，**status ● Ready**（2026-09-08 22:46 CST）→ STAGING_HEAD_SHA = `b597e5aa` |
| staging 运行时冒烟 | **NOT_RUN**（部署保护墙；未解除保护、未切生产开关来制造 PASS） |

## 9. 剩余债务与未验证项

本轮**只**处理 R1 与 R2，第 10 节其余历史债务原样保留跟踪，**不写成「已证明无风险」**：

| 项 | 本轮状态 |
|---|---|
| `quote-engine/advisors.ts` 第 4 份 Tavily 调用 | 未处理（S2 范围外，继续跟踪） |
| `internalPoolLimit` 客户端可控无上限；`includeInternalPool:false` 时内部源停留 PLANNED | 未处理（BL-4 已把「PLANNED 不计入已执行源」固定为契约） |
| `resolutionJson` append 为非事务 read-modify-write | 未处理（并发 resolve 仍可能丢一条 AUTO_PREFILL；本轮新增的写权限断言不改变该并发语义） |
| `Supplier.website` 无 scheme 时不参与对质（召回损失） | 未处理 |
| tender 持久层三值列（`mandatoryState`/`mandatorySignal`） | **仍是 SCHEMA_REQUIRED 上报待批**；R2 只做「不可证即阻断」，未恢复已丢失的原始三值。落库后本 loader 改读逐条列，聚合表与封顶分支消亡 |
| `createDiscoveredSignal` 的授权 | 非 HTTP 入口，授权由 `executeSupplierSearchRun` 在计划/外呼前对 `run.projectId` 断言完成（覆盖同一治理集合）；本轮补了零额外查询的指针一致性校验，未在每条信号上重复断言（避免发现循环内 N+1） |
| 归属冲突的既有历史行 | 本轮采「集合内每个项目都要过权限」而非整行拒读——不选最宽松归属、不自动重新归类，同时不让合法创建者失去既有数据；创建面已杜绝新的冲突行 |

未验证项：staging 运行时行为（保护墙）；全量 `scripts/test-all.sh`（按任务书只跑相关套件 + CI 子集）；本报告 docs-only 提交自身的 CI（写作时 PENDING，不作为代码 HEAD 的证据）。

---

## 10. 汇报键值块

```
QYANE_SUPPLIER_INTELLIGENCE_M1_S2_TRUST_BOUNDARY_CLOSURE

BASE_PR_HEAD = 25deada7211995bb4d58a17cfe44fff3c83596b5
CODE_HEAD_SHA = b597e5aa2528ef05b1dfe85edc32311f7109d5e9
FINAL_PR_HEAD_SHA = 本报告所在的 docs-only 提交（仅本文件、零代码改动；sha 与其 CI 结果见交付说明与 git log——报告无法自述自身 sha）
REMOTE_MAIN_SHA = 5933ff7a0b17b343982cbe836ffb4931122e2e69
MAIN_DRIFT = NO（0 提交；与基线 LAST_OBSERVED_MAIN 同值）

R1_SIGNAL_READ_ACL = PASS（单条含 capability 走项目 read；跨 org 仍按不存在处理）
R1_SIGNAL_LIST_ACL = PASS（列表/筛选/计数同口径，单条 SQL + 关系过滤，零 N+1）
R1_SIGNAL_WRITE_ACL = PASS（创建/review/reject/link/capability 走项目 write，被拒路径零业务变更）
R1_RESOLVE_WRITE_ACL = PASS（resolve 按写授权；被拒时 resolutionJson 未 append）
R1_RUN_INHERITED_SCOPE = PASS（projectId=null + searchRunId→A 仍受 A 保护；不可解析 Run 引用单条与列表一致 fail-closed）
R1_POINTER_CONSISTENCY = PASS（混合指针冲突拒绝，owner 亦拒；冲突路径零落库）
R1_ORG_LEVEL_SIGNAL_COMPATIBILITY = PASS（真正无项目指针的组织级线索创建/读取/人审保留既有行为）
R1_IDENTITY_COMPLETENESS_WITHOUT_DISCLOSURE = PASS（受保护项目冲突仍生效→NEEDS_HUMAN_REVIEW、scan.complete=true、零正文/备注泄露；无冲突对照仍 MATCHED_EXISTING）

R2_MISSING_SOURCE_BLOCKED = PASS（RISKS 节缺失 / structuredJson 为空）
R2_MALFORMED_SOURCE_BLOCKED = PASS（非对象 / legacy kind 形状 / workforce version 形状 / 条目非 canonical / 关联 id 非法 / 多条聚合 / 空聚合）
R2_VALID_EMPTY_SOURCE_ACCEPTED = PASS（依 writer 契约可证零 uncertain 的分析正常放行，未被一律阻断）
R2_TRISTATE_PRESERVED = PASS（true 忠实 / 合法 false 不升级 / uncertain 幸存）
R2_TRUNCATION_GUARD = PASS（≥12 拒绝；11 放行；12 条含 6 个重复值仍判截断——去重不得缩短长度）
R2_BLOCKED_LLM_CALLS = 0
R2_BLOCKED_PROVIDER_CALLS = 0（阻断早于 Run 创建 ⇒ 零发现执行；可执行 Run 创建数 = 0）

R1_TESTS = PASS（signal-scope 纯核 + S2-TB DB/HTTP：R1-T1..T8 全覆盖，含服务行为与 HTTP 边界，非源码字符串守卫）
R2_TESTS = PASS（canonical-source 纯核 + S2-TB：R2-T1..T7 全覆盖；正常路径夹具调用真实 deriveRisks writer）
S1_REGRESSION = PASS 86/86
S2_REGRESSION = PASS 32/32
S2_FR_REGRESSION = PASS 38/38
S2_REM_REGRESSION = PASS 42/42
TENDER_INTEL_REGRESSION = PASS（tender-intel/understanding 16 套 exit 0 + awards-db 18/18）

TYPECHECK = PASS（tsc --noEmit --incremental false exit 0）
LINT_BASELINE = PASS（current 41/137 vs baseline 53/111；无新增 fingerprint；未扩大 baseline）
LINT_CHANGED_FILES = PASS（15 个改动 .ts：0 problems）
BUILD = PASS（npm run build exit 0；361/361 静态页；迁移闸跳过，零 DB 连接）
CI_HEAD_SHA = b597e5aa2528ef05b1dfe85edc32311f7109d5e9（代码 HEAD；报告的 docs-only 提交 CI 见交付说明）
CI = PASS（run 34240381303，全部步骤 success，2026-09-08T14:57:09Z）
STAGING_HEAD_SHA = b597e5aa2528ef05b1dfe85edc32311f7109d5e9
STAGING = READY（dpl_BFtNYRZeKFo861T6562Mo47mArqj，preview）
STAGING_RUNTIME_SMOKE = NOT_RUN（部署保护墙；未解除保护、未切生产开关制造 PASS）

SCHEMA_CHANGED = NO
MIGRATION_CHANGED = NO
PRODUCTION_DB_TOUCHED = NO（仅生产 project 的临时子分支 tb-s2-20260908，PROD_PREFIX_MATCH=false）
PRODUCTION_FLAGS_CHANGED = NO
ISOLATED_DB_CLEANUP = DONE（br-jolly-base-anb9aqie 已删；复核 tb-s2*/rem-s2*/reval-s2* 剩余 0；连接串文件已删除）
ORIGINAL_WORKTREE_PRESERVED = YES（feature/sales-quote-cost-foundation @ 9f9a43bb；未提交改动与 4 个 stash 原样）

BLOCKERS = NONE
DEFERRED_ITEMS = 第 4 份 Tavily（quote-engine/advisors）；internalPoolLimit 无上限 + includeInternalPool:false 时内部源停留 PLANNED；resolutionJson 非事务 append；Supplier.website 无 scheme 不参与对质；tender 三值列 SCHEMA_REQUIRED 待批；createDiscoveredSignal 授权由执行器承担（非 HTTP 入口）
UNVERIFIED_ITEMS = staging 运行时行为（保护墙）；全量 scripts/test-all.sh
RECOMMENDATION = READY_FOR_S2_FINAL_REVIEW

PR = #190
PR_STATE = DRAFT
PR_MERGED = NO
S3_STARTED = NO
TENDER_V2_RESUMED = NO
```
