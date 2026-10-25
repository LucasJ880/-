# 网站询盘接入（PRD F1.1 / F1.4）

适用：任何工厂 / 外贸企业把自己网站上的询盘接进青砚。两种方式任选其一：

| | 方式一：服务器转发 | 方式二：嵌入表单 |
|---|---|---|
| 适合 | 有开发能力、已有自己的询盘表单 / 后端 | 零代码，复制一行 `<script>` |
| 接口 | `POST /api/trade/webhook/website` | `POST /api/trade/webhook/website/embed`（脚本自动调用） |
| 凭证 | 服务端密钥，请求头 `x-qingyan-webhook-secret` | 公开 key，请求头 `x-qingyan-form-key` + 来源域名白名单 |
| 凭证放在哪 | **只在网站服务器上**（环境变量） | 网页里（公开 key 本身不是机密） |
| 防滥用 | 密钥 | 来源白名单 + 蜜罐 + 限流 |
| 幂等 | 站点自己的 `eventId` | 脚本生成的 uuid（`emb:<uuid>`） |
| 响应 | 完整处理快照（见 §2.4） | 只有 `{ ok, receiptId }` |

两种方式进入同一条链路：收据 → Trade 线索 / 消息 → Revenue Spine（客户 / 商机 / 互动 / 行动）后立即返回，AI 研究 / 评分 / 回复草稿在响应之后执行（`after()` + 原子认领 + cron 兜底），回复草稿进审批，**不会自动发给买家**。机制细节见 [QINGYAN_WEBSITE_INTAKE_ASYNC.md](./QINGYAN_WEBSITE_INTAKE_ASYNC.md)。

凭证与白名单在青砚「外贸 → 消息通道 → 网站询盘表单」里查看和管理，只有**企业负责人 / 企业管理员**（以及平台管理员）能看到完整凭证；其他成员只看到末 4 位。

本文只描述通用机制，不含任何租户数据。

---

## 1. 字段

两种方式共用（JSON；服务器转发也接受 `application/x-www-form-urlencoded` / `multipart/form-data`）。超长截断，空白折叠。

| 字段 | 别名 | 上限 | 说明 |
|---|---|---|---|
| `name` | `contact`、`contactName` | 120 | 联系人 |
| `email` | — | 200 | 小写化；格式错误 → 400。服务器转发要求邮箱或电话至少一项；嵌入表单要求邮箱 |
| `phone` | `whatsapp` | 60 | |
| `company` | `companyName` | 200 | |
| `country` | — | 80 | |
| `product` | `interest` | 200 | 感兴趣的产品 |
| `message` | `inquiry`、`content` | 4000 | 嵌入表单的「数量」并入留言开头（`Quantity: …`）。`message` 与 `product` 都为空的询盘建不了商机：嵌入表单要求产品 / 数量 / 留言至少一项（否则 400 `message_required`） |
| `website` | `buyerWebsite` | 300 | 买家公司网站（仅服务器转发） |
| `page` | `landingPage` | 500 | 提交时所在页面 |
| `referrer` | `referer` | 500 | 首访 `document.referrer` |
| `landing` | — | 500 | 首访落地页 |
| `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` / `utm_term` | — | 120 | |
| `eventId` | `event_id` | 120 | 站点侧询盘编号（幂等键，见 §2.2） |
| `_hp`、`website_url` | — | — | 蜜罐：有值即视为机器人，返回成功但不落库 |

业务指纹（判断"同一询盘内容"）只看联系人 / 公司 / 国家 / 产品 / 买家网站 / 留言；`page`、`referrer`、`landing`、UTM、`eventId` 变化不算内容变化。

## 2. 方式一：服务器转发

### 2.1 请求

```
POST /api/trade/webhook/website
Content-Type: application/json
x-qingyan-webhook-secret: <服务端密钥>

{"eventId":"inq_20261024_0001","name":"Jane Doe","email":"jane@example.com","company":"Example Textiles","country":"Canada","product":"Waffle bathrobe","message":"500 pcs, 380 gsm","page":"https://www.example.com/contact"}
```

- 密钥只放在服务器环境变量里。**不要**写进网页 HTML / 前端 JS：浏览器里的任何人都能看到并冒用。
- 兼容旧接入：也接受 `?secret=` 与请求体 `secret`，但会进访问日志，新接入只用请求头。
- 青砚渠道页有 curl 与 PHP 示例（密钥从环境变量读取）。

