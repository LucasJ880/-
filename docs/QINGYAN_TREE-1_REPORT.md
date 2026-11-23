# TREE-1 报告 — 读公开网页（`public-page-reader`，含 TREE-0 登记例外）

任务书：`docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`（Evan 2026-11-22）。四件套：`openspec/changes/public-page-reader/`。交接：`docs/QINGYAN_TREE_HANDOFF.md`。

## 1. 做了什么

- **读公开网页的唯一入口** `src/lib/web-reader/`：`readPublicPage(url, ctx)`；上下文只能由 `createResearchReadSession({ orgId, jobId })` 从库里核对过的「人发起的调研 Job」建出，再 `session.forBranch({ branchKey, budget, deadlineAt })` 得到每一支的上下文。
- **六条读网页规则全部在代码里强制**：只在人发起的调研 Job 里读（定时任务 / 没有 Job / 不是调研 Job / 开关关 → 抛错、零请求）；用户代理 `QingyanResearchBot/1.0 (+https://qingyan.ca)`；只 GET、不带 cookie 与任何凭证；被挡即停（登录页 / 验证码 / 401 / 403 / 407 / 跳转到登录地址 / robots）；超时 / 中断 / 5xx 最多重试 2 次（等 1 秒、3 秒），429 只在 `Retry-After` ≤30 秒时等够再试一次；每次读页扣 1 次额度（跳转、重试、robots 不扣）、同站请求开始时间间隔 ≥2 秒；同一棵树内同址只读一次（并发合并）。
- **安全护栏**：只 http / https、只 80 / 443、网址带凭证拒绝；解析出的地址是内网 / 回环 / 链路本地 / 保留段一律拒绝，连接时由传输层的 `lookup` 再校验一次（防 DNS 重绑定）；最多跟 3 次跳转、每跳重新校验；单次请求 15 秒；正文解压后 2 MB 截断。
- **内容**：HTML / XHTML 转纯文本（公共模块）、纯文本、PDF（unpdf，U+0000 → 空格）；其它类型拒绝。返回 `{ untrusted: true, url, finalUrl, fetchedAt, text, truncated, blocked, outcome, reason, messageZh, httpStatus, attempts, fromCache }`。
- **站点名单**：「不碰」预置 `detail.1688.com`、`login.1688.com`、`merx.com`、`linkedin.com`、`facebook.com`、`instagram.com`；「按人发起处理」预置 `importyeti.com`（不看 robots，额度相同）；「可以读」预置 `canada.ca`、`gc.ca`、`canadabuys.canada.ca`。组织设置 `settingsJson.researchTree.sites` 只能加「不碰」与「可以读」。
- **审计**：每次实际发出页面请求写一条 `research.web_read`，只记网址、最终网址、结果类别、状态、字数、是否截断、原因、尝试次数、站点、分支；不记正文与头。
- **HTML 转文本挪成公共模块** `src/lib/text/html-to-text.ts`（原 `trade/email-forward-parse.ts` 那一份，输入上限做参数；邮件解析仍传 200 000，行为不变）。
- **开关** `src/lib/tender-research-tree/flags.ts`：`TENDER_RESEARCH_TREE_ENABLED` + `TENDER_RESEARCH_TREE_ORG_ALLOWLIST`。
- **TREE-0**：`openspec/config.yaml` 第 7 条「例外二」与两条范围反转；TASKFLOW 新节登记 TREE-0 ～ TREE-8；任务书入库；交接文档新建。

## 2. 改了哪些文件

- 新增：`src/lib/web-reader/{index,read-page,transport,pure,types}.ts`、`src/lib/text/html-to-text.ts`、`src/lib/tender-research-tree/flags.ts`；测试 `src/lib/web-reader/__tests__/{web-reader,web-reader-pure}.test.ts`、`web-reader-context-db.isolated.test.ts`、`src/lib/text/__tests__/html-to-text.test.ts`。
- 修改：`src/lib/trade/email-forward-parse.ts`（改为调用公共模块）、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`（只新增注册）、`openspec/config.yaml`、`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`。
- 新增文档：`docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`、`docs/QINGYAN_TREE_HANDOFF.md`、本报告。
- 没动：`prisma/**`、`vercel.json`、`src/lib/workforce-runtime/**`、`src/app/**`、`src/lib/tender-intel/**`、`src/lib/tender-workforce/**`。

## 3. 测试

| 文件 | 内容 | 条数 |
|---|---|---|
| `src/lib/web-reader/__tests__/web-reader-pure.test.ts` | 开关真值表、内网地址（含 IPv6 各段）、网址校验、站点名单与组织覆盖、robots（分组 / 归一 / 上限 / 步数预算）、登录地址 / 登录页 / 人机验证 / meta refresh、Retry-After、文案、唯一入口守卫 | 139 |
| `web-reader.test.ts` | 规则 1–6 的主路径（假网络 + 虚拟时钟） | 93 |
| `web-reader-edges.test.ts` | 审查后补的边界与回归：并发同址不空转（审计走宏任务）、被挡记真正挡人的站、每跳校验、robots 跳转、额度 / 截止 / 缓存、15 秒与截止封顶、429 边界、首次被挡记站、可以读站遵守 robots、跨会话间隔、robots 审计、额度封顶与每支只建一次、关开关即停、网址检查、正文清理、PDF 原因、结果冻结 | 59 |
| `web-reader-transport.test.ts` | 真实传输层，只连本机服务：127.0.0.1 / localhost / [::1] / 0x7f.1 在连接前被拒（服务端 0 次）；接缝放行后 gzip、炸弹截断、坏 gzip、不跟 302、两种超时、连接失败、只 GET 无 cookie | 17 |
| `web-reader-pdf.test.ts` | 预扫描（炸弹、图片流、LZW、加密、合计）与真实 unpdf（两页、35 页截 30 页、字数、8 秒、截止、炸弹、非 PDF、半截 PDF） | 15 |
| `web-reader-context-db.isolated.test.ts` | 隔离库：经 extraMetadata 写标记的调研 Job、一键分析 Job、缺发起人、非人发起、已结束、别的组织、不存在；组织「不碰」；审计落库、键固定、不含正文 | 15 |
| `src/lib/text/__tests__/html-to-text.test.ts` | 公共实现；用挪动前实现算出的固定期望值逐条比对；&#0;、截断、2 MB 性能 | 16 |

另：挪动 HTML 转文本前后，用 20000 条随机输入对比旧新实现 0 处不同（实现者）；审查员②、⑥ 各自独立再比 25245 次、59246 次，0 处不同。

## 4. 门禁

（待填）

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

**挑错交叉验证**（基于 `01206fae`）：（待填）

## 6. 没验证到的地方

- 真实网络（政府站、gzip / br、真实 PDF、慢速响应）：本 change 没有调用方，生产上不会发出请求；真实读取在 TREE-2 接入后、预发验收时第一次发生。
- 同站 2 秒间隔只在同一进程内保证。

## 7. 回退办法

revert 本 PR 的合并提交即可：没有调用方、没有数据、没有迁移；`email-forward-parse.ts` 恢复原样。
