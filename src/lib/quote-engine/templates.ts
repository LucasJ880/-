/**
 * 模板：Template A（PROJECT_SUPPLY_INSTALL）/ Template B（STANDING_OFFER）的初始成本行，
 * 以及两套 NON-PRODUCTION 合成 demo（不含任何真实供应商/客户数据）。
 */

import type { CostLinePayload, EngineConfig, TierPayload } from "./contract";

type Seed = Omit<CostLinePayload, "id">;

const L = (p: Partial<Seed> & Pick<Seed, "category" | "description" | "calculationType">): Seed => ({
  sortOrder: 0,
  subcategory: null,
  quantity: null,
  unit: null,
  unitCost: null,
  sourceCurrency: "CAD",
  fxRate: null,
  fxRateSource: null,
  calculationBase: null,
  rate: null,
  duration: null,
  supplierId: null,
  supplierName: null,
  source: null,
  notes: null,
  included: true,
  ...p,
});

/** Template A：Supply + Install（国内采购 → 加拿大进口 → 本地安装）的章节骨架 */
export function templateSupplyInstallLines(): Seed[] {
  return [
    L({ category: "PROCUREMENT", subcategory: "Procurement", description: "Product（供应商货值）", calculationType: "PER_UNIT", unit: "unit", sourceCurrency: "CNY" }),
    L({ category: "LOGISTICS", subcategory: "Logistics", description: "China domestic freight", calculationType: "FIXED" }),
    L({ category: "FREIGHT", subcategory: "Logistics", description: "Ocean freight", calculationType: "PER_CONTAINER", unit: "container" }),
    L({ category: "CUSTOMS", subcategory: "Logistics", description: "Customs brokerage", calculationType: "FIXED" }),
    L({ category: "DUTY", subcategory: "Logistics", description: "Duty（% of procurement）", calculationType: "PERCENT_OF_COST", calculationBase: "PROCUREMENT" }),
    L({ category: "FREIGHT", subcategory: "Logistics", description: "Canada inland freight", calculationType: "FIXED" }),
    L({ category: "LOGISTICS", subcategory: "Logistics", description: "Packaging", calculationType: "FIXED" }),
    L({ category: "LABOUR", subcategory: "Labour", description: "Removal", calculationType: "PER_HOUR", unit: "hr" }),
    L({ category: "LABOUR", subcategory: "Labour", description: "Installation", calculationType: "PER_HOUR", unit: "hr" }),
    L({ category: "LABOUR", subcategory: "Labour", description: "Caulking", calculationType: "PER_UNIT", unit: "unit" }),
    L({ category: "LABOUR", subcategory: "Labour", description: "Painting repair", calculationType: "PER_HOUR", unit: "hr" }),
    L({ category: "LABOUR", subcategory: "Labour", description: "Measurement", calculationType: "PER_DAY", unit: "day" }),
    L({ category: "LABOUR", subcategory: "Labour", description: "Foreman", calculationType: "PER_DAY", unit: "day" }),
    L({ category: "LABOUR", subcategory: "Labour", description: "Overtime", calculationType: "PER_HOUR", unit: "hr" }),
    L({ category: "EQUIPMENT", subcategory: "Equipment / Site", description: "Lift", calculationType: "PER_DAY", unit: "day" }),
    L({ category: "SITE_GENERAL", subcategory: "Equipment / Site", description: "Fence / Protection", calculationType: "FIXED" }),
    L({ category: "SITE_GENERAL", subcategory: "Equipment / Site", description: "Garbage bin", calculationType: "PER_MONTH", unit: "month" }),
    L({ category: "SITE_GENERAL", subcategory: "Equipment / Site", description: "Parking / Delivery", calculationType: "FIXED" }),
    L({ category: "PERMIT", subcategory: "Engineering & Compliance", description: "Permit", calculationType: "FIXED" }),
    L({ category: "ENGINEERING", subcategory: "Engineering & Compliance", description: "Engineer / Shop drawing", calculationType: "FIXED" }),
    L({ category: "COMPLIANCE", subcategory: "Engineering & Compliance", description: "Testing / Inspection / ESA", calculationType: "FIXED" }),
    L({ category: "PROJECT_MANAGEMENT", subcategory: "Project Overhead", description: "Project Manager", calculationType: "PER_MONTH", unit: "month" }),
    L({ category: "INSURANCE", subcategory: "Project Overhead", description: "Insurance", calculationType: "FIXED" }),
    L({ category: "BOND", subcategory: "Project Overhead", description: "Bond", calculationType: "PERCENT_OF_REVENUE" }),
    L({ category: "SITE_GENERAL", subcategory: "Project Overhead", description: "Travel", calculationType: "PER_TRIP", unit: "trip" }),
    L({ category: "OTHER", subcategory: "Project Overhead", description: "Warranty / After-sales reserve", calculationType: "PERCENT_OF_COST", calculationBase: "DIRECT_COST" }),
    L({ category: "FINANCING", subcategory: "Commercial", description: "Financing（% of capital deployed）", calculationType: "PERCENT_OF_CAPITAL", calculationBase: "CAPITAL" }),
    L({ category: "ADMIN", subcategory: "Commercial", description: "Admin（% of revenue）", calculationType: "PERCENT_OF_REVENUE" }),
    L({ category: "COMMISSION", subcategory: "Commercial", description: "Commission（% of revenue）", calculationType: "PERCENT_OF_REVENUE" }),
    L({ category: "CONTINGENCY", subcategory: "Commercial", description: "Contingency（% of direct cost）", calculationType: "PERCENT_OF_COST", calculationBase: "DIRECT_COST" }),
  ].map((s, i) => ({ ...s, sortOrder: (i + 1) * 10 }));
}

