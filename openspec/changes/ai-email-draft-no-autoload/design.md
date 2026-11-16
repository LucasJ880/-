# Design

## Context

动机见 proposal.md「Why」。这里只写决定做法所需的现状，都是 2026-11-16 在 `main`（43be745f）上核对的。每一条都标了核对方式：**实测** = 用一次性脚本在 Chromium 里跑过（原始输出在同目录的 `probe-2026-11-16.md`）；**读代码** = 只读了源码，没有端到端跑。

### 1. 现行预览净化规则放行了什么（实测）

`src/lib/common/sanitize.ts` 用 DOMPurify，允许的标签含 `img`，允许的属性含 `src` 与 `style`。用一次性脚本（Playwright + 仓库里的 `dompurify@3`，原样照抄这份配置，净化后塞进页面，另起一个本机服务充当外部主机并记录收到的请求）跑了 19 种写法：

| 写法 | 浏览器是否不经点击就发出请求 |
|---|---|
| `<img src="https://外部/…">` | 是 |
| `<img src="//外部/…">`（协议相对） | 是 |
| `<img src="/api/auth/logout">`（站内路径） | 是，请求发到青砚自己的服务端（同源请求会带登录 cookie；脚本里没有登录态，这一句是推断） |
| `style="background:url(…)"`、`background-image:url('…')`、`background:#fff url(…) no-repeat` | 是 |
| `style="list-style-image:url(…)"`、`border-image:url(…) 1`、`cursor:url(…),auto`、`content:url(…)` | 是 |
| `style="background-image:image-set('https://外部/…' 1x)"`（整段没有 `url`） | 是 |
| `style="background:\75rl(…)"`（CSS 转义写法） | 是 |
| `style="background:&#117;rl(…)"`（HTML 实体写法） | 是 |
| `<img srcset>`、`<style>` 标签、`<link>` 标签、`<table background>` | 否（已被现行规则剥掉） |
| `<a href>` | 否（要点击） |
| 现行品牌版式（内联样式、线性渐变） | 否 |

13 种写法发出了请求。两点直接决定了做法：**不含 `url` 字样的写法（`image-set` 加裸字符串、CSS 转义）同样加载**，所以在字符串里找 `url(` 的拦法是漏的；**站内路径的图片同样会被请求**。

DOMPurify 在服务端（没有 `window`）不工作：现行 `sanitizeHtml` 在服务端原样返回输入。两处预览都在用户操作后才打开的对话框里，服务端渲染走不到，但这条分支本身没有任何保护。

### 2. 两处预览的 HTML 从哪来、发出去的是不是同一份（读代码）

| | 澄清邮件 | 销售跟进邮件 |
|---|---|---|
| 预览 | `project-question-dialog.tsx`，`editBody` | `ai-alert-panel.tsx`，`reviewTarget.html` |
| 生成 | `POST /api/projects/[id]/questions`：`createCompletion` → 从回复里取 JSON → `body` 原样存进 `ProjectQuestion.generatedBody` 并返回 | `POST /api/sales/email-compose`：`composeEmail` → `runSimple` → `JSON.parse` → `body` 套品牌版式（`wrapEmailLayout`）→ 返回。改写（`?action=refine`）同理 |
| 发送 | `POST …/questions/[questionId]/send`：请求里的 `body` 原样交给 `sendGmail`，原样存进 `ProjectEmail.body` | `?action=send-approved`：请求里的 `approvedHtml` 只拒绝 `<script`、`javascript:`、`on…=` 三类，其余原样交给 `sendSalesEmail` |
| 预览与发出 | 同一份字符串（编辑过的话是纯文本转成的 `<p>` 段落，全部转义） | 同一份字符串 |

所以图片与带地址的样式现在既在审核人的浏览器里加载，也会原样发给收件人。

