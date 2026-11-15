# FIX-5 报告：并发建审批草稿时复用已有的那张

| 项 | 值 |
|---|---|
| change | `draft-idempotent-race-reuse` |
| TASKFLOW | FIX-5（Phase F 续） |
| 来源 | `docs/QINGYAN_VIS-1d_REPORT.md` §9 最后一条（隔离库跑 `tender-rfq/followup-auto-db` 时多出的 `25P02` 日志）；Lucas 2026-11-12：「现在做drafts.ts」，design Q1–Q2「全部按照推荐的来」 |
| 分支 | `claude/fix5-draft-idempotent-reuse`（从 main 开） |
| 性质 | 缺陷修复。零 schema、零模型调用、没有开关；`createDraftBatch` / `createDraft` / `requestApproval` 的签名与返回形状不变 |

## 1. 问题

审批的规范入口（审批端口 `requestApproval`）要求每张卡带幂等键，同一企业、同一幂等键在库里只能有一张（唯一约束）。建卡的 `src/lib/pending-actions/drafts.ts` 在一个事务里先按键查已有的；没有就插入；插入撞上唯一冲突时，本想「再查一次、复用先到者那张」。

但 Postgres 在唯一冲突后会把整个事务标为中止，之后这个事务里的任何查询都报 `25P02 current transaction is aborted`。所以「再查一次」从来没有成功过：后到的那个请求拿到「创建待确认草稿失败」，尽管一模一样的卡已经在库里了。

**实测**（本机隔离库，同一企业同一键并发两次）：10 轮里 9–10 轮一边成功、一边失败，库里每个键一行。会碰上的：网页上连点两次提交审批；两次扫描同时为同一封催单建卡；一批几张卡里有一张和别的请求撞键时，整批都失败回滚。

## 2. 修法

带企业与幂等键的那一条，插入改成「遇唯一冲突什么都不做」（`INSERT … ON CONFLICT DO NOTHING RETURNING`，Prisma 的 `createManyAndReturn` + `skipDuplicates`）：
- 插进去了：就是新建的那张；
- 没插进去：先到者已经建了。在同一事务里按键读出它，复用；
- 读不到：按失败处理（只可能是别的唯一约束冲突），整批失败、补偿，与以前相同。

`ON CONFLICT` 遇到别的事务刚插入、还没提交的同键行时会等它结束：提交了就什么都不做，回滚了就照常插入。事务显式用 READ COMMITTED，接下来的读取看得到先到者刚提交的行。事务里没有语句报错，同一批后面的条目照常执行。

其余不变：不带企业或幂等键的照旧普通插入；事务开头的「先按键查」保留（顺序重复时直接命中，不发插入）；复用时照旧写 `APPROVAL_CREATED` 审计、推 Muse（design Q2）。

独立代码审查后另补两处（§5）：
- 建好之后的步骤失败时，只补偿本批新建的卡，不再把复用的、别的请求建的那张标成失败；
- 运行时架构守卫认得 `createManyAndReturn` / `updateManyAndReturn` 也是写审批存储。

## 3. 交付清单

| 位置 | 改动 |
|---|---|
| `src/lib/pending-actions/drafts.ts` | 新增导出的 `createOrReuseDraftRow(tx, input)`；整批建行的事务逐条调它、显式 READ COMMITTED；删掉原来事务里捕获唯一冲突的分支；补偿只取本批新建的 id |
| `src/lib/runtime-architecture/guards.ts` | 审批存储写入的识别补上 `createManyAndReturn` / `updateManyAndReturn` |
| `src/lib/runtime-architecture/__tests__/guards-negative.test.ts` | 补一条反例（owner 目录外这样写被拦，owner 目录内不误报） |
| `src/lib/pending-actions/__tests__/draft-idempotency.test.ts`（新） | 纯函数，假事务注入：插入成功、先查命中、撞键后复用、撞键后读不到即抛错、不带键照旧插入；补偿范围与返回形状；接线源码断言 |
| `src/lib/pending-actions/__tests__/draft-idempotency-db.isolated.test.ts`（新） | 隔离库：顺序重复、同键并发 10 轮、一批撞键 5 轮、确定性竞态（另一事务持有未提交的同键行后提交 / 回滚） |
| `scripts/test-all.sh`、`scripts/test-ci-unit.sh` | 注册两个新测试（隔离库测试只进 `test-all.sh`，无库时跳过） |

## 4. 证据

**新测试在改动前后**（本机隔离库，PostgreSQL 16，迁移与 main 相同）：

| 测试 | 改动前的代码 | 改动后 |
|---|---|---|
| `draft-idempotency-db.isolated`（第一版，7 项） | 3 通过 / 4 失败：并发 10 轮里 9 轮一边失败；一批撞键 5 轮全失败；顺序重复通过 | 7 / 7，连跑三次相同 |
| `draft-idempotency-db.isolated`（补确定性竞态后，10 项） | 4 通过 / 6 失败：另一事务持有同键未提交行后提交的那一项也失败（必然复现） | 10 / 10，连跑三次相同 |
| `draft-idempotency`（纯函数，21 项） | 不能运行（`createOrReuseDraftRow` 不存在） | 21 / 21 |
| `guards-negative`（26 项） | 新加的一项不通过（守卫认不出 `createManyAndReturn`） | 26 / 26 |

