import { db } from "@/lib/db";
import { readBlobBuffer } from "@/lib/files/blob-access";
import { parseFileBuffer } from "@/lib/files/parse-buffer";
import {
  setJobStatus,
  upsertProductFactsFromExtraction,
  upsertProductContentStep,
} from "@/lib/product-content/jobs/service";
import { getIndustryPack, listMissingFields } from "@/lib/product-content/industry-packs/home-textile";
import type { ExtractedFact, ProductAssetRole } from "@/lib/product-content/types";

const KEY_VALUE_RE = /^([^:：=]+)\s*[:：=]\s*(.+)$/;
const FIELD_ALIASES: Record<string, string[]> = {
  material: ["material", "材质", "面料"],
  gsm: ["gsm", "克重"],
  size: ["size", "尺寸", "规格"],
  color: ["color", "颜色", "colour"],
  sku: ["sku", "货号", "编号"],
  product_name: ["product name", "product_name", "产品名称", "品名", "name"],
  fabric_composition: ["composition", "成分", "fabric composition"],
};

function normalizeKey(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((a) => key === a.toLowerCase() || key.includes(a.toLowerCase()))) {
      return canonical;
    }
  }
  return null;
}

function extractFactsFromText(
  text: string,
  sourceType: ExtractedFact["sourceType"],
  sourceId?: string,
): { facts: ExtractedFact[]; taskRequirements: string[] } {
  const facts: ExtractedFact[] = [];
  const taskRequirements: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const kv = line.match(KEY_VALUE_RE);
    if (kv) {
      const fieldKey = normalizeKey(kv[1]);
      const value = kv[2].trim();
      if (fieldKey) {
        facts.push({
          fieldKey,
          value,
          sourceType,
          sourceId,
          sourceLocation: line,
          confidence: 0.7,
        });
      } else if (/任务|要求|todo|need to|please/i.test(kv[1])) {
        taskRequirements.push(line);
      }
      continue;
    }

    for (const [fieldKey, aliases] of Object.entries(FIELD_ALIASES)) {
      for (const alias of aliases) {
        const re = new RegExp(`${alias}\\s*[:：]?\\s*([^,，;；\\n]+)`, "i");
        const m = line.match(re);
        if (m) {
          facts.push({
            fieldKey,
            value: m[1].trim(),
            sourceType,
            sourceId,
            sourceLocation: line,
            confidence: 0.65,
          });
        }
      }
    }

    if (/生成|制作|输出|export|deliver|package/i.test(line)) {
      taskRequirements.push(line);
    }
  }

  return { facts, taskRequirements };
}

function inferAssetRoleFromFileName(
  fileName?: string | null,
  purpose?: string | null,
): ProductAssetRole {
  const purposeNorm = (purpose ?? "").toLowerCase();
  const purposeMap: Record<string, ProductAssetRole> = {
    primary: "primary",
    detail: "detail",
    texture: "texture",
    logo: "logo",
    label: "label",
    packaging: "packaging",
    front: "front",
    back: "back",
    side: "side",
  };
  if (purposeNorm && purposeMap[purposeNorm]) return purposeMap[purposeNorm];

  const name = (fileName ?? "").toLowerCase();
  if (/white|白底|main|primary|hero/.test(name)) return "primary";
  if (/lifestyle|scene|场景/.test(name)) return "scene_reference";
  if (/marketing|banner|poster/.test(name)) return "marketing_layout";
  if (/pack|包装/.test(name)) return "packaging";
  if (/label|标签/.test(name)) return "label";
  if (/texture|纹理|面料/.test(name)) return "texture";
  if (/detail|细节|-1|-2|-3/.test(name)) return "detail";
  // 文件名含 SKU-序号 的补充图，默认作细节参考
  if (/mx-[a-z]+-s?\d+-\d+/i.test(name)) return "detail";
  return "unknown";
}

async function fetchUrlText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50000);
  } catch {
    return null;
  }
}