**模型读到的、不由本组织成员逐字写下的内容**（读代码，没有做端到端注入实测，也没有让真实模型产出过带图片的草稿）：
- 澄清邮件：招标文件经分析得到的澄清清单与「定价前必须解决」清单（直接进提示词，也经「AI 推荐的澄清问题」一键填进表单）；项目名称 / 描述 / 业主名称（可由外部系统经 `/api/v1/projects` 推入）；助手对话里的「生成澄清邮件」卡片预填的字段。
- 跟进邮件：客户姓名（询盘入库、日历预约入库、CSV 导入都会建客户）；最近一条互动的摘要（入站询盘的正文截断、导入的聊天记录都会写进去）；改写时的现有草稿正文。
- 草稿提示词里带着的、可以被夹进地址带走的内容：报价金额、报价分享链接（凭链接即可查看报价）、分析结论里的定价前待解决事项、销售与公司名。

### 3. 正常草稿需不需要图片与内联样式（读代码）

- 澄清邮件的提示词要求 `<p>` `<br>` `<ul>` `<li>` `<strong>`；不需要图片，也不需要样式。
- 跟进邮件的正文由模型写（「简洁的 HTML」），外面套的品牌版式是代码里的固定模板：表格布局、大量内联样式（颜色、内外边距、圆角、阴影、一处 `linear-gradient`）、表格的 `width` / `cellpadding` / `cellspacing` / `align` 属性；**没有图片，没有 `url(`**。五个降级模板里有一个内联样式的按钮链接，同样没有图片。
- 两条发信路径（`sendGmail` 的原始邮件拼装、SMTP 兜底）都不追加签名或 logo。
- 结论：内联样式必须保留（否则品牌版式没了）；图片没有任何正常用途。

### 4. 另一套邮件版式（读代码）

`src/lib/revenue-spine/email-layout.ts` 是另一种做法：模型只出文字，代码把结构化内容拼成 HTML，文字全部转义，图片地址来自组织设置与产品目录并经协议校验。它的预览在沙箱 iframe 里。那条路不在本 change 里（见「发现」第 2 点）。

## Goals / Non-Goals

**Goals:**

- 模型起草的邮件 HTML 里，草稿写的任何地址都不会被自动请求：审核人的浏览器不会，收件人的邮件客户端也不会。
- 审核人在预览里看到的就是发出去的那一份。
- 规则是纯函数，服务端与浏览器端用同一份代码，能在没有浏览器、没有数据库的测试里逐条断言。
- 草稿被移除过内容时，审核人看得到。

**Non-Goals:**

- 不加全站 CSP，只报告模式也不加（`next.config.ts`、`src/proxy.ts`、`vercel.json` 不动）。见 D5。
- 不改提示词（`src/lib/ai/prompts/**`、`src/lib/sales/email-composer.ts` 里的场景提示与系统提示）。
- 不改发信通道（`src/lib/google-email.ts`、`src/lib/email/sender.ts`）、不改两条发送路径的触发方式与权限、不把它们改成先建 PendingAction。
- 不改 `src/lib/agent-core/tools/sales-interaction.ts` 与 `src/lib/agent-core/tools/_policy.ts`（`sales_send_quote_email` 的审批要求不动）。
- 不改 `src/lib/revenue-spine/email-layout.ts`、`src/lib/email/templates.ts`，不改 `revenue/[id]/page.tsx`、`email-profile-card.tsx`、`warranty-panel.tsx` 三处沙箱 iframe 预览。
- 不改 `src/components/ai-markdown.tsx` 与 `src/lib/ai-markdown/**`（Markdown 那条路已由上一个 change 关闭）。
- 不改 `src/components/project-detail/analyst-memo-card.tsx`、`src/app/layout.tsx`（只把它们登记进源码断言的清单）。
- 不改品牌版式与降级模板的内容（`wrapEmailLayout`、`getFallbackEmail` 只加 `export`）。
- 不回刷已入库的 `ProjectQuestion.generatedBody` / `ProjectEmail.body`。

## Decisions

### D1 在源头规范化（生成时 + 发送时），预览显示同一个结果；不做「只在预览里剥」

同一个纯函数 N 用在三类位置：

| 位置 | 作用 |
|---|---|
| 三个生成出口 | 入库与返回的草稿已经是 N 之后的 |
| 两个发送出口 | 发出与入库的是 N(收到的正文)。发送接口收的是浏览器传回来的字符串，不能假定它就是生成时那一份，所以这里是权威的一道 |
| 两处预览 | 显示 N(当前正文)，再过 DOMPurify |

