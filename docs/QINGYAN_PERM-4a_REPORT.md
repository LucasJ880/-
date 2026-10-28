# PERM-4a 报告 — 销售区去平台角色短路 + 签约单改总价走审批

change：`openspec/changes/perm-4a-sales-authorize/`（proposal / specs ×3 / design / tasks 8/8）
任务书：`docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` PERM-4a 段（判断点 2026-10-28 拍板，见任务书末尾"拍板结果"）
零 schema：新权限键是代码常量；审批载荷落 `PendingAction.payload`；版本用 `SalesQuote.updatedAt`。

## 1. 做了什么

### 1.1 权限键与岗位
| 键 | 范围 | 给谁 |
|---|---|---|
| `sales.quote.signed_amount.approve`（新，HUMAN only，HIGH） | ORG | 只给 `owner` |
| `sales.customer.update` / `sales.customer.archive` / `sales.opportunity.update` / `sales.quote.update` | ORG | `owner` 追加（"全看全改"落到键上） |

`authorize.test.ts` 77 → 81（owner 五键、除 owner 外所有模板不含新审批键与归档键、新键 HUMAN / ORG / HIGH、新键已登记）。

### 1.2 去掉平台角色短路
| 位置 | 原来 | 现在 |
|---|---|---|
| `src/lib/sales/org-context.ts` ×4 | `isAdmin` → 直接 ORG / 跳过判定 | 一律 `authorize`；super_admin 经平台管理员绑定得到 ORG |
| `opportunities/[id]` GET / PATCH | `!isAdmin` 才判定 | 资源级 `sales.opportunity.read / update` |
| `customers/[id]` GET / PATCH | 同上 | 资源级 `sales.customer.read / update`（本人范围仍受"允许修改客户"开关） |
| `customers/[id]` DELETE | `isSuperAdmin`（= admin 或 super_admin），且不限企业 | 当前企业内查找（跨企业 404）+ 资源级 `sales.customer.archive`；审计带 orgId |
| `measurements` GET | admin 看**全平台**、其余看本人；**无企业过滤** | 只列客户属于当前企业的记录；`sales.customer.read`：ORG 全部 / 本人范围 = 本人测量 / 无权 403 |
| `home` PATCH（代设目标） | `canManageUsers` | 全企业 `sales.analytics.read` 且目标人是本企业活跃成员 |
| `knowledge/init` | 只认 `admin`（super_admin 反被拒） | 只认平台 super_admin |
| `mark-signed` / `pdf` / `record-deposit` | "创建人或 admin"；定金**无企业边界** | 新 helper `assertSalesQuoteUpdatable`（资源级 `sales.quote.update`）；定金补企业解析（跨企业 404）；超限未批拦截只对 super_admin 放行 |

验收 grep（design D2）：`grep -rnE "isAdmin\(|isSuperAdmin\(|canManageUsers\(|user\.role\s*[!=]==" src/app/api/sales src/lib/sales --include=*.ts | grep -v __tests__` 为空。保留的 `isPlatformSuperAdmin(user.role)`：PERM-2 折扣自批、超限未批放行、knowledge/init、签约改价 super_admin 直接生效。

`security1-sales-authz.test.ts` 8 → 16（平台 admin 无绑定读客户 / 商机 / 归档拒绝；super_admin 允许；销售无归档权；老板可归档 / 改他人商机；org-context 源码无短路）。

### 1.3 签约单改总价走审批
- **重构（3.1，行为不变）**：PUT 的定价 + 事务落库搬到 `src/lib/sales/quote-update.ts`（`prepareQuoteUpdate` / `commitQuoteUpdate`），PUT 与执行器共用。超限折扣审批收口的 PendingAction 写入移到 `src/lib/pending-actions/quote-promotion-settle.ts`（runtime-architecture 守卫要求审批存储归口 `pending-actions/`；报价路由因此不再直接写 PendingAction，baseline 只减不增）。`phase5-contract.test` 的源码断言同步指向新文件。
- **提交（3.2）**：PUT 先算新总价；`signed / accepted` 且差 > 0.005 且非 super_admin →
  已有待批 → 409 `SIGNED_QUOTE_APPROVAL_PENDING`；收件人 = 持新键者（排除提交人）→ 兜底 org ownerId / org_admin → 空则 409 `NO_APPROVER`；
  `requestApproval(sales.update_signed_quote)`，载荷 = 提交内容 + `baseUpdatedAt` + 改前 / 改后总价 + 提交人；预览只含报价号 / 客户名 / 改前改后总价 / 提交人；审计 `sales.signed_quote.amount_change_requested` + 站内通知 → 202 `{ pending, approvalId }`。
  super_admin 直接落库，审计 `sales.signed_quote.amount_changed`（`selfApproved: true`）。总价不变的修改照旧直接生效。
