# Design：招标分析「没做完的地方」用白话说清楚

## Context

动机见 proposal.md「Why」与「已核对的现状」。本稿由两份独立初稿合并：初稿 A（本目录原稿，能力 `tender/analysis-incomplete-notes`）与初稿 B（`tender-degraded-result-notice`，能力 `tender/analysis-degradation-notice`）。两稿说法不一的事实都回到代码核对，设计上的分歧在下面各条 Decision 里择一、另一种写进「否决」。

FIX-12 让四种情况从「整个分析被硬杀」变成「能走到落库」，它们各自留下的数据与文字是这样的（行号为本工作树）：

| 情况 | 发生在哪 | 今天存了什么 | 今天怎么说 |
|---|---|---|---|
| 一段内容尝试 3 次都没读成 | `v2-resumable.ts:219–223` 记 `attempts` 与 `lastErrorCode`（只有最后一次的原因），`exhaustedWindows`（`:416–428`）交给结果组装 | 检查点 `windows.failures`（`v2-cursor.ts:56`）；落库的局限说明一句（`analyzer.ts:292–297`，带错误码与「窗口」） | 不说。局限说明没有任何页面、通知、Muse 消息读它（`grep -rn "limitations" src/app src/components` 零命中）；已存的那句只作为输入交给 AI 写解读（`tender-analyst/context.ts:165`，每条截到 200 字） |
| 中文综合解读两次没写出来 | `v2-resumable.ts:268–272` 直接进落库 | 只在检查点 `analyst.passAErrorCode / passAAttempts`（`v2-cursor.ts:64–65`）；摘要 JSON 里没有痕迹 | 面板退回旧分栏、不说（`analysis-panel.tsx:238–239`）；通知写「可以开始确认招标要求」、优先级 medium（`alerts.ts:163–165`、`:219`、`:229`）；Muse 写一句干净的「分析完成」（`muse-bridge/hooks.ts:61`、`events-pure.ts:62`） |
| AI 复核没有结果 | `synthesize.ts:164–172` | `qa.needsHumanReview = true`；状态先记 `SKIPPED`（`:167`）再被 `:186` 一律盖成 `NEEDS_HUMAN_REVIEW`；`qa.issues[0]` 一句带英文码的内部说明 | 「部分结论未通过 AI 质检…」（`analyst-synthesis-view.tsx:573–577`），与真的没通过同一句；通知与 Muse 同理 |
| 澄清核对调用失败 | `clarify.ts:199–202` 返回 `null` 与错误码；`v2-resumable.ts:254` 只存 `null` | 检查点 `clarify.resolutions[键] = null`；错误码丢弃 | 照常出澄清问题，无标注（`analysis-panel.tsx:971–988`、`analyst-synthesis-view.tsx:680–716`） |

与实现有关的事实（两稿说法不一的几处，以这里为准）：

