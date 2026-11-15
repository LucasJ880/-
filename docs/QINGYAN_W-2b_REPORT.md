# W-2b 报告：询价节奏三项可以在组织页上改

| 项 | 值 |
|---|---|
| change | `rfq-timing-settings` |
| TASKFLOW | W-2b（依赖 W-2，已完成） |
| 来源 | W-2 proposal 的 Out of scope 第 1 条；交接文档 §0.5f 第 3 项。Lucas 2026-11-15 全权交给 Claude |
| 分支 | `claude/w2b-rfq-timing-settings`（从 main 开） |
| 性质 | 扩一个已有接口 + 组织页多三项 + Muse 查看偏好一行文案。零 schema、零模型调用、没有新开关、没有对外动作 |

## 1. 问题

回复提前量（回复截止 = 截标前几天）、轮次锁天数（同一项目几天内不开新一轮）、催单天数（几天没回就起草催单）三项，系统一直从 `Organization.settingsJson.tenderRfq` 读（默认 7 / 3 / 3 天），但没有任何接口能写：`PUT tender-rfq-settings` 不收，组织想改只能改数据库。

## 2. 做了什么

- **接口**：`PUT tender-rfq-settings` 收 `replyLeadDays` / `roundLockDays` / `chaseAfterDays`，1–60 的整数，null 清空回到默认；合并规则与其它项相同（传了的覆盖、没传的保留），锁行写库、记审计不变。`GET` 多返回 `timing`（组织层生效值，直接用系统本来的读取函数算）、`timingDefaults`（7 / 3 / 3），`stored` 多三项（库里存的值正是生效值才算存了）。
- **页面**：「询价与落地价设置」多一块「询价节奏（天）」。没单独设置的为空，占位写「未单独设置，默认 N 天」；保存只发改过的项；**先比较、后校验**——库里已有读取认得但不在 1–60 的旧值（如 0、2.5）不改就不发，也不挡别的项保存；只收纯数字写法。每项一句说明，按代码的实际行为写（见 §5 M2）。
- **Muse 查看偏好**：本人没设催单天数时，原来固定写「未设（默认 3 天）」，组织能改之后就不对了；改为「未设（按组织设置：N 天没回）」，N 用与催单扫描同一个函数算。
- 默认值、三项的读取与判定规则（回复截止、轮次锁、催单与未响应、自动跟进的定格天数）都没改。

## 3. 交付清单

| 位置 | 改动 |
|---|---|
| `src/lib/tender-rfq/landed-cost.ts` | PUT 的 zod 与合并函数收三项；取值范围常量 |
| `src/lib/tender-rfq/rfq-timing-view.ts`（新） | GET 里三项的读法（生效值、默认值、stored） |
| `src/app/api/organizations/[orgId]/tender-rfq-settings/route.ts` | GET 多返回三项 |
| `src/lib/tender-rfq/settings-form.ts` / `settings-section-state.ts` / `src/components/organizations/tender-rfq-settings-section.tsx` | 表单、状态、页面 |
| `src/lib/muse-bridge/router-pure.ts` / `router.ts` | 查看偏好写出组织天数 |
| `src/lib/tender-rfq/__tests__/rfq-timing-settings.test.tsx`（新） | 73 项 |
| `src/lib/tender-rfq/__tests__/rfq-timing-settings-db.isolated.test.ts`（新） | 36 项 |
| `settings-form.test.tsx` / `settings-form-db.isolated.test.ts` | `stored` 多了三项，两处断言随之调整 |
| `docs/acceptance/w-2b/*.png` | 真实浏览器截图 3 张 |

## 4. 证据

**新测试**

| 测试 | 项数 | 内容 |
|---|---|---|
| `rfq-timing-settings.test.tsx` | 73 | 接口校验（1、60、null 合法；0、61、小数、字符串、负数 400）与合并；读法（没存、都存了、各种坏值、个人偏好不算组织层、默认值不跟着变）；表单（只发改过的、清空发 null、旧值不改不发、纯数字写法）；页面状态；呈现与说明文字；Muse 查看偏好文案；接线 |
| `rfq-timing-settings-db.isolated.test.ts` | 36 | 真实接口 + 隔离库：读默认；页面只改一项、库里只多一项、别的组织不受影响、与直接调接口相同；**`loadRfqWebEntry` 真实取数**读到新的轮次锁天数（4 天前发的一轮在 5 天锁里）与催单天数，清空后回到默认；回复截止；负责人个人偏好仍优先；400 不改设置；普通成员 403；审计 |

