# Design：「招标要求」页签收口——要求只在投标合规矩阵一处（FIX-22）

## Context

动机见 proposal 的 Why。下面只写决定做法要用到的现状，都对过代码。行号以 main `2ef4f9c8` 为准；`analysis-panel.tsx` 标「FIX-13 后」的按 `/home/user/wt/fix13`（`d273cce4`）。

### 1. 两处列表各读哪一次分析

| | 投标合规矩阵 | 分析面板的要求列表 |
|---|---|---|
| 挂载 | `requirements-tab.tsx:31` | `requirements-tab.tsx:33-39`，分区 `["requirements","risks","clarifications","report","sources"]`，初始 `requirements` |
| 取数 | `GET /api/projects/[id]/bid-fit`（`bid-fit-matrix-card.tsx:80-91`） | 先 `GET …/tender-analysis/runs?latest=1`，再 `GET …/runs/[runId]`（`analysis-panel.tsx:263-284`） |
| 选哪次分析 | `latestRun`：`status in (REVIEW_REQUIRED, APPROVED)`，按创建时间取最新（`bid-fit/route.ts:23-29`） | 项目 + 组织下按创建时间取最新，**不看状态**（`tender-analysis/runs/route.ts:27-31`） |
| 列哪些要求 | 这一次的全部要求，最多 300 条，按强制优先、编号排序（`bid-fit/route.ts:42-55`）。卡片默认只显示强制的，「全部 N 条」里的 N 是总数（`bid-fit-matrix-card.tsx:96-99`、`:302`） | 这一次的全部要求，不限条数、不按审阅状态过滤（`runs/[runId]/route.ts:46-49`、`:162-164`） |
| 能做什么 | 五态标注、批量设为已有、合规记忆、翻译 | 逐条确认 / 驳回（`analysis-panel.tsx:893-921`）、勾选批量确认（`:816-854`）、「来源」（`:884-892`） |

另外两处也按矩阵的口径取：手动补翻接口（`bid-fit/translate/route.ts:30-34`）与询价单（`tender-rfq/service.ts:418-428`）。

### 2. 73 与 54 为什么不同

- **只能是两次不同的分析，不可能是同一次分析的不同过滤。**
  - 同一次分析里，面板列表列全部要求，矩阵的任何计数都是它的子集：总数 ≤ 300，或者只算强制的。所以同一次分析里列表条数 ≥ 矩阵条数。
  - 54 < 73，因此面板那次与矩阵那次不是同一次。
- **54 条那次更新，且不在「等待审核 / 已批准」里**：如果它在，它就同时是两处的最新一条。
- **它有要求，说明已经过了落库那一步。**
  - 落库在一个事务里一次写完全部要求（`v2-persist-core.ts:130-146`）。
  - 一键分析在落库后还要跑后面几步，之后才终态化（`tender-workforce/tools.ts:1290` 的注释：落库后仍是 AGENT_ANALYZING）。
  - 所以它是「AI 数字员工分析中」（落库后、终态化前），或者「AI 分析未完成」（落库后失败）。
- **为什么两次会并存**：一键分析完成后不会把更早的待审结果标为已被替代。只有旧管线的重新分析会这样做（FIX-18 Out of scope 引的 `enqueue-package.ts:487-500`）。
- 生产上怎么核对：附录 A、B。附录 A 列出这个项目每次分析的状态、要求条数、五态条数、有没有「项目解读」；附录 B 分别按两处的口径各取一条。

### 3. 五态存在哪、谁能标；列表上的确认写什么

- **五态的存放**：五态是 `HAVE / BUILD / PARTNER / RFI / NO_GO`（`bid-fit/route.ts:21`）。存在这次分析的 `summaryJson.bidFitMatrix[要求 id] = { fit, noteZh, by, at, provenance? }`（`:140-150`），先读出摘要、再整块写回（`:170-173`）。
- **谁能标**：写权限（`:95`）。卡片只对 `canManage` 显示选择框（`bid-fit-matrix-card.tsx:253`）。`canManage` 是项目负责人、组织管理员、项目管理员或超级管理员（`api/projects/[id]/route.ts:100-106`），与写权限的判定一致（`projects/access.ts:54-110`）。
- **五态不改审阅状态**：五态标注不碰要求的 `reviewStatus`，两者今天互不相干。标注同时写进组织的合规记忆（`bid-fit/route.ts:152-169`）。
- **合规记忆**：逐字一致的候选在页面打开时自动带入一次（`bid-fit-matrix-card.tsx:155-162`），相似的候选要人点「采纳全部历史建议」（`:327-335`）。
- **列表上的确认 / 驳回**：写的是 `TenderExtractedRequirement.reviewStatus`：`AI_EXTRACTED`（待确认）/ `CONFIRMED` / `REJECTED`（`schema.prisma:2493-2494`）。
  - 单条确认 / 驳回：`review.ts:389-417`，不看分析状态；面板在已批准时不显示按钮（`analysis-panel.tsx:893-894`）。
  - 批量确认：`review.ts:444-491`，带 `onlyWhileInReview`。
  - 批准时 `confirmAllRequirements` 可把待确认全部改为已确认（`review.ts:119-127`），界面一直传 `false`（`analysis-panel.tsx:521`）。
- **询价单只取已确认的**：
  - `tender-rfq/build.ts:219-223` 只收 `reviewStatus === "CONFIRMED"`；
  - 自动起草判定「当前有效的一份」用同一口径（`auto-draft-service.ts:71-80`）；
  - 提交清单也按 `reviewStatus` 分（`tender-submission-checklist/contract.ts:183-192`）。
- **五态的其它读者**：投标草稿读五态（`tender-bid-draft/gather.ts:80-88`，`contract.ts:26-38` 把五态换成合规说法；不认识的值落到默认分支）；`bid-draft/route.ts:30-37` 数「已标几条」。

### 4. 「批准分析」现在在哪

- **位置**：在面板运行头部，`data.run.status === "REVIEW_REQUIRED"` 时显示（`analysis-panel.tsx:514-528`，FIX-13 后 `:537-551`）。
  - 面板不知道看的人有没有写权限：没写权限的人也看得到，点了 403。
  - 旁边是 `approveHintZh`「还有 N 条要求没有确认：批准后不能再确认，没确认的不会进询价单。」（`:530-534`；文案 `requirement-batch-confirm.ts:85-88`）。
- **接口**：`POST …/runs/[runId]/approve`，写权限（`approve/route.ts:22`）。
  - 只有等待审核能批准（`status.ts:19`）；先查一次状态，再以等待审核为条件更新（`review.ts:75-101`）。
  - 成功后判定供应商情报与自动起草（`approve/route.ts:55-58`），结果显示在面板（`analysis-panel.tsx:597-621`）。

### 5. 「本次分析未完成」能用什么判定

- 状态值与中文标签（`display-labels.ts:14-25`）：PENDING 等待分析、EXTRACTING 正在提取、ANALYZING 正在分析、REVIEW_REQUIRED 等待审核、APPROVED 已批准、FAILED 分析失败、SUPERSEDED 已由新分析替代、AGENT_ANALYZING AI 数字员工分析中、AGENT_FAILED AI 分析未完成。
- 这些状态都不算「已完成」：
  - FAILED 不是终态：旧管线会再认领（`constants.ts:35-40`）。
  - AGENT_FAILED 是一键分析的终态失败（`analysis-run-service.ts:419-450`）。
  - AGENT_ANALYZING 在落库后、终态化前已经有要求。
