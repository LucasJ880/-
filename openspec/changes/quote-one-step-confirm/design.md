# Design：定报价只点一次（BIDPAGE-6）

## Context

- 动机见 proposal「Why」；行为契约见 `specs/tender/quote-one-step-confirm/spec.md`、`specs/tender/quote-line-mode/spec.md`、`specs/tender/bid-page/spec.md`。
- 状态机（`src/lib/quote-engine/contract.ts`，不改）：
  - draft → review / cancelled；review → approved / draft / cancelled；approved → superseded / awarded / cancelled。
  - draft 不能直接到 approved，所以一次点击要连走两步。
  - 冻结集是 approved / superseded / awarded / cancelled；**review 不冻结**，专业模式与新页面在待批准时都还能改内容。
- `transitionQuote`（`src/lib/quote-engine/service.ts`）：
  - 事务外：`getQuote`、合法性检查、送审 / 批准前的门（计算有效、没有 `LINE_UNPRICED`、长期供货协议分级无错）。
  - 事务内：读迁移前 `updatedAt` → 更新状态与时间戳 → `appendQuoteLedgerEventTx`（eventKey = 目标状态 + 迁移前 `updatedAt`）→ 批准等四种目标状态时 `syncTenderBidPointerTx`。
  - 提交后写审计（best-effort）：review → `quote_submitted_for_review`，approved → `quote_approved`，review → draft → `quote_updated`。
  - 事务外读状态、事务里不锁报价行，两人同时点会各自通过检查。
  - 它自己开事务，不能嵌进外层事务。
  - 源码断言 `quote-ops-contract.test.ts` B2-S4 与 `b3-ledger-producer.test.ts` 截取它的正文找固定字符串。
- `syncTenderBidPointerTx`（`tender-bid.ts`，不改），先锁项目行：
  - 没有指针：恰有 1 份非 CUSTOM 的已批准 / 已中标 → 自动选中（审计 `quote_selected_as_tender_bid`，auto:true）；否则什么都不做。
  - 指针指向已批准 / 已中标 → 只刷新那一份的镜像，**不会改选新批准的这份**。
  - 指针指向 superseded → 跟随同谱系最新的已批准版本（审计 `tender_bid_pointer_synced`）；跟不到 → 新版待定。
- `selectQuoteAsTenderBid` 自己开事务：锁项目行 → 写指针与镜像（`writeBidMirrorsTx`）→ 提交后审计。旧的我方报价状态不动，仍是候选。
- 新页面已有的东西：
  - `lineModeGate`：开关 + 招投标项目 → 404；内部成本 ∧ 财务查看权 → 403；返回 `caps:{canEdit, canApprove}`。
  - 逐行 / 总价视图带 `quote.updatedAt`、`frozen`、`capabilities`、引擎结果与警告。
  - 列表已调 `resolveTenderBid` 算 `isOurBid`。
  - `project-routes-guard.test.ts` 要求新路由第一步是守卫，且不许新增「守卫前预处理」：守卫级别不能看请求体。
- 通知：
  - `deliverCollabNotification`：过滤收件人（必须是本组织在职成员、排除操作人）→ 偏好门（`shouldDeliverInApp`）→ 去重键 → 写，整体不抛错，返回 created / existing / gated / failed。
  - `project_update` 是已登记类型。
  - `href.ts` 按对象类型拼地址，不认识的类型落到项目页。
- 审计表 `AuditLog` 有 `projectId`、`userId`、`action`、`targetId`、`createdAt`；报价表有 `approvedById`（不是关联字段）、`approvedAt`。

## Goals / Non-Goals

**Goals：**
- 有批准权限的人在新页面点一次（加一次确认），报价就是已批准、并且是我方报价。
- 不管项目里原来有没有我方报价，结果一样。
- 迁移、台账、指针同步只用 `transitionQuote` 那一套代码。
- 失败时什么都不留：不会停在待批准，也不会已批准但没选上。
- 被批准的就是确认框里看到的那一份。
- 没有批准权限的人提交后，负责人在站内收到一条不含金额的通知。

