# 情报调研树（TREE）· 交接（HANDOFF）

> 新会话从这里进。只记**核对过的事实**；没核对的写「未核实」。每合并一个 PR 更新一次；会话结束或上下文快用完之前必须更新。
> 任务书：`docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`。主线状态：`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`「Phase F（续）— 情报调研树」。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-11-23（第 1 次：TREE-1 实现完成，审查前） |
| 当前 main | `451bb0d3`（开工时；任务书「依据」写的是 `f016325f`，之间多了 #532 CHAIN-2b、#550、#551，都不碰「依据」里列的文件，依据仍成立——见 §3） |
| 工作分支 | `claude/awesome-maxwell-9wh9m6`（会话指定的唯一可推送分支；八个 PR 依次从它开：上一个合并后把它重置到最新 main 再做下一个） |
| 授权 | Evan 2026-11-22 20:08：TREE-0 ～ TREE-8 全权交给实现者，PR 自行合并，条件是至少七维度子 agent 独立审查 + 一个挑错子 agent 亲自重跑验证 + 每条意见有去向 + 基于最新 main 重跑门禁。**不在授权内**：改预发 / 生产环境变量与开关、买付费数据、对外发送、改数据库结构、改任务运行时、绕过访问限制 |

## 1. 八个 change 的状态

| ID | change | 状态 | PR / 分支 |
|---|---|---|---|
| TREE-0 | （随 TREE-1） | 实现中 | 同 TREE-1 |
| TREE-1 | `public-page-reader` | 实现完成，待多维审查 | `claude/awesome-maxwell-9wh9m6`，PR 未开 |
| TREE-2 | `research-tree-runtime` | 未开始 | — |
| TREE-3 | `research-branches-awards` | 未开始 | — |
| TREE-4 | `research-cross-verify` | 未开始 | — |
| TREE-5 | `research-trunk-view` | 未开始 | — |
| TREE-6 | `research-page-intake` | 未开始 | — |
| TREE-7 | `research-records-request-draft` | 未开始 | — |
| TREE-8 | `research-buyer-question` | 未开始 | — |

## 2. 正在做的与下一步

- 正在做：TREE-1（含 TREE-0）。四件套在 `openspec/changes/public-page-reader/`；代码 `src/lib/web-reader/**`、`src/lib/text/html-to-text.ts`、`src/lib/tender-research-tree/flags.ts`。
- 下一步：全量门禁 → `/opsx:verify` → 七维度审查 + 挑错 → 修 → 开 PR → 合并 → 确认部署 → 本文件更新 → TREE-2。

## 3. 开工核对（2026-11-23）

- `git fetch` 后 main = `451bb0d3`。`f016325f..451bb0d3` 只改了 CHAIN-2b 相关文件（`tender-pricing/**`、`pricing-helper` 路由与卡片、`api/projects/route.ts`、`bid-intelligence/route.ts` 4 行）与文档；任务书「依据」列的 `tavily-client.ts`、`orchestrate.ts`、`contract.ts`（`CRITICAL_FACT_TYPES` 仍 20 个）、`workforce-runtime/**`、`deterministic-plan.ts`、`tools.ts`、`inbound-contract.ts`、`company-identity.ts`、`submission-parser.ts`、`llm.ts`、`job-failure-surfacing.ts` 都没动，依据成立。
- 与任务书有出入的四处（已报告）：
  1. main 提交号不同（见上）。
  2. HTML 转文本不止 `google-email.ts` 一份：全库已有四份（`google-email.ts`、`trade/tools.ts`、`projects/generate/tender-doc-html.ts`、`trade/email-forward-parse.ts`）。处理见 §4 D-1。
  3. 总交接 `docs/QINGYAN_TENDER_FLOW_HANDOFF.md` §0.5k 第 12 条写「`openspec/config.yaml` 由 Evan 改」；本任务书 TREE-0 是 Evan 亲自要求实现者登记例外。按任务书做，PR 正文写明。
  4. 其它轨道未合并的分支碰到本任务要改的文件：`claude/zen-turing-azudvx-fix20`（FIX-20，未开 PR）改 `tender-workforce/job-failure-surfacing.ts` 与 `tender-workforce/tools.ts`；#538 CHAIN-2d（Draft）改 `projects/generate/rfi-export.ts` 与 `tender-intel/orchestrate.ts`。TREE-2 要排除调研 Job 的失败收尾、TREE-8 要用澄清清单——开工前再核对它们是否已合并；未合并就不改这几个文件（调研工具放同级新文件；澄清清单只调用不改）。

