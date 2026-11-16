# Proposal：调查室 summaryJson 的其它写入方改走写入入口，并加守卫

TASKFLOW：FIX-11（接 FIX-10）
来源：FIX-10（`room-summary-merge-write`）proposal 的 Out of scope；Lucas 2026-11-16「继续按推荐的做下一项」。

## Why

FIX-10 修好了两处整块替换，并新增了写入入口 `src/lib/tender-room/summary-json.ts`。还有 7 个文件、10 处写入是「先读整块 → 做别的事 → 展开旧值写回」，不拿项目行锁：

- 跟标检查 `src/lib/tender-intel/watch.ts`：读完去抓公告页（最长 20 秒）再写回；抓取期间提交的报价、人工输入都会被盖掉；抓取期间被停掉的盯梢还会被写回来。
- 外部情报 `src/lib/tender-intel/orchestrate.ts`：读完做授标检索、网页检索、模型分析（可能几分钟）再写回，期间别人写的全部被盖掉；报价模型按开头读到的值判断要不要写，可能盖掉期间人工保存的模型。
- 投标草稿 `src/lib/tender-bid-draft/generate.ts`、分析备忘 `src/lib/tender-analyst-memo/v2/pipeline.ts`、外部情报确认 `…/external-intel/award-history/route.ts`（3 处）、盯梢设置 `…/tender-watch/route.ts`（2 处）：窗口较短，同样会盖掉报价同步刚写的我方报价（本机强制交错复现）。
- 投标工作区 `src/lib/tender-bid-workspace/store.ts`：锁的是房间行。报价同步读房间时不锁它，仍会用旧值把价格表盖掉；而且两边锁的顺序相反（工作区先锁房间行、写审计时要项目行；同步先锁项目行、再写房间），**会死锁**，其中一边被数据库中止（本机复现 `40P01 deadlock detected`）。

## What Changes

- 上面 7 个文件的写入全部改走 `patchRoomSummary` / `patchRoomSummaryTx`：锁项目行 → 重读 → 只设 / 只去掉自己的键。依赖旧值的计算（竞争对手列表、授标确认字段、盯梢状态、投标工作区合并、报价模型要不要写）都改在重读到的最新值上做。
- 跟标检查：重读时发现盯梢已被停掉或换了 URL，就不写、不通知，返回「没有盯梢」。
- 外部情报：报价模型只在最新值里还没有同版本的有效模型时才写。
- 外部情报确认授标（结构化表已就绪时）：同一事务里先锁项目行，再沉淀授标记录。
- 投标工作区：改锁项目行，与报价引擎同序，不再死锁。
- 新增守卫测试：`src/` 下直接写调查室 `summaryJson` 的地方只能是写入入口本身与名单里说明了怎么拿锁的几处（报价引擎、报价表助手、新建房间）；名单里的几处确实先 `lockProject`。
- 模型调用、外部请求、别的取数都仍在锁外；请求、返回、权限、校验不变。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/` 下任何文件。

## Out of scope

- 报价引擎与报价表助手本身已拿锁，不迁到入口（守卫名单里写明原因）。
- `summaryJson` 以外的列（GO 决定、模块投影）：不涉及。
- 已经被盖掉的数据不补。
- schema 变更、新的锁表 / 队列、模型调用、对外动作、新开关：没有。**没有开关，合并即生效。**

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/room-summary`（FIX-10 新建）：新增「其它写入方只改自己的键」「跟标检查不写回已停掉的盯梢」「新的写入必须经入口」三条要求。
