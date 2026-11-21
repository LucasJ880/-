# Proposal：招标分析「没做完的地方」用白话说清楚（FIX-16）

TASKFLOW：FIX-16（Phase F（续）— 生产实测修复）

> 范围待定：这份四件套供审核，不实现。等 FIX-12 上线、Evan 在生产重测之后，按「待重测后确认 / 待拍板」的结论裁剪范围再开工。本稿由两份独立初稿合并而成，每一处分歧都回到代码核对过，取舍写在 design.md 各条 Decision 的「否决」里。

受影响的 Muse 意图：无——`status` / `ask` / `rfq` / `compare` / `chase` / `price_scenario` / `next_step` 等查询与动作意图都不改。受影响的 Muse 事件：只有 `analysis.ready`（分析完成的推送）摘要的第一行；它的第二行（数量）、按钮（`next_step`）、事件编号、收件人、站内镜像通知的标题都不变。

## Why

FIX-12 之后，文件多、模型慢时分析不再整个失败，而是「做完了，但有几处没做完」：个别内容段没读完、中文综合解读没写出来、AI 复核没做完、个别澄清问题没能核对文件里是否已有答案（`docs/QINGYAN_FIX-12_REPORT.md` §5「使用流畅与文案」、§6、§7 第 2 条）。现在页面要么不说、要么说错（把「复核没做完」说成「未通过 AI 质检」），完成通知与 Muse 的「分析完成」消息和一次完整的分析一模一样，交给 AI 写解读的那句局限说明还带英文错误码 `CALL_DEADLINE_EXCEEDED` 和内部用词「窗口」。

## What Changes