预览显示 N(x)，发送发出 N(x)，同一个函数、同一个输入，所以预览与发出的正文一致。N 是幂等的（见 D2），生成时做过一次不影响后两处。

这会改变发出的邮件，但只在草稿含图片、带地址的样式、或允许清单之外的标签 / 属性 / 样式声明时；Context 第 3 点已核对正常草稿不含这些。

被否决的备选：
- **只在预览里剥**：审核人看不到的内容照样发给客户或业主——收件人打开邮件时请求那个地址，数据从收件人那边出去；而且「人审过的」与「发出去的」不是同一份，审核失去意义。
- **只在生成时规范化**：发送接口收的是请求里的字符串，任何绕过页面直接调接口的请求、以及编辑态里手敲的 HTML，都不经过生成出口。
- **发送时发现不合规就拒绝（400），不改写**：要先能可靠地「发现」，而不解析就在原文里找危险写法正是 Context 第 1 点里漏掉 `image-set` 与转义写法的那种做法；真要解析，直接输出规范化结果更简单。另外用户在预览里看到的已经是 N 之后的正文，发出 N 之后的正文与他看到的一致，没有拒绝的必要。两个发送接口既有的拒绝条件原样保留。
- **预览改成沙箱 iframe + 内嵌 CSP**：浏览器强制、不怕写法变形，但只管预览，发出去的邮件里地址还在；两处预览的排版与高度也要重做。可以以后与全站 CSP 一起作为加固，不替代本决定。

### D2 N 是「按允许清单重新生成」，不是「在原文里删危险写法」

N 把输入切成文字与标签，**只输出它自己拼出来的东西**：

- **标签**：只输出允许清单里的标签名——`html` `head` `meta` `body`（品牌版式是整篇文档）、`p` `br` `hr` `b` `i` `u` `strong` `em` `a` `span` `div` `ul` `ol` `li` `h1`–`h6` `blockquote` `pre` `code` `table` `thead` `tbody` `tr` `th` `td`。没有 `img`。清单外的标签去掉标签、保留里面的文字；`script` `style` `title` `textarea` `noscript` `iframe` `object` `embed` `svg` `math` `template` `select` 等连内容一起去掉。注释、CDATA 去掉；文档开头的 `<!DOCTYPE html>` 原样输出一次。
- **属性**：每个属性都由 N 重新拼。只有：`a` 的 `href`（必须是 `http://` / `https://` / `mailto:` 开头且不含空白、引号、尖括号、反斜杠）；表格用的 `width` `height` `cellpadding` `cellspacing` `border` `colspan` `rowspan`（1–4 位数字，可带 `%`）；`align` / `valign`（固定几个取值）；`meta` 的 `charset="UTF-8"`；`style`（见下）。其余属性一律不输出，包括 `src` `srcset` `background` `poster` `class` `id` 与全部事件属性。
- **样式**：把 `style` 的值（先解码 HTML 实体）按分号拆成声明，逐条检查，合格的重新拼回去：
  1. 属性名在允许清单内：颜色、`background` / `background-color`、字体与文字排版、内外边距、边框与圆角、宽高、`display`、`overflow`、`vertical-align`、`box-shadow`、`border-collapse`、`list-style-type` 等。清单里没有 `background-image`、`list-style` / `list-style-image`、`border-image`、`cursor`、`content`、`mask`、`filter`。
  2. 取值只含字母、数字、空格与 `# % . , ( ) - + / !`。**没有冒号、引号、反斜杠**：写不出带协议的地址，写不出字符串，写不出转义。
  3. 取值里每个「名字 + 左括号」的名字都在函数允许清单内：`rgb` `rgba` `hsl` `hsla` `linear-gradient`。
- **文字**：标签之外的内容里 `<` `>` 一律转义输出。

安全性来自第 2 类检查是对**输出**做的：输出里的 `<` 只出现在 N 自己拼的允许标签上，输出里的样式取值逐条符合那个字符集与函数清单。输入怎么变形、N 的切分与浏览器的解析有没有出入，都不影响这个结论——切错了最多是多转义、多丢弃。