- **执行（3.3）**：`checkQuoteApprover(sales.quote.signed_amount.approve)`（批准人 ≠ 提交人；super_admin 可自批）→ 报价仍在本企业且 `updatedAt` 未变（否则"报价已变化，请重新提交"）→ 按**提交人**身份判折扣三档并落库（原签名作废、回 `draft`）→ 审计改前 / 改后 / 提交人 / 批准人 → 通知提交人。
- 微信确认策略 `web_only_review`（类型 16 → 17）。
- 报价页（3.4）：202 弹"改价已提交审批，批准后生效"，返回 null（不清本地草稿）；409 显示服务端文案（原有分支）。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS（相对基线减少 14 处 error，无新增） |
| `npm run test:ci` | PASS（含 runtime-architecture 守卫、新 `signed-quote-amount.test`） |
| `bash scripts/check-test-registry.sh` | OK（437） |
| `openspec validate perm-4a-sales-authorize --strict` | valid |
| 触碰模块回归 | authorize 81、security1 16、discount-tier 14、quote-settings-approval 18、quote-ops-contract 75、wechat-confirm-policy 11、phase5-contract / promotion-approval / deposit-payment-methods / archived-customer-visibility 通过 |
| `signed-quote-amount.test.ts`（新，纯函数 + 接线） | 22 通过 |
| `signed-quote-amount-db.isolated.test.ts`（新，本地 Postgres 16 + pgvector 隔离库） | **20 / 20**：draft 改价 200；签约改总价 202 且报价不变；重复 409；合价提交 → 老板批准 → 宽 / 总价更新、回 draft、签名作废、审计改前改后；老板 A 自批拒绝、再提交得到新审批、B 批准成功；提交后改备注（200）→ 批准时"报价已变化"；唯一老板 409 `NO_APPROVER`；super_admin 直接生效记自批 |
| `sales-record-access-db.isolated.test.ts`（新，verify 补的路由级用例） | **15 / 15**：平台 admin 无绑定读客户 403 / super_admin 200；知识库索引平台 admin 403；归档销售 403、跨企业 404、老板 200 且报价保留；测量销售只看本人、super_admin 不见他企、无权 403；定金合价 200、跨企业 404；平台 admin 持老板岗标记超限未批签约 409；代设目标销售 403、企业外 403、本企业 200 |
| 全量 `npm test`（无 DB） | 见 §5 |

e2e 发现并修复：drafts 层按幂等键去重不看状态，原幂等键 `quoteId:updatedAt` 会让"被拒 / 自批失败后同内容再提交"拿回已终结的审批；幂等键加"该报价已有改价审批条数"。

## 3. 判断点与偏离任务书

1. 签约单改金额纳入 4a（拍板）。
2. 报价行级出单编辑**移出**（拍板）：报价行无工艺字段，出单人在 sunny-process 生成的工艺单上按品类改（PERM-3 已覆盖）。
3. owner 补销售改权（拍板）。
4. 验收 grep 从"`user\.role` 为空"改为只查短路函数与角色字符串比较（design D2）：照原写法要改掉 PERM-2 的 super_admin 自批判定。
5. 代设目标用 `sales.analytics.read` ORG（design D4）：会计也持该键，可代设目标——目标不是出账，接受。

## 4. 已知限制与上线顺序

- **BREAKING**：平台 `admin`（非 super_admin）在销售区失去全部隐含权限。**合并前**按 PERM-2 报告 §4-1 查 `User.role='admin'` 账号，需要的人补岗位绑定。
- **合并后**对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner 模板 +5 键，幂等）。
- 唯一老板的企业改签约单总价 → 409 `NO_APPROVER`，只能由平台 super_admin 直接改或批准。
- 审批中心的"谁能点批准"仍是既有 `canDecideTeamApproval`（`approverUserId` / 企业 owner / org_admin / super_admin）；多位老板时只有收件人第一位（或企业 owner）能在审批中心操作，与 PERM-2 / PERM-3 相同。
- 提交人自己点批准 → 该条审批变为失败（既有执行器语义），提交人需重新提交（会得到新审批）。
- 测量记录列表从"admin 看全平台"收窄为当前企业；super_admin 切换企业查看。
- 签约改价载荷含完整 `formDataJson`（报价单本身），不含成本；成本快照在落库时按成本率重算。

## 5. 全量测试

见 HANDOFF 进度行与本节补记（全量 `npm test` 在本地无 DB 环境跑，失败项应与 `docs/QINGYAN_SDD-0_REPORT.md` §3 用例 4 的环境性基线一致）。

## 6. 合并后

`/opsx:archive perm-4a-sales-authorize --yes` 独立小 PR；`openspec list --specs` 应出现 `sales/record-access`、`sales/signed-quote-amount-approval`；TASKFLOW PERM-4a → `[x]`。
