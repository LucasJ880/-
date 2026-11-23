# BIDPAGE 交接（「标书与报价」页改版，BIDPAGE-1 ～ 8）

> 只写核对过的事实；没核对的写「未核实」。每合并一个 PR 更新一次。

## 0. 接手的人从这里开始

1. 先读本文件 §1 ～ §3，再读任务书 `docs/QINGYAN_BIDPAGE_BID_QUOTE_REDESIGN_TASKBRIEF.md`（尤其「合并授权、交叉验证与交接」与附录 C）。
2. 第一条命令：`git fetch origin && git log --oneline -5 origin/main && openspec list`（看 main 走到哪、有没有进行中的 change）。
3. 正在做的那个 change 用 `/opsx:continue <change>` 或 `/opsx:apply <change>` 接着做，不要重开。

## 1. 当前状态（2026-11-23）

| 项 | 值 |
|---|---|
| 当前 main | `d1b0d3e2`（#557 BIDPAGE-1 合并后；2026-11-23 核对） |
| 工作分支 | `claude/laughing-curie-2b9s1v`（每个 PR 合并后从最新 main 重开同名分支做下一个） |
| BIDPAGE-1 | **已合并**（#557，`d1b0d3e2`，2026-11-23）；开关默认关，合并后页面无变化；生产部署：核对中（合并后约 1.5 分钟用 `release-drift` 查，线上仍是上一个合并提交 `212613e`；FIX-21 的 `212613e` 合并约二十分钟后已在线上，说明生产随 main 自动部署；稍后再查，结果补在这里）；归档 `2026-11-23-bid-page-v2-shell`（主规格 `tender/bid-page` 13 条），归档 PR 见下表 |
| 正在做 | BIDPAGE-3 `quote-line-mode-persist`：四件套与实现在本地另开的工作区（`/home/user/bp3-wt`，本地分支 `bp3-local`）里，**还没推送**——容器回收就没了；归档 PR 合并后变基到 main、推到工作分支 |
| 下一步 | 归档 PR 合并 → BIDPAGE-3 变基、开工前审查四件套 → 补完 → 全量门禁 → 多维审查 + 交叉验证 → 开 PR → 合并 |

| change | ID | 状态 | PR | 分支 |
|---|---|---|---|---|
| `bid-page-v2-shell` | BIDPAGE-1 | 已合并、已归档 | #557（合并）；归档小 PR（本次） | `claude/laughing-curie-2b9s1v` |
| `quote-line-mode-persist` | BIDPAGE-3 | 实现中（未推送） | — | 本地 `bp3-local` |
| `quote-lump-sum-mode` | BIDPAGE-4 | 未开始 | — | — |
| `quote-one-step-confirm` | BIDPAGE-6 | 未开始 | — | — |
| `quote-margin-advice-market` | BIDPAGE-5 | 未开始 | — | — |
| `bid-page-sourcing-step` | BIDPAGE-2 | 未开始 | — | — |
| `bid-page-documents-step` | BIDPAGE-7 | 未开始 | — | — |
| `bid-page-zh-copy` | BIDPAGE-8 | 未开始 | — | — |

上线顺序：1 → 3 → 4 → 6 → 5 → 2 → 7 → 8。

## 2. 授权与拍板（原话与日期）

- Evan 2026-11-22 18:01：八个 PR 由实现者自行合并，条件见任务书「合并授权、交叉验证与交接」六条；改环境变量、打开开关、对外发东西不在授权内。
- Lucas 2026-11-22：合并后「GitHub 上合并提交的部署状态，确认是部署了就行」。
- Lucas 2026-11-22：附录 C 的 A、B、C「都按你推荐」。
- Lucas 2026-11-22：「现在起，这个项目交给你全权负责，都按照你的推荐来，合并也交给你做，PR 的审查需要用子agent多方面交叉审查，记得做好hand off」。据此：每个 change 的归档小 PR 也由实现者合并。

## 3. 判断点与不确定处的结论

| 项 | 结论 | 落在哪 |
|---|---|---|
| 判断点 1 ～ 6 | 按任务书默认 | 各 change 的 design |
| 附录 C 的 A / B / C | 拍板按推荐（共用代码按开关分流 / 入口改 `page.tsx` / 金额门 = 内部成本 ∧ 财务查看权） | 任务书附录 C |
| 附录 C 的 D ～ K | 按默认 | 任务书附录 C |
| 不确定处 2 | `engineConfigSchema` 非严格、`engineOf` 用 `safeParse`，加可选字段不会让旧数据失败 | 任务书附录 C；BIDPAGE-3 design（待写） |
| 不确定处 1 / 4 | 逐行只用引擎一套算法，四个数取引擎；Σ行合计与引擎合计差 ≤ Σ(数量 × 0.005) | 任务书附录 C；BIDPAGE-3 design（待写） |
| 不确定处 3 | 未核实（BIDPAGE-2 时复现） | — |
| 不确定处 5 | 实现会话连不上生产库，未核实；用合成数据回归，只读查询留给 Lucas / Evan | BIDPAGE-6 时写出查询 |
| BIDPAGE-1「下一步」规则 | 「已定」「有未定的报价」挪到找供应商之前；招标分析那条只在没往下走时命中；新增「看供应商回复，把报价录入」；询价按每家供应商最近一次算（共 8 条出入） | `openspec/changes/archive/2026-11-23-bid-page-v2-shell/design.md` D3；主规格 `tender/bid-page` |
| BIDPAGE-1 金额门 | 内部成本权限（`resolveQuoteCapabilities`）∧ 财务查看权（`canReadAll`），与报价引擎开关无关；只决定新页面挂不挂带金额的旧组件，不是数据保护 | design D4 / D5 |
| BIDPAGE-1 临时出入 | 看不到金额的人在新页面 ① ② 暂时不能起草询价、编辑报价。起草询价由 BIDPAGE-2 恢复；编辑报价**不恢复**——Evan 2026-11-22 对 CHAIN-2e 的答复 ①（`docs/QINGYAN_CHAIN-2b_REPORT.md` §6 第 4 条）：不是项目负责人的投标同事不新建、编辑、批准报价，谁做报价谁就是负责人（负责人有财务特权）；逐行表本身就是成本，编辑必须看见成本 | BIDPAGE-1 design D5；BIDPAGE-3 design D7 |

