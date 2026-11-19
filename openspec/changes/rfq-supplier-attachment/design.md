# Design：询价邮件带一份重排的 PDF 附件（CHAIN-4a）

## Context

- 询价单由 `src/lib/tender-rfq/build.ts` 的 `buildRfqDocument` 生成（纯函数），CHAIN-4b 之后它已经只用中性询价编号、只取已确认的供应商侧要求、对每一处供应商可见的文字过禁出清单与敏感词表。`renderRfqEmail` 把它渲染成纯文本邮件。
- 起草：`service.ts` `prepareRfqRound`（网页 / Muse / 自动起草三个入口共用）→ `draftRoundCard` → `requestApproval` 建 `tender.send_rfq` 审批卡；载荷 `TenderSendRfqPayload`，防篡改哈希 `rfqDocHash = hashRfqPayloadItems(items)`（sha256 前 16 位，只覆盖每家的 `inquiryItemId|to|subject|body`）。
- 执行：`execute.ts` `execTenderSendRfq`：哈希核对 → CHAIN-4b 身份复核 → 发件账号 → 逐家 `sendGmail(…, contentType: "text")`。
- 发信：`google-email.ts` `buildRawEmail` 只会单段 `text/plain` 或 `text/html`；`SendEmailParams` 没有附件。
- PDF：`src/lib/pdf/html-to-pdf.ts` `renderHtmlToPdf`（服务端 Chromium + data-URI 注入 Noto Sans SC，魔数校验，失败抛 `HtmlToPdfError`）。先例：`install.send_warranty_email` 在载荷里存 HTML、执行时才转 PDF（`exec-install-warranty-email.ts`）。
- 实测（本会话，`/opt/pw-browsers/chromium-1243`）：同一份 HTML 相隔 1.5 秒转两次，PDF 长度相同、**4 个字节不同**——`/CreationDate` 与 `/ModDate` 是生成时刻。120 行中文表格 → 4 页、93 KB、约 5 秒（含字体注入）；`/Type /Page` 计数与 `/Count` 都给出 4。

## Goals / Non-Goals

**Goals**：起草时生成并检查附件；附件内容进审批哈希；执行前按执行时的资料重排、核对、再生成 PDF 随信发出；卡上可见、可预览；不带附件时一切逐字节不变。

**Non-Goals（不动的）**：
- `src/lib/tender-rfq/chase-*.ts`、`followup-*.ts`（催单 / 追问与跟进授权的模板与指纹）。
- `src/lib/projects/generate/generate-docs.ts`、`tender-doc-html.ts`（「供应商询价与符合性确认表」文件）。
- `src/lib/bid-workflow/project-identity-deny.ts` 的比对规则与清单来源（只调用）。
- `src/lib/pdf/html-to-pdf.ts`（只调用）。
- `src/lib/muse-bridge/**`（新错误码自然落到既有的 `VALIDATION_FAILED`）。
- `inbound-*.ts`（回信按正文解析，不读附件里填的内容）。
- Prisma schema、`vercel.json`、cron。

## Decisions

### D1 哈希的是附件的渲染内容，不是 PDF 字节

任务书写「附件字节的 SHA-256 写进载荷……执行器发送前重新生成并比对」。Chromium 的 PDF 里有生成时刻（实测见 Context），同一份内容每次生成的字节都不同，按字节比对会让每一张卡都被拒发。所以载荷里存**内容指纹** = 附件 HTML（模板 + 询价单内容，不含字体注入与任何时间戳）的 SHA-256；HTML 到 PDF 是固定的代码与字体，内容相同则 PDF 的可见内容相同。实际发出的 PDF 字节的 SHA-256 写进审计，事后可以核对「发出的是哪一份」。

