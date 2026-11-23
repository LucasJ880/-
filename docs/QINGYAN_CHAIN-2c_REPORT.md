# CHAIN-2c 报告 — 限制谁能更换项目负责人（`project-owner-change-guard`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-2c（Phase F（续）— 情报串联的后续） |
| 起因 | CHAIN-2b #532 留给 GATE 的第 ② 条：能编辑项目的人可以把负责人改成自己，从而按负责人拿到财务查看权 |
| 拍板 | Lucas 2026-11-20 GATE：「可以」（另立 change） |
| OpenSpec change | `project-owner-change-guard`（已归档到 `openspec/changes/archive/2026-11-23-project-owner-change-guard/`；新能力 `projects/owner-change`，9 条要求） |
| PR | #539，2026-11-23 合并（合并提交 `591ffa8a`）；归档后 `openspec validate --specs --strict` 154 / 154（不含同时在审的 CHAIN-1b 归档 #568） |
| 基线 | origin/main `91d928e4` |
| 开关 | 没有开关，合并即生效 |

## 1. 做了什么

负责人自动有项目财务特权（`src/lib/project-finance/access.ts`）。四个入口原来都让本身没有财务特权的人把自己设为负责人；现在四个入口用同一个判定（`decideOwnerChange`），被拒时整个请求不写（同一请求里的名称、日期、成员角色都不写，不新增成员、不写事件 / 审计、不同步日历），响应体都是 `{ error, code }`。

**按入口**

| 入口 | 以前 | 现在 |
|---|---|---|
| `PATCH /api/projects/{项目}` 的 `ownerId` | 能修改本项目的人（平台超级管理员、负责人、组织管理员、项目管理员）都能写任意 id，不校验目标；审计不带负责人 | 按下表判定；新负责人须是本组织在用成员（400 `OWNER_INVALID`）；带条件写入（409 `OWNER_CONFLICT`）；审计前后带 `ownerId` |
| `POST /api/projects/{项目}/members`（`duty: "owner"`） | 同上的人能加成员并设为负责人（没在项目里的组织管理员能把自己加进来当负责人） | 先按下表判定；目标检查沿用原来的 404 / 403 与说法；带条件写入；审计加前后 `ownerId` |
| `PATCH /api/projects/{项目}/members/{成员}`（`duty: "owner"`） | 同上；项目管理员能把自己那一行改成主负责人（`isSelfPromotion` 只拦角色） | 按下表判定；新负责人检查；带条件写入 |
| `PATCH /api/ops/projects/{项目}` 的 `ownerId` | 能管理执行项目的人（含组织管理员）都能换成任意存在的用户，包括自己；不写审计 | 既有门槛不变（不能管理的人照旧 403 `无权重新分配负责人` / `FORBIDDEN`）；之后按下表判定（管理者）、新负责人检查、带条件写入、新写审计 |
| `GET /api/projects/{项目}/members` | — | 多返回 `ownerChange: { canChange, canSelfAssign }`（只给能修改本项目的人算，其他人两项 false、不查授权） |
| 项目团队卡片 | 能修改本项目的人每行与「添加成员」都能选「主负责人」 | 按两个标记给「主负责人」（已离开组织的成员不给）；选了不能给的人改回「参与者」；换前确认；409 刷新；不能换 / 不能换给自己时写一句说明；「是不是负责人」看项目本身 |

**按身份**（组织项目；执行项目接口里「管理者」= 能管理执行项目的人）