### 2.2 幂等（eventId）

- 带 `eventId`：同一组织内同一 `eventId` 只建一次线索 / 商机 / 互动。重发只补齐此前中断的步骤；同一 `eventId` 带了不同内容只记冲突（`conflict=true`），不覆盖首次内容。
- 不带 `eventId`（旧接入）：24 小时内相同内容视为同一询盘。
- 不同 `eventId`、相同内容：建立独立收据并指向原询盘（`contentDuplicateOf`），业务对象复用。

### 2.3 重试规则

| 情况 | 站点应做 |
|---|---|
| 网络错误 / 超时 / HTTP 5xx | 用**同一 `eventId`** 退避重试（例如 1 分钟、5 分钟、30 分钟） |
| HTTP 200，`spine` 为 `SPINE_FAILED` / `INCOMPLETE` | 同一 `eventId` 重试，青砚补齐缺失步骤 |
| HTTP 200，`busy=true` | 同一事件正在处理，稍后用同一 `eventId` 查状态或重发 |
| HTTP 200，`complete=false`、`fde.terminal=false` | 已收到，AI 草稿在后台生成；可用 §2.5 状态接口观察，不必重发 |
| HTTP 400 | 字段问题，修正后再发（重发不会成功） |
| HTTP 401 | 密钥错误或已过宽限期，换成渠道页上的当前密钥 |

### 2.4 响应（HTTP 200，字段来自真实记录）

`{ ok, eventId, receiptId, prospectId, messageId, opportunityId, duplicate, replay, recovered, recoveredSteps, busy, conflict, contentDuplicateOf, complete, spine, fde{status, terminal, reason, agentRunId, pendingActionId, scheduled} }`

HTTP 200 不代表全链完成：按 `spine` / `opportunityId` / `complete` / `fde.terminal` 判断。首个响应通常是 `spine=ok`、`complete=false`、`fde.status=queued`。"处理完成"指回复草稿已生成、等待人工审批，不是已经回复买家。详见 [QINGYAN_WEBSITE_INTAKE_ASYNC.md §3](./QINGYAN_WEBSITE_INTAKE_ASYNC.md)。

### 2.5 状态接口（只读）

```
GET /api/trade/webhook/website/status?eventId=<eventId>
x-qingyan-webhook-secret: <服务端密钥>
```

- 只认请求头里的密钥（不接受 `?secret=` 或请求体）；组织由密钥在服务端解析，查不到他组织的事件。`/api/trade/webhook/*` 在 middleware 公开路径里，鉴权完全在路由内。
- 返回与 POST 相同的快照字段外加 `receiptStatus`；`busy=true` 表示该事件的请求路径此刻正在处理。
- 只读：不认领收据、不增加 `attempts`、不安排也不执行 FDE。
- 401 密钥错误 / 400 缺 eventId / 404 未知事件。只给服务器调用，不开放 CORS。

### 2.6 密钥轮换（带宽限期）

渠道页「轮换密钥」：新密钥立即生效，**被换下的密钥在 72 小时内仍被 POST 与状态接口接受**，到期后 401。在宽限期内把网站服务器上的密钥换成新的即可，不丢询盘。

- 宽限期内再次轮换：此前的旧密钥**保留各自的到期时间**，不会因为又轮换了一次而提前失效（网站服务器上还没换掉的那个密钥照常可用）。渠道页逐个列出仍有效的旧密钥（末 4 位）与到期时间。
- 宽限期内最多同时保留 3 个旧密钥；已满时再轮换返回 409，并提示最早一个旧密钥何时到期。
- 「立即停用旧密钥」：马上结束宽限期，只剩当前密钥有效（密钥泄露时用；仍在用旧密钥的服务器会立刻 401）。

> 曾经按旧版渠道页把密钥写在网页前端代码里的站点：请改用方式二（嵌入表单）或服务器转发，然后轮换密钥，让已暴露的旧密钥在宽限期后失效。

## 3. 方式二：嵌入表单

### 3.1 放到网页上

先在渠道页「启用嵌入表单」，填写**允许的来源域名**，再把嵌入代码放到要显示表单的位置：

```html
<script src="https://<青砚域名>/embed/inquiry.js" data-key="qyk_…" data-lang="en" async></script>
```

