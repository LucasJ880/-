/**
 * 客户画像引擎
 *
 * 从沟通记录和交易历史中持续构建客户画像：
 * - 增量更新（每次互动后追加证据）
 * - 置信度加权（沟通越多画像越准）
 * - embedding 索引（用于"找相似客户"）
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { generateEmbedding } from "@/lib/ai/embedding";
import { setProfileEmbedding } from "./vector-search";
import type { CommunicationAnalysis } from "./communication-analyzer";

interface ProfileUpdateInput {
  customerId: string;
  newAnalysis?: CommunicationAnalysis;
  dealOutcome?: "won" | "lost";
  quoteInfo?: { grandTotal: number; productTypes: string };
}

const PROFILE_PROMPT = `Based on the customer data below, generate/update a structured customer profile. Return ONLY valid JSON (no code blocks).

Customer name: {{customerName}}
Current profile (if exists): {{currentProfile}}
New evidence from latest interaction: {{newEvidence}}
Deal history: {{dealHistory}}
Quote history: {{quoteHistory}}

Return this exact JSON structure:
{
  "customerType": "residential" | "commercial" | "designer" | "contractor" | "developer" | null,
  "decisionRole": "owner" | "spouse" | "property_manager" | "designer" | "committee" | null,
  "budgetRange": "economy" | "mid_range" | "premium" | "luxury" | null,
  "priceSensitivity": 0-1 (0=not sensitive, 1=very sensitive) or null,
  "communicationStyle": "direct" | "detail_oriented" | "relationship_focused" | "price_driven" | null,
  "preferredChannel": "wechat" | "email" | "phone" | "in_person" | null,
  "responseSpeed": "fast_responder" | "slow_deliberate" | "ghost_risk" | null,
  "decisionSpeed": "impulse" | "moderate" | "slow_researcher" | null,
  "productPreferences": ["string array of preferred products"],
  "roomTypes": ["string array of room types mentioned"],
  "keyNeeds": ["string array of key customer needs"],
  "objectionHistory": ["string array of objection types encountered"],
  "winProbability": 0-1 or null,
  "profileSummary": "2-3 sentence natural language summary for AI to use as context"
}

Rules:
- Only set fields you have evidence for; use null otherwise
- Merge new evidence with existing profile, don't overwrite unless contradicted
- Be conservative with winProbability`;

export async function updateCustomerProfile(
  input: ProfileUpdateInput,
): Promise<{ profileId: string; updated: boolean }> {
  const customer = await db.salesCustomer.findUnique({
    where: { id: input.customerId },
    select: {
      id: true,
      name: true,
      source: true,
      tags: true,
    },
  });

  if (!customer) {
    return { profileId: "", updated: false };
  }

  const existing = await db.customerProfile.findUnique({
    where: { customerId: input.customerId },
  });

  const opportunities = await db.salesOpportunity.findMany({
    where: { customerId: input.customerId },
    select: {
      stage: true,
      estimatedValue: true,
      productTypes: true,
      wonAt: true,
      lostAt: true,
      lostReason: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });

  const quotes = await db.salesQuote.findMany({
    where: { customerId: input.customerId },
    select: { grandTotal: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const interactionCount = await db.customerInteraction.count({
    where: { customerId: input.customerId },
  });

  const currentProfileStr = existing
    ? JSON.stringify({
        customerType: existing.customerType,
        budgetRange: existing.budgetRange,
        priceSensitivity: existing.priceSensitivity,
        communicationStyle: existing.communicationStyle,
        preferredChannel: existing.preferredChannel,
        responseSpeed: existing.responseSpeed,
        decisionSpeed: existing.decisionSpeed,
        productPreferences: existing.productPreferences,
        keyNeeds: existing.keyNeeds,
        objectionHistory: existing.objectionHistory,
      })
    : "None (first profile generation)";

  const newEvidenceStr = input.newAnalysis
    ? JSON.stringify({
        sentiment: input.newAnalysis.sentiment,
        intent: input.newAnalysis.intent,
        objectionType: input.newAnalysis.objectionType,
        buyerSignals: input.newAnalysis.buyerSignals,
        riskSignals: input.newAnalysis.riskSignals,
        keyNeeds: input.newAnalysis.keyNeeds,
      })
    : "No new interaction data";

  const dealHistoryStr = opportunities
    .map((o) => `${o.stage} | $${o.estimatedValue ?? "?"} | ${o.productTypes ?? "?"} | ${o.wonAt ? "WON" : o.lostAt ? "LOST: " + o.lostReason : "OPEN"}`)
    .join("\n") || "No deal history";

  const quoteHistoryStr = quotes
    .map((q) => `$${q.grandTotal} | ${q.status} | ${q.createdAt.toISOString().slice(0, 10)}`)
    .join("\n") || "No quotes";

  const prompt = PROFILE_PROMPT
    .replace("{{customerName}}", customer.name)
    .replace("{{currentProfile}}", currentProfileStr)
    .replace("{{newEvidence}}", newEvidenceStr)
    .replace("{{dealHistory}}", dealHistoryStr)
    .replace("{{quoteHistory}}", quoteHistoryStr);

  try {
    const result = await createCompletion({
      systemPrompt:
        "You are a customer profiling analyst for a blinds/window treatment company. " +
        "Generate accurate, evidence-based customer profiles. Be conservative — " +
        "only include attributes you have clear evidence for.",
      userPrompt: prompt,
      mode: "normal",
      temperature: 0.2,
      maxTokens: 800,
    });

    const cleaned = result.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const confidence = Math.min(1.0, 0.1 + interactionCount * 0.08);

    const mergedObjections = mergeStringArrays(
      existing?.objectionHistory ?? [],
      parsed.objectionHistory ?? [],
    );
    if (input.newAnalysis?.objectionType && !mergedObjections.includes(input.newAnalysis.objectionType)) {
      mergedObjections.push(input.newAnalysis.objectionType);
    }

    const profileData = {
      customerType: parsed.customerType || existing?.customerType || undefined,
      decisionRole: parsed.decisionRole || existing?.decisionRole || undefined,
      budgetRange: parsed.budgetRange || existing?.budgetRange || undefined,
      priceSensitivity: parsed.priceSensitivity ?? existing?.priceSensitivity ?? undefined,
      communicationStyle: parsed.communicationStyle || existing?.communicationStyle || undefined,
      preferredChannel: parsed.preferredChannel || existing?.preferredChannel || undefined,
      responseSpeed: parsed.responseSpeed || existing?.responseSpeed || undefined,
      decisionSpeed: parsed.decisionSpeed || existing?.decisionSpeed || undefined,
      productPreferences: mergeStringArrays(
        existing?.productPreferences ?? [],
        parsed.productPreferences ?? [],
      ),
      roomTypes: mergeStringArrays(
        existing?.roomTypes ?? [],
        parsed.roomTypes ?? [],
      ),
      keyNeeds: mergeStringArrays(
        existing?.keyNeeds ?? [],
        parsed.keyNeeds ?? [],
      ),
      objectionHistory: mergedObjections,
      winProbability: parsed.winProbability ?? existing?.winProbability ?? undefined,
      acquisitionChannel: existing?.acquisitionChannel || customer.source || undefined,
      confidence,
      lastAnalyzedAt: new Date(),
      analysisVersion: (existing?.analysisVersion ?? 0) + 1,
    };

    const profile = await db.customerProfile.upsert({
      where: { customerId: input.customerId },
      create: { customerId: input.customerId, ...profileData },
      update: profileData,
    });

    const profileText = `Customer: ${customer.name}. Type: ${profile.customerType || "unknown"}. ` +
      `Budget: ${profile.budgetRange || "unknown"}. Style: ${profile.communicationStyle || "unknown"}. ` +
      `Needs: ${profile.keyNeeds.join(", ") || "unknown"}. ` +
      `Products: ${profile.productPreferences.join(", ") || "unknown"}. ` +
      (parsed.profileSummary || "");

    try {
      const emb = await generateEmbedding(profileText);
      await setProfileEmbedding(profile.id, emb);
    } catch {
      // embedding 失败不阻塞
    }

    return { profileId: profile.id, updated: true };
  } catch (err) {
    console.error("[ProfileEngine] Update failed:", err);
    return { profileId: existing?.id ?? "", updated: false };
  }
}

function mergeStringArrays(existing: string[], incoming: string[]): string[] {
  const set = new Set([...existing, ...incoming].map((s) => s.toLowerCase().trim()));
  return [...set].filter(Boolean);
}

/**
 * 批量更新所有客户画像（定时任务用）
 */
export async function refreshAllProfiles(
  opts?: { limit?: number },
): Promise<{ updated: number; errors: number }> {
  const customers = await db.salesCustomer.findMany({
    where: { status: "active" },
    select: { id: true },
    take: opts?.limit ?? 100,
    orderBy: { updatedAt: "desc" },
  });

  let updated = 0;
  let errors = 0;

  for (const c of customers) {
    try {
      const result = await updateCustomerProfile({ customerId: c.id });
      if (result.updated) updated++;
    } catch {
      errors++;
    }
  }

  return { updated, errors };
}