- **分析中的那一次不能写标注**：
  - 一键分析的 V1 终态化会把 `summaryJson` 整块换成结果（`analysis-run-service.ts:383-396`）；
  - 落库本身也整块写 `summaryJson`（`v2-persist-core.ts:233-240`）。
  - 这期间写进去的五态会被抹掉。
- 「局限说明」`summaryJson.limitations` 只是给模型的文字。FIX-16 明确不解析它，本次也不用。

### 6. 中文化

- **落库前的那一次**：
  - 在 PERSIST 段，租约内、事务外（`v2-resumable.ts:350-386`）。预算是 `min(240s, max(10s, 剩余 − 5s))`（`:373`）。
  - 剩余不足 8 秒的批次一条不发、直接记失败（`requirement-translate.ts:98-102`）。
  - 失败或超时的条目保留英文（`:124-145`）。
  - 一键分析与旧管线都走这一段（`tender-workforce/tools.ts:1335` → `advanceV2ForWorkforce`）。
- **跳过时什么都不记**：
  - 结果只把调用次数加进 `inference.llmCalls / llmFailures`（`v2-resumable.ts:376-377`），这两个数只用来判「零成功的空分析」（`v2-persist.ts:270-279`）。
  - `summaryJson.metadata` 在翻译之前就组装好了（`v2-map.ts:385-394`、`v2-resumable.ts:355`）。
  - 所以事后能判断「没翻成」的只有译文字段本身：判定是 CJK 字符占比 < 15%（`requirement-lang.ts:9-14`），矩阵卡片与翻译服务共用。
- **既有补翻**：`POST /api/projects/[id]/bid-fit/translate`（`translate/route.ts`）。
  - 写权限、60 秒频控（`:19-20`、`:38-42`），总预算 100 秒（`:69`），`maxDuration` 120（`:17`）。
  - 翻要求、事实与关键事实，调 `translateAnalysisZh`（`requirement-translate.ts:168-210`）：提示词 `tender-requirement-translate` v1，50 条一批，最多 400 条（`:26-39`）。
  - 按钮只要卡片可见的行里有英文就显示（`bid-fit-matrix-card.tsx:120-123`、`:362-377`）。
- **既有补翻会盖掉别人的标注**：
  - 它在 `:38` 读出 `summaryJson`，翻译最长 100 秒，再在 `:76-87` 以 `{...sj, criticalFacts, bidFitTranslateAt}` 整块写回；这期间别人写的 `bidFitMatrix` 会被盖掉。
  - 频控戳也是翻译做完才写（`:76` 在 `:67` 之后），所以 100 秒内连点两次，两次都会翻。
  - 有了自动补翻（打开页面就开始翻，人紧接着就标），这个覆盖一定会发生，所以本次一并修。
- **FIX-12 已有约束**：中文化不越过它的总预算（`tender-analysis-call-deadline` 的 `analysis-slice-budget`「中文化不越过它的总预算」）。自动补翻用同一个调用、同样 100 秒预算，这条照样成立。

### 7. 四个页签在哪

- 都在分析面板里，按 `sections` 渲染：「中文分析」`report`（`analysis-panel.tsx:657-805`，含陈述要点的确认 / 驳回 `:769-797`）、「风险」`:930-969`、「澄清问题」`:971-991`、「来源」`:1051-1082`。
- **分析者模式**：分析带「项目解读」且投标包 AI 体验开着时，面板**不看 `sections`**，换成六个页签：项目解读、关键要求、风险与缺口、澄清 / RFI、全部条款、来源（`:54-61`、`:239`）。
  - 首次进入停在项目解读（`:244-250`）。
  - 「全部条款」就是要求列表；「关键要求」是项目解读里 A–G 分组的要点（`analyst-synthesis-view.tsx:590-635`）。
  - 项目解读里有两个按钮跳「关键要求」（`analyst-synthesis-view.tsx:306`、`:480`）。
- 生产是否开着这个开关：FIX-13 报告按「上传 6 · 纳入分析 4」推断是开着的，未另行核对。12-3 那条分析带不带「项目解读」看附录 A。
- 面板只有两处挂载：「招标要求」页签与「提交」页签（`submission-tab.tsx:151`，`deliverables / tasks`、不带运行控制）。

## Goals / Non-Goals

**Goals**：见 proposal 的 What Changes。

**Non-Goals**（不动的具体到文件）：

- `src/components/tender-analysis/agent-card.tsx`：FIX-18、FIX-20 改它，本次不碰。
- `src/components/tender-analysis/analysis-progress-banner.tsx`：不碰。
- `src/components/tender-analysis/analyst-synthesis-view.tsx`：只在 G3 选 A 时改两个按钮的文字与去处（`:306`、`:480`），其余不碰。FIX-13 改它的排除列表，FIX-16 改它的复核横幅，位置都不同。
- 分析面板的覆盖清单那一块（FIX-13 后 `analysis-panel.tsx:487-535`）：文字、接线一个字不改。FIX-13 的接线断言 `package-coverage.test.ts:260-288` 读的就是它。
- 分析面板运行头部的「重新分析当前投标文件包」与空态「分析投标文件」：FIX-18 管，本次只去掉同一栏里的「批准分析」与提示。
- 落库前的中文化 `src/lib/tender-auto-analysis/v2-resumable.ts:350-386`：不碰。
- 中文化服务 `src/lib/tender-auto-analysis/requirement-translate.ts` 与判定 `requirement-lang.ts`：不碰，只调用。
- 询价、自动起草与供应商情报：`src/lib/tender-rfq/**` 与 `src/lib/tender-intel/auto-supplier-run.ts` 不碰。
- 投标草稿、提交清单与网页「下一步」：`src/lib/tender-bid-draft/**`、`src/lib/tender-submission-checklist/**`、`src/lib/tender-next-step/**` 不碰。
- 审核服务 `src/lib/tender-auto-analysis/review.ts` 与 `src/app/api/projects/[id]/tender-analysis/runs/**` 下全部接口：不碰。
- 合规记忆的记录与匹配 `src/lib/tender-compliance-memory/**`：不碰。
- `src/lib/tender-auto-analysis/requirement-batch-confirm.ts`：不碰，只引用其中的计数与提示函数。
- `src/lib/muse-bridge/**`、`prisma/**`、`vercel.json`：不碰。

## Decisions

### D1 「本页的这次分析」= 该项目最新创建的一条，不分状态

口径与面板今天一样（`runs/route.ts:27-31`，项目 + 组织，按创建时间倒序取第一条）。

- 「已完成」= `REVIEW_REQUIRED` 或 `APPROVED`。
- 其余七种都是「未完成」，查表判定，不看要求条数、不看摘要字段。

被否决的备选：

- **两处都取「等待审核 / 已批准」里最新的一条**（即矩阵今天的口径）。
  - 面板的进度就看不到正在跑、或刚失败的那一次了，失败原因也没处说。
  - 「以下可能不全」这句话也无从谈起：那一份永远是完成的。
- **混合口径**（最新一条失败了就退回上一份完成的，网页「下一步」对旧管线 FAILED 是这样做的，`tender-next-step/service.ts:97-99`）。
  - 页面上又会出现「进度说的是 B，列表列的是 A」，正是这次要去掉的东西。
  - Evan 要的是口径定死。