**Non-Goals（具体到文件）：**
- 不改：
  - `src/lib/quote-engine/contract.ts`（状态机、冻结集）、`tender-bid.ts`、`calc.ts`、`templates.ts`、`access.ts`；
  - `src/app/api/projects/[id]/quote-engine/**`（`status`、`select-bid`、`revise`、`tender-bid`、`award` 照旧）；
  - `src/components/quote-engine/**`（含 `tender-our-bid.tsx`、`pricing-control-center.tsx`）；
  - `src/components/project-detail/tabs/bid-tab.tsx`、`workbench-tab.tsx`。
- 不改 `src/lib/project-finance/access.ts`、`src/app/api/projects/[id]/bid-page-summary/route.ts`、`src/lib/bid-page-v2/__tests__/next-step.test.ts`（CHAIN-2e 在改）；不改 `src/lib/bid-page-v2/next-step.ts`、`service.ts`（「下一步」与三句状态照旧）。
- `src/lib/quote-engine/service.ts` 只抽出 `transitionQuote` 的两段，不改 `reviseQuote`（FIX-26 计划改它的审计）、`awardQuoteToBudget`、`updateEngineQuote`。
- 不改 `src/lib/notifications/constants.ts`、`type-visibility.ts`、`delivery-gate.ts`、`collab/**`（不新增通知类型）。
- 不改 `prisma/`。

## Decisions

### D1：一次定价 = 一个事务，复用 `transitionQuote` 的两段

**抽出（`service.ts`）**：
- `assertQuoteTransitionAllowed(q, from, to)`：合法性与送审 / 批准前的门。
- `applyQuoteTransitionTx(tx, { q, from, to, now, … })`：读迁移前 `updatedAt` → 更新 → 台账。
- `transitionAuditAction(to)`：迁移审计用的 action。

`transitionQuote` 调用它们，库写的语句与顺序、错误码、审计不变。

**一次定价（`src/lib/bid-page-v2/quote-confirm/service.ts`）的步骤**：
1. 事务外：
   - 读报价，判可定。
   - 核对 `baseUpdatedAt`。
   - 按「从哪个状态出发」排出步骤：draft → [review, approved]；review → [approved]；approved → []。
   - 逐步过 `assertQuoteTransitionAllowed`。
2. 事务内（超时 15 秒）：
   - `SELECT … FOR UPDATE` 锁报价行，**紧接着**锁项目行（`lockProject`，FOR UPDATE），读出操作前的我方报价指针；三种出发状态都这样走。
   - 重读整份报价，复核状态与 `updatedAt`。
   - 用重读的这份重算，复核门与「报价合计 = 确认框里的数」（差 > 0.005 → 409）。
   - 逐步 `applyQuoteTransitionTx`；有一步走到已批准时，调用 `syncTenderBidPointerTx`。
   - 看指针：
     - 不是这一份 → 先看现在的我方报价（已中标 → 409，整笔回滚，见 D4），否则用 `writeBidMirrorsTx` 改选这一份。
     - 是这一份、但不是本次同步自动选中的（跟随新版）→ 只补一条选定审计。
3. 提交后按顺序写审计：
   - 每一步的迁移审计：与 `transitionQuote` 同 action、同键，加 `via: "bid_page"`。
   - 同步结果审计（`auditSyncResult`，trigger `bid_page_confirm`）：只在同步的结果就是这一份时写（自动选中、跟随新版）；改选时同步的中间结果（清空、跟随到别的报价、刷新旧的）随即被覆盖，不写。
   - 选定审计：与手动选定同 action，「之前」写操作前的指针；自动选中时同步已经写过一条，不再写。

**结果**：草稿一次定价后，审计里恰好各有一条提交、批准、选定（验收 7）。

**锁的顺序**：先报价行，马上项目行（FOR UPDATE）。
- 台账写入会对项目行取共享锁（`appendProjectEvent` 的 FOR KEY SHARE），同步再取排他锁。两份报价同时一次定价时，若各自先拿共享锁再争排他锁就互锁（开工前审查指出；实测：去掉提前锁项目行，4 组并发里每次都有一组返回 500）。先拿排他锁，后一个在项目行上等，前一个提交后再走。
- 新页面的四个接口之间不会互锁。与既有的修订（谱系根报价行 → 插入新版取项目共享锁 → 改原版 → 项目排他锁）、中标交错时，极少数情况下仍可能被数据库判为互锁：回滚一方、返回 500，再点一次即可。

