# Activepieces 执行层接入

青砚是企业事实、CRM、任务、审批、实验与营销结果的真相源。Vercel Cron 在青砚中产生幂等的定时请求，Activepieces 负责外部连接、重试和流程可视化，不保存最终业务判断。

## 部署

生产环境请使用 Activepieces 官方 Community Edition Docker Compose，而不是把其源码复制进青砚：

1. 在独立服务器克隆 `https://github.com/activepieces/activepieces`。
2. 按官方 `tools/deploy.sh` 生成配置。
3. 设置公网 `AP_FRONTEND_URL`、PostgreSQL、Redis 和 HTTPS。
4. 使用 `docker compose -p activepieces up -d` 启动。
5. 建议使用固定 release tag，并在升级前阅读 breaking changes。

官方部署说明：https://www.activepieces.com/docs/install/options/docker-compose

## 青砚环境变量

在 Vercel 和 Activepieces 中保存同一条高熵密钥：

```text
ACTIVEPIECES_WEBHOOK_SECRET=<至少 32 字节随机值>
```

青砚还需要配置五个 Activepieces Webhook URL：

```text
ACTIVEPIECES_MARKETING_SYNC_WEBHOOK_URL=
ACTIVEPIECES_MARKETING_HEALTH_WEBHOOK_URL=
ACTIVEPIECES_MARKETING_DAILY_BRIEF_WEBHOOK_URL=
ACTIVEPIECES_MARKETING_EXPERIMENT_WEBHOOK_URL=
ACTIVEPIECES_MMM_RUN_WEBHOOK_URL=
```

## 流程输入合同

青砚向 Activepieces 发送：

```json
{
  "schemaVersion": "1.0",
  "requestId": "uuid",
  "workflowRunId": "qingyan-run-id",
  "orgId": "organization-id",
  "flowKey": "sync-metrics",
  "callbackUrl": "https://app.example.com/api/integrations/activepieces/webhook",
  "requestedAt": "2026-07-18T12:00:00.000Z",
  "data": {}
}
```

请求头包含：

```text
x-qingyan-request-id
x-qingyan-timestamp
x-qingyan-signature: sha256=<HMAC_SHA256(timestamp + '.' + rawBody)>
```

青砚每小时调用 `/api/cron/marketing-automation`，并按多伦多时区启动：渠道指标每日 4 次、健康检查每日 07:00、推广日报每日 08:00、实验复盘每周一 09:00。调度请求使用稳定 `requestId`，Vercel 或 Activepieces 重试不会重复创建同一运行。

## 回调合同

Activepieces 回调青砚时使用相同签名算法，正文必须包含：

```json
{
  "eventId": "provider-unique-event-id",
  "eventType": "workflow.completed",
  "orgId": "organization-id",
  "workflowRunId": "qingyan-run-id",
  "data": {}
}
```

支持的事件：

- `workflow.started`
- `workflow.completed`
- `workflow.failed`
- `marketing.metrics.upsert`
- `marketing.health.requested`
- `marketing.daily_brief.requested`
- `marketing.experiment.review.requested`
- `marketing.mmm.completed`
- `marketing.mmm.failed`

`marketing.metrics.upsert` 应为每条数据提供稳定的 `ingestionKey`。青砚通过 `orgId + source + ingestionKey` 幂等写入，重试不会重复累计。

### 付费渠道（Google Ads / Meta / 小红书）回调示例

青砚 `sync-metrics` 出站 `data.providers` 可能为 `["google_ads","meta","xiaohongshu"]`。Activepieces 拉完各广告 API 后回调：

```json
{
  "eventId": "sync-google-ads-2026-W28",
  "eventType": "marketing.metrics.upsert",
  "orgId": "organization-id",
  "workflowRunId": "qingyan-run-id",
  "data": {
    "provider": "google_ads",
    "channelAccountId": "qingyan-channel-account-id",
    "externalAccountId": "123-456-7890",
    "snapshots": [
      {
        "weekStart": "2026-07-06",
        "spend": 1200.5,
        "clicks": 340,
        "impressions": 12000,
        "qualifiedLeads": 9,
        "currency": "CAD"
      }
    ]
  }
}
```

字段别名：`cost`/`amount`→spend，`conversions`/`results`→leads，`facebook`→meta，`xhs`→xiaohongshu。  
未配 Activepieces 时，同事可用 `/operations/growth/metrics` 或 `POST /api/marketing/metrics/bulk` 手灌；数字员工工具：`marketing_ingest_channel_metrics` / `marketing_request_data_sync`。

## 审批边界

Activepieces 不得直接：

- 增加广告预算；
- 启动或停止付费活动；
- 对外发布内容；
- 批量发送客户消息；
- 修改企业事实中心。

这些动作必须先在青砚生成 `PendingAction`，由负责人审批后执行。
