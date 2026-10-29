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

## 4. 已知限制

- **真实模型的输出质量与回落率未验证**：本地与测试全部用假模型（假服务 / 注入）。上线后须人工验收，见 §5。
- **中文数字一律拒绝**：如"前两位销售""一份报价"会让整段回落。是有意的保守选择；验收期若误杀多，再单独 change 放宽。
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
