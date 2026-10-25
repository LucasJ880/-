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
- **媒体与交互**：正文记「[type] 说明文字」——`[image]`、`[video]`、`[document: <文件名>]`、`[voice message]` / `[audio]`、`[location]`、`[contact]`、`[button]`、`[option]`（按钮回复 / 列表选择）、`[order]`。标签用英文：它是买家消息正文的一部分，会进语言识别（`detectLanguage` 按 CJK 占比）和 RFQ 抽取，中文标签会把只发图片 / 语音的外国买家判成中文、FDE 草稿跟着改用中文。媒体本身不下载（Meta 媒体 id 需要通道 accessToken 换取，30 天后失效），业务员按标签回 WhatsApp 查看。
- **不做内容去重**：wamid 由平台保证唯一，同一买家一天里两次「ok」、两条语音、两张不带说明的图都是不同消息，各自建 Trade 消息 / 互动 / FDE 行动。三层都按此处理：收据不找「同内容的既有事件」（`claimInquiryReceipt(..., { contentDedupe: false })`）；`inspectChain` 的同正文兜底只认领没有被别的收据登记过的 Trade 消息；intake 的重放只按 `sourceRef.externalId`（wamid）判定（`replayKey: "external_id"`）。业务指纹 `computePayloadHash` 不变。
- **同一发信人串行**：按 `(orgId, wa_id)` 取**非阻塞租约**——收据表里一行 `source="whatsapp_sender", eventId=<wa_id>`，`status=processing` 表示有请求在处理该发信人的消息（`tryAcquireEventLease` / `releaseEventLease`，按令牌释放）。等待时 sleep 轮询（100 ms 起、最长 1 s 间隔），**不占 DB 连接**；最多等 `SENDER_LEASE_MAX_WAIT_MS = 10 s`，等不到本条记 busy（→ 500，Meta 重投）；持有者中断后 `SENDER_LEASE_STALE_MS = 2 min` 可被接管。买家一次转发几张图时 Meta 会并发投递多个 webhook，不串行会各自建出新客户 / 新商机（DB 测试已验证）。以前用 `pg_advisory_xact_lock`：锁事务占一条连接从头开到尾、ingest 又走其它连接，并发请求数一到 `connection_limit` 就全部在 `pool_timeout` 后失败（不同发信人也一样），已弃用；DB 测试整套跑在 `connection_limit=3` 的小连接池上，含不同发信人并发与同一发信人连发。
- **通知**：一个号码的第一条消息（新建 Trade 线索）通知全体外贸成员 + 商机负责人；同一号码的后续消息只通知商机负责人（intake 的通知），不再逐条广播。
- **至少一次**：有条目处理抛错、Revenue Spine intake 失败（`ingestWebsiteInquiry` 把 intake 异常收成 `SPINE_FAILED` 返回：Trade 消息已落、主干未建），收据被一个中断的请求占着（`busy`，`processing` 未超过 `RECEIPT_PROCESSING_STALE_MS`），或发信人租约等不到 → 返回 500，Meta 重投整批；已处理的条目按收据幂等，重投只补缺失步骤（过期后的重投会补齐中断的条目）。WhatsApp 来信总有电话和正文，intake 的确定性失败（无联系方式 / 空正文）不会出现，所以 500 只来自暂时性故障。

### 2.2 沿用的既有不变量（不是缺陷，但要知道）

- 买家先在网站留了邮箱（Trade 线索按邮箱建），后来发 WhatsApp：会多一条「WhatsApp <号码>」占位线索，两条 Trade 线索都关联到**同一个**商机（Trade 线索只是展示视图，商机是唯一事实）。
- 只读状态接口 `GET /api/trade/webhook/website/status` 只查网站事件；WhatsApp 事件的状态看收据 / 商机。

## 3. 客户去重（`src/lib/revenue-spine/customer-match.ts`）

顺序改为：**邮箱 → 电话（E.164）→ 企业域名（免费邮箱域名不算）→ 规范化公司名**。公司名仍自动合并（行为不变）。

电话比对（`src/lib/revenue-spine/phone.ts`，纯函数、零依赖）：**两边都能归一成可信的 E.164（各用自己的国家提示）且相等才算同一号码**，否则电话这一级不参与。

