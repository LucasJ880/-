# Qingyan Tender T3.5 — Foundation Hardening Report

| 项 | 值 |
|---|---|
| 阶段 | Tender T3.5 — Foundation Hardening（生产激活前的结构性安全修复） |
| 基线 main | `f9549ab2803a71cd2b9e34eea5dcfa8da7c68452`（#102 T2-P1 + #103 T3 已 MERGED） |
| 分支 | `feature/tender-t3-5-foundation-hardening`（从 `origin/main@f9549ab` 创建） |
| 日期 | 2026-08-11 |
| 性质 | **service/route/flags 层加固 + 测试**；`SCHEMA_CHANGE = NONE`、无生产迁移、无生产数据变更、无生产 flag 变更、**不是 T4** |
| 交付 | Draft PR，保持 Draft，不 merge，等待人工 Final Review |

本轮只解决两个生产激活前的结构性安全风险，**不扩大范围**：
- **Problem A**：Deletion Gate 与 Producer Kill Switch 解耦。
- **Problem B**：Hard Delete × Ledger Writer 的 TOCTOU 并发窗口（orphan 授权锚）。

---

## 1. 修改文件列表

| 文件 | 变更 |
|---|---|
| `src/lib/project-ledger/flags.ts` | 新增 `T2_LEDGER_SCHEMA_READY` 位与派生闸：`isLedgerSchemaReady` / `isLedgerProducerActive`(= schema && producer, fail-closed) / `isLedgerDeletionGateActive`(= schema)。保留 `isLedgerProducersEnabled` 为 `@deprecated`。 |
| `src/lib/project-ledger/history-anchor.ts` | **新增**。统一并发契约 helper：`lockProjectHistoryAnchorShared`(FOR KEY SHARE) / `lockProjectHistoryAnchorForDelete`(FOR UPDATE) / `countProjectAuthoritativeHistory`(事务内)。 |
| `src/lib/project-ledger/event-service.ts` | `appendProjectEvent` 的租户检查由非锁 `findFirst` 改为 `lockProjectHistoryAnchorShared`（FOR KEY SHARE + org 校验，语义等价 + 加锁）。 |
| `src/lib/project-ledger/cost-service.ts` | `createProjectCost` 在创建 cost 行前先取共享锚锁（cost 行本身即权威历史）。 |
| `src/app/api/projects/[id]/route.ts` | DELETE 重构：锚锁 + 历史检查 + 删除同一事务；gate 改用 `isLedgerDeletionGateActive()`（与 producer 解耦）。PATCH producer 改 `isLedgerProducerActive()`。 |
| `src/app/api/projects/route.ts` | project.created producer 改 `isLedgerProducerActive()`。 |
| `src/app/api/projects/[id]/members/route.ts` | member.added producer 改 `isLedgerProducerActive()`。 |
| `src/app/api/projects/[id]/members/[memberId]/route.ts` | member.removed producer 改 `isLedgerProducerActive()`。 |
| `src/lib/project-ledger/__tests__/p1-pure.test.ts` | 新增 flag 解耦契约测试；producer/gate 静态纪律更新；新增写入侧锚锁静态纪律；mockTx 补 `$queryRaw`。 |
| `src/lib/project-ledger/__tests__/p1-ledger-db.test.ts` | 新增 DEL-SCHEMA-01..05、DEL-RACE-01（真实事务交错 + orphan 不变式）；DEL-DARK/DEL-ACTIVE 保留并升级为 tx 层观测。 |

**`SCHEMA_CHANGE = NONE`**（无 prisma/schema.prisma、无 migration 变更）。未触碰禁区：`src/lib/tender-understanding/**`、`src/lib/tender-eval/**`、Workforce Runtime、T2-P1 project route 语义（仅将 producer flag 名替换为等价复合闸）。

---

## 2. 关键设计说明

### Problem A — Deletion Gate ↔ Producer 解耦

Dark-merge 阶段，deletion gate 与 producer 同受 `T2_LEDGER_PRODUCERS_ENABLED` 门控。风险：生产 schema 已上线、ledger 已有历史后，若因事故/维护/回滚临时关闭 producer，则
`已有历史 + producer OFF + DELETE Project` 可能重新允许 hard delete，摘除授权锚 → orphan 历史。

**修复**：拆成两个正交能力位，deletion gate 只看 `SCHEMA_READY`：

```
Producer Write = SCHEMA_READY && PRODUCERS_ENABLED   （fail-closed）
Deletion Gate  = SCHEMA_READY
```

producer 是「是否产生新历史」的开关；deletion protection 是「已有历史永久受保护」的开关——二者生命周期不同，必须解耦。

