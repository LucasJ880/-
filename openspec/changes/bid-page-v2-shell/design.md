# Design：「标书与报价」页改版骨架（BIDPAGE-1）

## Context

- 项目详情页 `src/app/(main)/projects/[id]/page.tsx` 整页是客户端组件，第 731 行（#539 合并后会下移约 3 行）`activeTab === "bid"` 时渲染 `BidTab`（`src/components/project-detail/tabs/bid-tab.tsx`，73 行，九块从上往下堆）。服务端环境变量在客户端读不到，既有开关一律是「组件先按关的样子渲染，接口说开才换」（`BidQuoteArea` 读 `/quote-engine` 的 `enabled`，`BidWorkspacePanel` 接口 404 就不渲染）。
- 在途的其它轨道：#544（RFQ-PDF-1）改 `bid-tab.tsx`（删简报面板）与 `project-generate-menu.tsx`；#539（CHAIN-2c）改 `page.tsx` 第 142 / 320 / 343 / 710 行附近。都没合并。
- 项目页已有「下一步」卡（FLOW-H1，`src/lib/tender-next-step/`，开关 `TENDER_WEB_NEXT_STEP_ENABLED`）：取数 `loadWebNextStepInput` 已经定了「当前这份分析」「当前这一轮询价」；判断表复用 Muse 的 `decideNextStep`；跳转到页内位置 `rfq-section`、`bid-quote-area`、`bid-workspace`（`targets.ts` 的 `NEXT_STEP_ANCHORS`），跳法是改地址里的 `#位置`、每 200 毫秒找一次元素，找到后 1.6 秒内离顶部超过 96 像素才重滚（`scrollToProjectAnchor`）。
- 报价引擎权限 `requireQuoteAccess`（`src/lib/quote-engine/access.ts`）：`canViewInternal` = 项目角色带 `project:cost:read`（项目只读 / 测试 / 操作员角色都带，`src/lib/rbac/permissions.ts` 第 153、182、193 行附近）或特权。财务查看权 `resolveFinancePrivilege(...).canReadAll`（`src/lib/project-finance/access.ts`）只给超级管理员、`ORG` 范围持 `project.finance.manage` / `read` 的人、项目负责人。
- 旧页面上带金额的既有组件对任何有项目读权限的人都显示金额：`TenderOurBidCard`（`/quote-engine/tender-bid` 用 `requireQuoteAccess(...,"read")`，`summarize()` 不隐藏售价）、询价区里的供应商报价（`/inquiries` 只要项目读权限，`inquiry-detail.tsx` 显示单价 / 总价）、`BidQuoteArea`（列表售价给所有人，专业模式的成本给 `canViewInternal`）。`TenderSourcingEntry`、`ProjectSupplierLinks` 不显示金额。
- 生成文件列表 `GET …/generate-pdf` 要项目写权限，`ProjectGenerateMenu` 在 `canManage` 为假时不渲染；乱码时代旧件由 `isLegacyGarbledGeneratedDoc` 去掉。

## Goals / Non-Goals

**Goals：**
- 开关关着时页签渲染的就是改版前的页面组件，并能用测试证明（任务书「合并授权」的前提）。
- 新页面的骨架、「下一步」与汇总接口一次到位，后面七个 change 只往分区里换内容。
- 金额可见范围按任务书附录 C 决定 C 收紧：汇总接口与新页面都不给看不到金额的人金额。

**Non-Goals：**
- 不改 `src/components/project-detail/tabs/bid-tab.tsx`、`src/components/quote-engine/*.tsx`、`src/components/inquiry/*.tsx`、`src/components/bid-workflow/*.tsx`、`src/components/supplier-intel/tender-sourcing-entry.tsx`、`src/components/project-generate/project-generate-menu.tsx`、`src/components/tender/bid-workspace-panel.tsx`、`src/components/project-detail/version-history-drawer.tsx`。
- 不改 `src/lib/tender-next-step/**`（只调用其导出函数）、`src/lib/muse-bridge/**`、`src/lib/quote-engine/**`、`src/lib/project-finance/access.ts`、`src/app/api/projects/[id]/next-step/route.ts`，也不改任何既有接口。
- 不改 `page.tsx` 除 import 与 `BidTab` 那一行之外的任何一行。
- 不处理已结束 / 已提交 / 已中标的项目（任务书七条没有；FLOW-H1 那张卡照旧管这些）。