| 属性 | 说明 |
|---|---|
| `data-key` | 公开 key（必填） |
| `data-lang` | `en`（默认）或 `zh`：表单文字、错误与成功提示 |
| `data-product` | 预填「感兴趣的产品」，适合放在产品页 |
| `data-target` | CSS 选择器，渲染到该元素里；默认渲染在 script 标签之后 |
| `data-api` | 青砚接口来源（如 `https://<青砚域名>`）；默认取脚本 `src` 的来源，脚本放在 CDN 上时才需要 |

表单在 Shadow DOM 里渲染（不受站点样式影响），字段：姓名、邮箱、电话 / WhatsApp（选填）、公司、国家 / 地区、感兴趣的产品、数量、留言；带蜜罐、无障碍标签、手机端适配。可用 CSS 变量调整外观（设置在宿主元素 `[data-qingyan-inquiry]` 或其祖先上）：`--qy-accent`、`--qy-accent-text`、`--qy-text`、`--qy-muted`、`--qy-border`、`--qy-radius`、`--qy-font`、`--qy-input-bg`、`--qy-max-width`。

提交成功后，宿主元素派发 `qingyan:inquiry-submitted` 事件（`detail.receiptId`，冒泡），站点可以接自己的统计。

### 3.2 来源域名白名单

- 精确匹配 `scheme://host[:port]`：`https://www.example.com` 与 `https://example.com`、`http://` 与 `https://` 是不同来源，需要分别填写；不能带路径、不能用通配符；最多 20 个。
- 请求的 `Origin` 不在白名单 → 403，且响应不带 CORS 头（浏览器拿不到内容）。缺失 `Origin`（服务器直接调用）也是 403——服务器请用方式一。
- 预检（`OPTIONS`）不带请求头的值，所以脚本把公开 key 也放在地址里：`POST /api/trade/webhook/website/embed?k=<公开 key>`。预检只在该 key 对应通道的白名单里有这个来源时才回显 CORS；没有 `k` 或 key / 来源不匹配都不回显（不能用预检探测哪些来源登记过）。鉴权仍只认请求头 `x-qingyan-form-key`。自己写前端调用本接口时也要带上 `?k=`。
- 删除来源后，浏览器缓存的预检最多 10 分钟失效。

### 3.3 公开 key

- 格式 `qyk_` + 32 个 base64url 字符。写在网页里，本身不是机密；`Origin` 头也能被非浏览器伪造，所以真正挡滥用的是蜜罐与限流。
- 「轮换公开 key」立即生效，旧嵌入代码马上失效（遇到滥用时用）。

### 3.4 限流

| 维度 | 上限 | 计数来源 |
|---|---|---|
| 每组织 × 每访客 IP | 10 分钟 5 条新询盘 | 数据库（`source=embed` 的收据） |
| 每组织 | 1 小时 40 条、24 小时 300 条 | 数据库 |
| 每通道 × 每访客 IP 请求次数（含无效请求） | 10 分钟 30 次 | `checkRateLimitAsync`（配了 Upstash 走 Redis，否则单实例内存，仅作粗筛） |

超限返回 429 + `Retry-After`。同一事件的重试（同一 uuid）不占新询盘额度。访客 IP 只以 HMAC（每个通道独立的服务端盐）存进收据载荷 `meta.ipHash`，不进业务指纹，盐从不出服务端。

数据库计数是先查后写（收据在入站时才建）：同一时刻大量并发的新提交可能略超上限，此时仍有请求次数粗筛兜底（单实例内存时只按实例计）。413 按请求头 `Content-Length` 判断（浏览器提交总会带上）；不带 `Content-Length` 的请求由平台的请求体上限兜底。

### 3.5 响应

| HTTP | 体 | 含义 |
|---|---|---|
| 200 | `{ ok: true, receiptId }` | 已收到（蜜罐命中时也返回同样形状，但不落库） |
| 400 | `{ ok: false, error: "email_required" \| "invalid_email" \| "message_required" \| "invalid_body" }` | 字段问题（`message_required`：产品 / 数量 / 留言都没填），在建线索之前拒绝，什么都不落库 |
| 401 | `{ ok: false, error: "invalid_key" }`（无 CORS 头） | key 错误 / 通道停用 |
| 403 | `{ ok: false, error: "origin_not_allowed" }`（无 CORS 头） | 来源不在白名单 |
| 413 | `{ ok: false, error: "payload_too_large" }` | 请求体超过 32 KB |
| 429 | `{ ok: false, error: "rate_limited" }` + `Retry-After` | 限流 |
| 503 | `{ ok: false, error: "temporarily_unavailable" }` + `Retry-After` | 暂时失败：线索已落库但主干处理抛错 / 未建成，用同一 uuid 重试即可补齐 |
| 500 | `{ ok: false, error: "server_error" }` | 同一 uuid 重试 |