| 身份 | 换给别人 | 换给自己 |
|---|---|---|
| 平台超级管理员 | 可以 | 可以（但他不是本组织成员时按「新负责人」400） |
| 持组织范围 `project.finance.manage` 的人（且能修改本项目） | 可以 | 可以 |
| 当前负责人 | 可以（交给别人） | 不变 |
| 组织管理员（管理者） | 可以 | 403 `OWNER_SELF_ASSIGN_FORBIDDEN` |
| 不是负责人的项目管理员 | 403 `OWNER_CHANGE_FORBIDDEN` | 403 `OWNER_SELF_ASSIGN_FORBIDDEN` |
| 个人项目（没有组织） | 只有负责人与平台超级管理员能修改，二者都能换给别人 | 只有平台超级管理员 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/projects/owner-change.ts`（新） | 纯判定 `decideOwnerChange`、`checkNewOwner`、`ownerChangeFlags`、`ownerChangeHint`、`ownerChangeConfirm`、固定文字（页面也用，不依赖 db） |
| `src/lib/projects/owner-change-access.ts`（新） | 调用人身份（财务特权 = `resolveFinancePrivilege(user, orgId, null).privileged`）、新负责人检查、`guardOwnerChange`（先权限后目标）、带条件写入 `writeOwnerIfUnchanged` |
| `src/app/api/projects/[id]/route.ts` | PATCH：判定、带条件写入、409、审计带 `ownerId`、账本 `changedFields` 照旧带 `ownerId` |
| `src/app/api/projects/[id]/members/route.ts` | GET 返回 `ownerChange`；POST 判定、带条件写入、409、审计带前后负责人 |
| `src/app/api/projects/[id]/members/[memberId]/route.ts` | PATCH 判定、带条件写入、409 |
| `src/app/api/ops/projects/[id]/route.ts` | PATCH：既有门槛之后判定、新负责人检查、带条件写入、409、新写审计 |
| `src/app/(main)/projects/[id]/page.tsx` | 把 `ownerChange` 传给工作台 |
| `src/components/project-detail/tabs/workbench-tab.tsx` | 项目团队卡片（两个下拉、确认、409 刷新、说明） |
| 测试 | 新 `src/lib/projects/__tests__/owner-change.test.ts`、隔离库 `owner-change-db.isolated.test.ts`，都已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` |

## 3. 测试

| 测试 | 结果 |
|---|---|
| `owner-change.test.ts`（新） | 21 通过：各身份 × 换给别人 / 换给自己 / 不变 × 有组织 / 个人项目；新负责人；两个标记；卡片说明与确认；全部文字逐字；四个入口与卡片的源码断言（含执行项目原来的 403 在新判定之前） |
| 隔离库 `owner-change-db.isolated.test.ts`（新，库 `qingyan_iso_c2c`） | 25 通过：五种身份 + 只读成员；四个入口；被拒时名称 / 成员 / 角色 / 审计都不变；新负责人不合格 400（权限先判）；经真实 PATCH 路由的 409（判定之后把负责人改掉）；审计（PATCH、加成员、执行项目）；成员接口标记；个人项目 |
| 相关既有单测（工作台 / 详情页 / 预览 / 运营权限 / 残留读点 / 下一步 / 协作接线 / 报价引擎 / 账本等 14 个） | 全过，不改期望 |
| 相关既有隔离库（`residual-reads-db`、`p1-ledger-db`、`finance-access-db`、`ops-authorize-db`） | 13 / 60 / 18 / 32 全过 |

## 4. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（本机全量，`qingyan_iso`，先删掉 Mention Gateway M2-A 留下的平台级网关那一行） | `704/714 通过, 10 失败`，10 项全是 main 上同样失败的既有项（Autopilot A2-P0、Phase3A-3 Approvals、Phase3A-4 Acceptance、Phase3A-4 Governance、Phase3A-5 Overview、客户报价 PDF 分页布局、Sunny 工艺单 DB、T4 授标情报 Postgres 矩阵、招标询价自动起草 DB 75 / 76、来信观察 DB）；全量里 `owner-change` 21、`owner-change-db` 25 全过 |
| `npm run test:ci`（不带数据库） | PASS（已注册 681 个，历史欠账 66 条；第一次因测试里一行同时有 `??` 与 `&&` 被 `check-swc-nullish-logical` 拦下，拆行后通过） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增指纹） |
| `openspec validate project-owner-change-guard --strict` | valid（9 条要求，都不超过 500 字） |
| `git diff origin/main -- prisma/ vercel.json` | 空 |

**2026-11-23 合入 main `b717427f` 后复跑**（合并提交 `0847e688`；main 含 FIX-12、FIX-13、FIX-17、FIX-21（#554，目录守卫）、CHAIN-4c、CHAIN-2b（#532）、CHAIN-3b、CHAIN-3c、#544、#553、BIDPAGE-1 及各自归档）：

