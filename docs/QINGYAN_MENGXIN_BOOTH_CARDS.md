# 展会速记卡 · 夜间录入（梦馨 · 第 140 届广交会三期）

入口：青砚 → 外贸 → 展会导入 → 「展会速记卡 · 夜间录入」，或直接打开 `/trade/booth-cards`。
外贸、老板、经理账号可用。

## 展前一次性：款号参考表

页面「款号参考表」里一行一个 `款号, 品类名`，品类名用英文（会写进给买家的跟进邮件），保存即生效，可随时改。
梦馨展示的款号是**做过、能做的参考款**，不是有固定规格和价格的现货：表里只写通用品类名，不写尺寸、克重、价格。
录入时卡上的款号会写成「品类名 (ref. 款号)」，跟进邮件逐一列出买家看过的参考款，并说明每一款都可以按买家的规格定做
（尺寸、面料、克重、颜色、品牌和包装）。不在表里的款号照样能录入，邮件里只写款号，预览时黄字提醒。

每行后面可以再加两列（可选）：`款号, 品类名, 规格页链接, 图片链接`，链接要以 `https://` 开头。
有规格页链接，邮件里这一款的卡片就带「View specification →」；有图片链接，卡片上方放这款的照片（邮件用 JPG，宽 600 左右）。
只填图片不填规格页时，表里不会保存图片。

## 每晚的流程（约 40 分钟 / 60 张卡）

| 步骤 | 谁 | 做什么 |
|---|---|---|
| 1 拍照 | 晚间负责人 | 每张卡一张照片：名片朝上，整张卡入镜，光线均匀，不反光 |
| 2 AI 识别 | 晚间负责人 | 页面上「复制 AI 提示词」，连同当天照片发给 AI（Claude / ChatGPT），得到 CSV |
| 3 核对 | 晚间负责人 | 对照卡片逐行核对 **邮箱、WhatsApp、等级、卡号**；备注里带「[待核：…]」的格子补全后删掉标记。「备注」是给买家邮件用的英文，「备注原文」是卡上手写的中文原话，给同事看 |
| 4 上传 | 晚间负责人 | CSV 存成 `.csv` 直接上传，或粘贴进「下载模板」的表格后上传；展会名称填 `the 140th Canton Fair (Booth 14.3E07)`（只需填一次） |
| 5 录入 | 晚间负责人 | 预览没有红字后点「开始录入」。每张约 1 分钟，同时处理 3 张；页面不要关 |
| 6 审核 | 管理层，次日开馆前 | 审批中心逐封看跟进邮件草稿，没问题就批准发送，不合适就拒绝（草稿不能改，见下）；A 级当天排报价或寄样 |

## 每张卡录入后有什么

- 外贸线索，归在「展会速记卡」活动，来源「展会」；时间线里一条「【展会速记卡】」消息，带卡号、日期、业务员、**卡上的等级**，以及按中文原样记录的买家类型、规模、时间、下一步、规格认证和**备注原文**
- 客户和商机（来源 trade_show），互动记为「面谈」
- AI 评分、RFQ 要点、缺失信息
- 卡上等级决定商机优先级：A → 高（进「重点线索」队列）、B → 中、C → 低；同一家公司多张卡取最高等级。AI 评分照常记录，供参考
- 一封英文跟进邮件草稿，放进审批中心，标题「跟进邮件（展会 · A 级）：公司名」，**不会自动发送**。版式（同一份内容出纯文本和 HTML 两版）：
  - 主题点名：“Emma, your Canton Fair picks + full specs”；开头 “Great meeting you at Booth 14.3E07 during the 140th Canton Fair — thanks for stopping by.”
  - 「What we noted at the booth」：卡上可以复述的要点（如包装、认证），英文邮件不放中文原话
  - 参考款卡片（照片、品类名、款号、规格页链接），下面一句“都可按您的规格定做”
  - 「Next step · your costing」：报价只问还缺的（数量 / 尺寸和面料 / 目的地，最多三点），按钮「Reply with my details」（回到公司发件身份的回复地址）和「Chat on WhatsApp」
  - 公司介绍、数字、视频看样、规格书口径：在「邮件里的公司资料」填了才出现（见下）
  - 不写价格、MOQ、交期、认证、付款条件等任何承诺；没填规格书口径时写 “Pricing, MOQ and lead time depend on your specification, so we will confirm them in your costing.”
