# VIS-2 报告：运营看全公司销售额汇总

| 项 | 值 |
|---|---|
| TASKFLOW | VIS-2 |
| OpenSpec change | `openspec/changes/ops-sales-revenue-summary/` |
| 决定 | Lucas 2026-11-09：销售只看销售额（本人）；运营看运营数据 + 销售额；招投标对销售 / 运营不可见；老板看全部。运营只看汇总数字、运营主管与运营人员都看、销售保持只看本人 |
| 分支 | `claude/ops-sales-revenue-summary`（基于 main `439a19a`） |
| 截图 | `docs/acceptance/vis-2/01–02`（虚构数据，隔离库 + `next dev`） |

## 1. 现状对照（按代码里的岗位模板与导航规则逐岗位算出）

| 岗位 | 规则 | 改动前 |
|---|---|---|
| 销售人员 | 只看销售（本人） | 已符合：只有本人范围的销售权限；侧栏只有日历 / 销售首页 / 客户与商机 / 报价 / 我的业绩 / 邮箱绑定 |
| 运营主管 / 运营人员 | 运营数据 + 销售额 | **缺销售额**：没有任何 `sales.*` 权限 |
| 招投标 | 销售 / 运营看不到 | 已符合：招投标中心、项目列表、历史中标、竞争对手、采购机构只对招投标岗与老板可见 |
| 老板 | 全部 | 已符合 |

所以本次只补运营看销售额。

## 2. 改了什么

- **权限键** `sales.revenue.summary.read`（「查看销售额汇总」，只支持 ORG）：只读全公司汇总数字，不含客户、单个报价、按销售员明细。
- **岗位模板**（窗饰）：`ops_lead`、`ops_staff` 以 ORG 绑定该键；不给运营任何其他 `sales.*` 权限。
- **接口** `GET /api/ops/sales-summary`：全企业范围的汇总键或 `sales.analytics.read` 放行（运营岗 / 老板 / 合价 / 会计）；只有本人范围（销售人员）或没有 → 403 `SALES_SUMMARY_FORBIDDEN`。只返回本周（本周一至今天）与本月至今的成单金额、成单数、报价金额、报价数；口径就是销售期间汇总（KPI-1）的同一份计算（全企业范围）。
- **运营中心卡片**「全公司销售额」：计数行下方，两栏 × 三个数字，注明 CAD 含税、成单按签约日、报价按发出日；无权不渲染；不链销售页。

零 schema、零出站、零 LLM、无新队列；运营只多一个只读汇总键。

## 3. 测试与门禁（实际运行）

| 检查 | 结果 |
|---|---|
| `revenue-summary.test.ts`（新增：窗口、跨月的周、数字、与期间汇总同口径、白名单字段、权限键、岗位绑定） | 9 passed |
| `revenue-summary-db.isolated.test.ts`（新增，隔离库 + 真实岗位绑定 + 真实路由） | 13 passed；无库跳过 |
| 回归（纯）：`authorize` / `digital-employee` / `residual-reads` / `position-binding-console` / `position-nav` / `entry-visibility` / `route-gate` / `wechat-entry-nav` | 174 / 50 / 76 / 30 / 98 / 56 / 141 / 19 passed |
| 回归（隔离库）：`period-db` / `sales-record-access-db` / `residual-reads-db` / `position-binding-console-db` / `ops-authorize-db` | 55 / 15 / 13 / 35 / 32 passed |
| `check-test-registry.sh` | OK（556 已注册） |
| `npm run typecheck` / `lint:baseline` / `test-runtime-architecture.sh` | exit 0 / PASS / PASS |
| `openspec validate ops-sales-revenue-summary --strict` | valid |
| `scripts/seed-org-authorization.ts`（新增，单企业重跑岗位落地） | 隔离库：缺参数 / 不存在 → 退出码 2；删掉运营岗新键后跑一次补回 `ops_lead`、`ops_staff` |
| `npm run test:ci` | 见 PR 描述 |

DB 测试覆盖：固定 now（多伦多 2026-10-15 周四）下本周成单 1 单 $1,000、报价 $1,500，本月成单 2 单 $3,000、报价 $3,500；草稿、上月、已归档客户、其他企业不计，非 CAD 单列；运营主管 / 运营人员 / 老板 / 会计 200，销售人员 / 招投标 / 无岗位 403；响应只有白名单字段，没有客户名、销售员名或 id、报价 id；运营人员读销售期间汇总（按人明细）仍 403。

界面验收（隔离库 + `next dev`，虚构企业 Fixture Blinds Co.，按今天 2026-11-09 造的数据）：
- `01` 运营人员 Dana Ops 登录落在运营中心，看到「全公司销售额」：本周成单 1 单 $4,820.50、报价 $17,470.50；本月至今成单 3 单 $17,405.50、报价 $32,195.50（与造的数据逐笔核对一致）。侧栏没有销售与招投标入口。
- `02` 卡片特写。
- 同一会话里：运营人员请求销售期间汇总 → 403；销售人员请求这张汇总 → 403；老板打开运营中心看到同样的数字。

以上全部是测试数据，不是真实业务证据。

## 4. 已知局限 / 观察

- 运营岗侧栏里有「管理总览」入口，但点进去会按既有规则跳回运营中心（只有管理层停在管理总览）。这是改动前就有的行为，本次没动；如果希望运营侧栏不出现这个入口，可以单独做。
- 卡片只在运营中心；管理总览（`/`）的岗位卡按设计不显示金额，不动。
- 只覆盖窗饰企业的运营模板；非窗饰企业的系统模板不变。

## 5. 上线

无迁移、无新 env。**岗位绑定存在库里**：代码上线后要对 Sunny 重跑一次岗位模板落地，运营岗才拿到新键。本 PR 新增只动一个企业的脚本（走 Owner Gate）：

```bash
npx tsx scripts/seed-org-authorization.ts --org <Sunny 的企业 code>
```

它只 upsert 岗位与权限绑定，并按既有规则补自动绑定（没有任何岗位的平台 sales / trade 成员绑默认岗位），不删、不改已有绑定；隔离库验证过：删掉运营岗的新键后跑一次即补回，缺参数或企业不存在退出码 2。不建议用 `scripts/seed-security1-authorization.ts`——它对所有未归档企业都跑一遍。另外，下一次有人经企业邀请码加入 Sunny 时也会自动对 Sunny 落地一次。没重跑之前卡片不显示，不会报错。回滚 = 还原代码；库里多出的绑定在旧代码下不被使用。

当前 main 的生产部署仍被 PROC-1 的生产迁移闸门挡住（`docs/QINGYAN_PROC-1_RELEASE_RUNBOOK.md` §3–§4），迁移执行前本 PR 合并后也不会上生产。