### Problem B — Hard Delete × Writer TOCTOU

原 DELETE：历史 count 在 `db.*`（事务外）→ 随后另起事务 `project.delete`。writer 侧（appendProjectEvent / createProjectCost）仅非锁读 Project 是否存在。四表刻意无 Project FK，故存在窗口：

```
Writer 读 Project 存在 → Delete count=0 → Delete 删 Project → Writer 追加历史
⇒ Project 缺失 但 历史 > 0（orphan 授权锚）
```

**修复**：把「锚锁 + 历史检查 + 删除」收进同一事务，并给 writer 加共享锚锁（详见 §3）。

---

## 3. Concurrency Locking Contract

统一契约集中在 `history-anchor.ts`，四类权威历史写（Ledger / Cost / 未来 Archive / Hard Delete）共享同一锚点语义：

| 角色 | 锁 | 时机 | 依据 |
|---|---|---|---|
| Ledger writer (`appendProjectEvent`) | `Project` 行 **FOR KEY SHARE** | 写事件前（同事务） | 与 delete 的 FOR UPDATE 互斥；writer 之间 FKS 相互兼容 → 保持并发 |
| Cost writer (`createProjectCost`) | `Project` 行 **FOR KEY SHARE** | 创建 cost 行前（同事务） | cost 行本身即权威历史 |
| Hard Delete (`DELETE` route) | `Project` 行 **FOR UPDATE** | 进入删除事务后、历史统计与删除前 | 阻塞并发 writer 至本事务提交 |

**PostgreSQL 锁兼容性**：`FOR UPDATE` 与 `FOR KEY SHARE` 互斥；`FOR KEY SHARE` 与 `FOR KEY SHARE` 兼容。

**交错证明（两向，DEL-RACE-01 真实事务实测）**：

- **Race A**（writer 先持锁）：writer 取 FKS + 插入事件（未提交）→ delete 的 FOR UPDATE **阻塞** → writer 提交 → delete 获锁、锁内统计看到历史 → **409**，项目保留。orphan=0。
- **Race B**（delete 先持锁）：delete 取 FOR UPDATE + 统计=0（未删）→ writer 的 FKS **阻塞** → delete 提交删除 → writer 的 FKS 返回 0 行 → 抛 `LedgerTenantError` → **writer 事务整体回滚**（不产生历史）。orphan=0。

**不变式（恒成立）**：`NOT ( Project 缺失 AND 权威历史存在 )`，即 `ORPHAN_AUTHORITATIVE_HISTORY = 0`。

**无死锁**：两向均单向等待（A：delete 等 writer；B：writer 等 delete），无锁循环。保留原有 `eventKey` 幂等、`seq` 有界重试、事务原子性、租户隔离——锚锁是 append 首个语句，在 seq 重试循环之外，只取一次。

### Archive writer

当前 `src/` 中**无任何 `TenderArchiveItem` 写入路径**：`ARCHIVE_WRITER_RACE = NOT_CURRENTLY_REACHABLE`。契约冻结：**未来任何 authoritative archive writer 必须在写 archive item 前于同事务调用 `lockProjectHistoryAnchorShared`**（helper 文件头注释已冻结）。Delete gate 已统计 `tenderArchiveItem`，故即便存在 archive item 也会阻止删除。

---

## 4. Flag Contract（Activation Contract）

| 环境位 | 默认 | 职责 |
|---|---|---|
| `T2_LEDGER_SCHEMA_READY` | `false` | M1 四表在当前环境已存在且允许安全读取；控制 deletion gate 与 M1 表可访问性 |
| `T2_LEDGER_PRODUCERS_ENABLED` | `false` | 是否产生新的 producer 写入 |

派生（`flags.ts`，均 fail-closed，异常按 OFF）：

```
isLedgerSchemaReady()        = SCHEMA_READY
isLedgerProducerActive()     = SCHEMA_READY && PRODUCERS_ENABLED
isLedgerDeletionGateActive() = SCHEMA_READY
```

四态矩阵：

| SCHEMA_READY | PRODUCERS_ENABLED | Producer 写 | Deletion Gate | 场景 |
|---|---|---|---|---|
| false | false | OFF | OFF（0 次 M1 访问） | **当前生产**（M1 未上线）／dark-merge |
| true | false | OFF | **ON**（已有历史受保护） | migration 后、rollout 前 & 紧急回滚 |
| true | true | ON | ON | 最终 rollout |
| false | true | **OFF**（fail-closed） | OFF | 错误配置：schema 未就绪绝不写 M1 |

关键保证：`PRODUCERS_ENABLED=true && SCHEMA_READY=false` 不工作（producer effectively OFF），绝不因错误 env 破坏业务主路径。

