# QYANE Supplier Intelligence M1 — S3-A 终审整改（FR1 / FR2 / FR3 / FR4）

> 本文只记录 **S3-A 终审整改**这一轮。原交付报告
> `QYANE_SUPPLIER_INTELLIGENCE_M1_S3_A_DELIVERY.md` 原样保留，不覆盖、不改写。
>
> 范围纪律：不是新阶段，不是重新设计 S3-A，不是 S3-B。schema / migration / 生产库 /
> 生产 flag 全程未动；没有向任何真实供应商发出过任何消息。

---

## 0. 这一轮到底在修什么

S3-A 首版能跑通「看懂标 → 搜供应商 → 人工确认」这条线，但终审挑出四类问题，
共同点是：**在正常路径上看不出来，在异常路径上会让采购同事做出错误决定**。

| 编号 | 问题 | 出事时的样子 |
| --- | --- | --- |
| FR1 | 执行声明没有所有权，过期即可被接管 | 同一次搜索被两个 executor 同时执行；慢的那个把快的那个的声明删掉 |
| FR2 | 异步响应不校验归属 | 打开线索 A → 核对身份 → 打开线索 B → A 的候选供应商出现在 B 的抽屉里；**人看到的是 B，点下去关联的是 A 算出来的那家** |
| FR3 | 信息有了但没给到人 | 内部源报「命中 2 家」，界面上点不开；AI 猜不出公司名就走不下去；历史 Run 只剩数字 |
| FR4 | 验收断言是空的 | `ok(cond \|\| true, …)`、夹具缺失即静默跳过——测试恒绿，绿得没有意义 |

---

## 1. FR1：执行认领的所有权与安全恢复

### 1.1 唯一 token（FR1-A）

`RunExecutionClaim` 增加 `claimId`（每次认领 `randomUUID()`）。

只记 `byUserId` 是不够的：**同一个人的两次执行也是两个不同的 owner**
（重复点击、刷新重发、两个标签页）。没有 claimId 就无法区分「我的声明」和
「我上一次的声明」，所有权检查也就无从谈起。

历史上没有 `claimId` 的声明一律**不识别为有效声明**（`readExecutionClaimRecord` 返回
`null`）——宁可让它走一次恢复流程，也不要在无法判定所有权的前提下继续写。

### 1.2 所有权化释放（FR1-B）

`releaseRunExecution(actor, runId, claimId)` 在 Run 行锁内比对当前声明的 `claimId`：
不一致 = **NO-OP**（返回 `false`，不是错误——一个超时的旧 executor 本来就该安静退出）。

修之前：一个跑得慢的 executor 的 `finally` 会把接手者的声明删掉，于是第三个请求
以为这个 Run 空闲，又起一轮。

### 1.3 过期执行的处置：不接管（FR1-C）

**这是本轮最重要的一个判断。**

TTL 到期只证明「上一次执行没有正常收尾」，**不证明它已经死了**——它可能只是慢
（跨洋 DB、provider 卡住、进程挂起）。在这个前提下自动接管，等于赌旧 executor 已经停手；
赌错了就是两个 executor 同时对同一个 Run 写结果，而这件事**没有任何办法事后验证**。

所以选最容易证明安全的那条：过期声明 → `RUN_EXECUTION_RECOVERY_REQUIRED`，
执行态对外是 `RECOVERY_REQUIRED`，界面明说「这次搜索的结果无法确认」，
唯一出路是**取消后新建**（终态不重入）。

代价是诚实的：用户要多点一次。换来的是「不可能出现双 executor」可以被直接论证，
而不是依赖一个租约续期 + generation fencing 的复杂协议在每个写点都不出错。
（fencing 方案的要求见任务书 FR1-C 后半段；本轮没有采用，因此也不需要在
provider stage / signal write / working data write / finalization / release 五个点上
各加一次 executor 身份确认。）

### 1.4 声明保全放进锁内（FR1-D）

原来 `updateRunWorkingData` 在**锁外**读声明、锁外合并、再整块写回 `statusDetailJson`，
存在「A 读到旧声明 → B 写入新声明 → A 把旧声明写回去」的复活窗口。

现在：只要本次要动 `statusDetail`，读—合并—写三步全部在同一个 Run 行锁事务内完成。