- 否决 A：PDF 字节进哈希、执行时直接发起草时的字节——要把 PDF 存起来。零 schema 下只能塞进载荷 JSON（几十 KB 到 MB 级 base64），而 `loadRfqRoundLockState`、审批中心列表等都会整行读载荷；也满足不了任务书「改了要求再执行旧卡要拒发」的验收。
- 否决 B：把 PDF 里的日期改成起草时刻，让字节可复现——依赖 Chromium 与字体版本逐字节不变，部署升级一次 `@sparticuz/chromium`，所有待批卡都会被拒发；改 PDF 字节本身也脆弱。

### D2 执行时按「执行时的资料 + 起草时定格的参数」重排

载荷 `attachment.draft` 定格起草时会影响内容、但不是项目资料的参数：询价编号（组织代码或时区之后改了不影响这张卡，与邮件标题一致）、起草时刻（决定回复截止）、起草日期（组织时区）、回复截止提前量、发起人填写的补充说明 / 附加问题 / 目的地 / 数量阶梯；贸易条款与发件抬头本来就在载荷里。项目资料（截标日期、禁出清单、当前可用分析的已确认要求与关键事实）在执行时现读。重排出的内容指纹与载荷不同 → `RFQ_ATTACHMENT_CHANGED`。这满足验收「改动一条已确认要求后再执行这张旧卡 → 拒发，提示附件已变化需重新起草」。

- 否决：附件只用载荷里定格的询价单快照重排（不读执行时的资料）——指纹永远一致，改了要求也照发，不满足验收。
- 否决：执行时用当时的时刻重排——回复截止按「今天 + 2 天」兜底，隔天执行就会变，等于制造假的「已变化」。

预览接口与读卡时的提前提示（D7）用同一个重排函数，所以「预览看到的」=「批准后会发的」；不一致时预览直接说内容变了。

**版式版本**：内容指纹覆盖的是模板与 `build.ts` 的输出，部署改了模板（或改了会进附件的询价单生成规则）会让已起草的卡指纹对不上。载荷记 `templateVersion`，执行时先比版本：不同就报「系统更新了询价附件的版式」（`RFQ_ATTACHMENT_TEMPLATE_CHANGED`），不误报「内容变了」。`attachment.test.ts` 用一个固定样例钉住内容指纹：改了模板而没加版本号，这条用例会失败，提醒先加版本号。

- 否决：版本号也进载荷哈希——版本号只决定用哪句话拒发，不影响发什么；不进哈希可以让测试直接改版本号验证拒发分支。

### D3 起草时就生成一次 PDF

起草时生成一次，用来：确认这份附件能生成（失败就不起草，满足「不降级为去掉附件照发」）；拿到页数与大小写上卡。生成的字节随即丢弃。代价是起草多约 5 秒（实测，冷启动更久）；自动起草挂在审核接口里，同样多这几秒。

- 否决：起草时不生成，只在执行时生成——卡上没有页数与大小，且到批准那一刻才发现生成不了，人白批一次。
- 否决：起草时生成后存起来供执行直接用——见 D1 否决 A。

### D4 附件内容只取询价单本身（判断点 5 A）

新增 `src/lib/tender-rfq/attachment.ts`（纯函数）：`renderRfqAttachmentHtml(doc, { draftedOn })` 从 `RfqDocument` 排版，与 `renderRfqEmail` 同序同条数；每条要求两栏空白「是否满足（满足 / 偏离）」「说明」，供应商可打印填写。所有文字 HTML 转义。文件名 `询价单-{询价编号}.pdf`。不读项目、不读收件人，所以同一轮各家同一份。

模板固定文字的身份检查：把规格、交付要求、目的地留空后再渲染一份，整份按「我方撰写」过禁出清单（项目名称类也查），位置「询价附件」——与 CHAIN-4b 对邮件模板句子的做法相同。规格等内容已经在 `buildRfqDocument` 里按各自的口径查过，不重复、不放宽（所以「附件不含项目名称」只约束我方撰写的部分，招标原文里与项目名称相同的词按 CHAIN-4b 主规格照常允许）。起草日期是系统生成的日期，与 CHAIN-4b 供应商侧文件的生成日期同一口径，不参与比对（否则截标当天起草会误判命中截标日期）。

