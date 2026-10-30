/**
 * 系统与 Excel 原件模板的有意偏离登记（与 docs/QINGYAN_SUNNY_PROCESS_ORDER_REPORT.md §3 一一对应）。
 *
 * 夹具对照测试遇到这些项时打印编号并跳过该项比对，不静默放过；
 * 新增偏离必须先在这里登记、再在报告里写明原件位置 / 原件结果 / 系统结果 / 理由。
 */

export interface Deviation {
  id: string;
  workbook: "blinds" | "domestic" | "drapes" | "vinyl";
  titleZh: string;
  excelZh: string;
  systemZh: string;
  /** 是否需要 Lucas 拍板（true = 系统先按更安全的一侧做，待确认） */
  needsDecision: boolean;
  /** 已拍板的记录（日期 + 原话），needsDecision=false 且来自拍板时填写 */
  decidedZh?: string;
}

export const DEVIATIONS: readonly Deviation[] = [
  {
    id: "X-1",
    workbook: "blinds",
    titleZh: "拉绳长度只算普通操控",
    excelZh: "《开料表（布料）》J/K 列对所有操控方式都按 高×2×3/4×0.0254 计拉绳与绳套",
    systemZh: "仅普通操控计拉绳与绳套；无绳 / 电动为空（与工艺组装 K 列拉绳分档只对普通生效一致）",
    needsDecision: false,
    decidedZh: "2026-10-27 Lucas：不用算拉绳米数",
  },
  {
    id: "X-2",
    workbook: "blinds",
    titleZh: "卷帘 / 香格里拉下杆数量拼写错误",
    excelZh: "工艺组装 E8 / H8 把亮白插片圆盒写成“亮白亮白插片圆盒”、灰弧/白弧写成 GREY ARC / White ARC，这三种罩盒的卷帘与香格里拉下杆数量算成 0",
    systemZh: "按斑马帘行（F8）的正确写法：单件 1、双轨 2",
    needsDecision: false,
  },
  {
    id: "X-3",
    workbook: "blinds",
    titleZh: "排序权重不复刻",
    excelZh: "工艺组装 M 列按“方型罩盒/弧形罩盒”等不存在的名称匹配，落到未定义名称 E，结果 #NAME?",
    systemZh: "沿用既有排序权重（操控 电动10/普通20/无绳30 + 罩盒 5–10）",
    needsDecision: false,
  },
  {
    id: "X-4",
    workbook: "vinyl",
    titleZh: "下料总表补上 T柱 / 挂柱",
    excelZh: "下料总表 N 列取工艺单 E14（LEFT 得到的文本“1”“2”），SUMIFS 忽略文本，T柱与挂柱合并数量恒为 0，从不出现在下料总表",
    systemZh: "T柱 / 挂柱按数值数量进入下料总表（料型顺序 2 / 3）；对照测试以“不含柱”模式与原件逐行比对，另断言含柱模式只多出柱行",
    needsDecision: false,
  },
  {
    id: "X-5",
    workbook: "vinyl",
    titleZh: "2.5\" 百叶开启代码 LLR / LTLR",
    excelZh: "第 1 窗位 G3 的 2.5\" 分支把 4/2 写作 LRTR/LLR/LIR，其余 29 个窗位写作 LRTR/LTLR/LIR",
    systemZh: "2.5\" 分支取两者并集（LRTR/LLR/LIR/LTLR → 4/2）；对照只用第 2–30 窗位的写法校验 LTLR、用第 1 窗位校验 LLR",
    needsDecision: false,
  },
  {
    id: "X-6",
    workbook: "drapes",
    titleZh: "成品帘子高统一减 2cm",
    excelZh: "工艺单 I 列 = F 列（成品高原样带过来）；真实订单 G1025 由人工把 268 改成 266，G1024 未改",
    systemZh: "成品帘子高 = 成品高 − 2cm，韩褶与蛇形一样；布料平方随之按减后的高计算。对照夹具在原件 I 列写入同一公式后重算（夹具 source.patches 有记录）",
    needsDecision: false,
    decidedZh: "2026-10-27 Lucas：测量尺寸是268，所有帘子我们默认减2cm，韩褶和蛇形是一样的",
  },
];

export function deviation(id: string): Deviation {
  const d = DEVIATIONS.find((x) => x.id === id);
  if (!d) throw new Error(`未登记的偏离编号 ${id}`);
  return d;
}