## Decisions

### D1：入口放在项目页、`bid-tab.tsx` 一个字不动（附录 C 决定 B）；不在浏览器里记「开过」

`page.tsx` 只把 `import { BidTab } …` 换成 `import { BidTabEntry } from "@/components/bid-page-v2/bid-tab-entry"`，`<BidTab …/>` 换成 `<BidTabEntry …/>`，属性完全相同。`BidTabEntry` 没有 `view` 时就是 `return <BidTab {...props} />`（同一组件、同样的属性、不加包裹、不加 key，停在旧页面时不会重新挂载）；挂载后请求汇总接口，响应解析出「已开启」才有 `view`、换成新页面；404 / 500 / 401 / 网络失败 / 字段不对 → 回到没有 `view`。不用 `apiJson`（它 401 时跳登录）。

- 备选 A：在 `bid-tab.tsx` 里分流。否决：#544 正在改这个文件（附录 C 决定 B）。
- 备选 B：把开关结果放进项目接口 `GET /api/projects/{id}`。否决：改了一个旧接口的响应；还要改 `page.tsx` 的取数代码（#539 正在改那一段）。
- 备选 C：等接口回来之前什么都不渲染。否决：开关关时页面先空白一下。
- 备选 D（开工前审查前的做法）：接口说「已开启」后在 `sessionStorage` 记一个键，同一标签页再打开时先渲染新页面、不闪旧页面。否决：开关开过再关（任务书验收第 9 条）时，这个键会让第一次渲染变成新页面，「开关关 = 零变化」不成立；用构建号作废旧键要依赖部署平台的变量，不可靠。代价：开关开着时每次进页签先看到一下旧页面再换成新页面。

不在测试里比文件哈希：#544 合并后会改 `bid-tab.tsx`，哈希断言会让 main 上的测试失败、连累别的轨道。「本 change 没改 `bid-tab.tsx`」由 PR 的 `git diff` 与审查核对。

### D2：新建汇总接口，不并入 FLOW-H1 的 `next-step` 接口；总闸先于鉴权

`GET /api/projects/{id}/bid-page-summary`：总闸 `TENDER_BID_PAGE_V2_ENABLED` 关 → 直接 404（不鉴权、不读库）→ `requireProjectReadAccess` → 项目有组织、是招投标项目、组织在白名单，否则 404（在读询价 / 报价 / 审批 / 生成文件之前）→ 取数 → 纯函数出结论。

- 备选：在 FLOW-H1 的 `next-step` 响应里加字段。否决：那个接口受另一个开关管，改它的响应就是改旧接口。
- 备选：先鉴权再判开关（与 FLOW-H1 一样）。否决：开关关着时每次进页签都要白跑 4 次以上鉴权查询；总闸关着时 404 不泄露任何项目信息。

### D3：「下一步」是一张单独的页内查表；事实复用 FLOW-H1 的取数

纯函数 `decideBidPageNextStep(facts)`（`src/lib/bid-page-v2/next-step.ts`），表与去处见规格。事实来源：

| 事实 | 取法 |
|---|---|
| 招标要求是否已批准 | `loadWebNextStepInput(...).analysisStatus === "APPROVED"`（「当前这份分析」与 FLOW-H1 同一条取法；询价入口取的是「最新一份可用分析」，重新分析期间两者可能不是同一份） |
| 当前这一轮询价、还在等的最早发出时间 | 同上的 `latestRound`（状态为「已发出」的明细） |
| 已询价 / 已回 / 已报价 / 回复了没报价 | 所有没取消轮次里的明细（只取状态与供应商 id），按供应商去重 |
| 供应商数 | 本项目 `ProjectSupplierLink`（角色不是「未入选」）与没取消轮次里询价明细的供应商 id 去重 |
| 待批询价卡 | 本项目 `tender.send_rfq`、待批、未过期的审批张数（不按看的人过滤，只出张数，不出标题） |
| 报价 | `quoteType ≠ CUSTOM` 的引擎报价里最新一份草稿 / 待批准；`resolveTenderBid` 的状态、版本、售价与币种（看得到金额时），状态为 NONE 时它的可选报价份数 |
| 生成文件 | 有项目写权限时，`ProjectGeneratedDocument` 去掉乱码旧件后的文件种类数 |

