# Design：报价表助手的保存与推导和报价引擎串行（FIX-9）

## Context

- 写 `BidIntelligenceRoom.summaryJson.pricingInputs` 的两方（见 FIX-8 design.md Context）：
  - 报价引擎 `src/lib/quote-engine/tender-bid.ts`：`writeBidMirrorsTx` / `clearRoomPriceMirrorsTx` 在调用方事务里读房间、展开原键、写回；调用方（`syncTenderBidPointerTx`、`selectQuoteAsTenderBid`）先 `lockProject(tx, projectId)` 即 `SELECT "id" FROM "Project" WHERE "id" = $1 FOR UPDATE`。`lockProject` 目前是模块私有函数。
  - 报价表助手 `src/app/api/projects/[id]/pricing-helper/route.ts` 的 POST：用 `db`（非事务）`findUnique` 读房间，算出 `next`，再 `db.bidIntelligenceRoom.update` 整块写 `summaryJson`。
- 竞争的具体样子（READ COMMITTED）：报价引擎事务已更新房间行、未提交。路由的 `findUnique` 不阻塞，读到旧快照；路由的 `update` 撞上房间行的行锁等待；报价引擎提交后路由的 `update` 继续执行，写入的是基于旧快照算出的整块 JSON → 新镜像被旧镜像覆盖。`derive` 的读与写之间还隔着 `deriveScoringModel`（可能调模型、数秒）。
- Prisma 交互式事务默认 `timeout` 5 秒、`maxWait` 2 秒，`timeout` 包含等行锁的时间（`src/lib/supplier-intel/run-service.ts` 的 `RUN_WRITE_TX_OPTIONS` 注释有实测）。

## Goals / Non-Goals

**Goals**

- 路由的两条写路径与报价引擎在同一把项目行锁上串行；后提交者基于先提交者的结果合并。
- 持锁期间只做数据库读写，不调模型。

**Non-Goals（具体到文件）**

- 不改 `src/lib/quote-engine/tender-bid.ts` 里任何函数体与锁模式，只给 `lockProject` 加 `export`；不改 `src/lib/quote-engine/service.ts`、`src/lib/quote-engine/index.ts`（它已 `export *`，自动带出）。
- 不改 GET 分支、`src/lib/tender-pricing/project-context.ts`、`src/lib/tender-pricing/derive.ts`、`src/lib/tender-pricing/calc.ts`、`src/lib/tender-bid-draft/gather.ts`、`src/components/tender/pricing-helper-card.tsx`。
- 不改 proposal「Out of scope」列出的其它 `summaryJson` 写入方。

## Decisions

### D1 复用报价引擎的 `lockProject`，只加 `export`

路由从 `@/lib/quote-engine/tender-bid` 引入 `lockProject`，与报价引擎取同一把锁、同一种模式（`FOR UPDATE`）。

- 否决：在路由里再写一条 `SELECT … FOR UPDATE`。两处 SQL 将来会走样（FIX-4 就是在收拢散落的同类语句）。
- 否决：改用 `FOR NO KEY UPDATE`（像 FIX-4 的 `lockOrganizationRow`）。它同样与报价引擎的 `FOR UPDATE` 互斥，且不挡外键检查；但要么与报价引擎用不同的锁函数（重复 SQL），要么改报价引擎的锁模式（超出本次范围、影响报价引擎所有路径）。路由持锁只有两三条语句，挡外键插入的时间与报价引擎自身相当，可接受。

### D2 `save` 整段进事务，结果用判别联合带出事务

`db.$transaction(async (tx) => { await lockProject(tx, projectId); 读房间; 校验; 合并; tx.bidIntelligenceRoom.update(...) })`，事务回调返回 `{ kind: "no_room" } | { kind: "bad_request", error } | { kind: "ok", inputs, model }`，事务外再映射成 409 / 400 / 200。校验失败时回调直接返回、事务里没有写，提交即结束（等同于什么都没写）。合并规则沿用 FIX-8（`{ ...prevPi, ...inputs }`），代码原样移入。

- 否决：保留事务外的第一次读，只把写放进事务并比较前后版本（乐观并发）。`summaryJson` 没有版本列，零 schema 下只能比整块 JSON，冲突后还要重试；行锁更简单，且与报价引擎的做法一致。
- 否决：在事务里 `throw` 来表达 400 / 409。要另造错误类并在外层分辨，判别联合更直接，也不会把校验失败记成事务错误。

### D3 `derive`：模型调用在事务外，事务内重读、只改两个键

事务外照旧：第一次读房间（409）、频控（429）、取分析（404）、`deriveScoringModel`。然后进事务：`lockProject` → 重读房间 → `existing = 重读到的 pricingModel` → `next = { ...freshSj, pricingDerivedAt: now }`，`derived.model && existing?.source !== "HUMAN"` 时再写 `pricingModel` → `tx.bidIntelligenceRoom.update`。返回的 `model` / `keptHumanOverride` 按重读到的 `existing` 计算。重读时房间已不在（极少见）返回 409。

