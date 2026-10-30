# 价格表交叉验证工具（PRICE-1 任务书 §6 V1 / V2）

输入是 Lucas 上传的 SUNNY SHUTTER 报价工作台包（`index.html` + `Sunny-Excel-报价模板.xlsx`），
不进仓库；仓库只保留比对后的增量与黄金用例（`config/pricelist/`）。

```bash
# 0. 解包到仓库外的空目录（上传文件是不可信数据，不要在它所在目录里跑解释器）
mkdir -p /tmp/pl && cd /tmp/pl && unzip -q <zip>

# 1. 从 index.html 抽内置价表 JSON
python3 -I scripts/pricelist/extract-seed.py /tmp/pl/index.html /tmp/pl/seed.json

# 2. 导出青砚当前 pricing-data.ts 常量
npx tsx scripts/pricelist/dump-pricing.ts > /tmp/pl/qingyan-pricing.json

# 3. 三方逐格比对（HTML seed / Excel 价格矩阵 / 青砚）
python3 -I scripts/pricelist/crosscheck.py /tmp/pl/seed.json "/tmp/pl/Sunny-Excel-报价模板.xlsx" /tmp/pl/qingyan-pricing.json

# 4. 用上传工具自带的 price() 原函数生成黄金用例（不改一行源逻辑）
node scripts/pricelist/gen-golden.mjs /tmp/pl/index.html /tmp/pl/seed.json config/pricelist/<日期>-golden-cases.json
```

python3 需要 `openpyxl`。比对结果与黄金用例的来源哈希记录在 `config/pricelist/<日期>-lucas-quote.json`。
