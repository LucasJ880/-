# Design：「标书与报价」页改版骨架（BIDPAGE-1）

## Context

- 项目详情页 `src/app/(main)/projects/[id]/page.tsx` 整页是客户端组件，第 731 行（#539 合并后会下移约 3 行）`activeTab === "bid"` 时渲染 `BidTab`（`src/components/project-detail/tabs/bid-tab.tsx`，73 行，九块从上往下堆）。服务端环境变量在客户端读不到，既有开关一律是「组件先按关的样子渲染，接口说开才换」（`BidQuoteArea` 读 `/quote-engine` 的 `enabled`，`BidWorkspacePanel` 接口 404 就不渲染）。
- 在途的其它轨道：#544（RFQ-PDF-1）改 `bid-tab.tsx`（删简报面板）与 `project-generate-menu.tsx`；#539（CHAIN-2c）改 `page.tsx` 第 142 / 320 / 343 / 710 行附近；FIX-21（未开 PR，另一会话 2026-11-22 告知）会加目录守卫：`src/app/api/projects/[id]/` 下每个接口第一步不带条件地调用项目级守卫并紧接着检查结果。
- 项目页已有「下一步」卡（FLOW-H1，`src/lib/tender-next-step/`，开关 `TENDER_WEB_NEXT_STEP_ENABLED`）：取数 `loadWebNextStepInput` 已经定了「当前这份分析」；判断表复用 Muse 的 `decideNextStep`；跳转到页内位置 `rfq-section`、`bid-quote-area`、`bid-workspace`（`targets.ts` 的 `NEXT_STEP_ANCHORS`），跳法是改地址里的 `#位置`、每 200 毫秒找一次元素，找到后 1.6 秒内离顶部超过 96 像素才重滚（`scrollToProjectAnchor`）。
- 报价引擎权限：`resolveQuoteCapabilities(access, { financeManage })`（`src/lib/quote-engine/access.ts`，`requireQuoteAccess` 内部用的同一个函数）——特权 = 超级管理员 / `ORG` 范围持 `project.finance.manage` / 项目负责人；`canViewInternal` = 特权或项目角色带 `project:cost:read`（项目只读 / 测试 / 操作员 / 项目管理员角色都带，`src/lib/rbac/permissions.ts` 第 133、153、182、193 行附近）。`requireQuoteAccess` 在报价引擎开关关时返回 404。财务查看权 `resolveFinancePrivilege(...)`（`src/lib/project-finance/access.ts`）：`privileged` 与上面的特权同一组条件，`canReadAll` 另加 `ORG` 范围持 `project.finance.read`。
- 旧页面上带金额的既有组件与接口对任何有项目读权限的人都给金额：`TenderOurBidCard`（`/quote-engine/tender-bid`，`summarize()` 不隐藏售价）、询价区（`/inquiries` 只要项目读权限，`inquiry-detail.tsx` 显示单价 / 总价）、`BidQuoteArea`（`/quote-engine` 列表售价给所有人、成本与毛利率给 `canViewInternal`）、版本历史抽屉（`/quotes` 返回 `totalAmount` / `profitMargin`，行链到显示毛利的旧报价页）、项目接口 `GET /api/projects/{id}`（整行项目，含 `ourBidPrice` / `winningBidPrice`）。`TenderSourcingEntry`、`ProjectSupplierLinks` 不显示金额。`ProjectGenerateMenu` 不显示金额，但它生成的「内部项目分析 PDF」在项目同时有我方报价与中标价时会写出两者与价差（`generate-docs.ts`、`price-gap.ts`）。
- 专业模式 `PricingControlCenter`（含「快照与实时计算不一致（calcVersion…）」的漂移提示）只挂在独立路由 `src/app/(main)/projects/[id]/quote-engine/[quoteId]/page.tsx`，不在页签里；页签里的 `BidQuoteArea` → `QuoteEngineSection` 只是列表与跳转。
- 生成文件列表 `GET …/generate-pdf` 要项目写权限，`ProjectGenerateMenu` 在 `canManage` 为假时不渲染；乱码时代旧件由 `isLegacyGarbledGeneratedDoc` 去掉。