### D2 面板只加载一次，矩阵用面板给的那一条

- 面板加一个插槽：在进度部分之后、收起的页签之前，渲染调用方给的内容，交给它这次加载到的分析的 id、状态与「重新加载」。
- 「招标要求」页签把矩阵放进这个插槽；矩阵带 `runId` 读接口。
- 面板每次重新加载（卡片完成、增量变更接受 / 忽略、陈述要点确认等），矩阵都拿到新的 id 与状态。
- 矩阵批准成功后调用「重新加载」，面板与矩阵一起刷新。

被否决的备选：

- **两处各自按同一口径去取**：两次请求之间要是新建了一条分析（上传后自动入队、别人点了一键分析），页面上又是两次分析。
- **把取数提到页签里，再分给面板与矩阵**：面板的重新加载散在七八个动作里（`analysis-panel.tsx:290-310`、`:337-398`），要全部搬出来，改动大，也会碰到 FIX-18 刚接好的卡片回报。

### D3 未完成的分析只读；写入接口用 409 拦

- 未完成时卡片不渲染任何写控件。第二句按状态分两种：还在跑的（等待分析、正在提取、正在分析、AI 数字员工分析中）写「分析完成后才能标注」；失败或已被替代的写「重新分析完成后才能标注」，免得人对着一份不会再完成的分析干等。
- 写入接口在事务里锁住这次分析的记录行，重读状态；不是该项目最新一条或未完成时，返回 409：
  - 「本次分析未完成，完成后才能标注」；
  - 「页面上的分析已有更新，请刷新后再标注」。
- 分析中（`AGENT_ANALYZING` 等）只读是硬的：那时写进去的标注会被终态化整块覆盖（Context 5）。
- 终态失败（`AGENT_FAILED`、`FAILED`）也只读，理由：
  - 它批不了（`status.ts:19`），询价、自动起草也不读它；
  - 标上去的东西只会留在这份分析里，重新分析之后看不到。
  - 是否改为允许标注留给 GATE 第 1 条。

被否决：**只在界面上藏，接口不拦**。旧页面、停着的标签页照样能写进去。

### D4 五态推出确认状态：写入时一并改审阅状态，审阅状态仍是询价单唯一的依据

确认状态不另存，就是 `reviewStatus`。矩阵写入时在同一个事务里同时改 `bidFitMatrix` 与 `reviewStatus`，对应关系是一张表：

| 分析状态 | 动作 | 写入后的五态 | 写入后的审阅状态 |
|---|---|---|---|
| 等待审核 | 选五态 X（不论原来是待确认、已确认还是已驳回） | X | 已确认 |
| 等待审核 | 「这不是要求」 | 去掉 | 已驳回 |
| 等待审核 | 「未标 N 条全部设为已有」「本组全部已有」（只作用于没有五态、也不是已驳回的行） | 已有 | 已确认 |
| 等待审核 | 「采纳全部历史建议」（同样排除已驳回的行） | 候选里的那项，带来源 | 已确认 |
| 等待审核 | 「把这 N 条一并确认」（只作用于有五态而待确认的行） | 不变 | 已确认 |
| 已批准 | 已确认的行改选五态 | 新的那项 | 不变（已确认） |
| 已批准 | 其它任何写入 | 拒绝 409 | 不变 |
| 未完成，或不是最新一条 | 任何写入 | 拒绝 409 | 不变 |

- 写法：锁住这次分析的记录行 → 重读 `summaryJson` → 只改 `bidFitMatrix` 里涉及的键 → 写回 → `updateMany` 改这几条要求的 `reviewStatus` → 写审计（D12）→ 提交。
  - 批准接口的条件更新也要更新这一行（`review.ts:89-101`），所以两者按实际先后串行。
  - 锁到时分析已批准，就按已批准一行处理。
- 合规记忆照旧只记五态（`bid-fit/route.ts:152-169`），事务外、失败不阻塞。「这不是要求」不记。
- 询价单、自动起草、提交清单、网页「下一步」、Muse 的 `rfq` 意图一个字不改，它们读的仍是 `reviewStatus`。

被否决的备选：

- **让询价单改读五态**：改了询价单取要求的口径（Evan：口径不变），五个读者都要跟着改。
- **读的时候由五态现算确认状态，库里不写**：`reviewStatus` 与页面会对不上，询价单看不到矩阵上的确认。

### D5 「这不是要求」= 已驳回 + 去掉五态，不是第六种五态

被否决：**在 `bidFitMatrix` 里存第六种取值**。

- 投标草稿会把它当成一条有标注的要求（`gather.ts:88`，`contract.ts:38` 落到默认分支）；
- 「已标几条」会把它算进去（`bid-draft/route.ts:37`）；
- 合规记忆会把它当立场记下来，再推到别的项目；
- 矩阵的五态计数、例外区也都要跟着改。

### D6 批准之后冻结确认状态

依据有两条：既有提示写明「批准后不能再确认」（`requirement-batch-confirm.ts:87`）；自动起草规定「批准招标分析即视为要求审核完成」（`openspec/specs/tender/rfq-auto-draft/spec.md`「起草条件」）。所以批准后：

- 已确认的行仍可在五态之间改，投标草稿批准后仍要读五态（`gather.ts:80-88`）；
- 待确认与已驳回的行只读；
- 不再提供「这不是要求」、批量与采纳。

被否决的备选：

- **批准后矩阵整张只读**：批准后改五态今天是可以的，投标草稿要用，去掉就是回退。
- **批准后照样能确认**：与上面两条既有规格冲突，自动起草的「有几条没带上」也会对不上。

### D7 矩阵上的标注不触发自动起草的判定

- 矩阵只在分析等待审核时改审阅状态，这时的判定一定是 `RUN_NOT_APPROVED`（`auto-draft-pure.ts`，`quiet: true`），调用只是白跑一次查询。
- 批准后矩阵不再改审阅状态（D6）。
- 所以矩阵写入接口不调用 `maybeAutoDraftRfq` / `maybeAutoSupplierRun`，规格里写明（`rfq-auto-draft` MODIFIED）。

被否决：**照逐条确认接口那样每次都调一遍**。没有任何情形会起草，只多两次查询，也让人误以为标注会触发起草。

### D8 上线前的数据：不迁移，按显示规则对上，再给一个人点的「一并确认」

今天两套状态互不相干，所以库里会有四种组合。每一行按下面的先后显示：

1. 已驳回 →「这不是要求」，不管它标过什么；
2. 有五态 → 该项；仍是待确认的，再加「待确认」；
3. 已确认而没有五态（在旧列表上确认过）→「已确认（未标）」；
4. 其余 →「未标」。

- 分析等待审核且有第 2 种「待确认」的行时，矩阵顶部写「已标的 N 条还没算确认」，并给「把这 N 条一并确认」。点后弹确认框，确认后只改这 N 条的审阅状态，留审计。
- 已批准的分析里，第 2 种行显示该项加「批准前没确认，不进询价单」，只读。
- 生产上有多少这样的行，看附录 C、F。

被否决的备选：

