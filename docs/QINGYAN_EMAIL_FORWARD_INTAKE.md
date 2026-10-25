# 邮件转发询盘入站（PRD F1.2 / F6.3b）

适用：`POST /api/trade/webhook/email`（Resend Inbound `email.received`）、外贸「消息通道」页的「邮件转发询盘」通道、入驻向导的「邮件转发入口」步骤。
本文只描述通用机制，不含任何租户数据。

## 1. 一句话

业务员把询盘邮件（客户来信、官网询盘通知、B2B 平台询盘通知）转发到本企业的询盘邮箱 `inq-xxxxxxxxxx@<INBOUND_EMAIL_DOMAIN>`；
青砚验签后按收件别名找到企业，解析出买家，走与网站询盘**同一条链路**（收据 → Trade 线索 → Revenue Spine 商机 → `after()` 里的 FDE 草稿），请求内不跑 LLM。
来源不可信或识别不出买家的邮件**隔离**（只记收据 + 通知企业管理员），官网已经推送过的同一询盘记**重复**（不建商机）。

## 2. 请求路径

| 步骤 | 内容 | 失败时 |
|---|---|---|
| 验签 | `svix-id / svix-timestamp / svix-signature`，密钥 `RESEND_INBOUND_WEBHOOK_SECRET`，用 resend SDK 的 `webhooks.verify`（Svix，时间戳容差 5 分钟）。**先于任何 DB 访问** | 未配置 503；签名错 / 过期 401；正文非 JSON 400 |
| 事件类型 | 只处理 `email.received` | 其它 200 `ignored` |
| 组织 | 收件人（to / cc / bcc）里第一个 `inq-<10 位 base32>@<INBOUND_EMAIL_DOMAIN>`（忽略大小写和 `+tag`）→ `TradeChannel(channel="email", status="active", config.inboundAlias)`；同一别名命中多条通道一律拒绝 | 未配置收信域名 503；未知别名 200 `ignored` |
| 幂等 | `eventId = "email:<Message-ID>"`（超过 120 字符改为 `email:sha256:<40 位摘要>`；没有 Message-ID 时 `email:resend:<email_id>`），收据 `source="email"` | 已隔离 / 已判重复的直接返回原结论；已入链的按首次载荷重放（只补缺失步骤） |
| 正文 | 载荷里的 `text` / `html`；没有就经可注入的 fetcher 调 Resend receiving API（`GET /emails/receiving/{id}`，需 `RESEND_API_KEY`） | 取不到 502（Resend 重试） |
| 解析 | `src/lib/trade/email-forward-parse.ts`（纯函数，见 §4） | — |
| 隔离判定 | 任一成立即隔离：转发人不在 `config.forwarderAllowlist`；DKIM / DMARC 未通过或缺少结果；没有买家邮箱也没有电话 | 200 `quarantined` |
| 双重入站 | 转发的是官网自己的内部询盘通知、且该询盘已由官网 webhook 入站：按正文里的官网询盘编号（`Inquiry ID / eventId: …`）找同组织 `source="website"` 收据；或 48 小时内同联系人 + 同留言的官网收据（内容孪生） | 200 `duplicate` |
| 入链 | `ingestWebsiteInquiry(orgId, inquiry, { origin: { kind: "email_forward", subject }, fdeMode: "deferred" })`：活动「邮件转发询盘」、线索 / 商机来源 `email`、互动渠道 `email`、FDE 交给 `after()` | 主干建链失败 500（Resend 重试，重放补齐） |

路由 `maxDuration = 300`（静态字面量）：`after()` 里的 FDE 计入同一函数的时长，与网站 webhook 相同；`FDE_CLAIM_STALE_MS`（10 min）与 `RECEIPT_PROCESSING_STALE_MS`（6 min）都大于它。

## 3. 收据状态

在 `WebsiteInquiryReceipt` 原有状态之外，邮件转发新增两个终态（不需要迁移，`status` 是字符串列）：

