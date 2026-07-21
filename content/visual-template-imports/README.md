# 授权套图模版导入

对方无官方导出包时：在授权范围内自行采集预览图与构图说明，按本目录结构整理后执行导入脚本。

## 目录约定

```text
content/visual-template-imports/<suite-id>/
  manifest.json          # 必填
  preview.jpg            # 推荐：列表预览
  style-model.jpg        # 可选：模特风格参考
  style-display.jpg      # 可选：陈列构图参考
```

也可用 `.png`。文件名需与 `manifest.json` 的 `files` 字段一致。

## 采集步骤

1. 登录已授权账号，打开对方模版详情。
2. 下载/另存预览图、风格参考图到该套图目录。
3. 复制 `_example/manifest.json`，按真实模版改 `id/name/shots`。
4. `compositionNotes` 用中文写清构图即可（导入时会自动叠加热感/禁文字规则）。
5. 运行：

```bash
npx tsx scripts/import-visual-template-suite.ts <suite-id>
# 或一次导入全部（跳过 _ 开头目录）
npx tsx scripts/import-visual-template-suite.ts --all
```

6. 导入结果写入：

```text
public/product-content-templates/<suite-id>/
  suite.json
  preview.jpg
  style-model.jpg
  style-display.jpg
```

重启/刷新后，`GET /api/product-content/templates` 与素材库页会自动列出。

## 表格协作

可用 `TEMPLATE.csv` 填构图清单（同 `suite_id` 多行聚合为一套），再生成目录与 manifest：

```bash
npx tsx scripts/import-visual-template-suite.ts --from-csv content/visual-template-imports/TEMPLATE.csv
# 将图片放入对应目录后：
npx tsx scripts/import-visual-template-suite.ts <suite-id>
```

## 注意

- `id`：小写字母数字、下划线、连字符。
- 不要把未授权素材提交进 git；导入的 `public/...` 图片若较大可加入 `.gitignore`（按需）。
- 内置 `amazon_realism_bathrobe_v1` 仍由代码注册，勿用同名 id 覆盖。
