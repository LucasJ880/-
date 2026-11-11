/**
 * 历史回归样例，不是报价，不是合规证明。
 *
 * 来源：Lucas 2026-11-11 提供的 qyane-tender-intelligence Skill 包
 * `assets/ottawa-bedbug-case.json`（City of Ottawa RFT 18026-93121-T01，
 * 2026-11-10 15:00 EST 已截标）。招标编号、发标方、行项与数量是公开的招标事实，
 * 原样保留；Skill 样例里一家竞争对手与两家出口商的名称不入库，用代号代替
 *（那几条本身只是「未证实的线索」）。
 */
import type { PriceScheduleLine } from "../../contract";

const ENCASEMENT = "Fully zippered bed bug proof encasement";
const WHOLE_UNIT_CERT = "Canadian-accredited whole-equipment electrical certification";

export const OTTAWA_18026_LINES: PriceScheduleLine[] = [
  { lineNo: 1, description: "Twin Mattress Cover", uom: "Each", quantity: 2367, dimensions: "39 x 77.5 x 9-15", requirement: ENCASEMENT },
  { lineNo: 2, description: "Twin Box Spring Cover", uom: "Each", quantity: 1474, dimensions: "39 x 77.5 x 9", requirement: ENCASEMENT },
  { lineNo: 3, description: "Twin Long Box Spring Cover", uom: "Each", quantity: 177, dimensions: "39 x 80 x 9", requirement: ENCASEMENT },
  { lineNo: 4, description: "Full Mattress Cover", uom: "Each", quantity: 648, dimensions: "54 x 77.5 x 9-15", requirement: ENCASEMENT },
  { lineNo: 5, description: "Full Box Spring Cover", uom: "Each", quantity: 402, dimensions: "54 x 77.5 x 9", requirement: ENCASEMENT },
  { lineNo: 6, description: "Queen Mattress Cover", uom: "Each", quantity: 536, dimensions: "60 x 80 x 9-15", requirement: ENCASEMENT },
  { lineNo: 7, description: "Queen Box Spring Cover", uom: "Each", quantity: 345, dimensions: "60 x 80 x 9", requirement: ENCASEMENT },
  { lineNo: 8, description: "King Mattress Cover", uom: "Each", quantity: 77, dimensions: "78 x 80 x 11", requirement: ENCASEMENT },
  { lineNo: 9, description: "Crib Mattress Cover", uom: "Each", quantity: 93, dimensions: "28 x 52 x 7", requirement: ENCASEMENT },
  { lineNo: 10, description: "Standard Pillow Covers", uom: "Pack", quantity: 2349, packCount: 2, dimensions: "20 x 26" },
  { lineNo: 11, description: "Queen Pillow Covers", uom: "Pack", quantity: 554, packCount: 2, dimensions: "20 x 30" },
  { lineNo: 12, description: "Bed Bug Interceptors", uom: "Box", quantity: 436, packCount: 12, requirement: "White" },
  { lineNo: 13, description: "Small Portable Thermal Treatment Chamber", uom: "Each", quantity: 19, minimumDimensions: "37.5 x 23 x 23", certificationGate: WHOLE_UNIT_CERT },
  { lineNo: 14, description: "Medium Portable Thermal Treatment Chamber", uom: "Each", quantity: 26, minimumDimensions: "39.5 x 39.5 x 28", certificationGate: WHOLE_UNIT_CERT },
  { lineNo: 15, description: "Large Thermal Treatment Chamber", uom: "Each", quantity: 9, minimumDimensions: "111 x 57.5 x 80", certificationGate: WHOLE_UNIT_CERT },
  { lineNo: 16, description: "Laundry Bags, Front Load", uom: "Roll", quantity: 298, packCount: 25, dimensions: "26 x 33" },
  { lineNo: 17, description: "Laundry Bags, Medium", uom: "Roll", quantity: 370, packCount: 25, dimensions: "28 x 39" },
  { lineNo: 18, description: "Laundry Bags, Large", uom: "Roll", quantity: 472, packCount: 25, dimensions: "36 x 38" },
];

export const OTTAWA_18026 = {
  caseId: "EXAMPLE-OTTAWA-18026-93121-T01",
  fixtureType: "historical_regression_example_not_live_data",
  opportunity: {
    jurisdiction: "Ontario, Canada",
    issuer: "City of Ottawa",
    solicitationId: "18026-93121-T01",
    title: "Bed Bug Eradication Bedding and Products",
    closingAt: "2026-11-10T15:00:00-05:00",
    requiredDeliveryBy: "2027-01-31",
    deliverySitesApprox: 40,
    awardBasis: "Lowest responsive total excluding HST, accounting for eligible prompt-payment discount",
    estimatedQuantitiesAreNotGuaranteed: true,
  },
  lines: OTTAWA_18026_LINES,
  addenda: [
    {
      number: 1,
      issuedOn: "2026-11-05",
      effect: "Items 13-15 require manufacturer Make and Model plus Canadian-accredited whole-equipment electrical certification",
    },
  ],
  /** 文件领取方（Document Holder）≠ 投标人：9 条记录不是 9 份投标。 */
  documentHolders: { snapshotType: "USER_UPLOADED_PORTAL_SCREENSHOT", recordsCount: 9 },
  /** 历史第三方运单线索，仅作寻源线索；不推断独家、投标或当前供货关系。 */
  importLeadExample: {
    importer: "COMPETITOR_A",
    candidateExporters: ["EXPORTER_A", "EXPORTER_B"],
    relationshipStatus: "UNVERIFIED_CURRENT_SUPPLY",
  },
  expected: {
    count: 18,
    mattressAndBoxEach: 6119,
    pillowPacks: 2903,
    interceptorBoxes: 436,
    thermalEach: 54,
    laundryRolls: 1140,
    electricalCertItems: [13, 14, 15],
  },
} as const;