- **一次性脚本把「有五态的待确认」全改成已确认**：
  - 这些标注里有合规记忆打开页面时自动带入的（Context 3），从来不是人对这个项目的确认；
  - 也有人当时只是「顺手全部设为已有」、并不知道这等于确认。
  - 批量改成已确认，会直接进询价单，正是 RFQ-AUTO-4 D1 否决「一键全部确认」的理由（`openspec/changes/archive/2026-11-11-requirement-review-batch-confirm/design.md:31-41`）。
- **不给「一并确认」，让人逐行重选**：下拉框选同一项不触发改动，人得先改成别的再改回来，很别扭。

### D9 批量标注与合规记忆（留给 GATE 第 2 条，推荐做法 A）

「标注即确认」之后，矩阵上原来只填五态的三个批量按钮会变成「批量确认」。这与 RFQ-AUTO-4 的「不提供不经勾选就确认全部」相抵。

- 做法 A（推荐）：三个按钮保留，都先弹确认框，写明条数与「这些要求会算作已确认，属于供应商侧的会进询价单」。三个按钮是「未标 N 条全部设为已有」（今天已有确认框，`bid-fit-matrix-card.tsx:349-355`）、「本组全部已有」（今天没有）、「采纳全部历史建议」。逐字一致的合规记忆不再自动带入，与相似的候选一起由人点「采纳全部历史建议（N）」带入。
  - 理由：Evan 定的是「标注任一五态即视为确认」，批量标注本来就是人做的标注。
  - 理由：矩阵可用性批次的实测是「条款基本都是普通合规，不需逐条看」，批量是这张卡存在的原因。
  - 理由：询价单发出前还有一张审批卡，人能在卡上看到每一行。
  - 自动带入是没人操作的写入，标注即确认之后它就成了系统替人确认，必须停。
- 做法 C：去掉全局的「未标 N 条全部设为已有」，只留「本组全部已有」（带确认框）与「采纳全部历史建议」。人至少要按组看一眼。
- 规格按 A 写；选 C 时删掉「批量标注先确认」里的第一个按钮与它的场景。

被否决：**批量按钮只填五态、不算确认**。同一个五态在单条选时算确认、批量选时不算，人分不清，询价单也说不清为什么少了几条。

### D10 「批准分析」移到矩阵顶部

- 位置：矩阵标题行下方、计数行旁边，只在分析等待审核且 `canManage` 时显示。
- 请求不变：同一个接口、同样的请求体 `{ confirmAllRequirements: false }`。服务端的权限与条件不变（写权限、仅等待审核）。
- 旁边是 `approveHintZh(待确认条数)`；待确认条数取自矩阵接口返回的审阅状态。
- 批准响应里的 `rfqAutoDraft` 显示在矩阵顶部，写法与今天面板上的那块相同（`analysis-panel.tsx:597-621` 搬过来）；然后调用 D2 的「重新加载」。
- 唯一可见的变化：没有写权限的人不再看到一个点了会 403 的按钮。

被否决的备选：

- **面板与矩阵两处都放**：两个「批准」入口，Evan 要的是「移到」。
- **照旧对所有人显示**：沿用了一个点了必 403 的按钮，没有好处。

### D11 来源与 300 条上限

- 矩阵读接口一并取每条要求的来源记录与这次分析的文件名，序列化沿用 `serializeSourceRef`（`serializers.ts:51-97`）。点「来源」用既有的 `SourceSnippetDialog`，写法与旧列表一致。没有来源记录的写「来源未记录」。
- 接口多返回总条数，超过 300 条时卡片写「共 N 条，这里只列出前 300 条」。批量写入上限仍是 300（`bid-fit/route.ts:121`）。

被否决：**点「来源」时再去取分析详情**。详情接口会把整份分析都带回来（`runs/[runId]/route.ts:38-65`），只为一条来源太重；另开一个只取来源的接口又多一个对外面。

### D12 改了审阅状态的矩阵写入留审计

- 动作名 `tender_requirement_matrix_mark`，目标是这次分析。
- `afterData` 记：动作（五态的哪一项 /「这不是要求」/「一并确认」/「采纳历史」）、要求号（最多 300 个，每个 ≤ 64 字）、实际改了几条。
- 写法照批量确认接口：确认完成后写，吞错（`batch-confirm/route.ts:54-71`）。
- 只改五态不改审阅状态时不写。

被否决的备选：

- **不写审计**（五态标注今天就不写）：标注从此决定什么进询价单，与批量确认同等分量。
- **每条要求一条审计**：批量 300 条就是 300 行，批量确认接口也是一请求一条。

### D13 面板只留进度，其余分区收在矩阵下方

- `requirements-tab.tsx` 的分区改为 `["risks","clarifications","report","sources"]`，初始 `risks`。面板加一个「收起其余分区」的属性，默认收起。收起时只有一行标题：「风险 · 澄清问题 · 中文分析 · 来源」，分析者模式下是「项目解读 · 风险与缺口 · 澄清 / RFI · 来源」。
- **分析者模式**：页签不再无视 `sections`，按对应关系过滤：
  - `analyst_overview` ↔ `report`；
  - `analyst_risks` ↔ `risks`；
  - `analyst_clar` ↔ `clarifications`；
  - `sources` ↔ `sources`；
  - 「全部条款」与「关键要求」↔ `requirements`。
  - 分区里没有 `requirements`，这两个页签就不出现（「关键要求」的去留见 G3）。
  - 项目解读里跳「关键要求」的两个按钮，在这个页签不可见时改为滚到矩阵（矩阵根元素加 `id="bid-fit-matrix"`），文字为「去投标合规矩阵逐条看」。
- **从面板删掉的代码**（行号是 FIX-13 后的，括号里是 main 的）：
  - 要求列表渲染 `analysis-panel.tsx:833-954`（`:807-928`）；
  - 批量确认的状态与函数 `:264-267`、`:321-344`、`:463-467`（`:255-258`、`:312-335`、`:451-455`）；
  - 「批准分析」与提示 `:537-557`（`:514-534`）；
  - 自动起草结果那一块 `:620-644`（`:597-621`），搬到矩阵。
- 面板的 `id="tender-analysis"` 锚点留在进度部分。网页「下一步」与提交清单都指向它（`web-next-step.test.ts:241`、`checklist.test.ts:165`），它就在矩阵正上方。

被否决的备选：

- **把面板拆成两个组件分别挂**：两份取数，回到 D2 否决的问题。
- **四个页签默认展开**：Evan 说的是「折叠放在矩阵下方」。

### D14 自动补翻的触发点：矩阵读接口，返回之后在同一请求里做

- 触发点在矩阵读接口 `GET …/bid-fit` 里，按以下顺序：
  1. 算出这次分析的中文化状态（D16）；
  2. 是「该补」时，先在短事务里认领（D15）；
  3. 用 Next.js 的 `after()` 在响应发出之后调用补翻；
  4. 响应里的中文化状态写「自动补翻中」。
- 补翻调用与手动接口抽成同一个函数（`zh-backfill.ts`），只是被两个入口调用：取目标 → `translateAnalysisZh(…, { timeoutMs: 100_000 })` → 合并写回（D17）。
- 路由文件加 `export const maxDuration = 120`，与手动补翻接口相同。仓库里 `after()` 已有先例（`api/cron/agent-runs/route.ts:7`、`:72`）。
- 「有没有英文」只看这次分析的要求译文、事实中文与关键事实文字，判定函数与卡片、翻译服务同一个（`requirement-lang.ts:9`）。