- 审批预览里是纯文本版；点草稿下的「查看邮件效果（买家看到的样子）」看 HTML 版。上线前起草的草稿只有纯文本
- 审批预览里英文邮件下面附一份**中文对照**（同一模板的中文版，标明「仅供审核，不会发送」），看中文的同事据此审核；真正发出去的只有英文
- 落款是卡上的业务员（买家在展位见到的人，如 Cathy）；业务员栏写的是中文名时，落款用商机负责人的名字
- 草稿只能批准或拒绝，不能直接改。要改：先拒绝，改好源头（款号参考表、公司资料）后到商机页点「重跑 Inbound FDE」重新起草（未拒绝时重跑会复用原草稿）；或拒绝后业务员自己用邮箱回复，再点「买家已回复」
- 只留了 WhatsApp、没有邮箱的卡：建客户和商机，但没有邮件草稿，状态栏显示「用 WhatsApp 跟进」
- 不逐张发通知（录入的人就是操作者）

来信（或卡上备注）里有压价、要折扣、要独家、侵权图案、索赔等要求时，审批标题前加 ⚠，预览最上面列出中文提醒，
见 `docs/QINGYAN_MENGXIN_TRICKY_INQUIRIES.md`。

AI 评分和卡上的 A/B/C 可能不一致（展位上记的信息少，AI 分常偏低）。跟进优先级以业务员判的等级为准。

## 邮件里的公司资料（展前填一次）

青砚 → 设置 → 邮箱绑定 →「邮件里的公司资料」（老板 / 经理可改，按版本保存，只影响之后起草的邮件）。**每一项都要梦馨确认过再填，不填就不出现**：
- 公司一句话介绍（英文）、公司数字（最多 4 个，一行「数值 | 说明」，如 `2008 | established in Jiande, Zhejiang`）、工厂照片链接
- 业务员（一行「卡上名字 | 全名 | 职务 | WhatsApp」）：卡上写 Cathy 的，落款就是全名、职务、WhatsApp，邮件里多一个 WhatsApp 按钮
- 官网（落款里显示）、公司 WhatsApp（业务员没填时用）、Logo 图片链接、页脚地址、主色
- 「起订量和交期用规格书的说法」：勾了写 “MOQ is project-dependent and quoted after specification review. Production lead time is confirmed after sample approval.”
- 「首封里提供视频看样」：确认样品间能安排再勾
- 「预览样例邮件」按已保存的资料渲染一封样例首封
- 「Reply with my details」按钮回到「公司发件身份」的回复地址（没填回复地址用发件地址）；没设发件身份就不放这个按钮

## 展后跟进：买家没回信时自动起草跟进邮件

首封跟进邮件发出后，买家一直没回信：**从首封算起第 3、7、14 天**各起草一封跟进邮件，放进审批中心，**不会自动发送**。
- 标题「跟进第 1/3 次（展会 · A 级 · 3 天未回复）：公司名」；预览照样附中文对照，有风险时最上面是 ⚠ 提醒
- 英文买家（新版，带 HTML 版）：第 1 次沿用首封主题（Re:），给一句话回复的示例 “MX-BL-001: [quantity] · to [port] · deliver by [month]”，再列一遍参考款；
  第 2 次「3 packing formats for your range, Emma」：三种包装方案（腰封 + 吊牌 / 带提手 PVC 袋 / 彩盒），问项目这季是否还在进行；
  第 3 次「Should I close your file, Emma?」：说明是近期最后一封，回 1 / 2 / 3（还感兴趣 / 下季再联系 / 不合适）
- 中文买家沿用纯文本模板：第 1 次列出报价还缺的信息；第 2 次问项目是否还在进行；第 3 次说明是近期最后一次
- 沿用首封的主题（买家邮箱里归到同一串），落款仍是卡上的业务员；不写价格 / MOQ / 交期等任何承诺
- 停止条件：买家回信、商机进入报价及之后的阶段、已有待审批草稿；同一次跟进被拒绝或过期不重复起草
- 间隔按上一封实际发出时间算（审批拖了几天，下一封也顺延，不会挤在一起）；待审批 5 天后过期；
  错过跟进时间超过 7 天的不再补起草（上线时几周前的老询盘不会一口气冒出草稿）
- 「跟进无回复客户」的行动记录照常生成，但不再单独发通知（跟进草稿已有「待审批」通知）
- 节奏可在业务规则里改：`revenue_spine.policy` 的 `followUp.noReplyFollowUpDays`（如 `[3, 7, 14]`），写 `[]` 关闭

