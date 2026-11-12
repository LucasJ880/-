# Design：项目页上能记「已提交」并留回执（FLOW-H4a）

## Context

- 写「提交时间」的路径只有一条：`POST /api/projects/[id]/advance-stage` → `advanceProjectStage()`（`src/lib/tender/stage-transition.ts`）。页面上唯一调用它的是对话抽屉里模型给出的「阶段推进建议」卡片。`PATCH /api/projects/[id]` 明确拒绝写阶段时间。「提交」页签上写着「提交/开标日期在关键日期里维护」，对提交时间是错的。
- 这条路径：时间只能是点击那一刻；同时把招投标状态写成 `bid_submitted`；发讨论区系统消息、一条高优先级成员通知、（项目有来源系统时）BidToGo 回调；**在标为已提交之后**自动建「准备投标文件」「提交投标」两条任务；不能撤销；可以从更早的阶段直接跳过来。
- 招投标状态是已中标、未中标、备标中等而没有任何阶段时间的项目，阶段推导已经落在「项目提交」，再推进会被判为「无需操作」——提交时间永远写不进去。财务侧把没有提交时间的项目算作「未提交」。
- 回执没有现成的落点：项目文件没有类别列，走现有上传接口会触发招标分析、计入文件包。零 schema 的落点有审计日志（只追加）、讨论区系统消息的 `metadata`、`BidIntelligenceRoom.summaryJson` 里自己的一块。
- 「只追加的审计记录、读最新一条」已有先例：询价自动跟进的个人开关（`src/lib/tender-rfq/auto-followup-optin-service.ts`）。
- `src/lib/tender-price-schedule/closing-time.ts` 里已有回执的形状 `SubmissionRecord { submittedAt, receiptRef }`。

## Goals / Non-Goals

**Goals**

- 人交完标之后，在项目页上一步记下来：什么时候、怎么交的、回执编号。
- 「截标已过、没有提交记录」的卡片有地方可指。
- 记错了能更正，更正留痕。

**Non-Goals（具体到文件）**

- 不代为提交、不碰门户：没有任何出站调用是新增的。
- 不加文件上传：`src/app/api/projects/[id]/files/**` 不动。
- 不改 `src/lib/muse-bridge/**`、`src/lib/tender-bid-readiness/**`、`src/lib/tender-bid-workspace/**`、`src/app/api/projects/[id]/advance-stage/route.ts`、`src/app/api/projects/[id]/route.ts`。
- 不改 `src/lib/tender/stage-tasks.ts` 的任务模板（对话里推进阶段时仍会建那两条任务）。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 第一次记录走既有的阶段推进，只给它加两个可选参数

`advanceProjectStage` 新增 `occurredAt?: Date`（写入的时间，不传时是现在）与 `skipStageTasks?: boolean`（不为新阶段建任务；上一阶段的自动任务照旧关掉）。不传时逐字不变。新接口第一次记录时调用它：系统消息、审计、成员通知、BidToGo 回调都沿用。

- 否决：新接口自己写提交时间与招投标状态。那就有了第二套「进入提交阶段」的写法，两处的副作用迟早不一致。
- 否决：照旧建那两条任务。「已提交」之后出现一条三天后到期的「提交投标」任务是错的。
- 否决：顺手改掉任务模板。对话里的阶段推进也在用，是另一个问题。

### D2 更正与补记不是阶段变化，由新模块自己写这一个日期

项目已经在「项目提交」阶段时（已有提交时间；或招投标状态使它算作提交阶段而没有提交时间），阶段推进函数会判为「无需操作」。这时新模块在一个事务里只改 `submittedAt`，用既有的 `emitProjectPatchEvents` 发「提交时间」变更的系统消息，并追加记录。不动招投标状态，不发阶段通知，不建任务。

- 否决：把这两种情形也塞进 `advanceProjectStage`。它们不是阶段变化；塞进去要给那个共享函数加两条「同阶段也写」的分支，改坏它的风险落在所有阶段推进上。
- 否决：不支持更正时间。人会填错日期，而阶段不能回退。

### D3 记录存成只追加的审计行，读最新一条