- 否决：复用 `tender-doc-html.ts` 的 `supplier_rfq` 文件模板——它从项目文件与分析事实取数，口径与询价单不同（不是 `build.ts` 筛好的行项），两边内容会对不上。
- 否决：附件里放原标书页面（判断点 5 B）——见 proposal Out of scope。

### D5 发信管道

`SendEmailParams.attachments?: { filename: string; mimeType: string; data: Buffer }[]`。`buildRawEmail` 在没有附件（或空数组）时走原来的代码路径，一个字节都不动；有附件时：头部同原来（From / To / Subject / MIME-Version / Reply-To / In-Reply-To / References），`Content-Type: multipart/mixed; boundary="=_qy_{内容 sha256 前 32 位}"`；正文段与附件段都 base64、每行 76 字符。分隔线以 `=_` 开头——base64 与 RFC 2047 编码词里都不会出现 `=_`，所以不会撞上内容；用内容哈希而不是随机数，同样的输入得到同样的原始邮件，测试可以逐字节断言。

- 否决：引入 `nodemailer` 的 MailComposer——新依赖，且其输出带随机分隔线与 Message-ID，无法证明「不带附件逐字节不变」。

### D6 新错误码与说明

- 起草：`ATTACHMENT_FAILED`（`reason: "render_failed" | "too_large"`）。网页 422；自动起草新原因码 `ATTACHMENT_FAILED`（`quiet: false`，去处询价入口）；Muse 落 `VALIDATION_FAILED`。模板命中禁出清单走既有 `IDENTITY_LEAK`。超限的说明不写「稍后重试」（同样的内容重试结果一样），改说「要求条数太多时请分几轮询价」。
- 执行：`RFQ_ATTACHMENT_TEMPLATE_CHANGED`、`RFQ_ATTACHMENT_CHANGED`、`RFQ_ATTACHMENT_FAILED`，在 CHAIN-4b 的身份复核与**发件账号检查之后**判（发不出去的卡不白生成一次 PDF），判出即一封不发、不动询价项；询价项都已发过（重放）时跳过。执行失败后卡已作废、不能再驳回，所以说明说「请重新发起一轮询价」；卡面板的 `friendlyExecutionError` 照旧在前面加「没有发出去：」，不另加文案。
- 措辞：一律说「起草后变了」而不是「批准后变了」——变化可能发生在批准之前（预览与卡上的提示都在批准前）。
- 否决：执行时附件失败就退回不带附件发出——违反任务书「不降级」，也让人批的和发的不一样。

### D7 卡上显示、提前提示与预览接口

- `previewEmailsFromPayload` 读载荷的附件，给每封预览带 `attachment: { filename, pages, sizeBytes, previewHref, stale }`；`loadRfqSendEmails` 传入卡 id 拼预览链接。面板（`rfq-approval-panel.tsx`，三处入口共用）在邮件列表上方显示一行附件与「预览」（新窗口）。催单卡的载荷没有附件，自然不显示。
- **提前提示**：`loadRfqSendEmails` 对带附件的卡跑一次与执行器相同的重排比对（几次查库 + 渲染 HTML，不启动 Chromium）。内容变了 / 版式更新了 → `stale`，面板显示「批准后会被拒发。请驳回这张卡，再重新发起一轮询价。」，不给批准按钮与预览链接，驳回照常。典型场景：自动起草的卡写着「另有 N 条没有确认的没带上」，人随后又确认了一条——卡已经不能发，要在批准前就让人看到，而不是批了才发现作废。
  - 否决：只在执行时拒发——人白批一次，卡作废后才知道。
  - 否决：读卡时也生成 PDF——每次刷新都要几秒；指纹比对足以判断。