/** Template B：Standing Offer 的成本行骨架（单位经济在 engine.standingOffer，分级在 tiers） */
export function templateStandingOfferLines(): Seed[] {
  return [
    L({ category: "FINANCING", subcategory: "Commercial", description: "Financing（% of revenue）", calculationType: "PERCENT_OF_REVENUE" }),
    L({ category: "ADMIN", subcategory: "Commercial", description: "Admin（% of revenue）", calculationType: "PERCENT_OF_REVENUE" }),
  ].map((s, i) => ({ ...s, sortOrder: (i + 1) * 10 }));
}

export function defaultEngineConfig(quoteType: string): EngineConfig {
  return quoteType === "STANDING_OFFER"
    ? { standingOffer: { supplierCostPerPiece: null, supplierCurrency: "USD", fxRate: null, piecesPerBox: null, boxesPerContainer: null, moq: null, annualQuantity: null, freightPerContainer: null, customsPerContainer: null, dutyPct: null, warehousePerContainer: null, otherPerContainer: null, inventoryCarryingPct: null }, tax: { hstPct: null, gstPct: null, pstPct: null } }
    : { tax: { hstPct: null, gstPct: null, pstPct: null } };
}

/* ------------------------------ NON-PRODUCTION demos（合成数据） ------------------------------ */