失败时的报错与 VIS-1d 报告记下的一致：`tx.pendingAction.findFirst()` → `25P02 current transaction is aborted`。

**经建草稿路径的既有隔离库测试**（origin/main `ec2a46c2` 与本分支各一个库，逐个相同）：

| 测试 | origin/main | 本分支 |
|---|---|---|
| followup-auto-db.isolated | 28 | 28（`[createDraftBatch] failed … 25P02` 日志：main 1 行 → 本分支 0 行） |
| b2-approval-cas.isolated | 23 | 23 |
| durable-followup-m1.isolated | 61 | 61 |
| phase2c1-pause-resume | 26 | 26 |
| phase2c1-expiry-races | 7 | 7 |
| p0-execution-alignment | 51 | 51 |
| warranty-db.isolated | 52 | 52 |
| repair-visit-email-db.isolated | 26 | 26 |
| wechat-binding-confirm-db.isolated | 25 | 25 |
| audience-db.isolated | 44 | 44 |
| owner-today-db.isolated | 39 | 39 |
| phase3a3-approvals-smoke | 27 / 1 失败 | 27 / 1 失败（同一条既有失败：「Tool 停用后已批准路径也不能执行」） |

**会用到 `drafts.ts` 的既有纯函数测试**：`customer-followup-scenario` 14、`audit-labels` 11、`workload` 94、`guards-negative` 25 → 26（多的一项是本次补的反例），改动前后其余一致。

**门禁**（最终代码）：

| 门禁 | 结果 |
|---|---|
| `npm run test:ci` | `CI unit subset PASS` |
| `npm test` | 619/632；13 个失败与 origin/main（617/630）逐条相同，都是既有环境类（Postgres / Chromium / Gmail / Agent Trace）；多出的 2 个是本次新增的测试 |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `bash scripts/check-test-registry.sh` | 通过（已注册 607 个） |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `npx next build --webpack` | 通过（冷构建，`NODE_OPTIONS=--max-old-space-size=8192`） |
| `openspec validate draft-idempotent-race-reuse --strict` | valid |
| `/opsx:verify draft-idempotent-race-reuse` | 5/5 任务；6 条 ADDED 需求、7 个场景都有实现与测试；0 critical / 0 warning / 1 suggestion（「多键批次交叉撞键可能死锁」那句没有单独的场景，它描述的是与改动前相同的行为） |

## 5. 独立审查

开 PR 前请了一个不带结论的独立审查（只给 diff 与 spec 增量）。结论：没有 Blocker、没有 Major，修法在 READ COMMITTED 下站得住。处理：

| 编号 | 发现 | 处理 |
|---|---|---|
| M1 | 并发后到者现在会复用别人的行、继续走事务之后的步骤；这时若它的后续步骤（如标记 AgentRun 待审批）抛错，补偿会把先到者那张已按成功返回的卡标成失败 | 修。复用的结果内部带标记，补偿只取本批新建的 id；返回给调用方与写审计前去掉标记（spec「复用的草稿不被本批补偿」，design D5） |
| M2 | 隔离库测试撞上竞态靠时序（连接池为 1 时会串行化、测不到）；「先到者回滚」没有覆盖 | 修。加确定性场景：测试里另开事务先建同键行、挂住不提交，再发起建草稿，之后提交 / 回滚，分别断言复用 / 新建，并断言建草稿确实在等 |
| M3 | 运行时架构守卫的写入识别认不出 `createManyAndReturn` / `updateManyAndReturn` | 修。补正则与反例；owner 目录外现在没有任何文件这样写，基线不变 |
| N1 | 隔离级别只靠默认 | 修。事务显式 READ COMMITTED，纯函数测试断言；design 里更高隔离级别下的表现改准（报序列化失败，不是「读不到」） |
| N2 | 两个都带多个幂等键的批次按相反顺序互相撞键时可能死锁，一批失败 | 写进 spec 与 design 风险（与改动前相同；生产上没有带多个幂等键的批次） |
| N3 | 「没有草稿被补偿标成失败」这条在旧代码上也通过 | 保留，不算作回归证据 |
| N4 | 假事务类型过宽，测试只能强转 | 修。`DraftRowTx` 收窄为用到的三个方法 |

## 6. 已知限制

- 两个都带多个幂等键、按相反顺序互相撞键的批次并发时，数据库可能判死锁，其中一批失败（与改动前相同）。现在生产上的批次都只带一个幂等键或不带。
- 复用时照旧写一条 `APPROVAL_CREATED` 审计、推一次 Muse、调一次「标记 AgentRun 待审批」（design Q2，与顺序重复的既有行为一致）。来自不同 AgentRun 的两个请求撞键时，后到者的 AgentRun 也会被标为待审批，而那张卡挂在先到者的 AgentRun 上。
- 同一幂等键、不同载荷的请求仍复用先到的那张（幂等键的既有语义），不比对载荷。

## 7. 没做的

- 其他地方的 `PendingAction` 直接建行（`scripts/` 的种子脚本、运行时架构基线里登记的旧路径）。
- 复用时不写审计、不推送（会改变既有的顺序重复路径，design Q2 拍板不改）。

## 8. 上线

合并后照常 `vercel --prod`。零 schema，无回填、无开关；回滚即回退代码。