幂等：N 的输出本身完全落在允许清单内，再做一次不变。

可行性已验证：用一次性原型（约 80 行，不在仓库里）在 Chromium 里跑了 Context 第 1 点的全部写法外加未闭合标签、属性里夹 `>`、不带引号的 `style`、注释里藏标签、`<svg><image>`，共 20 种，规范化后既塞进页面（经去掉 `img` 的 DOMPurify）、也当作整封邮件直接让浏览器解析，都没有发出任何请求；20 种都幂等；现行品牌版式加降级模板经 N 后，去掉空白、声明末尾分号与 `<br/>` 写法差异，与输入逐字相同，移除 0 处。

被否决的备选：
- **在字符串里查 `url(` 并删掉**：实测已证明 `image-set('…')` 与 `\75rl(` 都不含 `url(` 却照样加载。
- **服务端用 jsdom 跑 DOMPurify**：新增一个很重的依赖；而且 DOMPurify 本身不过滤 `style` 的取值（实测里 13 种写法都是它放行的），还得另写 CSS 过滤。
- **DOMPurify 钩子 + 浏览器的 CSS 对象模型过滤样式**：只能在浏览器里跑，管不了发出去的邮件，也没法在 `npx tsx` 的测试里断言。
- **引入 `sanitize-html` 之类的库**：新增依赖；它的 `allowedStyles` 是对声明取值做正则匹配，同样要自己写出上面那套字符集与函数清单，省不了规则本身。
- **整个去掉 `style`**：品牌版式全靠内联样式，去掉后发出的邮件变成无样式文档。
- **给站内文件图片留允许清单**（像 Markdown 那条路的 `/api/files/`）：`/api/files/` 是要登录的代理，收件人的邮件客户端打不开；预览能显示而收件人看不到，正好违背「预览与发出一致」。

### D3 预览 = N 之后再过 DOMPurify；`sanitize.ts` 就地改

`sanitizeHtml` 改为先做 N，再做 DOMPurify；DOMPurify 的允许清单去掉 `img` 与 `src`，补上 N 会输出的表格属性（否则预览会比发出的少这些属性）。服务端分支（没有 `window`）从「原样返回」改为返回 N 的结果。

保留 DOMPurify 是因为预览是把字符串直接放进页面的位置，防脚本注入这件事继续交给它；N 管的是「不加载」。两层各管一件事，N 的输出本身也不含脚本与事件属性。

这个文件全仓库只有这两处预览在用（已核对）。

被否决的备选：**预览里不再用 DOMPurify，只靠 N**——N 是本 change 新写的代码，把页面注入的防线全压在它上面没有必要；DOMPurify 已经在依赖里。

### D4 移除时告诉审核人：响应里带 `{ count, hosts }`，预览正文上方显示一行提示

N 同时返回移除报告。计入 `count` 的是「自动加载内容」：图片及其它加载资源的元素；取值里带不允许的函数、反斜杠或 `//` 的样式声明。因不在允许清单而被去掉、但本身不加载地址的东西（`<font>`、`position:absolute`、带引号的字体名）不计入，否则模型随手写个清单外的标签就会触发提示，提示就没人看了。`hosts` 从被移除内容的地址里取主机名（有才取），去重、小写、至多 5 个。

提示显示在预览正文之外，文字固定（见 spec）。预览时对当前正文再跑一次 N，本地得到的移除数与接口报告的取较大者——这样编辑态里手敲进来的内容也有提示。

澄清邮件生成本来就写一条审计记录，把报告加进它的内容里（AuditLog 是硬纪律允许的落点）。跟进邮件生成现在不写审计记录，本 change 不新增。

被否决的备选：
- **在正文原位置留一段占位文字**（Markdown 那条路的做法）：这是待发邮件，占位文字会发给客户。
- **悄悄移除不提示**：审核人不知道草稿被动过，资料里夹带指令这件事也失去了可见的痕迹。
- **报告里给完整地址**：地址的路径与查询串里可能正是被夹带的数据，写进响应与审计记录等于把它多存一份。

