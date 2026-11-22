# Proposal：招标分析「没做完的地方」用白话说清楚（FIX-16）

TASKFLOW：FIX-16（Phase F（续）— 生产实测修复）

> 开工前提：FIX-13（#546，`document-parse-nul-and-reason`）合并后，本分支 rebase 到合并后的 main 再开工。本稿凡与 FIX-13 相邻的地方（分析面板的运行头部与覆盖清单、`analyst-synthesis-view.tsx`、`package-coverage.ts`、能力 `tender/analysis-package-coverage`）都按它合并前最后一版的代码（`/home/user/wt/fix13` 的 `d273cce4`）写，rebase 时再核一遍；行号未注明的是 main `2ef4f9c8`。
>
> 范围已拆开：下面「What Changes」是现在就做的核心（design D1 / D2 / D6 / D7 / D8 / D9 / D10）。澄清问题是「重查」还是「逐条标注」、只有澄清没核对时通知的优先级、页码够不够用、Muse 要不要一起改，等 2026-11-22 生产实测（项目 12-3）的结果在 design「留给 GATE」里定，不进本次 tasks。

受影响的 Muse 意图：无。本次不改 `src/lib/muse-bridge/**`，`status` / `ask` / `rfq` / `compare` / `chase` / `price_scenario` / `next_step` 等意图与 `analysis.ready` 事件的文字都不变；Muse 只拉 `muse_bridge` 类别的通知（`muse-bridge/events.ts:149`），本次改的站内完成通知不会流进 Muse。Muse 要不要跟着改见 design「留给 GATE」G3、G6。

## Why

FIX-12 之后，文件多、模型慢时分析不再整个失败，而是「做完了，但有几处没做完」：已纳入的文件里个别内容段没读完、「项目解读」没生成、「项目解读」的 AI 复核没做完、个别澄清问题没能核对文件里是否已有答案（`docs/QINGYAN_FIX-12_REPORT.md` §5、§6、§7 第 2 条）。现在页面不说或说错（把「复核没做完」说成「未通过 AI 质检」），完成通知照样写「可以开始确认招标要求」，交给 AI 写「项目解读」的那句局限说明还带英文错误码 `CALL_DEADLINE_EXCEEDED` 和内部用词「窗口」。

## What Changes