- 冲突只有 TASKFLOW 一处，两边都保留：CHAIN-2 之后依次是 CHAIN-2b（main）、CHAIN-2c（本分支）；CHAIN-3 一行取 main 的新版。`scripts/test-all.sh`、`scripts/test-ci-unit.sh`、`src/app/(main)/projects/[id]/page.tsx` 自动合并（page.tsx 里 main 改的是投标页签换成 `BidTabEntry`，本分支加的是 `ownerChange`，互不相干）。
- 本分支改的源文件里，main 在分叉后只改过 `page.tsx`（同上）；四个入口的路由文件、`workbench-tab.tsx`、`owner-change*.ts` main 都没改。CHAIN-2b 改的 `src/app/api/projects/route.ts`（房间 JSON 去掉成本）本分支没碰；main 没有新增改 `ownerId` 的入口，`src/lib/projects/access.ts`、`src/lib/project-finance/access.ts`、`src/lib/rbac/**` 也没改。CHAIN-2b 让负责人有报价表助手的成本、BIDPAGE-1 汇总接口的金额门也认负责人——本 change 收紧的正是谁能成为负责人，两者叠加后口径一致。
- FIX-21 目录守卫 `project-routes-guard.test.ts`：98 通过。`src/app/api/projects/[id]/route.ts` 的 `PATCH` 守卫前仍只有运行环境闸（本分支的改动都在 `requireProjectWriteAccess` 之后），按预处理名单通过、测试没有提示删条目，名单不变；`guardOwnerChange` 是项目写守卫之后的判定，不是项目级守卫，不进守卫名单。
- 与 CHAIN-2e（#556，未合并）「这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人」兼容：组织管理员是管理者，可以把负责人换成别人。另用临时脚本（未提交，隔离库 `qy_iso_e`，跑完清掉数据）核对负责人是导入系统账号、组织管理员不是项目成员时：成员接口标记 `canChange` true / `canSelfAssign` false；`PATCH …/members/{成员}` 设为主负责人 200，`POST …/members` 加成员并设为主负责人 201，负责人都换成了那位同事。
- 单跑（隔离库 `qy_iso_e`，迁移已是最新）：`owner-change.test.ts` 21 通过；`owner-change-db.isolated.test.ts` 25 通过。
- `npm test`（新库 `qy_full_chain2c`，`prisma migrate deploy`）：`720/730 通过, 10 失败`，10 项与 main 既有失败逐条相同（来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB）；全量里 `owner-change` 21、`owner-change-db` 25、FIX-21 目录守卫 98 全过，Supplier Intel S1 审计脊柱 DB 也过。
- `npm run test:ci`（`env -u DATABASE_ENVIRONMENT`、CI 的库地址与 JWT）：PASS（已注册 696 个，历史欠账 66 条）；`npm run typecheck` 通过；`npm run lint:baseline` PASS（无新增指纹）；`bash scripts/check-test-registry.sh` 通过；`bash scripts/test-runtime-architecture.sh` PASS（9/9）；`openspec validate project-owner-change-guard --strict` valid；`git diff origin/main -- prisma/ vercel.json package.json package-lock.json` 为空。

## 5. 多维审查

**开工前（一个子 agent，只给四件套与代码）**——逐条核实后并入四件套：

| 意见 | 处理 |
|---|---|
| **阻塞**：执行项目接口 `PATCH /api/ops/projects/[id]` 也能换负责人，组织管理员能把自己设为任何执行项目的负责人，只查用户存在、不写审计 | **已加**为第 4 个入口：同一判定、新负责人检查、审计、409、测试 |
| 中标后转执行可以选自己为新项目负责人 | Out of scope + GATE 第 3 条 |
| 「添加成员」的身份下拉也有「主负责人」；页面要把标记传下去 | **已改**，进 Impact 与 tasks |
| 不要悄悄藏选项；自我指定被拒的话要指向对的人 | **已加**卡片说明；改 403 文字 |
| tasks 顺序（测试文件要先建）；财务特权用 `resolveFinancePrivilege(user, orgId, null).privileged` | **已改** |
| 持财务键的人也要是项目管理员；两个标记对没有修改权的人的含义；不写「防探测」；同时更换返回 409；个人项目；两位组织管理员互相指定；响应体 `{ error, code }` | **已改** |

**实现后（四个子 agent，各审一个维度）**——没有阻塞；逐条核实后：