- 记下「哪里没做完」：分析落库时，在分析记录既有的摘要 JSON 里写一份「未完成记录」——没读完的内容段（文件名 + 页码范围 + 原因）、中文综合解读没生成（原因 + 试了几次）、AI 复核没做完（原因 + 试了几次）、没核对成的澄清问题（编号 + 问题全文）；四项都没有时不写任何新内容。全部由落库那一刻已有的数据算出，不改续跑检查点的结构。
- 改写「局限说明」里讲没读完内容的那一句：不再出现英文错误码与「窗口」，改为「有 N 段内容 AI 没能读完，没有纳入这份分析：《文件名》第 a–b 页…。这部分请人工翻看原文。」
- 显示没做完的地方：分析面板顶部逐条列出——没读完的内容段（同上一句）、「这份分析没有中文综合解读：AI 试了 2 次，没能写出来。下面是从文件里逐条摘出的要求和要点，请人工通读后判断。」、复核没做完的那一句、「有 N 条澄清问题，系统没能核对文件里是否已经有答案，已在问题下面标出；发出前请先自己查一遍。」
- 区分「AI 复核没做完」与「未通过 AI 质检」：复核没做完时「项目解读」底部的横幅改为「AI 复核这次没有做完：这份解读只经过第一遍整理，还没有复核过，请人工重点核对。」；真的没通过时横幅原样。已存的复核状态与「需人工复核」标志一个字不改。
- 标注没核对成的澄清问题，每条下面加一行：「系统没能核对文件里是否已经有答案，发出前请先自己查一遍。」（旧视图「澄清问题」与「项目解读 · 澄清」两处）。
- 改写分析完成的站内通知的最后一句：有地方没做完时写「这次有地方没做完（有 2 段内容没读完、没有中文综合解读），请先看分析页顶部的说明」，不再写「可以开始确认招标要求」；有内容没读完或没有中文综合解读时优先级为高。
- 改写 Muse `analysis.ready` 摘要的第一行：有地方没做完时写「「项目名」分析完成，但有 2 段内容没读完，先到青砚看分析页顶部的说明」（只点最要紧的一项，只有项目名、固定用词与条数）；没有没做完的地方时原样。
- 扩充分析详情接口 `GET /api/projects/[id]/tender-analysis/runs/[runId]` 的返回，多两样：`incompleteNotes`（上面这些句子，没有就是 `null`）与每条澄清问题的 `answerCheckNote`（标注句子，没有就是 `null`）。
- 新增两个纯函数测试文件并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`：一个测「按记录选哪句话、页码怎么写、三处说的是同一批事项、旧分析不变」，一个测「落库前记录怎么组装、没有没做完的地方时什么都不写」。

### 已核对的现状（逐条读代码，行号为本工作树）

| 现象 | 结论 | 依据 |
|---|---|---|
| 1 局限说明带英文码与「窗口」 | **文字属实，但没有任何页面、通知或 Muse 消息显示它** | 句子在 `src/lib/tender-understanding/analyzer.ts:292–297` 拼出：「N/M 个窗口 LLM 抽取失败（错误码…），对应页面内容未纳入结果。」；存进 `summaryJson.limitations` 与「综合结论」章节的结构化 JSON（`v2-map.ts:383`、`:322`）。`grep -rn "limitations" src/app src/components` 零命中；`alerts.ts`、`src/lib/muse-bridge/**` 也不读它；分析详情接口只下发摘要里的 4 个字段（`runs/[runId]/route.ts:95–105`），章节序列化丢弃结构化 JSON（`serializers.ts:99–124`）。已存的这句话唯一的读者是 AI 写中文解读时的输入（`tender-analyst/context.ts:165`，每条截到 200 字）；项目聊天技能读的是它自己当场重算的一份（`agent/skills/tender-analysis.ts:78`）。所以英文码只可能被模型「抄」进解读正文；**内容段被跳过这件事，今天用户在界面上看不到任何确定性的提示** |
| 2 没有中文综合解读也没有说明 | **属实** | 综合解读两次没写出来 → 直接进落库阶段（`v2-resumable.ts:268–272`），`summaryJson` 里没有 `analystSynthesis`，面板退回旧的分栏（`analysis-panel.tsx:238–239`），没有任何说明。失败原因只在续跑检查点 `analyst.passAErrorCode / passAAttempts` 里（`v2-cursor.ts:64–65`，只有最后一次的原因） |
| 3 复核没做完却显示「未通过 AI 质检」 | **属实** | 复核没有结果时先记 `SKIPPED`、`needsHumanReview = true`、一条带英文码的内部说明（`tender-analyst/synthesize.ts:164–172`），随后 `:186` 把状态一律存成 `NEEDS_HUMAN_REVIEW`——`SKIPPED` 从未落库。全站没有任何代码读这个状态值（只有测试 `analyst-synthesis.test.ts:414`）；读的都是 `needsHumanReview`：横幅（`analyst-synthesis-view.tsx:573–577`）、通知的文字 / 优先级 / 元数据（`alerts.ts:163–165`、`:219`、`:229`、`:238`）、Muse（`muse-bridge/hooks.ts:61` → `events-pure.ts:62`）。横幅写「详见 QA 记录 N 条」，但全站没有地方显示这些记录 |
| 4 没核对成的澄清问题照样出问题、没有标注 | **属实；哪几条没核对成今天就能算出来，为什么没成算不出来** | 核对失败时结果存成 `null`（`clarify.ts:199–202`、`v2-resumable.ts:254`），错误码只用来决定让出（`:256`）就丢了；键已存在不再重查（`:237–239`）。`null` 也表示「文件里找不到相关页、没问模型」（`clarify.ts:175–177`），但找相关页是纯函数（`clarify.ts:54–86`、`:143–159`），落库时重算一遍就能把这两种分开：有相关页而结果为 `null` = 核对没成。核对成了但结论是「没有答案」时存的是对象，不是 `null` |
| 5 通知与 Muse 和完整的分析一样 | **属实** | 通知最后一句只看 `needsHumanReview`（`alerts.ts:162–166`）；没有中文综合解读时这个标志取不到、按假处理（`:219`），于是写「可以开始确认招标要求」、优先级 medium（`:229`）。Muse 第一行是「「项目」分析完成」，标志为真时加「，有地方要你复核」（`events-pure.ts:62`）；没有中文综合解读、有内容没读完时就是一句干净的「分析完成」 |
| 6 覆盖说明与重复用字 | **属实，不在本次** | `coverage.note` 只在情报页显示（`project-intel-sections.tsx:425`），分析面板的覆盖块不显示（`analysis-panel.tsx:475–499`）；解析失败的说明由 `package-coverage.ts:113` 的「N 个文件」接 `:53` 的「文件解析失败」拼成「N 个文件文件解析失败」（源码里搜不到连着的四个字，是拼出来的）。见「Out of scope」 |

## 待重测后确认 / 待拍板

FIX-12 上线后 Evan 在生产重测。下面每一条都写了选项与本稿的写法；答案会改本提案的范围。

1. 英文码 `CALL_DEADLINE_EXCEEDED` 或「窗口」二字，在页面上是哪一栏看到的？（本次核对的结论是没有任何页面显示局限说明；如果确实看到了，请截图那一栏——要么是 AI 解读正文抄了它，要么有本次没找到的入口。）
2. Muse 的「分析完成」消息这次一起改，还是拆出去？选项 A：一起改（本稿的写法——没有中文综合解读、有内容没读完时 Muse 今天说的是一句干净的「分析完成」，正是最该提醒的时候；改动只有第一行，只含项目名与条数）。选项 B：拆成后续 change `muse-analysis-ready-incomplete-notice`，本次删掉 tasks 3.3 与规格「Muse 的分析完成消息如实说有地方没做完」一条即可，其余不受影响。
3. 句子里要不要说原因（「时间不够」还是「出错」）？选项 A：不说，只说「没能读完 / 没能写出来 / 没有做完」（本稿的写法——系统只存最后一次失败的原因，「出错」又容易被读成文件坏了；人要做的事相同）。选项 B：按原因分两种说法。原因已经存在记录里，以后改句子不用重跑分析。
4. 只有「澄清问题没核对」这一项时，完成通知要不要也标成高优先级？选项 A：不标高，照既有规则（本稿的写法——FIX-12 之后切片末尾的核对被截住是常事，每条问题下面已有标注）。选项 B：只要有任何一项没做完就标高。
5. 顶部提示里「《文件名》第 a–b 页」够不够用，还是需要能点过去看那几页原文？（本稿只写文字。）
6. 相邻两段内容有 1 页重叠（`tender-understanding/manifest.ts:79`）：提示里的页码范围会含 1 页其实已被前一段读过的页。能否接受？（本稿照实写整段的起止页。）
7. 提示里要不要加一句「可以重新分析一次」？选项 A：不加（本稿的写法——重新分析是整份重做，同样的文件同样慢时会再跳过一次）。选项 B：加。
8. 有内容没读完时，「批准分析」前要不要加一步确认？选项 A：不加，只提示（本稿的写法——没读完的可能只是一段附录，影响由人判断）。选项 B：加确认框，另开 change。
9. 真的「未通过 AI 质检」时，横幅里「详见 QA 记录 N 条」现在点不开、也没地方看。另开任务把记录显示出来，还是删掉这半句？（本稿不动这一句。）
10. 「问题与澄清」页的 AI 推荐问题列表，要不要也带「没能核对」的标注？（本稿只在分析面板两处标。）
11. 分析面板要不要显示覆盖说明「N 个可分析文件尚未纳入本次分析」，并把「N 个文件文件解析失败」的重复用字改掉？（两处都核对属实，见上表第 6 行；本稿不做，另开小 change——它讲的是「哪些文件没进这次分析」，不是「这次分析哪一步没做完」，数据来源与触发条件都不同。）

## Capabilities

### New Capabilities

- `tender/analysis-incomplete-notes`：招标分析完成但有地方没做完时，系统记下什么、在哪里用哪句话告诉人。

### Modified Capabilities

（无。`tender/analysis-slice-budget`（FIX-12 的增量，尚未归档）规定的重试、让出、门槛都不变；`tender/analysis-failure-surfacing` 管的是整个分析失败，不变。`openspec/specs/muse-bridge/**` 里没有规定 `analysis.ready` 文字的要求，本次的 Muse 行为写在新能力里。）

## Impact

- 代码：新增 `src/lib/tender-understanding/incomplete-notes.ts`（记录的形状、读取、页码写法、选句子、「该说哪几项」的判定，纯函数）与 `src/lib/tender-auto-analysis/v2-incomplete.ts`（落库前组装记录，纯函数）；改 `src/lib/tender-understanding/analyzer.ts`（局限说明那一句）、`src/lib/tender-understanding/clarify.ts`（组装澄清问题时多交回每条问题对应的核对条目）、`src/lib/tender-auto-analysis/v2-resumable.ts`（没读完的内容段带上位置、落库前写记录）、`src/lib/tender-auto-analysis/alerts.ts`（通知的最后一句与优先级）、`src/lib/muse-bridge/events-pure.ts` 与 `hooks.ts`（`analysis.ready` 第一行）、`src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts`（多返回两样）、`src/components/tender-analysis/analysis-panel.tsx` 与 `analyst-synthesis-view.tsx`（显示）。
- 两条分析入口都生效（一键分析与旧的自动分析管线），因为都经同一个切片推进器、同一段落库代码；通知与 Muse 的挂钩也是两条入口共用的（`worker.ts:647–652`、`tender-workforce/analysis-run-service.ts:353–356`、`tender-workforce/tools.ts:1084–1085`）。
- 测试：新增 `src/lib/tender-understanding/__tests__/incomplete-notes.test.ts`、`src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts`（都注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；改 `v2-resumable.test.ts`（RESUME-05 / RESUME-06 断言的句子）、扩 `alerts.test.ts` 与 `src/lib/muse-bridge/__tests__/advisory.test.ts`。
- 无 schema、无新开关、无新队列、无新的模型调用、无新增出站；续跑检查点的结构与版本不变；合并即生效。已存的旧分析没有「未完成记录」，显示、通知、Muse 消息与今天完全相同。

## Out of scope

- 不改分析行为：重试几次、各阶段门槛、何时让出、没核对成的澄清问题不再重查（FIX-12 报告 §7 第 2 条里的「下一切片重查 / 提高澄清门槛」）都不动；切片之外的超时路径（同报告 §7 第 1 条）是另外的 change。
- 不改已存的复核状态与「需人工复核」标志（`src/lib/tender-analyst/**` 零改动），不改 `qa.issues` 里那条内部说明（全站没有地方显示它）。
- 不给已存的旧分析补「未完成记录」，不解析旧分析里带英文码的字符串去猜哪里没做完。
- 不改局限说明的其它几句（证据验证拒收的原因码、近乎无文本的页、回退模型说明、文件包不完整说明）：与本次的四种情况无关，页面也不显示。
- 不改 Muse 通道的其它任何消息与意图；`analysis.ready` 只改摘要第一行，文件名、页码、澄清问题的文字都不进 Muse。
- 不拦截「批准分析」，不改「问题与澄清」页、RFI 导出、询问邮件草稿、投标草稿、项目聊天的上下文。
- 不显示覆盖说明、不改「N 个文件文件解析失败」的用字（「待重测后确认 / 待拍板」第 11 条）。
- 不改一键分析结果卡片自己的那套局限说明（`tender-workforce/tools.ts:1161–1174`；它的 `analysisLimitations` 同样没有任何组件读）。
- 不改 AI 写解读的提示词与版本号（只是它读到的那一句局限说明换了写法）。
- 不处理「待重测后确认 / 待拍板」里的任何一条，等结论。
