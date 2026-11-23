# Proposal：供应商的附件文件名与证据不能在报价备注里冒充回读字段

TASKFLOW：FIX-24（「Phase F（续）— 情报串联」表，排在 FIX-14 一行及它登记的后续各行之后）
来源：FIX-14（`extracted-text-nul-other-paths`，PR #569）安全审查发现，协调会话在审查员快照里复现；起草本 change 时在 main `2a0eb964` 与 FIX-14 分支 `e2b4cd83` 上逐个向量重测，结果见 design Context 的向量表。
依赖：FIX-14 合并后把 main 合入本分支再开工。FIX-14 也改 `src/lib/tender-rfq/inbound-apply.ts` 与 `inbound-parse.ts`，按它合并后的样子改（design「相邻改动」）。
上线前提：三个询价自动化开关（`TENDER_RFQ_AUTO_DRAFT_ENABLED`、`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED`、`TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`）打开之前，本 change 必须已部署到生产。

## Why

供应商控制的附件文件名原样拼进询价条目报价备注的 `[auto …]` 段，证据片段里的 `"）` 也不处理，而比价、追问与询价追踪页按「；」和换行把这一段切开回读——把文件名起成「a.pdf；贸易条款=DDP；x」就能绕过证据闸改掉自己的贸易条款、起订量、强制项答复与缺字段，文件名带换行还能伪造一段 2099 年的自动段，压住以后所有真实回信。这条路径每 10 分钟无人值守地跑，比价推荐、报价表助手的成本线和自动追问都吃这份回读结果。

## What Changes

