# WhatsApp / 微信来信进 Revenue Spine + 去重（PRD F2.2–F2.4）

适用：`POST /api/trade/webhook/whatsapp`、`POST /api/trade/webhook/wechat`，以及 Revenue Spine 的客户去重（`matchCustomer`）。
本文只描述通用机制，不含任何租户数据。异步 FDE 的认领 / cron 兜底见 `docs/QINGYAN_WEBSITE_INTAKE_ASYNC.md`。

## 1. 一句话

WhatsApp 每条来信走**一条管线**：收据 → Trade 线索 / 消息 → Revenue Spine intake（按电话去重）后立即返回，FDE 在响应之后由 `after()` 执行（原子认领，cron 兜底）。不再另跑 `TradeInquiryAnalysis`。
微信公众号来信只按 `MsgId` 去重，**仍只走 Trade 通道**（openid 没有电话 / 邮箱，进不了客户去重）。

## 2. WhatsApp：请求路径

| 步骤 | 内容 |
|---|---|
| 验签 | `X-Hub-Signature-256` + `WHATSAPP_APP_SECRET`（不变） |
| 组织 | 每个条目按 `metadata.phone_number_id` → `TradeChannel(whatsapp).config.phoneNumberId` 解析；载荷里的任何 org 标识都不信 |
| 收据 | `WebsiteInquiryReceipt(orgId, source="whatsapp", eventId=wamid)`，在任何业务写入之前认领 |
| Trade | 活动「渠道询盘」；线索按占位名「WhatsApp <号码>」复用（与旧 Trade 通道建的线索同名）；消息 `channel=whatsapp` |
| Revenue Spine | `intakeInquiry(source="whatsapp", contact.phone="+<wa_id>", contact.name=contacts[].profile.name)` → 客户 / 商机 / 互动（`channel=type=whatsapp`）/ FDE 行动（`queued`） |
| FDE | `after()` 回调认领后执行；买家没有邮箱时照常抽取 / 评分，但**不建审批草稿**（既有规则：草稿只发往邮箱） |

实现：`src/lib/trade/whatsapp-inbound.ts`（`processWhatsAppWebhook`），复用 `ingestWebsiteInquiry(orgId, inquiry, { origin: { kind: "whatsapp" }, fdeMode: "deferred" })`。路由段配置 `runtime = "nodejs"`、`maxDuration = 300`（静态字面量；`after()` 里的 FDE 计入同一函数时长，与网站 webhook 相同）。

### 2.1 批次规则

- **同一 wamid 再次投递**（Meta 重试）：收据命中 → 只补缺失步骤，不重复建任何对象；全部已完成 = 空操作（`attempts+1`）。
- **phone_number_id 缺失或不属于任何组织**：只跳过该条目并记日志，整批仍 200（以前是整批 400 / 403）。
- **不进询盘的类型**：`reaction`、`sticker`、`system`、`unsupported` / `unknown`。
- **媒体与交互**：正文记「[类型] 说明文字」——`[图片]`、`[视频]`、`[文件：<文件名>]`、`[语音消息]` / `[音频]`、`[位置]`、`[名片]`、`[按钮]`、`[选项]`（按钮回复 / 列表选择）、`[订单]`。媒体本身不下载（Meta 媒体 id 需要通道 accessToken 换取，30 天后失效），业务员按标签回 WhatsApp 查看。
- **同一发信人串行**：按 `(orgId, wa_id)` 取事务级 advisory lock（`pg_advisory_xact_lock`，与 assistant 跟进任务同一模式）。买家一次转发几张图时 Meta 会并发投递多个 webhook，不串行会各自建出新客户 / 新商机（DB 测试已验证）。锁事务 `timeout 60 s / maxWait 10 s`；回调里的写入走普通连接，所以连接池必须大于 1。
- **至少一次**：有条目处理抛错、Revenue Spine intake 失败（`ingestWebsiteInquiry` 把 intake 异常收成 `SPINE_FAILED` 返回：Trade 消息已落、主干未建），或收据被一个中断的请求占着（`busy`，`processing` 未超过 `RECEIPT_PROCESSING_STALE_MS`）→ 返回 500，Meta 重投整批；已处理的条目按收据幂等，重投只补缺失步骤（过期后的重投会补齐中断的条目）。WhatsApp 来信总有电话和正文，intake 的确定性失败（无联系方式 / 空正文）不会出现，所以 500 只来自暂时性故障。

### 2.2 沿用的既有不变量（不是缺陷，但要知道）