## 展会小结（给管理层，开馆前看）

速记卡页面最下面「4. 展会小结」：当天录入的卡汇总成一段中文。
- 时间按**组织时区**：展会日是当地 07:00 到次日 07:00，每天 07:00 自动发前一天的小结。组织时区没设时是多伦多，
  梦馨要在小结上方「组织时区」选「北京时间（Asia/Shanghai）」保存一次（组织所有者 / 管理员可改，写进审计日志）。
  同一个时区也决定每日简报 07:00、微信补推 07:30、外贸每日检查 08:00、客户跟进建议 09:00 / 14:00
- 内容：录入张数和 A/B/C 分布；待审批的跟进邮件；只有 WhatsApp 的卡；草稿没完成的卡；
  A 级名单（公司、国家、联系人、下一步、业务员、卡号、备注原文）；不在参考表的款号
- 「复制」贴到微信群；「发给管理层」发青砚通知，绑定了微信的同时推送到微信。管理层 = 老板 / 经理 / 平台管理员 / 组织所有者和管理员
- **每天当地 07:00 自动发前一天的小结**；同一天同样张数只发一次，补录后张数变了会再发一版
- 展会日从当地 07:00 到次日 07:00，夜里录到凌晨也算前一天。**梦馨组织时区要设成 `Asia/Shanghai`**，否则按多伦多时间算

## 跟进邮件从哪里发出（公司发件身份）

青砚 → 设置 → 邮箱绑定 →「公司发件身份」。设了之后，审批中心批准的跟进邮件、外贸收件箱的回复、开发信都以这个身份发出，
**不用任何人的个人 Gmail**（个人 Gmail 按登录账号绑定，跨公司共用，会把梦馨的邮件从 Sunny 的邮箱发出去）。

| 项 | 梦馨填写 | 说明 |
|---|---|---|
| 发件人名称 | `Cathy \| Mengxin Home Textile` | 买家收件箱里看到的名字 |
| 发件地址 | `cathy@hlmbedding.com` | 只有平台管理员能设置；域名要在青砚的 Resend 账号里验证 |
| 回复地址 | 留空（= 发件地址） | 买家点「回复」进 Cathy 的邮箱 |
| 密送留底 | `cathy@hlmbedding.com` | 每封发出的邮件 Cathy 邮箱里都有一份 |

域名还没验证时：邮件由平台地址代发，发件人名称、回复地址、密送不变，买家回信照样到 Cathy，不会丢。页面上会显示当前状态。

验证 hlmbedding.com（一次性，青砚服务器上 `RESEND_API_KEY` 所属的 Resend 账号，不是官网那个）：
1. Resend → Domains → Add Domain → `hlmbedding.com`
2. 把 Resend 给出的 DNS 记录（`resend._domainkey` 的 TXT，`send` 子域的 MX 和 TXT）加到 hlmbedding.com 的域名解析里。
   都在子域上，不动现有的 MX，Cathy 收信不受影响
3. 回 Resend 点 Verify（几分钟到几小时）。验证通过后自动改用 `cathy@hlmbedding.com` 发出，青砚这边不用再改

## 卡号就是线索编号

- 每张卡预印唯一卡号（CF140-0001 起）。同一张卡重复上传、录到一半中断、网络断了重试，都只会补齐缺的步骤，**不会多出线索或第二封草稿**
- 中断了就重新上传同一张表，再点「开始录入」
- 同一家公司来了两位买家：两张卡各自录入，不会被当成重复（旧的「展会/名片导入」按公司名去重，会丢第二位）
- 表格里卡号重复、缺卡号、邮箱和 WhatsApp 都没有、等级不是 A/B/C 的行会标红，不会录入；改好表格重新上传即可
- 模板第 2 行是示例（卡号 CF140-0000），忘了删也不会被录入

## 状态栏说明

| 显示 | 意思 | 要做什么 |
|---|---|---|
| 草稿待审批 | 全部完成 | 第二天审批中心审核 |
| 已录入过 · 草稿待审批 | 这张卡之前录过 | 无 |
| 无邮箱，没有邮件草稿：用 WhatsApp 跟进 | 只留了 WhatsApp | 业务用 WhatsApp 跟进 |
| 商机已建，AI 草稿未完成 | AI 排队或失败 | 点「重试失败的」或重新上传同一张表 |
| 红字错误 | 没录入 | 按提示改表格，或点重试 |