**同步与改选的失败**：同步失败与改选写镜像失败都当作 `TenderBidSyncError`，事务整笔回滚，写 `tender_bid_sync_failed` 审计，返回 500 `TENDER_BID_SYNC_FAILED`（中文说明）。

**否决：**
- 连调两次 `transitionQuote` 再调 `selectQuoteAsTenderBid`：三个事务，中途失败会停在待批准，或已批准没选上，人看不出该再点什么。
- 把 `transitionQuote` 的事务体抄一份到新服务：第二套迁移，门、台账键、时间戳以后会走散。
- 改 `syncTenderBidPointerTx`，让它总是选中刚批准的那份：专业模式的批准行为跟着变，开关关着时也变。

### D2：主按钮按状态与权限

| 状态 | 有批准权限 | 只有编辑权限 | 都没有 |
|---|---|---|---|
| 草稿 | 定为我方报价 | 提交给负责人 | 无 |
| 待批准 | 批准并定为我方报价、退回 | 写「已提交，等负责人批准」 | 同左 |
| 已批准、是我方报价 | 写「已定为我方报价」；另起新版要编辑权限 | 同左 | 写「已定为我方报价」 |
| 已批准、不是我方报价 | 定为我方报价（只选定） | 写「已批准，还没定为我方报价」 | 同左 |
| 已中标 / 被新版替代 / 作废 | 只写状态 | 同左 | 同左 |

主按钮在以下情况不可点，并写原因（服务端照样再判）：
- 有修改没保存；
- 引擎算不出；
- 有计入但没填数的行；
- 是总价报价但被判成要去专业模式（读视图已经 409，不会到这里）。

**否决**：已批准没选上的报价不给按钮。这样新页面里没有地方选它，而「下一步」正把人指到 ② 说「已批准 N 份，还没选为我方报价」。

### D3：四个接口，守卫级别固定

`confirm`（approve）、`submit`（edit）、`return`（approve）、`revise`（edit）。每个处理函数：
1. 第一步 `requireQuoteAccess(级别)` 并紧接着检查（FIX-21）。
2. 再 `lineModeGate`（开关关 → 404，不读请求体）。
3. 再解析请求体（zod，格式不对 400）。
4. 再调服务；`QuoteEngineError` 经 `lineModeErrorResponse` 返回。

只处理新页面能在页内打开的逐行与总价报价（`isLineModeQuote` / `isLumpSumQuote`）；专业模式做的报价（含没有做法字段的引擎报价）与 CUSTOM 报价 409，库里不变。理由：CUSTOM 报价不会被同步选中，却能被这里的改选写成指针；专业模式的报价在新页面里打不开，看不到确认框里的数从哪来。

**否决**：一个接口按请求体里的动作选级别。守卫测试冻结了「守卫前预处理」名单；而且守卫级别不再等于动作本身。

### D4：改选

- 同步后指针不是这一份时，同一事务里写指针与镜像（`writeBidMirrorsTx`，与 `selectQuoteAsTenderBid` 同一个函数）。
- 旧的我方报价保持已批准、仍是候选，与专业模式手动选定相同。
- 现在的我方报价已中标时不改选：409「现在的我方报价第 M 版已中标，这里不改选；要改请在专业模式里做」，整笔回滚。

**否决：**
- 把旧的我方报价自动改成被替代或作废：它不在同一谱系，改它的状态不是这次操作要的，也改了台账。
- 已中标时照样改选：中标后换我方报价，会让项目预算与我方报价对不上。专业模式的手动选定照旧允许，只是新页面不做。

### D5：确认框与内容核对