两个新测试在 main 上都失败（纯函数测试加载不了新模块；隔离库测试 GET 没有三项、页面产出空请求）。

**真实浏览器**（本机隔离库，`next dev`；演示数据）

| 截图 | 看到的 |
|---|---|
| `section.png` | 「询价节奏（天）」：回复提前量显示存的 10，轮次锁、催单天数为空并写默认 3 天；每项的说明 |
| `saved.png` | 催单天数填 5 保存后：「已保存」，读回来 5 |
| `invalid.png` | 轮次锁填 0：「轮次锁天数：请填 1–60 的整数（或留空用默认）」，不发请求 |

截图里的说明文字是审查前的版本；审查后按 §5 M2 改了措辞（测试逐字断言新文字）。

**门禁**

| 门禁 | 结果 |
|---|---|
| `npm run test:ci` | 见 PR（本机，CI 的环境变量） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS |
| `bash scripts/check-test-registry.sh` | OK |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `openspec validate rfq-timing-settings --strict` | valid |
| W-2 原有测试、Muse `advisory.test.ts` / `prefs.test.ts` | 通过 |

## 5. 独立审查

开 PR 前请了一个不带结论的独立审查（只给分支、四件套、规格与任务书；它在自己的工作区里跑测试、对库里旧值做了探测、做了 12 处变异）。没有高等级问题；处理：

| 编号 | 发现 | 处理 |
|---|---|---|
| M1 | Muse「查看偏好」固定写「未设（默认 3 天）」，组织在页面上改成 5 天后就和扫描实际用的不一致；proposal 却写「Muse 意图无行为变化」 | 修。写出组织层天数；proposal 列出受影响的 `preferences`；spec 加一条要求 |
| M2 | 催单天数说明漏了：同一天数也决定第二次催单与标「未响应」（调小后，截止已过的会被直接标未响应，不用批）；「给你批」不对（交项目负责人批）；定格天数只在自动跟进授权仍生效时成立 | 修。说明文字、design Risks、spec 都按代码实际行为重写；回复提前量、轮次锁的说明也一并改准（「以后新建的」「上一轮已发出、没结束，从它建立起算」） |
| M3 | design 缺「与八条硬纪律的关系」与「验证方式」两节；D3、D4 没有被否决的备选 | 修 |
| L4 | `timingDefaults` 只在什么都没存时被测到 | 补测试（都存了、PUT 之后） |
| L5 | 回复提前量「存了但读取不认」的数字坏值没测到 | 补测试（每项都有负数 / 小数坏值） |
| L6 | 「旧值不改不发」没有测试 | 补测试（库里有 0 / 2.5，只改保险费率） |
| L7 | 隔离库测试只把设置喂给纯函数，没走真实取数 | 补：走 `loadRfqWebEntry` |
| L8 | 页面认 `1e1`、`0x0A` | 修。只收纯数字写法 |
| L9 | 两处说明不够准 | 修（同 M2） |
| L10 | 任务没打勾、截图没生成（审查时） | 已打勾；截图已入库 |

## 6. 变异核对

- 第一轮 25 处（接口校验 / 合并、读法、GET、表单、状态、组件）：24 处被发现；存活 1 处是等价变异（出错后去掉 `continue`：有错时整份请求本来就不发）。
- 审查的 12 处里存活 3 处（stored 的数字坏值、默认值、先比较后校验）；补测试后连同新规则（纯数字、Muse 文案、Muse 传参）共 6 处定向复跑，**全部被发现**。

## 7. 已知限制

- **改催单天数立刻影响在途询价**：没有生效中自动跟进授权的轮次，下一次扫描就按新天数——可能马上起草一批催单卡（仍须项目负责人批）；调小时，回复截止已过、最后一次联系已满新天数的会被直接标「未响应」。页面写明；与直接改数据库的效果相同。
- 不提供关掉轮次锁（0 天）。

## 8. 没做的

- 改默认值、改三项的读取与判定规则、改谁能改（仍是 org_admin / 平台管理员）。

## 9. 上线

合并后照常部署。零 schema，没有开关：组织管理员在组织页就能看到并修改；不改就和现在一样。回滚 = 回滚代码（已存进组织设置的三项照旧被读取，与改数据库的效果相同）。