- 记下「哪里没做完」：分析落库时，在分析记录既有的摘要 JSON 里写一份未完成记录——没读完的内容段（文件名 + 起止页码或单元标签 + 原因）、「项目解读」没生成（原因 + 尝试次数）、复核没做完（原因 + 尝试次数）、没核对成的澄清问题（编号 + 问题全文）；四项都没有时不写。全部由落库那一刻已有的数据算出，不改续跑检查点。
- 改写局限说明里讲没读完内容的那一句，改为「已纳入的文件里，有 N 段内容 AI 没读完：《文件名》第 a–b 页…。这几段的内容没有进这次分析，请人工翻看原文。」，不再出现英文错误码与「窗口」；位置按文件包里的先后顺序写。
- 显示没做完的地方：分析面板运行头部正下方新加一块「这次分析有几处没做完」，逐条列出四种情况的句子；它与覆盖清单下面 FIX-13 讲文件的两句分开——「哪些文件没纳入」只在覆盖清单里说，「已纳入的文件里哪里没做完」只在这一块里说。
- 区分「复核没做完」与「未通过 AI 质检」：复核没做完时「项目解读」页底部的横幅改为「「项目解读」的 AI 复核这次没有做完：这份解读只经过第一遍整理，还没有复核过，请人工重点核对。」；真的没通过时横幅原样；已存的复核状态与「需人工复核」标志一个字不改。
- 扩充分析详情接口 `GET /api/projects/[id]/tender-analysis/runs/[runId]` 的返回：多一个 `incompleteNotes`（那一块的标题、各行句子、复核横幅的句子），没有就是 `null`。
- 改写分析完成站内通知的收尾句：有地方没做完时写「这次有地方没做完（有 2 段内容没读完、没有生成「项目解读」），请先看「招标要求」页里「这次分析有几处没做完」的说明」，不再写「可以开始确认招标要求」；有内容没读完或没有生成「项目解读」时优先级为高。
- 改正完成通知里讲文件覆盖的那一句：有没纳入的文件时写「已分析 4/6 个文件（其余 2 个文件没纳入这次分析）」，不再一律写「（其余格式不支持逐条溯源）」。
- 新增两个纯函数测试文件并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`：一个测「按记录选哪句话、位置怎么写、面板与通知说的是同一批事项、旧分析不变、句子里没有内部用词」，一个测「落库前记录怎么组装、没有没做完的地方时什么都不写」。

### 已核对的现状（逐条读代码）

| 现象 | 结论 | 依据 |
|---|---|---|
| 1 局限说明带英文码与「窗口」 | **文字属实，没有任何页面、通知或 Muse 消息显示它** | 句子在 `src/lib/tender-understanding/analyzer.ts:292–297` 拼出：「N/M 个窗口 LLM 抽取失败（错误码…），对应页面内容未纳入结果。」；存进 `summaryJson.limitations`（`v2-map.ts:383`）与综合结论章节的结构化 JSON（`:322`）。`grep -rn "limitations" src/app src/components` 零命中；`alerts.ts`、`src/lib/muse-bridge/**` 不读；详情接口只下发摘要里的 4 个字段（`runs/[runId]/route.ts:95–105`），章节序列化丢掉结构化 JSON（`serializers.ts:99–124`）。读这句话的只有模型：写「项目解读」时的输入（`tender-analyst/context.ts:165`，每条截到 200 字）；项目聊天的「标书分析」技能自己当场重算一份喂给模型（`agent/skills/tender-analysis.ts:78`、`:111`）；评测适配器（`tender-eval/v2-adapter.ts:179`）。英文码只会经模型抄进「项目解读」正文或聊天技能的回复 |
| 2 「项目解读」没生成，没有说明 | **属实** | 第一遍两次没写成 → 直接进落库阶段（`v2-resumable.ts:268–272`）；第一遍写成了但组装出错也没有（`:499–504` 吞掉异常）。`summaryJson` 里没有 `analystSynthesis`，面板退回旧分栏（`analysis-panel.tsx:238–239`，FIX-13 后 `:247–248`），没有任何说明。原因只在检查点 `analyst.passAErrorCode / passAAttempts`（`v2-cursor.ts:64–65`，只有最后一次） |
| 3 复核没做完却显示「未通过 AI 质检」 | **属实** | 复核没有结果时先记 `SKIPPED`、`needsHumanReview = true`、一条带英文码的内部说明（`tender-analyst/synthesize.ts:164–172`），`:186` 把状态一律存成 `NEEDS_HUMAN_REVIEW`。状态值没有任何读者（`grep -rnE "qa\??\.status" src` 只命中测试 `analyst-synthesis.test.ts:414`）；RESUME-09 只断言 `needsHumanReview`（`v2-resumable.test.ts:561–564`），不断言状态。读的都是 `needsHumanReview`：横幅（`analyst-synthesis-view.tsx:573–577`，FIX-13 后 `:581–585`）、通知（`alerts.ts:163–165`、`:219`、`:229`、`:238`）、Muse（`muse-bridge/hooks.ts:61` → `events-pure.ts:62`） |
| 4 没核对成的澄清问题照样出问题 | **属实；哪几条没核对成今天就能算出来，为什么没成算不出来** | 核对失败时结果存 `null`（`clarify.ts:199–202`、`v2-resumable.ts:254`），错误码只用来决定让出（`:256`）；键已存在不再重查（`:237–239`）；澄清开工门槛 30 秒（`v2-cursor.ts:218`），最短超时 15 秒。`null` 也表示「找不到相关页、没问模型」（`clarify.ts:175–177`），找相关页是纯函数（`:54–86`、`:143–159`），落库时本来就重算工作单（`v2-resumable.ts:435`）：有相关页而结果为 `null` = 核对没成。落库的问题文字是全角冒号「主题：未知项」（`clarify.ts:251`），工作单条目里是英文冒号加空格（`:153`） |
| 5 通知和完整的分析一样 | **属实** | 收尾句只看 `needsHumanReview`（`alerts.ts:162–166`）；没有「项目解读」时这个标志取不到、按假处理（`:219`），于是写「可以开始确认招标要求」、优先级 medium（`:229`）。文件覆盖那一句有没纳入的文件时一律写「（其余格式不支持逐条溯源）」（`:153`），12-3 的两份附录 B 其实是解析失败（`docs/QINGYAN_FIX-13_REPORT.md`） |
| 6 FIX-13 合并后的覆盖清单 | **只讲文件** | 投标包 AI 体验开启时（FIX-13 后 `analysis-panel.tsx:487`），覆盖清单下面有两句：「解析失败的文件 AI 没有读到。…」（`exclusion-text.ts:16–17`）与「有 N 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」（`:27–31`），在 `analysis-panel.tsx:511–520`。它们不讲已纳入文件里没读完的内容段 |

## Capabilities

### New Capabilities

- `tender/analysis-incomplete-notes`：招标分析完成但已纳入的文件里有地方没做完时，系统记下什么、在面板与完成通知里用哪句话告诉人。

### Modified Capabilities

- `tender/analysis-package-coverage`（FIX-13 新建，#546 合并并归档后进主规格）：改「分析面板提醒还没纳入的能读文件」一条，写明覆盖清单下面的提示只讲文件有没有纳入，已纳入文件里没做完的地方不进覆盖清单、由运行头部正下方那一块说明；FIX-13 的句子与显示条件一个字不改。

（`tender/analysis-slice-budget`（FIX-12）规定的重试、让出、门槛都不变；`tender/analysis-failure-surfacing` 管整个分析失败，不变。）

## Impact

- 代码：新增 `src/lib/tender-understanding/incomplete-notes.ts`（记录的形状与读取、位置写法、「要说的事项」的判定、全部句子与通知短语，纯函数）与 `src/lib/tender-auto-analysis/v2-incomplete.ts`（落库前组装记录，纯函数）；改 `src/lib/tender-understanding/analyzer.ts`（局限说明那一句、失败段带位置并按包内顺序）、`src/lib/tender-understanding/clarify.ts`（组装澄清问题时多交回「编号 → 工作单条目」）、`src/lib/tender-auto-analysis/v2-resumable.ts`（失败段带位置、落库前写记录）、`src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts`（多返回 `incompleteNotes`）、`src/components/tender-analysis/analysis-panel.tsx` 与 `analyst-synthesis-view.tsx`（显示）、`src/lib/tender-auto-analysis/alerts.ts`（收尾句、优先级、文件覆盖那一句）。
- 局限说明换写法后，三处模型输入跟着变：写「项目解读」的输入、项目聊天「标书分析」技能的输入、评测适配器的输入；调用次数与提示词版本不变。
- 两条分析入口都生效（一键分析与旧的自动分析管线）：都经同一个切片推进器与同一段落库代码；通知挂钩两条入口共用（`worker.ts:647`、`tender-workforce/analysis-run-service.ts:353–356`）。
- 测试：新增 `src/lib/tender-understanding/__tests__/incomplete-notes.test.ts`、`src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts`（都注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；改 `v2-resumable.test.ts`（RESUME-05 / RESUME-06 认新句子，RESUME-09 补状态取值的断言，补三个用例）、扩 `alerts.test.ts`。
- 无 schema、无新开关、无新队列、无新的模型调用、无新增出站；续跑检查点的结构与版本不变；合并即生效。已存的旧分析没有未完成记录，面板与横幅和今天相同。
- 归档顺序：本 change 对 `tender/analysis-package-coverage` 是 MODIFIED，FIX-13 归档之后才能归档本 change。
- 与 FIX-20 的分界：FIX-20 处理数字员工 Job 的 t8「Job 级综合汇总」失败降级与受阻显示（一键分析卡片、AI 任务详情页）；本 change 处理分析记录里「项目解读」没生成、复核没做完、内容段没读完、澄清没核对的白话说明。本 change 的句子一律用「项目解读」，不出现「综合」二字，与 AI 任务详情页上的「综合汇总」（`src/app/(main)/workforce/presentation.ts:111`、`:116`）分开。

## Out of scope

- 不改分析行为：重试几次、各阶段门槛、何时让出、没核对成的澄清问题不再重查都不动；切片之外的超时路径归 FIX-15（`workforce-invocation-deadline`）。
- 不改已存的复核状态与「需人工复核」标志（`src/lib/tender-analyst/**` 零改动），不改 `qa.issues` 里那条内部说明。
- 不给已存的旧分析补未完成记录，不解析旧分析里带英文码的字符串去猜哪里没做完。
- 不改局限说明的其它几句（证据验证拒收的原因码、近乎无文本的页、回退模型说明、文件包不完整说明）。
- 不改 Muse 通道：`analysis.ready` 的第一行与 `next_step` 的查表都不动（G3）。
- 不逐条标注没核对成的澄清问题：「澄清问题」「澄清 / RFI」两个列表、「招标要求」页「正式澄清（RFI）」里「向业主提问」对话框的推荐问题与它起草的邮件（`src/app/api/projects/[id]/questions/route.ts:30–35`、`:149–155`）、RFI 导出（`src/lib/projects/generate/generate-docs.ts:381–400`）本次都不加标注；随「重查还是标注」一起定（G1）。本次只在那一块里说条数。
- 不改项目聊天与 Muse `ask` 的上下文（`src/lib/tender-auto-analysis/chat-context.ts`）（G6）。
- 不改工作台与网页「下一步」：它们写「AI 分析完成，待你确认」（`src/lib/tender/workbench-state.ts:127`、`:206–211`）、「分析完了，等你确认要求并批准」（`src/lib/tender-next-step/web-next-step.ts:213`），分析确实完成了；按钮直接把人带到「招标要求」页的分析面板（锚点 `tender-analysis`，`src/lib/tender-next-step/targets.ts:22`、`web-next-step.ts:104`），新加的那一块就在面板运行头部正下方。
- 不改一键分析卡片（`src/components/tender-analysis/agent-card.tsx`）与 AI 任务详情页：归 FIX-20。
- 不拦截「批准分析」（G8）。
- 不改覆盖清单本身（FIX-13）；情报页覆盖说明里拼出来的「N 个文件文件解析失败」（FIX-13 后 `package-coverage.ts:126` 的「N 个文件」接标签「文件解析失败」）不在本次，另开小 change。
- 不改一键分析结果卡片自己的那套局限说明（`tender-workforce/tools.ts:1161–1174`）。
- 不改写「项目解读」的提示词与版本号（只是它读到的那一句局限说明换了写法）。
