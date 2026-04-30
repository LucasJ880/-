import { db } from '@/lib/db';

export interface CsvCustomerRow {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  source?: string;
  notes?: string;
  // Opportunity fields (optional, creates linked opportunity)
  opportunityTitle?: string;
  stage?: string;
  estimatedValue?: string;
  productTypes?: string;
  priority?: string;
}

export interface ImportResult {
  totalRows: number;
  customersCreated: number;
  opportunitiesCreated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const VALID_STAGES = [
  'new_lead',
  'needs_confirmed',
  'measure_booked',
  'quoted',
  'negotiation',
  'signed',
  'producing',
  'installing',
  'completed',
  'lost',
  'on_hold',
];

const VALID_PRIORITIES = ['hot', 'warm', 'cold'];

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] || '').trim();
    });
    return row;
  });
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

const HEADER_MAP: Record<string, keyof CsvCustomerRow> = {
  '客户名称': 'name',
  '姓名': 'name',
  'name': 'name',
  'customer_name': 'name',
  '电话': 'phone',
  '手机': 'phone',
  'phone': 'phone',
  '邮箱': 'email',
  'email': 'email',
  '地址': 'address',
  'address': 'address',
  '来源': 'source',
  'source': 'source',
  '备注': 'notes',
  'notes': 'notes',
  '机会标题': 'opportunityTitle',
  '项目名称': 'opportunityTitle',
  'opportunity': 'opportunityTitle',
  '阶段': 'stage',
  'stage': 'stage',
  '预估金额': 'estimatedValue',
  'estimated_value': 'estimatedValue',
  '产品类型': 'productTypes',
  'product_types': 'productTypes',
  '优先级': 'priority',
  'priority': 'priority',
};

function mapHeaders(row: Record<string, string>): CsvCustomerRow | null {
  const mapped: Partial<CsvCustomerRow> = {};
  for (const [rawKey, val] of Object.entries(row)) {
    const normalizedKey = rawKey.toLowerCase().trim();
    const field = HEADER_MAP[normalizedKey] || HEADER_MAP[rawKey.trim()];
    if (field && val) {
      mapped[field] = val;
    }
  }
  return mapped.name ? (mapped as CsvCustomerRow) : null;
}

export async function importCustomersCsv(
  csvText: string,
  userId: string,
  orgId: string,
): Promise<ImportResult> {
  const rawRows = parseCsv(csvText);
  const result: ImportResult = {
    totalRows: rawRows.length,
    customersCreated: 0,
    opportunitiesCreated: 0,
    skipped: 0,
    errors: [],
  };

  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2; // 1-based + header row
    const mapped = mapHeaders(rawRows[i]);
    if (!mapped) {
      result.skipped++;
      continue;
    }

    try {
      const existingByPhone = mapped.phone
        ? await db.salesCustomer.findFirst({
            where: {
              phone: mapped.phone,
              createdById: userId,
              OR: [{ orgId }, { orgId: null }],
            },
          })
        : null;

      let customerId: string;

      if (existingByPhone) {
        customerId = existingByPhone.id;
        if (existingByPhone.orgId && existingByPhone.orgId !== orgId) {
          throw new Error("该电话已绑定到其他组织的客户，无法在当前组织导入");
        }
        await db.salesCustomer.update({
          where: { id: customerId },
          data: {
            email: mapped.email || existingByPhone.email,
            address: mapped.address || existingByPhone.address,
            notes: mapped.notes
              ? [existingByPhone.notes, mapped.notes].filter(Boolean).join('\n')
              : existingByPhone.notes,
          },
        });
      } else {
        const customer = await db.salesCustomer.create({
          data: {
            orgId,
            name: mapped.name,
            phone: mapped.phone || null,
            email: mapped.email || null,
            address: mapped.address || null,
            source: mapped.source || 'csv_import',
            notes: mapped.notes || null,
            createdById: userId,
          },
        });
        customerId = customer.id;
        result.customersCreated++;
      }

      if (mapped.opportunityTitle) {
        const stage = mapped.stage && VALID_STAGES.includes(mapped.stage)
          ? mapped.stage
          : 'new_lead';
        const priority = mapped.priority && VALID_PRIORITIES.includes(mapped.priority)
          ? mapped.priority
          : 'warm';

        await db.salesOpportunity.create({
          data: {
            orgId,
            customerId,
            title: mapped.opportunityTitle,
            stage,
            estimatedValue: mapped.estimatedValue
              ? parseFloat(mapped.estimatedValue) || null
              : null,
            productTypes: mapped.productTypes || null,
            priority,
            createdById: userId,
          },
        });
        result.opportunitiesCreated++;
      }
    } catch (err) {
      result.errors.push({
        row: rowNum,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