- 否决：整个 `derive`（含模型调用）放进事务。持锁数秒会挡住报价引擎的选标与状态迁移，也会撞 Prisma 事务超时。
- 否决：频控也在事务内重查。两个几乎同时的推导第二个会在已经调过模型之后才被拒，白花一次调用而对数据没有好处；保持原有的事务外判断（proposal Out of scope）。

### D4 事务选项显式给足等锁时间

两处事务都用 `{ maxWait: 5_000, timeout: 15_000 }`（路由内常量）。报价引擎的状态迁移事务里有计算与多条写，默认 5 秒的 `timeout` 把等锁时间算在内，排队时可能在等锁阶段就超时（P2028），用户会看到 500。15 秒覆盖排队，正常路径仍是毫秒级。

- 否决：沿用默认选项。与 `supplier-intel` 实测过的同类问题相同。
- 否决：复用 `RUN_WRITE_TX_OPTIONS`。那是供应商情报 Run 的预算，跨模块引用会把两边耦合在一起。

### D5 测试用「确认被挡住再提交」来强制交错

隔离库测试开事务 A：`lockProject` + `writeBidMirrorsTx`（或 `writePendingMirrorsTx`、或直接写人工模型），取 `pg_backend_pid()`，然后停在一个由测试控制的 Promise 上。并发调用真实路由；测试轮询 `pg_stat_activity`，直到有一个后端的 `pg_blocking_pids(pid)` 含 A 的 pid（旧代码挡在房间行的 `UPDATE` 上——此时它已经读过旧快照；新代码挡在项目行锁上），再放行 A 提交，等路由返回后断言。对 `derive`，测试库里给项目建一条没有评分事实的已完成分析，`deriveScoringModel` 走 `via: "NONE"`、不调模型。

- 否决：用 `setTimeout` 估计时序。不稳定，CI 机器慢时会假通过或假失败。
- 否决：给路由加测试钩子（例如读完之后等一个回调）。生产代码里留测试专用分支。
- 「推导期间有人存了人工模型」场景用事务 A 直接写人工模型模拟另一笔持锁写入（与 `save` 的写入等价）；没有评分事实时推导出的模型为 null，旧代码在这一场景下也不会覆盖 `pricingModel`，因此这一条只断言新行为，不作为「旧代码失败」的证据；旧代码失败由镜像场景证明。

## 锁序与死锁

路由事务：锁 `Project` 行 → 读 / 写 `BidIntelligenceRoom` 行。报价引擎：锁 `Project` 行 → 写 `Project` → 读 / 写 `BidIntelligenceRoom`。两者先锁项目行，房间行在后，不成环。其它不锁项目行的房间写入方只取房间行一把锁，也不成环。

## 与八条硬纪律

1. 零 schema：不涉及——没有新表、新列、迁移；只用既有行锁。
2. 出站先审批：不涉及——没有新增对外发送；`derive` 的模型调用次数不变。
3. 禁止第三套队列：遵守——不新增 queue / scheduler / lease / worker / 锁注册表；只是事务里对既有项目行取 `FOR UPDATE`，与报价引擎、FIX-7 的「同一项目加锁查重」同类。
4. 脱敏：遵守——两种返回都不含镜像的我方报价键（spec「串行不改变对外行为」）；不改 Muse 通道。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守——不新增 LLM 调用；持锁期间不调模型。
8. 测试注册：遵守——新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`scripts/check-test-registry.sh` 校验。

## Risks / Trade-offs

- [保存 / 推导要等报价引擎正在进行的事务] → 报价引擎事务是毫秒到百毫秒级；D4 的超时覆盖排队。
- [路由持 `FOR UPDATE` 期间挡住往该项目插入带外键的行] → 持锁只有一次读、一次写；与报价引擎自身的持锁相同量级（D1）。
- [其它 `summaryJson` 写入方仍可能整块覆盖镜像] → 已在 proposal Out of scope 逐个列出，另开 change。
- [两次几乎同时的推导都调模型] → 行为与改动前相同（D3）。

## Migration Plan

无数据迁移、无开关，合并即生效。回滚 = 回退本 PR，代码回到 FIX-8 的不加锁版本。

## 验证方式

- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated … npx tsx src/lib/tender-pricing/__tests__/pricing-helper-lock-db.isolated.test.ts`：本地隔离库全过；把路由临时换回 FIX-8 版本再跑，镜像交错场景失败。
- `npx tsx src/lib/tender-pricing/__tests__/pricing-helper-save-db.isolated.test.ts`（FIX-8 的 17 项）不改断言照旧全过。
- `npx tsx src/lib/tender-pricing/__tests__/pricing-helper.test.ts`（含新增守卫）通过。
- `npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts`、`quote-ops-contract.test.ts` 照旧通过（`lockProject` 加 `export` 不改结构守卫）。
- `bash scripts/check-test-registry.sh` OK；`npm test` 无新增失败；`npm run typecheck` 退出码 0；`npm run lint:baseline` PASS；`openspec validate pricing-helper-save-locks-project --strict` valid。
