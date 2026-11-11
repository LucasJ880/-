# TI-4c 报告：投标工作区的逐行录入与补遗

| 项 | 值 |
|---|---|
| change | `tender-bid-workspace-line-entry` |
| TASKFLOW | TI-4c（Phase F，Tender Intelligence Phase C 第三项） |
| 来源 | `docs/QINGYAN_TI-4b_REPORT.md` §6 第 2 条；任务书硬要求「厂家证书必须能追溯来源」「缺少强制认证时必须阻止系统标记为可投标」 |
| 授权 | Lucas 2026-11-11：「其他你来主导，需要确定的按推荐做」——四件套未另等审核 |
| 分支 | `claude/tender-bid-workspace-line-entry`（叠在 TI-4b 之上） |
| 性质 | 界面 + 存储契约加两个可选字段 + 保存校验加一条。零 schema、零模型调用、零新接口、零对外动作。开关关闭时无任何变化 |

## 1. 交付清单

| 位置 | 内容 |
|---|---|
| `src/lib/tender-bid-workspace/contract.ts` | 证书加 `evidenceRef`（出处）；行明细加 `basedOnAddendum`；保存请求拒绝「已核验」而无出处的证书；合并时把补遗号压到不超过实际影响该行的最新补遗号 |
| `src/lib/tender-bid-workspace/workspace-view.ts` | 由行明细现算「尺寸对照」「认证判定」两类结论，交给 TI-3b 既有的补遗复核判断 |
| `src/lib/tender-bid-workspace/line-entry.ts` | 新增纯函数：草稿与保存内容互转并校验、合并进整块明细、「影响的行」解析、补遗增删、行号压成区间显示 |
| `src/components/tender/bid-workspace-panel.tsx` | 价格表每行的「录入」展开区（品牌、型号、产品尺寸、证书）；新增补遗卡片；表格加「拟投产品」列与「补遗后待复核」标记 |
| `src/lib/tender-bid-workspace/__tests__/line-entry.test.ts` | 新增，41 项断言，已登记两份脚本 |
| 既有三个测试 | `workspace-contract` 24 → 32；`workspace-view` 22 → 28；隔离库端到端 40 → 49 |
| `docs/acceptance/ti-4c/*.png` | 真实应用截图 3 张 |

## 2. 这次补上的三件事

**一、界面上能把阻断项一条条消掉。** TI-4b 只显示核对结果；现在每行可以录入拟投品牌型号、产品尺寸和证书，保存后立即按接口返回的结果显示「尺寸相符 / 不符 / 无法判断」「认证通过 / 未过」。纯逻辑测试里用渥太华 18 行走了一遍：录入前 17 行尺寸尚未核对 + 3 行认证未过；逐行录入后阻断项只剩「已过截标」和「还没有成本核算」。

**二、「已核验」必须带出处，在写入口强制。** 证书记录原来没有出处字段——一张标成「已核验」的证书不带任何依据就能让强制认证闸通过。现在：

- 证书多一个「出处」（证书文件名、链接或查询记录）。
- 界面保存前先拦；保存接口再拦一道：「已核验」而出处为空 → 400，整次请求什么都不存，也不写审计。
- 界面在录入处写明：「已核验」是人工确认后的录入，系统不核验证书真伪。
- 认证闸的六个条件本身没改；已存内容的读取也不加这一条（免得一条旧记录让整个工作区读不出来——开关默认关，线上没有旧数据）。

**三、补遗真正影响判定。** TI-3b 写了「补遗使旧结论失效」的规则，但 TI-4a 传给它的结论列表一直是空的。现在：

- 保存一行明细时记下「按第几号补遗核对的」。
- 之后保存了号更大、且影响该行的补遗 → 判定对该行已录入的尺寸对照与认证判定各报一条「补遗之后需要复核」，判定为不可投标。
- 重新保存该行即消除。
- 客户端带上来的补遗号会被服务端压到不超过实际最新号，所以不能靠虚报绕过；先虚报、再来新补遗，照样报待复核（有测试）。

## 3. 截图（本地真实应用，本地隔离库，演示数据）

证书编号、品牌型号、出处都是演示用的编造数据，不是真实证书。

| 文件 | 看到了什么 |
|---|---|
| `line-entry.png` | 价格表：第 1 行已录入 `39 x 77.5 x 12` 显示「尺寸相符」，第 18 行录入 `36 x 39` 显示「尺寸不符」；第 13 行的录入区展开——品牌、型号、产品尺寸、一张状态为「已核验」的证书但出处为空，点保存后红字「证书 CSA-70012345 标为『已核验』必须填出处」；录入区写着「第 1 号补遗影响本行：保存即表示已按它核对过这一行」 |
| `certificate.png` | 填上出处并保存后：第 13 行「拟投产品」列显示 HeatX HX-100 / 38 x 23 x 23，「核对」列显示「认证通过 尺寸相符」 |
| `stale-after-addendum.png` | 之后保存影响第 13 行的第 2 号补遗：判定卡多出两条「第 13 行的尺寸对照 / 认证判定基于第 1 号补遗，第 2 号补遗之后需要复核」；第 13 行标「第 2 号补遗后待复核」；补遗卡片列出两份补遗 |