### 1.5 公开入口输入白名单（FR1-E）

`POST /runs/[id]/discover` 不再从请求体读 `finalize` / `includeInternalPool` /
`internalPoolLimit`。这个入口只表达一件事：**执行这个 Run**。策略由服务端固定
（`includeInternalPool: true`、`finalize: true`、内部池上限由 adapter 默认值决定）。

留着这些开关，等于让任何能发请求的人把一次搜索退化成「不收口、跳过内部源、拉满上限」。
S4 的组合编排若需要别的策略，走内部 service 调用（`executeSupplierSearchRun(actor, id, opts)`），
不再经过这个公开面。

### 1.6 界面上的恢复出口（FR1-F）

执行态四分类（`classifyRunExecutionState`）驱动界面：

| 执行态 | 界面给什么 |
| --- | --- |
| `IDLE` + PLANNED | 继续执行 / 取消 |
| `IN_PROGRESS` | 查看最新状态 / 取消（不给「再点一次」） |
| `RECOVERY_REQUIRED` | **只给**取消——并明说结果无法确认 |
| `TERMINAL` | 不能重启；重搜 = 新建 Run |

取消走新增的 `PATCH /api/supplier-intel/runs/[id]`，**只支持 `action: "cancel"`**。
刻意不提供「重置声明后原地重跑」——那等价于接管，绕开了 1.3 的整个论证。

请求结果未知时前端不自动重发有副作用的 POST，只重新读服务器状态。

---

## 2. FR2：异步上下文隔离

### 2.1 为什么用「值」而不是自增计数器

作用域判定基于 **scope 字符串**（`orgId::projectId`，抽屉里是 `signalId`），不是自增
generation。计数器在 React StrictMode 的重复执行下会错位——开发模式下 effect 跑两遍，
计数器 +2，正在飞的请求回来时发现自己「过期」了，数据永远加载不出来。
值比较不会有这个问题。

同一 scope 内再用 **ticket（slot + 序号）**实现「后发者胜」，并让 `finally` 只能清掉
自己那一轮的忙碌态（FR2-E）——否则旧请求的 `finally` 会把新请求的 loading 状态清掉，
界面看起来「好了」，其实还在加载。

实现集中在 `src/components/supplier-intel/scope-guard.ts`（纯类，可单测）。

### 2.2 覆盖到的路径

首屏加载、轮询、写后刷新、身份核对、供应商检索、抽屉内每个动作、Run 详情按需加载
——全部经 `guard.begin(slot)` 取票，响应回来先 `isCurrent()` / `isSameScope()`。

- **FR2-B 轮询**：切项目后到达的轮询响应不得 `setRuns`；切换时同时 abort 在途请求。
- **FR2-C 线索选择**：`resolution` / `candidates` / busy / error 全部绑定 `signalId`。
- **FR2-D 关抽屉**：写后刷新照常刷列表，但**当前选择保持用户此刻的状态**——
  抽屉已关或已换线索时，绝不 `setSelected` 把它拉回来。
- **FR2-E**：`shouldSettle()` 守住 busy 清理。

### 2.3 一个诚实的说明

任务书要求「project A → switch B → A 的响应到达 → B 不受影响」在真实浏览器里验证。
本应用的采购工作台**没有页内项目切换器**，换项目是整页导航，而整页导航会销毁 JS 上下文
——旧响应根本回不来。也就是说，照字面写出来的那个用例**即使把 FR2 校验全删掉也照样绿**。

所以浏览器侧改为验证**同一挂载内**真正可达的乱序：在「供应商线索」页签内切换状态筛选
（面板不卸载）。这个用例已用负向控制验证过会红（见 §5）。跨项目的定序逻辑由
`scope-guard` 单测覆盖，整页跳转另有一条回归断言（确认 B 只渲染自己的数据）。

---

## 3. FR3：把已有的信息真正交给采购同事