- **内容段的文件名与页码拿得到**：内容段对象自带文件名、每页页码与单元标签（`tender-understanding/manifest.ts:56–68`），落库时切片推进器手里就有全部内容段（`v2-resumable.ts:136`）。相邻两段重叠 1 页（`manifest.ts:79`）。
- **哪几条澄清问题没核对成，今天就算得出**：`null` 有两个来源——找不到相关页所以没问模型（`clarify.ts:175–177`），或问了但调用失败（`:199–202`）。找相关页是纯函数（`clarify.ts:54–86`、`:143–159`），落库时本来就要重算一遍工作单（`v2-resumable.ts:435`）：有相关页而结果为 `null` 的就是没核对成。核对成了但结论是「没有答案」时存的是对象。算不出来的只有「为什么没成」（错误码已丢）。初稿 A 说这三种「今天没有任何已存的数据能分开」不准确；初稿 B 说「来自检查点里已有的记录」对了一半（没说要排除找不到相关页的）。
- **复核状态这个值没有任何读者**：`grep -rnE "qa\??\.status" src` 只命中测试（`analyst-synthesis.test.ts:414`）。所有读者读的都是 `needsHumanReview`（横幅、`alerts.ts:219/229/238`、`muse-bridge/hooks.ts:61`）。既有测试 RESUME-09 的说明里写明复核缺席时状态是 `NEEDS_HUMAN_REVIEW`（`v2-resumable.test.ts:14`）。
- **记录只能在切片推进器里组装**：结果映射（`v2-map.ts` 的 `mapV2Result`）只拿得到分析结果，拿不到检查点里的尝试次数与错误码；初稿 B 把它放在 `v2-map.ts` 做不到。
- **两条入口共用落库与通知**：一键分析的 `advanceV2ForWorkforce` 与旧管线的 `advanceAndPersistV2` 都经 `advanceV2Analysis` 的 `buildInference`（`v2-resumable.ts:471–516`）得到 `mapped.summaryJson`，再经同一个 `persistV2CanonicalTx` 写入（`v2-persist-core.ts:233–240`）；之后写 `summaryJson` 的地方都是在原对象上并键。workforce 的收尾在 V2 模式下不碰 `summaryJson`（`analysis-run-service.ts:323–343`）。通知与 Muse 挂钩见 proposal「Impact」。
- **Muse 第一行有 60 字上限**：`advisory.ts:21`（`CONCLUSION_MAX`），超了会被截成「…」；项目名先截到 20 字（`events-pure.ts:26`）。整条摘要过出站脱敏（`events-pure.ts:19`），命中 `contract.ts:353–362` 的字样（毛利、margin、预算上限等）就整段替换成脱敏提示。Muse 只拉自己类别的通知（`events.ts:149`），站内完成通知不会流进 Muse。
- 初稿 B 提到的能力 `tender/analysis-package-coverage` 在 `openspec/` 里不存在；它把时序类后续工作称为「FIX-16」，与本 change 的编号冲突——本稿凡提到那些工作都按内容指称，不用编号。

## Goals / Non-Goals

**Goals:**
- 四种情况各有一份落库的、结构化的记录；面板、通知、Muse 只凭它选句子，三处说的是同一批事项。
- 每一句都是固定模板，能用纯函数测试逐字断言。
- 没有记录的旧分析一个字都不变。
- 重测后要改措辞时只改查表模块，不用重跑任何分析。

**Non-Goals（不动的模块 / 文件）:**
- `src/lib/tender-auto-analysis/v2-cursor.ts`：整个文件不改（检查点的结构、版本、指纹、`MAX_WINDOW_ATTEMPTS`、`MAX_ANALYST_ATTEMPTS`、`V2_PHASE_MIN_MS`、`PHASE_SAFETY_MS`、`canStartPhase`、`callTimeoutFor`）。
- `src/lib/tender-auto-analysis/v2-resumable.ts` 的阶段推进、让出条件、`CALL_DEADLINE_YIELD_REASON`、没核对成的澄清问题「键已存在就不再重查」：不改。
- `src/lib/ai/model-policy/**`、`src/lib/tender-understanding/llm.ts`：不改。
- `src/lib/tender-analyst/**`（`synthesize.ts`、`contract.ts`、`prompts.ts`、`validate.ts`、`hydrate.ts`、`context.ts`）：不改（`qa.issues` 的内部说明、`qa.status` 的取值、`needsHumanReview`、提示词与版本号都不动）。
- `src/lib/tender-understanding/analyzer.ts` 里局限说明的其它三句（证据验证拒收、近乎无文本的页、回退模型）与 `package-input.ts` 的文件包不完整说明：不改。
- `src/lib/tender-auto-analysis/v2-map.ts`、`v2-persist-core.ts`、`v2-persist.ts`、`package-coverage.ts`、`src/lib/tender-workforce/v2-persist-workforce.ts`、`v2-resumable-workforce.ts`、`analysis-run-service.ts`、`tools.ts`：不改（记录随 `mapped.summaryJson` 走既有的写入路径）。
- `src/lib/muse-bridge/**` 里除 `events-pure.ts`（`analysis.ready` 第一行）与 `hooks.ts`（读记录）之外的全部文件：不改——`router*.ts`、`next-step.ts`、`advisory.ts`、`contract.ts`、`events.ts`（含站内镜像通知的标题）都不动。
- `src/app/api/projects/[id]/questions/route.ts`、`src/lib/projects/generate/**`、`src/lib/tender-bid-draft/**`、`src/lib/tender-auto-analysis/chat-context.ts`、`executive-brief.ts`：不改。
- `src/components/tender-analysis/agent-card.tsx`、`analysis-progress-banner.tsx`、`bid-fit-matrix-card.tsx`、`src/components/bid-workflow/project-intel-sections.tsx`：不改。
- 「批准分析」的权限与流程（审批接口、要求批量确认）：不改，不加拦截。
- `prisma/**`、`vercel.json`、`openspec/specs/**`：不改。