## 4. 实现者自己拍的决定（及理由）

- **D-1（TREE-1）HTML 转文本**：把 `trade/email-forward-parse.ts` 那一份（线性扫描、有测试）挪到 `src/lib/text/html-to-text.ts`，输入上限做参数，邮件解析仍传 200 000（2 万条随机输入对比挪动前后 0 处不同）。另外三份不动（各自调用方行为要另核，不在范围）。
- **D-2（TREE-1）「定时任务上下文」怎么认**：调研 Job 本身就由既有 cron `api/cron/agent-runs` 处理，不能按「是不是 cron 进程」判断；改为读页上下文只能从库里核对过的调研 Job 建出（`AgentRun.metadata.researchTree = { version: 1, initiatedByUserId, trigger }`，`trigger` 只能是 `human_start` / `requirements_confirmed`），调用方声明 `scheduled: true` 也直接拒绝。TREE-2 的「开始调研」接口负责写这个标记。
- **D-3（TREE-1）传输层**：用 Node 自带 `http` / `https.request` + 自定义 `lookup`（连接时再校验地址，挡 DNS 重绑定），不用全局 `fetch`（换不了解析函数、要装 undici）。
- **D-4（TREE-1）结果五类**：读到 / 被挡 / 未接通 / 拒绝 / 到上限；直接给的登录地址算「拒绝」不算「被挡」（否则模型提一个登录地址就让整个站点在这一支作废）；跳转到登录地址算「被挡」。
- **D-5（TREE-1）robots**：按 RFC 9309——4xx（含 401 / 403）视为没有限制，5xx / 超时 / 连接失败视为全部不许读；按「QingyanResearchBot」组，没有则 `*` 组；最长匹配。ImportYeti 不看 robots。
- **D-6（TREE-1）组织覆盖只能收紧**：`settingsJson.researchTree.sites` 只收 `deny` 与 `allow`；不能放出预置「不碰」，不能新增「按人发起处理」。
- **D-7（TREE-1）计数口径**：一次读页扣 1 次额度（跳转、重试、robots 不另扣）；同站间隔对所有请求（含 robots、重试）生效；间隔只在同一进程内保证。
- **D-8（TREE-0）config.yaml**：第 7 条「唯一例外（KPI-2…）」改为「例外一」，后接「例外二（TREE-0）」；写明每支模型请求最多 30 次（每决定一步算一次：16 + 12 次动作加收尾 2 次）、条款员每棵树一次、核对员每条待核事实一次。

## 5. 判断点与「不确定处」的结论

| 项 | 结论 |
|---|---|
| 判断点 1 robots | 按默认：看并遵守；ImportYeti 不看（TREE-1 已实现） |
| 判断点 2–7 | 按默认（尚未到对应 change） |
| 不确定处 5（HTML 转文本） | 见 D-1 |
| 不确定处 7（同址缓存放哪） | TREE-1 定义树级缓存接口、默认进程内；TREE-2 用 Job 步骤结果实现 |
| 不确定处 8（各站条款与 robots） | 本批 robots 运行时遵守；逐站条款第二批开工前补，**未核实** |
| 其余（1、2、3、4、6、9、10、11） | 未到对应 change，**未核实** |

## 6. 已知问题与没验证到的地方

- 读网页只用假网络测过；真实网络（政府站、PDF、gzip / br）**未验证**（本 change 没有调用方，预发验收时才会真正发请求）。
- 同站 2 秒间隔只在同一进程内保证（D-7）。

## 7. 实测用量

尚无（TREE-2 起才会有真实运行）。

## 8. 上线时要设的环境变量（由 Evan / Lucas 设，实现者不碰）

- `TENDER_RESEARCH_TREE_ENABLED=1`
- `TENDER_RESEARCH_TREE_ORG_ALLOWLIST=<Sunny 的组织 id>`（**生产不能留空**；留空 = 所有组织）

## 9. 接手从哪开始

1. 读本文件 §1、§2，再读任务书「授权、交叉审查与交接」。
2. 第一条命令：`git fetch origin main && git log --oneline -5 origin/main && openspec list`。
3. 本地测试环境的做法见 `docs/QINGYAN_TENDER_FLOW_HANDOFF.md` §0.5e「接手要知道的」第 3 条（Node 24：`/opt/node24/bin`；Postgres 要 `service postgresql start`，pgvector 要先 `apt-get update`）。
