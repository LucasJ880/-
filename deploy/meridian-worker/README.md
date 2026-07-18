# Meridian MMM Worker 边界

Meridian 不运行在 Vercel 请求进程中。它作为独立 Python 批处理 Worker，由 Activepieces 的 `mmm-run` 流程触发。

## 责任边界

青砚负责：

- 生成不可变、带校验状态的周级数据集；
- 保存模型运行、诊断、渠道贡献和预算情景；
- 展示结果并让主 AI 解释；
- 所有预算变化进入人工审批。

Worker 负责：

- 使用 Google Meridian 读取 `qingyan-meridian-weekly-v1` 数据；
- 运行预建模检查、模型拟合、诊断和情景计算；
- 不访问青砚数据库；
- 通过签名回调返回结果。

## 推荐运行环境

- Python 3.11–3.13；
- `google-meridian` 官方发行包；
- 正式模型建议 GPU Worker；
- 开发环境可以先用探索性数据验证输入/输出合同；
- 模型镜像和 Meridian 版本必须固定并写入回调 `modelVersion`。

官方项目：https://github.com/google/meridian

## 完成回调

```json
{
  "eventId": "meridian-job-id:completed",
  "eventType": "marketing.mmm.completed",
  "orgId": "organization-id",
  "workflowRunId": "qingyan-workflow-run-id",
  "data": {
    "modelRunId": "qingyan-model-run-id",
    "externalRunId": "worker-job-id",
    "modelVersion": "google-meridian@1.x",
    "diagnostics": {},
    "summary": {},
    "contributions": [
      {
        "channel": "google_ads",
        "spend": 1000,
        "contribution": 12,
        "contributionShare": 0.35,
        "roi": 3.2,
        "confidenceLow": 2.4,
        "confidenceHigh": 4.1
      }
    ],
    "scenarios": []
  }
}
```

若失败，返回 `marketing.mmm.failed`，并提供 `modelRunId` 和经过脱敏的 `error`。
