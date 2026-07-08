# Postiz 部署手册（青砚运营模块 M1）

Postiz 是自托管的社媒统一发布引擎，负责 Facebook / Instagram（后续 YouTube、TikTok、Threads 等）的多账号排期发布。青砚侧通过「运营」导航入口打开它，后续 M2 再经其 Public API 做素材自动推送。

## 服务器要求

- **位置：北美**（需直连 Meta API，不能用国内阿里云那台）
- 配置：2 vCPU / **4GB 内存** / 40GB 磁盘（Temporal + Elasticsearch 吃内存，2GB 会 OOM）
- 系统：Ubuntu 22.04/24.04，装好 Docker + Docker Compose 插件
- 参考：DigitalOcean 4GB Droplet（约 $24/月）或 Hetzner CAX21（约 €7/月，性价比高）

## 部署步骤

### 1. DNS

给 Postiz 分配一个子域名（如 `ops.你的域名.com`），添加 A 记录指向服务器 IP。
Caddy 首次启动会自动申请 HTTPS 证书，所以 DNS 必须先生效。

### 2. 安装 Docker（服务器上执行）

```bash
curl -fsSL https://get.docker.com | sh
```

### 3. 上传本目录到服务器

```bash
# 本地执行（在青砚仓库根目录）
scp -r deploy/postiz root@服务器IP:/opt/postiz
```

### 4. 配置并启动

```bash
# 服务器上执行
cd /opt/postiz
cp .env.example .env
# 编辑 .env：填 POSTIZ_DOMAIN、JWT_SECRET(openssl rand -hex 32)、
# POSTGRES_PASSWORD(openssl rand -hex 16)；FACEBOOK_APP_ID/SECRET 等 M0 批下来再补
nano .env

docker compose up -d
# 首次启动拉镜像 + Temporal 初始化约 3-5 分钟
docker compose ps          # 全部 healthy 即成功
```

### 5. 初始化账号

1. 浏览器打开 `https://ops.你的域名.com`，注册第一个账号（即管理员）
2. 团队成员都注册完后，把 `.env` 里 `DISABLE_REGISTRATION` 改为 `true`，
   执行 `docker compose up -d` 重启，防止陌生人注册

### 6. 接社媒账号（等 M0 Meta 应用批下来）

1. 在 [Meta 开发者后台](https://developers.facebook.com) 的应用设置里，添加 OAuth 回调地址：
   `https://ops.你的域名.com/integrations/social/facebook` 和 `.../instagram`
2. 把 App ID / App Secret 填入服务器 `.env` 的 `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`
3. `docker compose up -d` 重启
4. Postiz 界面 → Add Channel → Facebook / Instagram，逐个授权矩阵账号

### 7. 接入青砚

在 Vercel 给青砚项目加环境变量并重新部署：

```
NEXT_PUBLIC_POSTIZ_URL=https://ops.你的域名.com
```

青砚侧边栏「运营」→「发布日历」即指向 Postiz。

## 日常运维

```bash
docker compose logs -f postiz     # 看日志
docker compose pull && docker compose up -d   # 升级
docker exec postiz-postgres pg_dump -U postiz-user postiz-db > backup-$(date +%F).sql  # 备份
```

## 后续（M2 预留）

Postiz 提供 Public API（设置页生成 API Key），青砚素材中心可直接调用其
`POST /public/v1/posts` 实现「视频 API 拉取 → AI 差异化文案 → 多账号排期」自动化。