**与任务书的出入**（任务书原表：招标要求 → 没有供应商 → 没发询价 → 没回复 → 开始做报价 → 有草稿 → 已定）：

1. **「已定」「有未定的报价」挪到找供应商之前**：照原顺序，不走询价、直接按自己成本定价的项目（Sunny 供应商库基本为空，拍板结果 9）永远停在「添加供应商或起草询价」，第 6、7 条到不了。「已定」在「有草稿」之前：另起新版时旧版变成「已被新版替代」，走的是「有新版待定」，不会被「已定」盖住；已定之后又开了一份草稿，下一步仍是出文件。
2. **招标要求那条只在「还没往下走」时命中**：已经发了询价或有引擎报价的项目（老项目、手工定价、正在重新分析），横条按实际进度走，另顺带一句「招标要求还没批准」（与 FLOW-H1「跟着实际的进度走」同理）。
3. **「有未定的报价」包括「已批准但没选为我方报价」**：自动选中只在恰好一份已批准时发生；两份以上已批准、或选中的那份作废时没有我方报价，但事情卡在「选哪份」，不在找供应商。
4. **「开始做报价」只认「有人报价」**：任务书原文是「有供应商报价」。回复了没报价、还有人在等 → 仍是「等供应商回复」（原因写「N 家回复了，报价还没录入」）；没人在等 → 「把供应商的报价记下来」（新增一句，去 ①）；问过的都拒绝或没响应 → 「开始做报价」（原因写「问过的 N 家都没报价，也可以再问几家」）。
5. **有待批询价卡、还没发出时说「询价已起草，等批准后发出」**：已经起草了，再说「起草询价」不对。

- 备选：直接用 Muse 的 `decideNextStep`。否决：那是整个项目的下一步（待批的任何卡、截标提醒、关键事实、强制要求……），与任务书给的页内规则不是一回事；项目级的那张卡照旧由 FLOW-H1 显示。
- 备选：保留任务书原顺序，只给找供应商那几条加「且还没有引擎报价」。否决：与第 1 条重排在逻辑上等价，但每条都要带同一个限定，读起来更乱。
- 备选：自己写一套取数。否决：「当前这份分析」「当前这一轮」的规则已经有人定过、测过，另写一份迟早不一致。

### D4：金额给谁（附录 C 决定 C）——汇总接口

`canViewAmounts = canViewBidAmounts({ quoteAvailable, canViewInternal, financeCanReadAll })`：报价功能开通（`requireQuoteAccess(request, id, "read")` 不是 404）、`canViewInternal` 为真、`resolveFinancePrivilege(user, orgId, ownerId).canReadAll` 为真，三者都满足。纯函数进 CI 的纯逻辑测试；隔离库测试覆盖负责人、持 `ORG` 范围 `project.finance.read` 的成员（看得到），项目只读成员、操作员、组织管理员（看不到）。

响应里的金额只出现在两处：`view.quote.amount`（`{ value, currency }`）与第 ② 步状态文字；看不到金额时两处都没有，`view.viewer.canViewAmounts = false`。`resolveTenderBid` 的结果不透传（`reason`、`mirror.ourBidPrice`、`candidates[].sellingPrice` 都不进响应），只取状态、版本、售价、币种与可选报价份数。

- 备选：照任务书原文只看 `project:cost:read`。否决：项目只读 / 测试 / 操作员角色都有它，等于几乎人人可见，和 CHAIN-2e 的拍板冲突。
- 备选：在 `access.ts` 里改判定。否决：那是 CHAIN-2e 的范围；本 change 只在新接口里多加一道。

金额写法：两位小数、千分位，币种 CAD → 加元、USD → 美元、CNY → 人民币、EUR → 欧元、GBP → 英镑，其余原样写币种代码（附录 A 允许保留币种代码）。

### D5：三个分区挂既有组件；带金额的只给看得到金额的人；收起用 `hidden`

