# 青砚 · 第一期设计规格（DESIGN）

**读者**：设计师、前端实现（DEV）  
**配合**：[ARCH_PHASE1_BREAKDOWN.md](./ARCH_PHASE1_BREAKDOWN.md)、[PM_PHASE1_DELIVERY.md](./PM_PHASE1_DELIVERY.md)

---

## 给 DESIGN / PM 的一句话

**请先出一套一页 Token + 字阶 + 五类基础组件规格，波次 A 才能少返工；侧栏分组标题与是否标 Beta 需和 PM 一页纸定稿。**  
（本文档即该「一页」的正式版；侧栏分组文案见 §8「待 PM 定稿」。）

---

## 1. 品牌与整体 UI/UX 方向

### 1.1 关键词

| 维度 | 方向 |
|------|------|
| **现代** | 清晰层级、充足留白、柔和大圆角、轻拟物阴影；避免「纯灰盒子」后台感。 |
| **智能（AI）** | 主色偏 **青蓝 → 靛紫** 渐变意象；AI 相关入口可有 **微弱光晕/渐变描边**，忌夸张赛博。 |
| **可信（B 端）** | 对比度达标、表单与表格可读性优先；装饰服务于信息，不抢内容。 |
| **中文** | **PingFang SC / 微软雅黑 / 系统黑体** 为主；西文与数字可用 **Inter** 作辅助，标题字重略高。 |

### 1.2 气质参考（非抄襲，仅对齐预期）

- 偏 **Linear / Notion / 飞书** 一类：干净、偏冷色中性底、彩色只用在状态与主行动点。  
- **与旧版差异**：旧版侧栏纯深灰 + 扁平蓝按钮；新版侧栏 **深色渐变底**、导航激活态 **轻微发光**、主区背景 **极浅冷灰渐变**，卡片 **浮起一层**。

### 1.3 动效（一期）

- 时长：**150～200ms**，`ease-out`。  
- 范围：按钮 `hover/active`、侧栏链接 `hover`、卡片 `hover` 阴影略增强。**禁止**长路径位移动画干扰阅读。

---

## 2. Color Tokens（落地为 CSS 变量）

| Token | 色值 | 用途 |
|-------|------|------|
| `--background` | `#eef2f9` | 主区底色（浅冷灰） |
| `--background-subtle` | `linear-gradient(180deg, #e8eef8 0%, #f2f5fb 50%, #eef2f9 100%)` | 可选整页背景（body） |
| `--foreground` | `#0f172a` | 主文字（slate-900） |
| `--muted` | `#64748b` | 次要说明 |
| `--border` | `#e2e8f0` | 默认描边 |
| `--card-bg` | `#ffffff` | 卡片表面 |
| `--card-border` | `rgba(15, 23, 42, 0.06)` | 卡片细边（比纯灰更「浮」） |
| `--accent` | `#2563eb` | 主按钮、关键链接 |
| `--accent-hover` | `#1d4ed8` | 主按钮悬停 |
| `--accent-soft` | `rgba(37, 99, 235, 0.12)` | 选中底、弱强调 |
| `--accent-glow` | `rgba(56, 189, 248, 0.35)` | AI/激活态光晕（shadow 用） |
| `--sidebar-gradient` | `linear-gradient(165deg, #0f172a 0%, #1e1b4b 48%, #172554 100%)` | 侧栏背景 |
| `--sidebar-text` | `#e2e8f0` | 侧栏主字 |
| `--sidebar-muted` | `rgba(226, 232, 240, 0.55)` | 侧栏次要 |
| `--sidebar-hover` | `rgba(255, 255, 255, 0.08)` | 侧栏项悬停 |
| `--sidebar-active` | `rgba(59, 130, 246, 0.35)` | 激活项背景（叠在渐变上） |
| `--success` | `#059669` | 成功 |
| `--success-bg` | `#ecfdf5` | 成功浅底 |
| `--warning` | `#d97706` | 警告 |
| `--warning-bg` | `#fffbeb` | 警告浅底 |
| `--danger` | `#dc2626` | 错误/危险 |
| `--danger-bg` | `#fef2f2` | 错误浅底 |
| `--info` | `#0284c7` | 提示 |
| `--info-bg` | #e0f2fe | 提示浅底 |

**对比度**：`--foreground` 在 `--card-bg` 上、侧栏白字在激活蓝底上，目标满足 **WCAG AA** 正文级（ARCH 抽查）。

### 2.1 修订（二期视觉 · 2026-03）

以代码为准：`src/app/globals.css` 已调整为 **墨灰中性底 + 靛青（indigo）主色 + 低饱和侧栏渐变**；`body` 叠加 **径向光晕网格**，主壳右侧 **轻玻璃分割**（`backdrop-blur`）。认证页见 `src/app/(auth)/layout.tsx` 装饰光斑 + `src/lib/auth-styles.ts` 玻璃卡与渐变主按钮。上表色值若与仓库不一致，以 **globals.css `:root`** 为单一事实来源。

---

## 3. 字阶（Type Scale）

