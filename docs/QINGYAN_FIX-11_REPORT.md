# FIX-11 报告：调查室 summaryJson 的其它写入方改走写入入口，并加守卫

| 项 | 值 |
|---|---|
| change | `room-summary-writers-lock`（归档 `2026-11-16-room-summary-writers-lock`；`tender/room-summary` +3 条要求） |
| TASKFLOW | FIX-11（接 FIX-10） |
| 来源 | FIX-10 proposal 的 Out of scope；Lucas 2026-11-16「继续按推荐的做下一项」 |
| PR | LucasJ880/-#504（2026-11-16 合并）；归档 PR 见 TASKFLOW |
| 分支 | `claude/lucid-cray-kndw66` |
| 性质 | 修既有的并发丢数据与死锁。零 schema、零新模型调用、没有新增出站。**没有开关——合并即生效** |

## 1. 问题

FIX-10 修好了两处整块替换，新增了写入入口 `src/lib/tender-room/summary-json.ts`。另有 7 个文件、10 处写入是「先读整块 → 做别的事 → 展开旧值写回」，不拿项目行锁：

| 文件 | 写的键 | 读与写之间 | 后果 |
|---|---|---|---|
| `tender-intel/watch.ts` | `tenderWatch` | 抓公告页，最长 20 秒 | 抓取期间提交的报价、人工输入被盖掉；抓取期间停掉的盯梢被写回来、还发变化通知 |
| `tender-intel/orchestrate.ts`（2 处） | 外部情报各键、状态、首次推导的报价模型 | 授标检索、网页检索、模型分析，可能几分钟 | 期间别人写的全被盖掉；可能盖掉期间人工保存的报价模型 |
| `tender-bid-draft/generate.ts` | `bidDraft` | 短 | 盖掉报价同步刚写的我方报价 |
| `tender-analyst-memo/v2/pipeline.ts` | `analystMemoV2` | 短，每份分析十来次 | 同上 |
| `external-intel/award-history/route.ts`（3 处） | `externalConfirmed` | 短 | 同上 |
| `tender-watch/route.ts`（2 处） | `tenderWatch` | 短 | 同上 |
| `tender-bid-workspace/store.ts` | `bidWorkspace` | 锁的是房间行 | 报价同步仍会用旧值盖掉价格表；**两边锁的顺序相反，会死锁**（本机复现 `40P01 deadlock detected`，被中止的一边是工作区保存或报价同步） |

## 2. 做了什么

1. 7 个文件全部改走 `patchRoomSummary` / `patchRoomSummaryTx`：锁项目行 → 重读 → 只设 / 只去掉自己的键。依赖旧值的计算（竞争对手列表、授标确认字段、盯梢状态、投标工作区合并、报价模型要不要写）都挪进 patch 函数，在锁住后读到的最新值上做；路由返回的值从 patch 里带出来，与库里一致。
2. 跟标检查：重读时盯梢已不在或换了 URL，就不写、不通知，返回「没有盯梢」。
3. 外部情报：报价模型只在最新值里没有同版本有效模型时才写。
4. 授标确认（结构化表已就绪时）：同一事务里先锁项目行，再沉淀授标记录（与报价引擎同序）。
5. 投标工作区改锁项目行。
6. 守卫测试 `src/lib/tender-room/__tests__/summary-write-guard.test.ts`：`src/` 下直接写调查室 `summaryJson` 的只能是写入入口、报价引擎、报价表助手、新建房间这四处（写明原因），前三处确实先 `lockProject`；名单里的某处不再直接写时要求从名单删掉。去掉 `select: { … }` 再判断，不误报只读的地方。
7. 模型调用、外部请求、别的取数仍在锁外；请求、返回、权限、校验不变。

## 3. 需要你知道的取舍

- 守卫是源码扫描，认得 Prisma 的 `update / upsert / create / updateMany / createMany` 与原生 `UPDATE / INSERT INTO "BidIntelligenceRoom"`；绕过它要刻意（比如拼字符串的 SQL），代码评审时留意。
- 报价引擎与报价表助手本身已拿锁，没有迁到入口，留在名单里。
- 分析备忘每步落一次状态，现在每次都拿一次项目行锁（量级是每份分析十来次，每次一读一写）。
- 已经被盖掉的数据不补。

## 4. 与八条硬纪律的关系

| 纪律 | 情况 |
|---|---|
| 零 schema | 没有 schema 变更 |
| 出站先审批 | 没有新增出站；跟标通知只是不再在盯梢已停掉时发 |
| 禁止第三套队列 | 只是事务里一把既有的行锁 |
| 脱敏 | 不改 Muse 通道 |
| 不爬登录页 | 不涉及（跟标抓取照旧，只抓用户填的公开页） |
| 邮箱分离 | 不涉及 |
| 确定性优先 | 没有新增模型调用 |
| 测试注册 | 两个新测试已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` |

## 5. 验证

| 项 | 结果 |
|---|---|
| `summary-write-guard.test.ts`（新，CI 里跑） | 11 项通过；在 FIX-10 的代码上失败（列出 7 个文件的直接写入） |
| `room-summary-writers-db.isolated.test.ts`（新，本地隔离库，CI 里跳过） | 14 项通过，连跑 3 次稳定；在 FIX-10 的代码上 7 项失败（含死锁） |
| 这几个模块已注册的既有测试 | 29 个全部照旧通过（tender-bid-workspace、tender-intel、tender-analyst-memo、tender-bid-draft） |
| `npm run typecheck` / `npm run lint:baseline` | 退出码 0 / PASS |
| `check-test-registry.sh` / `test-runtime-architecture.sh` | OK / PASS |
| `openspec validate room-summary-writers-lock --strict` | valid |
| `npm test`（本地隔离库） | 673/682；9 项失败都在 `docs/QINGYAN_FIX-9_REPORT.md` §5 的已知清单里，没有新增；FIX-8～FIX-11 的 6 个测试在全量里都通过 |
| PR CI | 通过 |

写测试时的两个坑：交错用例要先预热路由（第一次调用比持锁时间长）；会被数据库中止的那一边要立刻接住它的 Promise，否则在等待期间变成未处理的拒绝、整个测试进程退出。

## 6. 没做的

- 补回已经丢失的数据。
- 投标工作区之外，GO 决定与模块投影不经 `summaryJson`，不涉及。