每次记录写一条 `AuditLog`：`action = "tender.submission.record"`，`targetType = "project"`，`afterData = { v: 1, submittedAt, channel, receiptRef, note, kind }`（`kind` = 第一次 / 更正 / 补记）。读取按项目与组织取最新一条，并数出总条数。更正与补记时，这一行与改日期在同一个事务里；第一次记录时阶段推进有自己的事务，这一行紧随其后写——万一写失败，项目已是已提交而没有回执，页面显示「已提交，还没有回执记录」，可以再补。

- 否决：存进 `BidIntelligenceRoom.summaryJson`。那一块会被既有接口整块返回、也有别的写入方整块回写；而且覆盖式的存法留不下更正的历史。
- 否决：存进讨论区系统消息的 `metadata`。消息可以被清理，读取要扫消息表。
- 否决：新建一张表。零 schema。

### D4 不做回执文件

回执只记编号。上传文件留到文件有了类别之后。

- 否决：用现有上传接口传回执。它把任何文件当招标文件：触发分析、计入文件包、标记已生成的文档过期、通知成员。

### D5 备注与回执编号不许带金额

备注、回执编号里出现金额（复用「下一步」已有的金额识别）时拒绝保存。这些文字会显示给所有能看项目的人，也进审计。

- 否决：保存时把金额悄悄替换掉。人以为记下了，其实没有。

### D6 独立的开关

`TENDER_SUBMISSION_RECORD_ENABLED` + `TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST`，默认关。「下一步」卡片只在这个开关也开着时才指到提交记录。

- 否决：挂在 `TENDER_WEB_NEXT_STEP_ENABLED` 下。那个开关管只读的显示；这个会写项目。

### D7 保存前再确认一次

第一次记录不可撤销（阶段不能回退），页面在保存前弹出确认，写明「会把项目标为已提交，成员会收到通知，之后只能更正时间与回执，不能撤销」。更正时的确认只说会改提交时间。

- 否决：不确认。点错项目的代价是一个撤不回的状态。

## 与八条硬纪律的关系

1. **零 schema**：遵守。记录存既有的审计表；只写既有的 `submittedAt`、`tenderStatus`。
2. **出站先审批**：没有新增出站。第一次记录沿用阶段推进既有的 BidToGo 状态回调（项目有来源系统时），与在对话里推进阶段时相同；它由人在页面上确认后触发。不发邮件，不碰门户。
3. **禁止第三套队列**：遵守。没有后台执行。
4. **脱敏**：记录里没有金额字段；备注与回执编号带金额时拒绝保存。Muse 通道没有新增内容。
5. **不爬登录页**：不涉及。回执编号由人填。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。不调模型。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-submission/__tests__/submission-record.test.ts`（新，纯逻辑）：输入校验（时间、方式、长度、金额）、三种情形的判定（第一次 / 更正 / 补记）、页面用的文字、开关、接线的源码断言。
- `npx tsx src/lib/tender-submission/__tests__/submission-record-db.isolated.test.ts`（新，隔离库，调用真实路由）：规格里的每个场景；阶段推进函数不传新参数时与原来相同（仍建任务、时间是现在）。
- `npx tsx src/lib/tender-next-step/__tests__/web-next-step.test.ts`、`web-next-step-db.isolated.test.ts`（既有，补用例）：截标已过时卡片指向哪里，随开关变化。
- 读到 `stage-transition.ts` 的既有测试重跑；它目前没有任何测试，新测试补上它的默认行为。
- 变异核对；真实浏览器里走一遍（记录、更正、只读成员、开关关闭），截图存 `docs/acceptance/flow-h4a/`。
- 开 PR 前请一个不带结论的独立审查。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate tender-submission-record --strict`。

## Risks / Trade-offs

- **第一次记录不能撤销。** 靠确认框与权限（只有写权限的人）兜着。
- **第一次记录会通知成员、（有来源系统时）回调 BidToGo。** 这是进入提交阶段既有的行为；确认框里写明会通知成员。
- **记录与提交时间不在同一个事务里（仅第一次）。** 见 D3。
- **回执编号是人填的，系统核实不了。** 页面与记录里都不把它说成「已核实」。
- **财务侧会变**：补记了提交时间的已结束项目，在财务的投标结果统计里从「未提交」变成有提交。这是把数据补对，但数字会动。
- **开关关闭时问题照旧。**

## Migration Plan

无数据迁移。回滚 = 关开关；已经写入的提交时间与记录保留。

## Open Questions

- 回执文件怎么传（要先给项目文件加类别，需要 schema）。
- 提交记录要不要喂给投标工作区的可投标判定。