### D5 不在本 change 里加 CSP；只报告模式的 CSP 不是这条路的第一步

- 只报告模式不拦任何请求，只是事后上报；这条路现在是通的，第一步应该是关掉它。
- CSP 只管青砚自己的页面，管不了收件人的邮件客户端；「发出去的邮件里带着那个地址」这一半它解决不了。
- 强制的 `img-src` 需要先清点全站：`src/` 下用到 `<img>` 或 `next/image` 的组件文件有 32 个（已数），其中已知有外部地址的图片——微信登录带回的用户头像（`User.avatar`）、运营矩阵页的社媒账号头像；`revenue-spine` 邮件预览里还有组织设置与产品目录提供的图片地址。只报告模式还需要一个接收上报的接口和存放位置。这是另一件事，另开 change：先只报告、清点、再转强制。它是兜底，不替代本 change。

被否决的备选：**本 change 里顺带加只报告模式的 CSP**——要动 `next.config.ts`、新增一个接口，且不关闭任何东西；一个 change 一件事。

### D6 不加开关，不分组织

规则无条件生效，与 `MAIL_READ_ENABLED` 等开关无关。被否决的备选：**加环境变量开关以便回滚**——安全收口不应该有「关掉」的档位；需要回滚时回滚这个 PR。

### D7 三层测试：纯函数、接线、真实 Chromium（缺浏览器时跳过）

- `src/lib/email-draft-html/__tests__/normalize.test.ts`：规则本身。表驱动，包含 Context 第 1 点实测到的全部写法与 D2 验证时加的变形写法；幂等；移除报告；提示文字；模块不读环境、不引其它模块。
- `src/lib/email-draft-html/__tests__/wiring.test.ts`：接线。三个生成出口、两个发送出口、预览入口都经过 N（能直接引用的纯步骤做真断言，路由文件做源码断言）；品牌版式加五个降级模板经 N 不变；预览与发送对同一输入得到同一结果；`src/` 下把 HTML 字符串直接放进页面的文件只有登记清单里的四个。
- 这两个注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- `scripts/email-draft-preview-browser-e2e.ts`：真实 Chromium。把 N 的结果按预览净化规则（从 `sanitize.ts` 导出的那份配置，配仓库里的 DOMPurify 文件）净化后塞进页面，同时把 N 的结果当作整封邮件直接让浏览器解析（模拟收件人的邮件客户端）；拦截并记录页面发出的全部请求，断言一条都没有。带 `--before` 时改用改动前的配置、不做 N，作为对照（预期有请求）。只注册进 `scripts/test-all.sh`；没设 `CHROME_EXECUTABLE_PATH` 时打印 SKIP 并以 0 退出——与已注册的 `scripts/quotation-pdf-layout-e2e.ts` 同一做法。用 `puppeteer-core`（已在依赖里）。

被否决的备选：
- **只做纯函数与源码断言，浏览器里的结论靠一次手工实测**：DOMPurify 那一层与「浏览器真的没发请求」就只有一次性的证据；仓库里已有「真实 Chromium、缺失则跳过」的先例，照做的成本很低。
- **在测试里引入 jsdom 跑 DOMPurify**：新增依赖，而且 jsdom 不加载资源，证明不了「没有请求」。

## 与八条硬纪律的关系

1. 零 schema：遵守。不新增表、字段、migration，不新增 settingsJson 键。移除报告只出现在接口响应与一条既有的 AuditLog 记录里。
2. 出站先审批：涉及但不改流程。本 change 只改变发出内容的范围（去掉自动加载内容），不改变任何发送的触发条件；`sales_send_quote_email` 工具的强审批要求不动。两个网页发送接口现状见「发现」第 1 点。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及 Muse 通道。移除报告不带地址的路径与查询串（spec「移除报告不带出地址内容」），不构成新的敏感内容出口。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。不改用哪个邮箱发信。
7. 确定性优先：遵守。N 是纯函数；零新增模型调用；提示词不动；不读环境变量。
8. 测试注册：遵守。两个新测试在各自的 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；两个文件都在 `src/lib/**/__tests__/` 下，受 `scripts/check-test-registry.sh` 检查。

