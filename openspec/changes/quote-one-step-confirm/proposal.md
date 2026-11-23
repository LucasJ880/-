# Proposal：定报价只点一次（BIDPAGE-6）

TASKFLOW：BIDPAGE-6（Phase F（续）— 标书与报价页改版；任务书 `docs/QINGYAN_BIDPAGE_BID_QUOTE_REDESIGN_TASKBRIEF.md`「BIDPAGE-6」、验收 7、附录 C 决定 D / J、不确定处 5）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

新页面做完报价，要定成我方报价还得进专业模式连点提交、批准、选定三下，而项目里已有另一份我方报价时批准新的这份也不会换过去（`syncTenderBidPointerTx` 只刷新旧的那份）。没有批准权限的人提交以后负责人收不到任何提示，所以要把「定」做成一次点击、把「交给负责人」做成一次点击加一条站内通知。

## What Changes

- 加编辑器主按钮：逐行报价与总价报价的编辑器标题旁边放一个主按钮，代替「提交、批准在专业模式里做」。
  - 有批准权限的人：
    - 草稿和已批准但还没选上的报价，看到「定为我方报价」。
    - 待批准的报价，看到「批准并定为我方报价」和「退回」。
  - 只有编辑权限的人：草稿看到「提交给负责人」，待批准的写「已提交，等负责人批准」。
  - 有没保存的修改、引擎算不出、有计入但没填数的行时，主按钮不可点，并写明原因。
- 让「定为我方报价」点一次完成提交 + 批准 + 选为我方报价，同一个事务：
  - 照旧调用 `syncTenderBidPointerTx`；它没有指向这一份时（项目里已有另一份我方报价，或同时有几份已批准），在同一事务里改选这一份。
  - 点之前弹一次确认，写明「报价合计 X，定了以后内容锁定，要改需另起新版」；要改选时再写明现在的我方报价是哪一版。
  - 每一步迁移照旧各写一条审计和一条台账事件，选定另写一条审计。
  - 请求带读取时的修改时间和确认框里的报价合计；库里不一样就 409，什么都不写。
- 让「提交给负责人」把草稿送到待批准，然后给项目负责人发一条站内通知。
  - 用既有通知类型 `project_update`，不发邮件、不外发（它和其它通知一样计入负责人自己的每日未读汇总邮件）；标题和摘要里没有金额；点开回到这一页的 ②，并打开这份报价。
  - 负责人不是本组织在职成员、关掉了站内通知或这类通知、或通知没写成时，页面照实写明。
- 让「退回」把待批准的报价送回草稿；可以写一句原因，记在审计里。
- 加「我方报价」一行：放在新页面 ② 最上面（任务书「分区标题下的一行」）。
  - 内容是「第 N 版，X 加元，谁、何时定的」，旁边是「另起新版」。
  - 新页面不再挂 `TenderOurBidCard`；改版前的页面照旧挂它。
- 加「另起新版」：把已批准的报价复制成新草稿，要写原因；新草稿在页内打开。
- 改锁定报价的说明：按状态写，已批准的写「要改请点「另起新版」」，已中标的写去专业模式；逐行保存、总价保存的 409 说明跟着变。
- 加四个接口，都在 `/api/projects/{id}/bid-page/quotes/{quoteId}/` 下，守卫级别固定：
  - `POST …/confirm`：批准权限。
  - `POST …/submit`：编辑权限。
  - `POST …/return`：批准权限。
  - `POST …/revise`：编辑权限。
  - 守卫之后都过新页面开关和金额门（与逐行报价同一个 `lineModeGate`）。
  - 只收新页面能在页内打开的逐行与总价报价；专业模式做的报价 409，写明去专业模式。
  - 报价列表接口多带「我方报价」一行要的数。
- 抽出 `transitionQuote` 的迁移前检查与事务内的一步写库：`transitionQuote` 改为调用它们，行为、库写顺序、审计都不变；一步定价用同一段代码，不另写一套迁移。
- 不在新页面放「已中标 / 建项目预算」那一组动作（`award`），它们留在专业模式。

**与任务书的出入**（理由见 design）：

1. 「已批准但没选上」的报价也给「定为我方报价」，只做选定、不迁移（D2）。
2. 现在的我方报价已经中标时，不在这里改选，写明去专业模式（D4）。
3. 确认框里的数：逐行报价写「报价合计」，总价报价写「税前报价」，与两张表各自的叫法一致；系统记的我方报价都是税前报价（D5）。
4. 「谁、何时定的」取这一份最近一次「选为我方报价」或「跟随新版」的审计；审计没写成时退回用批准人和批准时间（D8）。
5. 通知只发项目负责人（决定 D）；负责人是导入用的系统账号或已离开组织时没人收到，页面写明请直接联系有批准权限的人（D7）。
6. 退回不发通知（任务书只要求提交时通知）；退回原因记在审计里（D6）。
7. 另起新版只对已批准的报价开放，要写原因，要编辑权限（与专业模式的修订相同）；它会把已定的我方报价变成「新版待定」（D9，列给 Lucas 确认）。
8. 退回要批准权限（专业模式里编辑权限就能退回）：只给负责人一类的人看「退回」（D6）。
9. 专业模式做的报价不在这里提交、批准、定（D3）。
10. ② 标题右边那句状态不改：版本与金额写在 ② 最上面那一行（D8）。
11. 验收 7 的账号：按决定 C，看得到 ② 的人要有财务查看权；「只有编辑权限」的账号用项目操作员加组织范围的财务查看权。没有财务查看权的人在新页面 ② 只看到一句说明，也没有提交按钮（BIDPAGE-3 报告 §6 第 1 条「没有财务查看权的人要不要看报价合计」本 change 不改，仍待 Lucas 定）。