| 级别 | 用途 | 建议 | Tailwind 映射（实现参考） |
|------|------|------|---------------------------|
| **T1** | 页面主标题 | 22～24px，字重 700 | `text-2xl font-bold tracking-tight` |
| **T2** | 区块标题 / 卡片标题 | 15～16px，字重 600 | `text-base font-semibold` |
| **T3** | 正文 | 14px，字重 400，行高 1.55 | `text-sm leading-relaxed` |
| **T4** | 辅助说明 / 表格次列 | 12～13px | `text-xs text-muted` |
| **T5** | 标签 / 角标 | 10～11px，字重 500 | `text-[10px] font-medium uppercase tracking-wide`（英文标签时） |

**中文**：避免小于 12px 的正文；**T5** 仅用于 Badge，中文可用 `normal-case`。

**字体栈**：`"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`（与 `globals.css` 一致）。

---

## 4. 间距、圆角、阴影

| 类型 | Token / 值 | 用途 |
|------|----------------|------|
| 圆角 **SM** | `10px` | 输入框、小按钮 |
| 圆角 **MD** | `12px` | 默认按钮、侧栏项 |
| 圆角 **LG** | `16px` | 卡片、弹窗 |
| 圆角 **XL** | `20px` | 大卡片、助手对话容器 |
| 间距页面 | `24px`（`p-6`） | 主区内边距（与现有一致可渐进） |
| 卡片内边距 | `16～20px` | 统一 `p-4` / `p-5` |
| 阴影 **card** | `0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)` | 默认卡片 |
| 阴影 **float** | 在 card 上略加强 | 下拉、搜索面板 |

---

## 5. 五类基础组件规格

### 5.1 Button（按钮）

| 变体 | 视觉 | 交互 |
|------|------|------|
| **Primary** | 背景 `--accent`，白字，圆角 MD | hover `--accent-hover`；active 略缩 `scale-[0.98]` |
| **Secondary** | 白底，边框 `--border`，字 `--foreground` | hover 背景 `slate-50` |
| **Ghost** | 无框，字 `--muted` | hover 背景 `slate-100` |
| **Danger** | 背景 `--danger` 或描边 + 红字 | 用于删除等 |

最小高度 **40px**（触控友好）；图标按钮 **36×36** 起。

---

### 5.2 Input（输入）

- 高度 **40px**，圆角 SM，边框 `--border`，focus **ring 2px `accent-soft` 或 ring-accent/30**。  
- 错误态：边框 `--danger`，下方 **T4 + danger 色** 错误文案。  
- 占位符：`--muted`。

---

### 5.3 Card（卡片）

- 白底 `--card-bg`，可选 **1px `card-border`**，圆角 LG，阴影 **card**。  
- 可选 **header 区**底部分割线 `border-border`。  
- hover（可点击卡片）：阴影过渡到 **float**。

---

### 5.4 Badge（标签）

- 圆角 **full** 或 `6px`，内边距 `px-2 py-0.5`，**T5** 字号。  
- 变体：`neutral` / `accent` / `success` / `warning` / `danger` 对应上表语义色底。  
- **「AI」类**：可用 **浅渐变描边**（`border border-sky-400/30` + `bg-sky-500/10`）体现智能，但仅限小面积。

---

### 5.5 EmptyState（空状态）

- 垂直居中块：插画位（可选 Lucide 大图标 **40～48px**，`text-muted`）、**T2** 标题一句、**T3** 说明一行、**Primary 按钮** 主行动。  
- 整体最大宽 **320～400px**，避免空页「散」。

---

## 6. 布局与壳（Shell）

- **侧栏**：使用 `--sidebar-gradient`；顶边 **细分隔线** `border-white/10`。  
- **Logo「青砚」**：可选 **渐变字**（青→紫），体现「智能」；**MVP** 角标：半透明 + 细边框 `border-white/10`。  
- **导航激活**：背景 `--sidebar-active` + 可选 `box-shadow` 用 `--accent-glow` 做 **极弱外发光**。  
- **主区**：浅底；内容 **max-width** 与 ARCH 一致（如 `max-w-7xl mx-auto`）。

---

## 7. AI 相关页面（助手 / 收件箱）

- 对话区容器：圆角 **XL**，可选 **极淡渐变底**（`from-slate-50 to-indigo-50/40`）或细渐变边框，与任务列表页区分。  
- 用户气泡 / 助手气泡：圆角不对称（助手偏左、用户偏右），**禁止**高饱和整块背景挡字。  
- 配置引导（无 API Key）：**信息层级** = 图标 → 标题 T1 → 说明 T3 → 代码块卡片 → 次要链结。

---

## 8. 侧栏信息架构（待 PM 定稿）

ARCH 建议分组示例（**标题文案与是否 Beta 以 PM 为准**）：

| 分组 | 建议入口 | 备注 |
|------|-----------|------|
| **工作台** | 工作台、收件箱、任务 | 核心路径 |
| **协作** | 组织、项目 |  |
| **智能** | AI 助手 | 可标「Beta」由 PM 定 |
| **业务** | 工艺单 | 可标「行业」或「Beta」 |
| **系统** | 设置 | 置底保留 |

实现时：**不改 path**，仅加分组标题与可选角标（见 ARCH **E2-01**）。

---

## 9. 与代码的对应

- **Token 实现文件**：`src/app/globals.css`（`:root` + `@theme inline`）。  
- **侧栏渐变 / Logo**：`src/components/sidebar.tsx`（随 DEV 波次 A 迭代）。  
- 本文档修订时请在表尾追加版本记录。

---

## 10. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1 | 2026-03-20 | 初版：Token、字阶、五组件、整体现代/智能方向、IA 待 PM |