- `previewRfqPayload`（审批中心、通知里的卡摘要）在主题行之后加一行「附件：…」；没有附件时输出不变。
- 预览接口 `GET /api/projects/[id]/tender-rfq/attachment?actionId=`：`requireProjectReadAccess` → 卡必须是本组织本项目的 `tender.send_rfq` 且载荷有附件 → 与执行器同一个重排函数 → PDF。只读，不写任何状态。权限与项目页询价区一致：同一批能读项目的人已经能看每封邮件的正文（`loadRfqSendEmails` 不另做审批可见判定），附件内容是正文的子集。
  - 否决：再叠加审批中心的可见判定（VIS-1d）——挡不住任何多出来的信息，只会让看得到正文的人点「预览」得到 404。
  - 否决：预览返回 HTML——供应商收到的是 PDF，分页与字体只有 PDF 看得准。

### D8 开关

`src/lib/tender-rfq/attachment-flags.ts`，写法与 `followup-flags.ts` 相同（主开关 + 组织白名单，留空 = 全部组织）。开关只在起草时读；执行器与预览只看载荷有没有附件（D2 已保证批准的内容不变，关开关不应让已批的卡失效，也不应让它不带附件发出）。

- 否决：执行时也读开关、关了就拒发带附件的卡——关开关的目的是停止新起草；已起草的卡要撤回就驳回，开关不该让人批过的卡无声失效。PDF 坏了的情况由 D9 的检查兜住（失败即拒发）。

### D9 PDF 必须嵌入中文字体

`html-to-pdf.ts` 找不到 Noto Sans SC 时只记警告、照样产出合法 PDF——2026-08-26 生产上出过「全文中文空白」。附件里一定有中文，所以检查 PDF 里有 `/BaseFont /XXXXXX+NotoSansSC…`（实测 Chromium 输出里是明文），没有就按生成失败处理：起草时不起草、执行时拒发。

- 否决：只查魔数与大小——中文空白的 PDF 会照样发给供应商。
- 否决：改 `html-to-pdf.ts` 让它缺字体就抛错——它还服务其它文件（`generate-docs` 等），那些调用方有自己的降级口径，不在本次范围。

## 与八条硬纪律的关系

1. 零 schema：遵守。附件元数据进既有 `PendingAction.payload`（JSON），审计进 `AuditLog`；不存 PDF 字节。
2. 出站先审批：遵守且更严。附件只能随已批准的发询价卡发出；内容指纹进载荷哈希，批准后内容变了整张卡拒发；不新增任何免审批发送；催单 / 追问不带附件。
3. 不新增队列 / cron：遵守。起草与执行都在既有的请求与执行器里同步完成。
4. 脱敏：遵守。附件内容是询价单的子集，询价单已过敏感词表（不出我方报价、估值、毛利、预算）；附件不涉及 Muse 通道。
5. 不爬登录页：不涉及。
6. 邮箱分离：遵守。发件仍走 `resolveSender`（只认组织设置的授权邮箱），附件不改变发件身份。
7. 确定性优先：遵守。零 LLM 调用；附件是固定模板排版。
8. 测试注册：新增 `src/lib/tender-rfq/__tests__/attachment.test.ts`、`src/lib/__tests__/google-email-mime.test.ts`、隔离库 `src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts`，均注册进 `scripts/test-all.sh`，两个纯函数测试同时进 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/__tests__/google-email-mime.test.ts`：不带附件逐字节等于旧写法（测试里保留一份旧实现做对照）；带附件的 MIME 结构、RFC 2231 文件名、往返解码。
- `npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts`：开关真值表、附件内容与顺序、确定性、文件名、模板命中、哈希兼容、卡摘要行、预览字段、源码断言（执行器在发信前核对、催单不带附件、无 LLM 调用）。
- `NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts`（隔离库，注入 PDF 生成函数与发信函数）：开关关闭的载荷不变；送审带附件；联邦标附件不含身份；生成失败 / 超限零轮次；执行带附件发出与审计；改要求后拒发；执行时生成失败；预览的权限、409、只读。
- 既有：`build.test.ts`、`round-pure.test.ts`、`web-entry-pure.test.ts`、`auto-draft-pure.test.ts`（原因码 11 → 12 的断言改为 12，这是本次要改的）、`chase-execute.test.ts`、`supplier-identity-guard-db.isolated.test.ts`、`auto-draft-db.isolated.test.ts`。
- 门禁：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate rfq-supplier-attachment --strict`、`git diff origin/main -- prisma/ vercel.json` 为空。
- 真实 Chromium 抽检一次：本机用 `CHROME_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` 生成一份联邦标附件，看中文是否正常、页数是否与卡上一致，结果写进报告。

