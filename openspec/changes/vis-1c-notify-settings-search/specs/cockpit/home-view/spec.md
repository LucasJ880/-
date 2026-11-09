# Spec Delta

## MODIFIED Requirements

### Requirement: company.log 时间线
页面底部 SHALL 按接口顺序显示时间线条目（时间、岗位、操作者——"系统" / "AI" / 用户名、摘要），有 `href` 的条目 SHALL 可点击；条目的岗位名 SHALL 只在该岗位出现在岗位总览返回的 `posts` 里时显示，否则该格留空（`post` 为空时照旧显示"未归属"）；有 `nextCursor` 时 SHALL 显示"加载更多"；"加载更多"失败时 SHALL 保留已加载条目并提供重试；列表被刷新或重试替换后，替换前发出的"加载更多"响应 SHALL 被丢弃；无条目时 SHALL 显示"最近 7 天暂无记录"。相对时间 SHALL 以接口的 `generatedAt` 为基准计算。

#### Scenario: 时间线条目
- **WHEN** 接口返回一条 `actor = "ai"`、`post = "tender"`、`href = "/workforce/run-1"` 的条目
- **THEN** 显示"AI"、"投标"，并链接到 `/workforce/run-1`

#### Scenario: 刷新与加载更多交错
- **WHEN** 刷新请求在途时用户点击"加载更多"，刷新响应先到、旧游标的"加载更多"响应后到
- **THEN** 列表只包含刷新后的第一页，旧游标的条目不被拼接

#### Scenario: 加载更多失败
- **WHEN** 时间线已显示若干条目，点击"加载更多"后接口失败
- **THEN** 已显示的条目保留，按钮变为"加载失败，点此重试"

#### Scenario: 不可见岗位不显示岗位名
- **WHEN** 运行 `npx tsx src/components/cockpit/__tests__/org-cockpit-view.test.tsx`，岗位总览的 `posts` 不含 `inbound_sales`，时间线有一条 `post = "inbound_sales"` 的审计条目
- **THEN** 该条的岗位格不显示「询盘销售」，测试通过
