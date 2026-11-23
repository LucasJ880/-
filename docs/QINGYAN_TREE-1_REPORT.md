# TREE-1 报告 — 读公开网页（`public-page-reader`，含 TREE-0 登记例外）

任务书：`docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`（Evan 2026-11-22）。四件套：`openspec/changes/public-page-reader/`。交接：`docs/QINGYAN_TREE_HANDOFF.md`。

## 1. 做了什么

- **读公开网页的唯一入口** `src/lib/web-reader/`：`readPublicPage(url, ctx)`；上下文只能由 `createResearchReadSession({ orgId, jobId })` 从库里核对过的「人发起的调研 Job」建出，再 `session.forBranch({ branchKey, budget, deadlineAt })` 得到每一支的上下文。
- **六条读网页规则全部在代码里强制**：只在人发起的调研 Job 里读（定时任务 / 没有 Job / 不是调研 Job / 开关关 → 抛错、零请求）；用户代理 `QingyanResearchBot/1.0 (+https://qingyan.ca)`；只 GET、不带 cookie 与任何凭证；被挡即停（登录页 / 验证码 / 401 / 403 / 407 / 跳转到登录地址 / robots）；超时 / 中断 / 5xx 最多重试 2 次（等 1 秒、3 秒），429 只在 `Retry-After` ≤30 秒时等够再试一次；每次读页扣 1 次额度（跳转、重试、robots 不扣）、同站请求开始时间间隔 ≥2 秒；同一棵树内同址只读一次（并发合并）。
- **安全护栏**：只 http / https、只 80 / 443、网址带凭证拒绝；解析出的地址是内网 / 回环 / 链路本地 / 保留段一律拒绝，连接时由传输层的 `lookup` 再校验一次（防 DNS 重绑定）；最多跟 3 次跳转、每跳重新校验；单次请求 15 秒；正文解压后 2 MB 截断。
- **内容**：只读 HTML / XHTML，转纯文本（公共模块）；纯文本与其它类型不读（任务书「其它类型拒绝」）；**PDF 不在本层解析**（`.pdf` 网址、`application/pdf`、正文开头是 `%PDF-` 的都返回「不读」，由人用 TREE-6 补页；与任务书有出入，见 design D7、§6）。返回 `{ untrusted: true, url, finalUrl, fetchedAt, text, truncated, blocked, outcome, reason, messageZh, httpStatus, attempts, robotsRequests, fromCache }`。
- **被挡后不换地址**：常见的抓取代理、网页快照、翻译代理预置「不碰」；网址里嵌着这一支被挡过的站、或主机名以被挡站打头的按被挡，嵌着「不碰」站或嵌着的网址认不清的不读（design D13、D14）。被挡记在主机上：只差 `www.` 的同一个站与子域名一起挡，兄弟子域名不连带（www.canada.ca 被挡不影响 canadabuys.canada.ca）。
- **账按 Job 共用**：每支的读页上限（各次给的取最小）、已用读页数、没读页时取 robots 的次数、被挡站与每棵树的分支数记在进程内的树账本里，同一 Job 的多个会话共用；建会话时与审计历史取大；审计历史超过 2000 行这棵树不再读页（design D13、D14）。
- **站点名单**：「不碰」预置 `detail.1688.com`、`login.1688.com`、`merx.com`、`linkedin.com`、`facebook.com`、`instagram.com`、青砚自己的域名与 25 个抓取代理 / 快照 / 翻译代理（`jina.ai`、`translate.goog`、`archive.org`、`archive.ph` 等）；「按人发起处理」预置 `importyeti.com`（不看 robots，额度相同）；「可以读」预置 `canada.ca`、`gc.ca`、`canadabuys.canada.ca`。组织设置 `settingsJson.researchTree.sites` 只能加「不碰」与「可以读」。
- **审计**：每次发出过请求（页面或 robots）、或这一支发起过取 robots 的读页写一条 `research.web_read`；从缓存拿到被挡结果而新记下被挡站时也写一条（不含请求）。只记分支、网址、最终网址、结果类别、状态、字数、是否截断、原因、页面请求数、robots 请求数、取 robots 次数、站点、被挡站、是否来自缓存；不记正文与头。这些审计也是重建会话时恢复账的依据。
- **HTML 转文本挪成公共模块** `src/lib/text/html-to-text.ts`（原 `trade/email-forward-parse.ts` 那一份，输入上限做参数；邮件解析仍传 200 000，行为不变）。
- **开关** `src/lib/tender-research-tree/flags.ts`：`TENDER_RESEARCH_TREE_ENABLED` + `TENDER_RESEARCH_TREE_ORG_ALLOWLIST`。
- **TREE-0**：`openspec/config.yaml` 第 7 条「例外二」与两条范围反转；TASKFLOW 新节登记 TREE-0 ～ TREE-8；任务书入库；交接文档新建。