| 项 | 修法 | 关键约束 |
| --- | --- | --- |
| **FR3-A 内部候选可见** | Run 详情 API 增回候选清单（名字 / 来源 / 地区 / 类目 / 官网 / 档案入口），卡片上按需展开 | 读的是 `SupplierCandidate` 真表，**不复制成假 Signal**；文案只说「内部候选」，不出现推荐 / 合格 / 首选 |
| **FR3-B 人工检索** | 线索详情内「按名字找供应商」，直接检索 canonical 供应商库 | 不依赖 AI 能否猜出公司名；命中后仍由人点关联 |
| **FR3-C 新建 → 回来 → 关联** | 线索上下文内建 canonical Supplier，建完**留在原地**成为可选项 | **不 create-then-auto-link**；建档成功但关联失败时保留 supplierId，重试关联**不会重复建档** |
| **FR3-D 历史内容** | Run 卡片可展开「当时的采购要求」「当时的搜索简报」 | 只读 Run 自带快照；旧快照没有中文时显示英文并标注「中文未记录」，**绝不回查当前 canonical 冒充历史** |
| **FR3-E 计划词 ≠ 实发词** | 标题改为「本次计划搜索词」 | 外部来源未执行时明说「一条都没有真的发出去」；有执行时才给出已执行来源数 |
| **FR3-F 复核入口** | 工作台上真实可点的链接 → `/projects/{id}?tab=requirements&from=supply-chain`；招标要求页显示「返回国内采购工作台」 | 回到工作台后重新读取 canonical 视图（focus / visibilitychange / pageshow 三事件兜住 bfcache 与路由缓存）；未新增任何翻译 LLM |

---

## 4. FR4：让浏览器验收不再空转

删掉的东西：

- `ok(cond || true, …)` —— 全脚本 0 处；
- `ok(true, …)` —— 全脚本 0 处；
- `if (await x.count()) { …断言… }` 这类「夹具没了就当通过」的写法。

加上的东西：

- **夹具门**：13 项前置（org / 三种账号 / 三个项目 / 五个场景 Run / XSS 载荷）
  任何一项缺失 → 立即 FAIL 并以非零码退出，不进入后续用例；
- **端到端真流程**：Tender 入口 → 要求 → 开搜 → 内部候选 → 加线索 → 已查看 →
  人工检索 / 新建 → 明确 LINK → 刷新仍 LINKED，关键状态用 API 回读确认；
- **来源五态**：SUCCESS / EMPTY / FAILED / DISABLED / 未执行 由**真实 service 路径**
  产生（`createProjectSearchRun` → `executeSupplierSearchRun`，只把 provider/adapter 换成
  确定性测试实现），**不把 provider 选择做成生产 HTTP 参数**；
- **恢复态**：`RECOVERY_REQUIRED` 卡片不给「继续执行」、给「取消」；取消后终态；
  执行进行中重复提交 → 409；收口后重复提交 → 409；候选数不增加；
- **竞态**：慢响应 + 同挂载内切筛选 / 换线索 / 关抽屉；
- **XSS**：**先断言夹具里真的存着** `<img src=x onerror=…>`，再断言页面按字面渲染
  且 DOM 中 `img[src=x]` 数量为 0、载荷里的 `<script>` 没有变成脚本节点。

---

## 5. 负向控制（撤销修复 → 对应用例必须失败）

四项全部实测，**破坏版本没有提交**。

| 控制 | 撤销的修复 | 实测结果 |
| --- | --- | --- |
| NC1 | `releaseRunExecution` 的 claimId 所有权检查 | FR1-T2b/T2c/T2d 失败（3 项）。**T2d 直接证明了危害**：旧 executor 删掉新声明后，第三方立刻能重新认领 → 双执行 |
| NC2 | FR1-C 的 no-takeover（改回过期即接管） | FR1-T3a/T3b 失败（2 项） |
| NC3a | `ScopeGuard.isCurrent()` 恒真 | `scope-guard` 纯核首条即断言失败 |
| NC3b | `SignalsPanel.load` 的归属校验（真实组件 + 真实浏览器） | 「已关联」筛选下出现 1 条本属于「待查看」的行 —— 串台复现；恢复后回到 0 条 |
| NC4a | 夹具门（把 `xssSignalId` 与恢复态 Run 从清单里去掉） | 验收在夹具门即终止，退出码 1（不是静默跳过） |
| NC4b | 旧的 `\|\| true` 写法 | 实测旧条件 `!/<img\|onerror=/.test(innerHTML)` **恒为 false** —— 即：`\|\| true` 是承重的，旧断言在**完全正确**的产品上也会失败，它从来没有检验过任何东西。新断言注入真实 `<img src="x">` 后立即变红（真阳性可达） |

