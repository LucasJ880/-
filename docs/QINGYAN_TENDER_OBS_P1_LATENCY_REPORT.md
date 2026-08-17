# 观察期包1 — 延迟压缩（让出链式自触发）实施报告

日期：2026-08-17 · 分支 `claude/ai-read-time-issue-758e82` · base = main `18b1b07d`
（冻结基线 `965258c0` 之后的 drift 已审计：#111 财务 / #120 Autopilot，与本包文件面零交集）

## 1. 问题与手段裁决

生产首单（T-1085，163 页）wall-time 35.6min，其中 ~10–15min 是 cron 2 分钟节拍
空转（每次让出后等下一班 `*/2`，实测单次 2:18；且同一 invocation 先跑
`processQueuedAgentRuns(2)` 再轮到 workforce，另有 ~48s 前置偏移）。

| 任务书手段 | 裁决 |
|---|---|
| a) 让出后自触发下一 tick | **本 PR 实施** |
| b) cron `*/2`→`*/1` | 不做（a 生效后收益趋零），留 fallback |
| c) t3 窗口并发上调 | 推迟——先在包0 观察用 workerCursor.logs 量单窗口耗时再定值 |

## 2. 设计核心

**契约零改动**：让出后 requeue 写 `nextAttemptAt = now + 2s`（CONTINUATION_DELAY_MS）。
自触发 child 从 requeue 时刻到实际消费之间隔着父收尾 + HTTP + 冷启动 + 鉴权，
必然 > 2s，故 continuation/attemptCount 契约（`attempts:0` / `queued` / +2s）一字未动，
既有 P11-CONT-* 探针原样有效。

**自触发在 route 层，不在 processor 层**（有意偏离任务书原文）：§38/§39 harness
直调 `processQueuedWorkforceJobs`——lib 层自触发会让回归期间对隔离库发起并发
tick（同库并发禁忌）。route 层 = 只有真实 HTTP cron invocation 会链式触发，
harness 语义天然不变。探针 OBS-P1-LAYER-01 长期值守这条边界。

**开关 = 单个 env**：`WORKFORCE_CONTINUATION_SELF_TRIGGER_URL`（显式完整基址）。
未配置 = OFF（当前默认），回滚 = 删 env + redeploy。不复用 `resolveAppOrigin`：
其 fallback 链是 `qingyan.ai`（非生产域）→ `VERCEL_URL`（`.vercel.app` SSO 302），
对 cron 自调用是双重陷阱。

**防风暴五层**：① 本批 `yieldedContinuations > 0` 才触发（链式节拍被真实工作
限速）；② 每 invocation 至多一次；③ depth 硬上限 25（超限退回 cron 节拍，
不失败；400 页包预计 ~20 hop 仍在内）；④ env 未配置默认 OFF；⑤ child 走完整
`requireCronSecret` + 非生产隔离防线。与常规 cron 重叠由既有 CAS+lease 兜底。

**continuation 模式跳过 legacy 队列**：`?trigger=continuation` 的 child 不跑
`processQueuedAgentRuns`（消除 ~48s 偏移），`metadata.trigger/depth` 留观测痕迹。

**fire-and-forget 机制**：`after()`（Next 16 stable）在响应发出后 fetch 自身
`/api/cron/agent-runs?trigger=continuation&depth=N+1`（Bearer CRON_SECRET），
AbortController 5s 只保证请求发出——child 处理最长 300s，父等完整响应会撞
自己的 maxDuration。

## 3. 改动清单（SCHEMA_CHANGE = NONE）

- `src/lib/workforce-runtime/constants.ts` — `WORKFORCE_CONTINUATION_MAX_DEPTH=25`
- `src/lib/workforce-runtime/processor.ts` — slice 结果/`job.queued` payload 新增
  `yielded` 观测（additive）；批量返回新增 `yieldedContinuations`；行为零改动
