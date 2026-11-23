# Design：供应商的附件文件名与证据不能在报价备注里冒充回读字段（FIX-24）

## Context

动机见 proposal.md 的 Why。行号按 main `2a0eb964`；FIX-14（PR #569，分支 `e2b4cd83`）合并后变动的行号写在「相邻改动」。

### 写入：`[auto]` 段怎么拼出来

- 回信入站每 10 分钟跑一次（`vercel.json` `/api/cron/tender-rfq-inbound`、`*/10 * * * *`；`src/app/api/cron/tender-rfq-inbound/route.ts:14` `maxDuration = 120`），没有开关。
- 写入计划 `src/lib/tender-rfq/inbound-apply.ts:82-212` 把事实、不一致、缺字段、附件四部分用「；」连成一段（`:201-204`），行头 `[auto ${now.toISOString()} msg=${messageId}] `（`:209`），再用换行追加到原备注后面（`:215-218`；`inbound-sync.ts:379`）。附件一栏永远是最后一部分（`:205-208`）。
- `msg=` 是 Gmail 自己给的消息编号 `data.id`（`src/lib/google-email.ts:790`），不是供应商写的 `Message-ID` 头；行头时间是本次 cron 开始的时刻（`inbound-sync.ts:156`），供应商都控制不了。

### 段里哪些文字供应商控制得了（逐个核对过）

