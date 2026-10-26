# C-2 完成报告：无回复跟进草稿接入已确认偏好（openspec change `fde-preferences-in-followup`）

任务来源：B-3 报告偏差 4 / 已知限制第 1 条（"跟进草稿不读偏好"）的补齐，按用户 2026-10-26 第二轮"改进项按推荐顺序做"开出；不是任务书新编号，状态沿用 B-3 行。
分支：`claude/fde-preferences-in-followup`。叠在 B-3 `claude/fde-preferences-in-draft` 之上，PR base = B-3 分支，依次合并后改回 `main`。
OpenSpec change：`openspec/changes/fde-preferences-in-followup/`（proposal / `specs/revenue-spine/fde-followup-draft-preferences/spec.md` / design / tasks，`openspec validate --strict` 通过）。

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/revenue-spine/__tests__/fixtures/followup-golden-cases.ts` + `followup-golden-pre-c2.json`（新） | 跟进草稿金样本 10 例（第 1 / 2 / 3 次 × 中英文 × 有无联系人 / 展会 / 追问 / 署名 / 对外英文名），用**改动前**的代码生成，单独提交 `8a907500` |
| `src/lib/revenue-spine/reply-draft.ts`（改） | 抽出 `applyBannedPhrasesSafely`（保护行 + 专名挡住 + 替换后多出违规就退回并记下键名），首封 `buildReplyDraft` 改为调用它；首封行为不变（单独提交 `8e719430`，B-3 金样本与 45 条测试锁定） |
| `src/lib/revenue-spine/fde/no-reply-followup.ts`（改） | `NoReplyFollowUpInput.preferences`：问候（有联系人名时）/ 敬语（替换 "Best regards," / "祝好！"）/ 结束语（配置时在敬语前加一行）/ 禁用词（共用函数；署名块、偏好行、主题、组织名、对外英文名、联系人名、产品、展会名不替换）。`draftNoReplyFollowUps`：组织级解析一次偏好；追问与草稿（含中文对照）传入；违规偏好每轮最多记一次审计；"本封未替换"按键名记审计 |
| `src/lib/revenue-spine/__tests__/draft-preferences.test.ts`（改） | B-3 的"不碰的模块"断言改为：跟进只经 `resolveDraftPreferences` 读偏好、不直接读 `policy.fde` |
| 测试（新，已注册进两个测试脚本） | `followup-preferences.test.ts` 15 条 |

开关关闭（默认）时跟进草稿与实施前逐字节相同；开启方式与 B-3 相同（`PUT /api/revenue/policy` 写 `fde` 段），首封与跟进同时生效。

## 2. 怎么验的

门禁在独立 worktree 的 `c877dd77`（含审查修正）上跑。

| # | 验证 | 结果 |
|---|---|---|
| 1 | `followup-preferences.test.ts` 单独运行 | 15 / 15；`draft-preferences` 45、`no-reply-followup` 7、`scoring-draft` 21、`tricky-inquiries` 27、`draft-diff` 53、`draft-feedback` 95、`commercial-facts` 23 全过 |
| 2 | "关闭时跟进草稿逐字节不变" | 金样本 10 例在"不传偏好 / 配满偏好但关闭 / 开启但全空"三种情况下主题、正文、追问字段逐字节相同；独立审查用 `fbd7a273` 重新生成 json，与提交的 `cmp` 一致；另做 106,272 组旧 / 新差分，三种情况 0 差异 |
| 3 | "抽函数不改首封" | 审查用 B-3 与本分支做 7,040 组首封差分（偏好开启，含退回与违规），完整草稿对象 JSON 逐字节相同 |
| 4 | 开启时的行为 | 问候 / 敬语 / 结束语 / 中文对照 / 免问 / 禁用词 / 专名与偏好行不替换 / 替换后拼出承诺退回，逐项断言；审查另跑 20,000 例随机偏好，署名块、主题、专名都保留，无新增守卫违规 |
| 5 | 变异检查 | 去掉偏好行保护 → "偏好行不替换"失败；把守卫判定关掉 → 接入点断言失败（修正前这条是 -1 空转）；去掉产品 / 展会专名保护 → 中文专名测试失败 |
| 6 | `npm run typecheck`（全量） | 退出 0 |
| 7 | `npm run lint:baseline` | PASS（无新增 error fingerprint；相对基线减少 14 处） |
| 8 | `npm test` 对比基线 | 432 / 446；14 项失败与基线逐条一致（修正前一轮是 15 项：多出的就是交叉审查阻塞项，已修） |
| 9 | `npm run test:ci` | 退出 0，`CI unit subset PASS`，含本 change 两个测试 |
| 10 | `bash scripts/check-test-registry.sh` | 本 change 测试已注册；仍有 `main` 上既有的 2 个 trade 测试未注册（不是本 change 引入） |
| 11 | `git diff --stat claude/fde-preferences-in-draft -- prisma/ vercel.json` | 空 |
| 12 | `openspec validate fde-preferences-in-followup --strict`；`/opsx:verify` | valid。verify：tasks 5 / 5；4 条 requirement / 11 个 scenario 均有测试断言（"违规偏好在跟进起草时也记审计"为接入点静态断言 + B-3 审计函数自身的行为测试）；design D1–D4 与实现一致；无 CRITICAL / WARNING。未验证：真实 DB 下的定时任务全链路（容器无 DB），留 staging |

## 3. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **不是任务书条目**：任务书 B-3 What 只点名 `reply-draft.ts`；本 change 补齐 B-3 偏差 4。
2. **结束语在跟进里是新增一行**：跟进默认没有结束语行；只有配置了才在敬语前加一行，与敬语之间不空行（首封有空行，规格按"在敬语前加一行"写）。
3. **跟进不经 LLM 润色**：跟进本来只用模板，没有润色回退判定。
4. **审核用中文对照同样用中文偏好**，与首封一致。

## 4. 交叉审查（独立审查代理，只给代码与规格）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 阻塞 | B-3 测试里"不碰的模块"断言要求跟进不读偏好，本 change 必然让它失败，`npm test` 与 `test:ci` 都会红 | 断言改为跟进只经 `resolveDraftPreferences` 读偏好；tasks 2.1 verify 补"45 条全过" |
| 2 | 应修 | 两条 `indexOf(a) < indexOf(b)` 静态断言在字符串不存在时恒真（变异：把守卫判定关掉仍全过） | 先断言下标 > 0 再比较先后 |
| 3 | 应修 | "偏好行不替换"没有测试（删掉保护仍全过） | 按审查给的输入补测试（问候含 thanks、结束语含 working） |
| 4 | 应修 | spec 示例句与跟进模板不符（"your email of" → 实际是 "my email of"） | 改 spec |
| 5 | 应修 | 规格漏了"中文对照用中文偏好" | Requirement 2 补一条并加 Scenario；补行为测试 |
| 6 | 应修 | design D4 缺被否决的备选；proposal Why 超过两句 | 补否决项；Why 合成两句 |
| — | 可选 | 结束语与敬语之间不空行；只缺免问字段时第 1 次跟进退到兜底问句；审计 Scenario 只有静态断言；中文专名保护无测试 | 第 1 项写进偏差 2；第 2 项列为 GATE 注意项（见第 5 节）；第 3 项：审计函数本身由 B-3 测试覆盖，这里不重复；第 4 项补测试 |

审查已核过：金样本是真的（重新生成后 `cmp` 一致）；跟进 / 首封两组差分 0 差异；偏好在循环外解析一次；违规审计每轮最多一次且在所有 skip 之后；关闭时不多查 DB、不多写审计。

## 5. GATE 注意项与 staging 待验

- **【注意】缺的只有免问字段时，第 1 次跟进退到兜底问句**（"请告知数量和交期"）。实施前这种兜底只在"什么都不缺"时出现；开启免问后多了一条触发路径。按"没有可问的字段 = 什么都不缺"处理，行为与原先一致；如需改成不提具体字段的句子，另开 change。
- staging：为测试组织开启偏好（问候 `Hi {name},`、敬语 `Kind regards,`、免问 `targetPrice`、禁用词一条），等一轮无回复跟进，确认：
  - 跟进的问候 / 敬语 / 结束语与首封一致，不问目标价；
  - 英文跟进附的中文对照用中文偏好；
  - 关闭开关后跟进回到默认模板。

## 6. 已知限制

- 与 B-3 相同：数字词与商务条款用语是词表规则；替换可能让句子不通顺，属企业配置，审批人可见。
- 跟进的"本封未替换"审计与首封共用去重：同一组键名同组织只记一次。
