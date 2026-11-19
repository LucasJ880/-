# CHAIN-4a 报告 — 询价邮件带一份重排的 PDF 附件（`rfq-supplier-attachment`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-4a（Phase F（续）— 情报串联） |
| 任务书 | `docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md`（2026-11-19 13:05 修订版） |
| OpenSpec change | `openspec/changes/rfq-supplier-attachment/`（新能力 `tender/rfq-supplier-attachment`） |
| 基线 | main `8f095758`（CHAIN-4b、CHAIN-0c 已合并并归档之后） |
| 拍板 | 判断点 5 取 A（只放重排的询价单 PDF）；design 各项按推荐（Lucas 2026-11-19「判断点 5 按 A……你全权负责」） |
| 开关 | `TENDER_RFQ_ATTACHMENT_ENABLED`（默认关）+ `TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST`（留空 = 全部组织）。只管新起草的卡 |

## 1. 做了什么

| 场景 | 以前 | 现在（开关打开） |
|---|---|---|
| 起草一轮询价（网页 / Muse / 自动起草） | 每家一封纯文本邮件 | 另生成一份「询价单 / 符合性确认表」PDF（`询价单-RFQ-…pdf`），同一轮各家同一份；正文多一句说明附件 |
| PDF 生成不了 / 中文字体缺失 / 超过 5 MB | — | 整轮不起草（不建轮次、不建卡），说明写原因；超过 5 MB 给出路「去「需求」检查」；不降级为不带附件 |
| 审批卡 | 邮件列表 | 上方一行「每封都附带同一份 PDF：文件名（页数，大小）」+「预览 PDF」；摘要（审批中心 / 通知）多一行附件 |
| 起草后要求 / 关键事实 / 截标日期变了 | 照发旧正文 | 卡上提前说明 PDF 对不上，只给「驳回」；执行器也一封不发（`RFQ_ATTACHMENT_CHANGED`） |
| 执行 | 逐家发纯文本 | 先按执行时的资料重排、比对内容指纹，一致才生成 PDF，每封带同一份发出；写审计 `tender.rfq_attachment_sent`（PDF 字节 SHA-256） |
| 催单 / 追问 | 不带附件 | 不变 |

开关关闭时：载荷、载荷哈希、卡摘要、邮件正文与本功能之前逐字节相同（测试证明）。

**与任务书的出入（design D1）**：任务书写「附件字节的 SHA-256 进载荷，执行前重新生成比对」。实测同一份 HTML 相隔 1.5 秒转两次 PDF，长度相同但有 4 个字节不同（`/CreationDate`、`/ModDate` 是生成时刻）——按字节比对会让每张卡都被拒发。所以载荷里存的是**附件渲染内容（HTML）的 SHA-256**；HTML → PDF 是固定代码与字体，内容相同则 PDF 可见内容相同；实际发出的 PDF 字节的 SHA-256 写进审计，事后能核对发出的是哪一份。

## 2. 附件长什么样（真实 Chromium 抽检）

用联邦标样例（14 条要求、数量 1,200、DDP、目的地从精确地址派生、一条范围说明）在本机 `CHROME_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` 生成：3 页、约 106 KB、约 5 秒；`/BaseFont /AAAAAA+NotoSansSC-Regular` 已嵌入，中文正常；表头每页重复；序号 / 编号 / 类型三列不折行；「是否满足」与「说明（差异 / 偏离）」两栏留空，填写口径「满足 / 部分满足 / 不满足」与问题清单一致；末尾有回复方式、空白签章栏；每页底部「RFQ-SUNNY-2026-7KQ4M · 第 N / 3 页」；附件 HTML 带 CSP（不执行脚本、不发网络请求）。附件里没有 `24062-27-057`、`Treasury Board`、`Sleeping Bags and Mats`、`2026-12-05`、`Constellation`、`K1A`。

staging 仍需按「上线顺序」用测试邮箱收一封、在邮件客户端里打开核对（需要有 Vercel 权限的人）。

