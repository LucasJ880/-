import type { IndustryFieldDefinition } from "@/lib/product-content/types";

export const HOME_TEXTILE_PACK = {
  id: "home_textile",
  name: "家纺行业包",
  fields: [
    // base
    { key: "product_name", label: "产品名称", labelEn: "Product Name", group: "base", required: true },
    { key: "sku", label: "SKU", labelEn: "SKU", group: "base", required: true },
    { key: "category", label: "品类", labelEn: "Category", group: "base", required: true },
    { key: "brand", label: "品牌", labelEn: "Brand", group: "base", required: false },
    { key: "collection", label: "系列", labelEn: "Collection", group: "base", required: false },
    // material
    { key: "material", label: "材质", labelEn: "Material", group: "material", required: true },
    { key: "fabric_composition", label: "面料成分", labelEn: "Fabric Composition", group: "material", required: true },
    { key: "gsm", label: "克重(GSM)", labelEn: "GSM", group: "material", required: false },
    { key: "thread_count", label: "支数/密度", labelEn: "Thread Count", group: "material", required: false },
    { key: "weave", label: "织法", labelEn: "Weave", group: "material", required: false },
    { key: "finish", label: "后整理", labelEn: "Finish", group: "material", required: false },
    // spec
    { key: "size", label: "尺寸", labelEn: "Size", group: "spec", required: true },
    { key: "color", label: "颜色", labelEn: "Color", group: "spec", required: true },
    { key: "pattern", label: "花型/图案", labelEn: "Pattern", group: "spec", required: false },
    { key: "weight_net", label: "净重", labelEn: "Net Weight", group: "spec", required: false },
    // packaging
    { key: "packaging_type", label: "包装方式", labelEn: "Packaging Type", group: "packaging", required: false },
    { key: "packaging_size", label: "包装尺寸", labelEn: "Packaging Size", group: "packaging", required: false },
    { key: "carton_qty", label: "装箱数量", labelEn: "Carton Qty", group: "packaging", required: false },
    { key: "carton_size", label: "外箱尺寸", labelEn: "Carton Size", group: "packaging", required: false },
    { key: "carton_weight", label: "外箱毛重", labelEn: "Carton Weight", group: "packaging", required: false },
    // commerce
    { key: "moq", label: "最小起订量", labelEn: "MOQ", group: "commerce", required: false },
    { key: "lead_time", label: "交期", labelEn: "Lead Time", group: "commerce", required: false },
    { key: "fob_price", label: "FOB 价格", labelEn: "FOB Price", group: "commerce", required: false },
    { key: "hs_code", label: "HS 编码", labelEn: "HS Code", group: "commerce", required: false },
    // compliance — 敏感声明，不强制
    {
      key: "certifications",
      label: "认证/标准",
      labelEn: "Certifications",
      group: "compliance",
      required: false,
      sensitiveClaim: true,
      description: "须有人工确认或官方文件支撑，不可 AI 臆造",
    },
    {
      key: "care_instructions",
      label: "洗护说明",
      labelEn: "Care Instructions",
      group: "compliance",
      required: false,
    },
    {
      key: "country_of_origin",
      label: "原产国",
      labelEn: "Country of Origin",
      group: "compliance",
      required: false,
    },
  ] satisfies IndustryFieldDefinition[],
} as const;

export function getHomeTextilePack() {
  return HOME_TEXTILE_PACK;
}

export function listRequiredFields(): IndustryFieldDefinition[] {
  return HOME_TEXTILE_PACK.fields.filter((f) => f.required);
}

export function listMissingFields(
  facts: Record<string, unknown>,
): IndustryFieldDefinition[] {
  return listRequiredFields().filter((field) => {
    const value = facts[field.key];
    if (value === null || value === undefined) return true;
    if (typeof value === "string" && value.trim() === "") return true;
    return false;
  });
}

export function getIndustryPack(packId: string) {
  if (packId === "home_textile") return getHomeTextilePack();
  return getHomeTextilePack();
}