## 2. 改了哪些文件

- 新增：`src/lib/web-reader/{index,read-page,transport,pure,types,db-deps}.ts`、`src/lib/text/html-to-text.ts`、`src/lib/tender-research-tree/flags.ts`；测试 `src/lib/web-reader/__tests__/{web-reader,web-reader-pure,web-reader-edges,web-reader-transport}.test.ts`、`web-reader-context-db.isolated.test.ts`、`__tests__/fake-world.ts`（夹具）、`src/lib/text/__tests__/html-to-text.test.ts`。
- 修改：`src/lib/trade/email-forward-parse.ts`（改为调用公共模块）、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`（只新增注册）、`openspec/config.yaml`、`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`。
- 新增文档：`docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`、`docs/QINGYAN_TREE_HANDOFF.md`、本报告。
- 没动：`prisma/**`、`vercel.json`、`src/lib/workforce-runtime/**`、`src/app/**`、`src/lib/tender-intel/**`、`src/lib/tender-workforce/**`。

## 3. 测试

| 文件 | 内容 | 条数 |
|---|---|---|
| `src/lib/web-reader/__tests__/web-reader-pure.test.ts` | 开关真值表、内网地址（含 IPv6 各段）、网址校验、站点名单与组织覆盖（含预置代理）、robots（分组 / 产品名 / 重复斜杠 / 归一 / 上限 / 步数预算）、登录地址 / 登录页 / 人机验证 / meta refresh（含引号）、嵌入主机名与站点键、Retry-After、文案、唯一入口守卫（含 .mts / .cts、别处的测试目录） | 168 |
| `web-reader.test.ts` | 规则 1–6 的主路径（假网络 + 虚拟时钟） | 94 |
| `web-reader-edges.test.ts` | 审查后补的边界与回归：并发同址不空转（审计走宏任务）、被挡记真正挡人的站、每跳校验、robots 跳转、额度 / 截止 / 缓存、15 秒与截止封顶、429 边界、可以读站遵守 robots、跨会话间隔、robots 审计、额度封顶、关开关即停、网址检查、正文清理、PDF、结果冻结、内部状态改不动、审计历史恢复；第三轮挑错后：经代理换地址、并发会话共用账、取 robots 次数与缓存被挡从历史恢复、历史超限、网址检查只认 true、被挡站归一与上限、PDF 字节、缓存写失败、其它状态码；第四轮挑错后：跨源跳转读满 12 页、被挡立刻记（慢缓存）、组织额度不翻倍、伞形域名、嵌入认不清、前缀代理、被挡站归属、1001 个被挡站、空白后的 `%PDF-`；第五轮挑错后：www. 站被挡连带子域名、伞形域名例外、宽松解码、并发跨源跳转与已计 11 次、国际化域名；第六轮挑错后：藏字符、www- 前缀代理、不碰站的 www. 写法、伞形别名、只退计上的、被挡站入参 | 182 |
| `web-reader-transport.test.ts` | 真实传输层，只连本机服务：127.0.0.1 / localhost / [::1] / 0x7f.1 在连接前被拒（服务端 0 次）；接缝放行后 gzip、炸弹截断、brotli 炸弹（3 KB → 4 GiB）截断后不在后台继续解压（去掉修复时这条失败：1.5 秒 CPU 1653 ms）、坏 gzip、不跟 302、两种超时、连接失败、只 GET 无 cookie | 19 |
| `web-reader-context-db.isolated.test.ts` | 隔离库：经 extraMetadata 写标记的调研 Job、一键分析 Job、缺发起人、非人发起、已结束、别的组织、不存在；组织「不碰」；审计落库、键固定、不含正文；每次重建换新的时钟（＝新进程的账本），从库里的审计恢复额度、被挡站、缓存被挡、取 robots 次数；1500 行在前时新行不丢；超过 2000 行不再读页 | 23 |
| `src/lib/text/__tests__/html-to-text.test.ts` | 公共实现；用挪动前实现算出的固定期望值逐条比对；&#0;、截断、2 MB 性能 | 16 |

另：挪动 HTML 转文本前后，用 20000 条随机输入对比旧新实现 0 处不同（实现者）；审查员②、⑥ 各自独立再比 25245 次、59246 次，0 处不同。

## 4. 门禁

在干净的 worktree 里跑（`gate.sh`：`npx prisma migrate deploy` 到隔离库后依次跑下面各项），对照同一台机器上 main 的全量基线。

| 项 | 本分支最终提交 `ffaf629b`（基于 main `b717427f`，新库） | main `2c695ebe` 基线（新库） |
|---|---|---|
| `npm test` | 724/734 通过，10 失败 | 718/728 通过，10 失败 |
| 失败列表 | 与基线逐条相同（Autopilot A2-P0、Phase3A-3 / 3A-4 ×2 / 3A-5、Quote Operations PDF 分页、Sunny 工艺单 DB、T4 授标矩阵、RFQ-AUTO-2 自动起草 DB、MAIL-2 来信观察 DB） | — |
| `npm run test:ci`（不连库，同 CI） | CI unit subset PASS | — |
| `npm run typecheck` | 通过 | — |
| `npm run lint:baseline` | PASS（无新增 error；相对基线少 15 处） | — |
| `bash scripts/check-test-registry.sh` | 通过（已注册 700） | — |
| `bash scripts/test-runtime-architecture.sh` | 通过 | — |
| `openspec validate public-page-reader --strict` | 通过 | — |
| `openspec validate --specs --strict` | 152/152 | — |
| `git diff origin/main -- prisma/ vercel.json src/lib/workforce-runtime/ .claude/launch.json` | 空 | — |
| GitHub CI（validate-lint-typecheck-test-build） | `ffaf629b` 通过 | — |

`b717427f` 相对 `2c695ebe` 只改了文档与 openspec 归档（#561），不影响测试，所以基线用 `2c695ebe` 的新库全量。本分支多出的 6 项（734 − 728）就是本 PR 新增的 6 份测试，都通过。

前几轮（都与当时的 main 基线逐条相同）：`6e135414`（基于 `f9c73ba2`）722/733、11 项失败（多的 1 项是复用隔离库的脏数据，新库单跑两边都过）；`5c455f13`（基于 `f332dd91`）718/729、11 项失败（同一项脏库失败）；审查前的 `70b4e162`（基于 `451bb0d3`）713/723、10 项失败；多维审查修订后的 `01206fae`（基于 `22a87fb7`）717/728、11 项失败——每轮都与当时的 main 基线逐条相同。GitHub CI（validate-lint-typecheck-test-build）在 `5c455f13` 上通过；Vercel 预发预览构建成功。「Mention Gateway M2-A Identity DB」在新基线里也失败（旧基线里没有）：挑错交叉验证员查明是同一个隔离库被上一轮留下了数据（`Unique constraint (orgId, channel)`），换干净库就过；与本 PR 无关（本 PR 不碰 mention-gateway）。

零变化（没有调用方）：全仓 `git grep -nE "web-reader|tender-research-tree|lib/text/html-to-text" -- src scripts` 除本模块、测试、注册行与 `src/lib/trade/email-forward-parse.ts` 外为空；审查员⑥另用引用图可达性证明新模块从 1072 个应用入口 0 可达。

## 5. 多维审查与交叉验证

八个维度各一个子 agent，互相不看结论、不看实现者自述，只看任务书、四件套与 diff（审查对象 `9a8792a8`）；做变异的审查员只在自己的快照里改。结论：①⑤⑦②③④⑧「改完再合」、⑥「可以合并」；**阻断 1 条（②④独立复现）**。逐条去向如下（「改」都在 `01206fae` 里；「不改」写理由）。

**① 需求符合**（3 应改 5 小）：1.1 唯一入口可绕开 → 加守卫测试、生产入口不收 env【改】；1.2 只请求了 robots 的读页不写审计 → 审计按「发过任何请求」写、加 robotsRequests【改】；1.3 spec 把间隔与去重写成无条件 → 写明「同一读页会话、同一进程」【改】；1.4 每支 12 次不在代码里 → `forBranch` 封顶【改】；1.5 网址脱敏 → 新增 `allowUrl` 网址检查，TREE-2 必须用（D11）【改】；1.6 出入可接受 → text/plain 补理由、robots 整站作废写进交接【改文档】；1.7 文档与代码对不上 → 改【改】；1.8 测试缺口 → 全部补（edges / transport / pdf）【改】。

**② 正确性与回归**（1 阻断 3 应改 7 小）：2.1 阻断：并发同址合并空转卡死进程 → 登记 `p.finally(删除)`、同一等候对象只等一次、等候受截止约束（D12）【改】；2.2 扣了额度没发请求 → 改在真正发出前一刻扣【改】；2.3 被挡后同支并发仍发请求、记错站 → 每次发请求前复查、记真正挡人的站【改】；2.4 截止被排队与共享 robots 越过 → 同步预约节拍、robots「时间到了」不共用【改】；2.5 Retry-After 太宽松 → 只认秒数与 GMT 日期【改】；2.6 robots 429 与 spec 字面 → spec 写明按读取失败【改 spec】；2.7 robots 与 RFC 偏差 → 百分号归一、版本号、跳转 5 次【改】；2.8 登录地址漏判误判 → 补词、去路径参数、查查询值、去 cas【改】；2.9 finalUrl → 只写实际请求过的【改】；2.10 IPv6 少数段 → 补【改】；2.11 两条恒真断言 → 改为固定期望值 / 精确断言【改】。

**③ 读网页安全**（4 应改 6 小）：3.1 PDF 炸弹（58 KB → 21.8 秒 / 3.4 GB）→ 预扫描 + 30 页 + 8 秒 + 字数（D7）；不用 worker：unpdf 打包在服务端 chunk、要改 next.config.ts【改，worker 不做】；3.2 跨站跳转记错站【改】；3.3 robots 跳转不查登录地址【改】；3.4 节拍只在会话内 → 进程级【改】；3.5 DNS 无超时 → 5 秒【改】；3.6 / 3.7 同 5.1 / 1.1【改】；3.8 robots 阶段的内网 → 归「不读」、写审计【改】；3.9 finalUrl 带对方给的 userinfo【改】；3.10 IPv6 段【改】。

**④ 提示注入**（1 阻断 6 应改 5 小）：4.1 同 2.1【改】；4.2 PDF 正文无上限【改】；4.3 robots 匹配 CPU（5.7 秒同步）→ 规则条数 / 模式长度上限 + 步数预算【改】；4.4 finalUrl 可以是页面控制的 `data:` 串【改】；4.5 robots 跳转绕过被挡站与登录地址【改】；4.6 同 3.2【改】；4.7 网址是外发数据 → `allowUrl`（D11）【改】；4.8 测试接缝 / 额度不封顶 / 同支重复建上下文【改】；4.9 标记契约写不进 extraMetadata → 平铺、发起人取运行时保留键、核 workDomain 与 Job 状态【改】；4.10 结果对象可变 → 冻结【改】；4.11 被截止缩短的超时被缓存成全树结论 → 记「时间到了」不缓存【改】；4.12 登录墙漏判 / `cf-chl-` 误判 / 不可见字符 → meta refresh、换强标记、清不可见字符；隐藏元素交 TREE-2 提示词【改；隐藏元素另交 TREE-2】。给后续 change 的要求抄进交接 §6。

**⑤ 硬纪律**（1 应改 8 小；八条均遵守，config 改动有任务书授权）：5.1 读页额度不强制 12【改】；5.2 核对员总量 → config 加「每棵树最多 60 次」并在 D10 写依据【改】；5.3 tasks verify、D10、`narrative-pure.ts` 注释【改】；5.4 网址脱敏（同 1.5）【改】；5.5 design 第 1 条补 AgentRun.metadata【改】；5.6 design 第 8 条与实际不符【改】；5.7 反转二限定范围【改】；5.8「任何定时任务里不跑」措辞 → 「不发起」+ agent-runs 续跑不算 + 重新查 / 补页重算【改】；5.9 TREE-6 截图与 TREE-8 邮件不得调模型 → 写进交接【改文档】。

**⑥ 开关关 = 零变化与零出站**（可以合并；3 小）：引用图可达性分析：新模块从 1072 个应用入口 0 可达；email-forward 59246 组对比 0 差异；开关关不读库（真实入口 146 ms 抛 FEATURE_DISABLED）。6.1 每次读页复查开关【改】；6.2 零变化证据的 grep 太窄 → tasks 与本报告改为全仓 grep【改】；6.3 同 5.3【改】。

**⑦ 文案**（6 应改 14 小）：7.1「拒绝」→「不读」、403 改「对方禁止访问」【改】；7.2「未接通」与既有词撞 → 读页级「打不开」【改】；7.3 robots 技术词【改】；7.4 PDF 超过 2 MB 的原因【改】；7.5 文案唯一出处 `OUTCOME_ZH` / `REASON_ZH` 并进 spec【改】；7.6 D3 与交接单映射【改】；7.7–7.20 结尾统一、407 / 429 / 时间到了 / 连接失败 / 技术词、页面拼站名、版本号错误文案、区间叫法、TASKFLOW TREE-4 行、config 分段、spec 措辞、数字千位、proposal 动词【改】；7.13「到上限，未查完」留给整支级，读页级改「读页次数到上限，未读」【改】。

**⑧ 测试质量（变异）**（150 个变异抓住 111 个；G1–G11 应改，若干小问题）：审查员给的补充断言 E1–E29 全部吸收进 `web-reader-edges.test.ts` / `web-reader-pure.test.ts` / `html-to-text.test.ts`（按新契约改写）；G11 传输层没有行为测试 → 加测试接缝 `createNodeNet({ isBlockedAddress })` 与 `web-reader-transport.test.ts`【改】；`scripts/test-ci-unit.sh` 里隔离库测试只设 `NODE_ENV=test` → 与仓库其它隔离库测试同一写法（CI 没有库，自动跳过；全量门禁里在隔离库跑）【不改】。

**挑错交叉验证**（一个没参与实现、没参与上面审查的子 agent，基于 `01206fae`，结论「改完再合」，没有阻断）：它亲自跑了全量（PR 718/728、main 710/721，PR 没有新增失败）、test:ci、typecheck、lint、注册、架构、openspec；自写验收脚本 59/59、传输层与 300 轮并发随机测试；独立证明零调用方、email-forward 47672 次比较 0 差异。意见与去向（按「以更保守的一方为准」全部处理）：
X1（应改，高）PDF 预扫描可绕过（任意位置写 `/Encrypt` 放行、字典自称图片跳过、过滤器链解压出错被吞；40 KB 的文件 → 单页 9.7 秒 / 836 MB）→ 加密的不读、所有 Flate 流计数、过滤器链与解压出错按过大不读；spec 写实「单页解析不中断」【改】；X2（应改）等别的支取 robots 不受截止 → 受截止【改】；X3（应改）robots 跳到本支被挡站的结论进了共用缓存 → 不缓存的「这一支被挡」【改】；X4（应改）额度对象建好后可被改 → 内部记账、只读快照，持久化 used 写成 TREE-2 硬要求【改】；X5（应改）config「核对员一次」被放宽成每条一次 → 改回字面「每棵树一次」，30 次标明由实现者定，发起方式补「重新查」「补页后重算」两个取值【改】；X6（小）被挡后用 IP 地址或子域名绕过 → IP 地址的网址不读、被挡站的子域名也算被挡【改】；X7（小）网址检查可选 → 必填【改】；X8（小）robots 没解码非保留字符 → 解码【改】；X9（小）主机名末尾的点 → 归一【改】；X10（小）入口导出了读库与写审计的函数 → 挪到 `db-deps.ts`、守卫测试禁止外部引用【改】；X11（小）「不碰」没有自家域名 → 预置 qingyan.ca / qingyan.ai / vercel.app【改】；X12（小）等审计写库与持久缓存不受截止 → 毫秒级，按截止中断会丢审计行【不改，design D5 写明】；X13 流程项：tasks 打勾、变基到最新 main 后重跑门禁、每条有去向【做，见 §4 复跑】。

**第二轮挑错交叉验证**（又一个没参与过的子 agent，基于 `5c455f13`，结论「改完再合」，**阻断 1 条**）：它亲自跑全量 718/729（11 个失败逐个在两边单独重跑：10 个签名相同，Autopilot A2-P0 单跑两边都过＝不稳定）、test:ci、typecheck、lint、注册、架构、openspec；差分 36004 用例 0 差异；传输层、重绑定、炸弹、并发压力（6×40×80）无卡死。意见与去向：
Y1（阻断）PDF 预扫描靠正则可被六种写法绕过，且 1.1 KB、不超任何上限的放大文件单页 11 秒 / 711 MB → **读网页层不在线解析 PDF**（返回「不读」、由人补页），删掉 `pdf.ts`；进程隔离要改打包、影响既有上传解析，本 PR 不做；与任务书「PDF 用 unpdf 抽文字」的出入报 Evan【改；出入上报】；Y2（应改）调用方能改额度 getter、站点名单、被挡站、审计归属、截止时间 → 全部内部记账、冻结外观与快照、原始值只读一次、截止只收有限数【改】；Y3（应改）重建会话额度与被挡站清零、分支无限 → 建会话时从审计历史恢复、每棵树 ≤24 支【改】；Y4（小）robots 跳转没查登录地址与 IP【改】；Y5（小）主机名末尾两个点 → 有空标签的网址无效【改】；Y6（小）守卫按字面匹配可绕、可直接写审计动作 → 路径规范化、审计动作字面量只许在本模块；刻意混淆由代码审查兜底【改】；Y7（小）robots 请求不受额度 → 每支取 robots ≤12 次【改】；Y8（小）持久缓存不校验 → 校验形状、强制不可信【改】；Y9（小）config 里实现者解释没全标 → 标明三处、交接请 Evan 确认【改】；Y10（小）文档对不上、Job 状态只在建会话时查、规则 1 依赖 TREE-2 只在人发起接口写标记 → 文档改；会话只活一个切片写进 design；写进 TREE-2 验收【改文档】。

**第三轮挑错交叉验证**（又一个没参与过的子 agent，基于 `ed1e5357`，结论「改完再合」，**阻断 1 条**、应改 5 条、小问题 11 条）：它亲自跑全量 718/728（10 个失败逐个在两边顺序重跑：9 个两边相同，Autopilot A2-P0 单跑两边都过）、test:ci、typecheck、lint、注册、架构、openspec；email-forward 40108 次比对 0 差异；独立证明零调用方。它也独立实测了 unpdf（2110 字节的 PDF 让事件循环 40 秒不动），认为「读网页层不在线解析 PDF」的理由成立。意见与去向（全部按更保守的一方处理，见 design D13）：
Z1（阻断）被挡后经 translate.goog、r.jina.ai、12ft.io、谷歌快照、archive.ph、web.archive.org 包着同一网址照样读到 → 这类服务预置「不碰」；网址里嵌着本支被挡站的按被挡、嵌着「不碰」站的不读，每跳与每次发请求前都查【改】；Z2（应改）截断 / 超时后解压流在后台继续跑（3 KB brotli 每 2 秒 1.8 秒 CPU）→ 销毁解压流；测试去掉修复时失败【改】；Z3（应改）并发两个会话额度与分支上限翻倍 → 进程内按 Job 共用的树账本；跨进程由 TREE-2 的租约保证、写成硬要求【改】；Z4（应改）历史只取前 2000 行、新行被丢 → 多取一行，超过即整棵树不再读页【改】；Z5（应改）取 robots 次数每个会话清零 → 审计加 `robotsFetches`、按支恢复【改】；Z6（应改）缓存被挡不写审计 → 写一条不含请求的审计（`fromCache`）；每支被挡站上限 24【改】；Z7（小）allowUrl 返回 Promise 被当成放行 → 只认 `=== true`【改】；Z8（小）传回的被挡站不归一 → 站点键归一【改】；Z9（小）robots 组名带空格版本号不匹配、`//private/a` 绕过 → 取开头的字母 / 下划线 / 连字符；重复斜杠两种写法都要允许【改】；Z10（小）meta refresh 带引号认不出 → 认【改】；Z11（小）robots 次数用完借用读页额度的文案 → 单独的 `robots_limit`【改】；Z12（小）文档与文案停在旧 PDF 方案 → 同步【改】；Z13（小）标成 text/html 的 PDF 字节被原样返回 → `%PDF-` 开头的一律不读【改】；Z14（小）收纯文本与任务书「其它类型拒绝」有出入且没上报 → 改为不收纯文本（不再是出入）【改】；Z15（小）持久缓存写失败时审计不写 → 写失败吞掉、审计照写【改】；Z16（小）守卫不扫 .mts / .cts、别处测试目录豁免 → 扫、不豁免【改】；Z17（小）其它 4xx 与非标准 3xx 没有 Requirement → 补「其它状态码」【改】。config 提醒两点（「任何定时任务都不发起」比任务书宽、模型请求内部重试会让「核对员一次」变成多次）→ 已标为实现者解释、待 Evan 确认，D10 写明【不改，交 Evan】；「条款员每棵树一次」出处标错 → 改标任务书 TREE-3【改】。范围外：生产上已有几处在进程内解析不可信来源的 PDF（询价回信附件等）同样会被构造的 PDF 卡住 → 写进交接，建议另开任务【不在本 PR】。

**第四轮挑错交叉验证**（又一个没参与过的子 agent，基于 `6e135414`，结论「改完再合」，**没有阻断**、应改 4 条、小问题 9 条）：它亲自跑全量（PR 723/733、main 717/727，10 项失败逐条相同，相差的 6 项是本 PR 的 6 份测试）、test:ci、typecheck、lint、注册、架构、openspec；email-forward 81244 次比对 0 差异；把 19 处修复逐一去掉，对应测试全部变红。上一轮 17 条：15 条完全修好、2 条有残留（#1、#3，即下面的 E/F 与 C/G）。意见与去向（见 design D14）：
W-A（应改）robots 次数跨会话累计后挤占读页额度（跨源跳转只读到 6 页）→ 只计没读页的读页里取的 robots【改】；W-B（应改）被挡要等持久缓存写完才记、窗口内同一支又请求了同一站 → 得出被挡就记【改】；W-C（应改）组织调低的额度并发 / 重建翻倍 → 上限记进账本、取最小【改】；W-D（应改）www.canada.ca 被挡连带 canadabuys.canada.ca → 被挡记主机、兄弟子域名不连带【改】；W-E（小）嵌入主机名 64 个就停、三层编码认不出 → 三层解码、认不清不读【改】；W-F（小）前缀式代理与全角句点 → 以被挡站打头的按被挡、全角句点当「.」；其余写法列为已知限制【改 + 写明】；W-G（小）账本被挤出时同一 Job 两份账 → 上限 4096、规格写明例外【改】；W-H（小）`utm_source=facebook.com` 被判「该网站在不读名单里」→ 单独原因与文案；仍不读【改文案，范围不改】；W-I（小）历史超限借用读页额度文案 → 单独原因【改】；W-J（小）`*bot` 当成通配组 → 只认恰好是 `*`【改】；W-K（小）规格缺 `blockedSites` 入参与缓存例外 → 补【改】；W-L（小）排队后再查把代理站记成被挡 → 记真正命中的被挡主机【改】；W-M（小）节拍表只增不删、默认缓存存全文 → 节拍表清理；缓存内存写成 TREE-2 提醒【改 + 交接】；另 #12 残留（design 顶部还列 unpdf）、#13 残留（1 KB 空白后的 `%PDF-`）【改】。新增的 15 条测试在修前的代码上 14 条失败、修后全过。**第五轮挑错核实**（又一个没参与过的子 agent，窄范围核实第四轮的修订，基于 `d9d48d9d`，结论「改完再合」，**阻断 1 条**、应改 3 条、小问题 5 条）：它亲自单跑 6 份测试、email-forward、test:ci、typecheck、lint、注册、openspec，并把 A / B / C / D / L 的修复各去掉一次（A 跨会话那一半没有测试覆盖，已补）。A–M 里 B、C、G–M 修好，A、E 部分修好，D 修过了头。意见与去向（见 design D15）：V1（阻断）D14 把被挡改成「按主机、保留 www.」，被挡的是 www.X 时同一支照读 m.X、en.X、www2.X，「不换地址」变弱 → 改回站点键 + 后缀，伞形政府域名（canada.ca、gc.ca、各省）只认同一个站【改】；V2（应改）网址别处有坏的百分号编码让嵌入扫描整段中止 → 宽松解码【改】；V3（应改）并发跨源跳转、已计 11 次后跨源跳转仍以 robots_limit 结束、额度却扣了 → 已扣额度后取 robots 不查不计、只退计上的【改】；V4（应改）被挡的是 www. 站时前缀式代理认不出 → 同时按被挡主机与站点键比【改】；V5（小）`acme.com.au` 误挡、不碰站不做前缀 → 不碰站也做前缀；误挡写明【改 + 写明】；V6（小）额度「上限取最小」容易被当成每个切片的额度 → 交接写明用法【写明】；V7（小）国际化域名认不出 → 归一成 punycode【改】；V8（小）查询里带被挡站名字的 canadabuys 网址仍不读 → 交接写明【写明】；V9（小）design D5 / D13 旧说法 → 同步【改】。新增的 18 条测试在修前的代码上 14 条失败、修后全过。

**第六轮挑错核实**（又一个没参与过的子 agent，窄范围核实第五轮的修订，基于 `80f321b3`，结论「改完再合」，**没有阻断**、应改 3 条、小问题 6 条；V1–V4 复现修好，去掉 V1 / V2 / V3 的修复测试都变红；它推演确认非伞形域名的规则不比第三、四轮更松）：U1（应改）嵌着的被挡站里藏了网址解析会删掉 / 归一的字符（制表符、零宽字符、圈字母、变体选择符）认不出 → NFKC + 删可忽略字符 + 组合符号【改】；U2（应改）被挡站不带 www. 时 `www-x-example.proxy` 照读 → 主机一边也去 www. / www-【改】；U3（应改）以不碰站的 www. 写法打头的代理照读 → 同上【改】；U4（小）伞形域名下 www2. / m. / origin-www. 照读 → 别名算同一个站【改】；U5（小）「只退计上的」没有测试 → 补【改】；U6（小）并发时 robots_limit 可能是一时的 → 交接写明【写明】；U7（小）`x.www.canada.ca` 照读（比第四轮松）→ 被挡的是别名主机时连带它的子域名【改】；U8（小）传回带端口 / 网址的被挡站不生效 → 取出主机名，取不出拒绝【改】；U9（小）spec 与注释旧说法、测试里的 punycode 写错 → 同步【改】。新增 19 条测试在修前的代码上 18 条失败；「只退计上的」那条在改成退全部时变红。嵌入与前缀识别是尽力而为，任意改名的代理认不出——如实写进 design D16 与交接，靠「不碰」名单与 TREE-2 的网址检查兜底。

它（第四轮）另提出：「PDF 不在本层解析」与任务书的出入要 Evan 在合并前明确认可——按更保守的一方，合并前问了：**Lucas 2026-11-23 答「接受，合并」**。

## 6. 没验证到的地方与任务书出入

- **出入**：任务书 TREE-1「PDF 用现有的 unpdf 抽文字」与测试项「PDF 的 U+0000 被清」没有做——进程内解析 PDF 限不住成本（三轮挑错实测），进程隔离要改打包、影响既有上传解析，不在本批范围。**Lucas 2026-11-23 答：接受，合并**；PDF 只由人用 TREE-6 补页，进程隔离的 PDF 解析以后另开改动。

- 真实网络（政府站、gzip / br、真实 PDF、慢速响应）：本 change 没有调用方，生产上不会发出请求；真实读取在 TREE-2 接入后、预发验收时第一次发生。
- 同站 2 秒间隔、树账本只在同一进程内保证；跨进程同时处理同一 Job 由 TREE-2 用运行时租约保证（交接硬要求）。
- 范围外的既有风险：询价回信附件、文件解析、页级解析、宣传册解析在进程内用 unpdf 解析不可信 PDF，同样会被构造的小 PDF 卡住几十秒（第三轮挑错实测）；建议另开任务做进程隔离。

## 7. 回退办法

revert 本 PR 的合并提交即可：没有调用方、没有数据、没有迁移；`email-forward-parse.ts` 恢复原样。