- 确认框写「{报价合计 / 税前报价} X，定了以后内容锁定，要改需另起新版。」
  - 逐行表叫「报价合计」，总价表叫「税前报价」，都是引擎的 `sellingPrice`。
  - 要改选时加一句：「现在的我方报价是第 M 版（Y），定了以后改成这一份。」
- 请求体是 `{ baseUpdatedAt, expectedSellingPrice }`；服务在锁内用重读的这份重算后比对。
- 为什么还要比报价合计：专业模式保存成本行（`updateEngineQuote`）在提交事务之后才写快照、才改报价的 `updatedAt`，中间有一个窄窗口，「修改时间相同」挡不住。

**否决**：确认框写含税总价。系统记的我方报价是税前报价，含税总价只在总价表里另行显示。

### D6：提交与退回

- **提交**：只从草稿出发；锁行复核与 D1 相同；一步 draft → review；提交后写迁移审计，再发通知（D7）。返回通知结果。
- **退回**：只从待批准出发；可带一句原因（去掉控制字符，最多 500 字）；一步 review → draft。审计与 `transitionQuote` 相同（action `quote_updated`，`note` 带原因）。
- 退回要批准权限（专业模式的状态接口编辑权限就能退回）：任务书写的是负责人在同一位置看到「批准并定为我方报价 / 退回」；在新页面上只有批准的人能退回，避免提交的人自己退回、再提交、反复给负责人发通知。
- 退回不发通知（任务书只要求提交时通知负责人）。
- 待批准时内容照旧能改；负责人批准时按 D5 核对修改时间与报价合计。

**否决：**
- 退回时通知提交人：提交人只记在审计里，要多一次查询与一种通知；列为要 Lucas 确认的事。
- 待批准时锁定内容：要改冻结集或保存的判断，专业模式跟着变。

### D7：给负责人的站内通知

- 调用 `deliverCollabNotification`：
  - 类型 `project_update`，对象类型 `bid_quote`，对象 id = 报价 id；
  - 事件区分键 = 这次的 `submittedAt`（同一份报价每次提交各一条，重试不重复）；
  - 收件人 `[project.ownerId]`，操作人 = 提交人，优先级 high。
- 标题与摘要：
  - 标题：「报价等你批准：{项目名}」。
  - 摘要：「{提交人姓名} 提交了「{报价名}」第 N 版，请到「标书与报价」② 批准并定为我方报价，或退回。」
  - 没有金额、成本、供应商。
- `href.ts` 加 `bid_quote` → `/projects/{项目 id}?tab=bid#bid-quote-{报价 id}`。
- 判结果：服务自己先判「你就是负责人」与「负责人是不是这个组织的在职成员、账号在职」（投递入口查收件人出错时也返回空，不能把出错说成不是在职成员）；投递后有新写或已有 → 已通知；被偏好门拦下（站内通知总开关或这类通知关了）→ 关掉了；其余 → 没发出去。
- 邮件：这次操作不发邮件；`project_update` 不在未读升级邮件的类型里（`collab/escalation.ts`），但和其它通知一样计入负责人自己的每日未读汇总邮件（`collab/digest.ts`），属于硬纪律第 2 条的站内补位。
- 页面上写明结果：
  - 已通知负责人 {姓名}；
  - 负责人关掉了站内通知或这类通知；
  - 负责人不是本组织在职成员（例如导入用的系统账号）：没有人收到，请直接联系有批准权限的人；
  - 你就是负责人；
  - 通知没写成。

**否决：**
- 新增通知类型：要改三处登记与两份测试，通知设置页会多一项，开关关着时也看得到。
- `notifyProjectMembers`：发给全体成员，且不过偏好门。
- 直接 `createNotification`：不过偏好门与在职成员过滤。

### D8：我方报价一行

- 数据随报价列表接口返回（已有金额门），金额取 `resolveTenderBid` 用报价引擎现算的税前报价（与「下一步」汇总同一个来源，不用列表行里的快照），`ourBid` 包含：
  - 状态；
  - 报价 id、名称、版本、报价状态；
  - 卖价与币种（列表里引擎算的 `sellingPrice`）；
  - 谁、何时定的；
  - 新版待定时的新版版本与状态；
  - 还没选时的已批准份数。
