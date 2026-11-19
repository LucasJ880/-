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
| PDF 生成不了 / 中文字体缺失 / 超过 5 MB | — | 整轮不起草（不建轮次、不建卡），说明写原因；不降级为不带附件 |
| 审批卡 | 邮件列表 | 上方一行「每封都附带同一份 PDF：文件名（页数，大小）」+「预览」；摘要（审批中心 / 通知）多一行附件 |
| 起草后要求 / 关键事实 / 截标日期变了 | 照发旧正文 | 卡上提前说「批准后会被拒发」，不给批准；执行器也拒发（`RFQ_ATTACHMENT_CHANGED`） |
| 执行 | 逐家发纯文本 | 先按执行时的资料重排、比对内容指纹，一致才生成 PDF，每封带同一份发出；写审计 `tender.rfq_attachment_sent`（PDF 字节 SHA-256） |
| 催单 / 追问 | 不带附件 | 不变 |

开关关闭时：载荷、载荷哈希、卡摘要、邮件正文与本功能之前逐字节相同（测试证明）。

**与任务书的出入（design D1）**：任务书写「附件字节的 SHA-256 进载荷，执行前重新生成比对」。实测同一份 HTML 相隔 1.5 秒转两次 PDF，长度相同但有 4 个字节不同（`/CreationDate`、`/ModDate` 是生成时刻）——按字节比对会让每张卡都被拒发。所以载荷里存的是**附件渲染内容（HTML）的 SHA-256**；HTML → PDF 是固定代码与字体，内容相同则 PDF 可见内容相同；实际发出的 PDF 字节的 SHA-256 写进审计，事后能核对发出的是哪一份。

## 2. 附件长什么样（真实 Chromium 抽检）

用联邦标样例（14 条要求、数量 1,200、DDP、目的地从精确地址派生）在本机 `CHROME_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` 生成：3 页、约 90 KB、约 4.7 秒；`/BaseFont /AAAAAA+NotoSansSC-Regular` 已嵌入，中文正常；表头每页重复；序号 / 编号 / 类型三列不折行；商务条件与问题清单与邮件正文同一份写法。附件里没有 `24062-27-057`、`Treasury Board`、`Sleeping Bags and Mats`、`2026-12-05`、`Constellation`、`K1A`。

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
| 测试 | 新 `src/lib/__tests__/google-email-mime.test.ts`（25）、`tender-rfq/__tests__/attachment.test.ts`（54）、隔离库 `attachment-db.isolated.test.ts`（33），均已注册；`auto-draft-pure.test.ts` 原因码 11 → 12（本次要改的）、`web-entry-pure.test.ts` 加附件失败文案 |

## 4. 测试（开工前 → 结束）

| 测试 | 开工前 | 结束 |
|---|---|---|
| `tender-rfq/__tests__/build.test.ts` | 46 | 46（不改期望） |
| `round-pure.test.ts` | 34 | 34（不改期望） |
| `web-entry-pure.test.ts` | 158 | 160（+附件失败文案） |
| `auto-draft-pure.test.ts` | 66 | 67（原因码计数 11 → 12，+附件失败文案） |
| `chase-execute.test.ts` | 30 | 30（不改期望） |
| `google-email-mime.test.ts`（新） | — | 25 |
| `attachment.test.ts`（新） | — | 54 |
| 隔离库 `attachment-db`（新） | — | 33 |
| 隔离库 `supplier-identity-guard-db` | 21 | 21（不改期望） |
| 隔离库 `auto-draft-db` | 75 / 76 | 75 / 76（失败那 1 项是既有失败，main 上同样，见 CHAIN-4b 报告 §5） |

## 5. 门禁

（全量结果见下方，PR 前填）

## 5a. 交叉审查

两轮独立代理审查：

**第一轮（只给四件套与代码，开工前）**——12 条，采纳 10 条：
1. 卡在起草后变得不能发时，人要批了才知道 → 读卡时提前核对，卡上说「批准后会被拒发」并不给批准。
2. 部署改了模板会让所有待批卡被误报「内容变了」→ 载荷记版式版本，不同就按「系统更新了版式」拒发；定版指纹用例钉住模板。
3. 询价编号与起草日期执行时现读会误判 → 定格进载荷。
4. 「附件不含项目名称」与 CHAIN-4b 主规格（要求原文里与项目名称相同的词允许）冲突；起草日期会撞截标日期 → 限于我方撰写部分；起草日期不参与比对。
5. **字体缺失时 PDF 中文全空白却照样「成功」**（2026-08-26 生产出过）→ 检查 PDF 嵌入了 Noto Sans SC，否则按生成失败。
6. 措辞：「批准后变了」→「起草后变了」；执行失败后卡已作废，说「重新发起一轮询价」而不是「驳回」；超限不说「稍后重试」。
7. 预览叠加审批可见判定会让看得到正文的人点预览得 404 → 与正文同一权限（能读项目）。
8. 执行器先查发件账号再生成 PDF；重放不再生成。
9. 场景引用补源码断言与隔离库用例（自动起草映射、Muse、形状不对的附件字段）。
10. 正文那一句去掉页数（执行时重新生成，页数可能不同）。

未采纳 2 条：设 `maxDuration`（设小了反而压低平台缺省）、预览限流；PDF 一直失败时自动起草静默（会把故障藏起来）。均记在 design Risks。

**第二轮（只给实现 diff 与规格）**——见下方，PR 前填。

## 6. 已知限制

- 起草多约 5 秒、执行时每张卡再生成一次 PDF；预览每次打开生成一次，没有限流。
- 执行时项目资料（含新的一份分析）变了会让旧卡拒发——比带着旧附件发出安全，卡上会提前说。
- Gmail 非上传接口的原始邮件大小上限未逐项核实；附件限 5 MB，典型询价单约 90 KB。
- staging 真实邮箱收信核对未做（需要 Vercel 权限）。
