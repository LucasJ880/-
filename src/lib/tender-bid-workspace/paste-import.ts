/**
 * TI-4b 粘贴导入（纯函数）
 *
 * 价格表：制表符或逗号分隔，列序固定——行号、说明、数量、单位、包装数、尺寸、最小尺寸、认证要求。
 * 首行是表头时跳过；带引号的字段里的逗号不拆列。解析不改写单位与数量：
 * 单位原样保留（是否在目录内由服务端的结构校验报告），数量只接受数字。
 * 文件领取方名单：一行一个公司名。
 */

export type ParsedScheduleLine = {
  lineNo: number;
  description: string;
  quantity: string;
  uom: string;
  packCount?: number | null;
  dimensions?: string | null;
  minimumDimensions?: string | null;
  certificationGate?: string | null;
};

export type PasteIssue = { row: number; messageZh: string };
export type ParsedSchedule = { lines: ParsedScheduleLine[]; issues: PasteIssue[]; skippedHeader: boolean };

/** 拆一行：有制表符按制表符；否则按逗号，双引号内的逗号不拆。 */
export function splitRow(row: string): string[] {
  if (row.includes("\t")) return row.split("\t").map((c) => c.trim().replace(/^"([\s\S]*)"$/, "$1").replace(/""/g, '"'));
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const NUMERIC = /^\d+(\.\d+)?$/;
const clean = (s: string | undefined) => (s ?? "").trim();
const orNull = (s: string | undefined) => clean(s) || null;

export function parseSchedulePaste(text: string): ParsedSchedule {
  const rows = text.split(/\r?\n/).map((r) => r.replace(/\s+$/, "")).filter((r) => r.trim().length > 0);
  const lines: ParsedScheduleLine[] = [];
  const issues: PasteIssue[] = [];
  let skippedHeader = false;
  rows.forEach((row, i) => {
    const cells = splitRow(row);
    const lineNoRaw = clean(cells[0]);
    // 首行第一列不是数字 → 表头
    if (i === 0 && !/^\d+$/.test(lineNoRaw)) { skippedHeader = true; return; }
    const rowNo = i + 1;
    if (!/^\d+$/.test(lineNoRaw)) { issues.push({ row: rowNo, messageZh: `第 ${rowNo} 行：行号「${lineNoRaw}」不是整数` }); return; }
    const description = clean(cells[1]);
    if (!description) { issues.push({ row: rowNo, messageZh: `第 ${rowNo} 行：缺少说明` }); return; }
    const quantity = clean(cells[2]).replace(/,/g, "");
    if (!NUMERIC.test(quantity)) { issues.push({ row: rowNo, messageZh: `第 ${rowNo} 行：数量「${clean(cells[2])}」不是数字` }); return; }
    const uom = clean(cells[3]);
    if (!uom) { issues.push({ row: rowNo, messageZh: `第 ${rowNo} 行：缺少单位` }); return; }
    const packRaw = clean(cells[4]);
    if (packRaw && !/^\d+$/.test(packRaw)) { issues.push({ row: rowNo, messageZh: `第 ${rowNo} 行：包装数「${packRaw}」不是整数` }); return; }
    lines.push({
      lineNo: Number(lineNoRaw), description, quantity, uom,
      packCount: packRaw ? Number(packRaw) : null,
      dimensions: orNull(cells[5]), minimumDimensions: orNull(cells[6]), certificationGate: orNull(cells[7]),
    });
  });
  return { lines, issues, skippedHeader };
}

/** 一行一个公司名；空行忽略，行内多余空白折叠。 */
export function parseHolderNames(text: string): Array<{ name: string }> {
  return text.split(/\r?\n/).map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean).map((name) => ({ name }));
}

/** 带时区的当前时间（本地偏移），形如 2026-11-06T10:00:00-05:00。 */
export function nowWithOffset(now: Date = new Date()): string {
  const pad = (n: number) => String(Math.abs(Math.trunc(n))).padStart(2, "0");
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}
