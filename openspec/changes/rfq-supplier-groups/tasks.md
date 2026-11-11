# Tasks：供应商分组（RFQ-AUTO-5）

## 1. 分组本身（纯函数 + 读写）

- [x] 1.1 `src/lib/tender-rfq/supplier-groups-flags.ts`：`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED` 与组织白名单，写法同 `auto-draft-flags.ts`，默认关
- [x] 1.2 `src/lib/tender-rfq/supplier-groups.ts`（纯函数、零依赖）：上限常量；文档的解析（坏数据当作没有分组）与校验（逐项给出中文原因）；文字规整与关键词比对，返回「一组 / 零组 / 多组」；抽屉预选（分组 + 比对结果 + 可选供应商 → 勾选的 id 与提示文字）；「点一个分组」换勾选；在文档上做四种修改（新增、覆盖供应商、改名字与关键词、删除）
- [x] 1.3 `src/lib/tender-rfq/supplier-groups-service.ts`：读本人最近一条记录；保存（短事务：本人的事务级锁 → 读最近一条 → 版本不符返回冲突 → 追加记录）；校验供应商都属于该组织；功能关闭时读返回空、写拒绝
- [x] 1.4 `PUT /api/projects/[id]/tender-rfq/supplier-groups`：登录 + 项目写权限；请求体严格校验（`baseVersion`、`groups`）；400 / 404（功能关闭）/ 409（版本已变，带回最新分组）；只写登录者本人的

## 2. 接到询价入口与自动起草

- [x] 2.1 `web-entry.ts`：功能开启时响应带 `supplierGroups`（分组、每组就绪家数、比对结果、版本、上限）；可选供应商并入各分组里的供应商；功能关闭时不带该字段
- [x] 2.2 `auto-draft-pure.ts`：新增原因 `SUPPLIER_GROUP_UNDETERMINED`、`SUPPLIER_GROUP_EMPTY`（文案、去处、不标 quiet）；判定里加入分组的情形；结果与卡摘要那一行在用分组时写明组名与关键词
- [x] 2.3 `auto-draft-service.ts`：读操作者的分组并比对项目名称；有分组时供应商只取对上的那一组；审计写明来源、组名、关键词、分组版本
- [x] 2.4 `prepareRfqRound` 只多一个可选入参（用了哪一组、凭哪个关键词），原样写进卡摘要里给内部人看的那一句；确认 `buildRfqDocument`、Muse 相关文件没有改动（`git diff --stat` 核对）

## 3. 界面

- [x] 3.1 `rfq-web-entry-types.ts` 增加分组类型；抽屉的预选改为调用 1.2 的纯函数（没有分组时结果与现在相同）
- [x] 3.2 抽屉里的分组标签行：依据 / 提示文字、点一个分组换勾选（`data-testid`：`rfq-groups-bar`、`rfq-group-chip`、`rfq-group-hint`）
- [x] 3.3 抽屉里的分组管理：存为新分组、用当前勾选覆盖、改名字与关键词、删除（先确认）；没有关键词时的提示；保存失败与版本冲突的提示，不丢当前勾选
- [x] 3.4 招标分析面板与轮次列表：确认两个新原因与带分组的说明文字能正常显示（沿用既有的结果行与说明行，不加新控件）

## 4. 测试

- [x] 4.1 `src/lib/tender-rfq/__tests__/supplier-groups.test.ts`：校验逐条；坏数据解析；规整与比对（一组 / 零组 / 多组 / 全角 / 大小写 / 没有关键词的组）；抽屉预选与换勾选；四种修改；开关
- [x] 4.2 `auto-draft-pure.test.ts` 补：两个新原因、判定顺序、带分组的文案
- [x] 4.3 `src/lib/tender-rfq/__tests__/supplier-groups-db.isolated.test.ts`（本地隔离库，经真实路由处理函数）：保存与读回；版本冲突；同时保存只成一个；别的组织的供应商被拒；只读成员 / 外人 / 未登录被拒；功能关闭；别人的分组不被用到；入口响应（停用的供应商仍在组里、并入可选列表）；自动起草按分组、对不上、对上多组、组里无就绪、没有分组时照旧；审计内容；邮件内容与手动选同样几家逐字相同
- [x] 4.4 既有的 `auto-draft-db.isolated.test.ts`（68）、`web-entry-pure.test.ts`（151）不改断言即通过（功能关闭与没有分组两种情况下行为不变）；`auto-draft-pure.test.ts` 只改了「原因共几个」那一条（8 → 10）并补新用例
- [x] 4.5 新测试在 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` 注册；`bash scripts/check-test-registry.sh` 通过

## 5. 验收与收尾

- [x] 5.1 本地真实应用截图到 `docs/acceptance/rfq-auto-5/`：`drawer-matched.png`、`drawer-undetermined.png`、`drawer-manage.png`、`panel-result-group.png`
- [x] 5.2 开 PR 前请一个不带结论的独立审查（重点：能不能读到 / 用到别人的分组；能不能绕过版本检查覆盖；分组信息会不会进邮件；功能关闭时是否完全无痕），修复其发现并补测试
- [x] 5.3 全部门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、测试注册、架构守卫、`??` 混用检查、`openspec validate rfq-supplier-groups --strict`
- [x] 5.4 `docs/QINGYAN_RFQ-AUTO-5_REPORT.md`；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 加一行 RFQ-AUTO-5；`docs/QINGYAN_TENDER_FLOW_HANDOFF.md` 的 RFQ-AUTO-5 一行在 #430（RFQ-AUTO-4 归档）里，本 PR 不动它以免两个 PR 改同一处，归档本 change 时一并更新
