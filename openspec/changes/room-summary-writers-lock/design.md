# Design：调查室 summaryJson 的其它写入方改走写入入口，并加守卫（FIX-11）

## Context

- 写入入口（FIX-10）：`patchRoomSummaryTx(tx, { projectId, roomId?, patch: (latest) => { set?, unset? }, data? })` 先 `lockProject`、再按 id 或项目重读房间、只改给出的键；`patchRoomSummary` 自带事务；房间不存在返回 `null`、不写。
- 迁移的写入方与它们原来的窗口：

| 文件 | 写的键 | 读与写之间 |
|---|---|---|
| `tender-intel/watch.ts` | `tenderWatch` | 抓公告页，最长 20 秒 |
| `tender-intel/orchestrate.ts`（2 处） | 外部情报各键、`externalIntelStatus`、首次推导的 `pricingModel` | 授标检索、网页检索、模型分析，可能几分钟 |
| `tender-bid-draft/generate.ts` | `bidDraft` | 模型合成之后读、写（短） |
| `tender-analyst-memo/v2/pipeline.ts` | `analystMemoV2` | 每步落一次（短，但次数多） |
| `external-intel/award-history/route.ts`（3 处） | `externalConfirmed` | 读、算、写（短） |
| `tender-watch/route.ts`（2 处） | `tenderWatch` | 读、写（短） |
| `tender-bid-workspace/store.ts` | `bidWorkspace` | 锁房间行后读、写 |

## Goals / Non-Goals

**Goals**：所有 `summaryJson` 写入方与报价引擎互斥；谁写都只改自己的键；依赖旧值的计算在最新值上做；工作区保存不再与报价同步死锁；新写法绕不开。

**Non-Goals**：不改报价引擎、报价表助手（已拿锁）；不改读方；不补丢失的数据。

## Decisions

### D1 依赖旧值的计算挪进 patch 函数

`patch` 收到的是锁住后重读的最新值。竞争对手列表、授标确认字段（并到最新的 `externalConfirmed` 上）、投标工作区合并（`mergeWorkspace(readStoredWorkspace(latest), …)`）、盯梢状态（`lastHash` 用最新的比）都在这里算；路由返回的值从 patch 里带出来，保证与库里一致。

### D2 跟标检查：盯梢在抓取期间没了就放弃这次结果

重读到的 `tenderWatch.url` 与抓取时的不同（被停掉或换了 URL）时不写、不发变化通知，返回 `no_watch`。否则「停止盯梢」之后，正在进行的那次检查会把它写回来。

### D3 外部情报的报价模型按最新值判断

原来按开头读到的值判断「还没有模型就写首次推导的」。现在在最新值上判断：已有同版本、价格权重是数字的模型（包括期间人工保存的）就不写。

### D4 投标工作区改锁项目行

原来 `SELECT … FROM "BidIntelligenceRoom" … FOR UPDATE`。报价同步先锁项目行、读房间（不锁房间行）、再写房间；工作区先锁房间行、写审计时外键检查要项目行的共享锁——两边顺序相反，强制交错时数据库报死锁并中止其中一边。改成与报价引擎同一把项目行锁后，两边按同一顺序排队。

### D5 授标确认事务里先锁项目行

`materializeWinnerConfirmation` 与写 `externalConfirmed` 原来在同一事务里、先沉淀记录再写房间。现在先 `patchRoomSummaryTx`（锁项目行），再沉淀；任一步失败整体回滚，行为不变。先锁项目行与报价引擎同序。

### D6 守卫

`src/lib/tender-room/__tests__/summary-write-guard.test.ts` 扫 `git ls-files src`（不含测试）：对 `bidIntelligenceRoom.update / upsert / create / updateMany / createMany` 取配平括号内的调用文本，去掉 `select: { … }` 后仍出现 `summaryJson` 即算直接写；原生 SQL 的 `UPDATE / INSERT INTO "BidIntelligenceRoom"` 同一行含 `summaryJson` 也算。只允许名单里的文件，并逐个核对它们确实先 `lockProject`；名单里的文件不再直接写时要求从名单删掉。

## Risks / Trade-offs

- 外部情报、跟标检查、草稿、备忘的写入会等正在进行的报价同步（一读一写），反之亦然。
- 分析备忘每步一次的写入现在每次都拿一次项目行锁；量级是每份分析十来次。

## Migration Plan

无数据迁移。
