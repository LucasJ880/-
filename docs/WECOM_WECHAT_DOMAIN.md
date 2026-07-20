# 企业微信 + wechat.mengxinhometextile.com 接入清单

产品站：`https://qingyan.ca`  
回调域名：`https://wechat.mengxinhometextile.com`  
回调路径（固定）：`/api/messaging/wecom/callback?org=<ORG_ID>`

## 1. DNS（阿里云万网）

域名 `mengxinhometextile.com` 当前 NS 为 `dns11/12.hichina.com`，在**阿里云 DNS 解析**中新增：

| 主机记录 | 类型 | 记录值 | TTL |
|---------|------|--------|-----|
| wechat | A | 76.76.21.21 | 600 |

保存后等待解析生效，检查：

```bash
dig +short wechat.mengxinhometextile.com A
# 期望：76.76.21.21

curl -sS https://wechat.mengxinhometextile.com/api/health
# 期望：JSON 健康检查
```

Vercel 项目已添加该域名；证书在 DNS 生效后自动签发。

## 2. Vercel 环境变量

Production / Preview（建议）：

```text
NEXT_PUBLIC_WECHAT_PUBLIC_ORIGIN=https://wechat.mengxinhometextile.com
```

设置后需重新部署，设置页才会显示备案回调域名。

## 3. 青砚网关配置

1. 登录 `https://qingyan.ca`，选好工作组织。  
2. 打开 **设置 → 微信集成** → **配置企业微信**。  
3. 填写 CorpID / AgentId / Secret / Token / EncodingAESKey 并保存。  
4. 复制页面上的「回调 URL」（应含 `wechat.mengxinhometextile.com`）。

## 4. 企业微信管理后台

1. 应用管理 → 自建应用 → **接收消息**。  
2. URL：粘贴上一步回调 URL（含 `?org=`）。  
3. Token、EncodingAESKey：与青砚保存值**完全一致**。  
4. 保存并验证（触发 GET 验签）。  
5. 在应用内发一条测试文本，确认青砚有受理/回复。

## 5. 常见失败

| 现象 | 排查 |
|------|------|
| DNS 无法解析 | 阿里云未加 `wechat` A 记录，或未生效 |
| 验签失败 | Token / AESKey 与青砚不一致，或 URL 漏了 `org` |
| 填了 qingyan.ca | 未配 `NEXT_PUBLIC_WECHAT_PUBLIC_ORIGIN`，或手填错域 |
| 404 `/wechat/callback` | 错误路径；必须用 `/api/messaging/wecom/callback` |