## Goals / Non-Goals

**Goals：**
- 开关关着时页签渲染的就是改版前的页面组件，并能用测试证明（任务书「合并授权」的前提）。
- 新页面的骨架、「下一步」与汇总接口一次到位，后面七个 change 只往分区里换内容。
- 金额可见范围按任务书附录 C 决定 C 收紧：汇总接口不给看不到金额的人金额；新页面不给他们挂带金额的旧组件。

**Non-Goals：**
- 不改 `src/components/project-detail/tabs/bid-tab.tsx`、`src/components/quote-engine/*.tsx`、`src/components/inquiry/*.tsx`、`src/components/bid-workflow/*.tsx`、`src/components/supplier-intel/tender-sourcing-entry.tsx`、`src/components/project-generate/project-generate-menu.tsx`、`src/components/tender/bid-workspace-panel.tsx`、`src/components/project-detail/version-history-drawer.tsx`。
- 不改 `src/lib/tender-next-step/**`、`src/lib/muse-bridge/**`、`src/lib/quote-engine/**`、`src/lib/project-finance/access.ts`、`src/lib/tender-rfq/**`（只调用它们的导出函数 / 常量），也不改任何既有接口（含 `/quote-engine*`、`/inquiries`、`/quotes`、`GET /api/projects/{id}`、`next-step`）。旧接口的金额口径由 CHAIN-2e 收（附录 C 决定 C）。
- 不改 `page.tsx` 除 import 与 `BidTab` 那一行之外的任何一行。
- 不处理已结束 / 已提交 / 已中标的项目（任务书七条没有；FLOW-H1 那张卡照旧管这些）。

## Decisions

### D1：入口放在项目页、`bid-tab.tsx` 一个字不动（附录 C 决定 B）；不在浏览器里记「开过」；刷新出错不退回旧页面

`page.tsx` 只把 `import { BidTab } …` 换成 `import { BidTabEntry } from "@/components/bid-page-v2/bid-tab-entry"`，`<BidTab …/>` 换成 `<BidTabEntry …/>`，属性完全相同。`BidTabEntry` 没有 `view` 时就是 `return <BidTab {...props} />`（同一组件、同样的属性、不加包裹、不加 key，停在旧页面时不会重新挂载）。挂载后经纯函数 `fetchSummary(projectId, fetch)`（`entry-mode.ts`，可注入 `fetch` 单测）请求汇总接口，结果分三种：已开启（200 + `enabled === true` + 形状对）/ 明确未启用（404）/ 出错（其余一切）。再由纯函数 `nextView(prev, outcome)` 决定：已开启 → 新的这份；404 → 没有（旧页面）；出错 → 维持现状（还没进新页面时仍是旧页面；已在新页面上时保留上一份，不因一次 500 / 断网退回旧页面——否则看不到金额的人会因为一次出错看到带金额的旧组件）。新页面上 `window` 获得焦点时再请求一次（只在新页面上挂这个监听）。不用 `apiJson`（它 401 时跳登录）；取数这一段不打日志、不提示、不跳转、不写存储。

- 备选 A：在 `bid-tab.tsx` 里分流。否决：#544 正在改这个文件（附录 C 决定 B）。
- 备选 B：把开关结果放进项目接口 `GET /api/projects/{id}`。否决：改了一个旧接口的响应；还要改 `page.tsx` 的取数代码（#539 正在改那一段）。
- 备选 C：等接口回来之前什么都不渲染。否决：开关关时页面先空白一下。
- 备选 D：接口说「已开启」后在 `sessionStorage` 记一个键，再打开时先渲染新页面。否决：开关开过再关（任务书验收第 9 条）时，这个键会让第一次渲染变成新页面，「开关关 = 零变化」不成立。
- 备选 E：再加一个构建期公开开关（`NEXT_PUBLIC_…`），没设时入口连请求都不发、设了时先渲染占位。否决：多一个必须与服务端开关保持一致的环境变量，设错一个就出问题；组织白名单也没法放进公开变量。