## 4. 已知问题与没验证到的地方

- 预发验收、生产页面、Sunny 组织 id：实现会话访问不到（未核实）。
- **旧接口仍给金额**（`/quote-engine*`、`/inquiries`、`/quotes`、`GET /api/projects/{id}` 的 `ourBidPrice` / `winningBidPrice`）：附录 C 决定 C 留给 CHAIN-2e。开关开着时，入口第一次渲染与汇总接口第一次出错时仍是旧页面，期间看不到金额的人照今天的口径拿到金额（不新增暴露）。见 §5 上线前置条件。
- ③ 的「内部项目分析 PDF」在项目同时有我方报价与中标价时会写出两者，有编辑权、没有财务查看权的人能生成：由 BIDPAGE-7 按金额门处理。
- 全量门禁的「Mention Gateway M2-A Identity DB」在同一个库上第二次跑会因残留的平台组织 wecom 网关行撞唯一约束（与本任务无关）；跑全量前先删：`DELETE FROM "WeChatGateway" WHERE "orgId"='__qingyan_platform__' AND channel='wecom' AND "corpId" LIKE 'corp_shared_%';`。
- 本地起过 `next dev` 后，`.next/dev/types/routes.d.ts` 可能被写坏，导致 `npm run typecheck` 报一串 `.next/dev/types` 语法错：删掉 `.next/dev` 再跑。
- 跑 `npm run test:ci` 要用 CI 同款环境变量（`DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci?schema=public`、`NODE_ENV=test`、**不设** `DATABASE_ENVIRONMENT`）：带着隔离库的变量跑，会把子集里的隔离库端到端测试也跑起来，停在 main 上既有失败的 RFQ-AUTO-2（2026-11-23 踩过）。
- 合并后怎么看生产部署：工具里查不到单个提交的部署状态，容器也连不上生产（出站代理拒绝）。用仓库自带的 `release-drift` 工作流（`workflow_dispatch`）：它读 `https://qingyan.ca/api/health` 的 `checks.deployedCommit` 与 main 比对，日志里有「生产与 main 一致（<短 sha>）」或「生产部署落后于 main」。部署要几分钟，合并后过一会儿再触发。
- main 动得很勤（别的轨道的归档 / 交接文档 PR）：合并前每次 `git fetch` 发现 main 动了都要变基、重跑门禁（全量约 35 分钟 + CI 约 15 分钟）。
- 本地隔离库：容器里 Postgres 16 已起、`vector` 扩展可用（`postgresql-16-pgvector` 装不上但扩展已在），库 `qingyan_test` 已 `prisma migrate deploy`。容器重启后要 `service postgresql start`。

## 5. 上线时要设的环境变量（八个都合并、预发验收通过后，由 Evan / Lucas 设）

| 变量 | 值 | 说明 |
|---|---|---|
| `TENDER_BID_PAGE_V2_ENABLED` | `1` | 新页面总开关 |
| `TENDER_BID_PAGE_V2_ORG_ALLOWLIST` | `<Sunny 组织 id>`（未核实，待填） | **必须填，不能留空**（留空 = 所有组织） |

**上线前置条件（打开开关之前）**：

1. 八个 change 都已合并，预发验收按任务书「验收」九条走过。
2. 旧接口的金额口径：CHAIN-2e 已合并；或由 Lucas / Evan 明确接受「开关开着时旧接口照今天的口径给金额」（BIDPAGE-1 design D1 / D5）。
3. `TENDER_QUOTE_ENGINE_ENABLED` 在生产已开（未核实，任务书说已开）。
4. **开关开着时每次进页签都会先闪一下整个旧页面**（入口第一次渲染必须是旧 `BidTab` 才能保证「开关关 = 零变化」；旧组件的取数先于入口执行，所以必定先闪）。这与验收第 1 条「只看到下一步 + 三个分区」不符，CHAIN-2e 合并后也不会消失。打开开关前要么由 Lucas / Evan 明确接受，要么另起一个 change 解决（例如服务端渲染时就知道开关结果——要改项目页取数，届时再评估）。（BIDPAGE-1 交叉验证 2026-11-23 指出）

## 6. 本地跑测试

```bash
service postgresql start
export PATH=/opt/node24/bin:$PATH
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/qingyan_test" DIRECT_URL="$DATABASE_URL"
export NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET="<任意 32 位以上的本地测试串>"
npm test   # 全量；与 main 基线比对失败名单
```