## 3. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/google-email.ts` | `SendEmailParams.attachments`；`buildRawEmail` 有附件时 `multipart/mixed`（RFC 2231 / 2047 文件名、76 字符换行、内容哈希分隔线）；无附件走原路径 |
| `src/lib/tender-rfq/attachment.ts`（新） | 附件 HTML、内容指纹、文件名、模板身份段、页数、PDF 检查（魔数 / 中文字体 / 5 MB）、版式版本 |
| `src/lib/tender-rfq/attachment-view.ts`（新） | 载荷附件类型与读取、大小文案、预览链接、说明文字（不依赖 Node，面板可引用） |
| `src/lib/tender-rfq/attachment-service.ts`（新） | 起草时生成与检查；执行 / 预览 / 读卡前重排比对；PDF 生成可注入 |
| `src/lib/tender-rfq/attachment-flags.ts`（新） | 开关 + 组织白名单 |
| `src/lib/tender-rfq/build.ts` | 商务条件抽成共用函数（邮件与附件同一份写法）；正文附件那一句 |
| `src/lib/tender-rfq/service.ts` | 建轮次前生成附件；失败返回 `ATTACHMENT_FAILED`；载荷与哈希带附件 |
| `src/lib/tender-rfq/execute.ts` | 发件账号检查之后核对附件、生成 PDF、随信发出、写审计；重放不再生成 |
| `src/lib/tender-rfq/round-pure.ts`、`types.ts` | 哈希覆盖附件（无附件时不变）；卡摘要附件行；载荷类型 |
| `src/lib/tender-rfq/web-entry-pure.ts`、`web-entry-approval.ts` | `ATTACHMENT_FAILED` 说明；邮件预览带附件与预览链接；读卡时提前核对 |
| `src/lib/tender-rfq/auto-draft-pure.ts`、`auto-draft-service.ts` | 新原因码 `ATTACHMENT_FAILED` |
| `src/app/api/projects/[id]/tender-rfq/rounds/route.ts` | 422 |
| `src/app/api/projects/[id]/tender-rfq/attachment/route.ts`（新） | 只读预览 |
| `src/components/inquiry/rfq-approval-panel.tsx` | 附件行、预览、内容已变时不给批准 |
| `next.config.ts` | 共享 `CJK_PDF_ASSETS`；给起草 / 执行 / 预览会生成询价单 PDF 的 11 条路由带上 Chromium 与中文字体（generate-pdf 改为引用同一常量，内容不变） |
| 测试 | 新 `src/lib/__tests__/google-email-mime.test.ts`（25）、`tender-rfq/__tests__/attachment.test.ts`（65）、隔离库 `attachment-db.isolated.test.ts`（42），均已注册（隔离库也进 CI 子集）；`auto-draft-pure.test.ts` 原因码 11 → 12（本次要改的）+ 附件失败两种文案、`web-entry-pure.test.ts` 加附件失败文案与执行失败说明原样显示 |

## 4. 测试（开工前 → 结束）

| 测试 | 开工前 | 结束 |
|---|---|---|
| `tender-rfq/__tests__/build.test.ts` | 46 | 46（不改期望） |
| `round-pure.test.ts` | 34 | 34（不改期望） |
| `web-entry-pure.test.ts` | 158 | 162（+附件失败两种文案、执行失败说明原样显示） |
| `auto-draft-pure.test.ts` | 66 | 68（原因码计数 11 → 12，+附件失败两种文案） |
| `tracking-notify-wiring.test.ts` | 67 | 67（不改期望） |
| `pdf/__tests__/cjk-pdf.test.ts` | 11 | 11（不改期望） |
| `chase-execute.test.ts` | 30 | 30（不改期望） |
| `google-email-mime.test.ts`（新） | — | 25 |
| `attachment.test.ts`（新） | — | 65 |
| 隔离库 `attachment-db`（新） | — | 42 |
| 隔离库 `supplier-identity-guard-db` | 21 | 21（不改期望） |
| 隔离库 `auto-draft-db` | 75 / 76 | 75 / 76（失败那 1 项是既有失败，main 上同样，见 CHAIN-4b 报告 §5） |

## 5. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（本机，带隔离库，修正后最后一轮） | `696/707 通过, 11 失败`，11 项全是既有失败（见下） |
| `npm run test:ci` | 见下方补记（审查修正后重跑） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增指纹；相对基线少 15 处） |
| `bash scripts/check-test-registry.sh` | 已注册 674 个，历史欠账 66 条 |
| `openspec validate rfq-supplier-attachment --strict` | valid |
| `git diff origin/main -- prisma/ vercel.json` | 空 |

全量 11 项失败与 CHAIN-4b / 0c 报告同一批，没改过的 main 上同样失败：来信观察 DB、Mention Gateway M2-A Identity DB（隔离库里早先并行跑留下的数据）、Sunny 工艺单 DB、Phase3A-3 / 3A-4 Governance / 3A-4 Acceptance / 3A-5、Autopilot A2-P0（与执行顺序有关）、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB（75 / 76）。

