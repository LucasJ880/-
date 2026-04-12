/**
 * 供应商 AI 自动分类引擎
 *
 * 根据供应商已有信息（名称、品类、地区、备注、画册解析等）
 * 自动生成：tags（标签）、capabilities（能力画像）、aiClassification（结构化分类）
 */

import { createCompletion } from "@/lib/ai/client";
import { db } from "@/lib/db";

// ─── 类型 ──────────────────────────────────────────────────────

export interface ClassificationResult {
  tags: string[];
  capabilities: string;
  mainCategory: string;
  subCategories: string[];
  confidence: number; // 0-1
}

// ─── 主分类体系 ────────────────────────────────────────────────

const CATEGORY_SYSTEM = `
## 供应商主分类体系（Sunny Shutter 业务相关）

### 窗饰产品类
- blinds_fabric: 窗帘/百叶面料供应商
- blinds_components: 窗饰配件供应商（轨道、电机、控制器）
- blinds_finished: 成品窗饰供应商

### 纺织原料类
- textile_yarn: 纱线供应商
- textile_fabric: 面料供应商（通用）
- textile_finishing: 后整理/功能处理供应商

### 工业制造类
- hardware: 五金/金属件供应商
- packaging: 包装材料供应商
- logistics: 物流/货运供应商

### 服务类
- testing: 检测/认证服务
- design: 设计/打样服务
- trading: 贸易公司/中间商

### 其他
- other: 无法明确归类
`;

// ─── Prompt 构建 ──────────────────────────────────────────────

function buildClassifyPrompt(supplier: {
  name: string;
  category: string | null;
  region: string | null;
  notes: string | null;
  contactEmail: string | null;
  website: string | null;
  brochureParseResult: unknown;
}): string {
  const brochureInfo =
    supplier.brochureParseResult
      ? JSON.stringify(supplier.brochureParseResult).slice(0, 2000)
      : "无画册数据";

  return `请分析以下供应商信息，进行自动分类和标签提取。

## 供应商信息
- 名称：${supplier.name}
- 品类：${supplier.category || "未知"}
- 地区：${supplier.region || "未知"}
- 备注：${supplier.notes || "无"}
- 邮箱：${supplier.contactEmail || "无"}
- 官网：${supplier.website || "无"}
- 画册解析：${brochureInfo}

${CATEGORY_SYSTEM}

请用 JSON 格式返回分析结果：

\`\`\`json
{
  "tags": ["标签1", "标签2", "..."],
  "capabilities": "一段简洁的能力画像描述（50-150字）",
  "mainCategory": "主分类key（从上面分类体系中选）",
  "subCategories": ["子分类1", "子分类2"],
  "confidence": 0.8
}
\`\`\`

## 标签提取规则：
1. **产品标签**：该供应商涉及的具体产品类型（如：斑马帘面料、卷帘配件、阻燃纱线）
2. **能力标签**：生产能力特征（如：OEM、大批量、定制开发、快速打样）
3. **认证标签**：拥有的认证或检测能力（如：NFPA认证、ISO9001、SGS）
4. **地域标签**：所在区域（如：绍兴、广州、浙江）
5. **贸易标签**：贸易特征（如：工厂直销、贸易商、出口经验）
6. 每个供应商通常 3-8 个标签
7. 标签用中文，但通用英文术语保持原文（如 OEM、NFPA）
8. confidence 根据信息充分度给分：信息多→高，仅有名字→低`;
}

// ─── 解析 LLM 返回 ──────────────────────────────────────────

function parseClassificationResponse(raw: string): ClassificationResult {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map(String).filter((t: string) => t.length > 0)
        : [],
      capabilities: String(parsed.capabilities || ""),
      mainCategory: String(parsed.mainCategory || "other"),
      subCategories: Array.isArray(parsed.subCategories)
        ? parsed.subCategories.map(String)
        : [],
      confidence: typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5,
    };
  } catch {
    return {
      tags: [],
      capabilities: "",
      mainCategory: "other",
      subCategories: [],
      confidence: 0,
    };
  }
}

// ─── 核心：对单个供应商分类 ──────────────────────────────────

export async function classifySupplier(
  supplierId: string
): Promise<ClassificationResult> {
  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    select: {
      name: true,
      category: true,
      region: true,
      notes: true,
      contactEmail: true,
      website: true,
      brochureParseResult: true,
    },
  });

  if (!supplier) throw new Error("供应商不存在");

  const prompt = buildClassifyPrompt(supplier);

  const raw = await createCompletion({
    systemPrompt:
      "你是供应链分析专家，擅长对供应商进行分类、打标签和能力评估。" +
      "请严格按要求的 JSON 格式输出，不要添加额外说明。" +
      "语言：标签和能力画像用中文（通用术语保留英文），分类 key 用英文。",
    userPrompt: prompt,
    mode: "structured",
    temperature: 0.2,
  });

  const result = parseClassificationResponse(raw);

  await db.supplier.update({
    where: { id: supplierId },
    data: {
      tags: result.tags.join(","),
      capabilities: result.capabilities || null,
      aiClassification: {
        mainCategory: result.mainCategory,
        subCategories: result.subCategories,
        confidence: result.confidence,
        classifiedAt: new Date().toISOString(),
      },
    },
  });

  return result;
}

// ─── 批量分类 ────────────────────────────────────────────────

export async function classifySuppliersBatch(
  supplierIds: string[]
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const id of supplierIds) {
    try {
      await classifySupplier(id);
      success++;
    } catch {
      failed++;
    }
  }

  return { success, failed };
}

// ─── 从文本解析供应商信息（名片/展会记录） ──────────────────

export interface ParsedSupplierInfo {
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  category: string | null;
  region: string | null;
  website: string | null;
  notes: string | null;
}

export async function parseSupplierFromText(
  text: string
): Promise<ParsedSupplierInfo[]> {
  const prompt = `请从以下文本中提取供应商信息。文本可能来自展会名片、微信聊天、网页等。

## 文本内容：
${text.slice(0, 3000)}

请用 JSON 格式返回所有识别到的供应商：

\`\`\`json
[
  {
    "name": "公司/供应商名称",
    "contactName": "联系人姓名（如有）",
    "contactEmail": "邮箱（如有）",
    "contactPhone": "电话（如有）",
    "category": "产品品类（如有）",
    "region": "地区（如有）",
    "website": "网址（如有）",
    "notes": "其他备注信息"
  }
]
\`\`\`

## 提取规则：
1. 如果信息不存在，对应字段填 null
2. 电话号码保持原始格式
3. 公司名称尽量完整
4. 如果文本中有多个供应商，全部提取
5. 品类描述用简短中文`;

  const raw = await createCompletion({
    systemPrompt:
      "你是商业信息提取专家，擅长从非结构化文本中提取供应商信息。" +
      "请严格按 JSON 数组格式输出。",
    userPrompt: prompt,
    mode: "structured",
    temperature: 0.1,
  });

  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((p: Record<string, unknown>) => ({
      name: String(p.name || "未知供应商"),
      contactName: p.contactName ? String(p.contactName) : null,
      contactEmail: p.contactEmail ? String(p.contactEmail) : null,
      contactPhone: p.contactPhone ? String(p.contactPhone) : null,
      category: p.category ? String(p.category) : null,
      region: p.region ? String(p.region) : null,
      website: p.website ? String(p.website) : null,
      notes: p.notes ? String(p.notes) : null,
    }));
  } catch {
    return [];
  }
}