## Decisions

### D1 记录放在分析记录的摘要 JSON 里一个新键，只在有事可记时写

落库前由纯函数从检查点、内容段清单与澄清工作单组装出「未完成记录」，放进 `mapped.summaryJson.incompleteSteps`：

```
incompleteSteps: {
  v: 1,
  unreadSections: [{ documentName, fromPage, toPage, fromLabel, toLabel, cause }],   // cause: "TIME" | "ERROR"
  synthesis: { cause, attempts } | null,
  review: { cause, attempts } | null,
  uncheckedQuestions: [{ clarificationId, question }]
}
```

四项都空就不加这个键。前三项的 `cause` 只有一条判定：最后一次失败的错误码等于 `CALL_DEADLINE_EXCEEDED` → `TIME`，否则 `ERROR`（数据来源：`windows.failures[*].lastErrorCode`、`analyst.passAErrorCode`、`analyst.passBErrorCode`）。两个列表不封顶：一份文件包的内容段是几十到一百来个，每条一百来字节，全部没读完也只有十几 KB；封顶会让句子里的段数与实际不符。

- 否决：界面 / 接口直接读 `workerCursor`。它是续跑的内部状态，装着每个内容段的模型输出，指纹或版本一变就整体判废（`v2-cursor.ts:129–139`）；把它当展示数据的事实源，等于给检查点加了一个不能动的对外契约。
- 否决：解析已存的字符串（`qa.issues[0]`、局限说明）里的英文码来判断。靠文案子串做判断，文案一改就错；「旧分析显示不变」也要求不这么做。
- 否决：新增表或字段。硬纪律 1。
- 否决：没有事可记时也写一个空记录。会让每一份正常分析的 `summaryJson` 都变，既有的「分片跑 == 单次跑」逐字段断言要跟着改，没有收益。
- 否决（初稿 B）：在结果映射（`v2-map.ts`）里组装。它拿不到检查点（见 Context）。
- 否决（初稿 B）：澄清问题只记条数。标不到具体哪一条，「每条问题下面一行标注」做不出来。

### D2 存结构化数据，读取时查表出句子

记录里只有文件名、页码、次数、原因枚举、问题编号与全文；句子由 `src/lib/tender-understanding/incomplete-notes.ts` 的纯函数在读取时（接口、通知、Muse、局限说明组装）生成。两份初稿在这一点上一致。

- 否决：落库时把中文句子写进 JSON。「待重测后确认 / 待拍板」里的措辞一旦要改，已存的分析就改不了，只能重跑。
- 局限说明是个例外：它本身就是一组落库的字符串（`AnalysisResultV2.limitations`），那一句在组装时用同一个模板生成并照旧存成字符串。它不显示在界面上，只作 AI 写解读的输入，存成句子不影响以后改界面措辞。

### D3 句子不说原因，原因只存不显示

全部句子对「时间不够」与「出错」用同一种说法：「没能读完」「试了 n 次，没能写出来」「没有做完」「没能核对」。原因照 D1 存进记录。