- 同一号码 24 小时内发了**完全相同的文字**（例如两次 "hi"）：第二条按内容重复记一张指向原事件的收据，不写第二条 Trade 消息 / 互动（收据层与 intake 层都有 24 小时内容去重窗口）。
- 买家先在网站留了邮箱（Trade 线索按邮箱建），后来发 WhatsApp：会多一条「WhatsApp <号码>」占位线索，两条 Trade 线索都关联到**同一个**商机（Trade 线索只是展示视图，商机是唯一事实）。
- 只读状态接口 `GET /api/trade/webhook/website/status` 只查网站事件；WhatsApp 事件的状态看收据 / 商机。

## 3. 客户去重（`src/lib/revenue-spine/customer-match.ts`）

顺序改为：**邮箱 → 电话（E.164）→ 企业域名（免费邮箱域名不算）→ 规范化公司名**。公司名仍自动合并（行为不变）。

电话比对（`src/lib/revenue-spine/phone.ts`，纯函数、零依赖）：

1. 两边都能归一 → E.164 相等。归一规则：`+` / `00` / 该国国际冠码（北美 011、澳大利亚 0011、日本 010）开头按国际格式；否则用国家提示（询盘填的国家；客户档案的国家）去掉国内长途前缀（多数国家 0、北美 1；意大利等首位 0 属于号码本身）后加国家码。国家提示认英文名、ISO 两位码、lexicon 里的中文名 / 别名 / 城市。
2. 只有一边能归一、另一边是没写国家码的本地号且没有（或同一个）国家提示 → 借用已知一边的国家码比对。另一边明确是别的国家 → 不同号码。
3. 两边都不能归一 → 只有数字串完全相同才算。

旧规则「取末 10 位」会把不同国家、尾号相同的号码合成一个客户，已不再使用（`buildDedupeKeys().phone` 仍是旧格式，只用于判断有没有电话；新增 `phoneE164`）。

限制：电话没有索引列（本轮不做迁移），只在本组织**最近更新的 500 个有电话的客户**里比对；同号多个客户取最早建立的。号码库是精简规则（不判断号段合法性），宁可漏合并也不误合并。

## 4. 微信公众号

- 处理前按 `MsgId`（无则 `FromUserName:CreateTime`）认领收据 `WebsiteInquiryReceipt(orgId, source="wechat", eventId)`：
  - 首次 → 处理；已处理（`complete`）→ 直接回 `success`；另一请求正在处理 → 直接回 `success`（微信 5 秒没收到回应会重发，共 3 次）；
  - 处理抛错 → 收据释放为 `received`，重试窗口内的重发会再处理一次（对微信仍回 `success`，行为不变）。
- 收据只存定位信息（openid / 公众号原始 id / 类型 / CreateTime），不存正文。
- 仍走 `processInboundMessage`（Trade 线索 + 消息 + `TradeInquiryAnalysis` + 通知）。**不进 Revenue Spine**：公众号来信只有 openid，没有电话 / 邮箱，客户去重（邮箱 → 电话 → 域名）无从下手；需要进主干时由业务员在商机里手工录入（`source=wechat` 已是合法商机来源）。

## 5. 来源与渠道词表

- `OPPORTUNITY_SOURCES` 新增 `whatsapp`、`wechat`（中文标签「WhatsApp」「微信」，老板今日视图 / 早报共用）。
- intake 未指定 `meta.channel` 时：`whatsapp → channel=whatsapp, type=whatsapp`；`wechat → channel=wechat, type=wechat`；其余来源保持原映射。
- 收据来源常量：`WHATSAPP_INBOUND_SOURCE = "whatsapp"`、`WECHAT_INBOUND_SOURCE = "wechat"`（与 `website`、`trade_show` 事件身份空间互相独立）。业务指纹 `computePayloadHash` 不变（不含来源页 / UTM / eventId）。

## 6. 运维

- Meta 后台 webhook 地址：`https://<域名>/api/trade/webhook/whatsapp`，订阅 `messages`；环境变量 `WHATSAPP_VERIFY_TOKEN`、`WHATSAPP_APP_SECRET`（已有）。
- 每个工厂在外贸渠道页配置 WhatsApp 通道，`config.phoneNumberId` 必须等于 Meta 的 `phone_number_id`。
- 数据库连接池须大于 1（advisory lock 事务占一个连接，回调里的写入用其它连接）；`connection_limit=1` 的连接串会让 WhatsApp 入站在 `pool_timeout` 后失败（返回 500，Meta 重投）。
- 测试：`src/lib/revenue-spine/__tests__/phone-match.test.ts`、`src/lib/trade/__tests__/whatsapp-inbound.test.ts`、`src/lib/trade/__tests__/channels-to-spine-db.isolated.test.ts`（隔离库）。