- 「谁、何时定的」：
  - 取这一份最近一条 `quote_selected_as_tender_bid` / `tender_bid_pointer_synced` 审计（本项目、对象是这一份）的人和时间。
  - 没有 → 用 `approvedById` / `approvedAt`。
  - 都没有 → 只写版本与金额。
  - 姓名取 `User.name`，时间按 `YYYY-MM-DD HH:mm`（多伦多时间）。
- 分区标题右边那句状态（`next-step.ts`）不改：任务书写的是把卡片并入「分区标题下的一行」，版本与金额就在这一行里；改那句状态要动 CHAIN-2e 正在改的 `next-step.test.ts`。
- 新页面不再挂 `TenderOurBidCard`。

**否决：**
- 只用 `approvedById` / `approvedAt`：后来在专业模式手动改选、或跟随新版时，写出来的人和时间是错的。
- 照旧挂卡片再加一行：任务书要求并入，且卡片里有英文、有成本四格。

### D9：另起新版

- 只对已批准的报价，原因必填（1–2000 字，与 `reviseQuote` 的上限相同），要编辑权限（与专业模式的修订接口相同；专业模式里编辑权限本来就能修订，新页面另要财务查看权，不新增放行的人）。
- 它会把已定的我方报价改成「已被新版替代」，我方报价变成「新版待定」、镜像价清空——与专业模式修订相同。要不要改成「原来那份是我方报价时要批准权限」列给 Lucas 确认。
- 另起新版写的审计沿用 `reviseQuote`：`beforeData` 里有原版的估算成本与毛利率（`service.ts` 修订审计）。这是既有写法，FIX-26 的写入侧会去掉这两个键；本 change 不改 `reviseQuote`，规格里「审计不带成本」只对一次定价、提交、退回。
- 调用既有 `reviseQuote`（同步、审计照旧）。
- 返回新草稿的 id、版本、做法；做法与行身份随复制保留，新草稿在页内打开；做法是专业模式的打开专业模式。

**否决：**
- 已中标、被替代的也给：已中标的后续在专业模式（award 流程）；被替代的已有更新的版本。
- 不要原因：专业模式的修订要原因，两边口径一致；改价的理由日后要查。

### D10：刷新与跳转

- `BidPageV2` 收一个可选的 `onRefresh`（入口传它的 `load`）；定、提交、退回、另起新版成功后调用，刷新「下一步」与三句状态。
- `#bid-quote-{id}` 落在 ②；列表加载后，这一份能在页内打开就自动打开。
- **否决**：改汇总接口直接返回我方报价一行。那个文件 CHAIN-2e 在改，而且一行里要的数已经在列表接口里。

### D11：抽出两段后，两条源码断言怎么改（不弱于原来）

`transitionQuote` 抽出两段以后，下面两条在它正文里找固定字符串的断言不可能原样通过，改成断言抽出后的结构：

| 测试 | 原来断言 | 改成 |
|---|---|---|
| `quote-ops-contract.test.ts` B2-S4 | `transitionQuote` 正文里有 `db.$transaction(async (tx) => {`、`await tx.projectQuote.update({ where: { id: q.id }, data });`、`syncTenderBidPointerTx)(tx`、`TENDER_BID_SYNC_FAILED`、`auditSyncFailure(` | 正文里仍有 `db.$transaction(async (tx) => {`、`syncTenderBidPointerTx)(tx`、`TENDER_BID_SYNC_FAILED`、`auditSyncFailure(`；**另加**：正文里有 `await applyQuoteTransitionTx(tx, {`，位置在事务开始之后、指针同步之前；`applyQuoteTransitionTx` 正文里有那条 `update` 字面量、并且不出现 `db.`（只用调用方的 tx） |
| `b3-ledger-producer.test.ts` | 「syncResult = await db.$transaction」之后第一个 `appendQuoteLedgerEventTx(tx` 在 `if (!needsSync)` 之前 | `applyQuoteTransitionTx` 正文里依次是读迁移前 `updatedAt` → `tx.projectQuote.update(` → `appendQuoteLedgerEventTx(tx`，并且不出现 `db.`；`transitionQuote` 事务里 `await applyQuoteTransitionTx(tx` 在 `if (!needsSync)` 之前 |