截图脚本的实际输出（节选）：

```
row1:  … 39 x 77.5 x 9-15 39 x 77.5 x 12 尺寸相符
row18: … 36 x 38 36 x 39 尺寸不符
no-evidence error: 证书 CSA-70012345 标为「已核验」必须填出处
row13: … 须整机认证 HeatX HX-100 38 x 23 x 23 认证通过 尺寸相符
stale after addendum 2: 第 13 行的尺寸对照基于第 1 号补遗，第 2 号补遗之后需要复核 / 第 13 行的认证判定基于第 1 号补遗，第 2 号补遗之后需要复核
stale after re-save: 0
请求：GET bid-workspace → 200；PUT bid-workspace → 200 × 6（两份补遗、三行明细、一次复核保存）
```

## 4. 测试输出（实际运行）

```
$ npx tsx src/lib/tender-bid-workspace/__tests__/workspace-contract.test.ts
tender-bid-workspace contract: 32 passed
$ npx tsx src/lib/tender-bid-workspace/__tests__/workspace-view.test.ts
tender-bid-workspace view: 28 passed
$ npx tsx src/lib/tender-bid-workspace/__tests__/panel-helpers.test.ts
✓ panel-helpers: 40 项断言全部通过
$ npx tsx src/lib/tender-bid-workspace/__tests__/line-entry.test.ts
✓ line-entry: 41 项断言全部通过
$ DATABASE_URL=<本地隔离库> NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx …/bid-workspace-db.isolated.test.ts
TI-4a / TI-4c bid workspace DB: 49 passed, 0 failed

$ bash scripts/check-test-registry.sh
OK 测试注册校验通过：已注册 581 个；历史欠账基线剩余 68 条（只减不增）
$ bash scripts/test-runtime-architecture.sh
runtime-architecture repo conformance 结果: 9 通过, 0 失败 / guards PASS
$ npx eslint src/components/tender/bid-workspace-panel.tsx src/lib/tender-bid-workspace
（无输出）
$ openspec validate tender-bid-workspace-line-entry --strict
Change 'tender-bid-workspace-line-entry' is valid
$ npm run typecheck / npm run lint:baseline
exit 0
[eslint-baseline] PASS（无新增 error fingerprint / 无 count 上升）
```

另外重跑了读到 `bid-tab.tsx`、`components/tender`、`tender-bid-readiness` 的 14 个既有测试（TI-3b 的四个：20 / 24 / 25 / 18 项；其余十个），全部通过。

隔离库新增的 9 项：已核验无出处 → 400 且不落库不写审计；带出处后第 13 行认证通过；虚报的补遗号 99 被压成 1、出处已落库；此时无待复核；保存第 2 号补遗后报两条待复核；重新保存后消失且补遗号记为 2；保存第 13 行没有丢掉第 18 行的明细；只读成员录入 → 403。

没有跑 `npm test` 全量（容器 Node 22，项目要求 24）；相关测试与门禁逐项跑过，完整子集交给 CI。

## 5. 设计上的取舍

| 决定 | 理由 |
|---|---|
| 「已核验须有出处」放在保存请求的校验里，不放进认证闸 | 认证闸是纯函数，既有调用与样例都不带出处；加进去会让它们全部变成不通过。放在写入口：从今往后存不进没有出处的「已核验」 |
| 补遗号由界面带上、服务端只向下压 | 「内容没变但已按新补遗复核」是常见情况，需要一个不改内容也能确认的动作——重新保存就是这个动作 |
| 待复核结论现算，不新增存储 | 有产品尺寸的行一条「尺寸对照」，带认证要求且填了品牌型号或证书的行一条「认证判定」 |
| 行录入是表格行下方的展开区 | 每次只展开一行；保存成功即收起并用接口返回的结果刷新 |

## 6. 已知限制与待 Owner 决定

1. **谁可以把证书标成「已核验」**：现在是任何有项目写权限的人。已有的约束是必须填出处 + 每次保存写审计（谁、何时、改了哪一块）+ 界面写明是人工确认。是否收窄到特定角色（例如只有项目负责人或合规岗），**请 Lucas 决定**；推荐先按现状试用，等有第二个录入人时再收窄。
2. **不上传证书文件、不核验真伪**：出处是一段文字。把出处关联到项目里已上传的文件是自然的下一步。
3. **两人同时编辑不同行会后写覆盖先写**：保存接口按块替换行明细。服务端加锁保证不坏数据，但后保存的人用的是自己上次读到的内容。同一个标通常一人录入，暂可接受；要彻底解决需要按行保存的接口。
4. **补遗只按「行 + 号」判断**，不解析正文；影响哪些行由人填。删除补遗不会让已记下的补遗号回退（只会少报，不会多报）。
5. 成本假设类的结论（`COST_ASSUMPTION`）还没有纳入补遗复核——成本输入不落库，没有可盖章的地方；等成本存储方案定了再接。
6. 录入按钮沿用全站 44px 触控高度，18 行的表会比较长。

## 7. 没做的

- 没有合并、没有部署、没有改生产开关、没有任何对外发送。
- 没有 schema 变更、没有新接口、没有新增模型调用。
- 没有改认证闸的六个条件，没有改可投标判定的规则。