- 否决（初稿 A）：每种情况按原因写两句（「没能在规定时间内读完」/「读取时出错」）。系统只存最后一次失败的原因，说不了「每次都超时」；「出错」指的是模型一侧的错误，放在「读取」后面容易被读成文件坏了；人要做的事完全相同（翻原文 / 人工核对）；句子数量翻倍。原因已在记录里，重测后要分开说时只改查表模块（「待重测后确认 / 待拍板」第 3 条）。
- 否决（初稿 B）：「模型两次都没在时限内完成」。出错时这句不属实；「模型」「时限」是内部说法；「两次」写死了次数。
- 否决（初稿 B）：「有 N 段页面 AI 没有读完…请人工看一遍或重新分析」。表格类文件没有「页面」；「重新分析」是整份重做、同样慢时会再跳过一次，是否提示留给第 7 条。
- 否决：把 `TRANSIENT_MODEL_ERROR`、`INVALID_STRUCTURED_OUTPUT`、`EMPTY_OUTPUT`、`ANALYST_EXCEPTION:*` 各写一句。只是把内部错误码换个说法再露出来。
- 否决：给检查点加逐次失败历史。要改检查点结构，换来的只是把「最后一次」改成「每一次」，而句子并不说原因。

### D4 没核对成的澄清问题在落库时由既有数据算出，检查点一个字段都不加

判定：这条澄清问题在工作单里有相关页，而检查点里它的结果是 `null`。`assembleClarifications` 多交回一张「澄清问题编号 → 工作单条目」的表（纯函数的附加返回值，既有两个字段不变），组装记录时据此得出 `CL-00n` 与问题全文。

- 否决（初稿 A）：给检查点的 `clarify` 加可选字段 `checkErrors` 记错误码。它带来的只有「原因」，而 D3 决定句子不说原因；代价是动了续跑引擎的状态与解析（`v2-cursor.ts:129–193` 逐字段重建，漏一处就丢），并且上线前已经失败的核对没有标注。由既有数据算出则不动检查点，上线时正在跑的分析也照样有标注。
- 否决：`V2_CURSOR_VERSION` 加 1。上线那一刻正在跑的分析检查点会全部判废、从头重跑，烧掉已经花的模型调用。
- 否决：从调用日志（`cursor.logs`）反推。发之前就被拒的调用不记日志（FIX-12），日志也不带是哪一条问题。
- 否决：把 `resolutions[键]` 的 `null` 改成带原因的对象。会改 `assembleClarifications` 的判定输入与既有测试的夹具，属于动分析行为的风险面。
- 否决（初稿 B）：只按 `null` 计数。会把「找不到相关页、根本没问」的也算进去。

### D5 标注不写进问题或理由文字，按编号与问题全文匹配

落库的澄清问题行（`TenderClarificationQuestion.question / reason`）一个字不变。接口用记录里的问题全文匹配行的 `question`，得出每条的 `answerCheckNote`；「项目解读」的澄清分栏用综合解读里每条问题引用的 `clarificationIds` 匹配记录里的编号。

- 否决：把标注拼进 `reason`。`reason` 会进 AI 写解读的输入（`tender-analyst/context.ts`）、一键分析的结果摘要（`tender-workforce/tools.ts:1198–1207`），综合解读的问题又进 RFI 导出与询问邮件草稿——一句内部说明会出现在发给采购方的文件里；存成文字后也改不了措辞。
- 否决：按落库顺序 / 创建时间对应。这些行在同一个落库事务里逐条创建，`createdAt` 可能彼此相同，接口按 `createdAt` 排序（`runs/[runId]/route.ts:50`）的先后不保证等于组装顺序；落库的行也没有 `CL-00n` 这一列（`v2-map.ts:227–233`）。
- 已知边界：澄清问题没有编辑入口，问题全文落库后不变；两条问题全文完全相同时两条都会带标注（去重规则下极少，后果只是多一条提醒）。