**已知限制（开开关前要处理或接受）**：开关开着时入口第一次渲染仍是旧 `BidTab`，旧组件在汇总回来之前就会请求旧接口；汇总接口第一次就出错时也停在旧页面。这期间看不到金额的人拿到的金额与今天的旧页面完全相同（不新增暴露），旧接口本身的口子由 CHAIN-2e 收（附录 C 决定 C）。写进交接「上线前置条件」：打开开关前 CHAIN-2e 已合并，或由 Lucas / Evan 明确接受。

不在测试里比文件哈希：#544 合并后会改 `bid-tab.tsx`，哈希断言会让 main 上的测试失败、连累别的轨道。「本 change 没改 `bid-tab.tsx`」由 PR 的 `git diff` 与审查核对。

### D2：新建汇总接口，不并入 FLOW-H1 的 `next-step` 接口；第一步先做项目读权限检查

`GET /api/projects/{id}/bid-page-summary`：第一步不带条件地 `requireProjectReadAccess` 并紧接着检查结果（FIX-21 的目录守卫要求的写法）→ 项目有组织、是招投标项目、`isBidPageV2EnabledForOrg(orgId)` 为真，否则 404（在取财务权限、读询价 / 报价 / 审批 / 生成文件之前）→ 取数 → 纯函数出结论。

- 备选：在 FLOW-H1 的 `next-step` 响应里加字段。否决：那个接口受另一个开关管，改它的响应就是改旧接口。
- 备选（开工前审查前的做法）：总闸先于鉴权，开关关时不读库直接 404。否决：FIX-21 合并后它的目录守卫会拦下这种写法；开关关时多的这次请求只做登录与项目读权限检查，代价可接受（旧页面 `BidWorkspacePanel` 在它的开关关着时也这样请求一次、拿 404）。

### D3：「下一步」是一张单独的页内查表；询价按每家供应商的最近一次算

纯函数 `decideBidPageNextStep(facts)`（`src/lib/bid-page-v2/next-step.ts`），表与去处见规格。事实来源：

| 事实 | 取法 |
|---|---|
| 招标分析是否已批准 | `loadWebNextStepInput(...).analysisStatus === "APPROVED"`（「当前这份分析」与 FLOW-H1 同一条取法；询价入口取的是「最新一份可用分析」，重新分析期间两者可能不是同一份） |
| 已询价 / 已回 / 已报价 / 回复了没报价 / 在等 / 最早发出时间 | 纯函数 `countInquiry`（`inquiry-count.ts`）：没取消轮次里的全部明细，每家供应商取它最近一次发出的那一轮（轮次号最大、状态不是「未发出」）的状态；任何一轮报过价就算已报价；「在等」= 最近一次是已发出、那一轮没结束、发出不到 90 天（与定时催单 `OPEN_ITEM_WINDOW_DAYS`、FLOW-H1 的 `outOfScan` 同一口径，测试按源码核对两个常量相等）；没有发出时间的「已发出」仍算在等、不写天数 |
| 供应商数 | 本项目 `ProjectSupplierLink`（角色不是「未入选」）与没取消轮次里询价明细的供应商 id 去重 |
| 待批询价卡 | 本项目 `tender.send_rfq`、待批、未过期的审批张数（不按看的人过滤，只出张数，不出标题） |
| 报价 | `quoteType ≠ CUSTOM` 的引擎报价里最新一份草稿 / 待批准；`resolveTenderBid` 的状态、版本、售价与币种（看得到金额时），状态为 NONE 时它的可选报价份数 |
| 生成文件 | 有项目写权限时，`ProjectGeneratedDocument` 去掉乱码旧件后的文件种类数 |

**与任务书的出入**（任务书原表：招标要求 → 没有供应商 → 没发询价 → 没回复 → 开始做报价 → 有草稿 → 已定）：

