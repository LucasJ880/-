# CHAIN-1 前置核查 — Alberta APC 授标能否匿名程序化读取（`tender-award-source-apc`）

| 项 | 值 |
|---|---|
| 任务书 | `docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md`「CHAIN-1」：design 阶段第一步，「任何一项要登录或有人机验证 → 本 change 停止，回报，不绕（硬纪律第 5 条）」 |
| 核查日期 | 2026-11-19 |
| 核查方式 | 本会话的云环境经批准放行 `purchasing.alberta.ca`、`open.alberta.ca`、`www.alberta.ca`（Lucas 2026-11-19 批准的环境变更）后，用 curl 默认客户端标识做**匿名 GET**；不登录、不下载文件、不伪装浏览器、不尝试任何绕过 |
| 结论 | **不通过，CHAIN-1 停止。** APC 对匿名程序化访问返回 Cloudflare 人机验证；Alberta 开放数据里没有竞争性货物招标的授标数据 |

## 1. APC（purchasing.alberta.ca）

请求：`GET https://purchasing.alberta.ca/robots.txt`（最无害的一个地址）。

返回：`403`、`text/html`，页面标题 `Just a moment...`，正文「Enable JavaScript and cookies to continue」，内容安全策略指向 `https://challenges.cloudflare.com`，脚本加载 `/cdn-cgi/challenge-platform/.../chl_page`（`cType: 'non-interactive'`，`cZone: 'purchasing.alberta.ca'`）。

这是 Cloudflare 的人机验证页。连 robots.txt 都被挡，说明站点对非浏览器客户端整体加了验证。按任务书与硬纪律第 5 条，**到此为止**：没有再请求首页、公告页或任何接口，没有换客户端标识、没有执行验证脚本、没有用无头浏览器去过验证。

另：此前一个只读调研代理在网上检索到的第三方描述（firecrawl 的站点说明、一个 Apify 抓取器页面）都提到 APC 有 Cloudflare / Turnstile，与本次亲测一致；那些描述里提到的匿名 JSON 接口本会话**没有**去碰。

## 2. Alberta 开放数据（open.alberta.ca）

官方 CKAN 接口匿名可用（`/api/3/action/package_search`、`package_show`，返回 JSON，许可 Open Government Licence – Alberta）。

- 检索「contract award」「contracts disclosure」「procurement contracts」「contract disclosure goods」：没有竞争性货物 / 服务招标的授标数据集（中标方 + 金额 + 编号）。
- 唯一相关的是 `sole-source-service-contracts`（「Sole-source service contracts」，OGL – Alberta，CSV 与 OData，季度更新）：只覆盖各部委 **$10,000 以上的独家采购服务合同**。不是竞争性招标，也不含货物——Sunny 投的露营装备、窗饰这类竞争性货物 RFQ 不会出现在里面。

## 3. 对后续的建议（需要人决定，本会话不做）

1. **书面许可或数据导出**：向 Service Alberta（采购）或 1GX 供应商支持申请书面许可 / 授标数据导出。拿到许可前不碰 APC。
2. **人工录入**：在授标记录里人工补录 Alberta 的历史中标（既有 `PROVINCIAL_MANUAL` 口径，T4 授标记录已有人工录入入口），不需要新代码。
3. **独家采购服务合同**可以作为一条补充来源单独立项（许可清楚、机器可读），但它满足不了「上一个中标者 / 可比价格」这个核心需求，价值有限。
4. 判断点 2（`ALBERTA_APC_PUBLIC` 进 `SYSTEM_VERIFIED` 白名单，Lucas 已授权）**没有用上**：没有数据源，就不改 T4 冻结服务的白名单。

CHAIN-2、CHAIN-3 不依赖 CHAIN-1（CHAIN-3 的中标者来自联邦授标与人工录入），照常推进。
