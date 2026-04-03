# Intelligence Report 评估样例

本目录包含 3 个代表性输入样例，用于重复测试情报报告生成质量。

## 样例清单

| 文件 | 场景 | 预期难度 |
|------|------|----------|
| `sample-input-01-curtain-tender.json` | 加拿大学区窗饰框架协议 | 中等（多产品+安装+防火认证） |
| `sample-input-02-surgical-mask.json` | 医疗耗材采购 | 高（严格技术标准+MDEL 认证） |
| `sample-input-03-solar-panel.json` | 美国联邦太阳能安装 | 极高（Buy America + 安全审查 + Davis-Bacon） |

## 使用方法

### 方法 1: 线上重跑

在青砚中创建一个测试项目，上传对应的文件内容，然后通过 process-next 端点触发生成。
对比前后两次生成的 `_meta` 和 `reportMarkdown` 内容。

### 方法 2: 数据库查询

```sql
SELECT
  p."name",
  pi."recommendation",
  pi."fitScore",
  pi."fullReportJson"::jsonb -> '_meta' ->> 'prompt_version',
  pi."fullReportJson"::jsonb -> '_meta' ->> 'model_used',
  pi."fullReportJson"::jsonb -> '_meta' ->> 'generation_time_ms',
  pi."fullReportJson"::jsonb -> '_meta' ->> 'used_fallback',
  length(pi."reportMarkdown") as report_length
FROM "ProjectIntelligence" pi
JOIN "Project" p ON p."id" = pi."projectId"
ORDER BY pi."updatedAt" DESC;
```

### 方法 3: Vercel 日志

在 Vercel Dashboard → Deployments → Functions → Logs 中搜索 `[IntelligenceReport]`。

## 评估检查清单

对每份报告逐项检查：

- [ ] 包含全部 12 个章节标题
- [ ] 技术评估为表格格式（含 ✅/⚠️/❌）
- [ ] GO/NO-GO 矩阵为表格格式（含加权分）
- [ ] 行动清单有负责人、时限、优先级
- [ ] 区分了"已知事实 / 推断 / 待确认项"
- [ ] 致命红线被明确标注（非模糊表达）
- [ ] 供应链分析贴合中国出口实际
- [ ] 无聊天式语气，全文为报告格式
- [ ] summary 以"建议投标/审慎评估/建议放弃"开头
- [ ] fitScore 与报告内容一致（不自相矛盾）