为什么不算新队列、新调度（硬纪律第 3 条）：

- 不建表、不加模型字段，不加 cron 条目，不扫描别的项目或别的分析。
- 只有有人打开**这个项目**的「招标要求」页签时才可能发生，做的事限定在**这一次分析**。
- 补翻跑在这次请求自己的生命周期里（`after()` 受同一个 `maxDuration` 约束）。
- 没有 worker 名单、没有租约续期、没有心跳、没有回收器；函数中途被杀，不会有任何东西去接手。下次有人打开页面时按次数（D15）重新判定，次数用完就停。
- 唯一的状态是这次分析摘要 JSON 里的一个认领时间与一个计数。手动补翻接口今天就把频控戳 `bidFitTranslateAt` 写在同一处，性质相同。

被否决的备选：

- **挂进既有的 `/api/cron/tender-auto-analysis`，每个 tick 找还有英文的分析补翻**：
  - 那是一个「找活干」的扫描，就是第 3 条禁止的东西换了个名字；
  - 「CJK 占比 < 15%」写不成 SQL，每个 tick 要把很多分析的全文读出来算；
  - 旧管线 cron 还受它自己的开关约束。
- **加进一键分析的计划（第 9 步之后加一步）或终态化**：
  - 改了 Job 计划与运行时面（runtime-architecture 基线）；
  - 只覆盖一键分析，旧管线还要另挂；
  - 落库前那一次就是在这条链上被截止时间挤掉的。
- **卡片打开时自动调用手动补翻接口**：
  - 只有有写权限的人能触发，只读成员会一直看到英文；
  - 要求标签页开着 100 秒，两个标签页要靠客户端自己防重。
- **把落库前那一次改成可让出、下一切片接着翻**：
  - 为了一个格式转换推迟整份分析的终态化，还要改 FIX-12 刚定的切片逻辑；
  - 对已经落了英文的分析没有任何用。

### D15 防重与次数：认领写在这次分析的摘要里，锁行判定

`summaryJson.zhBackfill = { autoAttempts, runningSince, runningBy, last: { at, by, translated, failed } }`：

- **认领**（自动与手动共用）：在事务里锁住这次分析的记录行，重读摘要，然后判定：
  - `runningSince` 不早于 150 秒前 → 不认领（自动：本次不补；手动：409「正在自动翻译，请稍候」）；
  - 自动认领时 `autoAttempts ≥ 2`，或 `autoAttempts = 1` 且上次 `translated = 0` → 不认领；
  - 否则写 `runningSince = now`、`runningBy`；自动的 `autoAttempts + 1`，提交。
- **结束**：在写回那个事务里清 `runningSince`、写 `last`；手动的照旧写 `bidFitTranslateAt`。
- **150 秒**：大于 `maxDuration` 120 秒。超过 150 秒还没清的，记为已中断，已计入的次数不退。
- **上限 2 次的理由**：每次最多 400 条、预算 100 秒。实测每批 50 条 15–25 秒（`requirement-translate.ts:34-38`），100 秒约译 200–300 条，2 次覆盖 400 条上限。第 1 次一条也没译成，多半是模型或账户的问题，再试也一样，所以不发第 2 次。上限的取值留给 GATE 第 4 条。

被否决的备选：

- **翻译期间一直持有 PostgreSQL 锁**：把一个连接占 100 秒、跨模型调用，FIX-18 D4 也以同样理由否决长事务锁。
- **只用既有的 60 秒频控戳**：戳是翻完才写的（Context 6），挡不住翻译期间的第二次；它也没有次数。

### D16 中文化状态与兜底按钮

矩阵读接口返回 `zh: { state, englishCount }`，`state` 由纯函数查表：

| 条件 | `state` | 卡片 |
|---|---|---|
| 分析未完成，或没有英文 | `none` | 什么都不显示 |
| 有英文，补翻正在进行，或本次刚认领到 | `auto` | 「正在自动翻译成中文…」；每 15 秒重读，最多 12 次 |
| 有英文、没有在进行、自动次数用完 | `fallback` | 有写权限：「翻译成中文」按钮；没有：一句说明 |

- `englishCount` 改由服务端对这次分析的全部要求、事实、关键事实算，不再只算卡片当前可见的行（今天是 `bid-fit-matrix-card.tsx:120-123`）。
- 手动按钮的接口、60 秒频控、返回字段都不变。

被否决：**一直显示按钮**。Evan 要的是兜底。

### D17 补翻写回与标注写入都只改自己的键

两边都在事务里锁这次分析的记录行，重读摘要，只改自己的键：

- 补翻只改 `criticalFacts` 里被译的那几个槽的 `text`、`zhBackfill`、`bidFitTranslateAt`；
- 标注只改 `bidFitMatrix` 里涉及的键。

要求与事实的译文按行更新，条件是这一行的译文还等于翻译前读到的那一句。这一步防的是两次补翻交错，正常情况下 D15 已经挡住了。手法与 FIX-10 / FIX-11 给调查室摘要定的写入入口相同（`src/lib/tender-room/summary-json.ts`）。

被否决：**用 `jsonb_set` 按路径原子改**。标注写入要先读出当前标注做校验（D3、D4），校验与写入仍要在同一个锁里，`jsonb_set` 省不掉锁，还多一套原生 SQL 写法。

### D18 测试分两层

- `src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts`（纯函数与源码接线，进 CI 子集）：
  - 九种状态的完成判定与文案；
  - D4 的表逐行；
  - D8 的四种显示；
  - D16 的状态表与 12 次上限；
  - 源码断言：面板里没有要求列表、确认 / 驳回 / 批量确认 / 批准的请求；矩阵的 `runId` 来自面板；卡片加载后不会自动调用带入（只有点「采纳全部历史建议」才调）；批量按钮都过确认框；自动补翻与手动补翻调用同一个函数、预算都是 100 秒；`vercel.json` 没有新条目；新文件名不含架构守卫的禁用词（`runtime-architecture/guards.ts:83-105`）。
- `src/lib/tender-auto-analysis/__tests__/requirements-tab-converge-db.isolated.test.ts`（隔离库；没有隔离库时跳过）：
  - 12-3 的形状（较早的待审 73 条 + 较新的 AI 分析未完成 54 条）；
  - 未完成与过期分析的 409；
  - D4 每一行的写入与审计；
  - 批准与标注并发；
  - 询价单按矩阵确认的结果取行；
  - 矩阵标注不触发起草；
  - 跨项目 404；
  - 自动补翻：用假的模型调用——两次读只认领一次，第 1 次零进展不发第 2 次，第 1 次有进展发第 2 次后停，补翻期间写入的标注保留，手动接口在补翻中 409、在最新一条未完成时 409；
  - 响应里没有模型原文与错误码。

被否决：**只写源码断言**。并发、锁、409 不写库测不出来。

## 五态推出确认状态（速查）

- 选五态任一项 → 已确认；「这不是要求」→ 已驳回；没有回「待确认」的路。
- 只在分析等待审核时改审阅状态；批准后只能在已确认的行上改五态；未完成的分析一律只读。
- 询价单仍只认「已确认」。

## 与八条硬纪律的关系