- `src/lib/workforce-runtime/self-trigger.ts`（新）— shouldFire 纯判定 + fetch 封装
- `src/app/api/cron/agent-runs/route.ts` — continuation 模式 + after() 自触发
- 测试：`__tests__/obs-p1-latency-self-trigger.test.ts`（21 探针，含反例守卫）；
  P11-CONT-10 探针如实更新到新形状（不变量不放松）；注册 test-all/test-ci-unit

## 4. 测试证据

- 纯平面：obs-p1 21/21；t5-p11-resumability 44/44；CI 单测子集 PASS；
  tsc 全量零错；eslint 变更文件零新增告警
- **§38 强制多切片 E2E 14/14**（隔离 Neon 分支，虚拟时钟）：5 invocation /
  4 让出 / 零重复窗口调用 / PERSIST 幂等重放零新增 / 域态全程 AGENT_ANALYZING
- **§39 真实模型 E2E 13/13**（隔离生产快照分支 + 真实 51 页标包 + gpt-5.6-terra +
  生产预算 240s，走生产入口 `processQueuedWorkforceJobs`）：5 invocation /
  t3 让出 2 次 / **attemptCount=1 ≤ 1（让出零烧）** / 24 窗口成功调用=窗口数
  （零重复）/ Analyst A/B 各 1 次 / canonical facts=85 reqs=118 sections=16 /
  域终态 REVIEW_REQUIRED
- 本地无法验证的项（见 §6 PENDING）：真实 Vercel 链式触发与 child-survives-abort

## 5. 预期收益与生产验收

首单 7 次让出 × ~2.2min ≈ 15min 空转 → 链式触发后 ~1min（HTTP+冷启动+鉴权）；
continuation 跳过 legacy 再省 ~48s/hop。同规模包目标 wall-time ≤ 20min，
由观察期下一单在包0 监控中实测（`job.queued(yielded=true)` → 下一次
`job.claimed` 的间隔即链式生效证据，事件 payload 已带 `yielded` 字段可直接量）。

## 6. 激活配方与 PENDING

激活（生产，Final Review 通过后）：
1. Vercel 生产 env 新增 `WORKFORCE_CONTINUATION_SELF_TRIGGER_URL=https://qingyan.ca`
2. redeploy 同一 approved commit。回滚 = 删该 env + redeploy（与 #106/#118 模式一致）。

PENDING（需真实 Vercel 环境，本地无法出证）：
- `P1_PREVIEW_CHAIN_E2E`：Preview 部署（三层门：bypass secret /
  `QINGYAN_ALLOW_CRON_NON_PROD` / 新 CRON_SECRET + 隔离库）验证
  ① 链式触发把 `job.claimed` 间隔从 ~2min 压到 ≤15s；
  ② **child 在父 abort 后继续执行完毕**（fire-and-forget 的成立前提，
  Vercel Node/Fluid 语义上成立但必须实证）。若证伪，fallback 依次为
  父 `waitUntil` 等 child 接收 → 手段 b（`*/1`）。
- 也可跳过 Preview，直接以「生产激活 + 观察期下一单」作为该项的实证
  （env 未配置前行为与 main 完全一致，激活是纯 env 操作，随时可回滚）。

## 7. Gate

```
P1_SCHEMA_CHANGE                 = NONE
P1_CONTINUATION_CONTRACT_UNCHANGED = PASS（§38 14/14 + §39 13/13 复跑全绿；attempts 让出零烧）
P1_SELF_TRIGGER_DEFAULT          = OFF（env 未配置=完全等同 main 行为）
P1_STORM_GUARDS                  = 5（yielded>0 / 单次 / depth≤25 / env 门 / cron 鉴权）
P1_HARNESS_LAYER_SAFETY          = PASS（processor 零自触发引用，探针值守）
P1_PURE_SUITES                   = 21/21 + 44/44
P1_PREVIEW_CHAIN_E2E             = PENDING（需真实 Vercel 环境，见 §6）
P1_PROD_WALLTIME_TARGET          = ≤20min（观察期下一单实测）
P1_STATUS                        = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