| 维度 | 意见 | 处理 |
|---|---|---|
| 正确性与回归 | 卡片按成员行判断「是不是负责人」，负责人没有成员行时说明错 | **已修**：看 `project.owner.id` |
| | 「添加成员」选了不能给的人时 `addDuty` 仍是「主负责人」、只是显示「参与者」 | **已修**：选人时改回「参与者」 |
| | 已离开组织的成员那一行仍给「主负责人」 | **已修** |
| | 成员接口对只读成员也查授权，授权查询出错会 500 | **已修**：不能修改本项目的人不查 |
| | 加成员换负责人的审计没有前后负责人 | **已修** |
| 安全 / 隐私 / 硬纪律 | 没有越权、跨组织、schema 改动、模型调用、出站 | — |
| | 借同伙拿回负责人；新建执行项目不查负责人；负责人离开组织仍有特权；交接还有别的人能做 | GATE 与另立任务（§4） |
| 规格—代码—测试一致性 | 执行项目接口原来的 403 没有规格 | **已补**（这个接口不返回 `OWNER_CHANGE_FORBIDDEN`；普通成员连运营中心都进不去，源码断言守住「无权重新分配负责人」） |
| | 被拒的成员接口 / 执行项目请求没有断言「没有新审计」；409 只测了写入函数 | **已补**：经真实 PATCH 路由测 409 |
| | design D5「在其它字段之前」对成员接口不对；D6 的「能修改本项目」口径 | **已改**：同一事务一起回滚；= 项目详情的 `canManage` |
| | 个人项目的两句卡片说明到不了 | **已删**：个人项目不写说明 |
| 使用流畅与文案 | 换负责人前没有确认 | **已加**：`把主负责人换成「{姓名}」？`（调用人是负责人时加一句不能自己改回来） |
| | 409 后卡片不刷新 | **已修** |
| | 说明与 403 文字指向不清、400 / 409 说法生硬 | **已改**（逐字见规格） |

## 6. 留给 GATE

Lucas 2026-11-20：「#539 的规则不用变」——第 1、2 条照现在的规则，不改。

1. **谁能更换负责人**（D1 / D2 的取法：平台超级管理员、有财务特权的人、当前负责人、管理者只能交给别人）——**不变**。
2. **组织管理员借他人之手拿回负责人**：交给 X、X 再交回——要有真实的同伙（组织管理员不能自己造账号）；要堵上只能只让有财务特权的人换——**不变**（接受这个风险）。
3. **中标后转执行**（`src/lib/projects/handoff/execute.ts`）：操作人可以把自己选为新执行项目的负责人；能执行交接的不只组织管理员，持 `project.create` 或交接权限键的人也能。

另立任务（不在本次）：`POST /api/ops/projects`（新建执行项目）接受任何存在的用户作负责人、不查组织成员关系；负责人被移出组织后仍有写权限与财务特权（`src/lib/projects/access.ts` 负责人分支）。只有「管理执行项目」权限的人能经执行项目接口交接、但在项目团队卡片上不能——沿用既有口径。

## 7. 交叉验证（2026-11-23）

**结论**：可以合并，没有阻断项。被验证的是提交 `6e713eae`。

**交叉验证跑的数字**：角色矩阵 406 条；并发四个场景各跑 12 轮；27 个变异抓到 26 个；归档演练 152 → 153。

**四条发现与去向**

| 编号 | 发现 | 去向 |
|---|---|---|
| F1（测试缺口） | 成员列表接口 `src/app/api/projects/[id]/members/route.ts:37-46` 里「能不能修改本项目」的判断，把 `project_admin` 条件放宽成「有任意项目角色」（变异 M8b），两个测试都照过：测试里的只读成员既不是管理者也没有财务键 | **已补隔离库用例**：持组织范围 `project.finance.manage` 岗位、但在项目里只是只读成员的人。用例先确认他有财务特权、改不了本项目（PATCH 403），再断言两个标记都是 false |
| F2（测试缺口） | 执行项目接口上「能管理执行项目、但不是组织管理员」的人（运营主管 `ops_lead`）只有源码断言守着（去掉 `isManager: true` 的变异 M9，隔离库全过） | **已补隔离库用例**：按岗位的组织里，运营主管经 `PATCH /api/ops/projects/{项目}` 同时改名并换给自己 → 403 `OWNER_SELF_ASSIGN_FORBIDDEN`，名称、负责人、审计都不变；换给已停用的用户 → 400 `OWNER_INVALID`；交给本组织另一位成员 → 200，审计带前后负责人。顺手补了成员接口 PATCH 的 409 行为用例（变异 M16）：判定之后、写入之前负责人被换掉 → 409，那一行的角色不变、没有新审计 |
| F3（既有口径） | `src/lib/projects/owner-change-access.ts:24-27` 判「有财务特权」用 `resolveFinancePrivilege`，不看组织成员身份；删组织成员时也不停岗位绑定 | **不改代码**，登记后续：TASKFLOW 新增一行「待定」，并写进 §8 |
| F4（文档漂移） | TASKFLOW 的 CHAIN-2c 行还写「Draft PR」「全量 704/714」 | **已改**：PR #539 已 Ready；合入 main `b717427f` 后全量 720/730，与基线逐条相同；写上交叉验证结论 |

