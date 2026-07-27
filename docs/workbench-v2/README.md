# Workbench V2 验收截图

| 文件 | 视口 |
|---|---|
| `1440x900.png` | 桌面：KPI + 队列 + 常驻 Inspector + 时间轴 |
| `1280x800.png` | 接近 xl 断点：Inspector 应为 Drawer |
| `390x844.png` | 手机：Bottom Sheet |

建议 glass 主题下截取首屏，无需整页滚动即可看到核心事项。

## 重新生成

本地 `npm run dev` 就绪后：

```bash
MOBILE_AUDIT_EMAIL=... MOBILE_AUDIT_PASSWORD=... \
  npx tsx scripts/workbench-v2-screenshots.ts
```