1. **「已定」「有未定的报价」挪到找供应商之前**：照原顺序，不走询价、直接按自己成本定价的项目（Sunny 供应商库基本为空，拍板结果 9）永远停在「添加供应商或起草询价」。「已定」在「有草稿」之前：另起新版时旧版变成「已被新版替代」，走「有新版待定」，不会被「已定」盖住；已定之后又开了一份草稿，下一步仍是出文件。
2. **招标分析那条只在「还没往下走」时命中**：已经发了询价或有还在用的引擎报价的项目，横条按实际进度走，另顺带一句「招标分析还没批准」（与 FLOW-H1「跟着实际的进度走」同理；用「招标分析」不用「招标要求」，被批准的是分析，与招标要求页的「批准分析」按钮、FLOW-H1 的说法一致）。
3. **「有未定的报价」包括「已批准但没选为我方报价」**：自动选中只在恰好一份已批准时发生。
4. **「开始做报价」只认「有人报价」**：回复了没报价、还有人在等 → 仍是「等供应商回复」（原因写「N 家回复了、还没录入报价，其余还在等」）；没人在等、有新一轮的发询价卡在等批准 → 「询价已起草，等批准后发出」；没人在等、有人回复了没报价 → 新增一句「看供应商回复，把报价录入」（去 ①；「录入」与 FLOW-H1 用词一致；原因提醒先看回复里有没有报价——「已回复」也包括「收到，下周报价」这类回复）；问过的都拒绝或没响应 → 「开始做报价」（原因写「问过的 N 家都没报价，也可以再问几家」）。
5. **有待批询价卡、还没发出时说「询价已起草，等批准后发出」**：已经起草了，再说「起草询价」不对。
6. **等待 0 天写「等供应商回复（发出不到 1 天）」**，不写「已等 0 天」。
7. **看不到金额的人**：起草询价、等批准、录报价、做报价、定报价这几条要做的事在带金额的区块里（D5），顺带一句「这一步要项目负责人或有财务查看权的同事来做」（与 FLOW-H1「这一步要项目负责人来做」同一做法）。
8. **开关关着时每次进页签多一次请求**（任务书 Impact 写的是「零行为变化」）：页面渲染结果不变，只多一次只做鉴权、返回 404 的请求（D2）。

- 备选：直接用 Muse 的 `decideNextStep`。否决：那是整个项目的下一步（待批的任何卡、截标提醒、关键事实、强制要求……），与任务书给的页内规则不是一回事。
- 备选：询价只看「当前这一轮」。否决（审查实测）：上一轮还有人在等、新一轮有人拒绝时会错过「等供应商回复」，天数也会少算。
- 备选：自己写一套「当前这份分析」的取法。否决：已经有人定过、测过，另写一份迟早不一致。

### D4：金额给谁（附录 C 决定 C）——汇总接口

`canViewAmounts = canViewBidAmounts({ canViewInternal, financeCanReadAll })`：`finance = resolveFinancePrivilege(user, orgId, ownerId)`；`canViewInternal = resolveQuoteCapabilities(access, { financeManage: finance.privileged }).canViewInternal`（与 `requireQuoteAccess` 同一个判定函数；`finance.privileged` 与它的特权同一组条件；CHAIN-2e 以后改这个函数，新页面自动跟上）；`financeCanReadAll = finance.canReadAll`。这个判定与报价引擎开关无关（引擎关时询价区照样按它挂）；我方报价金额另要 `isQuoteEngineEnabled()` 为真且我方报价已定。纯函数进 CI 的纯逻辑测试；隔离库测试覆盖负责人、持 `ORG` 范围 `project.finance.read` 的成员（看得到），项目只读成员、操作员、项目管理员、组织管理员、只有分派范围 `finance.read` 的招投标岗（看不到），以及引擎关时的口径。

响应里的金额只出现在两处：`view.quote.amount`（`{ value, currency }`）与第 ② 步状态文字；看不到金额时两处都没有，`view.viewer.canViewAmounts = false`。`resolveTenderBid` 的结果不透传（`reason`、`mirror.ourBidPrice`、`candidates[].sellingPrice` 都不进响应），只取状态、版本、售价、币种与可选报价份数。售价与「我方报价」卡同一个数（`summarize`：实时计算，计算无效时沿用快照——只在批准后计算规则变了才会走到，已批准报价内容是冻结的）；不是有限数时不出金额。