1. **零 schema**：遵守。
   - 不加模型、字段、migration。
   - 新键 `zhBackfill` 与改动后的 `bidFitMatrix` 都在 `TenderAnalysisRun.summaryJson`，这是矩阵标注（`bid-fit/route.ts:16-17` 注释「additive JSON，零 schema」）与频控戳已在用的位置。
   - 审阅状态用既有列的既有取值；审计进 AuditLog。
2. **出站先审批**：不涉及。
   - 本次没有对外发送。
   - 矩阵上的确认决定询价单收哪些行，但询价仍要建 PendingAction、批准后才发（`tender-rfq/service.ts` 未改）。
   - 补翻只调模型，这是既有调用。
3. **禁止第三套队列**：遵守。
   - 自动补翻挂在既有的读接口上，不新增 scheduler / queue / lease / worker registry，理由见 D14。
   - 认领是一个时间戳加一个计数，没有持有者续期、心跳与回收，不被任何别的模块读。
   - 新文件名 `requirement-matrix.ts`、`requirement-matrix-write.ts`、`zh-backfill.ts` 不含 `guards.ts:83-105` 的禁用词；`src/lib/tender-auto-analysis` 不在冻结区（`manifest.ts:250-260`）。
4. **脱敏**：不涉及 Muse 通道。同方向的一条是矩阵接口不输出毛利率、项目估值、我方最终报价、模型原文与错误码（规格里有 SHALL NOT）。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：一处登记过的例外，其余遵守。
   - **例外（Evan 2026-11-22 同意）**：在既有补翻调用上新增一个触发点，不新增调用类型。
     - 自动补翻调用的就是「翻译成中文」那个中文化服务，提示词 `tender-requirement-translate` v1 不变，50 条一批，每次最多 400 条，总预算 100 秒，FIX-12 的「中文化不越过它的总预算」照样约束它。
     - 次数上限：每次分析自动最多 2 次，第 2 次只在第 1 次至少译成 1 条时发生；之后不再自动重试，没有定时重试。
     - 手动兜底按钮保留 60 秒频控。
     - 模型只做格式转换，不碰任何判定字段（规格「补翻只改译文」）。
   - 五态推出确认状态、完成与否、中文化状态、按钮显示都是查表。
   - 停掉合规记忆的自动带入后，系统不再替人写任何标注。
   - 本例外是否同时写进 `openspec/config.yaml` 第 7 条（与 KPI-2 并列），由 Evan 定（G8）。
8. **测试注册**：遵守。两个新测试都注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不加行。

## 相邻 change 与合并顺序

定的顺序：**FIX-13 → FIX-18 → FIX-22 → FIX-16**；FIX-20 与本 change 不改同一个文件，先后不限。与任务书里倾向的顺序一致，理由逐条如下。

| change | 改到本页的地方 | 与本 change 重叠的位置 | 处理 |
|---|---|---|---|
| FIX-13 `document-parse-nul-and-reason`（#546，`d273cce4`） | `analysis-panel.tsx` 覆盖清单（FIX-13 后 `:487-535`）、给分析者视图传 `currentParseErrors`（`:677-679`）；`analyst-synthesis-view.tsx` 排除列表 | 同一文件，不同区域。本次删掉的列表、批准、批量都在它下面；覆盖清单本次一字不改 | 先合并。本次按它合并后的行号写，`package-coverage.test.ts:260-288` 必须照旧全过 |
| FIX-18 `tender-analysis-single-entry` | `analysis-panel.tsx`：<br>• 运行头部按钮栏里「重新分析当前投标文件包」（FIX-13 后 `:558-567`）按卡片回报显示；<br>• 空态「分析投标文件」（`:441-448`）与说明句；<br>• 面板收卡片的 `canStart` 回报。<br>另外 `agent-card.tsx` | **同一个按钮栏**：本次要去掉同一栏里的「批准分析」与提示（FIX-13 后 `:537-557`） | 先于本次合并。<br>• FIX-18 改的是几处条件渲染，四件套里的行号与源码断言都按 FIX-13 后的面板写好了；本次是整块重排，先合本次会让 FIX-18 的行号与正则全部作废。<br>• 反过来，本次 rebase 时只是在它改好的按钮栏里少一个按钮。<br>• FIX-18 卡片上那句「请用本页下方的分析按钮」在本次之后仍成立：旧按钮还在卡片正下方的运行头部。<br>• FIX-18 的 `single-entry.test.ts` 面板断言要照旧通过 |
| FIX-22（本 change） | 见 proposal Impact | — | — |
| FIX-16 `tender-analysis-incomplete-notes` | `analysis-panel.tsx` 运行头部正下方加「这次分析有几处没做完」；`analyst-synthesis-view.tsx` 复核横幅；`runs/[runId]/route.ts` 加 `incompleteNotes` | 位置在进度部分里，本次不动它的位置。但它的规格把运行头部写成「标题、状态、文件覆盖清单与「批准分析」「重新分析当前投标文件包」按钮那一栏」，并写「「批准分析」按钮与它的行为不变」（FIX-16 `specs/tender/analysis-incomplete-notes/spec.md:143`） | 放在本次之后。<br>• FIX-16 还在等 12-3 实测的结果定 GATE，只有四件套；它 rebase 时把那半句改成「…与「重新分析当前投标文件包」按钮那一栏」、删掉关于「批准分析」的半句，其余不变。<br>• 「下面是从文件里逐条摘出的要求和要点」（`:166`）在本次之后仍成立：矩阵就在进度部分下面。<br>• 若 FIX-16 先合，本次就得对它的新能力写 MODIFIED，且要等它归档后才能归档。<br>• 「可能不全」要不要也看它的未完成记录，见 G6 |
| FIX-20 `tender-job-synthesis-degrade`（起草中） | `agent-card.tsx`、作业详情页；它的 design 写明不碰 `analysis-panel.tsx`（FIX-20 design `:97`、tasks `:47`） | 无共同文件 | 不限。它合并后，第 8 步失败的一键分析会以「等待审核」收尾而不是「AI 分析未完成」，矩阵显示「未完成」的情形相应变少，本次的判定不用改 |

## 验证方式

- **纯函数与接线**：`npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts`。改动前退出码非 0。
- **隔离库**：`NODE_ENV=test npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge-db.isolated.test.ts`。改动前，12-3 形状、确认状态、409、补翻各组都失败。
- **改写后照旧全过的既有测试**（基线：本机 2026-11-22 在 main 上跑的通过数）：

| 测试 | 基线 | 本次改哪里 |
|---|---|---|
| `src/lib/tender-auto-analysis/__tests__/bid-fit-usability.test.ts` | 19 | BF-14b 改读 `zh-backfill.ts`，BF-09b 断言照旧 |
| `src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm.test.ts` | 54 | 「面板源码」一段里读面板的 15 条改为「面板里已没有」；读 `review.ts` 与接口的几条、纯函数部分不动 |
| `src/lib/tender-compliance-memory/__tests__/compliance-memory.test.ts` | 11 | CM-09c 改为「不自动带入、采纳按钮带确认框」 |
| `src/lib/tender-intel/__tests__/bid-strategy-memo.test.ts` | 12 | FIT-01 的五态字面量与归属校验跟着实际位置 |
| `src/components/project-detail/__tests__/tender-detail-ia.test.ts` | 36 | 分区字符串与「来源」改到矩阵卡片 |

