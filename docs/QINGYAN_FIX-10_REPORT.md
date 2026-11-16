# FIX-10 报告：分析投影与开始调查不再整块替换调查室 summaryJson

| 项 | 值 |
|---|---|
| change | `room-summary-merge-write`（归档 `2026-11-16-room-summary-merge-write`；新 capability `tender/room-summary`） |
| TASKFLOW | FIX-10（Phase F 续，接 FIX-8 / FIX-9） |
| 来源 | FIX-9 交接 §0.5e 第 1 条「summaryJson 的其它写入方还没有拿这把锁」的只读排查；Lucas 2026-11-16「继续按推荐的做下一项」 |
| PR | LucasJ880/-#498（2026-11-16 合并）；归档 PR 见 TASKFLOW |
| 分支 | `claude/lucid-cray-kndw66`（从 main 开，直接指向 main） |
| 性质 | 修一个既有的**数据丢失**错。零 schema、零模型调用、没有新增出站。**没有开关——合并即生效** |

## 1. 问题

`BidIntelligenceRoom.summaryJson` 是好几个功能共用的一个 JSON 位：报价表助手的人工输入与报价模型、报价引擎镜像的我方报价（`pricingInputs.ourPrice*`）、投标工作区的价格表与补遗（`bidWorkspace`）、跟标（`tenderWatch`）、外部情报等。

- **分析投影**（`src/lib/tender-auto-analysis/project-room.ts`，worker 每次分析跑完的 `PROJECT_ROOM` 一步）写的是「这次分析的摘要 + `projectedFromRunId`」，别的键全部丢掉。也就是说，**每来一份补遗、每重新分析一次，人工填的报价输入、镜像的我方报价、投标工作区录好的价格表、跟标都被清空**。本机隔离库复现：房间里原有 `pricingInputs`、`bidWorkspace`、`tenderWatch`，投影之后只剩 `projectName`、`projectedFromRunId`。
- **开始投标调查**（`src/lib/bid-workflow/start-intelligence.ts`）在房间已存在、还没有摘要时（投标工作区或报价表助手先建了房间），整块换成初始摘要，同样冲掉别的键。

## 2. 做了什么

1. 新增写入入口 `src/lib/tender-room/summary-json.ts`：`patchRoomSummaryTx` / `patchRoomSummary`。事务里先 `lockProject`（报价引擎与报价表助手用的同一把项目行锁），再重读最新 `summaryJson`，只设 / 只去掉调用方给出的键；入口不提供整块替换。纯函数 `applyRoomSummaryPatch` 可单测。
2. 分析投影改走入口：纯函数 `projectionPatch` 设这次分析摘要里的键、`projectedFromRunId`，并记下这次写了哪些键（新键 `projectedKeys`）；只去掉「上一次投影记下的、这一次没有的」键。
3. 开始调查在已有房间、还没有摘要时改走入口，只设初始摘要的键。新建房间的路径不变。

## 3. 需要你知道的取舍

- **已经被清空的数据不补**：丢掉的人工输入、投标工作区价格表要人重新填；镜像的我方报价在下一次报价同步（选标、改价、取消）时恢复。
- **投影记自己写了哪些键，而不是维护「别的功能的键白名单」**：白名单要求以后每加一个功能都记得改，忘了就再丢一次。代价是 `summaryJson` 多一个 `projectedKeys`。
- 改动前投影过的房间没有 `projectedKeys`：那一次只覆盖、不去掉旧分析独有的键；从下一次起按记录去掉。
- 投影与开始调查现在会等正在进行的报价同步（一读一写，毫秒级）。

## 4. 与八条硬纪律的关系

| 纪律 | 情况 |
|---|---|
| 零 schema | 没有 schema 变更；仍写既有 JSON 位 |
| 出站先审批 | 没有新增出站 |
| 禁止第三套队列 | 只是事务里一把既有的行锁，没有新的锁表、队列、lease |
| 脱敏 | 不改 Muse 通道 |
| 不爬登录页 | 不涉及 |
| 邮箱分离 | 不涉及 |
| 确定性优先 | 不调模型；投影规则是纯函数 |
| 测试注册 | 两个新测试已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` |

## 5. 验证

| 项 | 结果 |
|---|---|
| `summary-json.test.ts`（新，纯函数与接线，CI 里跑） | 16 项通过 |
| `room-summary-merge-db.isolated.test.ts`（新，本地隔离库，CI 里跳过） | 15 项通过，连跑 3 次稳定；在改动之前的代码上 5 项失败（别的功能的键全部丢失、交错时新报价丢失） |
| 附近的既有测试 | `bid-workflow` 4 个、`tender-detail-ia.test.ts`、`tender-auto-analysis` 7 个，全部照旧通过 |
| `npm run typecheck` | 退出码 0 |
| `npm run lint:baseline` | PASS |
| `bash scripts/check-test-registry.sh` / `test-runtime-architecture.sh` | OK / PASS |
| `openspec validate room-summary-merge-write --strict` | valid |
| `npm test`（本地隔离库） | 671/680；9 项失败都在 `docs/QINGYAN_FIX-9_REPORT.md` §5 的已知清单里，没有新增 |
| PR CI | 通过 |

写测试时的一个坑：Postgres 的 `jsonb` 不保留对象里键的顺序，比较库里读回的对象要先按键排序。

## 6. 没做的

- 其它「读整块 → 展开 → 写回」的写入方（跟标、外部情报、投标草稿、分析备忘、投标工作区）：FIX-11（`room-summary-writers-lock`）。
- 补回已经丢失的数据。