## Risks / Trade-offs

- 起草多约 5 秒、执行时每张卡再生成一次 PDF（一张卡只生成一次，不是每家一次）。serverless 冷启动更慢；超时按 `renderHtmlToPdf` 默认 45 秒。送审、批准与四个审核接口都不改 `maxDuration`：设小了反而会把平台缺省（Fluid compute 下通常更长）压低，影响同一路由里的其它动作。
- PDF 一直生成不了时，自动起草在每次审核动作后都会再试一次并提示 `ATTACHMENT_FAILED`（每次几秒）。这是运维故障，提示会让人发现；要停就关开关。
- 预览没有限流与缓存：每次打开都生成一次（约 5 秒），只对登录的项目成员开放。
- Gmail 对 `messages.send` 的原始邮件大小有上限（未逐项核实非上传接口的确切值）；附件限 5 MB，实测典型询价单约 90 KB / 3 页。
- 审批后若部署升级了 Chromium，发出的 PDF 版式可能与起草时略有不同（内容相同）——这是 D1 的代价，内容指纹保证的是内容。
- 执行时项目资料变化（包括新一份分析）会让旧卡拒发；这比带着旧附件发出更安全，说明里写明「请驳回后重新起草」。
- Gmail 对单封原始邮件有大小上限；附件限 5 MB，实测典型询价单不到 100 KB。

## Migration Plan

开关默认关，合并后行为不变。staging 打开开关（白名单只放测试组织）→ 用测试邮箱收一封 → 打开 PDF 核对中文与条目、与卡上预览一致 → 再对 Sunny 打开。回滚：关开关（已起草的带附件卡照样按卡执行；要撤回就驳回）。

## 交叉审查（独立代理，只给四件套与代码，2026-11-19）

12 条，采纳 10 条：卡上提前提示附件已变并不给批准（D7）；版式版本与定版指纹（D2）；询价编号与起草日期定格（D2）；「附件不含项目名称」限于我方撰写部分、起草日期不参与比对（D4）；PDF 必须嵌入中文字体（D9）；措辞改「起草后」「重新发起一轮询价」、超限不说「稍后重试」（D6）；预览权限与正文一致、去掉会 404 的可见判定（D7）；执行器先查发件账号、重放不再生成（D6）；场景引用补源码断言与隔离库用例；正文那一句去掉页数。未采纳 2 条：设 `maxDuration` 与预览限流（见 Risks）；PDF 失败后自动起草静默（会把故障藏起来）。

## 审核关注点与拍板结果（Lucas 2026-11-19「判断点 5 按 A……你全权负责」）

- **与任务书的出入（D1）**：任务书写的是「附件字节的 SHA-256」，本设计哈希的是附件渲染内容，PDF 字节的 SHA-256 只进审计。原因：Chromium PDF 带生成时刻，字节不可复现（实测）。按推荐取内容指纹。
- **执行时现读项目资料（D2）**：意味着「起草之后分析更新过」的旧卡会被拒发（不带附件的卡不受影响，仍按 FLOW-H3 只提示）。按推荐取拒发。
- **附件失败时整轮不起草（D3 / D6）**：按任务书「不降级」。
- **页码**：附件与邮件一样保留「招标文件 p.N」（CHAIN-4b 已允许邮件里出现页码，不含任何编号或机构）。