### D6 局限说明那一句在源头改写，单次编排与分片续跑共用

`assembleAnalysisResult` 的 `failedWindows` 每一项多带位置（文件名、起止页、起止单元标签），两个调用方（`analyzeTender`、`advanceV2Analysis` 的 `exhaustedWindows`）手里都有内容段对象，直接带上。句子用 D2 的同一个模板。单次编排里一段内容只试 1 次，所以这一句不写「试了 3 次」。两份初稿方向一致。

- 否决：只在界面上显示新句子，局限说明保持原样。英文码与「窗口」会继续作为输入交给 AI 写解读，可能被抄进中文正文（FIX-12 报告 §5 记过）；那是模型生成的文字，界面拦不住。
- 否决：从局限说明里去掉这一句。模型就不知道有内容缺失，可能把没读到的当成「文件没有这项要求」。
- 否决：为此把 AI 解读的提示词版本加 1。提示词模板没变，只是输入里一条局限说明换了写法；版本进指纹，加 1 会让在跑的检查点全部作废。
- 既有断言 `v2-resumable.test.ts` RESUME-05 / RESUME-06 认的是旧句子里的「窗口 LLM 抽取失败」（`:473`、`:497`），同一个 task 里改成认新句子。

### D7 句子由接口算好下发，组件只渲染字符串

分析详情接口读 `summaryJson.incompleteSteps`（宽进严出：形状不对当作没有），调用查表函数得到 `incompleteNotes = { panel, review, questions }` 与每条澄清问题的 `answerCheckNote`，组件不含这些句子的任何文字。

- 否决（初稿 B）：接口把记录原样下发、组件里出句子。句子会分散在服务端（通知、Muse、局限说明）与客户端两处；纯函数测试覆盖不到组件里的分支；记录里的原因与问题全文也不该整包给界面。
- 否决：新开一个接口。面板已经在加载这一个接口，多一次请求没有必要。

### D8 面板顶部把每一项都列出来；该不该说由一个判定函数决定

顶部提示块按固定顺序列出全部「要说的事项」：内容没读完、没有中文综合解读、AI 复核没做完、澄清问题没核对（规格「面板、通知与 Muse 用同一套判定」）。第 2、3 项只在该组织开着综合解读界面时算数（没有中文综合解读：这份分析确实没有；复核没做完：这份分析确实有）。提示块只在面板带运行头部的那一处渲染（`showRunControls`），提交分栏等次要挂载点不重复。提示用提醒色，「批准分析」按钮不变。

- 否决（初稿 A）：顶部只放「内容没读完」与「没有中文综合解读」，复核只在「项目解读」页最下面的横幅说、澄清只在每条问题下面说。横幅在页面最底，A 自己也问过够不够显眼；通知与 Muse 要指给人一个地方看，分散三处就指不了。底部横幅照样要换句子（不换就继续说「未通过」），所以复核那一句顶部与底部各出现一次。
- 否决：不看开关，一律显示「没有中文综合解读」。没开综合解读界面的组织从来看不到解读，这句话只会让人困惑。
- 否决：有内容没读完时禁用「批准分析」。没读完的可能只是一段附录，影响由人判断；拦截需要另一套确认流程（「待重测后确认 / 待拍板」第 8 条）。

### D9 复核没做完靠记录里的标记区分，已存的复核状态不动

横幅在记录里有 `review`（且该说，见 D8）时换句子；`qa.status`、`qa.needsHumanReview`、`qa.issues` 与今天存的完全相同，`src/lib/tender-analyst/**` 零改动。