- **不改、要照旧过**：`requirement-batch-confirm-db.isolated.test.ts`、`src/lib/tender-rfq/__tests__/auto-draft-pure.test.ts`、`auto-draft-db.isolated.test.ts`、`build.test.ts`、`src/lib/tender-next-step/__tests__/web-next-step.test.ts`、`src/lib/tender-submission-checklist/__tests__/checklist.test.ts`、`src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts`、`src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts`，以及 FIX-13 的 `package-coverage.test.ts`、FIX-18 的 `single-entry.test.ts`。
- **门禁**：`npm test`（对照既有失败清单无新增）、`npm run test:ci`、`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`OPENSPEC_TELEMETRY=0 openspec validate tender-requirements-tab-converge --strict`。
- **截图**：本地夹具组织截 6 张，存 `docs/acceptance/fix-22/`：
  1. `01-incomplete-banner.png`：最新一条为「AI 分析未完成」，矩阵顶部两句、只读、行上有来源；
  2. `02-matrix-approve.png`：等待审核，矩阵顶部有「批准分析」、提示与三项计数；
  3. `03-folded-tabs.png`：收起与展开的四个页签，两种模式各一张；
  4. `04-matrix-auto-draft.png`：批准后矩阵顶部的自动起草结果；
  5. `05-zh-auto.png`：「正在自动翻译成中文…」与补完后的中文；
  6. `06-legacy-marks.png`：上线前数据的四种显示与「把这 N 条一并确认」。
- **生产核对**：附录的只读 SQL，由有生产只读权限的人在合并前后各跑一次，结果写进报告。

## Risks / Trade-offs

- **[合并后 12-3 这类项目上，原来那份待审分析的 73 条在页面上看不到了]**：最新一条是「AI 分析未完成」时，矩阵显示它的 54 条并只读。这正是 Evan 要的「同一个 run」，代价是要重新分析才能继续标。报告里列出附录 E 查到的受影响项目。
- **[打开旧项目也会触发补翻]**：上线前就有英文的旧分析，第一次被打开时会自动补翻，最多 2 次。花费有上限，且只在有人打开时发生。
- **[页面加载多一点]**：矩阵读接口多取来源记录与事实译文，最多 300 条要求加 400 条事实的短文本，可以接受。
- **[停掉合规记忆的自动带入]**：习惯了「打开就填好」的人要多点一下「采纳全部历史建议」，换来的是系统不再替人确认。
- **[摘要 JSON 的其它写入方仍会整块写回]**：`tender-benchmark/route.ts:158-170`、`reply-resolution.ts:206-222` 都是先重读、紧接着写，窗口很短，但没有锁。不在本次，报告里另开任务。
- **[询价、自动起草、提交清单、投标草稿的口径]**：最新一条未完成时，它们仍用更早完成的那份（G5）。页面上已不能再改那份，它们说的与页面会不一致，直到重新分析完成。

## Migration Plan

不做数据迁移。合并即生效，没有开关。部署后：

1. 跑附录 E、F，看有多少项目的页面会换一份分析、有多少「已标未确认」的行；
2. 通知招投标同事两件事：「要求只在矩阵里确认」与「合规记忆要点一下才带入」；
3. 回滚就是回滚这次合并。新写的 `zhBackfill` 键与审计行留着无害；矩阵上写过的审阅状态是真实的人工确认，不回退。

## 留给 GATE

**G1 终态失败的分析（「AI 分析未完成」「分析失败」）上能不能标注**

- A（推荐）：只读，与分析中相同。
  - 后果：12-3 这种情形要先重新分析才能标。
  - 理由：这份分析批不了，询价单不读它，标上去的东西重新分析后就看不到；而写进合规记忆的立场会被带到别的项目。
- B：允许标五态与「这不是要求」，不允许批准。
  - 后果：人能在失败的那份上先做功课，靠合规记忆的逐字一致带到下一份。
  - 但页面上的「已确认」从此有一部分是不会进询价单的；D3 与规格的「未完成的分析只读」要改。

**G2 批量标注与合规记忆怎样算确认**（D9）

- A（推荐）：三个批量按钮都算确认，都先弹确认框；逐字一致的合规记忆不再自动带入，与相似的一起由人点「采纳全部历史建议」带入。
  - 后果：两次点击就能确认当前可见的全部未标要求。这改变了 RFQ-AUTO-4 D1「不做一键全部确认」的取舍。
- C：去掉全局「未标 N 条全部设为已有」，只留按组的「本组全部已有」（带确认框）与采纳。
  - 后果：至少按组看一眼；人多点几下。
- 不论 A 还是 C，自动带入都要停：标注即确认之后，它就是系统替人确认。

**G3 分析者模式下「关键要求」页签**

- A（推荐）：这里不显示（与「全部条款」一起去掉），项目解读里的两个按钮改为「去投标合规矩阵逐条看」并滚到矩阵。
  - 后果：Evan「要求只在矩阵一处」字面成立；A–G 分组的要点只剩项目解读里的前 5 条预览；要改 `analyst-synthesis-view.tsx` 两个按钮。
- B：保留，它是 AI 的解读、不带确认动作。
  - 后果：页面上仍有第二份「要求」清单，条数与矩阵不同（例如 25 对 73），又会被问「为什么不一样」。

**G4 自动补翻的次数上限**

- A（推荐）：2 次，第 2 次要求第 1 次有进展。
  - 后果：每次分析最多约 200 秒的翻译预算，覆盖 400 条上限。
- B：1 次。
  - 后果：花费减半；条目多（> 250 条左右）的分析常会落到兜底按钮。
- C：3 次。
  - 后果：多一次兜底前的自动机会，大多数情况用不到。

**G5 最新一条未完成时，询价、自动起草、提交清单、投标草稿取哪一份**

这几处都取「等待审核 / 已批准」里最新的一条（`tender-rfq/service.ts:418-428`、`auto-draft-service.ts:71-80`、`tender-submission-checklist/service.ts:24`、`:42`、`tender-bid-draft/gather.ts:80-84`）。网页「下一步」只在最新一条是旧管线的「分析失败」或「已由新分析替代」时退回更早那份（`tender-next-step/service.ts:97-99`），对「AI 分析未完成」已经用最新一条。

- A（推荐）：本次不改，另开 change 统一口径。
  - 后果：在重新分析完成之前，「标书与报价」上的询价仍按更早那份已确认的行出单，页面上已看不到那份。
- B：本次一起改成「最新一条且已完成，否则不出」。
  - 后果：口径全站一致；但询价、自动起草的条件与它们的规格要一起改，tasks 超过 8 条，要拆。

**G6 FIX-16 合并后，矩阵的「可能不全」要不要也看「已纳入的文件里有内容段没读完」**

- A（推荐）：要，由 FIX-16 在它的 change 里加一条。
  - 后果：分析已完成、但有内容段没读完时，矩阵也写「以下可能不全」，并指向那一块说明。
  - 本次不做：今天没有可以确定地读出「哪段没读完」的记录，FIX-16 才开始记。
- B：不要，「未完成」只看状态。
  - 后果：分析完成但漏读了几段时，矩阵不提醒。

**G7 合并顺序**

FIX-13 → FIX-18 → FIX-22 → FIX-16，FIX-20 不限（理由见「相邻 change 与合并顺序」）。要改顺序时，需要同步改的是本 change 的 rebase 前提与 FIX-16 的规格措辞。

**G8 第 7 条的例外要不要写进 `openspec/config.yaml`**

- A（推荐）：要，在第 7 条 KPI-2 例外之后加一句，写明「招标分析中文补翻的自动触发：每次分析至多 2 次，只用既有补翻调用」。
  - 后果：以后的 change 读硬纪律时就能看到这条；改 config 由 Evan 动手（CLAUDE.md §3）。
- B：只登记在本 change 的四件套与报告里。
  - 后果：例外只在归档的 design 里查得到。

## 附录：生产核对 SQL（只读）

表名列名照 `prisma/schema.prisma`：没有 `@@map`，一律双引号。`summaryJson` 是 `jsonb`。先用 0 找到项目 id，再把下面的 `'<projectId>'`、`'<runId>'` 换成实际值。

```sql
-- 0. 找 12-3 项目
SELECT "id", "name", "orgId" FROM "Project" WHERE "name" LIKE '12-3%';