---

## 5B. FR1 最终收口：不可验证的执行声明（旧格式 / malformed）

### 5B.1 上一版留下的缝

§1 把「过期声明」守住了，但漏了一种更隐蔽的情况：**声明解析失败**。

原实现里 `readExecutionClaimRecord()` 对下列输入一律返回 `null`：

```text
executionClaim 存在但缺 claimId      ← 本轮之前写下的声明就长这样
claimId 为空串
expiresAt 非法
字段缺失 / 值不是对象
```

而 `classifyRunExecutionState()` 与 `claimRunExecution()` 都把 `null` 读成
「没有声明」→ `IDLE` → **允许认领**。于是 no-takeover 在正好最需要它的那批数据上失效：

> 升级前留下的每一个 legacy 声明，都可以被新 executor 直接接管并覆盖。

核心不变量被违反了：

```text
无法证明 Run 安全空闲  ≠  Run 空闲
```

### 5B.2 修法：marker 三态

`run-execution-state.ts` 增加 `readExecutionClaimMarker()`，返回：

| marker | 含义 | 执行态 | 能否认领 |
| --- | --- | --- | --- |
| `NO_CLAIM` | `statusDetailJson` 上**没有** `executionClaim` 这个自有属性 | `IDLE` | 可以 |
| `VALID_CLAIM` + 未过期 | 可验证且在有效期内 | `IN_PROGRESS` | 不可 |
| `VALID_CLAIM` + 已过期 | 可验证但没收尾 | `RECOVERY_REQUIRED` | 不可 |
| `INVALID_CLAIM` | 键在、值不可验证（旧格式 / 非法 / 被改过） | `RECOVERY_REQUIRED` | 不可 |

「有没有」用的是结构化的 `hasOwnProperty` 判断，**不是**在 JSON 文本里搜字符串
（后者会被任何含 `executionClaim` 字样的普通文本骗到——测试里有这条断言）。

`INVALID_CLAIM` 一律不 repair、不 delete、不 replace、不接管；恢复方式仍是
**取消旧 Run → 新建 Run**。

### 5B.3 顺带堵上的第二个洞（评审未点名）

排查调用链时发现 `updateRunWorkingData` 的声明保全也走 `readExecutionClaimRecord`：
不可验证的声明会被解析成 `null` → 整块重写 `statusDetailJson` 时**直接丢掉**。
也就是说，即使认领这一侧守住了，发现流程一次普通的状态档写入仍能把
「不可判定」洗成「空闲」，下一个请求就能重跑。

改成搬运 `marker.raw` **原值**（含不可验证的），并加了对应断言
（`FR1-FINAL-T5[*]：整块重写 statusDetail 后标记仍在`）。

`releaseRunExecution` 同理：证明不了所有权就不删——不可验证的声明返回 NO-OP。

### 5B.4 UI

不新增第五种用户可见状态。`INVALID_CLAIM` 复用既有的
`RECOVERY_REQUIRED` 呈现：「上一次执行没有正常结束，结果无法确认」→ 取消 → 新建。

### 5B.5 负向控制

把 `INVALID_CLAIM` 改回 `NO_CLAIM`（即恢复旧行为）后实测：

```text
纯核         首条 marker 断言即失败
执行态       legacy 声明 → IDLE（而非 RECOVERY_REQUIRED）
claimRunExecution  成功，并把 legacy 声明**替换**成全新 claimId
HTTP discover      200（不是 409）
副作用       该 Run 产生了 1 条候选 —— 第二个 executor 真的跑起来了
```

最后一行是这次修复的全部意义：**不是理论风险，是实测能复现的双执行**。
恢复修复后全部回到 PASS；破坏版本未提交。

## 6. 验证结果

### 6.1 测试

