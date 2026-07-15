# PostFlow Worker 部署手册（青砚运营模块 M3）

小红书矩阵的半自动发布执行端。青砚负责生产内容和排队，本 worker 跑在自建服务器上，
轮询青砚认领任务 → 下载视频 → FFmpeg 去重化 → 调 PostFlow 浏览器自动化发布 → 回报结果。

```
青砚（Vercel）                      自建服务器（北美）
┌─────────────────┐               ┌──────────────────────────┐
│ PublishJob 队列  │◄─ claim ─────│ worker.py（本目录）        │
│ channel=postflow │── jobs ─────►│  ├ 下载视频（外部 URL）     │
│                  │◄─ report ────│  ├ ffmpeg 去重化           │
└─────────────────┘               │  └ postflow xiaohongshu … │
                                  └──────────────────────────┘
```

## 服务器要求

- 与 Postiz 可同机（参考 `deploy/postiz/README.md`），额外需要 2GB 内存余量跑浏览器自动化
- 依赖：Python 3.10+、FFmpeg、[PostFlow](https://github.com/DaBaoAgent/PostFlow)（含 Patchright 浏览器）

## 部署步骤

### 1. 安装依赖（服务器上执行）

```bash
apt install -y ffmpeg python3-pip
# 安装 PostFlow（详见其 README，含浏览器依赖）
git clone https://github.com/DaBaoAgent/PostFlow.git /opt/postflow
cd /opt/postflow && pip install -e .
```

### 2. 登录小红书账号

每个矩阵账号扫码登录一次，Cookie 会持久化：

```bash
postflow xiaohongshu login --account xhs_account_01
postflow xiaohongshu check --account xhs_account_01   # 验证登录态
```

`--account` 名要与青砚「矩阵账号」页登记的 **通道账号标识（externalChannelId）** 完全一致。

### 3. 配置青砚侧

Vercel 环境变量新增：

```
POSTFLOW_WORKER_TOKEN=<openssl rand -hex 32 生成>
```

### 4. 启动 worker

```bash
scp deploy/postflow-worker/worker.py root@服务器IP:/opt/postflow-worker/
```

```bash
# /etc/systemd/system/postflow-worker.service
[Unit]
Description=Qingyan PostFlow Worker
After=network.target

[Service]
Environment=QINGYAN_API_URL=https://你的青砚域名
Environment=POSTFLOW_WORKER_TOKEN=<与青砚一致>
Environment=POSTFLOW_CLI=postflow
ExecStart=/usr/bin/python3 /opt/postflow-worker/worker.py
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now postflow-worker
journalctl -u postflow-worker -f   # 看日志
```

## 工作机制

| 环节 | 说明 |
|---|---|
| 认领 | 每 60s 认领一条已到发布时间的任务；租约 30 分钟，worker 崩溃后自动回收 |
| 去重化 | 随机轻微裁切（2-6px）+ 亮度/对比度/饱和度抖动 + 重编码 + 去元数据，同一视频发不同账号产物各不相同；`UNIQUIFY=0` 可关闭 |
| 标题拆分 | 小红书标题限 20 字：文案首行截断作标题，其余作正文 |
| 定时发布 | 任务带 scheduledAt 且在未来时，走 PostFlow `--schedule`（平台原生定时） |
| 防风控 | 同一轮多个任务之间随机间隔 3-4 分钟（`PUBLISH_GAP_SEC` 可调） |
| 回报 | 回报必须携带租约令牌；失败按 5/30/120 分钟退避重试，最多 3 次 |

## 风控建议（30 个号的矩阵）

- 每号每天 ≤3 条（青砚账号配额默认值），发布时间用 scheduledAt 错峰
- 给不同账号配独立代理（PostFlow conf 支持），避免同 IP 关联
- 新号先手动养号 1-2 周再进自动化队列
- 出现「限流」迹象立即在青砚矩阵账号页把该号置为 limited/paused，队列会跳过