- `quarantined`：未建任何业务对象。`payload.meta.quarantine.reasons` 记原因（`sender_not_allowed` / `auth_unverified` / `no_buyer_contact`）。企业 owner / 管理员收到一条站内通知（`type=system`，幂等键 `email-quarantine:<收据 id>:<用户 id>`）。
- `duplicate`：`duplicateOfReceiptId` 指向官网收据，并带上它的客户 / 商机 id 作关联；不带 `salesActionId`，FDE 回填不会改它。`payload.meta.duplicate.matchedBy` = `website_inquiry_id` 或 `content_twin`。

这两种收据不参与「同内容 = 同事件」判定（`findByPayloadHash` 排除它们）：被隔离过的内容之后由可信转发人转来，照常作为新事件入链。

`payload.meta`（不参与业务指纹）还记录：Message-ID、Resend email_id、转发人、收件地址、原主题、解析格式 / 平台 / 平台询盘编号 / 官网询盘编号 / 数量 / 置信度 / 解析依据、DKIM·DMARC 结论。

## 4. 解析规则（尽力而为，带置信度）

- 转发头：Gmail「---------- Forwarded message ---------」、Outlook「From / Sent / To / Subject」（含 `-----Original Message-----`、下划线分隔、`[mailto:]`）、Apple Mail「Begin forwarded message:」、QQ / Foxmail「原始邮件」与中文头。头块要求 From 之后至少出现 Date/Sent、To、Subject 中的两个。
- 转发套转发 / 回复链：从外往里找第一封不是本厂人员发出的邮件。本厂人员 = 转发人、白名单、收件人、收信域名、以及转发人的企业域名（免费邮箱域不算同域同事）。
- 平台通知：发件域名是 alibaba.com / made-in-china.com / globalsources.com，或正文点名平台且带询盘字段 → 取买家名、公司、国家、产品、数量、平台询盘编号。平台通常隐藏买家邮箱，此时按「无买家联系方式」隔离，由业务员在平台内回复。
- 官网通知：带「Inquiry ID / eventId」，或系统 / 本厂地址发出的「New (Website) Inquiry」+ 标签字段。
- 去掉引用的历史回复（On … wrote: / 在 … 写道 / `>` 引用）与签名；签名里的电话、公司先取出来（只取买家那封的签名，绝不取转发人自己的签名）。
- **不变量**：转发人、白名单、本厂同域地址、no-reply 类系统地址、平台中转地址永远不会被选为买家。

## 5. 配置与开通（人工步骤）

1. Resend 控制台：为收信域名（如 `in.<平台域名>`）开启 Receiving，按提示把 MX 指向 Resend 并完成验证。
2. Resend 控制台 → Webhooks：新增 `https://<青砚域名>/api/trade/webhook/email`，事件勾选 `email.received`，复制 Signing secret。
3. 环境变量（见 `.env.example`）：`RESEND_INBOUND_WEBHOOK_SECRET`、`INBOUND_EMAIL_DOMAIN`，以及已有的 `RESEND_API_KEY`（载荷不带正文时读取正文）。可选 `INBOUND_EMAIL_AUTHSERV_ID`：只信任该 authserv-id 写入的 `Authentication-Results`。
4. **上线前用一封真实转发验证**：确认 Resend 的载荷 / receiving API 里带 `Authentication-Results`（DKIM / DMARC 结论）。若没有，所有邮件都会以 `auth_unverified` 被隔离——这是安全默认，需要先确定可信的验证来源再放开。
5. 企业侧：外贸 →「消息通道」→ 添加「邮件转发询盘」，填允许转发的业务员邮箱（白名单）。未配置 `INBOUND_EMAIL_DOMAIN` 时页面显示「未开通」，不生成地址。

## 6. 已知限制

- 邮箱客户端的「自动转发规则」会保留原发件人（买家 / 平台地址），因此不在白名单内会被隔离；目前只支持业务员手动转发，或把平台通知地址加入白名单。
- 以附件方式转发（.eml 附件）不解析，正文里识别不出买家 → 隔离。
- 隔离邮件暂无「放行」界面：管理员确认后把发件人加入白名单，请业务员重新转发即可（新 Message-ID，按新事件处理）。
- 双重入站只识别「官网先入站、转发后到」；转发先到、官网后到的极少见情况仍会建两条事件（客户匹配会把它们归到同一客户 / 开放商机）。