| 分区 | 看得到金额 | 看不到金额 | 由哪个 change 替换 |
|---|---|---|---|
| ① 找供应商、询价 | `TenderSourcingEntry`、`ProjectInquirySection`、`ProjectSupplierLinks` | `TenderSourcingEntry`、一句说明、`ProjectSupplierLinks` | BIDPAGE-2（新表格的「报价」列只给有成本权限的人） |
| ② 定报价 | `BidWorkspacePanel`、`TenderOurBidCard`、`<div id="bid-quote-area">` 包着的 `BidQuoteArea` | `<div id="bid-quote-area">` 包着的一句说明 | BIDPAGE-3 / 4 / 6（专业模式本身的口子留给 CHAIN-2e） |
| ③ 出文件 | `ProjectGenerateMenu` | 同左（不显示金额；没有编辑权限时它本来就不渲染） | BIDPAGE-7 |

**与任务书的出入（决定 C 在本 change 的落点）**：看不到金额的人在新页面的 ① 里暂时不能起草询价、在 ② 里不能做报价——带金额的旧组件整块不挂（不能只遮金额：那要改旧组件）。这与 CHAIN-2e 的拍板方向一致（不是负责人的投标同事不能新建、编辑、批准报价），开关在八个都合并前不打开；BIDPAGE-2 / 3 / 4 / 6 换上按金额门做的新区块后恢复。两句说明写清为什么看不到、找谁。

收起的分区仍挂在页面上，只加 `hidden`：组件取数照常；页内位置的元素一直在（`bid-quote-area` 两种人都有；`rfq-section` 只在看得到金额时有——看不到金额的人从项目页卡片跳到「问供应商要价」会落在 ① 的说明上）。打开时展开哪个：地址里的 `#位置` 落在某个分区 → 它；否则「下一步」指向的那个（指向招标要求时是 ①）。挂载时与 `hashchange` 时按 `#位置` 展开分区，并在 60 毫秒后自己 `scrollIntoView` 一次（项目页的重滚只有 1.6 秒的时间窗，汇总接口慢时会错过）。汇总刷新后「下一步」换了指向：人没自己开合过、地址里也没有 `#位置` 时跟着展开。

- 备选：收起时不渲染。否决：收起分区里的位置元素不存在，项目页卡片跳不过去；各组件的取数时机也变了。
- 备选：看不到金额的人照样挂旧组件，留给后面的 change 收口。否决：开工前审查指出这与任务书合并条件 ③（页面与接口都拿不到成本、毛利、供应商报价）正面冲突，按更保守的一方处理。

「下一步」按钮：指向分区 → 展开该分区并 `scrollIntoView`；指向招标要求 → `window.history.replaceState` 只把地址里的 `?tab=` 换成 `requirements`（保留其它参数，去掉动态深链与 `#位置`；Next 的路由会同步原生 `replaceState`，项目页本来就跟着 `?tab=` 切页签）。不用 `useRouter`：服务端渲染测试里没有路由环境。

**运行信息**：任务书 BIDPAGE-1 第 3 条「管理员才关心的运行信息在新页面不显示」——新页面自己不写任何运行信息；② 里旧的专业模式（`PricingControlCenter`）还会显示一句「快照与实时计算不一致（calcVersion 或数值漂移）」。由 BIDPAGE-3 收口（它把专业模式挪到「更多 → 专业模式」，② 的主区换成新做法）。

### D6：「更多」菜单

右上角一个「更多」按钮，点开是只有「版本历史」一项的小菜单，点了打开既有 `VersionHistoryDrawer`（同一组件、同样的属性）。菜单点外面或按 Esc 收起。

- 备选：「版本历史」做成顶部一个小图标按钮。否决：任务书要求移到「更多」里；后面 BIDPAGE-3 的「专业模式」、判断点 4 的「旧版报价单」也要放进同一个「更多」，先有菜单再往里加。

## 与八条硬纪律的关系