## 验证方式

- `npx tsx src/lib/email-draft-html/__tests__/normalize.test.ts`
- `npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts`
- `CHROME_EXECUTABLE_PATH=<本机 Chromium> npx tsx scripts/email-draft-preview-browser-e2e.ts`（改动后：零请求）与同一命令加 `--before`（对照：有请求）；两次的输出存 `docs/acceptance/ai-email-draft-no-autoload/browser-e2e.txt`。
- `npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate ai-email-draft-no-autoload --strict`
- `git diff --stat main -- prisma vercel.json next.config.ts src/proxy.ts src/lib/ai/prompts package.json package-lock.json` 为空。
- 整页实测：本地起应用（隔离库），让两处预览各显示一份含外部图片与带地址样式的草稿（生成接口的响应用浏览器端拦截替换，不调模型），确认对话框里正文上方出现提示、正文里没有图片、没有发往草稿里地址的请求；截图存 `docs/acceptance/ai-email-draft-no-autoload/`。本地起不了应用时，在 PR 描述里写明「整页实测未做」及原因，不以测试通过代替。

## Risks / Trade-offs

- [模型写了允许清单之外的样式或标签（带引号的字体名、`position`、`<font>`），发出的邮件里没有这些] → 预览显示的就是发出的那份，审核人看得到效果；清单覆盖了现有版式的全部样式。以后要放宽，改清单并补测试用例。
- [N 是自己写的切分逻辑，可能与浏览器的解析有出入] → 安全性不依赖切分正确（D2）；出入只会导致多转义或多丢弃，表现为预览里出现转义后的标签文字，审核人能看到。
- [真实 Chromium 的测试在没设 `CHROME_EXECUTABLE_PATH` 的环境里跳过，CI 里多半跑不到] → 「不加载」这个结论由 N 的输出保证，两个纯测试在 CI 里必跑；浏览器测试的一次完整输出随 PR 存档。
- [发送时改写正文：直接调发送接口的调用方提交的 HTML 会被规范化] → 这是本 change 要的效果；接口的请求与响应形状不变。
- [编辑态里用户自己粘进来的图片也会被移除] → 提示会显示；现在的编辑态本来就是纯文本编辑，粘进 HTML 不是受支持的用法。
- [草稿里的链接仍然可以带数据（`<a href="https://外部/?d=…">`）] → 点击是人的动作，不属于自动加载；预览里链接地址可见。链接去向的呈现不在本 change 里。
- [本 change 合并前已经生成、还开着对话框没发的草稿] → 发送出口会规范化；不需要迁移。

## 发现（不在本 change 里改）

1. **两个网页发送接口不经过 PendingAction。** `POST …/questions/[questionId]/send` 与 `POST /api/sales/email-compose?action=send-approved` 在用户点「确认发送」后直接调用发信，不建审批卡（读代码）。硬纪律第 2 条的字面是「任何对外发送必须先建 PendingAction」；这两处是人自己在预览后点的发送，与 Agent 发起的发送（`sales_send_quote_email`，强审批）不同。它们算不算例外、要不要改成先建卡，需要 Evan 决定；本 change 不改，也不让情况变得更宽。
2. **其它邮件预览没有逐一做注入实测。** `revenue/[id]/page.tsx` 的预览来自 `revenue-spine/email-layout.ts`（读代码：文字全部转义，地址经协议校验，图片地址来自组织设置与产品目录）。`email-profile-card.tsx` 与 `warranty-panel.tsx` 的 HTML 也由服务端产出，没有发现模型直接写 HTML，但没有逐个字段核对转义。三处都在 `sandbox=""` 的 iframe 里；这种 iframe 不执行脚本，但**照样加载图片**，所以它们安全与否取决于服务端模板的转义，而不是沙箱。
3. **没有全站 CSP**（见 D5）。
4. **`openspec list` 里有两个已完成但未归档的 change**（`specs-strict-validate-cleanup`、`next16-proxy-rename`），与本 change 无关，没有动。

## Open Questions

（无。）