**变异验证**（隔离库 `qy_iso_e`；每次跑完都用 `git checkout` 还原路由文件。「补用例前」指 `6e713eae` 的测试，「补用例后」指本次的测试）

| 变异 | 补用例前（隔离库 / 单测） | 补用例后（隔离库 / 单测） |
|---|---|---|
| M8b：成员列表的 `project_admin` 条件放宽成「有任意项目角色」 | 25 过 0 失败 / 21 过 0 失败 | 29 过 1 失败（持财务键的只读成员两个标记变成 true / true）/ 21 过 0 失败 |
| M9：执行项目接口去掉 `isManager: true` | 25 过 0 失败 / 20 过 1 失败（只有源码断言抓到） | 28 过 2 失败（运营主管换给不合格的人、交给别人都变成 403 `OWNER_CHANGE_FORBIDDEN`）/ 20 过 1 失败 |
| M16：成员接口 PATCH 去掉 409 映射 | 25 过 0 失败 / 20 过 1 失败（只有源码断言抓到） | 29 过 1 失败（冲突时抛错，按 500 记）/ 20 过 1 失败 |

还原后：`owner-change.test.ts` 21 通过，`owner-change-db.isolated.test.ts` 30 通过（原来 25 条，加 F1 一条、M16 一条、F2 三条）。规格增量对应改了三个场景：「同时更换负责人」加上成员接口 PATCH 的 409；「成员接口的两个标记」加上持财务键的只读成员；新增场景「执行项目接口上不是组织管理员的管理者」。design「验证方式」写上这几种身份。要求的正文没有改。

**合入 main `d94e4323`（#562 FIX-23）后的门禁**（合并提交 `2baf0fb2`）：没有冲突，TASKFLOW 与两个测试脚本自动合并。FIX-23 只改 `src/app/api/agent/tasks/**`、`src/lib/agent-tasks/**` 和自己的文档，与本分支没有交叠。这一轮只加测试与文档、不改源码，没有重跑全量。
- 单跑（隔离库 `qy_iso_e`）：`owner-change.test.ts` 21 通过；`owner-change-db.isolated.test.ts` 30 通过。
- FIX-21 目录守卫 `project-routes-guard.test.ts`：98 通过。
- `bash scripts/check-test-registry.sh` 通过（已注册 698 个，历史欠账 66 条）。
- `npm run typecheck` 通过；`npm run lint:baseline` PASS（无新增指纹）。
- `npm run test:ci`（`env -u DATABASE_ENVIRONMENT`、CI 的库地址与 JWT）：PASS（已注册 698 个，历史欠账 66 条；隔离库测试在 CI 里按设计跳过）。
- `openspec validate project-owner-change-guard --strict`：valid。

## 8. 后续 / 已知限制

- **财务特权与岗位绑定不看组织成员身份**（交叉验证 F3，TASKFLOW「待定」一行）：`src/lib/projects/owner-change-access.ts:24-27` 判「有财务特权」用 `resolveFinancePrivilege(user, orgId, null).privileged`（`src/lib/project-finance/access.ts:50`），只看岗位绑定、不看组织成员身份；删组织成员时也不停岗位绑定。所以有一种人仍能把负责人换给别人：组织成员身份已经是 inactive，但保留着「老板」岗位绑定，又仍是项目管理员。他换给自己会因「新负责人须是本组织在用成员」得 400。这条路比合并前窄，口径与项目财务接口相同，本次不改。要改，就得让岗位绑定或财务特权跟着组织成员身份走，会影响所有按岗位判定的地方，所以另开 change。它与 FIX-21 后续 4（已离开组织的人仍过项目读 / 写权限，`src/lib/projects/access.ts`）是同一类问题，可以一起看。
- §6 末尾列的另立任务照旧：新建执行项目不查负责人的组织成员关系；负责人被移出组织后仍有写权限与财务特权。