export async function analyzeJobInputs(
  orgId: string,
  jobId: string,
  userId: string,
) {
  await upsertProductContentStep(orgId, jobId, "analyze_inputs", {
    status: "running",
    startedAt: new Date(),
  });

  const job = await db.productContentJob.findFirst({ where: { id: jobId, orgId } });
  if (!job) throw new Error("产品内容任务不存在");

  if (job.status === "DRAFT" || job.status === "INGESTING") {
    await setJobStatus({ orgId, userId, jobId, status: "ANALYZING" });
  }

  const inputs = await db.productContentJobInput.findMany({
    where: { orgId, jobId },
    orderBy: { createdAt: "asc" },
  });

  const allFacts: ExtractedFact[] = [];
  const parseNotes: string[] = [];

  for (const item of inputs) {
    try {
      // 已解析输入跳过，避免重复建资产；事实抽取对 text 允许重跑时需重置 parseStatus
      if (item.parseStatus === "parsed" && item.inputType === "image") {
        continue;
      }

      if (item.inputType === "text" && item.textContent) {
        const { facts, taskRequirements } = extractFactsFromText(
          item.textContent,
          "user_statement",
          item.id,
        );
        allFacts.push(...facts);
        await db.productContentJobInput.update({
          where: { id: item.id },
          data: {
            parseStatus: "parsed",
            parseResultJson: { taskRequirements, factCount: facts.length },
          },
        });
        continue;
      }

      if (item.inputType === "voice") {
        if (item.transcriptText) {
          const { facts } = extractFactsFromText(
            item.transcriptText,
            "voice_transcript",
            item.id,
          );
          allFacts.push(...facts);
          await db.productContentJobInput.update({
            where: { id: item.id },
            data: { parseStatus: "parsed" },
          });
        } else {
          parseNotes.push(`语音输入 ${item.id} 待转写`);
          await db.productContentJobInput.update({
            where: { id: item.id },
            data: { parseStatus: "pending" },
          });
        }
        continue;
      }

      if ((item.inputType === "excel" || item.inputType === "pdf") && item.blobPathname) {
        const blob = await readBlobBuffer(item.blobPathname);
        if (!blob) {
          parseNotes.push(`无法读取文件：${item.fileName ?? item.blobPathname}`);
          await db.productContentJobInput.update({
            where: { id: item.id },
            data: { parseStatus: "failed" },
          });
          continue;
        }
        const parsed = await parseFileBuffer(blob.buffer, item.fileName ?? "file.pdf");
        if ("error" in parsed) {
          parseNotes.push(parsed.error);
          await db.productContentJobInput.update({
            where: { id: item.id },
            data: { parseStatus: "failed", parseResultJson: { error: parsed.error } },
          });
          continue;
        }
        const sourceType = item.inputType === "excel" ? "excel" : "pdf";
        const { facts } = extractFactsFromText(parsed.text, sourceType, item.id);
        allFacts.push(...facts);
        await db.productContentJobInput.update({
          where: { id: item.id },
          data: {
            parseStatus: "parsed",
            parseResultJson: { textLength: parsed.text.length, factCount: facts.length },
          },
        });
        continue;
      }

      if (item.inputType === "url" && item.url) {
        const purpose = item.purpose ?? "unknown";
        if (purpose === "competitor_reference") {
          await db.productContentJobInput.update({
            where: { id: item.id },
            data: {
              parseStatus: "parsed",
              parseResultJson: { skipped: true, reason: "competitor_reference" },
            },
          });
          continue;
        }

        const text = await fetchUrlText(item.url);
        if (text) {
          const { facts } = extractFactsFromText(text, "website", item.id);
          allFacts.push(...facts);
          await db.productContentJobInput.update({
            where: { id: item.id },
            data: {
              parseStatus: "parsed",
              parseResultJson: { url: item.url, factCount: facts.length },
            },
          });
        } else {
          parseNotes.push(`URL 抓取失败：${item.url}`);
          await db.productContentJobInput.update({
            where: { id: item.id },
            data: {
              parseStatus: "failed",
              parseResultJson: { url: item.url, fetchFailed: true },
            },
          });
        }
        continue;
      }

      if (item.inputType === "image" && item.blobPathname) {
        const role = inferAssetRoleFromFileName(item.fileName, item.purpose);
        await db.productAsset.create({
          data: {
            orgId,
            jobId,
            blobPathname: item.blobPathname,
            mimeType: item.mimeType,
            fileName: item.fileName,
            roleAuto: role,
            sourceType: "upload",
            createdById: userId,
          },
        });
        await db.productContentJobInput.update({
          where: { id: item.id },
          data: {
            parseStatus: "parsed",
            parseResultJson: { assetRole: role },
          },
        });
        continue;
      }

      parseNotes.push(`未处理的输入类型：${item.inputType}`);
    } catch (err) {
      parseNotes.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (allFacts.length > 0) {
    await upsertProductFactsFromExtraction({
      orgId,
      jobId,
      userId,
      facts: allFacts,
    });
  }

  const facts = await db.productFact.findMany({
    where: {
      orgId,
      jobId,
      status: { in: ["extracted", "confirmed", "needs_review"] },
    },
    select: { fieldKey: true, value: true },
  });
  const factRecord: Record<string, unknown> = {};
  for (const f of facts) factRecord[f.fieldKey] = f.value;

  const pack = getIndustryPack(job.industryPack);
  const missing = listMissingFields(factRecord);
  const nextStatus = missing.length > 0 ? "NEEDS_INPUT" : "PLAN_READY";

  await db.productContentJob.update({
    where: { id: jobId },
    data: {
      status: nextStatus,
      missingFieldsJson: missing.map((f) => ({ key: f.key, label: f.label })),
    },
  });

  await upsertProductContentStep(orgId, jobId, "analyze_inputs", {
    status: "done",
    finishedAt: new Date(),
    outputJson: {
      factCount: allFacts.length,
      missingCount: missing.length,
      parseNotes,
      industryPack: pack.id,
    },
  });

  return {
    factCount: allFacts.length,
    missingFields: missing,
    status: nextStatus,
    parseNotes,
  };
}