| 写进段里的东西 | 来源 | 现在怎么处理 | 能注入什么 |
|---|---|---|---|
| 附件文件名（`:207`） | MIME 里的文件名，Gmail 给出后只去首尾空白（`google-email.ts:756`）；入口用代码实际处理的结果覆盖模型自报（`inbound-parse.ts:430`） | 原样拼进附件一栏 | 「；」另起字段；换行另起一段；回车 / U+2028 / U+2029 让整段失效 |
| 附件说明（`:206-207`） | `文件名：说明`（`inbound-parse.ts:431`），说明是系统固定文字 | 按第一个「：」切开对文件名 | 文件名带「：」时对不上，显示成「未解析」（只是显示错） |
| 证据片段（单价 / 总价 / 其它档 `:104`、`:112`、`:120`，交期 `:145`，有效期 `:157`，贸易条款 `:165`，强制项 `:168`，不一致 `:106`、`:114`、`:147`） | 模型从回信纯文本里摘的片段，过证据闸：去空白、NFKC、忽略大小写后逐字出现在原文里（`inbound-contract.ts:59-69`），≤ 200 字 | `q()` 把空白归一成一个空格再包成「（证据："…"）」（`:67-69`） | 片段里的「"）」提前结束引号，后面的文字被当成字段（原文里写「")」半角也行：NFKC 后相同，证据闸照过） |
| 币种（`:133`、`:135`、`:137`） | 模型输出，契约只要求长度 3（`inbound-contract.ts:31`）；核对时把它拼进正则 `\b${c}\b`（`inbound-parse.ts:246`） | 原样拼进段、也写进条目币种列 | 3 个字符装不下完整字段，但能放换行截断本段；「(((」让正则抛错，整封记解析失败；「.*.」匹配任意文字 |
| 已录币种（`:135`） | 条目的币种列（人填的，或以前由模型币种写入的） | 原样拼进「不一致」 | 同上（列里若已有坏值） |
| 数字（单价、总价、数量、交期天数、起订量）、日期、贸易条款（枚举，`inbound-contract.ts:43`）、作答（枚举） | 模型输出，过契约与证据闸 | `${n}` / 原样 | 不能：数字、`YYYY-MM-DD`、五个枚举值里都没有分隔符 |
| 强制项编号（`:168`） | 只接受我方询价正文里 `【强制】(\S+)` 列出的编号（`inbound-contract.ts:108`、`inbound-parse.ts:385`） | 原样 | 不是供应商可控 |

### 读取：`notes-parse.ts` 的完整规则

- 按 `\n` 切行（`:106`），只认匹配 `^\[auto (\S+) msg=(\S+)\] (.*)$` 的行（`:33`、`:107`）。`.` 不匹配 `\r`、U+2028、U+2029，行里有这三个字符时整行不匹配、整段丢掉。
- 段按行头时间的**字符串**排序（`:110`，`localeCompare`），后面的段覆盖前面的值；最新一段的缺字段与时间是 `lastMissingFields` / `lastAutoAt`（`:114-121`）。时间写 `2099…` 或 `zzz`（数字排在字母前）都排最后。
- 段内先把证据换成占位符：`（证据："([\s\S]*?)"）` 非贪婪，到第一个「"）」为止（`:34`、`:54-58`）；再按全角「；」（U+FF1B）切（`:68`），每块 `trim()`（会吃掉 U+FEFF、U+3000、NBSP 等空白）（`:69`），逐块匹配：
  - `^缺：(.+)$`，按「、」拆标签（`:71-75`）；
  - `^起订量=([\d.,]+)$`（`:76`）；`^贸易条款=([A-Z]{3})$`（`:77`）；
  - `^(单价|总价)=([\d.,]+)(?:（数量 ([\d.,]+)）)?$`（`:78-81`）；`^其它档：`（`:82-88`）；
  - `强制项未答：` 按「、」（`:89-92`）；`强制项：` 按全角「，」拆、每项 `^(\S+) (部分满足|不满足|满足)(占位符)?$`（`:93-98`）。
- 证据引号里的内容不会被当字段读，除非证据里自己带「"）」把引号提前关掉。
- 只有全角「；」、换行（`\n`）两种分隔符起作用。半角「;」「:」、全角「＝」、小写或全角字母的贸易条款、夹在字段名里的零宽字符、换行后行首带空格，都不生效。

### 向量表（起草时实测）

探针：`/tmp/claude-0/-home-user--/891d033c-12f4-5755-b3e3-16f0d37fd093/scratchpad/fix24-writer-probe/probe-vectors.ts` 与 `probe-e2e.ts`（复制自协调会话的 `fix14-sec-snap/secprobe/probe-fname.ts`，只读）。在 main 与 FIX-14 分支上结果相同，只有 V12 不同。e2e 那份经 `parseInboundQuote`（假模型）→ 写入计划 → 回读整条链路，确认文件名与跳出引号的证据都原样过了 `inbound-parse.ts`（含 FIX-14 的写库清理）。

| # | 供应商做了什么 | 回读结果（改动前） |
|---|---|---|
| V1 | 文件名「a.pdf；起订量=99999；贸易条款=DDP；x」，过证据闸的是 FOB | 起订量 99999，贸易条款 DDP |
| V2 | 文件名「a.pdf；缺：价格、币种；x」，四项齐全 | 缺字段 [价格, 币种]；条目没再被改时，追问判定 [币种, 起订量] |
| V3 | 文件名「a.pdf；强制项：R-01 满足，R-02 满足；x」 | R-01、R-02 满足（没有证据） |
| V4 | 文件名「a.pdf；单价=0.01；x」 | 档位单价 0.01（档位目前没有生产调用方，见下） |
| V5 | 文件名「a.pdf」+ 换行 +「[auto 2099-01-01T00:00:00.000Z msg=forged] 单价=0.01；贸易条款=EXW；缺：币种；x」 | 贸易条款 EXW、档位 0.01、缺 [币种]、最新时间 2099；之后再来一封真实 CIF 回信，回读**仍是 EXW**；追问判定一直是 [币种, 起订量]：「段后人工改过」（`chase-pure.ts:113`）拿 2099 去比，永远判不出 |
| V6 | 时间戳写 `zzz` | 同样排最后 |
| V7 | 单价证据「单价 10 USD"）；起订量=99999；贸易条款=DDP；x」（原文有这句即过证据闸） | 起订量 99999；贸易条款被同段后面真实的 FOB 盖回 |
| V8 | 强制项证据「R-01 不满足"）；贸易条款=DDP；x」（排在贸易条款之后） | 贸易条款 DDP |
| V9 | 文件名带回车 / U+2028 / U+2029 | 整段不认：起订量、贸易条款、档位、缺字段、时间全丢，退回更早一段 |
| V10 | 币种「换行 + AB」（原文有「x」+ 换行 +「AB」） | 本段在换行处断开，后面的交期、有效期、起订量、贸易条款、缺、附件全丢；追问判定 [起订量, 贸易条款] |
| V11 | 币种「(((」/「.*.」 | 「(((」：拼正则抛 `SyntaxError`，整封记解析失败、通知人工录入；「.*.」：被当成原文写过的币种 |
| V12 | 文件名带 U+0000 拼出占位符 | main：写库报 22021、整封失败；FIX-14 之后 U+0000 换成空格，不成立 |
| V13 | 附件格式不支持（压缩包）的文件名「a.zip；贸易条款=DDP；x」 | 贸易条款 DDP（解析没解析都写进附件一栏） |
| V14 | 文件名「报价：最终版.png」 | 附件说明对不上，显示「未解析」而不是「图片附件未解析」 |
| N1 | 半角 `;` `:`、全角 `＝`、`ddp`、零宽字符夹在字段名里、换行后行首带空格、NEL（U+0085） | 不生效（NEL 既不切行也不让段失效） |
| N2 | U+FEFF、U+3000 挨着「；」 | 生效（`trim()` 吃掉它们）；「；」被中和后无从谈起 |

**Gmail 是否把文件名里的换行原样交给我们：未核实**（V5、V9 依赖这一点）。全角「；」是普通字符，中文文件名里常见，V1–V4、V13 不依赖任何邮件客户端的怪行为；证据向量 V7、V8 只要求供应商在正文里写出那句话。

### 谁回读、读了做什么

| 调用方 | 读什么 | 后果 |
|---|---|---|
| `src/lib/tender-rfq/compare-service.ts:83`（`loadCompareMatrix`） | 贸易条款、起订量、强制项答复（`:88-89`、`:99`） | 落地价：DDP 不加任何费用（`landed-cost.ts:107`、`:244`），伪造 DDP 让这家的落地价等于货值；起订量检查（`:429`）；强制项检查（`:430-442`）；全合规与推荐（`compare.ts:85-87`、`:140`，推荐 = 最便宜的全合规） |
| ↳ 比价矩阵接口 `src/app/api/projects/[id]/inquiries/[inquiryId]/compare/matrix/route.ts:19`、比价解读 `…/compare/analysis/route.ts:48` | 同上 | 面板与模型解读都按伪造值 |
| ↳ Muse `compare`（`router.ts:475-491`）、`price_scenario`（`router.ts:500-514`，选推荐 / 最便宜那家的落地价做成本线） | 同上 | 同上 |
| ↳ 报价表助手的成本来源 `src/lib/tender-pricing/compare-cost-source-load.ts:38-44` | 选定那家的落地价 | 我方成本线被压低 |
| ↳ 询价追踪页 `src/lib/tender-rfq/tracker.ts:235` | 落地价、标记、阻断原因 | 同上 |
| `src/lib/tender-rfq/chase-pure.ts:111`（`currentMissingFields`） | 最新一段的缺字段与时间、贸易条款、起订量 | 追问判定（`chase-pure.ts:326`）→ 定时扫描起草卡（`chase-service.ts:437`），跟进授权覆盖得住时以批准人身份自动执行（`:513-521`）；追问每家只一次（`chase-pure.ts:331`），伪造会用掉这一次。Muse `chase`（`router.ts:446-458` → `chase-service.ts:603`）。询价追踪页「缺什么」（`tracker.ts:263`、`tracker-pure.ts:73`） |
| 档位 `tiers` | — | 生产代码里没有调用方，只有测试读 |
| 原样读备注、不经回读：`src/lib/agent/skills/quote.ts:97`、`:128`；`src/app/api/projects/[id]/quotes/ai/generate-draft/route.ts:41`、`:65`；`src/components/inquiry/inquiry-detail.tsx:200`、`:547-563`（展示与「理解」按钮） | 整段文字 | 伪造段以文字形式出现在模型提示与界面上；不在本次（proposal Out of scope） |
| `src/lib/bid-page-v2/service.ts:36-39` | 只取状态、发出时间、供应商、轮次 | 不读备注，不受影响 |
| Muse hooks 与进展通知（`inbound-sync.ts:302`、`:454`） | 写入计划的缺字段 | 不读备注，不受影响 |

### 历史数据能不能认出来

- **伪造整行**：能，但要对入站审计。真实的一行一定满足三条：
  - 行头时间是 `toISOString` 格式，且不晚于条目的 `updatedAt`（写入在取时间之后）；
  - `msg=` 在 `AuditLog` 里有 `targetType = 'rfq_inbound_message'`、`targetId = msg`、`afterData` 带同一条目 `itemId` 的记录（`inbound-sync.ts:240-247`、`:420-429`）；
  - 审计时间在行头时间之后 10 分钟内（单次最长 120 秒）。

  写审计失败时，同一封信会改记一条 `rfq_inbound:failed`（`inbound-sync.ts:262-269`），所以两种 action 都要认，失败的单独标出来。只看备注本身认不出：伪造者能写出格式完全正确的行头。
- **被切开的真实行**：能。写入方从不在附件一栏里写「；」（FIX-14 的提示句是固定文字，可以排除）；证据引号总是成对；行内的回车 / U+2028 / U+2029 只可能来自文件名。
- **审计里的原文**：`afterData` 里的 `attachmentsSeen`、`prices[].evidence`、`deliveryEvidence`、`validUntilEvidence` 是原样的（`inbound-sync.ts:137-152`），备注后来被人整段覆盖也查得到；贸易条款证据、强制项证据与币种不进审计，只能查备注本身与币种列。
- 只读 SQL 见 Migration Plan。

## Goals / Non-Goals

**Goals:**

- 供应商写在附件文件名、证据片段、币种里的任何文字，都不能变成比价、追问、追踪页回读到的字段，也不能另起一段自动段。
- 库里已有的备注里，文件名「；」与证据跳出引号这两类注入，读取时就不生效。
- 普通回信写出的备注逐字不变；导出签名与返回形状不变。
- 币种不是三个 A–Z 字母时作废，不再让整封回信解析失败。
- 给出一份只读核查，能列出生产上已有的伪造整行。

**Non-Goals:**

- 不改 `src/lib/google-email.ts`（文件名照旧只去首尾空白）。
- 不改 `src/lib/tender-rfq/inbound-sync.ts`：编排、`applyPlan`、审计摘要都不动，审计里照旧记原文件名。
- 不改回读的使用方：`compare-service.ts`、`compare.ts`、`landed-cost.ts`、`chase-pure.ts`、`chase-service.ts`、`tracker.ts`、`tracker-pure.ts`、`tracking-notify*.ts`、`src/lib/tender-pricing/**`。
- 不改 `src/lib/muse-bridge/**`、`src/lib/bid-page-v2/**`。
- `inbound-parse.ts` 只改币种核对：不改送给模型的提示与证据文本（`:176-182`、`:285-298` 照旧带原文件名），不改附件抽取与 FIX-14 的写库清理。
- 不改 FIX-14 的附件提示句（`unreadableSymbolsNote`）与整段 `toStorableText` 收口。
- 不改 `src/lib/inquiry/service.ts`、`src/components/inquiry/**`、`src/lib/agent/skills/quote.ts`、`src/app/api/projects/[id]/quotes/ai/generate-draft/route.ts`。
- 不处理 Unicode Cf 类字符（零宽、双向控制）：不参与切分（Context N1），展示欺骗不在本次。
- 不改 `prisma/**`、`vercel.json`；不改写任何已有数据。

## 相邻改动

- **FIX-14（PR #569）先合并**。看了 `git -C /home/user/wt/fix14 diff origin/main -- src/lib/tender-rfq/`，合并后：
  - `inbound-apply.ts`：
    - 新导入 `toStorableText`（`:15`）与类型 `AttachmentSeen`（`:17`）；`q()` 移到 `:68-70`。
    - 新增附件提示 `unreadableSymbolsNote`（`:78-80`，文字是「（有 N 处符号没读出来，已当空格处理，多半是勾选框；请打开原件核对勾选项和价格）」，**里面有一个「；」**）与 `attachmentParsedLabel`（`:82-84`）。
    - 币种三处移到 `:148`、`:150`、`:152`，贸易条款 `:180`，强制项 `:183`；附件一栏 `:222`；`notesAppend` 整段包 `toStorableText`（`:225`）。
  - `inbound-parse.ts`：文件名先清理（`:161`）；`ParsedQuote.attachmentsSeen` 带可选 `nulCount`（`:66-71`）；`currencySupported` 移到 `:274`，币种核对 `:364`；`attachmentsSeen` / `attachmentNotes` 在 `:463-464`。
  - 本 change 的做法：
    - 附件一栏只中和文件名，FIX-14 的提示句原样保留（它的「；」在附件一栏里，R2 之后本来就不读）；
    - 保留 `toStorableText` 收口，中和放在它之前，两者不冲突：控制字符里的 U+0000 也会被中和成空格，与 FIX-14 结果一致；
    - FIX-14 的 `src/lib/files/__tests__/extracted-text-other-paths.test.ts`（「带与不带这句话 parseAutoNotes 结果相同」等）必须照过。
  - 测试脚本：
    - FIX-14 在 `scripts/test-all.sh` FIX-13 两行之后（main `:577`）加两行、在 `scripts/test-ci-unit.sh` `:39` 之后加一行；
    - 本 change 加在 `test-all.sh` 的 `notes-parse.test.ts` 一行之后（main `:674`，合并后 `:676`），`test-ci-unit.sh` 的 P1-6G 一段之后（main `:483`，合并后 `:484`），都不相邻。
  - TASKFLOW：FIX-14 在 FIX-13 一行之后加 FIX-14 一行与 7 条「待定」，并把 CHAIN-0 一行改成「CHAIN-4b 合并且 FIX-14 部署之后」。本 change 的 FIX-24 一行放在这 7 条之后，CHAIN-0 前提在它的基础上加 FIX-24。若 FIX-14 合并时已经为这个问题登记了一行，改写那一行，不另加。
- **BIDPAGE 会话**只读 `inbound-apply.ts` 的结果。这几个导出的签名与返回形状都不变：
  - 类型 `ExistingInquiryItem`、`InquiryItemUpdateData`、`InboundEvent`、`InquiryItemUpdatePlan`、`PlanMeta`；
  - `INQUIRY_ITEM_DEFAULT_CURRENCY`、转出的 `INBOUND_MISSING_LABEL`；
  - `pickPriceTier`、`planInquiryItemUpdate`、`appendQuoteNotes`。

  中和函数不导出。`notesAppend` 只在供应商文字带这几类字符时与以前不同。
- **FIX-25**（`/home/user/wt/fix25`，同在 `2a0eb964`）：起草时那里还没有 change，没有可比的改动。

## Decisions

### D1 写入侧：中和拼进段里的非证据文字（「留给 GATE」第 1 条，推荐 A）

- 对象（逐处列出）：
  - 附件一栏里的文件名（`inbound-apply.ts:207`）；
  - 本次读到的币种（`:133`、`:135`、`:137`，D3 之后它只可能是三个字母，照样过一遍）；
  - 「不一致」里的已录币种 `exCur`（`:135`）。
- 规则：
  - 每个控制字符（U+0000–U+001F、U+007F–U+009F，含 `\n`、`\r`、`\t`、NEL）与 U+2028、U+2029 → 一个空格；
  - 全角「；」（U+FF1B）→ 半角「;」。
  - 不做 NFKC，不动其它字符。规则只认确切的码位，不存在先规范化、再拼回分隔符的顺序问题。
- 系统自己写的固定文字（附件说明、FIX-14 提示句、「已解析」）不过这一步。
- 中和只用于显示：查附件说明（D5）用的是原文件名，写入计划的其它字段与审计也照旧用原文。
- 为什么够：
  - 「；」与换行是回读仅有的两种分隔符（Context）。中和之后，供应商文字既开不了新的一块，也开不了新的一行，只能留在附件一栏里；而附件一栏本身不匹配任何字段规则，R2 之后更是整栏不读。
  - 「、」「，」「：」「=」只在一块已被认出的字段内部起作用，留着无害。
- 被否决：
  - B「附件一栏不写文件名，只写个数与解析情况」：人在询价明细里看附件一栏，靠文件名找到没解析的那份去手工核对，去掉就丢了用处；文件名在审计里还有，但人不看审计。
  - C「可逆转义（如 `%EF%BC%9B` 或反斜杠）、读时还原」：人看到的是转义码，读取方要多一套还原；收益只是文件名能原样还原，而回读本来就不读文件名。
  - D「在 `inbound-parse.ts` 源头就把文件名改掉」：审计里留下的就不是原样了，事后核对（Migration Plan C 段）没法做；还会改变送给模型的提示。
  - E「在 `appendQuoteNotes` 里统一处理」：这时整段已经拼好，分不清哪个「；」是我们写的。

### D2 证据：「"）」→「")」，控制字符 → 空格

- 在 `q()`（`inbound-apply.ts:67-69`）里，先把控制字符与 U+2028、U+2029 换成空格，再做原有的空白归一与去首尾空白，最后把每个紧挨着的「"）」换成「")」。
- 证据里的「；」「，」「：」照旧：它们在引号里，读取方的占位符本来就遮住了；`notes-parse.test.ts` §4-9 要求强制项证据原样往返。
- 一遍替换不会造出新的「"）」：替换结果以「)」结尾。
- 被否决：
  - 把证据里的「"」统一换成「＂」或「”」：所有含引号的证据都变样，显示偏离原文更多。
  - 把「）」换成「)」：中文证据里的「（含税）」也会变。
  - 证据整体编码（base64）：人看不懂。

### D3 币种只认三个 A–Z 字母

- 币种核对（`inbound-parse.ts:242-247`）先看 `code.toUpperCase()` 是否匹配 `^[A-Z]{3}$`，不匹配直接判「原文里没有」。证据闸照旧把它作废并记 `{ field: "currency", reason: "VALUE_NOT_IN_EVIDENCE" }`（`:331-332`）。
- 结果：
  - 不再用模型给的字符串拼正则：「(((」不再抛错、「.*.」不再匹配一切；
  - 条目币种列不再写进坏值；
  - 写入计划按「没读到币种」处理，回信像报价时备注里有「缺：币种」（`inbound-apply.ts:178`、`:204`）。
- 「usd」照旧转成 USD；别名表（`:231-239`）不变；`RMB` 这类三个字母的写法照旧按原文核对（现状，不在本次）。
- 被否决：
  - 只在备注里中和币种：条目列照样写坏值，正则照样会抛错。
  - 换成 ISO 4217 白名单：要维护一张表；本次要的只是「没有分隔符、不进正则」，三个字母已经够。

### D4 读取侧三条规则（「留给 GATE」第 2 条，推荐 B）

- R1 行头严格：
  - 每行先把 `\r`、U+2028、U+2029 换成空格，再匹配 `^\[auto (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) msg=([A-Za-z0-9_-]+)\] (.*)$`。
  - 写入方写出的行头（`toISOString`、Gmail 的十六进制编号、缺省 `unknown`）与所有既有测试夹具（`m1`、`gm-r1`、`msg-9`、`m${seq}` 等）都匹配。
  - 效果：`zzz` 这类时间不再排到最后；`new Date(lastAutoAt)`（`chase-pure.ts:113`）总是有效日期；V9 那种整段失效变成照常回读。
- R2 读到附件一栏就停：
  - 占位、切块之后，遇到第一块（去掉占位后）以「附件：」开头即停止本段的匹配。
  - 写入方永远把附件一栏放在最后（`inbound-apply.ts:201-208`），所以真实字段一个不丢。
  - 库里已有的 V1–V4、V13 读取时就失效；FIX-14 提示句里的「；」也不再需要专门论证。
- R3 证据跳出引号的整段不认：
  - 附件一栏之前的块里，占位之后仍含「"）」，说明某条证据提前关了引号（写入方从不在引号外写「"）」）。这一段整段当作不存在：字段、缺字段、时间都不参与。
  - 宁可丢掉这一段真实的值（比价会显示「贸易条款未注明」、追问退回更早一段），也不读被注入的值。
  - D2 之后新写的段不会触发这一条。
- 导出签名与返回形状不变：`parseAutoNotes(quoteNotes)` → `ParsedAutoNotes`，字段名与类型照旧。
- 被否决：
  - A「只改写入侧」：库里已有的 V1–V4、V7、V8、V13 继续生效，而「；」那几种不依赖任何 Gmail 怪行为，很可能已经在库里。
  - 「字段只从段首固定位置读」：写入方的字段是否出现取决于数据（有价才有单价、有冲突才有不一致），没有固定位置。要做就得改写入格式并给旧数据配双解析器；R2 已经用一条规则给出同样的保护。
  - 「读时逐段对审计」：见「留给 GATE」第 3 条 C。
  - C「再丢掉时间晚于现在的段」：见「留给 GATE」第 2 条 C。

### D5 附件说明按「文件名：」前缀对上

- 现在用 `n.split("：")[0]` 当键（`inbound-apply.ts:206`），文件名里有「：」就对不上。
- 改成：对每条说明，找文件名使它以「文件名：」开头，值取其后的部分；同名的多份附件照旧后一条覆盖前一条，与现在的 `Map` 一致。没有「：」的文件名结果与现在逐字相同。
- 被否决：把 `attachmentNotes` 改成结构化数组。`PlanMeta.attachmentNotes?: string[]` 是导出类型，BIDPAGE 要求不变。

### D6 不改已有数据，只做只读核查（「留给 GATE」第 3 条，推荐 A）

- 本 change 不带迁移、不带修复脚本。R2、R3 让已有的文件名「；」与证据跳出两类注入在读取时失效；剩下的只有伪造整行（V5），它依赖未核实的 Gmail 行为。
- 合并部署后跑 `docs/acceptance/fix-24/prod-check.sql`（Migration Plan），A 段为 0 行就结束。
- 被否决：
  - B 随本 change 带一次性修复 SQL：没有生产数据就写删除语句是猜；
  - C 读时对审计：每次比价、追问、追踪页都多查库，纯函数变成要查库。

### D7 测试

- 新增 `src/lib/tender-rfq/__tests__/notes-forgery.test.ts`，不连库、不调模型，用例名用中文。只经现有导出走：
  - `planInquiryItemUpdate` → `appendQuoteNotes` → `parseAutoNotes`；
  - `parseInboundQuote`（假模型）；
  - `currentMissingFields` / `decideChases`；
  - `normalizeQuote` + `buildCompareMatrix`，按 `compare-service.ts:82-113` 的取法拼输入；
  - `syncOrgInbound`（内存 deps，照 `inbound-apply.test.ts:103` 截获审计）。
- 分节：
  1. 写入侧：V1–V5、V9、V13 的文件名，V7、V8 及交期、有效期、贸易条款三种证据，V14 的冒号；断言备注只一行、附件一栏的写法、回读值。
  2. 币种：V10、V11 与「usd」；断言不抛错、作废清单、条目币种、「缺：币种」。
  3. 读取侧（手写的旧备注字符串）：附件一栏里的字段、证据跳出整段不认、行内回车、`zzz` 与 `2026-11-20` 行头。
  4. 使用方：spec「文件名冒充 DDP 与强制项满足」的两家比价；V2、V5 的追问判定与 `decideChases` 不起草；追踪页同一判定。
  5. 不变：普通回信的 `notesAppend` 与写死的期望串逐字相同（期望串取自 main 的实际输出）；写入计划的键集合；审计里是原文件名。
- 改动前的代码上，第 1–4 节失败，第 5 节通过。注册：
  - `scripts/test-all.sh`：`notes-parse.test.ts` 那一条之后，标签「招标询价 报价备注自动段防冒充（文件名 / 证据 / 币种，FIX-24）」；
  - `scripts/test-ci-unit.sh`：P1-6G 一段之后，加注释行与这一行。
- 被否决：
  - 加隔离库测试：回读与写入都是纯函数，库只是存字符串，隔离库只多验 Prisma 写字符串；
  - 只改既有的 `notes-parse.test.ts`：它不在 CI 子集里，而这条路径无人值守地跑，要进 CI。

## 与八条硬纪律的关系

1. 零 schema：遵守。不加 model / 字段 / migration；不改已有数据。
2. 出站动作先审批：间接相关。不新增、不改任何出站；修好之后，供应商不能再靠文件名或伪造段让系统起草追问卡、或在跟进授权覆盖下自动发出追问。追问照旧逐封建 PendingAction、经执行器发出（`chase-service.ts:513-521` 不改）。
3. 禁止第三套队列：遵守。不新增队列、调度、lease、worker；入站 cron 不改。
4. 脱敏：遵守，不改 Muse 通道输出的字段。比价矩阵里的落地价本来就允许出（Decision A），本次只让它回到真实值。回读结果不含文件名与证据原文，spec 有对应的 SHALL NOT。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。不改邮箱查找（`inbound-sync.ts:160` 照旧按组织设置的 `mailboxEmail`）。
7. 确定性优先：遵守。中和、币种核对、回读三条规则都是固定的字符与正则规则；不新增模型调用；既有的入站解析模型调用与提示不变。
8. 测试注册：遵守。
   - 新测试进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；
   - `bash scripts/check-test-registry.sh` 通过；
   - `ci/test-registry-baseline.txt` 不加行。

## 验证方式

- `npx tsx src/lib/tender-rfq/__tests__/notes-forgery.test.ts`：改动前退出码非 0，失败的是 D7 第 1–4 节、第 5 节通过；改动后退出码 0。
- 既有测试不改断言、通过数不变（main 上实测）：
  - `notes-parse.test.ts` 17、`inbound-apply.test.ts` 72、`inbound-parse.test.ts` 38；
  - `chase-pure.test.ts` 55、`compare.test.ts` 47、`tracker-pure.test.tsx` 89；
  - FIX-14 的 `src/lib/files/__tests__/extracted-text-other-paths.test.ts`（合并后记下基线）。
- `git diff origin/main -- src/lib/tender-rfq/inbound-apply.ts src/lib/tender-rfq/notes-parse.ts src/lib/tender-rfq/inbound-parse.ts | grep -E '^[-+]export'` 无输出：导出没变。
- `docs/acceptance/fix-24/prod-check.sql` 在隔离库上对一次性种子跑一遍，四段命中与预期一致（tasks 3.2）。
- 门禁：
  - `npm test` 对照既有失败清单无新增；
  - `npm run test:ci` PASS；
  - `npm run typecheck` 退出码 0；
  - `npm run lint:baseline` PASS；
  - `bash scripts/check-test-registry.sh` OK；
  - `OPENSPEC_TELEMETRY=0 openspec validate inbound-notes-filename-forgery --strict` valid。

## Risks / Trade-offs

- [库里已有的伪造整行仍生效] 推荐方案不在读取时丢段（GATE 2 选 B）。真有 V5 那种行，合并后它照样按 2099 排最后、压住后来的回信，直到人处理。所以合并部署后必须跑 prod-check A 段；部署之后不会再写出新的。
- [R3 丢掉真实的段] 旧数据里证据合法地带「"）」（供应商原文就这么写）的真实段，读取时整段不认：这家比价显示「贸易条款未注明」，追问退回更早一段。prod-check B 段会列出这些行。
- [文件名显示变了] 带「；」的中文文件名在备注里显示成「;」，带换行的显示成空格。审计里是原样。
- [手写的假行头不再被认] 人在备注里手打 `[auto 2026-11-20 msg=x] …`（时间不是写入格式）以后不当作自动段。这种行从来不是系统写的。
- [币种更严] 模型输出带符号的币种（如 `US$`）以后作废、按缺币种追问。现状下这类写法拼出的正则本来也基本匹配不上。
- [Cf 类字符] 零宽与双向控制字符仍可能让人在界面上看错文件名；回读不受影响。
- [清理只能整段覆盖] 真要删伪造行，界面上只能经「录入报价」整段覆盖备注（会连真实段一起丢），所以 GATE 3 的处理要另定，不能指望人在界面上删。

## Migration Plan

没有 schema 迁移、没有数据迁移、没有开关。**合并即在生产生效**；回滚就是 revert 这一个 PR。三个询价自动化开关打开之前必须已部署（proposal 上线前提）。

合并部署之后，由有生产只读权限的人跑 `docs/acceptance/fix-24/prod-check.sql`，结果原样贴回报告。下面是 SQL 思路，实现时写成文件，并在隔离库种子上跑通：

```sql
BEGIN READ ONLY;

-- A 段：形如自动段、却对不上入站审计的行（伪造整行嫌疑）
WITH auto_lines AS (
  SELECT i.id AS item_id, i."inquiryId" AS inquiry_id, i."updatedAt" AS item_updated_at,
         l.n AS line_no, l.line,
         substring(l.line FROM '^\[auto (\S+) msg=') AS ts_raw,
         substring(l.line FROM '^\[auto \S+ msg=(\S+)\] ') AS msg_id
  FROM "InquiryItem" i
  CROSS JOIN LATERAL regexp_split_to_table(i."quoteNotes", E'\n') WITH ORDINALITY AS l(line, n)
  WHERE i."quoteNotes" LIKE '%[auto %'
    AND l.line ~ '^\[auto \S+ msg=\S+\] '
),
judged AS (
  SELECT a.*,
         CASE WHEN a.ts_raw ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
              THEN (a.ts_raw::timestamptz AT TIME ZONE 'UTC') END AS ts,   -- Prisma 的 DateTime 列存 UTC、不带时区
         au.action AS audit_action, au."createdAt" AS audit_at
  FROM auto_lines a
  LEFT JOIN LATERAL (
    SELECT x.action, x."createdAt"
    FROM "AuditLog" x
    WHERE x."targetType" = 'rfq_inbound_message'
      AND x."targetId" = a.msg_id
      AND x.action IN ('rfq_inbound:applied', 'rfq_inbound:failed')
      AND x."afterData" LIKE '%"itemId":"' || a.item_id || '"%'
    ORDER BY (x.action = 'rfq_inbound:applied') DESC, x."createdAt"
    LIMIT 1
  ) au ON true
)
SELECT item_id, inquiry_id, line_no, ts_raw, msg_id,
       CASE
         WHEN ts IS NULL THEN '行头时间不是写入格式'
         WHEN ts > item_updated_at + interval '1 minute' THEN '行头时间晚于条目最后更新'
         WHEN audit_action IS NULL THEN '没有这一条目的入站审计'
         WHEN audit_at < ts OR audit_at > ts + interval '10 minutes' THEN '入站审计时间对不上'
         WHEN audit_action = 'rfq_inbound:failed' THEN '审计记的是失败'
       END AS reason,
       left(line, 160) AS line_head
FROM judged
WHERE ts IS NULL OR ts > item_updated_at + interval '1 minute' OR audit_action IS NULL
   OR audit_at < ts OR audit_at > ts + interval '10 minutes' OR audit_action = 'rfq_inbound:failed'
ORDER BY item_id, line_no;

-- B 段：真实行里被供应商文字切开或跳出引号的（合并后读取侧已不认这些内容，列出来给人核对）
--   FIX-14 提示句里的「；」先排除：实现时照 FIX-14 合并后的原文改这里的片段
WITH auto_lines AS ( /* 同 A 段的 auto_lines */ ),
parts AS (
  SELECT item_id, inquiry_id, line_no, line,
         split_part(line, '；附件：', 1) AS before_att,
         CASE WHEN strpos(line, '；附件：') > 0 THEN substr(line, strpos(line, '；附件：') + 4) ELSE '' END AS att
  FROM auto_lines
),
flagged AS (
  SELECT item_id, inquiry_id, line_no, line,
         concat_ws('、',
           CASE WHEN strpos(replace(att, '多半是勾选框；请打开原件', ''), '；') > 0 THEN '附件一栏里有「；」' END,
           CASE WHEN strpos(line, chr(13)) > 0 OR strpos(line, chr(8232)) > 0 OR strpos(line, chr(8233)) > 0
                THEN '行内有回车 / U+2028 / U+2029' END,
           CASE WHEN (length(before_att) - length(replace(before_att, '"）', ''))) / 2
                   > (length(before_att) - length(replace(before_att, '（证据："', ''))) / 5
                THEN '证据引号不成对' END) AS reasons
  FROM parts
)
SELECT item_id, inquiry_id, line_no, reasons, left(line, 160) AS line_head
FROM flagged WHERE reasons <> '' ORDER BY item_id, line_no;

-- C 段：入站审计里原样记下的文件名带分隔符、或证据带「"）」的回信（备注后来被人整段覆盖也查得到）
WITH a AS MATERIALIZED (
  SELECT x.id, x."targetId" AS msg_id, x."createdAt", x."afterData"::jsonb AS d
  FROM "AuditLog" x
  WHERE x."targetType" = 'rfq_inbound_message' AND x.action = 'rfq_inbound:applied'
),
texts AS (
  SELECT a.msg_id, a."createdAt", a.d->>'itemId' AS item_id, '文件名' AS kind, e->>'filename' AS t
  FROM a CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(a.d->'attachmentsSeen') = 'array' THEN a.d->'attachmentsSeen' ELSE '[]'::jsonb END) e
  UNION ALL
  SELECT a.msg_id, a."createdAt", a.d->>'itemId', '价格证据', e->>'evidence'
  FROM a CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(a.d->'prices') = 'array' THEN a.d->'prices' ELSE '[]'::jsonb END) e
  UNION ALL
  SELECT a.msg_id, a."createdAt", a.d->>'itemId', '交期证据', a.d->>'deliveryEvidence' FROM a
  UNION ALL
  SELECT a.msg_id, a."createdAt", a.d->>'itemId', '有效期证据', a.d->>'validUntilEvidence' FROM a
)
SELECT item_id, msg_id, "createdAt", kind, left(t, 160) AS text_head
FROM texts
WHERE t IS NOT NULL AND (
  (kind = '文件名' AND (strpos(t, '；') > 0 OR strpos(t, chr(10)) > 0 OR strpos(t, chr(13)) > 0
                        OR strpos(t, chr(8232)) > 0 OR strpos(t, chr(8233)) > 0))
  OR (kind <> '文件名' AND strpos(t, '"）') > 0))
ORDER BY "createdAt";

-- D 段：币种列不是三个大写字母的条目（以前模型币种写进来的坏值）
SELECT i.id, i."inquiryId", i.currency FROM "InquiryItem" i WHERE i.currency !~ '^[A-Z]{3}$';

ROLLBACK;
```

- A 段为 0 行：不需要处理数据。
- A 段有行：按「留给 GATE」第 3 条的结论处理（推荐另开 change 做一次性修复，走 Owner Gate）。
- B、C、D 段：只给人核对，不改数据；D 段不为 0 时，相关条目的币种由人在「录入报价」里改正。

## 留给 GATE

### 1. 写入侧怎么中和供应商文字

- **A（推荐）换字符**：文件名与币种文字里「；」→「;」、控制字符与各类换行 → 空格；证据里「"）」→「")」（D1、D2）。人看到的文件名基本是原样；回读不可能再被注入；审计留原样。
- **B 附件一栏不写文件名**：只写「附件 3 份：已解析 2、未解析 1（图片 1）」。最彻底，但人在询价明细里找不到是哪一份没解析。
- **C 可逆转义**：文件名能原样还原，但人看到转义码，读取方多一套还原；回读本来就不读文件名，还原没有用处。

### 2. 读取侧要不要也改

- **A 只改写入侧**：库里已有的「；」与证据跳出注入继续生效，要靠修数据；「；」不依赖 Gmail 怪行为，很可能已在库里。
- **B（推荐）写入侧 + 三条读取规则**（D4 R1–R3）：都是纯规则，导出签名不变，`parseAutoNotes` 的调用方不用改。已有的「；」、证据跳出、回车三类在读取时就失效；伪造整行（V5）不受影响，留给 prod-check A 段。
- **C B + 丢掉时间晚于读取时刻的段**：能挡住 2099 这类时间在未来的伪造行，挡不住时间写在过去的；而且要给回读加「现在」这个参数，`compare-service.ts:83`、`chase-pure.ts:111` 及它的三个调用方（`chase-pure.ts:326`、`tracker-pure.ts:73`、`tracker.ts:263`）都要改。V5 依赖未核实的 Gmail 行为，且部署后不会再写出新的。所以不推荐，除非 prod-check A 段真有命中、修数据之前要先挡住。

### 3. 已有数据怎么办

- **A（推荐）只读核查，命中再另开 change**：合并部署后跑 prod-check（Migration Plan）。A 段 0 行即结束；有行时另开 change，按核查结果逐行精确删除，走 Owner Gate。界面上只能整段覆盖备注，不能指望人手工删（Risks）。
- **B 本 change 带一次性修复 SQL**：没有生产数据就写删除语句是猜，误删真实段的代价是比价与追问回读丢值。
- **C 读取时逐段对入站审计**：比价、追问、追踪页每次多查一次审计，回读从纯函数变成要查库，所有调用方都要改；只为挡已有的伪造整行，代价过大。