503 只用于重试能补齐的暂时失败。字段问题在入站前就返回 400；万一主干按字段或组织配置拒收（重试同一事件不会变好），Trade 线索与销售通知已经落库，接口按"已收到"返回 200，不让访客重试、也不会因为改了内容重提而重复建询盘。

响应**不返回**线索 / 商机 id、是否重复等内部信息（防枚举）。脚本对 5xx 与网络错误自动用同一 uuid 重试 2 次（约 1.5 s、4 s 后），之后提示访客重试；访客不改内容再次提交仍用同一 uuid（幂等），改了内容则是新询盘。

### 3.6 隐私

- 不设 cookie、不写 localStorage、不生成持久访客 id（是否使用一方 Cookie 做长期归因待隐私口径决定）。
- 首访归因（UTM、`document.referrer`、落地页）只存在当前标签页的 `sessionStorage`（键 `qy_embed_first_touch_v1`），关掉标签页即清除。
- 买家填写的内容与归因字段进入该企业的青砚数据；企业是数据控制者，网站隐私声明应说明表单数据的去向。

### 3.7 站点 CSP

站点若有 Content-Security-Policy，需要允许：`script-src https://<青砚域名>`、`connect-src https://<青砚域名>`。样式优先用 Constructable Stylesheet（不受 `style-src` 内联限制）；不支持的旧浏览器退回 `<style>`，此时需要 `style-src 'unsafe-inline'`。

### 3.8 国内访问

嵌入脚本从青砚域名加载；面向国内访客的站点需确认该域名在国内可达（见 china-perf 路径）。脚本是单个静态文件（无第三方依赖），也可以放到国内可达的 CDN 上，此时用 `data-api` 指向青砚接口来源（提交仍发往青砚 API，接口本身也需国内可达）。

## 4. 管理接口（会话鉴权，组织在服务端解析）

| 接口 | 谁 | 说明 |
|---|---|---|
| `GET /api/trade/channels` | 外贸角色 | 通道列表，凭证一律只显示末 4 位；响应头 `x-qingyan-can-manage-channels: 1/0` |
| `GET /api/trade/channels/website` | 外贸角色 | 掩码视图；能管理时附 `website{secret, secretPrevExpiresAt, previousSecrets[{hint, expiresAt}], publicKey, allowedOrigins, embedReady}`（旧密钥只给末 4 位；`secretPrevExpiresAt` = 全部旧密钥中最晚的到期时间） |
| `POST /api/trade/channels` | 企业负责人 / 管理员 | 新建 / 更新通道；website 通道的凭证由服务端生成，重复保存沿用 |
| `PATCH /api/trade/channels/website` | 企业负责人 / 管理员 | `action`：`rotate_secret`（宽限期内旧密钥已满 3 个时 409）/ `end_secret_grace`（立即停用全部旧密钥）/ `enable_embed` / `rotate_public_key` / `set_allowed_origins`（带 `allowedOrigins`） |
| `DELETE /api/trade/channels/[channel]` | 企业负责人 / 管理员 | 删除通道 |

所有管理动作写审计日志，日志里只有凭证掩码。

## 5. 排障

- `WebsiteInquiryReceipt`：`source`（`website` = 服务器转发，`embed` = 嵌入表单，`trade_show` = 展会速记卡，`email` = 邮件转发，`whatsapp` = WhatsApp 来信，`wechat` = 微信公众号来信（只做平台重试去重），`whatsapp_sender` = WhatsApp 发信人租约（不是事件））、`eventId`（嵌入表单为 `emb:<uuid>`）、`status`、`attempts`、`conflictCount`；嵌入表单收据的 `payload.meta.ipHash`。
- 嵌入表单提交不了：先看浏览器控制台（脚本会提示检查 `data-key` 与来源白名单），再核对白名单是否与地址栏的来源完全一致（`www`、`https`、端口）。
- AI 草稿状态与 cron 兜底：见 [QINGYAN_WEBSITE_INTAKE_ASYNC.md §7、§10](./QINGYAN_WEBSITE_INTAKE_ASYNC.md)。