## Out of scope

- 不改 `QUOTE_TRANSITIONS`、`FROZEN_STATUSES`、`syncTenderBidPointerTx` / `selectQuoteAsTenderBid` / `resolveTenderBid` 的行为、既有 `status` / `select-bid` / `revise` / `tender-bid` 接口、`computeQuote`、`QUOTE_ENGINE_CALC_VERSION`。
- 不改 `TenderOurBidCard`（改版前的页面与工作台照旧用它）；它的中文化留给 BIDPAGE-8。
- 不碰 CHAIN-2e（#556）在改的源码与测试文件（以 `git diff --name-only origin/main...origin/claude/inspiring-johnson-o54xbt-chain-2e` 为准，例如 `quote-engine/access.ts`、`tender-our-bid.tsx`、`bid-page-summary/route.ts`、`next-step.test.ts`）；与它共同改动的只有两个注册脚本的追加行（见 design「与在途轨道」）。
- 不改「下一步」与三个分区的状态句（`next-step.ts`）。
- 不改另起新版写的审计（`reviseQuote` 的 `sourceCost` / `sourceMargin` 由 FIX-26 去掉）。
- 不新增通知类型（新增会让通知设置页多一项，开关关着时也看得到）。
- 不做审批意见往返、多级审批、退回时通知提交人、待批准期间锁定内容（待批准不在冻结集里，照旧能改；批准时按修改时间核对）。
- AI 毛利建议（BIDPAGE-5）、第 ① 步（BIDPAGE-2）、第 ③ 步（BIDPAGE-7）、专业模式中文化（BIDPAGE-8）。
- 不改环境变量、不打开开关、不查生产库。不确定处 5 的只读查询写在 `docs/acceptance/bidpage-6/prod-check.sql`，留给 Lucas / Evan 跑。

## Capabilities

### New Capabilities

- `tender/quote-one-step-confirm`：新页面里定报价的对外行为：
  - 主按钮按权限与状态的显示；
  - 一次定价（提交 + 批准 + 选定同一事务、改选、审计与台账）；
  - 确认框；
  - 防并发与内容核对；
  - 提交给负责人与站内通知；
  - 批准 / 退回；
  - 我方报价一行与另起新版；
  - 四个接口的守卫、门与状态码；
  - 开关关着时零变化。

### Modified Capabilities

- `tender/quote-line-mode`：
  - 「专业模式入口」不再写「提交、批准在专业模式里做」；
  - 「按招标方价格表导出」不可用的原因改说在这一页定；
  - 冻结提示改说「另起新版」。
- `tender/bid-page`：
  - 带金额的区块里「我方报价卡」换成「我方报价一行」；
  - `#bid-quote-<报价 id>` 落在 ②；
  - 新页面上的操作改了汇总时刷新汇总。
- `notifications/click-targets`：加对象类型 `bid_quote` 的跳转地址。

## Impact

- **新增**
  - `src/lib/bid-page-v2/quote-confirm/`（契约与中文、服务）；
  - 四个处理函数（`confirm` / `submit` / `return` / `revise`）；
  - `src/components/bid-page-v2/quote-actions.tsx`（主按钮、确认框、我方报价一行）；
  - 测试三份（纯逻辑与源码断言、渲染、隔离库端到端），在 `scripts/test-all.sh` / `scripts/test-ci-unit.sh` 注册；
  - `docs/acceptance/bidpage-6/prod-check.sql`（只读）。
- **修改**
  - `src/lib/quote-engine/service.ts`：抽出 `assertQuoteTransitionAllowed`、`applyQuoteTransitionTx`、`transitionAuditAction`，`transitionQuote` 调用它们。
  - 两份源码断言测试改成断言抽出后的结构：`quote-ops-contract.test.ts` B2-S4、`b3-ledger-producer.test.ts` 事务内位置。被断言的性质不变：同一事务、迁移前读修改时间、先改状态再写台账、同步失败回滚。
  - `src/lib/notifications/href.ts`：加一个对象类型 `bid_quote` → `/projects/{id}?tab=bid#bid-quote-{报价 id}`，只有新页面发的通知用它。
  - `src/lib/bid-page-v2/quote-line/`：列表带我方报价一行、导出原因、冻结提示。
  - `src/components/bid-page-v2/`：
    - `bid-page-v2.tsx`：不挂我方报价卡、传刷新回调；
    - `bid-tab-entry.tsx`：给刷新回调；
    - `entry-mode.ts`：`#bid-quote-…` 落在 ②；
    - `quote-step.tsx` / `lump-sum-editor.tsx`：主按钮代替专业模式链接、冻结提示、按地址打开报价。
  - BIDPAGE-1 / 3 的测试按 tasks 列出的几条改：我方报价卡换成一行、入口多传一个刷新回调。
- **开关关着时**：
  - 旧页面、旧接口、专业模式的行为不变；
  - `transitionQuote` 的库写与审计逐条相同（真库测试对照）；
  - 四个新接口在守卫之后 404，不读请求体、不碰库。
- 零 schema；无新增模型调用、出站、队列 / 定时任务。