SPU-3（`input.to === "review" || input.to === "approved"` 的门）照原样通过：抽出的检查函数参数仍叫 `input`。交叉验证要专门核这两条新断言不比旧的弱。

### D12：审计键（对 FIX-26 将来的全仓审计守卫）

- 本 change 写的审计一律写对象字面量，不传变量。
- 像金额的键只有 `sellingPrice`（卖价，在 FIX-26 的「可见」名单里）。不写 `ourBidPrice`，不把 `expectedSellingPrice` 写进审计。
- 其余键：`status`、`note`、`version`、`via`、`bidQuoteId`、`currency`、`roomMirrored`、`auto`、`reason`。

## 与在途轨道

开工前审查（2026-11-23）指出要碰其它轨道在改、还没合并的文件。逐个核过 `git diff --name-only origin/main...<分支>`：

- **CHAIN-2e（#556）**：
  - 本 change 原稿要改 `next-step.test.ts` 的两条断言（它改第 309 行），已撤掉：② 的状态句不改（D8）。
  - `scripts/test-all.sh`、`scripts/test-ci-unit.sh`：只在末尾追加注册行，硬纪律第 8 条要求每份新测试都注册。与 BIDPAGE-1 / 3 / 4、FIX-26a 同样的做法：合 main 冲突时两边的行都保留（交接 §4「注册脚本的同位置追加」）。
- **FIX-26（`claude/zen-turing-azudvx-fix26`）**：
  - 分支上只有四件套，还没有实现代码；它计划改 `service.ts` 的 `reviseQuote` 审计（另起新版的 `logAudit`）。
  - 本 change 只改 `transitionQuote` 与新加的三个函数，不碰 `reviseQuote`，两边改的是不同的函数，合并时不会文本冲突。
  - 它的 GATE ⑥「与 BIDPAGE 交叠时本 change 先合」指的是两边改同一处时的先后；这里不改同一处，谁先合都行。
  - 审计键按 D12 写，不会撞上它的守卫测试。
  - 已把这两点发给协调会话（「青砚招投标线交接」）告知。
- 其余未合并分支都不碰本 change 的文件（全部 `origin/claude/*` 逐一比对）。

## 八条硬纪律

