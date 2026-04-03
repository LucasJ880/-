# Intelligence Report 评估与复盘指南

## 1. 版本追踪

每次情报报告生成后，`ProjectIntelligence.fullReportJson` 的 `_meta` 字段会记录：

| 字段                | 说明                                |
|---------------------|-------------------------------------|
| `doc_type`          | 固定 `intelligence_report`          |
| `prompt_version`    | 当前 prompt 版本，如 `intelligence_report_v2` |
| `generated_at`      | 生成时间 (ISO 8601)                 |
| `model_used`        | 实际使用的模型                       |
| `reasoning_effort`  | 推理力度 (low / medium / high)       |
| `mode`              | deep / normal                        |
| `temperature`       | 温度                                 |
| `max_tokens`        | 最大输出 token                       |
| `source_char_count` | 输入文档总字符数                     |
| `source_doc_count`  | 输入文档数                           |
| `used_fallback`     | 是否使用了 fallback 模型             |
| `finish_reason`     | OpenAI 返回的 finish_reason          |
| `generation_time_ms`| 生成耗时 (ms)                        |
| `fallback_reason`   | fallback 原因（仅 fallback 时出现）  |

## 2. 如何对比旧版与新版输出

### 方法 A：数据库直接查询

```sql
-- 查看某项目的 meta
SELECT "fullReportJson"::jsonb -> '_meta' FROM "ProjectIntelligence" WHERE "projectId" = 'xxx';

-- 对比两个项目的 prompt_version
SELECT
  "projectId",
  "fullReportJson"::jsonb -> '_meta' ->> 'prompt_version' as version,
  "fullReportJson"::jsonb -> '_meta' ->> 'model_used' as model,
  "fullReportJson"::jsonb -> '_meta' ->> 'used_fallback' as fallback,
  "fullReportJson"::jsonb -> '_meta' ->> 'generation_time_ms' as time_ms
FROM "ProjectIntelligence"
ORDER BY "updatedAt" DESC
LIMIT 10;
```

### 方法 B：Vercel 日志

搜索 `[IntelligenceReport]` 关键字，每次生成都会打印：
- 开始参数（model, maxTokens, temperature, effort）
- Prompt 构建信息（sourceChars, docCount）
- 结果信息（成功/失败、耗时、finishReason）
- Fallback 情况（原因、使用的模型）
- 报告结构验证（检测到多少章节）

### 方法 C：人工对比清单

对比两份报告时关注：

| 维度 | 检查项 |
|------|--------|
| 结构完整性 | 是否包含全部 12 章节 |
| 判断边界 | 是否区分了"已知事实 / 推断 / 待确认" |
| 表格输出 | 技术评估、GO/NO-GO 矩阵、行动清单是否为表格 |
| 可执行性 | 行动项是否有负责人、时限、优先级 |
| 红线识别 | 致命风险是否被明确标注（而非模糊表达） |
| 供应链现实 | 是否贴合中国供应链 + 北美落地的现实 |
| 退化检测 | 是否退化成聊天式回复（空话、套话） |

## 3. 重跑测试流程

### 使用 process-next 端点重新生成

```bash
# 强制重新生成（先删除现有报告）
curl -X POST "https://your-domain/api/projects/PROJECT_ID/files/process-next?retry=1" \
  -H "Cookie: your-session-cookie"

# 持续调用直到 done=true
curl -X POST "https://your-domain/api/projects/PROJECT_ID/files/process-next" \
  -H "Cookie: your-session-cookie"
```

### 使用示例输入测试

见 `scripts/intelligence-report-eval/` 目录下的示例 JSON 文件。
可在本地 Node 环境下直接调用 `generateProjectIntelligence` 并对比输出。

## 4. 环境变量参考

| 环境变量 | 用途 | 默认值 |
|----------|------|--------|
| `OPENAI_MODEL_INTELLIGENCE_REPORT` | 主模型 | 全局 `OPENAI_MODEL`（deep preset） |
| `OPENAI_TEMPERATURE_INTELLIGENCE_REPORT` | 温度 | 0.3 |
| `OPENAI_MAX_TOKENS_INTELLIGENCE_REPORT` | 最大 token | 16384 |
| `OPENAI_REASONING_EFFORT_INTELLIGENCE_REPORT` | 推理力度 | high |
| `OPENAI_MODEL_INTELLIGENCE_REPORT_FALLBACK` | 回退模型 | 全局 `OPENAI_MODEL`（normal preset） |

## 5. 已知限制

- **Vercel Hobby 60s 限制**：主模型 + fallback 各 50s 超时。如果两次都超时，本次生成将失败，可通过 retry 重试。
- **截断风险**：如果 `finish_reason === "length"`，说明 maxTokens 不够。报告会不完整，但系统会尝试 fallback。
- **JSON 解析**：极少数情况下模型输出非法 JSON。系统会尝试提取 markdown 代码块中的内容。