- 备选：照任务书原文只看 `project:cost:read`。否决：项目只读 / 测试 / 操作员 / 项目管理员角色都有它，等于几乎人人可见，和 CHAIN-2e 的拍板冲突。
- 备选（开工前审查前的做法）：用 `requireQuoteAccess(...,"read")` 的 404 判断报价功能。否决（审查指出）：引擎关时连项目负责人都被判成「看不到金额」，询价区也被藏起来、说明叫他去找负责人。
- 备选：在 `access.ts` 里改判定。否决：那是 CHAIN-2e 的范围；本 change 只在新接口里多加一道。

金额写法：两位小数、千分位，币种 CAD → 加元、USD → 美元、CNY → 人民币、EUR → 欧元、GBP → 英镑，其余原样写币种代码（附录 A 允许保留币种代码）；不是有限数、大到失真时写「—」。

### D5：三个分区挂既有组件；带金额的只给看得到金额的人；收起用 `hidden`

| 位置 | 看得到金额 | 看不到金额 | 由哪个 change 替换 / 收口 |
|---|---|---|---|
| 右上角 | 「更多」→ 版本历史（同一个抽屉） | 没有「更多」（版本历史经 `/quotes` 带出售价与毛利率） | BIDPAGE-3 往「更多」里加「专业模式」 |
| ① 找供应商、询价 | `TenderSourcingEntry`、`ProjectInquirySection`、`ProjectSupplierLinks` | `TenderSourcingEntry`、一句说明、`ProjectSupplierLinks` | BIDPAGE-2（新表格的「报价」列只给有成本权限的人；恢复没有财务查看权、有编辑权的人起草询价） |
| ② 定报价 | `BidWorkspacePanel`、`TenderOurBidCard`、`<div id="bid-quote-area">` 包着的 `BidQuoteArea` | `<div id="bid-quote-area">` 包着的一句说明 | BIDPAGE-3 / 4 / 6（恢复有 `project:cost:write` 的人编辑报价；从新页面拿掉 `BidWorkspacePanel`——它写浏览器本地成本草稿，与 BIDPAGE-3「不再写浏览器本地存储」相反） |
| ③ 出文件 | `ProjectGenerateMenu`（有编辑权限时） | 同左 | BIDPAGE-7（「内部项目分析」这类会写出我方报价 / 中标价的文件按金额门处理） |
| ③ 没有编辑权限 | 一句「生成文件需要项目编辑权限，请找项目负责人。」 | 同左 | — |

两句说明：①「询价里会有供应商报价，所以询价区只给项目负责人和有财务查看权的同事看。要起草或查看询价，请找他们。」②「报价的金额与成本只给项目负责人和有财务查看权的同事看。要做报价或查看金额，请找他们。」

**这一门只是「不挂组件」，不是数据保护**：判定来自服务端（汇总接口），汇总接口本身不出金额；但旧接口（D1 Context 列的那些）照旧对项目读者给金额，任何人拿自己的会话直接请求它们都拿得到——附录 C 决定 C 已把旧接口留给 CHAIN-2e。规格写了这句边界，交接列为上线前置条件。

**与任务书 / 决定 C 的出入（临时）**：决定 C 写「编辑 / 批准仍走 `requireQuoteAccess`」。本 change 里看不到金额的人在新页面的 ① ② 里暂时不能起草询价、编辑报价——带金额的旧组件整块不挂（只遮金额要改旧组件，而这些旧组件的接口本来就给金额，遮了也挡不住）。BIDPAGE-2 / 3 / 4 / 6 换上按金额门做的新区块后恢复，TASKFLOW 对应行写明恢复义务；开关在八个都合并前不打开。

