# Tasks

## 1. 质保部件与种子

- [ ] 1.1 `warranty.ts`：部件加 `cordless` / `motor_accessories` / `batteries`（D1 顺序），中英文标签（电机 / 配件 / 电池注明 "(if supplied)"，无绳机构注明 "(cordless models)"）；种子帘类 1 / 5 / 15 / 3 / 5 / 5 / 1、窗帘 1 / 5 / 15 / 5 / 5 / 1（D2）；`warranty.test.ts` 覆盖 spec「质保设置」（旧设置原样）「质保设置读写」（新部件、未知部件）「质保设置种子」「邮件内容」（帘类单）。verify：`npx tsx src/lib/install/__tests__/warranty.test.ts` 0 失败。

## 2. 报价单与 Order Form

- [ ] 2.1 `quote-pdf.ts` 帘类、窗帘段质保文字；`order-shades.tsx`、`order-drapes.tsx` 改为与对应 PDF 段同句（D3）；`warranty.test.ts` 由种子拼出期望句子逐字比对 PDF 三段与两张 Order Form、旧句不再出现（spec「报价单质保文字」）。verify：同上 0 失败；`npx eslint "src/app/(main)/sales/quote-sheet"` 0 error。

## 3. 端到端与页面

- [ ] 3.1 `warranty-db.isolated.test.ts` 补：接口读出新种子；老板保存帘类无绳 3 / 电池 1 读回；未知部件 400。本地 Playwright：老板质保设置 8 列与新种子；会计确认帘类单尾款后预览含新部件与注明文字；截图存 `docs/install-2h-screenshots/`。verify：本地隔离库 0 失败；走查全部检查通过。

## 4. 收尾

- [ ] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2h-warranty-shades-update --strict` 通过；全量 `npm test`（隔离库）与 2g 基线比对；写 `docs/QINGYAN_INSTALL-2h_REPORT.md` + `docs/QINGYAN_PERMISSION_TASKFLOW.md` 增 INSTALL-2h 行并改 `[G]` + 更新 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` 与 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2h .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后在最新 main 上 `openspec archive install-2h-warranty-shades-update --yes`（独立小 PR），TASKFLOW INSTALL-2h 改 `[x]`；archive 后对 `installation/` 全部 spec 跑 `--strict`。
- 上线后：老板打开「质保设置」，若已保存过，帘类补无绳升降机构 3 / 电机 5 / 电机配件 5 / 电池 1，窗帘补电机 5 / 电机配件 5 / 电池 1。