| 套件 | 结果 |
| --- | --- |
| `run-execution-claim`（FR1 纯核，含 marker 三态 / 旧格式 / malformed） | PASS |
| `scope-guard`（FR2 纯核，新增） | PASS |
| `procurement-view`（S3-A 纯核） | PASS |
| S3-A 服务 + HTTP（隔离库） | **131 通过 / 0 失败**（64 → 95 → 131，最后一轮为 FR1 最终收口） |
| S1 / S2 / S2-FR / S2-REM / S2-TB（隔离库） | 86 / 32 / 38 / 42 / 118，全部 0 失败 |
| `npm run test:ci` 全量纯核 | PASS（`CI unit subset PASS`，退出码 0） |
| 浏览器验收（Playwright，3 视口） | **122 通过 / 0 失败**（新增 7 条旧格式声明断言）|

关键写操作已按 §9 要求**回查数据库**确认：两条线索状态确为 `LINKED` 且指向人工选中的供应商；
既有供应商的 `website` 未被线索 `contentUrl` 覆盖；`E6 新建演示供应商` 无重复建档
（重名分组数 = 0，证明「建档成功 + 关联失败 + 重试」路径不会二次建档）。

### 6.2 工程门

| 门 | 结果 |
| --- | --- |
| `tsc --noEmit --incremental false` | PASS |
| 改动文件 eslint | 0 problems（16 个改动文件） |
| lint baseline gate | PASS —— errors 41 / warnings 137，较基线 **减少 12 处 error**，无新增 fingerprint |
| `npm run build` | PASS（webpack，静态页 361/361） |

---

## 7. 明确未做 / 未验证（不写 PASS）

```text
REAL_EXTERNAL_PROVIDER      = NOT_RUN   # 外部搜索 provider 未接线；本轮所有「外部来源」均为 DISABLED
REAL_PROCUREMENT_USER_UAT   = NOT_RUN   # 没有真实采购同事试用过
STAGING_RUNTIME_SMOKE       = NOT_RUN
FULL_TEST_ALL               = NOT_RUN   # 只跑了受影响面 + 全量纯核，未跑全库 test-all
```

- 夹具里的所有「厂家」都是**合成数据**，不是真实搜到的厂家；
- 「内部候选」来自夹具供应商库，不代表任何采购结论。

### 按要求 defer（本轮未触碰）

`quantity/unit` schema、Offering 工作流、Certification 工作流、S4 scoring、
Tavily 第四客户端、`Supplier.website` 归一化、org_admin 大 IN-list 性能。

---

## 8. 复现方式

```bash
# 1) 隔离库（禁止生产 DATABASE_URL）
export DATABASE_URL=...   # 隔离 Neon 分支
export DIRECT_URL="$DATABASE_URL"

# 2) 夹具（**每轮验收前都要重跑**：恢复态用例会消耗掉夹具，脚本自带同 org 范围内的场景重置）
NODE_ENV=test DATABASE_ENVIRONMENT=isolated SUPPLIER_INTEL_ENABLED=1 \
  S3A_FIXTURE_TAG=frwave npx tsx scripts/s3a-fixture-seed.ts   # 输出 JSON 存成 /tmp/s3a-ids.json

# 3) 服务 + HTTP
NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=... SUPPLIER_INTEL_ENABLED=1 \
  npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s3a-db.isolated.test.ts

# 4) 浏览器验收（dev server 必须跑在同一隔离库上）
S3A_BASE=http://localhost:3210 S3A_IDS=/tmp/s3a-ids.json S3A_PASSWORD=... \
  node scripts/s3a-workspace-acceptance.mjs
```

---

## 9. 状态

```text
CODE_HEAD_SHA               = 75e508b8934ec7ea7dfcd2098f9861385c8002d7
BASE_HEAD                   = 70df2d5eebb1e9dd4aeacfaaade059c957954776
BASE_MAIN                   = 4070d6d83842427e6318ab92ad7d19f0cc76fbae
PR                          = #208
PR_STATE                    = DRAFT
PR_MERGED                   = NO
SCHEMA_CHANGED              = NO
MIGRATION_CHANGED           = NO
PRODUCTION_DB_TOUCHED       = NO
PRODUCTION_FLAGS_CHANGED    = NO
S3_A_IMPLEMENTED            = YES
S3_ALL_COMPLETE             = NO
S3_B_STARTED                = NO
S4_STARTED                  = NO
PRODUCTION_ENABLED          = NO
```