---

## 5. 新增/更新测试矩阵

**Pure（`p1-pure.test.ts`，无 DB，进 CI）**
- `T3.5 flag 解耦契约`：SCHEMA_READY 默认关；Producer=SCHEMA&&PRODUCER（含 fail-closed：producer-only → OFF）；Deletion Gate=SCHEMA（含 producer-off + schema-on → 仍 ON）。
- 静态纪律：producer 站点必须用 `isLedgerProducerActive()`、禁用裸 `isLedgerProducersEnabled()`；DELETE gate 用 `isLedgerDeletionGateActive()`、锚锁→统计→删除顺序、全在事务内；写入侧 `appendProjectEvent`/`createProjectCost` 锚锁先于 create；helper 含 `FOR KEY SHARE` / `FOR UPDATE`。

**DB matrix（`p1-ledger-db.test.ts`，隔离 Neon）— 60/60**
- 保留 EV-01..08 / COST-01..08 / DEL-01/04（证明 writer 锚锁不破坏既有行为）。
- **DEL-SCHEMA-01**：schemaReady=false → 0 次 M1 访问 + legacy 删除。
- **DEL-SCHEMA-02/03/04**：schemaReady=true, producer=false, ProjectEvent/ProjectCost/TenderArchiveItem>0 → **409**（producer OFF 仍保护 → 决定性证明 producer kill switch ≠ deletion kill switch）。
- **DEL-SCHEMA-05**：schemaReady=true, producer=false, 无历史 → hard delete 继续。
- **DEL-DARK-01 / DEL-ACTIVE-01..05**（保留，tx 层观测 M1 访问）。
- **DEL-RACE-01**：真实两向事务交错（Race A → 409、Race B → writer LEDGER_TENANT_MISMATCH），`ORPHAN_AUTHORITATIVE_HISTORY = 0`。

---

## 6. 回归结果

> 全部在隔离 Neon 生产快照分支（`preview-t35-hardening`，父 = 生产 project `polished-thunder-16018212`）执行，用完删除。**无生产 DB 变更。**

| 项 | 结果 |
|---|---|
| T2-P1 pure（`p1-pure`） | 13/13 PASS |
| T2-P1 DB matrix（`p1-ledger-db`，含 DEL-SCHEMA/DEL-RACE） | 60/60 PASS |
| Tender Understanding V2（generic/hallucination/evidence） | 27/27 PASS（10+6+11） |
| Tender Eval 自测 | 12/12 PASS |
| T3 Corporate Memory（schema/pure/integration） | 4 + 13 + 43 PASS |
| Workforce / migration safety / release safety | PASS（test-all 内） |
| **test-all 全量** | **218/218 通过, 0 失败** |
| typecheck (`tsc --noEmit`) | PASS |
| eslint baseline | PASS（相对基线 −2 error，无新增 fingerprint） |
| next build | PASS（334/334 页） |
| ISOLATED_NEON_BRANCHES_LEFT | 0 |

---

## 7. 未解决风险

- 无新增未解决风险。写入侧并发保护覆盖当前全部 authoritative writer（Event / Cost）；Archive 无 writer（契约已冻结）。
- 锁开销：每次 `appendProjectEvent` / `createProjectCost` 多一条 `FOR KEY SHARE` 锁定 SELECT（替换原租户 findFirst，净查询数不变）；writer 间 FKS 兼容，不牺牲并发。
- Race 测试用 `setTimeout(500ms)` 制造交错窗口 + 20s 事务超时；隔离库稳定。属受控测试手段，非生产代码。

---

## 8. Production Activation 前剩余 Blocker（本轮不做）

生产 schema 激活仍须走**独立的 schema-equivalence + migration-recovery runbook**，逐项满足后方可置 `T2_LEDGER_SCHEMA_READY=true`：

1. `PRODUCTION_M1_SCHEMA_STATUS = PRESENT`（当前 NOT_PRESENT）。
2. `20260805090000_marketing_economics` 生产迁移状态 = RESOLVED（当前 **BLOCKING**：表已物化但无 migration 记录，须 `migrate resolve --applied` 后 deploy——属运维流程，本轮**未执行**）。
3. `LEGACY_EVENT_STORE_DECISION_GATE = PASS`。
4. Producer rollout 独立于 schema：先 `SCHEMA_READY=true, PRODUCERS_ENABLED=false`（gate 生效、零写入）观察，再逐步开 producer。

**本轮全部为代码/测试层加固；`PRODUCTION_MIGRATION = NO`、`PRODUCTION_DATA_MUTATION = NO`、`PRODUCTION_FLAG_CHANGE = NO`、`T4_STARTED = NO`。**