export function demoSupplyInstall(): { lines: Seed[]; pricing: { method: "MARKUP_ON_COST" | "MARGIN_ON_REVENUE"; rate: number }; engine: EngineConfig } {
  const lines: Seed[] = [
    L({ category: "PROCUREMENT", subcategory: "Procurement", description: "Demo window units", calculationType: "PER_UNIT", quantity: 250, unit: "unit", unitCost: 1400, sourceCurrency: "CNY", fxRate: 0.19, supplierName: "Demo Supplier Co. (synthetic)" }),
    L({ category: "FREIGHT", subcategory: "Logistics", description: "Ocean freight", calculationType: "PER_CONTAINER", duration: 3, unit: "container", unitCost: 10000 }),
    L({ category: "CUSTOMS", subcategory: "Logistics", description: "Customs brokerage", calculationType: "FIXED", unitCost: 2500 }),
    L({ category: "DUTY", subcategory: "Logistics", description: "Duty", calculationType: "PERCENT_OF_COST", calculationBase: "PROCUREMENT", rate: 6.5 }),
    L({ category: "LABOUR", subcategory: "Labour", description: "Installation", calculationType: "PER_HOUR", quantity: 2, duration: 640, unit: "hr", unitCost: 55 }),
    L({ category: "LABOUR", subcategory: "Labour", description: "Caulking", calculationType: "PER_UNIT", quantity: 250, unit: "unit", unitCost: 14.67 }),
    L({ category: "EQUIPMENT", subcategory: "Equipment / Site", description: "Lift", calculationType: "PER_DAY", duration: 18, unit: "day", unitCost: 350 }),
    L({ category: "PROJECT_MANAGEMENT", subcategory: "Project Overhead", description: "Project Manager", calculationType: "PER_MONTH", duration: 5, unit: "month", unitCost: 5000 }),
    L({ category: "PERMIT", subcategory: "Engineering & Compliance", description: "Permit", calculationType: "FIXED", unitCost: 5000 }),
    L({ category: "BOND", subcategory: "Project Overhead", description: "Bond", calculationType: "PERCENT_OF_REVENUE", rate: 1.5 }),
    L({ category: "FINANCING", subcategory: "Commercial", description: "Financing（% of capital）", calculationType: "PERCENT_OF_CAPITAL", calculationBase: "CAPITAL", rate: 8 }),
    L({ category: "ADMIN", subcategory: "Commercial", description: "Admin（% of revenue）", calculationType: "PERCENT_OF_REVENUE", rate: 5 }),
    L({ category: "COMMISSION", subcategory: "Commercial", description: "Commission（% of revenue）", calculationType: "PERCENT_OF_REVENUE", rate: 6 }),
    L({ category: "CONTINGENCY", subcategory: "Commercial", description: "Contingency", calculationType: "PERCENT_OF_COST", calculationBase: "DIRECT_COST", rate: 5 }),
  ].map((s, i) => ({ ...s, sortOrder: (i + 1) * 10 }));
  return { lines, pricing: { method: "MARGIN_ON_REVENUE", rate: 12 }, engine: { tax: { hstPct: 13 } } };
}

export function demoStandingOffer(): { lines: Seed[]; pricing: { method: "MARKUP_ON_COST" | "MARGIN_ON_REVENUE"; rate: number }; engine: EngineConfig; tiers: Omit<TierPayload, "id">[] } {
  // Base cost ≈ $51,900（27,167 箱/柜 × 50 件/箱；回归算例 2）；收入基数 3% + 8% + 5%（回归算例 1）
  const lines: Seed[] = [
    L({ category: "PROCUREMENT", subcategory: "Procurement", description: "Demo SKU supplier cost (synthetic)", calculationType: "FIXED", unitCost: 40000 }),
    L({ category: "FREIGHT", subcategory: "Logistics", description: "Ocean freight", calculationType: "PER_CONTAINER", duration: 1, unit: "container", unitCost: 9000 }),
    L({ category: "CUSTOMS", subcategory: "Logistics", description: "Customs", calculationType: "FIXED", unitCost: 900 }),
    L({ category: "WAREHOUSING", subcategory: "Logistics", description: "Warehouse", calculationType: "FIXED", unitCost: 2000 }),
    L({ category: "FINANCING", subcategory: "Commercial", description: "Financing（% of revenue）", calculationType: "PERCENT_OF_REVENUE", rate: 3 }),
    L({ category: "ADMIN", subcategory: "Commercial", description: "Admin（% of revenue）", calculationType: "PERCENT_OF_REVENUE", rate: 8 }),
    L({ category: "PROFIT", subcategory: "Commercial", description: "Profit target（% of revenue）", calculationType: "PERCENT_OF_REVENUE", rate: 5 }),
  ].map((s, i) => ({ ...s, sortOrder: (i + 1) * 10 }));
  return {
    lines,
    pricing: { method: "MARKUP_ON_COST", rate: 0 },
    engine: { standingOffer: { supplierCostPerPiece: 0.0295, supplierCurrency: "CAD", piecesPerBox: 50, boxesPerContainer: 27167, moq: 325000, annualQuantity: 3750000, freightPerContainer: 9000, customsPerContainer: 900, dutyPct: 0, warehousePerContainer: 2000, inventoryCarryingPct: 0 }, tax: { hstPct: 13 } },
    tiers: [
      { sortOrder: 1, tierName: "Level 1", minQuantity: 1, maxQuantity: 325000, expectedQuantity: 325000, pricingMethod: "MARGIN_ON_REVENUE", rate: 20, active: true },
      { sortOrder: 2, tierName: "Level 2", minQuantity: 325001, maxQuantity: 3750000, expectedQuantity: 3750000, pricingMethod: "MARGIN_ON_REVENUE", rate: 15, active: true },
    ],
  };
}
