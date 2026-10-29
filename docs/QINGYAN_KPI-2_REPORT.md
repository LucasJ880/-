# QINGYAN KPI-2 报告 — 期间看板 AI 解读（sales-period-narrative）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-29 |
| TASKFLOW | KPI-2（Phase K — Sunny 日程归因与期间看板） |
| OpenSpec change | `openspec/changes/sales-period-narrative/` |
| 分支 | `claude/magical-shannon-keegzr`（实施中合入 origin/main `7c523860`） |
| 设计稿 / 交接 | `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §3.5（判断点 6）；`docs/QINGYAN_SUNNY_SCHEDULE_KPI_HANDOFF.md` |
| 拍板 | Evan 2026-10-29 同意为本处在 `openspec/config.yaml` 第 7 条开例外（用户转达）；用户"都按照你推荐的来"：例外句原文、中文数字一律拒绝、只用环境变量开关 |

## 1. 做了什么

| 部分 | 文件 | 说明 |
|---|---|---|
| 纪律例外 | `openspec/config.yaml` 第 7 条 | 追加"唯一例外（KPI-2，Evan 2026-10-29 拍板）：销售期间看板的 AI 解读可调用一次 LLM，只解读已算好的期间汇总；输出数字不在输入中即整段丢弃；开关默认关。" |
| 纯函数核心 | `src/lib/sales/period/narrative-pure.ts` | 开关；模型输入投影（不含 userId / 客户 / 他人；本人范围无日程来源）；下一步前提；固定提示词；解析；引用与词表；数字切词与比对；回落原因 |
| 服务 | `src/lib/sales/period/narrative.ts` | 复用 `buildSalesPeriodResponse` → 投影 → 一次 `createCompletionDetailed`（`mode: "fast"`，可注入）→ 校验 → `logAudit`（只记 outcome / model / scope / 期间 / 耗时） |
| 接口 | `src/app/api/sales/period-summary/narrative/route.ts` | `POST`：开关 404 `NARRATIVE_DISABLED` → 授权 403 → 期间 400 `INVALID_PERIOD` → 每人每分钟 6 次 429 `RATE_LIMITED` → 生成；前四步任一失败都不调用模型 |
| 期间汇总 | `src/lib/sales/period/load.ts` | 响应增加 `narrativeEnabled`；`narrative` 仍固定 `null` |
| 面板 | `src/components/sales-command-center/sales-period-panel.tsx` | `narrativeEnabled` 为真才显示"生成解读"；点击才请求；三段展示并标"AI 解读 · 数字已与看板核对"；回落 / 429 / 出错不显示模型原文；换期间清空 |
| 配置说明 | `.env.example` | `SALES_PERIOD_NARRATIVE_ENABLED`（缺省关） |
| 测试 | `period-narrative-pure.test.ts`（test-all + test-ci-unit）、`period-narrative-db.isolated.test.ts`（test-all） | 见 §2 |

无 schema、无 cron、无队列、无出站；不碰 Muse、CAL-1、`src/lib/ai/**`。

## 2. 怎么验

| 检查 | 结果 |
|---|---|
| apply 前基线 | period-pure 48、period-insights 38、Muse sales-pure 84、period-db.isolated 31、Muse sales-db.isolated 36 |
| `npx tsx src/lib/sales/__tests__/period-narrative-pure.test.ts` | 100 通过 0 失败 |
| 纯测试变异检查（临时副本，未提交） | 去中文数字检查 / 放宽到 1% 容差 / 去引用检查 → 5 项变红；去同号检查 / 比率与数量不分组 → 2 项变红 |
| `period-narrative-db.isolated.test.ts`（隔离库 127.0.0.1:5433） | 31 通过 0 失败：真实路由 + 真实 `createCompletionDetailed`，模型端为测试内的本机 OpenAI 兼容假服务（`OPENAI_BASE_URL`）；开关关 404 零调用、`GET narrativeEnabled` 两种取值、403 / 400 零调用、合法 200、编造数字 / 越词表 / 坏格式 / 模型 400 回落、费用超限（注入）、本人范围提示词不含他人、审计 outcome 序列与字段、第 7 次 429 不调用模型 |
| 端到端变异检查（临时，已还原） | 去开关判断与限次 → 8 项变红 |
| 无 `DATABASE_URL` 跑端到端 | 打印跳过，退出 0；清理后无残留 |
| 回归 | period-pure 48、period-insights 38、period-db 31、Muse sales-pure 84 / muse-bridge-pure 67 / sales-db 36，全过 |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `npm run test:ci` | 退出 0，`CI unit subset PASS` |
| `bash scripts/check-test-registry.sh` | 通过；已注册 486 个；`scripts/test-all.sh` 的 run_test 由 main 的 504 增至 506 |
| `openspec validate sales-period-narrative --strict` | valid |
| `npm run build` | 退出 0；`/api/sales/period-summary/narrative` 在产出表中 |
| PR [LucasJ880/-#332](https://github.com/LucasJ880/-/pull/332) CI `validate-lint-typecheck-test-build` | 绿（提交 `ae8525ae`），2026-10-29 用户确认后合并（`f4a6b8f2`） |
| `/opsx:verify sales-period-narrative` | 9 条要求、21 个场景均有对应代码与测试 / 浏览器检查；0 严重、0 警告 |

真实浏览器检查（`next start -p 3100` + Playwright + 本机假 OpenAI 服务 :4010，种子与脚本只写本机测试库、未进仓库）：

| 检查 | 结果 |
|---|---|
| 开关关，老板打开 `/sales/home?from=2026-10-01&to=2026-10-28` | 期间面板正常；无"生成解读"按钮；无解读请求；无错误 |
| 开关开，页面加载 | 按钮出现；加载时零解读请求 |
| 点击"生成解读" | 一次 POST；显示"AI 解读 · 数字已与看板核对"、本期结论"本期成单 2 单，合计 $4,000；报出 3 份，金额 4,500。"、下一步"催签 · 跟进那 1 份在手未签的报价。" |
| 假服务改为返回编造数字，点"重新生成" | 显示"本次解读未通过核对，已以上方确定性洞察为准"；页面不出现编造的 65,000 |
| 手机宽度 390px | 无横向溢出；无页面错误 |
| 假服务收到的调用 | 3 次，等于点击次数 |

## 3. 对设计稿 §3.5 的偏离与实施中的修订（均已同步 spec / design）

1. **模型调用路径**：设计稿写"模型经 ProviderRouter"。实际 `createCompletionDetailed` 走 `getClient()`，只有 `fast` 预设的模型名取自 `ProviderRouter.getFastModel()`；月费用预检与用量台账在该函数内已有。
2. **输出改为约定 JSON**：设计稿是"三段提示词 + 数字比对"。改为模型只能返回 `{ conclusion, reasons[{ text, insightCodes }], nextSteps[{ action, text, repName }] }`，原因必须引用输入里的洞察代码，动作只能取自按前提算出的 `allowedActions`，这样"下一步"与"原因"也能确定性核对。
3. **开关回显**：`GET` 增加 `narrativeEnabled`，面板据此决定是否显示按钮（spec 新增"叙述开关回显"）。
4. **限次与审计**：设计稿没有。新增每人每分钟 6 次与只记结果的审计（不存正文与金额）。
5. **重试的精确表述**（apply 中补 spec）：本功能只调用一次；共享 OpenAI 客户端沿用 SDK 缺省的传输层重试（429 / 5xx / 连接错误最多 2 次），`src/lib/ai/client.ts` 不在本 change 改动范围。
6. **温度**：传了 0.2，但推理族模型会被 `buildTuningParams` 丢弃，格式靠校验兜底，不依赖低温度。

**独立审查后修订**：一个只读审查代理没有看我的结论，给出 8 条，逐条核实后全部修复；纯测试 70 → 100，变异检查覆盖新规则。

7. **userId 进了模型输入**：I5 / I6 的证据带 userId，原样投影给了模型，cuid 里的数字还被当成允许数字（"72 份"能通过）。现在证据只留数值字段，允许集合只收数值字段与洞察文字、日期。spec 补场景"证据里的 userId"。
8. **格式绕过**：全角数字、英文数字词、"六万元""百分之五十""两周""翻一番"、"2万4千"、65k / 2k / 6.5e4、形似洞察代码的"I65000_X"都能绕过。现在先做 NFKC；中文数字拒绝规则扩到"百分之"、更多数量词与数量级；英文数字词、k / M 后缀、科学计数、千 / 百 / 亿 单位一律拒绝；只去掉输入里存在的洞察代码。
9. **正负号**：初版按绝对值比较，"报价金额 +7%"（实为 -6.99%）能通过。现在带号必须同号。spec 补场景"方向相反"。
10. **允许集合过宽**：百分比也能匹配计数（"14%"），比率四舍五入后成了 0，"1 万"能匹配 9,100。现在数值分组：数量与金额只按原值比对，百分比只比对比率，"万"只用于 ≥ 10,000 的金额且整数写法须整除。fixture 里 0–200 能通过的整数从 22 个降到 18 个，全部是输入里真实存在的数量、金额、日期或阈值。
11. **误杀**：`$61,230`（61,230.5 截断）被拒，现在接受截断。成员姓名里带数量词（"张三名下"）被误杀，现在先去掉姓名再查。"其中一个原因"之类仍会被拒，这是用户确认的保守选择，提示词里也已明确禁止。
12. **邮箱进了模型输入**：成员没填姓名时取数层会用邮箱代替。现在统一换成"未命名成员 N"，同一邮箱用同一代号。spec 措辞改为"成员姓名"，日程来源里的运营 / 管理成员姓名也在内。
13. **"1–3 句"无法核对**：spec 改为"1–3 条，每条 ≤ 200 字"。
14. **面板竞态**：只改对比方式时，加载期间按钮会用新的对比方式去配旧的期间。现在 key 与请求都取服务端回显的 `comparison.kind`。

## 4. 已知限制

- **真实模型的输出质量与回落率未验证**：本地与测试全部用假模型（假服务 / 注入）。上线后须人工验收，见 §5。
- **中文数字一律拒绝**：如"前两位销售""一份报价"会让整段回落。是有意的保守选择；验收期若误杀多，再单独 change 放宽。
- **不带号的百分比按绝对值**："报价金额下降 7%"与"上升 7%"都能通过，方向写在文字里，无法确定性核对。带正负号的写法已强制同号。
- **数字允许集合按"输入里出现过"判断**：模型复述输入里任一数字都算合法，即使放在错误的语境里（如把在手金额说成成单金额）。数字校验保证"不产生新数字"，不保证"每个数字放对了位置"；面板标注"数字已与看板核对"而非"结论已核对"，上方确定性数字始终可见。
- **开关是全局环境变量**：对所有企业同时生效；企业级开关需另开 change。
- **SDK 传输层重试**：模型端 429 / 5xx 时 SDK 最多再重试 2 次，费用与延迟按此估计。

## 5. 上线步骤

1. 在 Vercel（生产或预览）设置 `SALES_PERIOD_NARRATIVE_ENABLED=true` 并重新部署；确认 `OPENAI_API_KEY` 已配置。
2. 老板打开 `/sales/home`，选"本月至今"与"上月"各点"生成解读" 5 次，共 10 次；记录每次是通过还是回落（回落原因可在审计中心按动作 `sales.period_narrative.generated` 查 outcome）。
3. 通过的解读逐条对照上方瓦片与洞察，确认数字放在正确语境；结果补进本报告。
4. 回滚：删掉环境变量重新部署即停；无数据残留（审计只追加）。

## 6. 全量测试

隔离库（127.0.0.1:5433）全量 `npm test`，分支（`ae8525ae` 之前的提交，审查修复前启动；KPI-2 两个测试在修复后已单独重跑通过）与 origin/main `7c523860`（同库、同环境的独立工作树）各跑一次：

| | 通过 / 总数 | 失败 |
|---|---|---|
| 分支 | 493 / 505 | 12 |
| main `7c523860` | 491 / 503 | 12 |

- 总数差 2 = 本 change 新注册的两个测试（均通过）。
- 两边失败的 12 项完全相同，与本 change 无关：`TypeScript 类型检查`（test-all 里不带 `--max-old-space-size`，本容器 Node 22 堆溢出；单独 `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0，CI 也绿）、Phase3A-3 / 3A-4（两项）/ 3A-5 / 3B-A、Gmail Draft OAuth Compose Scope、Mention Gateway M2-A Identity DB、Sunny 工艺单 DB 端到端、T4 授标情报 Postgres 矩阵、Quote Operations 客户报价 PDF 分页布局、招标询价催单执行器。

PR [LucasJ880/-#332](https://github.com/LucasJ880/-/pull/332) CI `validate-lint-typecheck-test-build`：绿（提交 `ae8525ae`，含 `npm run build`），2026-10-29 用户确认后合并为 `f4a6b8f2`。
