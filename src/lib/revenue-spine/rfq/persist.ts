/**
 * Revenue Spine — RFQ 落库（SalesRfq 每商机一条 + SalesRfqEvidence 证据行）
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { computeMissingFields, rfqStatusFor } from "./missing-info";
import type { RfqExtraction, RfqFields } from "./types";

export interface PersistRfqInput {
  orgId: string;
  opportunityId: string;
  customerId: string;
  extraction: RfqExtraction;
  sourceInteractionId: string | null;
  /** website_inquiry | email | conversation | manual */
  sourceKind: string;
  agentRunId?: string | null;
}

function fieldData(f: RfqFields) {
  return {
    productCategory: f.productCategory,
    productName: f.productName,
    material: f.material,
    composition: f.composition,
    size: f.size,
    quantity: f.quantity,
    unit: f.unit,
    color: f.color,
    customLogo: f.customLogo,
    customization: f.customization,
    packaging: f.packaging,
    certification: f.certification,
    sampleRequired: f.sampleRequired,
    targetPrice: f.targetPrice,
    currency: f.currency,
    destinationCountry: f.destinationCountry,
    destinationCity: f.destinationCity,
    incoterm: f.incoterm,
    requiredDeliveryDate: f.requiredDeliveryDate,
    buyerType: f.buyerType,
    application: f.application,
  };
}

/**
 * 合并语义：新抽取只覆盖"有值"的字段，不清空历史已知字段（补充信息型来信）。
 * 证据行按本次抽取追加（保留历史证据）。
 */
export async function upsertRfq(input: PersistRfqInput) {
  const { extraction } = input;
  const now = new Date();
  return db.$transaction(async (tx) => {
    const existing = await tx.salesRfq.findUnique({ where: { opportunityId: input.opportunityId } });
    let merged: RfqFields = extraction.fields;
    if (existing) {
      const prev = existing as unknown as Record<string, unknown>;
      merged = { ...extraction.fields };
      for (const [k, v] of Object.entries(extraction.fields)) {
        if (v === null || v === undefined) {
          const p = prev[k];
          (merged as unknown as Record<string, unknown>)[k] = p === undefined ? null : p;
        }
      }
    }
    const missing = computeMissingFields(merged);
    const status = rfqStatusFor(merged);
    const data = {
      ...fieldData(merged),
      status,
      missingFields: missing as unknown as Prisma.InputJsonValue,
      language: extraction.language,
      extractionMethod: extraction.method,
      extractedAt: now,
      agentRunId: input.agentRunId ?? null,
      notes: extraction.notes.length ? extraction.notes.join("\n").slice(0, 4000) : existing?.notes ?? null,
    };
    const rfq = existing
      ? await tx.salesRfq.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await tx.salesRfq.create({
          data: {
            orgId: input.orgId,
            opportunityId: input.opportunityId,
            customerId: input.customerId,
            ...data,
          },
        });
    if (extraction.evidence.length) {
      await tx.salesRfqEvidence.createMany({
        data: extraction.evidence.map((e) => ({
          orgId: input.orgId,
          rfqId: rfq.id,
          opportunityId: input.opportunityId,
          field: e.field,
          value: e.value.slice(0, 2000),
          confidence: e.confidence,
          sourceInteractionId: input.sourceInteractionId,
          sourceKind: input.sourceKind,
          evidenceText: e.evidenceText.slice(0, 2000),
          extractedBy: e.extractedBy,
        })),
      });
    }
    return { rfq, fields: merged, missing, status };
  });
}

export function rfqRowToFields(row: Record<string, unknown>): RfqFields {
  return {
    productCategory: (row.productCategory as string | null) ?? null,
    productName: (row.productName as string | null) ?? null,
    material: (row.material as string | null) ?? null,
    composition: (row.composition as string | null) ?? null,
    size: (row.size as string | null) ?? null,
    quantity: (row.quantity as number | null) ?? null,
    unit: (row.unit as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    customLogo: (row.customLogo as boolean | null) ?? null,
    customization: (row.customization as string | null) ?? null,
    packaging: (row.packaging as string | null) ?? null,
    certification: (row.certification as string | null) ?? null,
    sampleRequired: (row.sampleRequired as boolean | null) ?? null,
    targetPrice: (row.targetPrice as number | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    destinationCountry: (row.destinationCountry as string | null) ?? null,
    destinationCity: (row.destinationCity as string | null) ?? null,
    incoterm: (row.incoterm as string | null) ?? null,
    requiredDeliveryDate: (row.requiredDeliveryDate as Date | null) ?? null,
    buyerType: (row.buyerType as string | null) ?? null,
    application: (row.application as string | null) ?? null,
  };
}