收起的分区仍挂在页面上，只加 `hidden`：组件取数照常；页内位置的元素一直在（`bid-quote-area` 两种人都有；`rfq-section` 只在看得到金额时有）。打开时展开哪个：地址里的 `#位置` 落在某个分区 → 它；否则「下一步」指向的那个（指向招标要求时是 ①）。挂载时与 `hashchange` 时按 `#位置` 展开分区，并在 60 毫秒后自己 `scrollIntoView` 一次（项目页的重滚只有 1.6 秒的时间窗，汇总接口慢时会错过）。汇总刷新后「下一步」换了指向：人没自己开合过、地址里也没有 `#位置` 时跟着展开。

- 备选：收起时不渲染。否决：收起分区里的位置元素不存在，项目页卡片跳不过去；各组件的取数时机也变了。
- 备选：看不到金额的人照样挂旧组件，留给后面的 change 收口。否决：开工前审查指出这与任务书合并条件 ③ 正面冲突，按更保守的一方处理。

「下一步」按钮：指向分区 → 展开该分区并 `scrollIntoView`；指向招标要求 → `router.replace(tabHref(…), { scroll: false })`，只把地址里的 `?tab=` 换成 `requirements`（保留其它参数，去掉动态深链与 `#位置`；与项目页自己切页签同一做法；不新增浏览历史）。

- 备选：原生 `window.history.replaceState`。否决（浏览器实测）：这个版本的 Next 不把它同步给 `useSearchParams`，地址变了页签不切。

**运行信息**：任务书 BIDPAGE-1 第 3 条「管理员才关心的运行信息在新页面不显示」——已做到：新页面与它挂的组件里都没有引擎版本、计算版本号（专业模式的漂移提示只在独立路由上）。专业模式独立页的说法由 BIDPAGE-3 / 8 处理。

### D6：「更多」菜单

右上角一个「更多」按钮（只给看得到金额的人，D5），点开是只有「版本历史」一项的小菜单，点了打开既有 `VersionHistoryDrawer`（同一组件、同样的属性）。菜单点外面或按 Esc 收起。

- 备选：「版本历史」做成顶部一个小图标按钮。否决：任务书要求移到「更多」里；后面 BIDPAGE-3 的「专业模式」、判断点 4 的「旧版报价单」也要放进同一个「更多」。

## 与八条硬纪律的关系

