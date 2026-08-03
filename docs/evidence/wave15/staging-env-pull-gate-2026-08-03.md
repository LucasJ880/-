# Wave1.5 Staging env pull 门禁（2026-08-03）

**性质：** 配置门禁（脱敏）  
**PR：** #47  
**纪律：** 不输出 Secret / DSN / Cookie；Production 只读；Wave2 未批准

## 1. 本地核对

| 项 | 值 |
|---|---|
| repo | `LucasJ880/-` |
| branch | `docs/wave15-acceptance-execution` |
| head（门禁时） | `77f2ea5b6b9fffddadc2d6a369ec0b6f8046439a` |
| Vercel CLI | 已登录（`lucas-9039`） |
| 操作项目 | `qingyan-staging`（linked） |
| 目标环境 | Preview + git branch `staging` |

## 2. `vercel env pull` 结果（无 Secret）

临时文件（已删除，仅记录结构）：

- `.tmp/wave15-acceptance/qingyan-staging-preview.env`（被 `.gitignore` 的 `.tmp/` 排除）

| 键 | pull 后 |
|---|---|
| `QINGYAN_RUNTIME_ENV` | SET = `staging` |
| `QINGYAN_EXPECTED_DB_PLANE` | SET = `staging` |
| `GMAIL_DRAFT_ENABLED` | SET = `false` |
| `DATABASE_URL` | **EMPTY**（键存在，值为空） |
| `DIRECT_URL` | **EMPTY** |
| `CRON_SECRET` | **EMPTY** |

`vercel env ls` 显示上述敏感项为 **Encrypted / Preview (staging)**，但 CLI pull 无法解密本地值（Sensitive 典型行为）。

无 git-branch 的 Preview pull：分支覆盖变量全部 EMPTY（含 runtime/plane）。

## 3. 门禁判定

| 检查 | 结果 |
|---|---|
| DATABASE_URL / DIRECT_URL 属于 Staging | **无法确认** |
| `dbFingerprint=e0d93a32b6a2` | **无法计算**（无 DSN） |
| `QINGYAN_RUNTIME_ENV=staging` | PASS（非敏感值可读） |
| `QINGYAN_EXPECTED_DB_PLANE=staging` | PASS |
| 生产 endpoint | **未检出**（亦无 Staging endpoint） |

**处置：立即停止。** 未运行 Seed；未执行 O/P/I/T；未请求用户在聊天中粘贴 Secret。

## 4. 未执行项

Seed、bypass health、O2/O4/O5/P5/P6、I2/I6–I9、T4–T6 — **全部未启动**。

## 5. 继续必要动作（勿在聊天粘贴 Secret）

任选其一后回复「继续」即可（Agent 将重试 pull / 或使用终端隐藏输入）：

1. **Vercel Dashboard → `qingyan-staging` → Settings → Environment Variables**  
   - 确认 `DATABASE_URL` / `DIRECT_URL`（Preview / branch `staging`）已正确配置且非空  
   - 若标记为 Sensitive 导致 CLI 无法 pull：临时取消 Sensitive（或改为可 pull 的方式），Agent 重拉后校验 `ep-floral-sea-au07ycff` + fingerprint `e0d93a32b6a2`  
2. **本地终端隐藏输入**（Agent 编排 `read -s`，不进聊天 / 不进 evidence）  
3. 同时准备：Vercel **Protection Bypass for Automation** 名称 `wave15-acceptance`（值仅终端 `read -s`）

## 6. 清理

- 临时 env 文件：本轮结束后删除  
- 未创建 Cookie Jar  
- 未 export / 未回显任何 Secret  
- Production：**未写**  
- 真实外部通道：**未开**  
- Wave2：**未批准**  
- #47：**Draft** · 双 **NO-GO** 不变