-- A. 这个项目的全部分析：状态、来源、要求条数、强制条数、五态条数、有没有「项目解读」
SELECT r."id", r."status", r."analysisVersion", r."createdAt", r."completedAt", r."failedAt", r."errorCode",
       (SELECT count(*) FROM "TenderExtractedRequirement" q WHERE q."analysisRunId" = r."id")                   AS req_total,
       (SELECT count(*) FROM "TenderExtractedRequirement" q WHERE q."analysisRunId" = r."id" AND q."mandatory") AS req_mandatory,
       (SELECT count(*) FROM jsonb_object_keys(
          CASE WHEN jsonb_typeof(r."summaryJson"->'bidFitMatrix') = 'object'
               THEN r."summaryJson"->'bidFitMatrix' ELSE '{}'::jsonb END))                                      AS fit_marked,
       (r."summaryJson"->'analystSynthesis') IS NOT NULL                                                        AS has_analyst
FROM "TenderAnalysisRun" r
WHERE r."projectId" = '<projectId>'
ORDER BY r."createdAt" DESC;

-- B. 两处各按自己的口径取哪一条（预期：panel 是 54 条那份，matrix 是 73 条那份）
(SELECT 'panel' AS reader, r."id", r."status", r."createdAt"
   FROM "TenderAnalysisRun" r JOIN "Project" p ON p."id" = r."projectId"
  WHERE r."projectId" = '<projectId>' AND r."orgId" = p."orgId"
  ORDER BY r."createdAt" DESC LIMIT 1)
UNION ALL
(SELECT 'matrix', r."id", r."status", r."createdAt"
   FROM "TenderAnalysisRun" r
  WHERE r."projectId" = '<projectId>' AND r."status" IN ('REVIEW_REQUIRED', 'APPROVED')
  ORDER BY r."createdAt" DESC LIMIT 1);

-- C. 某一份分析上「审阅状态 × 有没有五态」的组合（D8 的四种显示各几条）
SELECT q."reviewStatus",
       (r."summaryJson"->'bidFitMatrix'->q."id") IS NOT NULL AS has_fit,
       count(*)
FROM "TenderExtractedRequirement" q
JOIN "TenderAnalysisRun" r ON r."id" = q."analysisRunId"
WHERE r."id" = '<runId>'
GROUP BY 1, 2
ORDER BY 1, 2;

-- D. 某一份分析上还是英文的译文（近似：与原文相同，或一个汉字都没有；精确判定是汉字占比 < 15%）
SELECT count(*) FILTER (WHERE q."chineseTranslation" = q."originalRequirement") AS same_as_original,
       count(*) FILTER (WHERE q."chineseTranslation" !~ '[一-鿿]')               AS no_cjk,
       count(*)                                                                  AS total
FROM "TenderExtractedRequirement" q
WHERE q."analysisRunId" = '<runId>';

SELECT count(*) FILTER (WHERE f."contentZh" !~ '[一-鿿]') AS fact_no_cjk, count(*) AS fact_total
FROM "TenderAnalysisFact" f
WHERE f."runId" = '<runId>';

-- E. 全库：合并后页面会换一份分析的项目（最新一条未完成；has_older_usable = 今天矩阵读的是更早那份）
WITH latest AS (
  SELECT DISTINCT ON ("projectId") "projectId", "id", "status", "createdAt"
  FROM "TenderAnalysisRun"
  ORDER BY "projectId", "createdAt" DESC
), usable AS (
  SELECT DISTINCT ON ("projectId") "projectId", "id"
  FROM "TenderAnalysisRun"
  WHERE "status" IN ('REVIEW_REQUIRED', 'APPROVED')
  ORDER BY "projectId", "createdAt" DESC
)
SELECT l."projectId", p."name", l."status" AS latest_status, l."createdAt",
       u."id" IS NOT NULL AS has_older_usable
FROM latest l
JOIN "Project" p ON p."id" = l."projectId"
LEFT JOIN usable u ON u."projectId" = l."projectId"
WHERE l."status" NOT IN ('REVIEW_REQUIRED', 'APPROVED')
ORDER BY l."createdAt" DESC;

-- F. 全库：页面分析已完成的项目里，「已标未确认」「驳回却有五态」「确认却没五态」各几条
WITH latest AS (
  SELECT DISTINCT ON ("projectId") "projectId", "id", "status", "summaryJson"
  FROM "TenderAnalysisRun"
  ORDER BY "projectId", "createdAt" DESC
)
SELECT l."projectId", l."status",
       count(*) FILTER (WHERE q."reviewStatus" = 'AI_EXTRACTED' AND (l."summaryJson"->'bidFitMatrix'->q."id") IS NOT NULL) AS marked_pending,
       count(*) FILTER (WHERE q."reviewStatus" = 'REJECTED'     AND (l."summaryJson"->'bidFitMatrix'->q."id") IS NOT NULL) AS rejected_with_fit,
       count(*) FILTER (WHERE q."reviewStatus" = 'CONFIRMED'    AND (l."summaryJson"->'bidFitMatrix'->q."id") IS NULL)     AS confirmed_without_fit
FROM latest l
JOIN "TenderExtractedRequirement" q ON q."analysisRunId" = l."id"
WHERE l."status" IN ('REVIEW_REQUIRED', 'APPROVED')
GROUP BY 1, 2
ORDER BY 3 DESC;

-- G. 全库：页面分析上由合规记忆带入的五态条数（停掉自动带入的影响面）
WITH latest AS (
  SELECT DISTINCT ON ("projectId") "projectId", "id", "summaryJson"
  FROM "TenderAnalysisRun"
  ORDER BY "projectId", "createdAt" DESC
)
SELECT l."projectId",
       count(*) FILTER (WHERE m.value->'provenance'->>'via' = 'memory') AS memory_marks,
       count(*) FILTER (WHERE m.value->'provenance'->>'kind' = 'exact') AS exact_marks,
       count(*)                                                         AS all_marks
FROM latest l,
     jsonb_each(CASE WHEN jsonb_typeof(l."summaryJson"->'bidFitMatrix') = 'object'
                     THEN l."summaryJson"->'bidFitMatrix' ELSE '{}'::jsonb END) m
GROUP BY 1
HAVING count(*) FILTER (WHERE m.value->'provenance'->>'via' = 'memory') > 0
ORDER BY 2 DESC;
```
