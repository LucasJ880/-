## Context

`src/lib/common/sanitize.ts` 的 `sanitizeHtml` 用 DOMPurify 净化模型起草的邮件 HTML，放行标签里有 `img`，放行属性里有 `src` 与 `style`。它有两个调用处：`src/components/project-question/project-question-dialog.tsx`（问供应商邮件的正文预览）与 `src/app/(main)/sales/ai-alert-panel.tsx`（销售跟进邮件的正文预览），都用 `dangerouslySetInnerHTML`。另外，没有 `window` 时它原样返回传入的 HTML。

`ai-markdown-image-allowlist` 已经把图片地址判定做成纯函数（`src/lib/ai-markdown/url-policy.ts`：`classifyAiImageSrc`、`blockedImageLabel`），允许清单只有站内文件代理 `/api/files/`（需登录、只读、不跳转外部）。

仓库里没有 jsdom 之类的 DOM 依赖；有 `playwright`（devDependency）与 `esbuild`，已有「找不到 Chromium 就跳过」的测试先例（`scripts/quotation-pdf-layout-e2e.ts`）。

## Goals / Non-Goals

**Goals:**

- 两处邮件 HTML 预览不再让浏览器自动请求外部地址（图片与内联样式两条路都关）。
- 图片规则与 Markdown 渲染是同一套判定，不出现第二套允许清单。
- 预览的排版尽量不变：普通内联样式保留。

**Non-Goals:**

- 不改发出的邮件（发信路径不经过 `sanitizeHtml`）。
- 不改链接的呈现（预览要如实反映邮件长什么样；点链接需要用户操作）。
- 不加全站内容安全策略。
- 不审 `iframe srcDoc` 的那几处预览（见「发现」）。
- 不新增依赖。

## Decisions

### D1 在 DOMPurify 净化后的 DOM 上做后处理

`sanitizeHtml` 让 DOMPurify 返回 DOM（`RETURN_DOM`），再对结果里的 `img` 与带 `style` 的元素逐个处理，最后取 `innerHTML`。DOMPurify 是在惰性文档里解析的，这一步不会触发加载。

- 否决：用 DOMPurify 的钩子在遍历中途替换节点。替换当前节点后遍历器的行为要靠读实现才能确定，后处理更直白。
- 否决：在字符串上用正则改写 HTML。解析差异会被利用。

### D2 图片判定复用 `url-policy`

`img` 的 `src` 交给 `classifyAiImageSrc`：放行的改成规范化后的站内路径；不放行的整个元素换成一个只含文字的 `span`（`blockedImageLabel`）。`srcset` 本来就不在放行属性里。

### D3 内联样式按「函数允许清单」过滤，纯函数

新文件 `src/lib/common/inline-style-policy.ts` 导出 `sanitizeInlineStyle(style)`：按 `;` 拆声明；属性名须是普通标识符；值里出现的函数名须在 `rgb / rgba / hsl / hsla / calc` 之内；值里有反斜杠、`/*`、`@` 的声明去掉。浏览器经内联样式加载资源都要通过函数记号（`url()`、`image-set()`、`image()`、`cross-fade()`、`element()` 等），所以挡住清单之外的函数就挡住了加载；反斜杠一刀切是为了不依赖各家解析器怎么还原转义。按 `;` 朴素拆分会把引号里带 `;` 的值拆坏，但那种值本来就要去掉，拆坏的碎片没有冒号或过不了检查，同样被丢弃。

- 否决：整个去掉 `style`。邮件排版靠内联样式，预览会面目全非。
- 否决：属性名允许清单。要维护一长串属性，而且真正的风险在值里的函数。

### D4 没有浏览器环境时返回空字符串

原来的「没有 `window` 就原样返回」是放行。两个调用处都在客户端对话框里，服务端渲染不到，改成返回空字符串对现有页面没有可见影响。

### D5 测试分三段

`src/lib/common/__tests__/sanitize-html.test.ts`：

1. 纯函数段：`sanitizeInlineStyle` 的各类写法。
2. 源码与清单段：`sanitize.ts` 用的是 `url-policy` 的判定、没有 `window` 时返回空、全仓库 `dangerouslySetInnerHTML` 只在登记的四个文件里。
3. 真实浏览器段：用 esbuild 把 `sanitize.ts` 打成一个脚本，Playwright 的 Chromium 打开空白页、拦截并记录所有请求，把净化结果放进页面，断言外部请求数为 0。找不到 Chromium 时打印 SKIP 并继续（前两段照常判定）。

## 与八条硬纪律的关系

1. 零 schema：遵守。2. 出站先审批：不涉及（不发任何东西）。3. 禁止第三套队列：不涉及。4. 脱敏：提示文字不含地址的路径与查询串。5. 不爬登录页：不涉及。6. 邮箱分离：不涉及。7. 确定性优先：纯规则，没有模型调用。8. 测试注册：新测试在 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` 注册。

## Risks / Trade-offs

- [预览与发出的邮件可能不一致] 模型起草的 HTML 里若真有外部图片，预览显示「图片未加载」，发出去的邮件里图片还在 → 这正是要让审稿人看见的；提示文字带主机名。
- [内联样式过滤误伤] 用了清单之外函数的正当样式（如 `linear-gradient()`、`var()`）会被去掉 → 邮件正文很少用；去掉的只是那一条声明。
- [CI 没有 Chromium] 真实浏览器段在 CI 上跳过 → 本地实测的结果写进报告；前两段在 CI 上照常跑。

## 发现（不在本 change 里改）

- `iframe` 预览已逐处核对（2026-11-16），结论是没有发现注入路径、不需要改：仓库里一共 6 个 `iframe`，其中 2 个用 `src` 指向站内地址（报价 PDF、粗报价工具），4 个用 `srcDoc`（3 个文件）——① `revenue/[id]/page.tsx` 的邮件效果：HTML 只由 `src/lib/revenue-spine/email-layout.ts` 的两个渲染函数生成，所有文字（含模型润色过的正文）逐行经 `escapeHtml`；图片与链接地址来自企业自己维护的发信档案与款号参考表，并限定为 `https://`（`safeUrl`），主色限定为 `#RRGGBB`；② `settings/email/email-profile-card.tsx` 的样例邮件：同一套模板加样例数据；③ `accounting/warranty-panel.tsx` 的质保邮件与证书（2 个）：没有模型写的文字，所有取值经 `esc`，模板里没有图片。这些预览会加载的外部资源只有企业自己配置的 Logo 与款式图片。没有核对的：有没有别的接口能把客户端传来的 HTML 写进待审批动作的载荷（只查了 `src/app/api/revenue` 下的路由）。`sandbox=""` 不挡子资源加载，所以这个结论靠的是模板的转义与地址来源，不是沙箱。
- 全站仍然没有内容安全策略。

## Migration Plan

没有开关，合并并部署后生效。回滚即回退这一个提交。

## Open Questions

无。