1. **零 schema**：不加表、不加字段、不写 migration；只写既有的 `ProjectQuote` 状态与时间戳、`Project` 指针与镜像、`ProjectEvent` 台账、`AuditLog`、`Notification`（第 1 条点名允许）。
2. **出站先审批**：不涉及。站内通知只写 `Notification`，这次操作不发邮件、不发 Muse、不改价、不锁标；它会和其它通知一样计入负责人自己的每日未读汇总邮件（第 2 条写明的站内补位，发给本组织在职成员本人）。
3. **禁止第三套队列**：不涉及。没有任务、定时器或 worker；通知在请求内同步写。
4. **脱敏**：通知标题与摘要里没有金额、成本、毛利、供应商。四个接口都过金额门。一次定价、提交、退回写的审计键只有状态、版本、说明、我方报价指针、卖价与币种（与既有手动选定相同），没有成本、毛利（D12）；另起新版沿用既有修订审计（D9）。不碰 Muse。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：没有模型调用；「下一步」仍是查表，只改一句状态的写法。
8. **测试注册**：新测试在 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` 注册，`check-test-registry.sh` 通过，历史欠账不增。

## Risks / Trade-offs

- [抽出 `transitionQuote` 两段时改了专业模式的批准] → 语句与顺序逐条保留。
  - 源码断言改成断言抽出后的结构：同一事务、先读修改时间、先改状态再写台账、同步失败回滚。
  - 真库测试把 `transitionQuote` 走一遍草稿 → 待批准 → 已批准 → 另起新版，台账键、审计 action、指针与改动前的期望逐项相同。
  - 改动前后各在隔离库跑一次 `scripts/quote-ops-golden-e2e.ts`：通过 / 失败条目与条数相同（除首行的时间戳、PDF 字节数外逐行相同）。
- [专业模式保存成本行在提交前只检查一次冻结（`assertEditable` 在事务外），改成本行也不锁报价行] → 原有缺口：一笔已过检查的专业模式保存仍可能在重读之后、提交之前或之后写进去。新服务锁行并核对报价合计挡住大部分「批准的不是看到的」，挡不全；写进交接。
- [两人在新页面同时点同一份] → 锁报价行串行化，后一个看到状态已变 → 409「这份报价刚被别人改过或处理过」。
- [新页面与专业模式的状态接口同时批准同一份] → 专业模式的 `transitionQuote` 不锁行、更新不带状态条件：后一个等锁后照样写成功，多一条批准审计与一条批准台账（台账键不同）。原有缺口，不在本 change 改专业模式；写进交接。
- [与修订、中标交错时被数据库判互锁] → 见 D1「锁的顺序」：回滚一方返回 500，再点一次。
- [指针原来指向的那份报价现在算不出] → 同步刷新它时失败，整笔回滚、返回 500，这时没法在新页面改选；与专业模式批准时的行为相同，写进交接。
- [负责人是系统账号或已离职] → 没人收到，页面写明。CHAIN-2e 的 `projectHasAssignedOwner` 不在 main 上，不依赖它。
- [CHAIN-2e 合并后 `canApprove` 要先能看内部成本] → 新接口本来就要求财务查看权，合并后自动跟上。文本冲突只可能在 `next-step.test.ts`：本 change 改第 221 / 250 行附近，它改第 309 行。
- [FIX-26 将来扫描全仓审计键] → 本 change 新写的审计不带成本、毛利类的键；卖价在它的可见名单里。
- [另起新版不是幂等的：两人同时点会出两份草稿] → 与专业模式相同，`reviseQuote` 不改。

## Migration Plan

- 合并即部署，开关默认关。新接口在开关关时 404，旧页面与专业模式不受影响。
- 回退：回退本 PR。
  - 新页面定过的报价，就是普通的已批准、已选定报价，专业模式照常打开。
  - 已发的 `bid_quote` 通知在旧代码下落到项目页。
  - 没有数据迁移。
- 不确定处 5（生产上有没有已批准的报价）：只读查询写在 `docs/acceptance/bidpage-6/prod-check.sql`，留给 Lucas / Evan 跑。回归样本用合成数据覆盖三种情况：0 份、1 份、已有另一份我方报价（决定 J）。

## 验证方式

- 纯逻辑与源码断言：`npx tsx src/lib/bid-page-v2/__tests__/quote-confirm.test.ts`
  - 按钮矩阵、确认框文字、通知文字无金额、结果说明、守卫级别、`transitionQuote` 结构。
- 渲染：`npx tsx src/components/bid-page-v2/__tests__/quote-actions.test.tsx`
- 隔离库：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`
  - 0 / 1 / 另一份已批准 / 两份已批准没选 / 另一份已中标；审计各一条；台账两条；镜像；同一份并发两次；同一项目两份并发（4 组）；修改时间不同；报价合计不同；同步失败与写镜像失败回滚；通知的四种结果；退回；另起新版；专业模式的报价 409；开关关 404 且不读请求体；没有财务查看权 403；没有批准权限 403。
- 回归：
  - `quote-engine-contract`、`quote-ops-contract`、`b3-ledger-producer`（含 isolated）；
  - `quote-line`、`quote-line-db`、`lump-sum`、`lump-sum-db`、`quote-step`、`lump-sum-editor`；
  - `bid-page-v2`、`next-step`、`bid-page-summary-db`、`project-routes-guard`。
- 全量门禁：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate quote-one-step-confirm --strict`。
- 浏览器（本地合成数据，开关开）：
  - 有批准权限的账号点「定为我方报价」一次 → 标题显示版本与金额，审计三条；
  - 没有批准权限的账号只看到「提交给负责人」，负责人收到通知、点开回到这份报价，看到批准 / 退回；
  - 开关关时页签与 main 截图一致。