- 否决（初稿 B）：复核失败时把状态存成既有的 `SKIPPED`「并带上原因类别」，横幅按状态选句子。四条理由：其一，要改 `synthesize.ts:186`，那一行今天的规则是「需人工复核就一律存 `NEEDS_HUMAN_REVIEW`」，既有测试 RESUME-09 认的就是它；其二，`qa` 里没有放原因的字段，「带上原因类别」等于给综合解读的契约加字段——B 否决新增状态值的理由（会动契约）同样适用于它自己；其三，复核失败与「硬校验删掉了条目」会同时发生（`:177`），一个状态值只能说一件事，存成 `SKIPPED` 就盖掉了后者，而「标记 + 标志」两件事各记各的；其四，状态值今天没有任何读者，横幅、通知、Muse 读的都是 `needsHumanReview`——改状态值本身区分不了任何东西，还得另改每一个读者。对旧分析两种做法结果相同（旧数据都是 `NEEDS_HUMAN_REVIEW`，都显示旧横幅），所以差别只在风险面。
- 否决：解析 `qa.issues[0]` 里的「QA reviewer 调用失败」。同 D1 第二条。

### D10 完成通知：把要说的事项列全，按轻重定优先级

`tenderSuccessSummary` 多一个可选输入（要说的事项的短语清单），不为空时收尾句是「这次有地方没做完（…），请先看分析页顶部的说明」；`notifyTenderRunSucceeded` 从同一份 `summaryJson` 读记录、用该组织的综合解读界面开关算出清单后传入。有「内容没读完」或「没有中文综合解读」时优先级为高；只有「澄清问题没核对」时按既有规则。清单为空时文字与优先级走既有分支，一个字不变。

- 否决（初稿 A）：只改复核那一句，其余留给重测。没有中文综合解读时 `needsHumanReview` 取不到、按假处理（`alerts.ts:219`），通知写的是「可以开始确认招标要求」、优先级 medium——最该提醒的两种情况（内容没读完、没有解读）通知里看不出来，这正是本 change 要解决的问题之一。
- 否决（初稿 B）：通知只写最重的一项。站内通知的摘要没有长度上限，四个短语加起来三十来个字，列全比让人猜「还有没有别的」更省事。
- 否决（初稿 B）：只要有任何一项没做完就标高。FIX-12 之后切片末尾的澄清核对被截住是常事（开工门槛 30 秒、键已存在不再重查），每次都标高会让高优先级不再有分量；每条问题下面已有标注（「待重测后确认 / 待拍板」第 4 条）。
- 否决：通知里列文件名与页码。通知摘要是一行字；页码清单在面板顶部。

### D11 Muse 的 `analysis.ready` 这次一起改，只改第一行，只点最要紧的一项

`AnalysisReadyFacts` 多一个可选项（最要紧那一项的短语，由 `hooks.ts` 用与通知相同的判定算出）；有值时第一行是「「项目名」分析完成，但{短语}，先到青砚看分析页顶部的说明」，没有值时走既有分支。第二行、按钮、事件编号、收件人不变。

- 否决（初稿 A）：Muse 不动。它的理由是「分析完成，有地方要你复核」在复核没做完时仍然成立——这只覆盖了复核一种情况；没有中文综合解读时 `needsHumanReview` 为假（`hooks.ts:61`），Muse 发出的是一句干净的「分析完成」，有内容没读完时也一样。站内通知改了而 Muse 不改，同一个人会在两个地方看到相反的说法。是否拆到后续 change 仍留给 Evan（「待重测后确认 / 待拍板」第 2 条）；为此 Muse 单独占一条 task、一条 Requirement，删掉它们不影响其余部分。
- 否决（初稿 B 的规格）：有地方没做完时「不使用『分析完成』这种写法」。分析确实完成了、可以开始审核；B 自己举的例句也是「分析完成，但…」。本稿禁的是单独一句「分析完成」。
- 否决：第一行把事项列全。三项加项目名会超过 60 字上限，被截成「…」，末尾的「去哪里看」先丢。
- 否决：把事项清单放到第二行。第二行今天是数量与「已分析 a/b 个文件」，事件摘要的约定是「结论 + 1 条理由」（`advisory.test.ts:168`）；换掉它就丢了覆盖率。
- 否决：Muse 消息里带文件名或页码。文件名是 Muse 通道今天没有的一类数据；文件名里一旦带「毛利」「margin」「预算上限」这类字样，整条消息会被替换成脱敏提示（`contract.ts:353–374`），用户连「分析完成」都收不到。