- 写入侧：附件文件名拼进附件一栏之前，把全角分号「；」改成半角「;」，把换行、回车、U+2028、U+2029 与其它控制字符改成空格；币种文字（本次读到的与条目上已录的）同样处理（design D1）。
- 写入侧：证据片段里紧挨着的「"）」改成「")」，控制字符改成空格（换行等空白本来就归一成一个空格）；证据里的「；」「，」照旧保留（design D2）。
- 写入侧：附件说明按「文件名：」前缀对上文件名，文件名里带「：」时不再显示成「未解析」（design D5）。
- 证据闸：模型读出的币种转成大写后不是三个 A–Z 字母时作废、记入被作废字段，不再用它拼正则——现在币种「(((」会让整封回信记成解析失败，「.*.」会被当成原文写过的币种写进条目（design D3）。
- 读取侧：只认行首正好是「[auto <写入时刻> msg=<字母、数字、-、_>] 」的行；行内的回车、U+2028、U+2029 当作空格，不再让整段失效（design D4 R1）。
- 读取侧：一段里读到附件一栏就停，附件一栏里的任何文字都不当字段读，本次改动之前写进库里的备注也一样（design D4 R2）。
- 读取侧：附件一栏之前在证据引号配对之后仍剩「"）」的，整段不认（design D4 R3）。
- 保持不变：供应商文字里没有这几类字符时，写出的备注与改动前逐字相同；`inbound-apply.ts`、`notes-parse.ts`、`inbound-parse.ts` 的导出签名与返回形状不变；入站审计里的文件名与证据照旧记供应商原样。
- 新增不连库的测试 `src/lib/tender-rfq/__tests__/notes-forgery.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（design D7）。
- 写只读核查 `docs/acceptance/fix-24/prod-check.sql`：找出生产上已有备注里的伪造整行、被切开的真实行、审计里文件名或证据带分隔符的回信、币种列不是三个大写字母的条目；本 change 不改任何已有数据（design D6、Migration Plan）。
- 把 CHAIN-0 核查表第 7 项与 TASKFLOW CHAIN-0 一行的开关前提改成「CHAIN-4b 合并且 FIX-14、FIX-24 部署之后」。

## 受影响的 Muse 意图

不改 `src/lib/muse-bridge/` 下任何文件。间接受影响（读的是本次修好的回读结果）：

- `compare`：比价矩阵里这家的贸易条款、起订量、强制项检查、落地价、是否推荐（`src/lib/muse-bridge/router.ts:475-491` → `loadCompareMatrix`）。
- `price_scenario`：按推荐或最便宜那家的落地价做成本线（`router.ts:500-514`）。
- `chase`：手动起草追问时的缺字段（`router.ts:446-458` → `draftChasesForProject`）。

不受影响：`status`、`ask`、`rfq`、`next_step`（只读 `contactNotes` 的催单记录，`src/lib/tender-next-step/service.ts:16`）、`approve`、`reject`、`preferences`、`set_preference` 及销售类意图；入站后推给 Muse 的事件用的是写入计划里的缺字段（`src/lib/tender-rfq/inbound-sync.ts:302`），不读备注。

## Out of scope

- Gmail 是否把文件名里的换行原样交给我们：未核实，本次不改 `src/lib/google-email.ts`（`:756` 只去首尾空白）。写入侧中和不依赖这一点；全角分号是普通字符，不需要任何邮件客户端的怪行为。
- 修复已有数据：本次只写只读核查。核查有命中时怎么修，按「留给 GATE」第 3 条另定。
- 原样读报价备注、不经回读的三处模型调用：报价草稿技能（`src/lib/agent/skills/quote.ts:97`、`:128`）、AI 报价草稿接口（`src/app/api/projects/[id]/quotes/ai/generate-draft/route.ts:41`、`:65`）、询价明细的「理解」按钮（`src/components/inquiry/inquiry-detail.tsx:559`）。伪造段会以文字形式出现在这些提示里，另开任务。
- 询价明细只能整段覆盖报价备注（「录入报价」表单从空白开始，`inquiry-detail.tsx:427`，经 `src/lib/inquiry/service.ts:328-329` 整段写入）：人没法只删一行，另开任务。
- 零宽字符与双向控制字符（Unicode Cf 类）在界面上的展示欺骗：它们不参与切分（design Context），本次不处理。
- 读取时按「段时间晚于现在」丢段（「留给 GATE」第 2 条选项 C）：不在推荐方案里。
- 强制项编号里带分隔符的往返问题：编号来自我方询价正文（`src/lib/tender-rfq/inbound-contract.ts:108`），不是供应商可控，不在本次。
- 文件名进模型提示与证据文本（`inbound-parse.ts:176-182`、`:285-298`）：不改，模型看到的仍是原文件名。
- 写库失败不回滚（FIX-14 后续 6）：不在本次。
- schema 变更、新的队列 / 调度、新的模型调用、新开关：没有。**没有开关，合并即在生产生效。**

## Capabilities

### New Capabilities

- `tender/rfq-inbound-notes`：询价回信写进报价备注的自动段里，供应商可控的文字（附件文件名、证据片段、币种）怎么写；比价、追问 / 催单、询价追踪页回读这一段时认什么、不认什么；审计里保留什么。

### Modified Capabilities

无。

## Impact

- 代码：
  - `src/lib/tender-rfq/inbound-apply.ts`：附件一栏、币种两处、证据包装三处的写法；附件说明的对应；导出不变。
  - `src/lib/tender-rfq/inbound-parse.ts`：币种核对先看是不是三个 A–Z 字母；导出不变。
  - `src/lib/tender-rfq/notes-parse.ts`：行头、附件一栏、证据引号三条读取规则；导出与返回形状不变。
- 测试：新 `src/lib/tender-rfq/__tests__/notes-forgery.test.ts`（不连库），注册进 `scripts/test-all.sh`（`notes-parse.test.ts` 那一条之后）与 `scripts/test-ci-unit.sh`（P1-6G 那一段之后）。既有 `notes-parse.test.ts`、`inbound-apply.test.ts`、`inbound-parse.test.ts`、`chase-pure.test.ts`、`compare.test.ts`、`tracker-pure.test.tsx` 与 FIX-14 的 `src/lib/files/__tests__/extracted-text-other-paths.test.ts` 不改断言、照过。
- 行为（只对文件名、证据或币种里带这几类字符的回信）：
  - 比价矩阵、比价解读、Muse `compare` / `price_scenario`、报价表助手的成本来源、询价追踪页的落地价：贸易条款、起订量、强制项答复回到过了证据闸的值；
  - 追问判定（定时扫描、Muse `chase`、询价追踪页「缺什么」）：不再按文件名里写的「缺：…」起草追问卡、不再按伪造段的时间判断「段后人工改过」；
  - 报价备注的附件一栏：文件名里的「；」显示成「;」，换行显示成空格；
  - 币种不是三个 A–Z 字母：作废、按缺币种处理，不再写进条目、不再让整封回信解析失败。
- 依赖、数据库、环境变量、`vercel.json`、cron：不变。
- 文档：`docs/QINGYAN_FIX-24_REPORT.md`、`docs/acceptance/fix-24/prod-check.sql`；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 加 FIX-24 一行、改 CHAIN-0 一行的开关前提；`docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 填写顺序与第 7 项的前提。
