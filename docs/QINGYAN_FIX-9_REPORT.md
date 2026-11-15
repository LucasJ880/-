# FIX-9 报告：报价表助手的写入与报价同步串行

| 项 | 值 |
|---|---|
| change | `pricing-helper-write-lock`（归档 `2026-11-15-pricing-helper-write-lock`） |
| TASKFLOW | FIX-9（Phase F 续，接 FIX-8） |
| 来源 | FIX-8 design.md 的 Risks；Lucas 2026-11-15：「start the race-condition fix task」 |
| PR | LucasJ880/-#483（2026-11-15 合并）；归档 PR 见 TASKFLOW |
| 分支 | `claude/lucid-cray-kndw66`（rebase 到含 #476 FLOW-H2、#479 的 main 之后再开 PR） |
| 性质 | 修一个既有的并发错。零 schema、零新模型调用、没有新增出站、没有新的锁表 / 队列。**没有开关——合并即生效** |

## 1. 问题

FIX-8 之后报价表助手保存仍是「读整块 → 改 → 写整块」，不加锁。报价引擎写镜像时在事务里先锁项目行（`lockProject`：`SELECT "id" FROM "Project" WHERE "id" = $1 FOR UPDATE`）。交错：

1. 报价同步拿锁、把新报价写进房间、还没提交；
2. 保存读房间——读到的是旧的已提交值；
3. 保存的 `update` 等房间行锁；
4. 同步提交，保存紧接着把旧报价写回去。

本机隔离库强制交错，每次必现。「重新推导」（`derive`）更严重：它在调模型之前读整块 `summaryJson`，模型返回后原样写回，窗口是一次模型调用的时长。反方向也不安全：同步若在保存读之后、写之前读房间，会把保存的输入冲掉——只有两边拿同一把锁才两头都安全。

## 2. 做了什么

1. 导出 `lockProject`（`src/lib/quote-engine/tender-bid.ts`，行为不变）。
2. 路由（`src/app/api/projects/[id]/pricing-helper/route.ts`）新增 `writeRoomLocked`：事务里先 `lockProject`，再重读房间，在最新值上算出整块，同一事务写回；房间在两次读之间被删返回 409。
3. 保存的计算抽成纯函数 `buildSave(sj, body, ctx)`，在锁住后重读的值上调用；400 时不写。推导的「已有人工模型不覆盖」也按重读值判断。
4. **锁里只有一读一写**：推导的模型调用、FLOW-H2 的比价取数（`loadCompareCostSuggestionSafe`）都在锁外。FLOW-H2「有声明且本次成本不为空才用建议」的条件保持不变（锁外按有声明取，锁里成本为空时不交给 `nextCostSource`）。
5. 新增隔离库测试 `src/lib/tender-pricing/__tests__/pricing-helper-lock-db.isolated.test.ts`（17 项）：报价同步在 `lockProject` 下写镜像、先不提交，这期间调真实路由保存（整份 / 只改一项 / 只存模型 / 400）与推导，提交后断言新报价与新输入都在。

## 3. 需要你知道的取舍

### 3.1 锁项目行，不锁房间行、不做乐观并发

报价引擎读房间时不锁房间行，只锁房间行挡不住「同步读旧值 → 等锁 → 写回旧输入」。乐观并发（比较 `updatedAt` 重试）要连报价引擎一起改。复用同一把项目行锁最小。FIX-4 的守卫只禁止对 `Organization` 行取 `FOR UPDATE`，不涉及。

### 3.2 rebase 时与 FLOW-H2 合在一起

写完之后 main 上合进了 FLOW-H2（#476，成本来源），改的是同一个保存分支。rebase 时以 main 的路由为底重写：来源逻辑原样搬进 `buildSave`，FLOW-H2 接线测试检查的源码行都保留（`const orgId = access.project.orgId;` 两处、`await loadCompareCostSuggestionSafe({ projectId, orgId })` 两处、来源声明与返回的两行）。

### 3.3 测试里的预热

路由第一次被调用要加载模块、建连接，耗时比测试里同步持锁的 400 毫秒还长，交错就不成立（第一版测试第一个用例在旧代码上「意外通过」就是这个原因）。测试开头先调一次预热，之后旧代码上稳定失败。

### 3.4 其它

- 同一项目的保存 / 推导与报价同步不再并行，彼此等一读一写（毫秒级）。
- 推导的 60 秒频控仍在锁外判断，两个推导同时到达可能都调一次模型（与改动前相同）。

## 4. 与八条硬纪律的关系

| 纪律 | 情况 |
|---|---|
| 零 schema | 没有 schema 变更 |
| 出站先审批 | 没有新增出站 |
| 禁止第三套队列 | 只是事务里的一把既有行锁，没有新的锁表、队列、lease |
| 脱敏 | 不改 Muse 通道；返回形状不变 |
| 不爬登录页 | 不涉及 |
| 邮箱分离 | 不涉及 |
| 确定性优先 | 没有新增模型调用；推导的模型调用照旧，挪到锁外 |
| 测试注册 | 新测试已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` |

## 5. 验证

| 项 | 结果 |
|---|---|
| `pricing-helper-lock-db.isolated.test.ts`（新，本地隔离库，CI 里跳过） | 17 项通过，连跑 3 次稳定；在 main 的路由上 4 项失败（旧报价被写回）；去掉锁调用的变异同样 4 项失败 |
| `pricing-helper-save-db.isolated.test.ts`（FIX-8） | 17 项照旧通过 |
| `compare-cost-source.test.tsx` / `compare-cost-source-db.isolated.test.ts`（FLOW-H2） | 83 / 42 项照旧通过 |
| `pricing-helper.test.ts` / `quote-ops-contract.test.ts` | 13 / 75 项照旧通过 |
| `npm run typecheck` | 退出码 0 |
| `npm run lint:baseline` | PASS |
| `bash scripts/check-test-registry.sh` | OK（638 个） |
| `openspec validate pricing-helper-write-lock --strict` | valid |
| `npm test`（本地隔离库） | rebase 到含 #476、#479 的 main 之后：657/667；10 项失败都与本次无关，见下方清单 |
| PR CI（`validate-lint-typecheck-test-build`） | 通过（2026-11-15 21:46 UTC） |

**main 上本来就失败的测试**（本地隔离库，2026-11-15；与 FIX-8 / FIX-9 无关，逐个在 main 上复现过）：Sunny 工艺单 DB 端到端、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Phase3A-5 Overview Acceptance、T4 授标情报真实 Postgres 矩阵、报价 PDF 分页布局、MAIL-2 来信观察 DB（「超过 24 小时仍缺权限：再提醒一次」）、Mention Gateway M2-A Identity DB（复用本地库时撞 `(orgId, channel)` 唯一约束）。Autopilot A2-P0 只在全量里偶发失败一次（`permanent A2 failure reaches outbox DEAD`），单独跑在 main 与本分支都通过。

## 6. 没做的

- `summaryJson` 的其它写入方（情报、分析等写别的键的地方）不拿项目行锁，本次不改。
- 推导频控的并发（见 §3.4）。
