# INSTALL-2k 报告 — 质保邮件附质保证书 PDF

change：`openspec/changes/install-2k-warranty-pdf/`（proposal / specs：`installation/warranty-email` 新增 1 条、修改 3 条 / design D1–D6 / tasks 5/5）
来源：Lucas 2026-10-29——"质保邮件附上 PDF"。
零 schema：证书 HTML 定稿在既有 `PendingAction.payload`；PDF 不落库，批准后发送前生成。批准前零出站；发件身份不变。

## 1. 做了什么

| 场景 | 之前 | 现在 |
|---|---|---|
| 质保邮件 | 只有正文，客户存档 / 报修要翻邮件 | 附一份英文质保证书 PDF（`Warranty-W-<单号>.pdf`，A4），正文加一句 "Your warranty certificate is attached as a PDF." |
| 证书内容 | — | 与邮件同一份数据：质保编号、单号、客户、地址、安装日、各单元（位置 / 产品）、各品类各部件年限与到期日、报修电话 / 邮箱 / 地址、条款链接；不含金额、内部备注、照片、员工信息、抄送地址 |
| 生成审批 | 定稿邮件正文 | 同时定稿证书 HTML 与附件名（受 `payloadHash` 保护），批准人看到的就是发出的 |
| 会计页预览 | 收件人 / 抄送 / 主题 / 正文 | 加"附件：Warranty-W-….pdf"，「查看证书」展开证书预览，「收起证书」收起 |
| 批准发送 | 发正文 | 执行器在发送事务之前用服务端 Chromium 渲染 PDF，作为附件发出；审计记附件名与字节数 |
| PDF 失败 | — | `PDF_FAILED`，不发送（不降级为无附件邮件）；沿用既有失败通知与重新生成 |
| 旧审批 | — | 上线前生成、内容里没有证书的审批照常发送、不带附件 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/install/warranty-certificate.ts`（新） | `renderWarrantyCertificate`（A4 HTML，确定性、全部转义，字体栈含 "Noto Sans SC"）、`warrantyAttachmentName`（只保留 `[A-Za-z0-9._-]`） |
| `src/lib/install/warranty.ts` | 抽出 `warrantyDocData`（邮件与证书共用）；正文 / HTML 加附件说明 |
| `src/lib/install/warranty-service.ts` | 审批内容带 `certificateHtml` / `attachmentName`；预览带 `attachment: { name, html }`；审批预览文字带附件名 |
| `src/lib/pending-actions/types.ts` | `InstallSendWarrantyEmailPayload` 加两个可选字段 |
| `src/lib/pending-actions/exec-install-warranty-email.ts` | 发送前渲染 PDF（`renderHtmlToPdf`；测试注入 `__setWarrantyPdfRendererForTest`）、校验 `%PDF-` 头、`PDF_FAILED`、附件透传、审计 `attachment` |
| `src/lib/trade/email.ts`、`email-sender.ts` | `attachments` 透传给 Resend；`sendAsOrg` 原样透传（含平台地址代发重试）；不传时行为不变 |
| `src/components/accounting/warranty-panel.tsx` | 预览附件行与证书展开 / 收起（`iframe sandbox`） |
| 测试 | `warranty.test.ts`（83）、`warranty-db.isolated.test.ts`（52）、`email-sender.test.ts`（10）补断言；不新增测试文件 |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/warranty.test.ts` | 83 passed（证书内容与邮件一致、确定性、转义、不出金额 / 备注 / 员工 / 抄送、附件名清洗、正文写明附件） |
| `npx tsx src/lib/trade/__tests__/email-sender.test.ts` | 10 passed（附件透传、代发重试仍带附件、不传附件不带字段） |
| 隔离库 `warranty-db.isolated.test.ts` | 52 passed：[3] 预览带附件名与证书；[5] 发送带 PDF 附件（`%PDF-` 头、文件名）、审计记附件；[10] PDF 生成失败 → `PDF_FAILED`、发送 0、批准人收到失败通知、列表可重新生成；[11] 没有证书的旧审批 → 照常发、不带附件 |
| 真实渲染（本地 Chromium，`CHROME_EXECUTABLE_PATH`） | 含中文产品名（斑马帘 ZB-01、Vinyl 百叶）的证书 → 合法 PDF，1 页，113 KB，冷启动约 6 秒；`pdftoppm` 转图人工核对：中文、连字符、全部年限行、报修电话正确（样张 `docs/install-2k-screenshots/warranty-certificate-sample.pdf`、`-1.png`）。`unpdf` 文本提取丢连字符、把"马"提成部首"⻢"，是提取工具的字形映射问题，图像渲染无误 |
| 浏览器走查（本地 `next dev` + Playwright） | 9/9（见 §3.1） |
| `npm run typecheck` | 0 error |
| 改动文件 eslint | 0 error |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS |
| `bash scripts/check-test-registry.sh` | OK（496 注册） |
| `openspec validate install-2k-warranty-pdf --strict` | valid |

### 3.1 浏览器走查

| 检查 | 结果 |
|---|---|
| 会计确认尾款后预览：附件名 `Warranty-W-<单号>.pdf` + 「查看证书」 | ✓（`01-preview-attachment.png`） |
| 邮件正文写明附件；证书默认收起 | ✓ |
| 「查看证书」：标题、质保编号、各单元；年限（Frame & Panels 25 yr）与报修电话 / 邮箱 | ✓（`02-certificate-preview.png`） |
| 证书不含金额、抄送地址、员工名；「收起证书」 | ✓ |
| 批准（已配置组织发件身份、本地无 `RESEND_API_KEY`）→ 证书 PDF 由真实 Chromium 渲染通过，停在 `NO_EMAIL_PROVIDER`（不是 `PDF_FAILED`），页面红字 | ✓（`03-approve-no-provider.png`；冷启动一次约 32 秒，之后约 5 秒） |

### 3.2 全量 `npm test`

隔离库、`NODE_OPTIONS=--max-old-space-size=8192`：**506/515**（2j 时 504/513；+2 为 main 上 CAL-3 新登记的两个测试；本 change 不新增测试文件）。9 个失败与 2a–2j 报告记录的同一批环境性失败完全一致、与本 change 无关。套件内类型检查与测试注册校验（496）通过；INSTALL-1 / 2a–2k 全部安装测试 0 失败（`warranty` 83、`warranty-db.isolated` 52、`email-sender` 10、`repair-visit-email` 21、`repair-visit-email-db.isolated` 26）。

## 4. 判断点

1. **证书 HTML 定稿进审批，PDF 在发送时生成**（D1）：payload 只多 10–20 KB；批准人看到的与发出的一致；不把数百 KB 的 PDF 存进审批。
2. **PDF 失败拒发，不降级**（D2）：避免客户与公司都以为有证书；代价是 Chromium 故障期间质保邮件发不出，但原因与通知立即可见，可重新生成。
3. **旧审批兼容**（D5）：上线前已生成、待批准的质保邮件照常发、不带附件；已发送的不补发证书（Out of scope）。
4. **PDF 在发送事务之前生成**：Chromium 冷启动的数秒不占用 advisory lock 与事务时间。

## 5. 上线后 / 已知限制

- 生产环境需服务端 Chromium 可用（报价单 PDF 已在用同一转换层）；不可用时质保邮件停在 `PDF_FAILED`。
- 组织发件人未配置时仍停在 `NO_ORG_SENDER`（老板在 设置 → 邮件 → 组织发件人 配置）。
- 不做：返修时间确认邮件附 PDF、中文证书、PDF 存档 / 下载入口、已发送质保邮件补发证书。