修正过程中由本次引起、已修的两项：
- `pdf/__tests__/cjk-pdf.test.ts` CJK-CFG-05（数 `next.config.ts` 里字体包 package.json 出现次数）——共享常量后多出一处；改为 generate-pdf 引用同一常量（内容与顺序不变），不改那条测试的期望。
- `preview/__tests__/preview.test.ts`「所有会写库的 GET 都已登记预览下的行为」——预览接口的限流计数被算作写入；在登记表补一条「只写限流计数，不写业务数据」（登记表就是给新接口登记用的）。

## 5a. 交叉审查

**第一轮（开工前，只给四件套与代码）**——12 条，采纳 10 条：卡上提前提示、版式版本与定版指纹、询价编号与起草日期定格、「不含项目名称」限于我方撰写部分且起草日期不参与比对、**PDF 必须嵌入中文字体**（2026-08-26 生产出过中文全空白）、措辞、预览权限与正文一致、执行器先查发件账号、补场景断言、正文那句去掉页数。未采纳：设 `maxDuration`、PDF 一直失败时自动起草静默。

**第二轮（实现后，Lucas 要求「分多个子 agent 多维度审核」）**——五个独立代理各审一个维度，只给代码与规格：

| 维度 | 结论与修正 |
|---|---|
| 正确性 | **部署打包漏了 Chromium 与中文字体**——`next.config.ts` 只给两条旧路由带了，开关一开生产上一律生成失败（失败关闭，不会发错，但功能用不了）。改为共享 `CJK_PDF_ASSETS`，起草 / 执行 / 预览会走到的 11 条路由都带上（用 Next 自己的 picomatch 逐条验证命中），守卫测试按路由源码反查。另修：生成 PDF 的几秒里轮次锁可能被并发抢走 → 建轮次前再查一次；审计页数取实际发出的那份；已批准的卡不再做读卡核对 |
| 安全与审批完整性 | **没有**能把没批过的内容发给供应商的路径（审批中心对整份载荷算 `payloadHash`，批准与执行前都核对，附件所有字段都在内）。采纳：预览每人每分钟 6 次；附件 HTML 加 CSP；读卡核对出错不再当成一致放行；`rfqDocHash` 附件行加长度前缀 |
| 规格 / 代码 / 测试一致 | 与 `tender/rfq-web-entry` 两条主规格（「对能批准的人必须给批准并发送」、预览字段白名单）冲突 → 加 MODIFIED 增量；补齐场景对应的断言（重放不生成 PDF、模板命中不产出、问题与材料同序、审计字段、执行时附件命中身份、401 / 410 / 429 / 503）；去掉误写的「询价追踪」 |
| 用户体验与文案 | **PDF 对不上时连「驳回」都看不到**，还显示「需要组织管理员批准」→ 只隐藏「批准并发送」；预览出错不再在新标签页甩 JSON，改回中文说明页；超过 5 MB 给出路；统一叫「询价单 PDF」，不说「拒发」，执行失败说明不叠「没有发出去：」；PDF 填写口径统一、写明怎么回复、加空白签章栏与页脚 |
| 回归与调用方 | 开关关闭时**没有回归**（逐一核对了 `buildRawEmail`、`renderRfqEmail`、载荷哈希、预览等的全部调用方，8 个既有测试文件全过）；采纳 `attachment: null` 的处理统一 |

未采纳：PDF 元数据里 Chromium 写的生成器标记（不含招标身份）；执行端熔断开关（PDF 坏了时执行器本来就一封不发，要撤回就驳回）；预览缓存（限流已够）。

修正后：纯函数 `attachment.test.ts` 65、隔离库 `attachment-db` 42、`web-entry-pure` 162、`auto-draft-pure` 68、`tracking-notify-wiring` 67、`cjk-pdf` 11 全过。

**运维说明**：开关只管新起草的卡。关开关不会让已起草的带附件卡失效；要撤回就在审批卡上驳回。PDF 生成坏了时，起草报「询价单 PDF 没能生成」，执行一封不发，不会发出不带附件或中文空白的邮件。

## 6. 已知限制

- 起草多约 5 秒、执行时每张卡再生成一次 PDF；预览每次打开生成一次（每人每分钟 6 次）。
- PDF 元数据里有 Chromium 的生成器标记与生成时刻（不含招标身份）。
- 执行时项目资料（含新的一份分析）变了会让旧卡拒发——比带着旧附件发出安全，卡上会提前说。
- Gmail 非上传接口的原始邮件大小上限未逐项核实；附件限 5 MB，典型询价单约 90 KB。
- staging 真实邮箱收信核对未做（需要 Vercel 权限）。