### D12 覆盖说明与「文件文件」不放进本次

初稿 B 要在分析面板显示既有的覆盖说明并改掉重复用字。两处都核对属实（proposal「已核对的现状」第 6 行），但本次不做。

- 否决（初稿 B）：一并做。覆盖说明讲的是「哪些文件没进这次分析」（上传了新文件还没重新分析、格式不支持），不是「这次分析哪一步没做完」——数据来源（`package-coverage.ts`，不是未完成记录）、触发条件、读者要做的事都不同；说明本身也不完整（有排除文件时不提「可分析但未纳入」，`package-coverage.ts:110–118`），只显示它会把这个缺口带到面板上；重复用字出在情报页的文字上，与本能力的任何一条要求无关。B 引用的 `tender/analysis-package-coverage` 能力并不存在，放进来就得在本能力里另写覆盖显示的要求。另开小 change（「待重测后确认 / 待拍板」第 11 条）。

## 与八条硬纪律的关系

1. 零 schema：遵守——记录写在 `TenderAnalysisRun.summaryJson`（既有 JSON 位）；不加模型、字段、迁移；续跑检查点 `workerCursor` 的结构也不动。验收用 `git diff origin/main -- prisma/` 为空。
2. 出站先审批：不涉及——没有新增任何发送。改的是两条既有系统消息的文字：发给本组织成员的站内完成通知，与既有的 Muse `analysis.ready` 事件（不是 Muse 消息里的动作；按钮仍是既有的 `next_step` 查询）。收件人、触发条件、幂等键都不变。D5 保证标注不进入发给采购方的 RFI 与邮件草稿。
3. 禁止第三套队列：不涉及——不新增 scheduler / queue / lease / worker；只在既有切片推进器落库前多算一个对象。
4. 脱敏：触碰 Muse 通道，遵守——`analysis.ready` 第一行新增的内容只有固定用词与一个条数，项目名照旧；文件名、页码、单元标签、澄清问题文字、错误码都不进 Muse（D11），毛利率、项目估值、我方最终报价不在任何输入里；整条摘要照旧过既有的出站脱敏、命中即整段替换。规格有对应的 SHALL NOT 与场景「没读完的文件名带敏感字样」。Muse 的查询与动作意图一个都不改（proposal 已列明）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守——不新增模型调用（规格场景「不增加模型调用」用既有两个测试守住）；全部句子是固定模板查表，「说哪几项」「Muse 点哪一项」「优先级」都是固定顺序与条件；模型读到的输入只变了一条局限说明的写法，提示词与版本号不变。
8. 测试注册：两个新测试 `src/lib/tender-understanding/__tests__/incomplete-notes.test.ts`、`src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 在创建它们的 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts`：规格里每一句的逐字断言（面板四句、横幅、澄清标注、通知收尾句、Muse 第一行、四个短语）；位置写法（单页、页码范围、单元标签、超过 6 段）；两种原因得到相同的句子；「要说的事项」随综合解读界面开关与是否有综合解读的变化；记录缺失 / 形状不对 → `null`；旧分析（只有带英文码的 `qa.issues`）→ `null`；句子不含内部用词与错误码；源码断言——两个组件渲染接口下发的 `incompleteNotes` / `answerCheckNote`、自身不含这些句子的文字，分析详情接口不下发 `incompleteSteps` 原文。
- `npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts`：从构造的检查点组装记录（内容段尝试用尽 × 两种原因、综合解读没生成、复核没结果、澄清问题三种情况——找不到相关页 / 核对成了结论为没有答案 / 有相关页而结果为空、四项皆空返回空）；上线前写的检查点照常解析并得到同样的记录；落库的澄清问题 `question / reason` 与不记录时逐字相同。
- `npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts`：RESUME-05 / RESUME-06 认新句子且局限说明不含「窗口」与错误码；无事可记时 `summaryJson` 没有 `incompleteSteps`；补两个从头跑到落库的用例（综合解读两次失败、复核两次失败，用既有脚本化模型的 `failAnalyst` / `failAnalystQa`）断言记录里有对应项；RESUME-09 与既有 parity 断言不变。
- `npx tsx src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts`：照旧 43 / 43，一条断言都不改（分析行为没变）。
- `npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts`：规格五个通知场景的摘要与优先级；既有 ALERT-09 / ALERT-10 不变。
- `npx tsx src/lib/muse-bridge/__tests__/advisory.test.ts`：`analysis.ready` 有地方没做完时的第一行（逐字、不超过 60 字、项目名超长与三位数条数不被截断、仍是「结论 + 1 条理由」、按钮仍是 `next_step`）；没有时第一行与今天相同；`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` 照旧通过。
- `npx tsx src/lib/tender-analyst/__tests__/analyst-synthesis.test.ts`、`src/lib/tender-understanding/__tests__/input-completeness.test.ts`、`addendum-disposition.test.ts`：照旧通过。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run test:ci`（CI 环境变量）、`npm test`（对照 `docs/QINGYAN_CHAIN-3_REPORT.md` §4 的既有失败清单）、`openspec validate tender-analysis-incomplete-notes --strict`；`git diff origin/main -- prisma/ vercel.json openspec/specs src/lib/tender-auto-analysis/v2-cursor.ts src/lib/tender-analyst` 为空；`git diff --stat origin/main -- src/lib/muse-bridge` 只有 `events-pure.ts`、`hooks.ts` 与 `__tests__/advisory.test.ts`。
- 人工：本地用构造的 `summaryJson`（四种情况各一份）打开项目页，截图面板顶部提示、复核横幅、两处澄清标注，贴进报告。

## Risks / Trade-offs

- [上线前已落库的分析没有记录，仍显示旧文案] → 规格明确「没有记录的分析显示不变」；这些分析重新分析一次即可得到记录。
- [句子不说原因] → 原因存在记录里；要分开说时只改查表模块（D3，「待重测后确认 / 待拍板」第 3 条）。
- [相邻内容段有 1 页重叠，提示的页码范围会含 1 页已被前一段读过的页] → 提示是让人去翻原文，多翻 1 页无害；第 6 条。
- [局限说明交给 AI 写解读时每条截到 200 字（`tender-analyst/context.ts:165`），没读完的段多时句尾会被截掉] → 这只是模型的输入，开头的「有 N 段内容 AI 没能读完，没有纳入这份分析」总在；界面上的句子不经过这个截断。
- [AI 写解读读到的局限说明换了写法，解读正文会略有不同] → 模板与版本不变、调用次数不变；换写法的目的正是不让英文码被抄进正文。
- [按问题全文匹配旧视图里的澄清问题] → 见 D5 的已知边界。
- [Muse 第一行只点一项，其余事项在 Muse 里看不到] → 句尾指向分析页顶部，那里列全；站内通知也列全（D10、D11）。
- [只有澄清问题没核对时，通知不再说「可以开始确认招标要求」] → 换成的收尾句指向顶部说明，优先级不升（D10）。
- [记录让 `summaryJson` 变大] → 每条一百来字节（澄清问题一条带问题全文，几百字节），只在有事可记时写；内容段全部没读完的分析本来就会被判为空分析而失败，不会落库。
- [真的「未通过 AI 质检」时横幅仍写「详见 QA 记录 N 条」而记录无处可看] → 既有问题，本次不动；第 9 条。

## Migration Plan

无数据迁移、无开关。合并部署即生效：此后落库的分析在有事可记时带记录（包括上线时正在跑的分析）；此前的分析显示不变。回滚 = 回退本 PR（已写入的 `incompleteSteps` 键会被旧代码忽略，无需清理）。