1. 零 schema：只读既有表（`TenderAnalysisRun`、`ProjectInquiry` / `InquiryItem`、`ProjectSupplierLink`、`PendingAction`、`ProjectQuote`、`ProjectGeneratedDocument`、授权表）；不改 `prisma/`。
2. 出站先审批：不涉及——接口只读，按钮只导航；询价仍从既有入口起草成待批卡。
3. 禁止第三套队列：不涉及——汇总是请求时现算，回到标签页时的刷新是事件监听，不是轮询；没有定时任务、没有缓存表。
4. 脱敏：触碰。金额只给有成本与财务查看权的人（D4），对任何人不出成本、毛利、供应商报价；新页面对看不到金额的人不挂带金额的旧组件（D5，边界见 D5）；不经 Muse 通道。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。「下一步」是查表（D3），不调模型；本 change 没有新增模型调用。
8. 测试注册：触碰。三份新测试在 `scripts/test-all.sh` 注册并进 `scripts/test-ci-unit.sh`（隔离库那份在 CI 里没有库时跳过），`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/bid-page-v2/__tests__/next-step.test.ts`（进 CI）：查表每条规则、先后顺序、去处对应表、招标分析的「往下走了」、看不到金额时的顺带一句、等待天数与回复、`countInquiry` 的多轮 / 已结束轮次 / 90 天 / 没有发出时间、分区状态写法、金额门（与引擎开关无关）、看不到金额时文字里没有金额、结果里没有成本类字段、金额写法（含非有限数）、开关解析、汇总接口的检查顺序（第一步项目读权限、开关在取数前、用 `resolveQuoteCapabilities`）。
- `npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx`（进 CI）：开关关时入口第一次渲染与 `BidTab` 逐字节相同；入口旧分支原样渲染、不记标记、旧页面上不挂焦点监听、取数这段没有副作用；`page.tsx` 的页签渲染入口、属性不变；`fetchSummary` 注入假 `fetch` 逐种走（含 404 / 500 带合法内容、请求失败、不是 JSON）；`nextView` 的三种取舍；新页面三个分区、状态、只展开一个、`#位置` 优先、「更多」只给看得到金额的人、没有简报面板、看不到金额的人看不到带金额的旧组件、引擎关时询价区照挂、③ 的说明、位置元素在；按钮处理只改展开状态 / 滚动 / 页签地址。
- `NODE_ENV=test npx tsx src/lib/bid-page-v2/__tests__/bid-page-summary-db.isolated.test.ts`（隔离库；CI 里跳过，本地跑并写进报告）：开关、白名单、401 / 被拒 / 非招投标 404；规则在真实数据上各走一遍（含多轮询价、已结束轮次）；七种身份的金额可见范围；引擎关时的口径；响应里没有成本与供应商报价；调用前后各表不变。
- `git diff --name-only origin/main`：只允许本 change 新增的文件、`src/app/(main)/projects/[id]/page.tsx`、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`、`.env.example`、`docs/**`、`openspec/changes/bid-page-v2-shell/**`；没有 `bid-tab.tsx`，没有任何既有接口文件。`git diff origin/main -- 'src/app/(main)/projects/[id]/page.tsx'` 只有两行。
- `npm test` 全量、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx -y @fission-ai/openspec@1.15.0 validate bid-page-v2-shell --strict`；`git diff origin/main -- prisma/ vercel.json` 为空。
- 浏览器抽检（本地合成数据）：开关关时与 main 的页签截图逐像素比对；开关开时截图；`#位置`、「更多」、按钮切页签的交互。

## Risks / Trade-offs

- [旧接口仍给金额] 新页面的金额门只是不挂组件；旧接口照旧（决定 C 留给 CHAIN-2e）→ 交接列为上线前置条件：打开开关前 CHAIN-2e 已合并，或由人明确接受。
- [开关开着时每次进页签先闪一下旧页面] 期间旧组件照常请求旧接口（与今天相同）→ D1 已知限制，同上。
- [开关关着时每次进页签多一次请求] 只做登录与项目读权限检查、返回 404 → 渲染结果不变；浏览器控制台与服务端日志多一行 404（旧页面 `BidWorkspacePanel` 已有先例）。
- [两个「下一步」说法不同] 项目页 FLOW-H1 卡管整个项目、新页面的横条管这一页 → 「当前这份分析」同源；询价计数口径不同（FLOW-H1 看当前一轮，本页按每家最近一次），说的是不同范围；不合并。
- [看不到金额的人在新页面上暂时做不了询价与报价] → D5 的临时出入；BIDPAGE-2 / 3 / 4 / 6 恢复。
- [「已定」指向 ③，但任务书 BIDPAGE-3 把「按招标方价格表导出」放在 ② 底部] → BIDPAGE-3 时回看这条规则的去处与说法。
- [`page.tsx` 与 #539 同改一个文件] 改动处相距十几行，后合并的一方变基即可；本 PR 合并前 `git fetch` 再核对。
- [新页面里旧组件的英文] 分区里暂时还是旧组件，旧文案在 BIDPAGE-8 之前仍会出现在新页面上 → 开关在八个 change 都合并前不打开。

## Migration Plan

- 合并后开关默认关，生产行为不变（每次进页签多一次返回 404 的请求）。
- 回退：回退本 PR 即可（只有新文件、`page.tsx` 两处、两个测试脚本的注册行、`.env.example` 的说明、TASKFLOW 一节）；或开关保持关。
- 上线（八个 change 都合并、上线前置条件满足后，由 Evan / Lucas 操作）：预发设 `TENDER_BID_PAGE_V2_ENABLED=1`、`TENDER_BID_PAGE_V2_ORG_ALLOWLIST=<Sunny 组织 id>`，验收通过后生产设同样两项并重新部署。