1. 零 schema：只读既有表（`TenderAnalysisRun`、`ProjectInquiry` / `InquiryItem`、`ProjectSupplierLink`、`PendingAction`、`ProjectQuote`、`ProjectGeneratedDocument`、授权表）；不改 `prisma/`。
2. 出站先审批：不涉及——接口只读，按钮只导航；询价仍从既有入口起草成待批卡。
3. 禁止第三套队列：不涉及——汇总是请求时现算，没有定时任务、没有缓存表。
4. 脱敏：触碰。金额只给有成本与财务查看权的人（D4），对任何人不出成本、毛利、供应商报价；新页面对看不到金额的人不挂带金额的旧组件（D5）；不经 Muse 通道。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。「下一步」是查表（D3），不调模型；本 change 没有新增模型调用。
8. 测试注册：触碰。三份新测试在 `scripts/test-all.sh` 注册并进 `scripts/test-ci-unit.sh`（隔离库那份在 CI 里没有库时跳过），`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/bid-page-v2/__tests__/next-step.test.ts`（进 CI）：查表每条规则、先后顺序、去处对应表、招标要求的「往下走了」、等待天数与回复、分区状态写法、金额门、看不到金额时文字里没有金额、结果里没有成本类字段、金额写法、开关解析、汇总接口里总闸先于鉴权的顺序。
- `npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx`（进 CI）：开关关时入口第一次渲染与 `BidTab` 逐字节相同；入口旧分支原样渲染 `<BidTab {...props} />`、不在浏览器里记标记；`page.tsx` 的页签渲染入口、属性不变；入口分流判定（404 / 500 / 401 / 失败 / 字段不对 → 旧页面）；新页面三个分区、状态、只展开一个、`#位置` 优先、「更多」里有版本历史、没有简报面板、看不到金额的人看不到带金额的旧组件、位置元素在；按钮处理只改展开状态 / 滚动 / 页签地址。
- `NODE_ENV=test npx tsx src/lib/bid-page-v2/__tests__/bid-page-summary-db.isolated.test.ts`（隔离库；CI 里跳过，本地跑并写进报告）：开关、白名单、401 / 被拒 / 非招投标 404、总闸关时没登录也 404；规则在真实数据上各走一遍；五种身份的金额可见范围；响应里没有成本与供应商报价；调用前后各表不变。
- `git diff --name-only origin/main`：只允许本 change 新增的文件、`src/app/(main)/projects/[id]/page.tsx`、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`、`.env.example`、`docs/**`、`openspec/changes/bid-page-v2-shell/**`；没有 `bid-tab.tsx`，没有任何既有接口文件。`git diff origin/main -- 'src/app/(main)/projects/[id]/page.tsx'` 只有两行。
- `npm test` 全量、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx -y @fission-ai/openspec@1.15.0 validate bid-page-v2-shell --strict`；`git diff origin/main -- prisma/ vercel.json` 为空。

## Risks / Trade-offs

- [开关关着时每次进页签多一次请求] `GET …/bid-page-summary` 在总闸关时不鉴权、不读库直接 404 → 渲染结果不变；正式打开后不再是 404。
- [开关开着时每次进页签先闪一下旧页面] → D1 备选 D 的取舍；开关只对 Sunny 开。
- [两个「下一步」说法不同] 项目页 FLOW-H1 卡管整个项目、新页面的横条管这一页，同一时刻可能一个说「有 1 条等你批」、一个说「起草询价」→ 两者事实同源（D3），说的是不同范围；不合并。
- [看不到金额的人在新页面上暂时做不了询价与报价] → D5 的取舍；开关在八个都合并前不打开，BIDPAGE-2 / 3 / 4 / 6 恢复。
- [`page.tsx` 与 #539 同改一个文件] 改动处相距十几行，后合并的一方变基即可；本 PR 合并前 `git fetch` 再核对。
- [新页面里旧组件的英文与运行信息] 分区里暂时还是旧组件，旧文案（含专业模式的漂移提示）在 BIDPAGE-3 / 8 之前仍会出现在新页面上 → 开关在八个 change 都合并前不打开；运行信息由 BIDPAGE-3 收口。

## Migration Plan

- 合并后开关默认关，生产行为不变（每次进页签多一次直接 404 的请求）。
- 回退：回退本 PR 即可（只有新文件、`page.tsx` 两处、两个测试脚本的注册行、`.env.example` 的说明）；或开关保持关。
- 上线（八个 change 都合并后，由 Evan / Lucas 操作）：预发设 `TENDER_BID_PAGE_V2_ENABLED=1`、`TENDER_BID_PAGE_V2_ORG_ALLOWLIST=<Sunny 组织 id>`，验收通过后生产设同样两项并重新部署。
