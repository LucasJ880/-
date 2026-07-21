import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/rbac/roles";

async function assertOrgAccess(orgId: string, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user && isSuperAdmin(user.role)) return;
  const m = await getOrgMembership(userId, orgId);
  if (!m || m.status !== "active") throw new Error("无权访问该组织");
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function buildSellingPoints(facts: Record<string, unknown>): string[] {
  const points: string[] = [];
  const material = asString(facts.material) ?? asString(facts.fabric_composition);
  if (material) points.push(`Premium ${material} construction`);
  const gsm = asString(facts.gsm);
  if (gsm) points.push(`${gsm} GSM for balanced comfort and durability`);
  const weave = asString(facts.weave);
  if (weave) points.push(`${weave} weave for refined texture`);
  const size = asString(facts.size);
  if (size) points.push(`Available size: ${size}`);
  return points.slice(0, 6);
}

export async function generateProductCopy(
  orgId: string,
  jobId: string,
  userId: string,
) {
  await assertOrgAccess(orgId, userId);

  const job = await db.productContentJob.findFirst({ where: { id: jobId, orgId } });
  if (!job) throw new Error("产品内容任务不存在");

  const existingCopy = await db.productCopy.findUnique({ where: { jobId } });
  if (existingCopy?.locked) {
    return existingCopy;
  }

  const facts = await db.productFact.findMany({
    where: {
      orgId,
      jobId,
      status: { in: ["confirmed", "extracted"] },
      sourceType: { not: "ai_inference" },
    },
  });

  const factMap: Record<string, unknown> = {};
  const claimsToVerify: string[] = [];
  const missingInformation: string[] = [];

  for (const f of facts) {
    factMap[f.fieldKey] = f.value;
    if (f.status === "extracted" && f.fieldKey === "certifications") {
      claimsToVerify.push("Certifications require human verification before external use.");
    }
  }

  const packFields = ["product_name", "material", "size", "color", "sku", "gsm"];
  for (const key of packFields) {
    if (!asString(factMap[key])) missingInformation.push(key);
  }

  const productName =
    asString(factMap.product_name) ?? job.title ?? "Home Textile Product";
  const material =
    asString(factMap.material) ?? asString(factMap.fabric_composition);
  const color = asString(factMap.color);
  const size = asString(factMap.size);

  const titleEn = [productName, color].filter(Boolean).join(" — ");
  const shortParts = [
    productName,
    material ? `made from ${material}` : null,
    size ? `size ${size}` : null,
  ].filter(Boolean);
  const shortDescriptionEn = shortParts.join(", ") + ".";

  const longParts = [
    `${productName} is designed for export-ready home textile merchandising.`,
    material ? `Material: ${material}.` : null,
    color ? `Color: ${color}.` : null,
    size ? `Size: ${size}.` : null,
    asString(factMap.pattern) ? `Pattern: ${asString(factMap.pattern)}.` : null,
    asString(factMap.care_instructions)
      ? `Care: ${asString(factMap.care_instructions)}.`
      : null,
  ].filter(Boolean);
  const longDescriptionEn = longParts.join(" ");

  const specificationsJson: Record<string, string> = {};
  for (const [key, value] of Object.entries(factMap)) {
    const s = asString(value);
    if (s && !["certifications"].includes(key)) specificationsJson[key] = s;
  }

  const packagingJson: Record<string, string> = {};
  for (const key of ["packaging_type", "packaging_size", "carton_qty", "carton_size", "carton_weight"]) {
    const s = asString(factMap[key]);
    if (s) packagingJson[key] = s;
  }

  // 认证仅在有 confirmed 事实时写入，且标记待验证
  const certValue = facts.find(
    (f: { fieldKey: string; status: string; value: unknown }) =>
      f.fieldKey === "certifications" && f.status === "confirmed",
  );
  if (certValue) {
    claimsToVerify.push(`Listed certification: ${asString(certValue.value) ?? "see source"}`);
  }

  const copy = await db.productCopy.upsert({
    where: { jobId },
    create: {
      orgId,
      jobId,
      productNameEn: productName,
      titleEn,
      sellingPointsJson: buildSellingPoints(factMap),
      shortDescriptionEn,
      longDescriptionEn,
      specificationsJson,
      packagingJson,
      careInstructionsEn: asString(factMap.care_instructions),
      useCasesJson: ["Retail catalog", "B2B export presentation"],
      missingInformationJson: missingInformation,
      claimsToVerifyJson: claimsToVerify,
      status: "draft",
    },
    update: existingCopy?.locked
      ? {}
      : {
          productNameEn: productName,
          titleEn,
          sellingPointsJson: buildSellingPoints(factMap),
          shortDescriptionEn,
          longDescriptionEn,
          specificationsJson,
          packagingJson,
          careInstructionsEn: asString(factMap.care_instructions),
          missingInformationJson: missingInformation,
          claimsToVerifyJson: claimsToVerify,
          status: "draft",
        },
  });

  return copy;
}
