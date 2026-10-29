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

（5.1 完成后补全命令输出）

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

（5.1 完成后填写：隔离库全量 `npm test` 的失败项逐一与 main 对比；PR CI 结果。）