- 归一规则：`+` / `00` / 该国国际冠码（北美 011、澳大利亚 0011、日本 010）开头按国际格式；否则用国家提示（询盘填的国家；客户档案的国家）去掉国内长途前缀（多数国家 0、北美 1；意大利等首位 0 属于号码本身）后加国家码。国家提示认英文名、ISO 两位码、lexicon 里的中文名 / 别名 / 城市。没有国家提示的本地号 → 无法归一，不参与（不借用另一边的国家码去猜，也不比较原始数字串）。
- 可信：国家码存在、总长 8–15 位；北美恰 11 位且区号 / 局号首位 2–9。
- 占位号不参与（`isPlaceholderPhone`）：国内号码全是同一个数字、含 7 位以上相同数字、或整串是连续递增 / 递减数字（`0000000000`、`1234567890`、`9876543210` …）。
- WhatsApp wa_id 已知写法差异归一：墨西哥手机 `+52 1 …`（13 位）→ `+52 …`；阿根廷手机 `+54 9 …`（13 位）→ `+54 …`。这样 WhatsApp 号码与网站表单的 E.164 写法能对上。
- 同号但两边是**不同的企业邮箱域名**（总机 / 代理共用号码）→ 不按电话合并，记为候选，交给第 3 级域名判断。WhatsApp 来信没有邮箱，不受影响。

旧规则「取末 10 位」会把不同国家、尾号相同的号码合成一个客户，已不再使用（`buildDedupeKeys().phone` 仍是旧格式，只用于判断有没有电话；`phoneE164` = 可参与去重的 E.164）。

候选：电话没有索引列（本轮不做迁移），按国内号码数字预筛——`regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%<国内号码>%'`（本组织、未归档，最早建立的 50 个），再逐个精确比对；任何能匹配上的写法数字串里都含国内号码，所以预筛只会多、不会漏，也不再受「最近 500 个」限制。同号多个客户取最早建立的。号码库是精简规则（不判断号段合法性），宁可漏合并也不误合并。

## 4. 微信公众号

- 处理前按 `MsgId`（无则 `FromUserName:CreateTime`）认领收据 `WebsiteInquiryReceipt(orgId, source="wechat", eventId)`：
  - 首次 → 处理；已处理（`complete`）→ 直接回 `success`；另一请求正在处理且认领不到 4 秒（`WECHAT_RECEIPT_STALE_MS`）→ 直接回 `success`（微信 5 秒没收到回应会重发，共 3 次）；
  - 认领超过 4 秒仍是 `processing` → 视为首个请求已中断（冷启动超时 / 实例被回收），重发再认领并写入，消息不会永久丢失。代价：首个请求若只是慢、最后也写完，会多一条重复消息（改动前每次重发都会重复写）；
  - 处理抛错 → 收据释放为 `received`，重试窗口内的重发会再处理一次（对微信仍回 `success`，行为不变）。
- 收据只存定位信息（openid / 公众号原始 id / 类型 / CreateTime），不存正文。
- 仍走 `processInboundMessage`（Trade 线索 + 消息 + `TradeInquiryAnalysis` + 通知）。**不进 Revenue Spine**：公众号来信只有 openid，没有电话 / 邮箱，客户去重（邮箱 → 电话 → 域名）无从下手；需要进主干时由业务员在商机里手工录入（`source=wechat` 已是合法商机来源）。

## 5. 来源与渠道词表

- `OPPORTUNITY_SOURCES` 新增 `whatsapp`、`wechat`（中文标签「WhatsApp」「微信」，老板今日视图 / 早报共用）。
- intake 未指定 `meta.channel` 时：`whatsapp → channel=whatsapp, type=whatsapp`；`wechat → channel=wechat, type=wechat`；其余来源保持原映射。
- 收据来源常量：`WHATSAPP_INBOUND_SOURCE = "whatsapp"`、`WECHAT_INBOUND_SOURCE = "wechat"`（与 `website`、`trade_show` 事件身份空间互相独立）。`WHATSAPP_SENDER_LEASE_SOURCE = "whatsapp_sender"` 的行是发信人租约、**不是事件**（每个发信人一行，`complete` = 空闲），统计收据时按 `source` 过滤即可排除。业务指纹 `computePayloadHash` 不变（不含来源页 / UTM / eventId）。

## 6. 运维

- Meta 后台 webhook 地址：`https://<域名>/api/trade/webhook/whatsapp`，订阅 `messages`；环境变量 `WHATSAPP_VERIFY_TOKEN`、`WHATSAPP_APP_SECRET`（已有）。
- 每个工厂在外贸渠道页配置 WhatsApp 通道，`config.phoneNumberId` 必须等于 Meta 的 `phone_number_id`。
- 发信人串行不再占连接（非阻塞租约），对连接池大小没有额外要求。
- 测试：`src/lib/revenue-spine/__tests__/phone-match.test.ts`、`src/lib/trade/__tests__/whatsapp-inbound.test.ts`、`src/lib/trade/__tests__/channels-to-spine-db.isolated.test.ts`（隔离库）。
