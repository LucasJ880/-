/**
 * Trade 外贸获客 — 展会/名片数据导入解析器
 *
 * 支持 CSV 和 Excel（.xlsx）格式
 * 自动匹配中英文列名
 */

import * as XLSX from "xlsx";

export interface ImportedRow {
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  contactTitle?: string;
  website?: string;
  country?: string;
  notes?: string;
}

const COLUMN_MAP: Record<string, keyof ImportedRow> = {
  // English
  company: "companyName",
  "company name": "companyName",
  "company_name": "companyName",
  name: "companyName",
  contact: "contactName",
  "contact name": "contactName",
  "contact_name": "contactName",
  "contact person": "contactName",
  email: "contactEmail",
  "contact email": "contactEmail",
  "e-mail": "contactEmail",
  title: "contactTitle",
  "job title": "contactTitle",
  position: "contactTitle",
  website: "website",
  url: "website",
  "web": "website",
  country: "country",
  region: "country",
  location: "country",
  notes: "notes",
  remark: "notes",
  remarks: "notes",
  memo: "notes",
  // Chinese
  "公司": "companyName",
  "公司名": "companyName",
  "公司名称": "companyName",
  "客户名称": "companyName",
  "联系人": "contactName",
  "姓名": "contactName",
  "联系人姓名": "contactName",
  "邮箱": "contactEmail",
  "电子邮箱": "contactEmail",
  "邮件": "contactEmail",
  "职位": "contactTitle",
  "职务": "contactTitle",
  "官网": "website",
  "网站": "website",
  "网址": "website",
  "国家": "country",
  "地区": "country",
  "国家/地区": "country",
  "备注": "notes",
  "说明": "notes",
};

function resolveColumn(header: string): keyof ImportedRow | null {
  const normalized = header.trim().toLowerCase();
  return COLUMN_MAP[normalized] ?? null;
}

export function parseExcelBuffer(buffer: ArrayBuffer): ImportedRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  return parseRawRows(jsonData);
}

export function parseCsvText(text: string): ImportedRow[] {
  const workbook = XLSX.read(text, { type: "string" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  return parseRawRows(jsonData);
}

function parseRawRows(
  rows: Record<string, unknown>[],
): ImportedRow[] {
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const mapping: Record<string, keyof ImportedRow> = {};

  for (const h of headers) {
    const field = resolveColumn(h);
    if (field) mapping[h] = field;
  }

  if (!Object.values(mapping).includes("companyName")) {
    return [];
  }

  const results: ImportedRow[] = [];

  for (const row of rows) {
    const item: Partial<ImportedRow> = {};

    for (const [header, field] of Object.entries(mapping)) {
      const val = String(row[header] ?? "").trim();
      if (val) {
        item[field] = val;
      }
    }

    if (item.companyName) {
      results.push(item as ImportedRow);
    }
  }

  return results;
}
