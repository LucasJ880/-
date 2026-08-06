const HEADER_ALIASES: Record<string, string> = {
  date: "date",
  day: "date",
  日期: "date",
  weekstart: "weekStart",
  week: "weekStart",
  周起始日: "weekStart",
  spend: "spend",
  cost: "spend",
  amountspentcad: "spend",
  花费: "spend",
  消耗: "spend",
  impressions: "impressions",
  展示: "impressions",
  曝光: "impressions",
  views: "views",
  播放: "views",
  engagements: "engagements",
  互动: "engagements",
  clicks: "clicks",
  点击: "clicks",
  leads: "leads",
  conversions: "leads",
  results: "leads",
  线索: "leads",
  qualifiedleads: "qualifiedLeads",
  有效线索: "qualifiedLeads",
  appointments: "appointments",
  预约: "appointments",
  quotes: "quotes",
  报价: "quotes",
  wins: "wins",
  成交: "wins",
  revenue: "revenue",
  conversionvalue: "revenue",
  convvalue: "revenue",
  purchasevalue: "revenue",
  成交贡献: "revenue",
  转化价值: "revenue",
  othermarketingcost: "otherMarketingCost",
  其他营销成本: "otherMarketingCost",
  currency: "currency",
  币种: "currency",
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_.()\-/]/g, "");
}

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += character;
  }
  cells.push(current.trim());
  return cells;
}

function numberValue(value: string): number {
  const normalized = value.replace(/[$￥¥,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const number = Number(normalized || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function parseMarketingCsv(csv: string): Record<string, unknown>[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV 至少需要表头和一行数据");
  const headers = parseLine(lines[0]!).map((header) => HEADER_ALIASES[normalizeHeader(header)] || null);
  if (!headers.some((header) => header === "date" || header === "weekStart")) {
    throw new Error("CSV 缺少日期或周起始日列");
  }
  if (!headers.some((header) => header === "spend" || header === "leads" || header === "clicks")) {
    throw new Error("CSV 未识别到花费、线索或点击列");
  }
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const value = cells[index] || "";
      row[header] = ["date", "weekStart", "currency"].includes(header)
        ? value
        : numberValue(value);
    });
    row.granularity = row.date ? "daily" : "weekly";
    return row;
  });
}
