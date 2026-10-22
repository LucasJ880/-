# Muse Bridge Phase 0 — 落地手册（复制粘贴即可）

前提：电脑上已能 `npm run dev` 跑起青砚（.env 里有本地/开发库的 DATABASE_URL）。

## 第 1 步：把代码放进仓库并验证（1 条命令）

```bash
git checkout -b feature/muse-bridge-phase0
bash scripts/muse-bridge/setup.sh ~/Downloads/muse-bridge-phase0.patch
```
> 如果补丁已经 apply 过，去掉最后那个路径参数。脚本会装依赖、`prisma generate`、跑 43 项测试、类型检查。看到「Phase 0 本地验证完成」即可。

## 第 2 步：签发 Bridge token（1 条命令）

```bash
npx tsx scripts/muse-bridge/seed-token.ts
```
> 复制屏幕上的 `qy_...`，这就是 Muse--Bridge-bot 的 `QINGYAN_API_TOKEN`。只显示一次。

## 第 3 步：绑定你自己（1 条命令）

```bash
npx tsx scripts/muse-bridge/bind.ts --org <orgId> --muse <你的Muse用户id> --email <你登录青砚的邮箱>
```
> orgId：登录青砚 → 组织设置，地址栏 `/organizations/<这一段>` 就是。
> 同事也要用的话，每人跑一次，换 `--muse` 和 `--email`。

## 第 4 步：打开开关并冒烟

在 `.env` 末尾加一行：
```
MUSE_BRIDGE_ENABLED=1
```
重启 `npm run dev`，然后：
```bash
BASE_URL=http://localhost:3000 MUSE_BRIDGE_TOKEN=<第2步的token> ORG_ID=<orgId> MUSE_USER_ID=<你的Muse用户id> \
  bash scripts/muse-bridge/smoke.sh
```
把输出整段贴给 Claude，过 GATE-0。

## 出了问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 503 `BRIDGE_DISABLED` | `.env` 没加开关或没重启 | 加 `MUSE_BRIDGE_ENABLED=1` 后重启 dev |
| 401 `AUTH_INVALID` | token 粘贴不全 / 已 `--rotate` | 重新跑第 2 步 |
| 403 `USER_NOT_BOUND` | 第 3 步没跑或 `--muse` 不一致 | `npx tsx scripts/muse-bridge/bind.ts --org <orgId> --list` 核对 |
| 403 `ORG_MEMBERSHIP_REQUIRED` | 邮箱对应用户不在该组织 | 先在青砚把人加进组织 |
| setup.sh 类型检查报错 | 环境差异 | 输出贴给 Claude |

## GATE-0 完整验收（smoke.sh 四项通过后）

```bash
# 1) 造固定数据：一个 [MUSE-QA] 投标项目 + 一张待批（批准只会建一条任务，无外发）
MUSE_BRIDGE_ENABLED=1 npx tsx scripts/muse-bridge/gate0-fixture.ts --org <orgId> --email <青砚邮箱>
# 2) 用它打印的 PROJECT_ID / APPROVAL_ID 跑
BASE_URL=http://localhost:3000 MUSE_BRIDGE_TOKEN=... ORG_ID=... MUSE_USER_ID=... PROJECT_ID=... APPROVAL_ID=... \
  bash scripts/muse-bridge/smoke-gate0.sh
# 3) 清理
npx tsx scripts/muse-bridge/gate0-fixture.ts --org <orgId> --cleanup
```