## 实现要点（给工程）

- 页面 `src/app/(main)/trade/booth-cards/page.tsx`；接口 `/api/trade/booth-cards/{parse,ingest,template}`
- 解析与映射 `src/lib/trade/booth-cards.ts`（纯函数）：列名中英文都认；勾选项译成英文标签写进正文，回复语言不会因中文标签变成中文
- 录入复用 `ingestWebsiteInquiry(orgId, inquiry, { origin: { kind: "trade_show", event } })`：同一条链路，区别只在活动名、标签、商机来源（trade_show）、收据来源（trade_show，事件身份 `card:<卡号>`）和不逐张通知
- 回复草稿：`buildReplyDraft({ tradeShow: { event, styles } })`，由 FDE 按最新来信的渠道 `trade_show` 和互动里的展会名、参考款自动选择
- 款号参考表 `src/lib/trade/style-references.ts`（OrgBusinessRule `trade.style_references`，按版本发布）；接口 `/api/trade/booth-cards/styles`
- 卡上等级：互动 meta `boothGrade` → FDE 写商机 `priority`（A hot / B warm / C cold，多张卡取最高）；`daily-actions` 的重点线索包含 priority = hot
- 落款：互动 meta `boothSales`（英文名才用）→ 草稿 `senderName`；来源对象统一由 `boothCardOrigin(card, event, styles)` 生成
- 中文对照：FDE 在英文草稿之外用同一模板生成中文版，只拼进 PendingAction `preview`（`approvalPreview`），`payload.body` 只有英文
- 参考款品类名里读出的材质等不作为买家要求列出（整词匹配），避免请买家确认参考款的属性
- 展后跟进：`src/lib/revenue-spine/fde/no-reply-followup.ts`（`noReplyFollowUpDue` 判断到期，`buildNoReplyFollowUpDraft` 起草），
  `cron/revenue-spine` 每 15 分钟扫描；审批 payload 带 `followUpStep`，发送沿用 `sales.send_inquiry_reply`（买家来信后草稿过时、拒发）
- 展会小结：`src/lib/trade/booth-summary.ts`（数据来自 source = trade_show 的收据；卡上中文勾选项用 `parseBoothCardContext` 从「展会」一行读回），
  接口 `/api/trade/booth-cards/summary`；07:00 自动发送挂在 `cron/daily-brief`；通知 entityType `trade_booth_summary` 点开回到 `/trade/booth-cards?day=`
- 发件身份：OrgBusinessRule `trade.email_sender`（`src/lib/trade/email-sender.ts`，接口 `/api/trade/email-sender`）。
  `exec-sales-inquiry-reply` 有组织身份时只走 Resend（不回落个人 Gmail）；`sendAsOrg` 先用组织地址，Resend 拒收发件域名时用平台地址重发；
  外贸收件箱回复 / 开发信 / 序列跟进经 `sendTradeEmailForOrg` 同一出口。发件地址只有平台管理员能改（Resend 账号各组织共用，防冒用域名）
- 新版邮件：`src/lib/revenue-spine/email-layout.ts`（`EmailDoc` → `renderEmailText` / `renderEmailHtml`，表格布局 + 内联样式；文字一律转义，链接只收 https / mailto；
  `renderPlainEmailHtml` 给官网询盘的纯文本回复套同一个外框）、`booth-email.ts`（`composeBoothFirstEmail` / `composeFollowUpEmail`，英文发送 + 中文对照）、
  `email-profile.ts`（OrgBusinessRule `trade.email_profile`，接口 `/api/trade/email-profile`，`?sample=1` 出样例）。
  FDE：最新来信是展位面谈且草稿是英文 → 新版首封（不过 AI 润色）；其它草稿照旧（模板 + 可选润色）再套外框。
  审批不能改内容，所以 HTML 在起草时就渲染好放进 `payload.html`；`exec-sales-inquiry-reply` 经 Resend 发 text + html，Gmail 通道只发 text。
  预览：`/api/revenue/opportunities/[id]/email-preview?pendingActionId=`，页面放进 `sandbox` iframe
- 测试：`src/lib/trade/__tests__/booth-cards.test.ts`、`booth-cards-db.isolated.test.ts`（隔离库端到端）、`src/lib/revenue-spine/__tests__/scoring-draft.test.ts`、
  `src/lib/revenue-spine/__tests__/booth-email.test.ts`
